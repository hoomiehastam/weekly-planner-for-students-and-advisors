const prisma = require('../config/prisma');

// این کنترلر همه‌ی عملیات مربوط به آزمون‌ها را مدیریت می‌کند:
// ساخت، مشاهده، شروع، ارسال پاسخ، و نمره‌دهی.

// اعتبارسنجی و آماده‌سازی سؤالات آزمون.
// اگر سؤال‌ها نامعتبر باشند یا خالی باشند، TypeError پرتاب می‌شود (با پیام فارسی).
// در غیر این‌صورت آرایه‌ی آماده‌ی insert برمی‌گرداند.
function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('حداقل یک سؤال وارد کنید');
  }

  return questions.map((q, i) => {
    if (!q || !['MULTIPLE_CHOICE', 'DESCRIPTIVE'].includes(q.type)) {
      throw new Error(`نوع سؤال ${i + 1} معتبر نیست`);
    }
    // متن یا عکس حداقل یکی باید باشد
    const hasText = q.text && String(q.text).trim();
    const hasImage = q.imageUrl && String(q.imageUrl).trim();
    if (!hasText && !hasImage) {
      throw new Error(`سؤال ${i + 1} باید متن یا عکس داشته باشد`);
    }
    if (q.type === 'MULTIPLE_CHOICE') {
      if (!q.options || typeof q.options !== 'string') {
        throw new Error(`گزینه‌های سؤال ${i + 1} الزامی است (با | جدا کنید)`);
      }
      const opts = q.options.split('|').map((s) => s.trim()).filter(Boolean);
      if (opts.length < 2 || opts.length > 6) {
        throw new Error(`سؤال ${i + 1} باید بین ۲ تا ۶ گزینه داشته باشد`);
      }
      if (!q.correctOption || q.correctOption < 1 || q.correctOption > opts.length) {
        throw new Error(`گزینه‌ی صحیح سؤال ${i + 1} معتبر نیست`);
      }
    }
    return {
      type: q.type,
      text: hasText ? String(q.text).trim() : null,
      options: q.type === 'MULTIPLE_CHOICE' ? q.options : null,
      correctOption: q.type === 'MULTIPLE_CHOICE' ? q.correctOption : null,
      points: typeof q.points === 'number' ? q.points : 1,
      imageUrl: q.imageUrl || null,
      order: i,
    };
  });
}

// مهلت پایان آزمون؛ از زمان شروعِ ارسال + مدت آزمون (به میلی‌ثانیه عمل می‌کند)
function getDeadline(submission, exam) {
  const startedAt = new Date(submission.startedAt).getTime();
  const durationMs = Number(exam.durationMinutes) * 60 * 1000;
  return new Date(startedAt + durationMs);
}

// نهایی‌سازی یک ارسال: محاسبه‌ی نمره‌ی تستی، به‌روزرسانی پاسخ‌ها، و تغییر وضعیت.
// اگر از قبل نهایی شده باشد، without change برمی‌گردد.
// اگر سؤال تشریحی وجود داشته باشد وضعیت SUBMITTED می‌شود (تا مشاور نمره بدهد)،
// در غیر این صورت GRADED (نمره‌ی خودکار تثبیت می‌شود).
async function finalizeSubmission(submissionId) {
  const submission = await prisma.examSubmission.findUnique({
    where: { id: submissionId },
    include: { exam: { include: { questions: true } }, answers: true },
  });
  if (!submission) {
    throw new Error('ارسال آزمون یافت نشد');
  }
  if (submission.status !== 'IN_PROGRESS') {
    return { already: true, submission };
  }

  let totalScore = 0;
  let maxScore = 0;
  let hasDescriptive = false;
  const pendingAnswerUpdates = [];
  for (const q of submission.exam.questions) {
    maxScore += q.points || 1;
    if (q.type === 'DESCRIPTIVE') {
      hasDescriptive = true;
    } else if (q.type === 'MULTIPLE_CHOICE') {
      const answer = submission.answers.find((a) => a.questionId === q.id);
      if (answer && answer.selectedOption === q.correctOption) {
        totalScore += q.points || 1;
        if (answer.score !== q.points) {
          pendingAnswerUpdates.push({ id: answer.id, score: q.points || 1 });
        }
      } else if (answer && answer.score !== 0) {
        pendingAnswerUpdates.push({ id: answer.id, score: 0 });
      }
    }
  }
  for (const u of pendingAnswerUpdates) {
    await prisma.examAnswer.update({ where: { id: u.id }, data: { score: u.score } });
  }

  const finalStatus = hasDescriptive ? 'SUBMITTED' : 'GRADED';
  const gradedAt = hasDescriptive ? null : new Date();
  const updated = await prisma.examSubmission.update({
    where: { id: submissionId },
    data: {
      status: finalStatus,
      submittedAt: new Date(),
      totalScore,
      maxScore,
      gradedAt,
    },
  });

  return {
    updated,
    autoScore: totalScore,
    maxScore,
    autoGraded: !hasDescriptive,
    hasDescriptive,
  };
}

