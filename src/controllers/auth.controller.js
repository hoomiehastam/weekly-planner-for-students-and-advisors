const bcrypt = require('bcrypt');
const prisma = require('../config/prisma');
const { generateToken } = require('../utils/jwt');

const SALT_ROUNDS = 10;

// پیام راهنمای فرمت‌های قابل قبول شماره تماس ایران
const PHONE_FORMAT_HINT =
  'فرمت‌های قابل قبول: ۰۹۱۲۳۴۵۶۷۸۹، +۹۸۹۱۲۳۴۵۶۷۸۹، ۰۰۹۸۹۱۲۳۴۵۶۷۸۹، ۹۱۲۳۴۵۶۷۸۹';

// نرمال‌سازی شماره تماس بر اساس فرمت ایران
// فرمت‌های قابل قبول:
//   09123456789      (موبایل با ۰)
//   9123456789       (موبایل بدون ۰)
//   +989123456789    (با کد کشور +)
//   00989123456789   (با کد کشور ۰۰)
//   989123456789     (با کد کشور بدون +)
//   02112345678      (ثابت با ۰)
//   2112345678       (ثابت بدون ۰)
// خروجی همیشه به فرمت 09123456789 یا 02112345678 (با ۰ شروع می‌شود)
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

  // حذف همه‌ی کاراکترهای غیر عددی (فاصله، خط تیره، پرانتز و ...)
  // فقط + در ابتدا را نگه می‌داریم
  let hasPlus = normalized.startsWith('+');
  let digits = normalized.replace(/[^\d]/g, '');

  if (digits.length === 0) {
    throw new Error('شماره تماس خالی است. ' + PHONE_FORMAT_HINT);
  }

  // مدیریت پیشوندهای کد کشور ایران (۹۸)
  if (hasPlus) {
    // +989123456789 → 09123456789
    if (digits.startsWith('98')) {
      digits = '0' + digits.slice(2);
    } else {
      throw new Error('شماره با + شروع شده ولی کد کشور ۹۸ نیست. ' + PHONE_FORMAT_HINT);
    }
  } else if (digits.startsWith('0098')) {
    // 00989123456789 → 09123456789
    digits = '0' + digits.slice(4);
  } else if (digits.startsWith('98') && digits.length === 12) {
    // 989123456789 (12 رقم با 98 شروع می‌شود) → 09123456789
    digits = '0' + digits.slice(2);
  } else if (digits.length === 10 && digits.startsWith('9')) {
    // 9123456789 (موبایل بدون ۰) → 09123456789
    digits = '0' + digits;
  } else if (digits.length === 10 && !digits.startsWith('0')) {
    // 2112345678 (ثابت بدون ۰) → 02112345678
    digits = '0' + digits;
  }
  // در غیر این‌صورت، اگر با ۰ شروع شده باشد همان را نگه می‌داریم

  // اعتبارسنجی نهایی: باید ۱۱ رقم و با ۰ شروع شود
  if (digits.length !== 11 || !digits.startsWith('0')) {
    throw new Error('شماره تماس معتبر نیست. ' + PHONE_FORMAT_HINT);
  }

  // اعتبارسنجی پیشوندهای معتبر ایران:
  // موبایل: 09 + (1,0,3,2,9) — مثلاً 0912, 0910, 0935, 0920, 0990
  // ثابت: 0 + کد شهر — مثلاً 021 (تهران), 031 (اصفهان), 026 (کرج), 051 (مشهد)
  const mobilePattern = /^09\d{9}$/;       // 09123456789
  const landlinePattern = /^0\d{10}$/;    // 02112345678 (هر 11 رقمی با 0)

  if (!mobilePattern.test(digits) && !landlinePattern.test(digits)) {
    throw new Error('شماره تماس فرمت معتبری ندارد. ' + PHONE_FORMAT_HINT);
  }

  return digits;
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
