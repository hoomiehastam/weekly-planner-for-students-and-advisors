const prisma = require('../config/prisma');

// این کنترلر همه‌ی عملیات مربوط به برنامه‌ی مطالعاتی را مدیریت می‌کند:
// ساخت، ویرایش کامل، مشاهده، و تغییر وضعیت آیتم‌ها.

// اعتبارسنجی ساده‌ی فرمت ساعت (HH:MM)؛ در صورت خالی بودن هم عبور می‌کند
function validateTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const v = String(value).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
    throw new Error('فرمت ساعت معتبر نیست؛ باید به شکل HH:MM باشد (مثل 08:30)');
  }
  return v;
}

// اعتبارسنجی روز هفته ۰ تا ۶
function validateDayOfWeek(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 6) {
    throw new Error('روز هفته باید بین ۰ (شنبه) تا ۶ (جمعه) باشد');
  }
  return n;
}

// یک برنامه‌ی مطالعاتی جدید می‌سازد؛ همراه با روزها و آیتم‌ها و تگ‌ها
// بدنه‌ی درخواست:
//   { title, note?, startsAt, expiresAt?, days: [{ dayOfWeek, items: [{ subject, description?, startTime?, endTime?, tags: [tagId] }] }] }
async function createPlan(req, res, next) {
  try {
    const { studentId, title, note, startsAt, expiresAt, days = [] } = req.body;

    if (!studentId || !title || !startsAt) {
      return res.status(400).json({ error: 'شناسه‌ی دانش‌آموز، عنوان و تاریخ شروع الزامی هستند' });
    }

    // اطمینان از اینکه این دانش‌آموز واقعاً به این مشاور متصل است
    const link = await prisma.advisorStudentLink.findFirst({
      where: { advisorId: req.user.id, studentId },
    });
    if (!link) {
      return res.status(403).json({ error: 'این دانش‌آموز به شما متصل نیست' });
    }

    // ساخت برنامه همراه با روزها و آیتم‌ها در یک تراکنش
    const plan = await prisma.studyPlan.create({
      data: {
        title: title.trim(),
        note: note ? note.trim() : null,
        studentId,
        advisorId: req.user.id,
        startsAt: new Date(startsAt),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        days: {
          create: days.map((d) => ({
            dayOfWeek: validateDayOfWeek(d.dayOfWeek),
            items: {
              create: (d.items || []).map((it, idx) => {
                const data = {
                  subject: it.subject?.trim() || '',
                  description: it.description ? it.description.trim() : null,
                  startTime: validateTime(it.startTime),
                  endTime: validateTime(it.endTime),
                  order: typeof it.order === 'number' ? it.order : idx,
                };
                if (Array.isArray(it.tags) && it.tags.length > 0) {
                  data.tags = {
                    create: it.tags.map((tagId) => ({ tagId })),
                  };
                }
                return data;
              }),
            },
          })),
        },
      },
      include: PLAN_INCLUDE,
    });

    res.status(201).json({ plan });
  } catch (err) {
    next(err);
  }
}