// ====== توابع مشاور ======

// ساخت آزمون جدید برای یک دانش‌آموز
// بدنه‌ی درخواست:
//   {
//     title, description?, studentId, scheduledAt (ISO),
//     durationMinutes, visibleToStudent (bool),
//     questions: [{ type: 'MULTIPLE_CHOICE'|'DESCRIPTIVE', text, options?, correctOption?, points? }]
//   }
async function createExam(req, res, next) {
  try {
    const {
      title,
      description,
      studentId,
      scheduledAt,
      durationMinutes,
      visibleToStudent = false,
      visibleFrom,
      questions = [],
    } = req.body;

    if (!title || !studentId || !scheduledAt || !durationMinutes) {
      return res.status(400).json({ error: 'عنوان، دانش‌آموز، زمان شروع و مدت الزامی هستند' });
    }

    // اطمینان از اینکه دانش‌آموز به این مشاور متصل است
    const link = await prisma.advisorStudentLink.findFirst({
      where: { advisorId: req.user.id, studentId },
    });
    if (!link) {
      return res.status(403).json({ error: 'این دانش‌آموز به شما متصل نیست' });
    }

    const mins = Number(durationMinutes);
    if (!Number.isInteger(mins) || mins < 1 || mins > 600) {
      return res.status(400).json({ error: 'مدت آزمون باید بین ۱ و ۶۰۰ دقیقه باشد' });
    }

    // اعتبارسنجی و آماده‌سازی سؤال‌ها
    let preparedQuestions;
    try {
      preparedQuestions = validateQuestions(questions);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const exam = await prisma.exam.create({
      data: {
        title: title.trim(),
        description: description ? description.trim() : null,
        studentId,
        advisorId: req.user.id,
        scheduledAt: new Date(scheduledAt),
        durationMinutes: mins,
        visibleToStudent: !!visibleToStudent,
        // اگر visibleToStudent=false و visibleFrom ارسال شده، از آن استفاده کن؛ در غیر این‌صورت null (از scheduledAt استفاده می‌شود)
        visibleFrom: visibleFrom ? new Date(visibleFrom) : null,
        questions: {
          create: preparedQuestions,
        },
      },
      include: EXAM_INCLUDE_FOR_ADVISOR,
    });

    res.status(201).json({ exam });
  } catch (err) {
    next(err);
  }
}

// به‌روزرسانی آزمون (فقط قبل از شروع)
async function updateExam(req, res, next) {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      scheduledAt,
      durationMinutes,
      visibleToStudent,
      visibleFrom,
      questions,
    } = req.body;

    const existing = await prisma.exam.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'آزمون یافت نشد' });
    }
    if (existing.advisorId !== req.user.id && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({ error: 'این آزمون متعلق به شما نیست' });
    }

    // بررسی اینکه هنوز ارسالی وجود ندارد
    const submissionCount = await prisma.examSubmission.count({ where: { examId: id } });
    if (submissionCount > 0) {
      return res.status(400).json({ error: 'بعد از شروع آزمون توسط دانش‌آموز، امکان ویرایش وجود ندارد' });
    }

    const data = {};
    if (title !== undefined) data.title = String(title).trim();
    if (description !== undefined) data.description = description ? String(description).trim() : null;
    if (scheduledAt !== undefined) data.scheduledAt = new Date(scheduledAt);
    if (durationMinutes !== undefined) {
      const mins = Number(durationMinutes);
      if (!Number.isInteger(mins) || mins < 1 || mins > 600) {
        return res.status(400).json({ error: 'مدت آزمون باید بین ۱ و ۶۰۰ دقیقه باشد' });
      }
      data.durationMinutes = mins;
    }
    if (visibleToStudent !== undefined) data.visibleToStudent = !!visibleToStudent;
    if (visibleFrom !== undefined) {
      data.visibleFrom = visibleFrom ? new Date(visibleFrom) : null;
    }

    if (Object.keys(data).length > 0) {
      await prisma.exam.update({ where: { id }, data });
    }

    // اگر سؤال‌ها ارسال شده، جایگزینی کامل.
    // ابتدا اعتبارسنجی می‌شوند؛ اگر نامعتبر باشند، چیزی حذف نمی‌شود.
    if (Array.isArray(questions)) {
      let preparedQuestions;
      try {
        preparedQuestions = validateQuestions(questions);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      await prisma.examQuestion.deleteMany({ where: { examId: id } });
      if (preparedQuestions.length > 0) {
        await prisma.examQuestion.createMany({
          data: preparedQuestions.map((q) => ({ examId: id, ...q })),
        });
      }
    }

    const exam = await prisma.exam.findUnique({
      where: { id },
      include: EXAM_INCLUDE_FOR_ADVISOR,
    });

    res.json({ exam });
  } catch (err) {
    next(err);
  }
}

