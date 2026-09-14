/**
 * موتور مشترک استخراج محصول از صفحه‌ی هر فروشگاه پشتیبانی‌شده (ترندیول، زارا و...)
 *
 * این ماژول جای واحدیه که trendyolImporter.js و zaraImporter.js (و مسیر عمومی
 * «خواندن خودکار از لینک» تو صفحه‌ی اول سایت) ازش استفاده می‌کنن، تا منطق
 * استخراج یک‌بار نوشته بشه و برای هر سایت جدید فقط تنظیمات (config) اضافه بشه.
 *
 * ⚠️ نکته‌ی مهم درباره‌ی روش استخراج (قبل از تغییر این فایل حتماً بخونید):
 * محیطی که این کد توش نوشته شده به هیچ‌کدوم از سایت‌های مقصد (ترندیول، زارا)
 * دسترسی نداشت، پس امکان تست زنده روی صفحه‌ی واقعی نبود. به‌جای حدس زدن
 * کلاس‌های CSS هر سایت (که با هر تغییر ظاهر از کار می‌افته)، استخراج روی دو
 * منبع نسبتاً پایدار بنا شده:
 *
 *   ۱. تگ استاندارد <script type="application/ld+json"> با schema.org Product —
 *      اکثر فروشگاه‌های بزرگ (برای گوگل شاپینگ/سئو) این رو تو صفحه محصول می‌ذارن؛
 *      معمولاً name، description، image (یک یا چند عکس) و offers.price/priceCurrency داره.
 *      این استاندارده و مخصوص یک سایت نیست، پس شکننده نیست.
 *   ۲. دامنه‌ی CDN تصاویر هر سایت که واقعاً تأیید شده (نه حدسی):
 *      - ترندیول: cdn.dsmcdn.com (از سورس یک اسکرپر متن‌باز واقعی روی گیت‌هاب)
 *      - زارا: static.zara.net (منبع عمومی/مستندات شناخته‌شده)
 *      همه‌ی <img>های صفحه که src شون از این دامنه باشه گالری محصول در نظر
 *      گرفته می‌شن، به‌جای تکیه به کلاس CSS گالری که حدسیه.
 *
 * اگر JSON-LD پیدا نشد، به selectorهای عمومی‌تر (h1 برای اسم و چند کلاس رایج
 * قیمت) به‌عنوان آخرین راه‌حل برمی‌گرده — این بخش همچنان حدسیه.
 *
 * توصیه: بعد از دیپلوی روی هاست واقعی (که به اینترنت آزاد دسترسی داره)، یک‌بار
 * با یک لینک واقعی از هر سایت تست کنید؛ اگه خطا داد، پیام خطا دقیقاً می‌گه
 * کدوم مرحله (JSON-LD، گالری عکس، یا fallback) شکست خورده.
 */

const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const UPLOADS_BASE = path.join(__dirname, '../public/uploads');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// تنظیمات هر سایت پشتیبانی‌شده — برای اضافه کردن سایت جدید یه بلوک مشابه اضافه کنید
const SITE_CONFIGS = {
  trendyol: {
    hostPattern: /trendyol\.com/i,
    subdir: 'trendyol',
    cdnHosts: ['cdn.dsmcdn.com'],
    fallbackNameSelector: 'h1',
    fallbackPriceSelector: '.prc-dsc, .prc-slg, .prc-org, [class*="price"]',
    defaultCurrency: 'TRY',
  },
  zara: {
    hostPattern: /zara\.com/i,
    subdir: 'zara',
    cdnHosts: ['static.zara.net'],
    fallbackNameSelector: 'h1',
    fallbackPriceSelector: '[class*="price"]',
    defaultCurrency: 'EUR',
  },
};

function detectSite(productUrl) {
  for (const [key, config] of Object.entries(SITE_CONFIGS)) {
    if (config.hostPattern.test(productUrl || '')) {
      return { key, config };
    }
  }
  return null;
}

