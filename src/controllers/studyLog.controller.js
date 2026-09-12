const prisma = require('../config/prisma');

// این کنترلر لاگ‌های مطالعه‌ی دانش‌آموز را مدیریت می‌کند:
// دانش‌آموز می‌تواند برای هر تگ (یا «سایر کارها») زمان و تعداد تست ثبت کند.

// اعتبارسنجی و نرمال‌سازی تاریخ به ابتدای روز (۰۰:۰۰ UTC)
function normalizeDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error('تاریخ معتبر نیست');
  }
  // تنظیم به ابتدای روز (به وقت محلی) برای اینکه مقایسه‌ی درست انجام شود
  const normalized = new Date(d);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

// ساخت یک لاگ جدید
// بدنه‌ی درخواست:
//   { tagId?: string|null, logDate: ISO string, minutes: number, testsTaken?: number|null, note?: string }
//   tagId=null یا حذف شود یعنی «سایر کارها»
async function createLog(req, res, next) {
  try {
    const { tagId = null, logDate, minutes, testsTaken = null, note = null } = req.body;

    if (!logDate) {
      return res.status(400).json({ error: 'تاریخ ثبت الزامی است' });
    }
    const mins = Number(minutes);
    if (!Number.isInteger(mins) || mins <= 0 || mins > 1440) {
      return res.status(400).json({ error: 'دقیقه باید عدد صحیح بین ۱ و ۱۴۴۰ باشد' });
    }

    // اگر tagId ارسال شده، مطمئن شو این تگ واقعاً وجود دارد
    if (tagId) {
      const tag = await prisma.tag.findUnique({ where: { id: tagId } });
      if (!tag) {
        return res.status(400).json({ error: 'تگ انتخاب‌شده یافت نشد' });
      }
    }

    // اعتبارسنجی testsTaken (اگر ارسال شده)
    let testsValue = null;
    if (testsTaken !== null && testsTaken !== undefined && testsTaken !== '') {
      const t = Number(testsTaken);
      if (!Number.isInteger(t) || t < 0) {
        return res.status(400).json({ error: 'تعداد تست باید عدد صحیح مثبت باشد' });
      }
      testsValue = t;
    }

    const log = await prisma.studyLog.create({
      data: {
        studentId: req.user.id,
        tagId: tagId || null,
        logDate: normalizeDate(logDate),
        minutes: mins,
        testsTaken: testsValue,
        note: note ? String(note).trim().slice(0, 280) : null,
      },
      include: { tag: true },
    });

    res.status(201).json({ log });
  } catch (err) {
    next(err);
  }
}

// گرفتن لاگ‌های دانش‌آموز؛ می‌توان با پارامترهای from و to فیلتر کرد
// مثال: GET /api/study-logs/mine?from=2024-06-01&to=2024-06-30
async function getMyLogs(req, res, next) {
  try {
    const { from, to } = req.query;
    const where = { studentId: req.user.id };
    if (from || to) {
      where.logDate = {};
      if (from) where.logDate.gte = normalizeDate(from);
      if (to) where.logDate.lte = normalizeDate(to);
    }

    const logs = await prisma.studyLog.findMany({
      where,
      include: { tag: true },
      orderBy: { logDate: 'desc' },
    });

    res.json({ logs });
  } catch (err) {
    next(err);
  }
}

// حذف یک لاگ (فقط مالک می‌تواند)
async function deleteLog(req, res, next) {
  try {
    const { id } = req.params;

    const log = await prisma.studyLog.findUnique({ where: { id } });
    if (!log) {
      return res.status(404).json({ error: 'لاگ یافت نشد' });
    }
    if (log.studentId !== req.user.id) {
      return res.status(403).json({ error: 'این لاگ متعلق به شما نیست' });
    }

    await prisma.studyLog.delete({ where: { id } });
    res.json({ message: 'لاگ حذف شد' });
  } catch (err) {
    next(err);
  }
}

// به‌روزرسانی یک لاگ (مثلاً برای اصلاح دقیقه یا تست)
async function updateLog(req, res, next) {
  try {
    const { id } = req.params;
    const { minutes, testsTaken, note, tagId, logDate } = req.body;

    const log = await prisma.studyLog.findUnique({ where: { id } });
    if (!log) {
      return res.status(404).json({ error: 'لاگ یافت نشد' });
    }
    if (log.studentId !== req.user.id) {
      return res.status(403).json({ error: 'این لاگ متعلق به شما نیست' });
    }

    const data = {};
    if (minutes !== undefined) {
      const mins = Number(minutes);
      if (!Number.isInteger(mins) || mins <= 0 || mins > 1440) {
        return res.status(400).json({ error: 'دقیقه باید عدد صحیح بین ۱ و ۱۴۴۰ باشد' });
      }
      data.minutes = mins;
    }
    if (testsTaken !== undefined) {
      if (testsTaken === null || testsTaken === '' || testsTaken === undefined) {
        data.testsTaken = null;
      } else {
        const t = Number(testsTaken);
        if (!Number.isInteger(t) || t < 0) {
          return res.status(400).json({ error: 'تعداد تست باید عدد صحیح مثبت باشد' });
        }
        data.testsTaken = t;
      }
    }
    if (note !== undefined) {
      data.note = note ? String(note).trim().slice(0, 280) : null;
    }
    if (tagId !== undefined) {
      // tagId می‌تواند null باشد برای «سایر کارها»
      if (tagId) {
        const tag = await prisma.tag.findUnique({ where: { id: tagId } });
        if (!tag) {
          return res.status(400).json({ error: 'تگ یافت نشد' });
        }
      }
      data.tagId = tagId || null;
    }
    if (logDate !== undefined) {
      data.logDate = normalizeDate(logDate);
    }

    const updated = await prisma.studyLog.update({
      where: { id },
      data,
      include: { tag: true },
    });

    res.json({ log: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = { createLog, getMyLogs, deleteLog, updateLog };
