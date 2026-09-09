const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { getSetting, setSetting } = require('../db/database');
const { verifyAdminLogin, changeAdminPassword } = require('../services/auth');
const requireAdmin = require('../middleware/requireAdmin');
const { importTrendyolProduct } = require('../services/trendyolImporter');
const { convertToToman } = require('../services/currency');

router.use(express.json());

// ============================================
// احراز هویت
// ============================================

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const admin = verifyAdminLogin(username, password);

  if (!admin) {
    return res.status(401).json({ success: false, error: 'نام کاربری یا رمز عبور اشتباه است.' });
  }

  req.session.admin = admin;
  res.json({ success: true, admin });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ success: true, admin: req.session.admin });
});

router.post('/change-password', requireAdmin, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'رمز عبور باید حداقل ۶ کاراکتر باشد.' });
  }
  changeAdminPassword(req.session.admin.id, newPassword);
  res.json({ success: true });
});

// همه‌ی مسیرهای زیر این خط نیاز به ورود دارن
router.use(requireAdmin);

// ============================================
// داشبورد - آمار کلی
// ============================================

router.get('/stats', (req, res) => {
  const totalProducts = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  const totalCustomers = db.prepare('SELECT COUNT(*) as c FROM customers').get().c;
  const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;

  const revenueRow = db
    .prepare("SELECT SUM(final_price_toman) as total FROM orders WHERE status != 'cancelled'")
    .get();
  const totalRevenue = revenueRow.total || 0;

  // آمار سفارش‌های ۷ روز اخیر (برای نمودار)
  const recentOrders = db
    .prepare(`
      SELECT date(created_at) as day, COUNT(*) as count, SUM(final_price_toman) as revenue
      FROM orders
      WHERE created_at >= date('now', '-7 days')
      GROUP BY day
      ORDER BY day ASC
    `)
    .all();

  const latestRates = db.prepare('SELECT * FROM currency_rates ORDER BY currency_code').all();

  res.json({
    success: true,
    stats: {
      totalProducts,
      totalCustomers,
      totalOrders,
      pendingOrders,
      totalRevenue,
      recentOrders,
      latestRates,
    },
  });
});

// ============================================
// مدیریت محصولات
// ============================================

router.get('/products', (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;
  let query = 'SELECT * FROM products WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND product_name LIKE ?';
    params.push(`%${search}%`);
  }

  const offset = (page - 1) * limit;
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const products = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM products').get().c;

  res.json({ success: true, products, total, page: parseInt(page) });
});

router.put('/products/:id', (req, res) => {
  const { id } = req.params;
  const { product_name, original_price, price_toman, in_stock } = req.body;

  db.prepare(`
    UPDATE products
    SET product_name = COALESCE(?, product_name),
        original_price = COALESCE(?, original_price),
        price_toman = COALESCE(?, price_toman),
        in_stock = COALESCE(?, in_stock)
    WHERE id = ?
  `).run(product_name, original_price, price_toman, in_stock, id);

  res.json({ success: true });
});

router.delete('/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// وارد کردن محصول از ترندیول (خودش اسم، قیمت و همه‌ی عکس‌های گالری رو تشخیص می‌ده
// و عکس‌ها رو روی هاست خودمون ذخیره می‌کنه، نه لینک مستقیم به ترندیول)
router.post('/products/import-trendyol', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'لینک محصول ترندیول الزامی است.' });
  }

  try {
    const imported = await importTrendyolProduct(url);

    let priceToman = null;
    try {
      priceToman = convertToToman(imported.price, imported.currency);
    } catch (err) {
      console.warn('   ⚠️ نرخ ارز TRY یافت نشد، ابتدا از پنل تنظیمات نرخ‌ها رو آپدیت کنید.');
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO products
        (source_site, source_country, product_name, product_url, image_url, images,
         original_price, original_currency, price_toman, category, last_checked_at)
      VALUES ('trendyol', 'turkey', ?, ?, ?, ?, ?, ?, ?, 'trendyol-import', ?)
      ON CONFLICT(product_url) DO UPDATE SET
        product_name = excluded.product_name,
        image_url = excluded.image_url,
        images = excluded.images,
        original_price = excluded.original_price,
        price_toman = excluded.price_toman,
        last_checked_at = excluded.last_checked_at
    `).run(
      imported.name,
      imported.productUrl,
      imported.images[0],
      JSON.stringify(imported.images),
      imported.price,
      imported.currency,
      priceToman,
      now
    );

    const product = db.prepare('SELECT * FROM products WHERE product_url = ?').get(imported.productUrl);
    res.json({ success: true, product });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// مدیریت سفارش‌ها
// ============================================

router.get('/orders', (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let query = `
    SELECT orders.*, customers.full_name as customer_name, customers.phone as customer_phone
    FROM orders
    LEFT JOIN customers ON orders.customer_id = customers.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    query += ' AND orders.status = ?';
    params.push(status);
  }

  const offset = (page - 1) * limit;
  query += ' ORDER BY orders.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const orders = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;

  res.json({ success: true, orders, total, page: parseInt(page) });
});

router.put('/orders/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: 'وضعیت نامعتبر است.' });
  }

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

// ============================================
// مدیریت مشتریان
// ============================================

router.get('/customers', (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;
  let query = `
    SELECT customers.*,
      (SELECT COUNT(*) FROM orders WHERE orders.customer_id = customers.id) as order_count,
      (SELECT SUM(final_price_toman) FROM orders WHERE orders.customer_id = customers.id) as total_spent
    FROM customers WHERE 1=1
  `;
  const params = [];

  if (search) {
    query += ' AND (full_name LIKE ? OR phone LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const offset = (page - 1) * limit;
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const customers = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM customers').get().c;

  res.json({ success: true, customers, total, page: parseInt(page) });
});

// ============================================
// تنظیمات فروشگاه
// ============================================

router.get('/settings', (req, res) => {
  res.json({
    success: true,
    settings: {
      profit_margin: getSetting('profit_margin'),
      shipping_cost_per_kg: getSetting('shipping_cost_per_kg'),
      usd_to_toman: getSetting('usd_to_toman'),
    },
  });
});

router.put('/settings', (req, res) => {
  const { profit_margin, shipping_cost_per_kg, usd_to_toman } = req.body;

  if (profit_margin) setSetting('profit_margin', profit_margin);
  if (shipping_cost_per_kg) setSetting('shipping_cost_per_kg', shipping_cost_per_kg);
  if (usd_to_toman) setSetting('usd_to_toman', usd_to_toman);

  res.json({ success: true });
});

module.exports = router;
