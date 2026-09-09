/**
 * وارد کردن محصول از ترندیول
 *
 * ادمین لینک محصول ترندیول رو تو پنل وارد می‌کنه؛ این ماژول:
 *  ۱. صفحه محصول رو با Playwright باز می‌کنه (چون ترندیول یک اپ React هست و
 *     محتوا با جاوااسکریپت رندر می‌شه، fetch ساده کافی نیست)
 *  ۲. اسم، قیمت (لیر ترکیه) و همه‌ی عکس‌های گالری همون آیتم رو از HTML صفحه استخراج می‌کنه
 *  ۳. عکس‌ها رو دانلود می‌کنه و روی هاست خودمون ذخیره می‌کنه (public/uploads/trendyol/...)
 *     — از این به بعد سایت ما مستقیم به عکس‌های سرور ترندیول لینک نمی‌ده
 *
 * ⚠️ نکته فنی مهم (دقیقاً مثل بقیه‌ی سایت‌های scraper.js):
 * ساختار HTML ترندیول ممکنه عوض بشه، پس selectorهای زیر باید هر از گاهی با
 * Inspect واقعی صفحه محصول (کلیک راست → Inspect) بررسی و آپدیت بشن.
 */

const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const UPLOADS_ROOT = path.join(__dirname, '../public/uploads/trendyol');

// ⚠️ selectorهای نمونه — باید با Inspect واقعی صفحه محصول ترندیول تنظیم بشن
const NAME_SELECTOR = 'h1.pr-new-br, .product-name, h1';
const PRICE_SELECTOR = '.prc-dsc, .prc-slg, .prc-org, .product-price';
const GALLERY_IMG_SELECTOR =
  '.gallery-modal-content img, .base-product-image img, .product-slide img, .styles-module_gallery img';

function slugify(text) {
  const base = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'item'}-${Date.now()}`;
}

async function downloadImages(urls, slug) {
  const dir = path.join(UPLOADS_ROOT, slug);
  fs.mkdirSync(dir, { recursive: true });

  const localPaths = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      let ext = '.jpg';
      try {
        const parsedExt = path.extname(new URL(url).pathname);
        if (parsedExt && parsedExt.length <= 5) ext = parsedExt;
      } catch {
        // آدرس نامعتبر بود، پسوند پیش‌فرض .jpg رو نگه می‌داریم
      }

      const filename = `${i + 1}${ext}`;
      const filePath = path.join(dir, filename);
      const response = await axios.get(url, { responseType: 'stream', timeout: 20000 });

      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      localPaths.push(`/uploads/trendyol/${slug}/${filename}`);
    } catch (err) {
      console.warn(`   ⚠️ دانلود عکس ${i + 1} از ترندیول ناموفق بود:`, err.message);
    }
  }
  return localPaths;
}

async function importTrendyolProduct(productUrl) {
  if (!/trendyol\.com/i.test(productUrl || '')) {
    throw new Error('لینک وارد شده از سایت ترندیول نیست.');
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  try {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(NAME_SELECTOR, { timeout: 15000 }).catch(() => {});

    const name = await page.$eval(NAME_SELECTOR, (el) => el.textContent.trim()).catch(() => null);
    const priceText = await page.$eval(PRICE_SELECTOR, (el) => el.textContent.trim()).catch(() => null);

    if (!name || !priceText) {
      throw new Error(
        'اسم یا قیمت محصول از صفحه ترندیول خونده نشد. احتمالاً ساختار سایت عوض شده — selectorهای trendyolImporter.js رو با Inspect بررسی کنید.'
      );
    }

    const price = parseFloat(priceText.replace(/[^0-9,.]/g, '').replace(',', '.'));
    if (!price || Number.isNaN(price)) {
      throw new Error('قیمت خونده‌شده از ترندیول معتبر نیست: ' + priceText);
    }

    const imageUrls = await page.$$eval(GALLERY_IMG_SELECTOR, (imgs) =>
      Array.from(new Set(imgs.map((img) => img.currentSrc || img.src).filter(Boolean)))
    );

    if (imageUrls.length === 0) {
      throw new Error('هیچ عکسی در گالری محصول ترندیول پیدا نشد.');
    }

    const slug = slugify(name);
    const images = await downloadImages(imageUrls, slug);

    if (images.length === 0) {
      throw new Error('دانلود هیچ‌کدام از عکس‌های ترندیول موفق نبود.');
    }

    return {
      name,
      price,
      currency: 'TRY',
      productUrl,
      images,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { importTrendyolProduct };
