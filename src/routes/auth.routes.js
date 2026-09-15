const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { register, login, updateMyProfile } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

// محدودیت نرخ برای login — جلوگیری از brute-force
// حداکثر ۵ تلاش در ۱۵ دقیقه از هر IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // ۱۵ دقیقه
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تلاش‌های ورود بیش از حد. لطفاً ۱۵ دقیقه دیگر تلاش کنید.' },
});

// محدودیت نرخ برای register — جلوگیری از ساخت حساب خودکار
// حداکثر ۳ تلاش در ساعت از هر IP
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // ۱ ساعت
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تلاش‌های ثبت‌نام بیش از حد. لطفاً یک ساعت دیگر تلاش کنید.' },
});

// محدودیت ملایم‌تر برای ویرایش پروفایل — ۲۰ درخواست در ساعت
const profileLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'درخواست‌های بیش از حد. لطفاً بعداً تلاش کنید.' },
});

router.post('/login', loginLimiter, login);
router.post('/register', registerLimiter, register);
router.put('/me', authenticate, profileLimiter, updateMyProfile);

module.exports = router;
