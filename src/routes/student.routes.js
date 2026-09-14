const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const {
  listMyStudents,
  getMyWeeklyGoal,
  setStudentWeeklyGoal,
  getMyAdvisor,
} = require('../controllers/student.controller');

// مشاور: فهرست دانش‌آموزهای خودش (شامل شماره تماس و توضیحات)
router.get('/mine', authenticate, requireRole('ADVISOR', 'SUPERADMIN'), listMyStudents);

// دانش‌آموز: دریافت هدف هفتگی خودش
router.get('/me/weekly-goal', authenticate, requireRole('STUDENT'), getMyWeeklyGoal);

// دانش‌آموز: دریافت اطلاعات مشاور خودش (نام، ایمیل، شماره تماس، توضیحات)
router.get('/me/advisor', authenticate, requireRole('STUDENT'), getMyAdvisor);

// مشاور: تنظیم هدف هفتگی برای یک دانش‌آموز
router.put('/:studentId/weekly-goal', authenticate, requireRole('ADVISOR', 'SUPERADMIN'), setStudentWeeklyGoal);

module.exports = router;
