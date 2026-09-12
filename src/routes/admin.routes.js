const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const {
  listPendingAdvisors,
  approveAdvisor,
  rejectAdvisor,
  listAdvisorsOverview,
} = require('../controllers/admin.controller');

// همه‌ی مسیرهای این فایل فقط برای سوپرادمین و بعد از ورود در دسترس هستند
router.use(authenticate, requireRole('SUPERADMIN'));

router.get('/advisors/pending', listPendingAdvisors);
router.post('/advisors/:id/approve', approveAdvisor);
router.post('/advisors/:id/reject', rejectAdvisor);
router.get('/advisors/overview', listAdvisorsOverview);

module.exports = router;
