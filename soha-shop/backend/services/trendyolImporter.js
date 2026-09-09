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
 * ⚠️ نکته مهم درباره‌ی روش استخراج (خوندنش قبل از تغییر این فایل ضروریه):
 * محیطی که این کد توش نوشته شده به trendyol.com دسترسی نداشت، پس امکان تست زنده
 * روی یک صفحه‌ی واقعی نبود. به‌جای حدس زدن کلاس‌های CSS ترندیول (که هر وقت
 * ظاهر سایت عوض بشه از کار می‌افته)، استخراج روی دو منبع نسبتاً پایدار بنا شده:
 *
 *   ۱. تگ استاندارد <script type="application/ld+json"> با schema.org Product —
 *      اکثر فروشگاه‌های بزرگ (برای گوگل شاپینگ/سئو) این رو تو صفحه محصول می‌ذارن؛
 *      این تگ معمولاً name، image (یک یا چند عکس) و offers.price/priceCurrency داره.
 *   ۲. دامنه‌ی CDN تصاویر ترندیول که واقعاً تأیید شده: cdn.dsmcdn.com
 *      (از سورس یک اسکرپر متن‌باز واقعی روی گیت‌هاب خونده شده) — همه‌ی <img>های
 *      صفحه که src شون از این دامنه باشه به‌عنوان گالری محصول در نظر گرفته می‌شن،
 *      به‌جای تکیه به کلاس CSS گالری که حدسیه.
 *
 * اگر JSON-LD پیدا نشد (مثلاً ترندیول حذفش کرده)، به selectorهای عمومی‌تر
 * (h1 برای اسم و چند کلاس رایج قیمت) به‌عنوان آخرین راه‌حل برمی‌گرده — این بخش
 * همچنان حدسیه و ممکنه نیاز به تنظیم با Inspect واقعی داشته باشه.
 *
 * توصیه: بعد از دیپلوی روی هاست واقعی (که به اینترنت آزاد دسترسی داره)، یک‌بار
 * با یک لینک واقعی تست کنید؛ اگه خطا داد، پیام خطا (که تو پنل ادمین نشون داده
 * می‌شه) دقیقاً می‌گه کدوم مرحله شکست خورده.
 */

const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const UPLOADS_ROOT = path.join(__dirname, '../public/uploads/trendyol');

// دامنه‌ی تأییدشده‌ی CDN تصاویر محصولات ترندیول
const IMAGE_CDN_HOST = 'cdn.dsmcdn.com';

// ⚠️ selectorهای فallback نمونه — فقط وقتی استفاده می‌شن که JSON-LD پیدا نشه.
// باید با Inspect واقعی صفحه محصول ترندیول در صورت نیاز تنظیم بشن.
const FALLBACK_NAME_SELECTOR = 'h1';
const FALLBACK_PRICE_SELECTOR = '.prc-dsc, .prc-slg, .prc-org, [class*="price"]';

function slugify(text) {
  const base = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'item'}-${Date.now()}`;
}

// کلید یکتا برای هر عکس، صرف‌نظر از پوشه‌ی سایز (مثلاً ty1200 در برابر ty522)
// تا نسخه‌های مختلف سایز یک عکس دوبار دانلود نشن
function canonicalImageKey(url) {
  const match = url.match(/product\/media\/images\/(.+?)(?:[?#]|$)/);
  return match ? match[1] : url;
}

function dedupeImages(urls) {
  const seen = new Set();
  const result = [];
  for (const url of urls) {
    const key = canonicalImageKey(url);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(url);
    }
  }
  return result;
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

// تلاش برای خوندن JSON-LD استاندارد schema.org Product (روش اصلی و پایدارتر)
async function extractFromJsonLd(page) {
  const blocks = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((n) => n.textContent)
  );

  for (const raw of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of candidates) {
      const graph = item['@graph'] || [item];
      for (const node of graph) {
        if (!node || node['@type'] !== 'Product') continue;

        const name = node.name || null;
        const images = Array.isArray(node.image) ? node.image : node.image ? [node.image] : [];

        const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        const price = offers?.price ? parseFloat(String(offers.price).replace(',', '.')) : null;
        const currency = offers?.priceCurrency || null;

        if (name || price) {
          return { name, price, currency, images };
        }
      }
    }
  }

  return null;
}

// جمع‌آوری همه‌ی عکس‌های صفحه که از CDN تصاویر ترندیول (دامنه‌ی تأییدشده) میان
async function extractGalleryImages(page) {
  const allImageUrls = await page.$$eval('img', (imgs) =>
    imgs.map((img) => img.currentSrc || img.src).filter(Boolean)
  );
  return dedupeImages(allImageUrls.filter((url) => url.includes(IMAGE_CDN_HOST)));
}

async function extractFallback(page) {
  const name = await page.$eval(FALLBACK_NAME_SELECTOR, (el) => el.textContent.trim()).catch(() => null);
  const priceText = await page
    .$eval(FALLBACK_PRICE_SELECTOR, (el) => el.textContent.trim())
    .catch(() => null);
  const price = priceText ? parseFloat(priceText.replace(/[^0-9,.]/g, '').replace(',', '.')) : null;
  return { name, price, currency: null };
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
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    let name = null;
    let price = null;
    let currency = 'TRY';
    let images = [];

    const jsonLd = await extractFromJsonLd(page).catch(() => null);
    if (jsonLd) {
      name = jsonLd.name;
      price = jsonLd.price;
      if (jsonLd.currency) currency = jsonLd.currency;
      images = dedupeImages(jsonLd.images.filter(Boolean));
    }

    // اگه اسم/قیمت از JSON-LD نیومد، به selectorهای عمومی fallback برمی‌گردیم
    if (!name || !price) {
      const fallback = await extractFallback(page);
      name = name || fallback.name;
      price = price || fallback.price;
      if (!currency && fallback.currency) currency = fallback.currency;
    }

    if (!name || !price) {
      throw new Error(
        'اسم یا قیمت محصول از صفحه ترندیول خونده نشد (نه از JSON-LD، نه از selectorهای عمومی). احتمالاً ساختار سایت عوض شده — trendyolImporter.js رو با Inspect واقعی بررسی کنید.'
      );
    }

    // اگه گالری از JSON-LD کامل نبود، عکس‌های واقعی صفحه رو از CDN تأییدشده جمع می‌کنیم
    const domImages = await extractGalleryImages(page);
    if (domImages.length > images.length) {
      images = dedupeImages([...images, ...domImages]);
    }

    if (images.length === 0) {
      throw new Error('هیچ عکسی در گالری محصول ترندیول پیدا نشد.');
    }

    const slug = slugify(name);
    const localImages = await downloadImages(images, slug);

    if (localImages.length === 0) {
      throw new Error('دانلود هیچ‌کدام از عکس‌های ترندیول موفق نبود.');
    }

    return {
      name,
      price,
      currency,
      productUrl,
      images: localImages,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { importTrendyolProduct };