// ویرایش کامل یک برنامه‌ی موجود:
//  - عنوان، توضیح، بازه‌ی زمانی به‌روز می‌شود
//  - روزها و آیتم‌ها به‌صورت جایگزینی کامل (replace) ذخیره می‌شوند تا منطق ساده‌تر باشد
//  - آیتم‌هایی که در درخواست شناسه دارند، وضعیتشان حفظ می‌شود
async function updatePlan(req, res, next) {
  try {
    const { id } = req.params;
    const { title, note, startsAt, expiresAt, days = [] } = req.body;

    const existing = await prisma.studyPlan.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'برنامه‌ی مطالعاتی یافت نشد' });
    }
    if (existing.advisorId !== req.user.id && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({ error: 'این برنامه متعلق به شما نیست' });
    }

    // مرحله‌ی ۱: به‌روزرسانی فیلدهای بالایی برنامه
    const updatedPlanFields = {};
    if (title !== undefined) updatedPlanFields.title = String(title).trim();
    if (note !== undefined) updatedPlanFields.note = note ? String(note).trim() : null;
    if (startsAt !== undefined) updatedPlanFields.startsAt = new Date(startsAt);
    if (expiresAt !== undefined) {
      updatedPlanFields.expiresAt = expiresAt ? new Date(expiresAt) : null;
    }

    if (Object.keys(updatedPlanFields).length > 0) {
      await prisma.studyPlan.update({ where: { id }, data: updatedPlanFields });
    }

    // مرحله‌ی ۲: اگر days ارسال شده، کل روزها و آیتم‌ها را جایگزین می‌کنیم
    // این روش ساده‌تر است چون از مقایسه‌ی پیچیده‌ی آیتم‌به‌آیتم جلوگیری می‌کند
    if (Array.isArray(days)) {
      // اول وضعیت فعلی همه‌ی آیتم‌ها را نگه می‌داریم تا بتوانیم آیتم‌هایی که در درخواست
      // شناسه دارند و وضعیتشان DONE است را بعد از جایگزینی بازگردانیم
      const oldItems = await prisma.planItem.findMany({
        where: { day: { planId: id } },
        select: { id: true, status: true },
      });
      const oldStatusById = new Map(oldItems.map((it) => [it.id, it.status]));

      // پاک کردن همه‌ی روزها و آیتم‌های قبلی (cascade از PlanDay به PlanItem و PlanItemTag)
      await prisma.planDay.deleteMany({ where: { planId: id } });

      // ساخت دوباره‌ی روزها و آیتم‌ها
      if (days.length > 0) {
        await prisma.studyPlan.update({
          where: { id },
          data: {
            days: {
              create: days.map((d) => ({
                dayOfWeek: validateDayOfWeek(d.dayOfWeek),
                items: {
                  create: (d.items || []).map((it, idx) => {
                    const data = {
                      subject: it.subject?.trim() || '',
                      description: it.description ? it.description.trim() : null,
                      startTime: validateTime(it.startTime),
                      endTime: validateTime(it.endTime),
                      order: typeof it.order === 'number' ? it.order : idx,
                      // اگر آیتم شناسه داشت و در درخواست قبل DONE بوده، همان وضعیت را حفظ کن
                      status: it.id && oldStatusById.has(it.id) ? oldStatusById.get(it.id) : 'PENDING',
                    };
                    if (Array.isArray(it.tags) && it.tags.length > 0) {
                      data.tags = {
                        create: it.tags.map((tagId) => ({ tagId })),
                      };
                    }
                    return data;
                  }),
                },
              })),
            },
          },
        });
      }
    }

    const plan = await prisma.studyPlan.findUnique({
      where: { id },
      include: PLAN_INCLUDE,
    });

    res.json({ plan });
  } catch (err) {
    next(err);
  }
}

// لیست برنامه‌های فعال دانش‌آموز (همان دانش‌آموز لاگین‌شده)
async function getMyPlans(req, res, next) {
  try {
    const now = new Date();
    const plans = await prisma.studyPlan.findMany({
      where: {
        studentId: req.user.id,
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      },
      include: PLAN_INCLUDE,
      orderBy: { startsAt: 'desc' },
    });
    res.json({ plans });
  } catch (err) {
    next(err);
  }
}

// لیست همه‌ی برنامه‌های یک دانش‌آموز خاص برای مشاور
async function getPlansForStudent(req, res, next) {
  try {
    const { studentId } = req.params;

    const link = await prisma.advisorStudentLink.findFirst({
      where: { advisorId: req.user.id, studentId },
    });
    if (!link) {
      return res.status(403).json({ error: 'این دانش‌آموز به شما متصل نیست' });
    }

    const plans = await prisma.studyPlan.findMany({
      where: { studentId },
      include: PLAN_INCLUDE,
      orderBy: { startsAt: 'desc' },
    });
    res.json({ plans });
  } catch (err) {
    next(err);
  }
}

// دانش‌آموز وضعیت یک آیتم را تغییر می‌دهد (مثلاً به DONE)
async function updateItemStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['PENDING', 'DONE', 'SKIPPED'].includes(status)) {
      return res.status(400).json({ error: 'وضعیت معتبر نیست' });
    }

    // فقط آیتمی قابل تغییر است که متعلق به این دانش‌آموز باشد
    const item = await prisma.planItem.findFirst({
      where: { id, day: { plan: { studentId: req.user.id } } },
    });
    if (!item) {
      return res.status(404).json({ error: 'آیتم یافت نشد' });
    }

    const updated = await prisma.planItem.update({
      where: { id },
      data: { status },
    });

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
}

// حذف یک برنامه‌ی مطالعاتی (فقط مشاور صاحب برنامه یا سوپرادمین)
async function deletePlan(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await prisma.studyPlan.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'برنامه یافت نشد' });
    }
    if (existing.advisorId !== req.user.id && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({ error: 'این برنامه متعلق به شما نیست' });
    }

    await prisma.studyPlan.delete({ where: { id } });
    res.json({ message: 'برنامه حذف شد' });
  } catch (err) {
    next(err);
  }
}

// مدل‌های همراه (eager load) که در همه‌ی پاسخ‌های plan با هم برمی‌گردند
const PLAN_INCLUDE = {
  days: {
    orderBy: { dayOfWeek: 'asc' },
    include: {
      items: {
        orderBy: { order: 'asc' },
        include: { tags: { include: { tag: true } } },
      },
    },
  },
};

module.exports = {
  createPlan,
  updatePlan,
  getMyPlans,
  getPlansForStudent,
  updateItemStatus,
  deletePlan,
};
