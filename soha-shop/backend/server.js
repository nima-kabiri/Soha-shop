const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const cron = require('node-cron');
require('dotenv').config();

// شبکه‌ی ایمنی سراسری: هیچ خطای پیش‌بینی‌نشده (مثلاً یه باگ توی اسکرپر شبانه یا
// یه promise که reject شده و کسی catch نکرده) نباید کل سایت رو از کار بندازه.
// به‌جای کرش کردن کل پروسه، خطا رو لاگ می‌کنیم و سرور به کارش ادامه می‌ده.
process.on('uncaughtException', (err) => {
  console.error('❌ خطای مدیریت‌نشده (uncaughtException) — سرور همچنان روشن می‌مونه:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('❌ Promise رد شده که کسی catch نکرد (unhandledRejection) — سرور همچنان روشن می‌مونه:', err);
});

const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const { fetchAndSaveRates } = require('./services/currency');
const { runFullScrape } = require('./services/scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// نشست (Session) برای ورود پنل ادمین
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'soha-shop-change-this-secret-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // ۲۴ ساعت
      secure: process.env.NODE_ENV === 'production',
    },
  })
);

// فایل‌های فرانت‌اند مشتری
app.use(express.static(path.join(__dirname, '../frontend')));
// فایل‌های پنل ادمین (جدا از سایت اصلی)
app.use('/admin', express.static(path.join(__dirname, '../frontend/admin')));
// عکس‌های دانلود شده از منابع خارجی (مثل ترندیول) - روی هاست خودمون سرو می‌شن
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// روت‌های API
app.use('/api/admin', adminRoutes);
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🌟 Soha Shop روی پورت ${PORT} در حال اجراست`);
  console.log(`   سایت اصلی: http://localhost:${PORT}`);
  console.log(`   پنل ادمین:  http://localhost:${PORT}/admin\n`);
});

// ============================================
// زمان‌بندی خودکار (Cron Jobs)
// ============================================

// هر تسک زمان‌بندی‌شده تو try/catch خودشه؛ اگه یکی شکست بخوره (مثلاً سایت مقصد
// در دسترس نبود) فقط همون تسک لاگ خطا می‌ده و بقیه‌ی سایت (فروشگاه، سفارش‌ها، پنل)
// دست‌نخورده و آنلاین می‌مونه.
cron.schedule('0 */6 * * *', async () => {
  console.log('\n⏰ [Cron] زمان آپدیت نرخ ارز رسید...');
  try {
    await fetchAndSaveRates();
  } catch (err) {
    console.error('❌ آپدیت نرخ ارز شکست خورد (سرور همچنان روشنه):', err.message);
  }
});

cron.schedule('0 3 * * *', async () => {
  console.log('\n⏰ [Cron] زمان اسکرپ روزانه محصولات رسید...');
  try {
    await runFullScrape();
  } catch (err) {
    console.error('❌ اسکرپ روزانه شکست خورد (سرور همچنان روشنه):', err.message);
  }
});

fetchAndSaveRates();
