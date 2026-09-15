const express = require('express');
const router = express.Router();
const { register, login, updateMyProfile } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.post('/register', register);
router.post('/login', login);
router.put('/me', authenticate, updateMyProfile);

module.exports = router;
