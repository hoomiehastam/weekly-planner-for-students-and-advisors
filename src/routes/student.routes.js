const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const {
  listMyStudents,
  getMyWeeklyGoal,
  setStudentWeeklyGoal,
} = require('../controllers/student.controller');

// مشاور: فهرست دانش‌آموزهای خودش
router.get('/mine', authenticate, requireRole('ADVISOR', 'SUPERADMIN'), listMyStudents);

// دانش‌آموز: دریافت هدف هفتگی خودش
router.get('/me/weekly-goal', authenticate, requireRole('STUDENT'), getMyWeeklyGoal);

// مشاور: تنظیم هدف هفتگی برای یک دانش‌آموز
router.put('/:studentId/weekly-goal', authenticate, requireRole('ADVISOR', 'SUPERADMIN'), setStudentWeeklyGoal);

module.exports = router;
