const API_BASE = '/api';

const productUrlInput = document.getElementById('productUrl');
const weightInput = document.getElementById('weightKg');
const resultAmount = document.getElementById('resultAmount');
const calcNote = document.getElementById('calcNote');
const manualFallback = document.getElementById('manualFallback');
const manualPrice = document.getElementById('manualPrice');
const manualCurrency = document.getElementById('manualCurrency');
const customerFields = document.getElementById('customerFields');
const customerName = document.getElementById('customerName');
const customerPhone = document.getElementById('customerPhone');
const calcSubmit = document.getElementById('calcSubmit');
const productPreview = document.getElementById('productPreview');
const previewGallery = document.getElementById('previewGallery');
const previewName = document.getElementById('previewName');
const previewDesc = document.getElementById('previewDesc');

let step = 'calculate'; // calculate -> confirm
let selectedProductName = '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

async function tryAutoReadPrice(url) {
  productPreview.hidden = true;
  manualFallback.hidden = true;
  calcNote.textContent = 'در حال خواندن اطلاعات محصول...';

  try {
    const res = await fetch(`${API_BASE}/product-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (data.success) {
      const p = data.product;

      previewGallery.innerHTML = p.images
        .map((src) => `<img src="${escapeHtml(src)}" alt="" loading="lazy">`)
        .join('');
      previewName.textContent = p.name || '';
      previewDesc.textContent = p.description || '';
      productPreview.hidden = false;

      manualPrice.value = p.price;
      manualCurrency.value = p.currency;
      selectedProductName = p.name || '';

      calcNote.textContent = 'قیمت و مشخصات محصول خودکار خوانده شد؛ برای محاسبه دکمه زیر را بزنید.';
    } else {
      manualFallback.hidden = false;
      calcNote.textContent = data.error || 'قیمت خودکار خوانده نشد؛ لطفاً آن را دستی وارد کنید.';
    }
  } catch {
    manualFallback.hidden = false;
    calcNote.textContent = 'اتصال به سرور برقرار نشد؛ لطفاً قیمت را دستی وارد کنید.';
  }
}

productUrlInput.addEventListener('change', () => {
  if (productUrlInput.value.trim()) {
    tryAutoReadPrice(productUrlInput.value.trim());
  }
});

calcSubmit.addEventListener('click', async () => {
  const price = parseFloat(manualPrice.value);
  const currency = manualCurrency.value;
  const weight = parseFloat(weightInput.value) || 1;

  if (!price || price <= 0) {
    calcNote.textContent = 'لطفاً قیمت محصول را وارد کنید.';
    manualFallback.hidden = false;
    return;
  }

  if (step === 'calculate') {
    // مرحله ۱: فقط محاسبه و نمایش قیمت + گرفتن مشخصات تماس
    calcSubmit.disabled = true;
    calcSubmit.textContent = 'در حال محاسبه...';
    try {
      const res = await fetch(`${API_BASE}/calculate-price`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalPrice: price, originalCurrency: currency, weightKg: weight }),
      });
      const data = await res.json();
      if (data.success) {
        resultAmount.textContent = data.breakdown.finalPriceToman.toLocaleString('fa-IR');
        calcNote.textContent = `شامل قیمت پایه + هزینه ارسال (${weight} کیلوگرم)`;
        customerFields.hidden = false;
        step = 'confirm';
        calcSubmit.textContent = 'تایید نهایی سفارش';
      } else {
        calcNote.textContent = data.error || 'خطایی رخ داد.';
      }
    } catch {
      calcNote.textContent = 'اتصال به سرور برقرار نشد.';
    } finally {
      calcSubmit.disabled = false;
    }
  } else {
    // مرحله ۲: ثبت نهایی سفارش با مشخصات مشتری
    const name = customerName.value.trim();
    const phone = customerPhone.value.trim();
    if (!name || !phone) {
      calcNote.textContent = 'لطفاً نام و شماره تماس را وارد کنید.';
      return;
    }

    calcSubmit.disabled = true;
    calcSubmit.textContent = 'در حال ثبت سفارش...';
    try {
      const res = await fetch(`${API_BASE}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productUrl: productUrlInput.value.trim(),
          productName: selectedProductName || undefined,
          originalPrice: price,
          originalCurrency: currency,
          weightKg: weight,
          customerName: name,
          customerPhone: phone,
        }),
      });
      const data = await res.json();
      if (data.success) {
        calcNote.textContent = `✅ سفارش شما ثبت شد (شماره پیگیری: ${data.orderId}). به‌زودی با شما تماس می‌گیریم.`;
        calcSubmit.textContent = 'ثبت سفارش جدید';
        step = 'calculate';
        customerFields.hidden = true;
        selectedProductName = '';
        productPreview.hidden = true;
        productUrlInput.value = '';
      } else {
        calcNote.textContent = data.error || 'خطا در ثبت سفارش.';
      }
    } catch {
      calcNote.textContent = 'اتصال به سرور برقرار نشد.';
    } finally {
      calcSubmit.disabled = false;
    }
  }
});

// ===== نمایش محصولات کالکشن جدید =====
async function loadProducts() {
  const grid = document.getElementById('productGrid');
  try {
    const res = await fetch(`${API_BASE}/products?category=new-collection`);
    const data = await res.json();

    if (!data.success || data.products.length === 0) {
      grid.innerHTML = `<p class="grid-loading">هنوز محصولی اسکرپ نشده. اسکرپر را با دستور «npm run scrape» اجرا کنید.</p>`;
      return;
    }

    grid.innerHTML = data.products
      .map(
        (p) => `
      <div class="product-card"
           data-product-url="${escapeHtml(p.product_url)}"
           data-price="${escapeHtml(p.original_price)}"
           data-currency="${escapeHtml(p.original_currency)}"
           data-name="${escapeHtml(p.product_name)}">
        <a href="${escapeHtml(p.product_url)}" target="_blank" class="product-link">
          <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.product_name)}" loading="lazy">
          <div class="product-info">
            <p class="product-source">${escapeHtml(p.source_site)} · ${escapeHtml(p.source_country || '')}</p>
            <p class="product-name">${escapeHtml(p.product_name)}</p>
            <p class="product-price">${p.price_toman ? Math.round(p.price_toman).toLocaleString('fa-IR') + ' تومان' : 'در حال محاسبه'}</p>
          </div>
        </a>
        <button type="button" class="product-add-btn" title="افزودن به سفارش">+</button>
      </div>
    `
      )
      .join('');

    grid.querySelectorAll('.product-add-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const card = btn.closest('.product-card');
        startOrderFromProduct(card.dataset);
      });
    });
  } catch {
    grid.innerHTML = `<p class="grid-loading">خطا در اتصال به سرور.</p>`;
  }
}

// با کلیک روی دکمه «+» روی کارت محصول، فرم ثبت سفارش با همون محصول از پیش پر می‌شود
function startOrderFromProduct({ productUrl, price, currency, name }) {
  document.getElementById('calculator').scrollIntoView({ behavior: 'smooth' });

  productUrlInput.value = productUrl || '';
  manualPrice.value = price || '';
  if (currency) manualCurrency.value = currency;
  manualFallback.hidden = false;
  selectedProductName = name || '';

  step = 'calculate';
  customerFields.hidden = true;
  calcSubmit.textContent = 'ثبت سفارش';
  calcNote.textContent = name ? `محصول انتخاب‌شده: ${name}` : '';
}

loadProducts();