// حذف آزمون
async function deleteExam(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.exam.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'آزمون یافت نشد' });
    }
    if (existing.advisorId !== req.user.id && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({ error: 'این آزمون متعلق به شما نیست' });
    }

    await prisma.exam.delete({ where: { id } });
    res.json({ message: 'آزمون حذف شد' });
  } catch (err) {
    next(err);
  }
}

// گرفتن همه‌ی آزمون‌های یک دانش‌آموز (برای مشاور)
async function getExamsForStudent(req, res, next) {
  try {
    const { studentId } = req.params;

    const link = await prisma.advisorStudentLink.findFirst({
      where: { advisorId: req.user.id, studentId },
    });
    if (!link) {
      return res.status(403).json({ error: 'این دانش‌آموز به شما متصل نیست' });
    }

    const exams = await prisma.exam.findMany({
      where: { studentId },
      include: EXAM_INCLUDE_FOR_ADVISOR,
      orderBy: { scheduledAt: 'desc' },
    });

    res.json({ exams });
  } catch (err) {
    next(err);
  }
}

// ====== توابع دانش‌آموز ======

// گرفتن همه‌ی آزمون‌های دانش‌آموز (فقط آن‌هایی که visible هستند یا زمانش فرا رسیده)
async function getMyExams(req, res, next) {
  try {
    const now = new Date();
    // همه‌ی آزمون‌های دانش‌آموز را می‌گیریم و در JS فیلتر می‌کنیم، چون منطق visibility پیچیده است
    const allExams = await prisma.exam.findMany({
      where: { studentId: req.user.id },
      include: {
        questions: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            type: true,
            text: true,
            options: true,
            points: true,
            order: true,
            imageUrl: true,
          },
        },
        submissions: {
          where: { studentId: req.user.id },
          include: { answers: true },
        },
      },
      orderBy: { scheduledAt: 'desc' },
    });

    // فیلتر visibility:
    // - اگر visibleToStudent=true → همیشه نمایش بده
    // - اگر visibleToStudent=false و visibleFrom=null → فقط اگه scheduledAt <= now
    // - اگر visibleToStudent=false و visibleFrom!=null → فقط اگه visibleFrom <= now
    const exams = allExams.filter((exam) => {
      if (exam.visibleToStudent) return true;
      const showTime = exam.visibleFrom || exam.scheduledAt;
      return showTime <= now;
    });

    res.json({ exams });
  } catch (err) {
    next(err);
  }
}

