const express = require('express');
const router = express.Router();
const { register, login, updateMyProfile } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimit');

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.put('/me', authenticate, updateMyProfile);

module.exports = router;
