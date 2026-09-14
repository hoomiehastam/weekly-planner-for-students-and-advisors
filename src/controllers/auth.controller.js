const bcrypt = require('bcrypt');
const prisma = require('../config/prisma');
const { generateToken } = require('../utils/jwt');

const SALT_ROUNDS = 10;

// پیام راهنمای فرمت‌های قابل قبول شماره تماس ایران
const PHONE_FORMAT_HINT =
  'فرمت‌های قابل قبول:\n' +
  '• موبایل با ۰: ۰۹۱۲۳۴۵۶۷۸۹ (۱۱ رقم)\n' +
  '• موبایل بدون ۰: ۹۱۲۳۴۵۶۷۸۹ (۱۰ رقم)\n' +
  '• با کد کشور: +۹۸۹۱۲۳۴۵۶۷۸۹ یا ۰۰۹۸۹۱۲۳۴۵۶۷۸۹\n' +
  '• ثابت با ۰: ۰۲۱۱۲۳۴۵۶۷۸ (۱۱ رقم)';

// نرمال‌سازی شماره تماس بر اساس فرمت ایران
// برخلاف نسخه‌ی قبلی، به‌جای یک چک کلیِ طول، هر فرمت را جداگانه اعتبارسنجی می‌کند
// و در صورت خطا، دقیقاً می‌گوید کدام فرمت با چه مشکلی روبه‌رو شده.
//
// فرمت‌های قابل قبول و محدودیت‌های هرکدام:
//   1. 09XXXXXXXXX   — ۱۱ رقم، شروع با ۰، ششمین رقم ۹ (موبایل) یا غیر ۹ (ثابت)
//   2. 9XXXXXXXXX    — ۱۰ رقم، شروع با ۹ (موبایل بدون ۰)
//   3. +989XXXXXXXXX — +۹۸ + ۱۰ رقم شروع با ۹ (موبایل بین‌المللی)
//   4. +98XXXXXXXXX  — +۹۸ + ۱۰ رقم شروع با کد شهر (ثابت بین‌المللی)
//   5. 00989XXXXXXXXX — ۰۰۹۸ + ۱۰ رقم (بین‌المللی با ۰۰۹۸)
//   6. 989XXXXXXXXX  — ۹۸ + ۱۰ رقم (بدون +)
//   7. XXXXXXXXXX     — ۱۰ رقم، شروع با کد شهر (ثابت بدون ۰)
function normalizePhone(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  // تبدیل اعداد فارسی و عربی به انگلیسی
  const faDigits = '۰۱۲۳۴۵۶۷۸۹';
  const arDigits = '٠١٢٣٤٥٦٧٨٩';
  let normalized = '';
  for (const ch of trimmed) {
    const faIdx = faDigits.indexOf(ch);
    const arIdx = arDigits.indexOf(ch);
    if (faIdx >= 0) normalized += String(faIdx);
    else if (arIdx >= 0) normalized += String(arIdx);
    else normalized += ch;
  }

  // تشخیص وجود + در ابتدا و استخراج فقط اعداد
  const hasPlus = normalized.startsWith('+');
  const digits = normalized.replace(/[^\d]/g, '');

  if (digits.length === 0) {
    throw new Error('شماره تماس خالی است. ' + PHONE_FORMAT_HINT);
  }

  let result;

  // ---------- فرمت‌های با کد کشور ----------
  if (hasPlus) {
    // +989XXXXXXXXX یا +98XXXXXXXXX
    if (!digits.startsWith('98')) {
      throw new Error(
        'شماره با + شروع شده ولی کد کشور ۹۸ نیست. ' + PHONE_FORMAT_HINT
      );
    }
    const nationalPart = digits.slice(2); // بعد از 98
    if (nationalPart.length !== 10) {
      throw new Error(
        `شماره با +۹۸ باید ۱۰ رقم بعد از کد کشور داشته باشد، ولی ${toFa(nationalPart.length)} رقم وارد شده. ` +
        PHONE_FORMAT_HINT
      );
    }
    // nationalPart باید یا با 9 شروع شود (موبایل) یا با کد شهر (ثابت)
    // در هر دو حالت، خروجی 0 + nationalPart است
    result = '0' + nationalPart;
  } else if (digits.startsWith('0098')) {
    // 00989XXXXXXXXX یا 0098XXXXXXXXX
    const nationalPart = digits.slice(4); // بعد از 0098
    if (nationalPart.length !== 10) {
      throw new Error(
        `شماره با ۰۰۹۸ باید ۱۰ رقم بعد از کد کشور داشته باشد، ولی ${toFa(nationalPart.length)} رقم وارد شده. ` +
        PHONE_FORMAT_HINT
      );
    }
    result = '0' + nationalPart;
  } else if (digits.startsWith('98') && digits.length === 12) {
    // 989XXXXXXXXX (بدون +، ۱۲ رقم)
    const nationalPart = digits.slice(2);
    if (nationalPart.length !== 10) {
      throw new Error(
        `شماره با ۹۸ باید ۱۰ رقم بعد از کد کشور داشته باشد. ` + PHONE_FORMAT_HINT
      );
    }
    result = '0' + nationalPart;
  }
  // ---------- فرمت‌های داخلی ----------
  else if (digits.startsWith('0')) {
    // 0XXXXXXXXX — باید دقیقاً ۱۱ رقم باشد
    if (digits.length !== 11) {
      throw new Error(
        `شماره با ۰ باید ۱۱ رقم باشد، ولی ${toFa(digits.length)} رقم وارد شده. ` +
        PHONE_FORMAT_HINT
      );
    }
    result = digits;
  } else if (digits.startsWith('9') && digits.length === 10) {
    // 9XXXXXXXXX — موبایل بدون ۰
    result = '0' + digits;
  } else if (digits.length === 10) {
    // XXXXXXXXXX — ثابت بدون ۰ (شروع با کد شهر مثل 21، 31، ...)
    result = '0' + digits;
  } else {
    // هیچ فرمت شناخته‌شده‌ای تطابق نکرد
    throw new Error(
      `شماره تماس با هیچ فرمت قابل قبولی تطابق ندارد (${toFa(digits.length)} رقم). ` +
      PHONE_FORMAT_HINT
    );
  }

  // اعتبارسنجی نهایی خروجی: باید ۱۱ رقم و با ۰ شروع شود
  if (result.length !== 11 || !result.startsWith('0')) {
    throw new Error(
      'خروجی نرمال‌سازی معتبر نیست. ' + PHONE_FORMAT_HINT
    );
  }

  return result;
}

// تبدیل اعداد انگلیسی به فارسی برای پیام‌های خطا
function toFa(n) {
  const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(n).replace(/[0-9]/g, (d) => FA[Number(d)]);
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

module.exports = { register, login, updateMyProfile, normalizePhone, normalizeBio };
