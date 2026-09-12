const { verifyToken } = require('../utils/jwt');
const prisma = require('../config/prisma');

// این میان‌افزار مطمئن می‌شود کاربر توکن معتبر فرستاده، سپس اطلاعات کاربر را روی درخواست قرار می‌دهد
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'ورود لازم است' });
  }

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });

    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'حساب کاربری فعال نیست' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'توکن نامعتبر یا منقضی‌شده است' });
  }
}

// این تابع یک میان‌افزار می‌سازد که فقط اجازه‌ی عبور به نقش‌های مشخص‌شده را می‌دهد
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'دسترسی مجاز نیست' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
