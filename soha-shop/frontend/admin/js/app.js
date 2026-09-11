const API = '/api/admin';

const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const vaultBox = document.getElementById('vaultBox');
const vaultDoor = document.getElementById('vaultDoor');
const dialGroup = document.getElementById('dialGroup');
const passwordInput = document.getElementById('password');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ===== چرخش دستگیره گاوصندوق موقع تایپ رمز =====
let dialRotation = 0;
if (passwordInput && dialGroup) {
  passwordInput.addEventListener('input', () => {
    dialRotation += 47;
    dialGroup.style.transform = `rotate(${dialRotation}deg)`;
  });
}

// ===== بررسی وضعیت ورود موقع بارگذاری صفحه =====
async function checkAuth() {
  try {
    const res = await fetch(`${API}/me`, { credentials: 'include' });
    const data = await res.json();
    if (data.success) {
      showDashboard();
      loadOverview();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function showLogin() {
  loginScreen.hidden = false;
  dashboard.hidden = true;
}
function showDashboard() {
  loginScreen.hidden = true;
  dashboard.hidden = false;
}

// ===== ورود =====
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  loginError.hidden = true;

  try {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (data.success) {
      unlockVault();
    } else {
      loginError.textContent = data.error;
      loginError.hidden = false;
      shakeVault();
    }
  } catch {
    loginError.textContent = 'اتصال به سرور برقرار نشد.';
    loginError.hidden = false;
    shakeVault();
  }
});

// ===== لرزش + هاله قرمز موقع رمز اشتباه =====
function shakeVault() {
  if (!vaultBox) return;
  if (reducedMotion) return;
  vaultBox.classList.remove('wrong');
  // اجبار به ری‌فلو تا انیمیشن دوباره اجرا بشه
  void vaultBox.offsetWidth;
  vaultBox.classList.add('wrong');
  setTimeout(() => vaultBox.classList.remove('wrong'), 500);
}

// ===== چرخش سریع دستگیره + باز شدن در موقع رمز درست =====
function unlockVault() {
  if (reducedMotion || !dialGroup || !vaultDoor) {
    showDashboard();
    loadOverview();
    return;
  }

  dialGroup.classList.add('spin');
  dialRotation += 720;
  dialGroup.style.transform = `rotate(${dialRotation}deg)`;

  setTimeout(() => {
    vaultDoor.classList.add('open');
  }, 500);

  setTimeout(() => {
    showDashboard();
    loadOverview();
  }, 1450);
}

// ===== خروج =====
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch(`${API}/logout`, { method: 'POST', credentials: 'include' });
  showLogin();
});

// ===== ناوبری بین نماها =====
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    const viewName = btn.dataset.view;
    document.getElementById(`view-${viewName}`).classList.add('active');

    if (viewName === 'overview') loadOverview();
    if (viewName === 'products') loadProducts();
    if (viewName === 'orders') loadOrders();
    if (viewName === 'customers') loadCustomers();
    if (viewName === 'settings') loadSettings();
  });
});

function formatToman(n) {
  return Math.round(n || 0).toLocaleString('fa-IR');
}
function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('fa-IR');
}

// ===== داشبورد کلی =====
async function loadOverview() {
  const res = await fetch(`${API}/stats`, { credentials: 'include' });
  const data = await res.json();
  if (!data.success) return;

  const s = data.stats;
  document.getElementById('statProducts').textContent = s.totalProducts;
  document.getElementById('statCustomers').textContent = s.totalCustomers;
  document.getElementById('statOrders').textContent = s.totalOrders;
  document.getElementById('statRevenue').textContent = formatToman(s.totalRevenue);

  // نمودار میله‌ای ساده سفارش‌های ۷ روز اخیر
  const chart = document.getElementById('revenueChart');
  if (s.recentOrders.length === 0) {
    chart.innerHTML = '<p style="color:var(--muted)">هنوز سفارشی ثبت نشده.</p>';
  } else {
    const maxCount = Math.max(...s.recentOrders.map((o) => o.count), 1);
    chart.innerHTML = s.recentOrders
      .map((o) => {
        const heightPct = (o.count / maxCount) * 100;
        return `
        <div class="bar-col">
          <div class="bar" style="height:${heightPct}%" title="${o.count} سفارش"></div>
          <span class="bar-label">${formatDate(o.day)}</span>
        </div>`;
      })
      .join('');
  }

  // نرخ ارز
  const ratesEl = document.getElementById('ratesTable');
  if (s.latestRates.length === 0) {
    ratesEl.innerHTML = '<p style="color:var(--muted)">نرخ ارزی ثبت نشده.</p>';
  } else {
    ratesEl.innerHTML = s.latestRates
      .map((r) => `<div class="rate-chip">${r.currency_code}: <b>${formatToman(r.rate_to_toman)}</b> تومان</div>`)
      .join('');
  }
}

