/**
 * سرویس نرخ ارز
 * این ماژول هر روز نرخ ارزهای مختلف (یورو، پوند، دلار، درهم، لیر) رو
 * از یک API معتبر می‌گیره و توی دیتابیس ذخیره می‌کنه.
 *
 * نکته مهم: ریال ایران توی بازارهای رسمی جهانی معامله نمی‌شه،
 * پس نرخ تومان/ریال رو جداگانه و دستی یا از منبع داخلی (مثل نرخ بازار آزاد) ست می‌کنیم.
 */

const axios = require('axios');
require('dotenv').config();
const db = require('../db/database');
const { getSetting } = require('../db/database');

// آدرس API نرخ ارز (پایه: دلار آمریکا)
const API_KEY = process.env.EXCHANGE_RATE_API_KEY;
const API_URL = `https://v6.exchangerate-api.com/v6/${API_KEY}/latest/USD`;

async function fetchAndSaveRates() {
  try {
    console.log('📡 در حال دریافت نرخ ارز روز...');
    const response = await axios.get(API_URL);
    const rates = response.data.conversion_rates;

    // نرخ‌هایی که برای فروشگاه لازم داریم (نسبت به دلار)
    const targetCurrencies = {
      EUR: rates.EUR, // یورو
      GBP: rates.GBP, // پوند
      AED: rates.AED, // درهم امارات
      TRY: rates.TRY, // لیر ترکیه
    };

    const timestamp = new Date().toISOString();
    // نرخ تومان به دلار رو هر بار تازه از تنظیمات (که از پنل ادمین قابل تغییره) می‌خونیم
    const MANUAL_USD_TO_TOMAN = parseFloat(getSetting('usd_to_toman', 750000));

    // محاسبه نرخ هر ارز به تومان:
    // مثال: 1 یورو = (1/نرخ یورو به دلار) × نرخ دلار به تومان
    const insertStmt = db.prepare(`
      INSERT INTO currency_rates (currency_code, rate_to_usd, rate_to_toman, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(currency_code) DO UPDATE SET
        rate_to_usd = excluded.rate_to_usd,
        rate_to_toman = excluded.rate_to_toman,
        updated_at = excluded.updated_at
    `);

    // دلار خودش هم ذخیره می‌شه
    insertStmt.run('USD', 1, MANUAL_USD_TO_TOMAN, timestamp);

    for (const [code, rateToUsd] of Object.entries(targetCurrencies)) {
      const rateToToman = (1 / rateToUsd) * MANUAL_USD_TO_TOMAN;
      insertStmt.run(code, rateToUsd, rateToToman, timestamp);
      console.log(`✅ ${code}: 1 ${code} = ${Math.round(rateToToman).toLocaleString('fa-IR')} تومان`);
    }

    console.log('🎉 نرخ ارزها با موفقیت آپدیت شد.');
    return true;
  } catch (error) {
    console.error('❌ خطا در دریافت نرخ ارز:', error.message);
    return false;
  }
}

/**
 * تابع اصلی تبدیل قیمت
 * @param {number} amount - مبلغ به ارز خارجی
 * @param {string} currencyCode - کد ارز (EUR, GBP, USD, AED, TRY)
 * @returns {number} - مبلغ معادل به تومان
 */
function convertToToman(amount, currencyCode) {
  const row = db.prepare('SELECT rate_to_toman FROM currency_rates WHERE currency_code = ?').get(currencyCode);
  if (!row) {
    throw new Error(`نرخ ارز برای ${currencyCode} یافت نشد. لطفاً ابتدا نرخ‌ها رو آپدیت کنید.`);
  }
  return amount * row.rate_to_toman;
}

function getAllRates() {
  return db.prepare('SELECT * FROM currency_rates ORDER BY currency_code').all();
}

// اگر فایل مستقیم اجرا بشه (node currency.js)، نرخ‌ها رو آپدیت کن
if (require.main === module) {
  fetchAndSaveRates().then(() => process.exit(0));
}

module.exports = { fetchAndSaveRates, convertToToman, getAllRates };
