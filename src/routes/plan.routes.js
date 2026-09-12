const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const {
  createPlan,
  updatePlan,
  deletePlan,
  getMyPlans,
  getPlansForStudent,
  updateItemStatus,
} = require('../controllers/plan.controller');

router.use(authenticate);

// این دو مسیر فقط برای دانش‌آموز است
router.get('/mine', requireRole('STUDENT'), getMyPlans);
router.patch('/items/:id/status', requireRole('STUDENT'), updateItemStatus);

// این چهار مسیر فقط برای مشاور است
router.post('/', requireRole('ADVISOR', 'SUPERADMIN'), createPlan);
router.put('/:id', requireRole('ADVISOR', 'SUPERADMIN'), updatePlan);
router.delete('/:id', requireRole('ADVISOR', 'SUPERADMIN'), deletePlan);
router.get('/student/:studentId', requireRole('ADVISOR', 'SUPERADMIN'), getPlansForStudent);

module.exports = router;
