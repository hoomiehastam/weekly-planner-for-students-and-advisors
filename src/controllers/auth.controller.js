const bcrypt = require('bcrypt');
const prisma = require('../config/prisma');
const { generateToken } = require('../utils/jwt');

const SALT_ROUNDS = 10;

// نرمال‌سازی شماره تماس: حذف فاصله‌ها و کاراکترهای اضافی، فقط اعداد و + در ابتدا
function normalizePhone(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  // اگر با + شروع شد، فقط اعداد بعدش را نگه دار؛ در غیر این‌صورت فقط اعداد را نگه دار
  const cleaned = trimmed.replace(/[^\d+]/g, '');
  // حداقل طول منطقی برای شماره تلفن
  if (cleaned.length < 6) {
    throw new Error('شماره تماس معتبر نیست');
  }
  return cleaned;
}

// اعتبارسنجی ساده‌ی توضیحات: محدود به ۵۰۰ کاراکتر
function normalizeBio(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) {
    throw new Error('توضیحات نباید بیشتر از ۵۰۰ کاراکتر باشد');
  }
  return trimmed;
}

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

    // نرمال‌سازی شماره تماس و توضیحات
    let phoneValue = null;
    let bioValue = null;
    try {
      phoneValue = normalizePhone(phone);
      bioValue = normalizeBio(bio);
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

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

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
      return res.status(201).json({
        message: 'ثبت‌نام با موفقیت انجام شد',
        token,
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
    return res.json({
      token,
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

module.exports = { register, login };
