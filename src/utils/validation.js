// تبدیل اعداد انگلیسی به فارسی برای پیام‌های خطا
function toFa(n) {
  const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(n).replace(/[0-9]/g, (d) => FA[Number(d)]);
}

// پیام راهنمای فرمت‌های قابل قبول شماره تماس ایران
const PHONE_FORMAT_HINT =
  'فرمت‌های قابل قبول:\n' +
  '• موبایل با ۰: ۰۹۱۲۳۴۵۶۷۸۹ (۱۱ رقم)\n' +
  '• موبایل بدون ۰: ۹۱۲۳۴۵۶۷۸۹ (۱۰ رقم)\n' +
  '• با کد کشور: +۹۸۹۱۲۳۴۵۶۷۸۹ یا ۰۰۹۸۹۱۲۳۴۵۶۷۸۹\n' +
  '• ثابت با ۰: ۰۲۱۱۲۳۴۵۶۷۸ (۱۱ رقم)';

// نرمال‌سازی شماره تماس بر اساس فرمت ایران
function normalizePhone(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  // تبدیل اعداد فارسی و عربی به انگلیسی
  const faDigits = '۰۱۲۳۴۵۶۷۸۹';
  const arDigits = '٠١٢٣٤٥٦٧٨٩';
  let normalized = '';
  for (const ch of trimmed) {
    const faIdx = faDigits.indexOf(ch);
    const arIdx = arDigits.indexOf(ch);
    if (faIdx >= 0) normalized += String(faIdx);
    else if (arIdx >= 0) normalized += String(arIdx);
    else normalized += ch;
  }

  // تشخیص وجود + در ابتدا و استخراج فقط اعداد
  const hasPlus = normalized.startsWith('+');
  const digits = normalized.replace(/[^\d]/g, '');

  if (digits.length === 0) {
    throw new Error('شماره تماس خالی است. ' + PHONE_FORMAT_HINT);
  }

  let result;

  // ---------- فرمت‌های با کد کشور ----------
  if (hasPlus) {
    // +989XXXXXXXXX یا +98XXXXXXXXX
    if (!digits.startsWith('98')) {
      throw new Error(
        'شماره با + شروع شده ولی کد کشور ۹۸ نیست. ' + PHONE_FORMAT_HINT
      );
    }
    const nationalPart = digits.slice(2); // بعد از 98
    if (nationalPart.length !== 10) {
      throw new Error(
        `شماره با +۹۸ باید ۱۰ رقم بعد از کد کشور داشته باشد، ولی ${toFa(nationalPart.length)} رقم وارد شده. ` +
        PHONE_FORMAT_HINT
      );
    }
    result = '0' + nationalPart;
  } else if (digits.startsWith('0098')) {
    // 00989XXXXXXXXX یا 0098XXXXXXXXX
    const nationalPart = digits.slice(4); // بعد از 0098
    if (nationalPart.length !== 10) {
      throw new Error(
        `شماره با ۰۰۹۸ باید ۱۰ رقم بعد از کد کشور داشته باشد، ولی ${toFa(nationalPart.length)} رقم وارد شده. ` +
        PHONE_FORMAT_HINT
      );
    }
    result = '0' + nationalPart;
  } else if (digits.startsWith('98') && digits.length === 12) {
    // 989XXXXXXXXX (بدون +، ۱۲ رقم)
    const nationalPart = digits.slice(2);
    if (nationalPart.length !== 10) {
      throw new Error(
        `شماره با ۹۸ باید ۱۰ رقم بعد از کد کشور داشته باشد. ` + PHONE_FORMAT_HINT
      );
    }
    result = '0' + nationalPart;
  }
  // ---------- فرمت‌های داخلی ----------
  else if (digits.startsWith('0')) {
    // 0XXXXXXXXX — باید دقیقاً ۱۱ رقم باشد
    if (digits.length !== 11) {
      throw new Error(
        `شماره با ۰ باید ۱۱ رقم باشد، ولی ${toFa(digits.length)} رقم وارد شده. ` +
        PHONE_FORMAT_HINT
      );
    }
    result = digits;
  } else if (digits.startsWith('9') && digits.length === 10) {
    // 9XXXXXXXXX — موبایل بدون ۰
    result = '0' + digits;
  } else if (digits.length === 10) {
    // XXXXXXXXXX — ثابت بدون ۰ (شروع با کد شهر مثل 21، 31، ...)
    result = '0' + digits;
  } else {
    // هیچ فرمت شناخته‌شده‌ای تطابق نکرد
    throw new Error(
      `شماره تماس با هیچ فرمت قابل قبولی تطابق ندارد (${toFa(digits.length)} رقم). ` +
      PHONE_FORMAT_HINT
    );
  }

  // اعتبارسنجی نهایی خروجی: باید ۱۱ رقم و با ۰ شروع شود
  if (result.length !== 11 || !result.startsWith('0')) {
    throw new Error(
      'خروجی نرمال‌سازی معتبر نیست. ' + PHONE_FORMAT_HINT
    );
  }

  return result;
}

// اعتبارسنجی ساده‌ی توضیحات: محدود به ۵۰۰ کاراکتر
function normalizeBio(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) {
    throw new Error('توضیحات نباید بیشتر از ۵۰۰ کاراکتر باشد');
  }
  return trimmed;
}

module.exports = { normalizePhone, normalizeBio };
