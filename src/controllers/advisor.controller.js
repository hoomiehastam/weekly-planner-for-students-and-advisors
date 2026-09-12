const prisma = require('../config/prisma');

// این فهرست بدون نیاز به ورود در دسترس است، چون دانش‌آموز باید قبل از ثبت‌نام مشاورش را انتخاب کند
async function listActiveAdvisors(req, res, next) {
  try {
    const advisors = await prisma.user.findMany({
      where: { role: { in: ['ADVISOR', 'SUPERADMIN'] }, status: 'ACTIVE' },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
    res.json({ advisors });
  } catch (err) {
    next(err);
  }
}

module.exports = { listActiveAdvisors };
