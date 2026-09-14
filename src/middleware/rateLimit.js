const rateLimit = require('express-rate-limit');

const MINUTE = 60 * 1000;

// محدودکننده برای ورود و ثبت‌نام تا از حمله‌ی بروت‌فورس و ساخت حساب‌های بی‌مورد جلوگیری شود.
// محدودیت بر اساس IP است؛ در محیط تولید اگر پشت یک پراکسی یا لودبالانسر هستید،
// باید `app.set('trust proxy', ...)` را نیز تنظیم کنید تا آدرس IP صحیح گرفته شود.

const loginLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'تعداد دفعات تلاش برای ورود بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
    });
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * MINUTE,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'تعداد ثبت‌نام از این آدرس بیش از حد مجاز است. بعداً تلاش کنید.',
    });
  },
});

// حفاظت سبک برای مسیرهای مدیریتی سوپرادمین
const adminLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'تعداد درخواست بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
    });
  },
});

module.exports = { loginLimiter, registerLimiter, adminLimiter };