// ===== محصولات =====
async function loadProducts(search = '') {
  const url = new URL(`${API}/products`, window.location.origin);
  if (search) url.searchParams.set('search', search);

  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json();
  const tbody = document.querySelector('#productsTable tbody');

  if (!data.success || data.products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted)">محصولی یافت نشد</td></tr>';
    return;
  }

  tbody.innerHTML = data.products
    .map(
      (p) => `
    <tr>
      <td><img src="${p.image_url || ''}" alt=""></td>
      <td>${p.product_name}</td>
      <td>${p.source_site} / ${p.source_country || '—'}</td>
      <td>${p.original_price} ${p.original_currency}</td>
      <td>${p.price_toman ? formatToman(p.price_toman) : '—'}</td>
      <td>${p.in_stock ? '✅ موجود' : '❌ ناموجود'}</td>
      <td><button class="row-btn" onclick="deleteProduct(${p.id})">حذف</button></td>
    </tr>`
    )
    .join('');
}

async function deleteProduct(id) {
  if (!confirm('این محصول حذف بشه؟')) return;
  await fetch(`${API}/products/${id}`, { method: 'DELETE', credentials: 'include' });
  loadProducts();
}

document.getElementById('productSearch').addEventListener('input', (e) => {
  loadProducts(e.target.value);
});

// ===== سفارش‌ها =====
const statusLabels = {
  pending: 'در انتظار',
  confirmed: 'تایید شده',
  shipped: 'ارسال شده',
  delivered: 'تحویل شده',
  cancelled: 'لغو شده',
};

async function loadOrders(status = '') {
  const url = new URL(`${API}/orders`, window.location.origin);
  if (status) url.searchParams.set('status', status);

  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json();
  const tbody = document.querySelector('#ordersTable tbody');

  if (!data.success || data.orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted)">سفارشی یافت نشد</td></tr>';
    return;
  }

  tbody.innerHTML = data.orders
    .map(
      (o) => `
    <tr>
      <td>#${o.id}</td>
      <td>${o.customer_name || '—'}</td>
      <td>${o.customer_phone || '—'}</td>
      <td>${o.product_name || 'بدون نام محصول'}</td>
      <td>${formatToman(o.final_price_toman)}</td>
      <td>
        <select onchange="updateOrderStatus(${o.id}, this.value)" class="row-btn">
          ${Object.entries(statusLabels)
            .map(([val, label]) => `<option value="${val}" ${o.status === val ? 'selected' : ''}>${label}</option>`)
            .join('')}
        </select>
      </td>
      <td>${formatDate(o.created_at)}</td>
    </tr>`
    )
    .join('');
}

async function updateOrderStatus(id, status) {
  await fetch(`${API}/orders/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status }),
  });
}

document.getElementById('orderStatusFilter').addEventListener('change', (e) => {
  loadOrders(e.target.value);
});

// ===== مشتریان =====
async function loadCustomers(search = '') {
  const url = new URL(`${API}/customers`, window.location.origin);
  if (search) url.searchParams.set('search', search);

  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json();
  const tbody = document.querySelector('#customersTable tbody');

  if (!data.success || data.customers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted)">مشتری‌ای یافت نشد</td></tr>';
    return;
  }

  tbody.innerHTML = data.customers
    .map(
      (c) => `
    <tr>
      <td>${c.full_name || '—'}</td>
      <td>${c.phone || '—'}</td>
      <td>${c.order_count}</td>
      <td>${formatToman(c.total_spent)}</td>
      <td>${formatDate(c.created_at)}</td>
    </tr>`
    )
    .join('');
}

document.getElementById('customerSearch').addEventListener('input', (e) => {
  loadCustomers(e.target.value);
});

// ===== تنظیمات =====
async function loadSettings() {
  const res = await fetch(`${API}/settings`, { credentials: 'include' });
  const data = await res.json();
  if (!data.success) return;

  document.getElementById('setProfitMargin').value = data.settings.profit_margin;
  document.getElementById('setShippingCost').value = data.settings.shipping_cost_per_kg;
  document.getElementById('setUsdToToman').value = data.settings.usd_to_toman;
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const body = {
    profit_margin: document.getElementById('setProfitMargin').value,
    shipping_cost_per_kg: document.getElementById('setShippingCost').value,
    usd_to_toman: document.getElementById('setUsdToToman').value,
  };

  const res = await fetch(`${API}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json();
  const note = document.getElementById('settingsNote');
  note.textContent = data.success ? '✅ تنظیمات ذخیره شد.' : '❌ خطا در ذخیره.';
});

document.getElementById('changePasswordBtn').addEventListener('click', async () => {
  const newPassword = document.getElementById('newPassword').value;
  const res = await fetch(`${API}/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ newPassword }),
  });
  const data = await res.json();
  const note = document.getElementById('passwordNote');
  note.textContent = data.success ? '✅ رمز عبور تغییر کرد.' : `❌ ${data.error}`;
});

// شروع
checkAuth();
