/**
 * وارد کردن محصول از ترندیول برای پنل ادمین (مسیر «محصولات» → «وارد کردن از ترندیول»)
 * منطق واقعی استخراج (JSON-LD، گالری عکس از CDN تأییدشده و...) تو productScraper.js
 * مشترکه؛ این فایل فقط مطمئن می‌شه لینک واقعاً از ترندیول باشه.
 */

const { scrapeProductPage } = require('./productScraper');

async function importTrendyolProduct(productUrl) {
  if (!/trendyol\.com/i.test(productUrl || '')) {
    throw new Error('لینک وارد شده از سایت ترندیول نیست.');
  }

  const result = await scrapeProductPage(productUrl);
  return {
    name: result.name,
    price: result.price,
    currency: result.currency,
    productUrl: result.productUrl,
    images: result.images,
  };
}

module.exports = { importTrendyolProduct };
