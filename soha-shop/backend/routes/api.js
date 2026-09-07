const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { getSetting } = require('../db/database');
const { convertToToman, getAllRates } = require('../services/currency');

router.use(express.json());

// GET /api/rates - دریافت نرخ ارزهای امروز
router.get('/rates', (req, res) => {
  try {
    const rates = getAllRates();
    res.json({ success: true, rates });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/products - دریافت لیست محصولات (New Collection)
router.get('/products', (req, res) => {
  try {
    const { site, country, category } = req.query;
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (site) {
      query += ' AND source_site = ?';
      params.push(site);
    }
    if (country) {
      query += ' AND source_country = ?';
      params.push(country);
    }
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    query += ' ORDER BY created_at DESC LIMIT 50';
    const products = db.prepare(query).all(...params);
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/calculate-price - فقط محاسبه (بدون ثبت سفارش نهایی)
router.post('/calculate-price', (req, res) => {
  try {
    const { originalPrice, originalCurrency, weightKg } = req.body;

    if (!originalPrice || !originalCurrency) {
      return res.status(400).json({
        success: false,
        error: 'قیمت و نوع ارز الزامی است.',
      });
    }

    const breakdown = calculateFinalPrice(originalPrice, originalCurrency, weightKg);
    res.json({ success: true, breakdown });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /api/orders - ثبت سفارش نهایی همراه با اطلاعات مشتری
router.post('/orders', (req, res) => {
  try {
    const {
      productUrl,
      productName,
      originalPrice,
      originalCurrency,
      weightKg,
      customerName,
      customerPhone,
    } = req.body;

    if (!originalPrice || !originalCurrency || !customerName || !customerPhone) {
      return res.status(400).json({
        success: false,
        error: 'قیمت، ارز، نام و شماره تماس الزامی است.',
      });
    }

    const breakdown = calculateFinalPrice(originalPrice, originalCurrency, weightKg);

    let customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(customerPhone);
    if (!customer) {
      const result = db
        .prepare('INSERT INTO customers (full_name, phone) VALUES (?, ?)')
        .run(customerName, customerPhone);
      customer = { id: result.lastInsertRowid };
    }

    const orderResult = db
      .prepare(`
        INSERT INTO orders
          (customer_id, product_url, product_name, original_price, original_currency, weight_kg, final_price_toman)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        customer.id,
        productUrl || null,
        productName || null,
        originalPrice,
        originalCurrency,
        weightKg || 1,
        breakdown.finalPriceToman
      );

    res.json({ success: true, orderId: orderResult.lastInsertRowid, breakdown });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

function calculateFinalPrice(originalPrice, originalCurrency, weightKg) {
  const profitMargin = parseFloat(getSetting('profit_margin', 1.15));
  const shippingPerKg = parseFloat(getSetting('shipping_cost_per_kg', 800000));
  const weight = parseFloat(weightKg) || 1;

  const basePriceToman = convertToToman(parseFloat(originalPrice), originalCurrency);
  const shippingCost = shippingPerKg * weight;
  const finalPrice = basePriceToman * profitMargin + shippingCost;

  return {
    basePriceToman: Math.round(basePriceToman),
    shippingCost: Math.round(shippingCost),
    finalPriceToman: Math.round(finalPrice),
  };
}

module.exports = router;