// شروع یا از سرگیری آزمون — یک submission می‌سازد یا موجود را برمی‌گرداند
async function startExam(req, res, next) {
  try {
    const { id } = req.params; // examId

    const exam = await prisma.exam.findUnique({
      where: { id },
      include: { questions: { orderBy: { order: 'asc' } } },
    });

    if (!exam) {
      return res.status(404).json({ error: 'آزمون یافت نشد' });
    }
    if (exam.studentId !== req.user.id) {
      return res.status(403).json({ error: 'این آزمون متعلق به شما نیست' });
    }

    // بررسی visibility برای نمایش (مخفی بودن)
    const now = new Date();
    if (!exam.visibleToStudent) {
      const showTime = exam.visibleFrom || exam.scheduledAt;
      if (showTime > now) {
        return res.status(403).json({ error: 'این آزمون هنوز در دسترس نیست' });
      }
    }

    // بررسی اینکه زمان شروع آزمون فرا رسیده باشد — حتی اگه visible=true،
    // دانش‌آموز نمی‌تواند قبل از scheduledAt شروع کند
    if (exam.scheduledAt > now) {
      return res.status(403).json({
        error: 'زمان شروع آزمون هنوز فرا نرسیده است',
        scheduledAt: exam.scheduledAt,
      });
    }

    // بررسی اینکه آیا قبلاً submission.SUBMITTED داریم یا نه
    const submitted = await prisma.examSubmission.findFirst({
      where: { examId: id, studentId: req.user.id, status: { in: ['SUBMITTED', 'GRADED'] } },
    });
    if (submitted) {
      return res.status(400).json({
        error: 'شما قبلاً این آزمون را ارسال کرده‌اید',
        submission: submitted,
      });
    }

    // اگر submission در حال انجام داریم، همان را برگردان
    let submission = await prisma.examSubmission.findFirst({
      where: { examId: id, studentId: req.user.id, status: 'IN_PROGRESS' },
      include: { answers: true },
    });

    if (!submission) {
      // ساخت submission جدید
      const maxScore = exam.questions.reduce((s, q) => s + (q.points || 1), 0);
      submission = await prisma.examSubmission.create({
        data: {
          examId: id,
          studentId: req.user.id,
          status: 'IN_PROGRESS',
          maxScore,
        },
        include: { answers: true },
      });
    } else if (Date.now() > getDeadline(submission, exam).getTime()) {
      // مهلت آزمون گذشته؛ پاسخ‌ها به‌صورت خودکار ارسال می‌شوند
      const finalResult = await finalizeSubmission(submission.id);
      return res.status(400).json({
        error: 'زمان آزمون تمام شده و پاسخ‌ها به‌صورت خودکار ارسال شدند',
        result: finalResult,
      });
    }

    // پاسخ‌های ذخیره‌شده را به‌صورت map برمی‌گردانیم
    const answerMap = {};
    for (const a of submission.answers) {
      answerMap[a.questionId] = {
        selectedOption: a.selectedOption,
        textAnswer: a.textAnswer,
      };
    }

    res.json({
      submission,
      deadline: getDeadline(submission, exam),
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        scheduledAt: exam.scheduledAt,
        durationMinutes: exam.durationMinutes,
        questions: exam.questions.map((q) => ({
          id: q.id,
          type: q.type,
          text: q.text,
          options: q.options,
          points: q.points,
          order: q.order,
        })),
      },
      answers: answerMap,
    });
  } catch (err) {
    next(err);
  }
}

// ذخیره‌ی موقت یک پاسخ (بدون ارسال نهایی)
async function saveAnswer(req, res, next) {
  try {
    const { id } = req.params; // submissionId
    const { questionId, selectedOption, textAnswer } = req.body;

    const submission = await prisma.examSubmission.findUnique({
      where: { id },
      include: { exam: true },
    });
    if (!submission) {
      return res.status(404).json({ error: 'ارسال آزمون یافت نشد' });
    }
    if (submission.studentId !== req.user.id) {
      return res.status(403).json({ error: 'این ارسال متعلق به شما نیست' });
    }
    if (submission.status !== 'IN_PROGRESS') {
      return res.status(400).json({ error: 'این آزمون قبلاً ارسال شده و قابل تغییر نیست' });
    }

    // اگر مهلت آزمون گذشته باشد، دیگر جوابی ذخیره نمی‌شود
    if (Date.now() > getDeadline(submission, submission.exam).getTime()) {
      return res.status(400).json({ error: 'زمان آزمون تمام شده؛ امکان ذخیره‌ی پاسخ نیست' });
    }

    const question = await prisma.examQuestion.findUnique({ where: { id: questionId } });
    if (!question || question.examId !== submission.examId) {
      return res.status(400).json({ error: 'سؤال متعلق به این آزمون نیست' });
    }

    // upsert answer
    const existing = await prisma.examAnswer.findUnique({
      where: { submissionId_questionId: { submissionId: id, questionId } },
    });

    const data = {
      selectedOption: question.type === 'MULTIPLE_CHOICE' ? selectedOption : null,
      textAnswer: question.type === 'DESCRIPTIVE' ? (textAnswer || null) : null,
    };

    if (existing) {
      await prisma.examAnswer.update({ where: { id: existing.id }, data });
    } else {
      await prisma.examAnswer.create({
        data: { submissionId: id, questionId, ...data },
      });
    }

    res.json({ message: 'پاسخ ذخیره شد' });
  } catch (err) {
    next(err);
  }
}

