const prisma = require('../config/prisma');

// فهرست مشاورانی که هنوز منتظر تایید هستند
// شامل شماره تماس و توضیحات تا سوپرادمین با آگاهی کامل تصمیم بگیرد
async function listPendingAdvisors(req, res, next) {
  try {
    const advisors = await prisma.user.findMany({
      where: { role: 'ADVISOR', status: 'PENDING' },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        bio: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ advisors });
  } catch (err) {
    next(err);
  }
}

// تایید یک مشاور: وضعیتش به فعال تغییر می‌کند
async function approveAdvisor(req, res, next) {
  try {
    const { id } = req.params;
    const advisor = await prisma.user.findFirst({ where: { id, role: 'ADVISOR' } });

    if (!advisor) {
      return res.status(404).json({ error: 'مشاور یافت نشد' });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });

    res.json({ message: 'مشاور تایید شد', advisor: { id: updated.id, fullName: updated.fullName } });
  } catch (err) {
    next(err);
  }
}

// رد یک مشاور: وضعیتش به رد شده تغییر می‌کند
async function rejectAdvisor(req, res, next) {
  try {
    const { id } = req.params;
    const advisor = await prisma.user.findFirst({ where: { id, role: 'ADVISOR' } });

    if (!advisor) {
      return res.status(404).json({ error: 'مشاور یافت نشد' });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { status: 'REJECTED' },
    });

    res.json({ message: 'مشاور رد شد', advisor: { id: updated.id, fullName: updated.fullName } });
  } catch (err) {
    next(err);
  }
}

// نمای کلی سوپرادمین: هر مشاور و تعداد دانش‌آموزانش
// شامل شماره تماس مشاور و دانش‌آموزان برای ارتباط
async function listAdvisorsOverview(req, res, next) {
  try {
    const advisors = await prisma.user.findMany({
      where: { role: { in: ['ADVISOR', 'SUPERADMIN'] }, status: 'ACTIVE' },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        bio: true,
        asAdvisorLinks: {
          select: {
            student: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { fullName: 'asc' },
    });
    res.json({ advisors });
  } catch (err) {
    next(err);
  }
}

module.exports = { listPendingAdvisors, approveAdvisor, rejectAdvisor, listAdvisorsOverview };
