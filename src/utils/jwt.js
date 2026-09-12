const jwt = require('jsonwebtoken');

// یک توکن جدید برای کاربر می‌سازد؛ شناسه و نقش کاربر داخل توکن قرار می‌گیرد
function generateToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// یک توکن را بررسی می‌کند و در صورت معتبر بودن محتوایش را برمی‌گرداند
function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { generateToken, verifyToken };
