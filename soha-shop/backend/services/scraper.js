/**
 * سرویس اسکرپر محصولات
 * این ماژول هر روز به سایت‌های مختلف (آدیداس، نایک و...) سر می‌زنه،
 * محصولات New Collection رو پیدا می‌کنه و قیمت + عکس + لینک رو ذخیره می‌کنه.
 *
 * ⚠️ نکته فنی مهم:
 * ساختار HTML سایت‌ها مدام تغییر می‌کنه، پس "selector"های زیر باید
 * به‌صورت دوره‌ای چک و آپدیت بشن. اینجا یک الگوی نمونه برای آدیداس UK آوردم
 * که باید متناسب با ساختار واقعی سایت (با بازرسی صفحه - Inspect) تنظیم بشه.
 */

const { chromium } = require('playwright');
const db = require('../db/database');
const { convertToToman } = require('./currency');
require('dotenv').config();

const DELAY_MS = parseInt(process.env.SCRAPER_DELAY_MS) || 3000;

// تعریف سایت‌های هدف - هر کدوم رو می‌تونید جدا اضافه/ویرایش کنید
//
// ⚠️ نکته حیاتی: selectorهای زیر فقط "الگو" هستن، نه selector واقعی!
// هر سایت باید جداگانه با Inspect (کلیک راست روی محصول → Inspect)
// بررسی بشه و data-testid / class واقعی جایگزین بشه.
// این کار رو باید با هم، سایت به سایت انجام بدیم.
const TARGET_SITES = [
  {
    name: 'adidas',
    country: 'italy',
    url: 'https://www.adidas.it/donna-new_collection',
    currency: 'EUR',
    selectors: {
      productCard: '[data-testid="product-card"]',
      name: '[data-testid="product-card-description-link"]',
      price: '[data-testid="gl-price-item"]',
      image: 'img',
      link: 'a',
    },
  },
  {
    name: 'adidas',
    country: 'turkey',
    url: 'https://www.adidas.com.tr/kadin-yeni_sezon',
    currency: 'TRY',
    selectors: {
      productCard: '[data-testid="product-card"]',
      name: '[data-testid="product-card-description-link"]',
      price: '[data-testid="gl-price-item"]',
      image: 'img',
      link: 'a',
    },
  },
  {
    name: 'adidas',
    country: 'uae',
    url: 'https://www.adidas.ae/en/women-new_collection',
    currency: 'AED',
    selectors: {
      productCard: '[data-testid="product-card"]',
      name: '[data-testid="product-card-description-link"]',
      price: '[data-testid="gl-price-item"]',
      image: 'img',
      link: 'a',
    },
  },
  {
    name: 'nike',
    country: 'italy',
    url: 'https://www.nike.com/it/w/nuovi-arrivi-3n82y',
    currency: 'EUR',
    selectors: {
      productCard: '.product-card',
      name: '.product-card__title',
      price: '.product-price',
      image: 'img.product-card__hero-image',
      link: 'a.product-card__link-overlay',
    },
  },
  {
    name: 'zalando',
    country: 'italy',
    url: 'https://www.zalando.it/novita-donna/',
    currency: 'EUR',
    selectors: {
      productCard: '[data-testid="product-card"]',
      name: '[data-testid="product-card-name"]',
      price: '[data-testid="price-value"]',
      image: 'img',
      link: 'a[data-testid="product-card-link"]',
    },
  },
  {
    name: 'asos',
    country: 'uk',
    url: 'https://www.asos.com/women/new-in/new-in-clothing/cat/?cid=2623',
    currency: 'GBP',
    selectors: {
      productCard: 'article[data-testid="productTile"]',
      name: 'p[data-testid="productTileDescription"]',
      price: 'span[data-testid="current-price"]',
      image: 'img',
      link: 'a',
    },
  },
  // برای اضافه کردن سایت جدید، یک بلوک مشابه با selectorهای واقعی همون سایت اضافه کنید
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeSite(browser, site) {
  console.log(`🔍 در حال اسکرپ کردن: ${site.name} (${site.country})...`);
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const results = [];

  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(site.selectors.productCard, { timeout: 15000 });

    const products = await page.$$(site.selectors.productCard);
    console.log(`   ${products.length} محصول پیدا شد.`);

    for (const product of products) {
      try {
        const name = await product.$eval(site.selectors.name, (el) => el.textContent.trim());
        const priceText = await product.$eval(site.selectors.price, (el) => el.textContent.trim());
        const price = parseFloat(priceText.replace(/[^0-9.,]/g, '').replace(',', '.'));
        const imageUrl = await product.$eval(site.selectors.image, (el) => el.src);
        const relativeLink = await product.$eval(site.selectors.link, (el) => el.getAttribute('href'));
        const fullLink = relativeLink.startsWith('http')
          ? relativeLink
          : new URL(relativeLink, site.url).href;

        results.push({
          name,
          price,
          currency: site.currency,
          imageUrl,
          productUrl: fullLink,
        });
      } catch (err) {
        console.warn('   ⚠️ خطا در خواندن یک محصول، رد شد:', err.message);
      }
    }
  } catch (error) {
    console.error(`❌ خطا در اسکرپ ${site.name} (${site.country}):`, error.message);
  } finally {
    await page.close();
  }

  return results;
}

async function saveProducts(siteName, siteCountry, products) {
  const insertStmt = db.prepare(`
    INSERT INTO products
      (source_site, source_country, product_name, product_url, image_url,
       original_price, original_currency, price_toman, category, last_checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new-collection', ?)
    ON CONFLICT(product_url) DO UPDATE SET
      original_price = excluded.original_price,
      price_toman = excluded.price_toman,
      last_checked_at = excluded.last_checked_at
  `);

  const now = new Date().toISOString();

  for (const p of products) {
    let priceToman = null;
    try {
      priceToman = convertToToman(p.price, p.currency);
    } catch (err) {
      console.warn(`   ⚠️ نرخ ارز ${p.currency} یافت نشد، ابتدا currency.js رو اجرا کنید.`);
    }

    insertStmt.run(
      siteName,
      siteCountry,
      p.name,
      p.productUrl,
      p.imageUrl,
      p.price,
      p.currency,
      priceToman,
      now
    );
  }
}

async function runFullScrape() {
  console.log('🚀 شروع فرآیند اسکرپینگ روزانه...\n');
  const browser = await chromium.launch({ headless: true });

  for (const site of TARGET_SITES) {
    const products = await scrapeSite(browser, site);
    if (products.length > 0) {
      await saveProducts(site.name, site.country, products);
      console.log(`✅ ${products.length} محصول از ${site.name} (${site.country}) ذخیره شد.\n`);
    }
    await sleep(DELAY_MS); // وقفه بین سایت‌ها برای جلوگیری از بلاک شدن
  }

  await browser.close();
  console.log('🎉 اسکرپینگ روزانه با موفقیت تمام شد.');
}

if (require.main === module) {
  runFullScrape().then(() => process.exit(0));
}

module.exports = { runFullScrape };
