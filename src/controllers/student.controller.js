const prisma = require('../config/prisma');

// فهرست دانش‌آموزهایی که به همین مشاور متصل هستند
async function listMyStudents(req, res, next) {
  try {
    const links = await prisma.advisorStudentLink.findMany({
      where: { advisorId: req.user.id },
      include: { student: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    // هدف هفتگی هم در پاسخ برمی‌گردد تا فرانت‌اند بلافاصله نمایش دهد
    const students = links.map((link) => ({
      ...link.student,
      weeklyGoalMinutes: link.weeklyGoalMinutes,
    }));
    res.json({ students });
  } catch (err) {
    next(err);
  }
}

// دریافت هدف هفتگی دانش‌آموز (برای خودش)
async function getMyWeeklyGoal(req, res, next) {
  try {
    const link = await prisma.advisorStudentLink.findFirst({
      where: { studentId: req.user.id },
      select: { weeklyGoalMinutes: true },
    });
    res.json({ weeklyGoalMinutes: link?.weeklyGoalMinutes || null });
  } catch (err) {
    next(err);
  }
}

// مشاور هدف هفتگی را برای یکی از دانش‌آموزهای خودش تنظیم می‌کند
async function setStudentWeeklyGoal(req, res, next) {
  try {
    const { studentId } = req.params;
    const { weeklyGoalMinutes } = req.body;

    if (
      weeklyGoalMinutes === null ||
      weeklyGoalMinutes === undefined ||
      !Number.isInteger(weeklyGoalMinutes) ||
      weeklyGoalMinutes < 0 ||
      weeklyGoalMinutes > 7 * 24 * 60 // نهایتاً ۷ روز × ۲۴ ساعت
    ) {
      return res.status(400).json({ error: 'هدف هفتگی نامعتبر است (دقیقه، بین ۰ و ۱۰۰۸۰)' });
    }

    const link = await prisma.advisorStudentLink.findFirst({
      where: { advisorId: req.user.id, studentId },
    });
    if (!link) {
      return res.status(403).json({ error: 'این دانش‌آموز به شما متصل نیست' });
    }

    await prisma.advisorStudentLink.update({
      where: { id: link.id },
      data: { weeklyGoalMinutes },
    });

    res.json({ message: 'هدف هفتگی به‌روزرسانی شد', weeklyGoalMinutes });
  } catch (err) {
    next(err);
  }
}

module.exports = { listMyStudents, getMyWeeklyGoal, setStudentWeeklyGoal };
