/**
 * راه‌اندازی دیتابیس SQLite
 * جدول‌ها:
 * 1. currency_rates       - نرخ روزانه ارزها
 * 2. products             - محصولات اسکرپ‌شده
 * 3. price_calculations   - تاریخچه محاسبات فرم صفحه اول
 * 4. admin_users          - کاربران ادمین (ورود به پنل)
 * 5. customers            - مشتریانی که سفارش ثبت کردن
 * 6. orders               - سفارش‌های واقعی ثبت‌شده
 * 7. settings             - تنظیمات قابل‌تغییر از پنل (ضریب سود، نرخ تومان و...)
 */

const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'soha.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS currency_rates (
    currency_code TEXT PRIMARY KEY,
    rate_to_usd REAL NOT NULL,
    rate_to_toman REAL NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_site TEXT NOT NULL,
    source_country TEXT,
    product_name TEXT NOT NULL,
    product_url TEXT NOT NULL UNIQUE,
    image_url TEXT,
    original_price REAL NOT NULL,
    original_currency TEXT NOT NULL,
    price_toman REAL,
    category TEXT,
    in_stock INTEGER DEFAULT 1,
    last_checked_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS price_calculations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_url TEXT NOT NULL,
    estimated_weight_kg REAL,
    original_price REAL,
    original_currency TEXT,
    final_price_toman REAL,
    calculated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    role TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT,
    phone TEXT,
    email TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    product_url TEXT,
    product_name TEXT,
    original_price REAL,
    original_currency TEXT,
    weight_kg REAL,
    final_price_toman REAL,
    status TEXT DEFAULT 'pending',   -- pending, confirmed, shipped, delivered, cancelled
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// ===== مقداردهی اولیه تنظیمات پیش‌فرض (فقط اگه وجود نداشته باشن) =====
const defaultSettings = {
  profit_margin: process.env.PROFIT_MARGIN || '1.15',
  shipping_cost_per_kg: process.env.SHIPPING_COST_PER_KG || '800000',
  usd_to_toman: process.env.USD_TO_TOMAN || '750000',
};

const insertSetting = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
);
for (const [key, value] of Object.entries(defaultSettings)) {
  insertSetting.run(key, String(value));
}

// ===== ساخت ادمین پیش‌فرض (فقط اگه هیچ ادمینی وجود نداشته باشه) =====
const adminCount = db.prepare('SELECT COUNT(*) as count FROM admin_users').get().count;
if (adminCount === 0) {
  const defaultPassword = 'ChangeMe123!';
  const hash = bcrypt.hashSync(defaultPassword, 10);
  db.prepare(
    'INSERT INTO admin_users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)'
  ).run('admin', hash, 'مدیر فروشگاه', 'owner');
  console.log('\n🔑 کاربر ادمین پیش‌فرض ساخته شد:');
  console.log('   نام کاربری: admin');
  console.log(`   رمز عبور:   ${defaultPassword}`);
  console.log('   ⚠️  حتماً بعد از اولین ورود این رمز رو عوض کنید!\n');
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value), new Date().toISOString());
}

module.exports = db;
module.exports.getSetting = getSetting;
module.exports.setSetting = setSetting;
