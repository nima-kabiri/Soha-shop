// این میدلور جلوی درخواست‌های بدون ورود رو به مسیرهای پنل ادمین می‌گیره
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'لطفاً ابتدا وارد پنل شوید.' });
}

module.exports = requireAdmin;