function slugify(text) {
  const base = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'item'}-${Date.now()}`;
}

// کلید یکتا برای هر عکس صرف‌نظر از سایز (پوشه‌ی سایز تو مسیر، یا پارامتر سایز تو query string)
// تا نسخه‌های مختلف سایز یک عکس دوبار دانلود نشن
function canonicalImageKey(url) {
  const specific = url.match(/product\/media\/images\/(.+?)(?:[?#]|$)/);
  if (specific) return specific[1];
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
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

async function downloadImages(urls, subdir, slug) {
  const dir = path.join(UPLOADS_BASE, subdir, slug);
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

      localPaths.push(`/uploads/${subdir}/${slug}/${filename}`);
    } catch (err) {
      console.warn(`   ⚠️ دانلود عکس ${i + 1} ناموفق بود:`, err.message);
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
        const description = node.description || null;
        const images = Array.isArray(node.image) ? node.image : node.image ? [node.image] : [];

        const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        const price = offers?.price ? parseFloat(String(offers.price).replace(',', '.')) : null;
        const currency = offers?.priceCurrency || null;

        if (name || price) {
          return { name, description, price, currency, images };
        }
      }
    }
  }

  return null;
}

// جمع‌آوری همه‌ی عکس‌های صفحه که از CDN تأییدشده‌ی همون سایت میان
async function extractGalleryImages(page, cdnHosts) {
  const allImageUrls = await page.$$eval('img', (imgs) =>
    imgs.map((img) => img.currentSrc || img.src).filter(Boolean)
  );
  return dedupeImages(allImageUrls.filter((url) => cdnHosts.some((host) => url.includes(host))));
}

async function extractFallback(page, config) {
  const name = await page.$eval(config.fallbackNameSelector, (el) => el.textContent.trim()).catch(() => null);
  const priceText = await page
    .$eval(config.fallbackPriceSelector, (el) => el.textContent.trim())
    .catch(() => null);
  const price = priceText ? parseFloat(priceText.replace(/[^0-9,.]/g, '').replace(',', '.')) : null;
  return { name, price };
}

// نقطه‌ی ورود اصلی: از هر لینک محصول از سایت‌های پشتیبانی‌شده، اسم/توضیحات/قیمت/گالری عکس رو برمی‌گردونه
async function scrapeProductPage(productUrl) {
  const detected = detectSite(productUrl);
  if (!detected) {
    throw new Error('این سایت هنوز پشتیبانی نمی‌شه (فعلاً فقط ترندیول و زارا).');
  }
  const { key: site, config } = detected;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: USER_AGENT });

  try {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    let name = null;
    let description = null;
    let price = null;
    let currency = config.defaultCurrency;
    let images = [];

    const jsonLd = await extractFromJsonLd(page).catch(() => null);
    if (jsonLd) {
      name = jsonLd.name;
      description = jsonLd.description;
      price = jsonLd.price;
      if (jsonLd.currency) currency = jsonLd.currency;
      images = dedupeImages(jsonLd.images.filter(Boolean));
    }

    // اگه اسم/قیمت از JSON-LD نیومد، به selectorهای عمومی fallback برمی‌گردیم
    if (!name || !price) {
      const fallback = await extractFallback(page, config);
      name = name || fallback.name;
      price = price || fallback.price;
    }

    if (!name || !price) {
      throw new Error(
        `اسم یا قیمت محصول از صفحه‌ی ${site} خونده نشد (نه از JSON-LD، نه از selectorهای عمومی). احتمالاً ساختار سایت عوض شده — productScraper.js رو با Inspect واقعی بررسی کنید.`
      );
    }

    // اگه گالری از JSON-LD کامل نبود، عکس‌های واقعی صفحه رو از CDN تأییدشده جمع می‌کنیم
    const domImages = await extractGalleryImages(page, config.cdnHosts);
    if (domImages.length > images.length) {
      images = dedupeImages([...images, ...domImages]);
    }

    if (images.length === 0) {
      throw new Error(`هیچ عکسی در گالری محصول ${site} پیدا نشد.`);
    }

    const slug = slugify(name);
    const localImages = await downloadImages(images, config.subdir, slug);

    if (localImages.length === 0) {
      throw new Error('دانلود هیچ‌کدام از عکس‌های محصول موفق نبود.');
    }

    return {
      site,
      name,
      description,
      price,
      currency,
      productUrl,
      images: localImages,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeProductPage, detectSite };
