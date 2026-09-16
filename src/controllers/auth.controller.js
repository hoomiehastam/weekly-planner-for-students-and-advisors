const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { generateToken, setTokenCookie, clearTokenCookie } = require('../utils/jwt');
const { normalizePhone, normalizeBio, validatePassword } = require('../utils/normalizers');

const SALT_ROUNDS = 10;

// ثبت‌نام کاربر جدید. دانش‌آموز بلافاصله فعال می‌شود، مشاور منتظر تایید سوپرادمین می‌ماند
async function register(req, res, next) {
  try {
    const { fullName, email, password, role, advisorId, phone, bio } = req.body;

    if (!fullName || !email || !password || !role) {
      return res.status(400).json({ error: 'همه‌ی فیلدها الزامی هستند' });
    }

    if (!['STUDENT', 'ADVISOR'].includes(role)) {
      return res.status(400).json({ error: 'نقش انتخاب‌شده معتبر نیست' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'این ایمیل قبلاً ثبت شده است' });
    }

    // نرمال‌سازی شماره تماس، توضیحات و اعتبارسنجی رمز عبور
    let phoneValue = null;
    let bioValue = null;
    let passwordValue;
    try {
      phoneValue = normalizePhone(phone);
      bioValue = normalizeBio(bio);
      passwordValue = validatePassword(password);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // دانش‌آموز باید حتماً یک مشاور فعال را انتخاب کند
    let advisor = null;
    if (role === 'STUDENT') {
      if (!advisorId) {
        return res.status(400).json({ error: 'انتخاب مشاور برای دانش‌آموز الزامی است' });
      }
      advisor = await prisma.user.findFirst({
        where: { id: advisorId, role: 'ADVISOR', status: 'ACTIVE' },
      });
      if (!advisor) {
        return res.status(400).json({ error: 'مشاور انتخاب‌شده یافت نشد یا هنوز فعال نیست' });
      }
    }

    const passwordHash = await bcrypt.hash(passwordValue, SALT_ROUNDS);

    // دانش‌آموز بلافاصله فعال است، مشاور تا تایید سوپرادمین در وضعیت انتظار می‌ماند
    const status = role === 'STUDENT' ? 'ACTIVE' : 'PENDING';

    const user = await prisma.user.create({
      data: {
        fullName,
        email,
        passwordHash,
        role,
        status,
        phone: phoneValue,
        bio: bioValue,
      },
    });

    if (role === 'STUDENT') {
      await prisma.advisorStudentLink.create({
        data: { advisorId: advisor.id, studentId: user.id },
      });
    }

    // فقط کاربر فعال بلافاصله توکن می‌گیرد؛ مشاور در انتظار باید صبر کند
    if (status === 'ACTIVE') {
      const token = generateToken(user);
      setTokenCookie(res, token);
      return res.status(201).json({
        message: 'ثبت‌نام با موفقیت انجام شد',
        user: { id: user.id, fullName: user.fullName, role: user.role },
      });
    }

    return res.status(201).json({
      message: 'ثبت‌نام ثبت شد. حساب شما پس از تایید سوپرادمین فعال می‌شود',
    });
  } catch (err) {
    next(err);
  }
}

// ورود کاربر با ایمیل و رمز عبور
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'ایمیل و رمز عبور الزامی هستند' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است' });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است' });
    }

    if (user.status === 'PENDING') {
      return res.status(403).json({ error: 'حساب شما هنوز توسط سوپرادمین تایید نشده است' });
    }

    if (user.status === 'REJECTED') {
      return res.status(403).json({ error: 'درخواست عضویت شما تایید نشد' });
    }

    const token = generateToken(user);
    setTokenCookie(res, token);
    return res.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        phone: user.phone,
        bio: user.bio,
      },
    });
  } catch (err) {
    next(err);
  }
}

// خروج: کوکی توکن پاک می‌شود (در سمت سرور توکن JWT بی‌حالتی است و فقط انقضای آن کار می‌کند)
async function logout(req, res) {
  clearTokenCookie(res);
  res.json({ message: 'خروج انجام شد' });
}

// اطلاعات کاربر لاگین‌شده بر اساس کوکی/توکن معتبر
async function getMe(req, res) {
  res.json({
    user: {
      id: req.user.id,
      fullName: req.user.fullName,
      email: req.user.email,
      role: req.user.role,
      phone: req.user.phone,
      bio: req.user.bio,
    },
  });
}

// کاربر می‌تواند اطلاعات پروفایل خودش را ویرایش کند
// محدودیت‌ها بر اساس نقش:
//   - STUDENT: فقط phone و bio قابل ویرایش است (نام قابل تغییر نیست تا از مسخره‌بازی جلوگیری شود)
//   - ADVISOR و SUPERADMIN: fullName، phone و bio قابل ویرایش است
async function updateMyProfile(req, res, next) {
  try {
    const { fullName, phone, bio } = req.body;
    const role = req.user.role;

    const data = {};

    // فقط مشاور و سوپرادمین می‌توانند نام خود را تغییر دهند
    // دانش‌آموز نمی‌تواند نامش را تغییر دهد (برای جلوگیری از مسخره‌بازی)
    if (fullName !== undefined) {
      if (role === 'STUDENT') {
        return res.status(403).json({
          error: 'دانش‌آموز نمی‌تواند نام خود را تغییر دهد. در صورت نیاز، با مشاور یا سوپرادمین تماس بگیرید.',
        });
      }
      const trimmedName = String(fullName).trim();
      if (trimmedName.length < 2) {
        return res.status(400).json({ error: 'نام باید حداقل ۲ کاراکتر باشد' });
      }
      if (trimmedName.length > 100) {
        return res.status(400).json({ error: 'نام نباید بیشتر از ۱۰۰ کاراکتر باشد' });
      }
      data.fullName = trimmedName;
    }

    // phone برای همه‌ی نقش‌ها قابل ویرایش است
    if (phone !== undefined) {
      try {
        data.phone = normalizePhone(phone);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // bio برای همه‌ی نقش‌ها قابل ویرایش است
    if (bio !== undefined) {
      try {
        data.bio = normalizeBio(bio);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'هیچ فیلدی برای به‌روزرسانی ارسال نشده' });
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        phone: true,
        bio: true,
      },
    });

    res.json({
      message: 'پروفایل به‌روزرسانی شد',
      user: updated,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, logout, getMe, updateMyProfile };
