const express = require('express');
const router = express.Router();
const {
  register,
  login,
  logout,
  getMe,
  updateMyProfile,
} = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate, schemas } = require('../utils/validators');

// محدودیت نرخ روی کل مسیر login/register در app.js اعمال شده است

router.post('/register', validate(schemas.register), register);
router.post('/login', validate(schemas.login), login);
router.post('/logout', logout);

// مسیرهای نیازمند ورود
router.get('/me', authenticate, getMe);
router.put('/me', authenticate, validate(schemas.profile), updateMyProfile);

module.exports = router;
