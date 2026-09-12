const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { listTags, createTag } = require('../controllers/tag.controller');

router.use(authenticate, requireRole('ADVISOR', 'SUPERADMIN'));

router.get('/', listTags);
router.post('/', createTag);

module.exports = router;
