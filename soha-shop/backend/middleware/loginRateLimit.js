// محدود کردن تعداد تلاش‌های ورود: حداکثر ۵ تلاش در هر ۱۵ دقیقه به ازای هر IP
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const attemptsByIp = new Map();

function loginRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();

  const entry = attemptsByIp.get(ip);

  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    attemptsByIp.set(ip, { count: 1, firstAttempt: now });
    return next();
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((entry.firstAttempt + WINDOW_MS - now) / 1000);
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      success: false,
      error: 'تعداد تلاش‌های ورود بیش از حد مجاز است. لطفاً بعداً دوباره امتحان کنید.',
    });
  }

  entry.count += 1;
  next();
}

module.exports = loginRateLimit;
