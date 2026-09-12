const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const {
  createLog,
  getMyLogs,
  deleteLog,
  updateLog,
} = require('../controllers/studyLog.controller');

router.use(authenticate, requireRole('STUDENT'));

router.get('/mine', getMyLogs);
router.post('/', createLog);
router.put('/:id', updateLog);
router.delete('/:id', deleteLog);

module.exports = router;