// ارسال نهایی آزمون
async function submitExam(req, res, next) {
  try {
    const { id } = req.params; // submissionId

    const submission = await prisma.examSubmission.findUnique({ where: { id } });

    if (!submission) {
      return res.status(404).json({ error: 'ارسال آزمون یافت نشد' });
    }
    if (submission.studentId !== req.user.id) {
      return res.status(403).json({ error: 'این ارسال متعلق به شما نیست' });
    }
    if (submission.status !== 'IN_PROGRESS') {
      return res.status(400).json({ error: 'این آزمون قبلاً ارسال شده' });
    }

    const result = await finalizeSubmission(id);

    res.json({
      message: result.hasDescriptive
        ? 'آزمون ارسال شد. سؤالات تشریحی نیاز به نمره‌دهی توسط مشاور دارند.'
        : 'آزمون ارسال شد و نمره‌ی نهایی خودکار ثبت شد.',
      submission: result.updated,
      autoScore: result.autoScore,
      maxScore: result.maxScore,
      autoGraded: result.autoGraded,
      note: result.hasDescriptive ? 'سؤالات تشریحی نیاز به نمره‌دهی توسط مشاور دارند.' : null,
    });
  } catch (err) {
    next(err);
  }
}

// ====== توابع نمره‌دهی مشاور ======

// گرفتن همه‌ی ارسال‌های یک آزمون (برای مشاور)
async function getExamSubmissions(req, res, next) {
  try {
    const { examId } = req.params;

    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      return res.status(404).json({ error: 'آزمون یافت نشد' });
    }
    if (exam.advisorId !== req.user.id && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({ error: 'این آزمون متعلق به شما نیست' });
    }

    const submissions = await prisma.examSubmission.findMany({
      where: { examId },
      include: {
        answers: {
          include: { question: true },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    res.json({ exam, submissions });
  } catch (err) {
    next(err);
  }
}

// نمره‌دهی به یک پاسخ تشریحی یا کل ارسال
// نکته: پس از GRADED شدن، امکان تغییر نمره وجود ندارد
async function gradeSubmission(req, res, next) {
  try {
    const { id } = req.params; // submissionId
    const { answers, totalScore, feedback } = req.body;

    const submission = await prisma.examSubmission.findUnique({
      where: { id },
      include: { exam: true },
    });
    if (!submission) {
      return res.status(404).json({ error: 'ارسال یافت نشد' });
    }
    if (submission.exam.advisorId !== req.user.id && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({ error: 'این ارسال متعلق به دانش‌آموز شما نیست' });
    }
    // جلوگیری از تغییر نمره پس از تثبیت
    if (submission.status === 'GRADED') {
      return res.status(400).json({
        error: 'این ارسال قبلاً نمره داده شده و قابل تغییر نیست. نمره پس از تأیید نهایی، تثبیت می‌شود.',
      });
    }

    // آپدیت نمره‌ی هر پاسخ (برای تشریحی)
    if (Array.isArray(answers)) {
      for (const a of answers) {
        if (a.score !== undefined) {
          await prisma.examAnswer.updateMany({
            where: { id: a.id, submissionId: id },
            data: { score: a.score },
          });
        }
      }
    }

    // محاسبه‌ی total نهایی از همه‌ی answers
    const allAnswers = await prisma.examAnswer.findMany({ where: { submissionId: id } });
    const computedTotal = allAnswers.reduce((s, a) => s + (a.score || 0), 0);

    const updated = await prisma.examSubmission.update({
      where: { id },
      data: {
        status: 'GRADED',
        totalScore: totalScore !== undefined ? totalScore : computedTotal,
        feedback: feedback !== undefined ? (feedback ? String(feedback).trim() : null) : submission.feedback,
        gradedAt: new Date(),
      },
    });

    res.json({ message: 'نمره ثبت شد', submission: updated });
  } catch (err) {
    next(err);
  }
}

// include برای پاسخ‌های مشاور — شامل correctOption و answers
const EXAM_INCLUDE_FOR_ADVISOR = {
  questions: {
    orderBy: { order: 'asc' },
    include: {
      answers: {
        include: { submission: { select: { id: true, studentId: true, status: true } } },
      },
    },
  },
  submissions: {
    include: { answers: true },
  },
};

module.exports = {
  createExam,
  updateExam,
  deleteExam,
  getExamsForStudent,
  getMyExams,
  startExam,
  saveAnswer,
  submitExam,
  getExamSubmissions,
  gradeSubmission,
  validateQuestions,
  getDeadline,
};
