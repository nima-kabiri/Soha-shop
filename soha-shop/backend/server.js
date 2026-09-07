const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const cron = require('node-cron');
require('dotenv').config();

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

cron.schedule('0 */6 * * *', async () => {
  console.log('\n⏰ [Cron] زمان آپدیت نرخ ارز رسید...');
  await fetchAndSaveRates();
});

cron.schedule('0 3 * * *', async () => {
  console.log('\n⏰ [Cron] زمان اسکرپ روزانه محصولات رسید...');
  await runFullScrape();
});

fetchAndSaveRates();
