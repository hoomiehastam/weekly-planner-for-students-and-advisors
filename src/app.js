const express = require('express');
const cors = require('cors');

const app = express();

// اجازه‌ی تعیین دامنه‌های مجاز از طریق متغیر محیطی CORS_ORIGIN (با کاما جدا می‌شوند).
// اگر تنظیم نشده باشد، درخواست‌ها از هر دامنه‌ای پذیرفته می‌شوند (حالت توسعه).
// در محیط تولید حتماً مقدارش را بده؛ مثلاً:
//   CORS_ORIGIN="https://planner.example.com,http://localhost:5173"
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // درخواست‌های غیرمرورگری (ابزارها، سرورها) origin ندارند؛ اجازه بده
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      const err = new Error('این دامنه مجاز نیست');
      err.status = 403;
      return cb(err);
    },
  })
);
app.use(express.json());

// اندپوینت سلامت سرور - برای اطمینان از بالا بودن سرویس و اتصال درست
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'konkur-backend' });
});

// مسیرهای فاز یک: ثبت‌نام و ورود، فهرست عمومی مشاوران، و بخش مدیریت سوپرادمین
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/advisors', require('./routes/advisor.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/tags', require('./routes/tag.routes'));
app.use('/api/plans', require('./routes/plan.routes'));
app.use('/api/quotes', require('./routes/quote.routes'));
app.use('/api/students', require('./routes/student.routes'));
app.use('/api/reminders', require('./routes/reminder.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/exams', require('./routes/exam.routes'));

// هندلر ۴۰۴ برای مسیرهای تعریف‌نشده
app.use((req, res) => {
  res.status(404).json({ error: 'مسیر مورد نظر یافت نشد' });
});

// هندلر مرکزی خطا - هر throw ناگهانی در route ها اینجا گرفته می‌شود
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'خطای داخلی سرور رخ داد',
  });
});

module.exports = app;
