// ==========================================
// ReStock Reminder - Embedded App Frontend
// ==========================================

(function () {
  'use strict';

  // Get shop domain from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const shopDomain = urlParams.get('shop') || '';

  // Initialize Shopify App Bridge
  let shopifyBridge = null;
  if (window.shopify) {
    shopifyBridge = window.shopify;
  }

  // Get session token from App Bridge
  async function getSessionToken() {
    if (shopifyBridge && shopifyBridge.idToken) {
      try {
        return await shopifyBridge.idToken();
      } catch (e) {
        console.warn('Failed to get session token:', e);
      }
    }
    return null;
  }

  // API helper with session token auth
  async function api(method, path, body) {
    const token = await getSessionToken();
    const headers = {
      'Content-Type': 'application/json',
      'X-Shop-Domain': shopDomain,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`/api${path}?shop=${shopDomain}`, opts);

    if (res.status === 401) {
      const data = await res.json();
      if (data.redirect) {
        window.location.href = data.redirect;
        return null;
      }
    }

    if (!res.ok) {
      throw new Error(`API error: ${res.status}`);
    }

    return res.json();
  }

  // ===== Navigation =====
  const navLinks = document.querySelectorAll('.nav-link');
  const pages = document.querySelectorAll('.page');

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      switchPage(page);
    });
  });

  function switchPage(page) {
    navLinks.forEach(l => l.classList.remove('active'));
    pages.forEach(p => p.classList.remove('active'));

    document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
    document.getElementById(`page-${page}`)?.classList.add('active');

    // Load page data
    if (page === 'dashboard') loadDashboard();
    else if (page === 'products') loadProducts();
    else if (page === 'reminders') loadReminders(1);
    else if (page === 'settings') loadSettings();
  }

  // ===== Toast =====
  let toastEl = null;
  function showToast(message, type = '') {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.className = `toast show ${type}`;
    setTimeout(() => { toastEl.className = 'toast'; }, 3000);
  }

  // ===== Dashboard =====
  async function loadDashboard() {
    try {
      const data = await api('GET', '/dashboard');
      if (!data) return;

      document.getElementById('stat-sent').textContent = data.stats.totalReminders.toLocaleString();
      document.getElementById('stat-month').textContent = `${data.stats.monthReminders} this month`;
      document.getElementById('stat-pending').textContent = data.stats.pendingReminders.toLocaleString();
      document.getElementById('stat-products').textContent = data.stats.trackedProducts.toLocaleString();
      document.getElementById('stat-open-rate').textContent = `${data.stats.openRate}%`;
      document.getElementById('stat-click-rate').textContent = `${data.stats.clickRate}% click rate`;

      // Plan
      const badge = document.getElementById('plan-badge');
      badge.textContent = `${data.plan.name} Plan`;
      badge.className = `plan-badge ${data.plan.name === 'Pro' ? 'pro' : ''}`;

      // Usage
      const usedPercent = data.plan.limit === 'unlimited'
        ? 0
        : Math.min(100, (data.plan.used / data.plan.limit) * 100);
      const fill = document.getElementById('usage-fill');
      fill.style.width = `${usedPercent}%`;
      fill.className = `usage-fill ${usedPercent > 80 ? 'danger' : usedPercent > 50 ? 'warning' : ''}`;

      document.getElementById('usage-text').textContent = data.plan.limit === 'unlimited'
        ? `${data.plan.used} reminders sent (unlimited)`
        : `${data.plan.used} / ${data.plan.limit} reminders used`;

      document.getElementById('btn-upgrade').style.display = data.plan.name === 'Pro' ? 'none' : '';

      // Recent reminders
      const recentList = document.getElementById('recent-list');
      if (data.recentReminders.length === 0) {
        recentList.innerHTML = '<p class="empty-state">No reminders sent yet. Reminders will be sent automatically when customers\' reorder dates arrive.</p>';
      } else {
        recentList.innerHTML = data.recentReminders.map(r => `
          <div class="recent-item">
            <span class="recent-email">${escapeHtml(r.email)}</span>
            <span class="recent-product">${escapeHtml(r.productTitle)}</span>
            <span class="recent-date">${formatDate(r.sentAt)}</span>
          </div>
        `).join('');
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  }

  // ===== Products =====
  let allProducts = [];

  async function loadProducts() {
    const list = document.getElementById('products-list');
    list.innerHTML = '<p class="empty-state">Loading products...</p>';

    try {
      const data = await api('GET', '/products');
      if (!data) return;

      allProducts = data.products;
      document.getElementById('default-interval').value = data.defaultInterval;
      renderProducts(allProducts);
    } catch (err) {
      console.error('Products load error:', err);
      list.innerHTML = '<p class="empty-state">Failed to load products</p>';
    }
  }

  function renderProducts(products) {
    const list = document.getElementById('products-list');

    if (products.length === 0) {
      list.innerHTML = '<p class="empty-state">No products found in your store</p>';
      return;
    }

    list.innerHTML = products.map(p => `
      <div class="product-item" data-id="${p.id}">
        <img class="product-img" src="${p.imageUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22><rect fill=%22%23e2e8f0%22 width=%2248%22 height=%2248%22 rx=%228%22/></svg>'}" alt="">
        <div class="product-info">
          <div class="product-title">${escapeHtml(p.title)}</div>
        </div>
        <div class="product-controls-inline">
          <div class="interval-input">
            <span>Every</span>
            <input type="number" value="${p.interval}" min="1" max="365" data-product="${p.id}" class="interval-field">
            <span>days</span>
          </div>
          <label class="toggle">
            <input type="checkbox" ${p.enabled ? 'checked' : ''} data-product="${p.id}" class="toggle-field">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    `).join('');

    // Event listeners for changes
    list.querySelectorAll('.interval-field').forEach(input => {
      input.addEventListener('change', (e) => {
        updateProduct(e.target.dataset.product, { interval: parseInt(e.target.value) });
      });
    });

    list.querySelectorAll('.toggle-field').forEach(input => {
      input.addEventListener('change', (e) => {
        updateProduct(e.target.dataset.product, { enabled: e.target.checked });
      });
    });
  }

  async function updateProduct(productId, data) {
    try {
      // Find product title for the update
      const product = allProducts.find(p => p.id === productId);
      if (product) {
        data.title = product.title;
        data.imageUrl = product.imageUrl;
      }
      await api('PUT', `/products/${productId}`, data);
      showToast('Product updated', 'success');
    } catch (err) {
      console.error('Update product error:', err);
      showToast('Failed to update', 'error');
    }
  }

  // Search
  document.getElementById('product-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = allProducts.filter(p => p.title.toLowerCase().includes(q));
    renderProducts(filtered);
  });

  // Apply all
  document.getElementById('btn-apply-all')?.addEventListener('click', async () => {
    const interval = parseInt(document.getElementById('default-interval').value);
    if (!interval || interval < 1) return;

    try {
      await api('PUT', '/settings', { defaultInterval: interval });
      for (const p of allProducts) {
        p.interval = interval;
      }
      renderProducts(allProducts);
      showToast(`Default interval set to ${interval} days`, 'success');
    } catch (err) {
      showToast('Failed to update', 'error');
    }
  });

  // ===== Reminders History =====
  async function loadReminders(page) {
    try {
      const data = await api('GET', `/reminders?page=${page}`);
      if (!data) return;

      const tbody = document.getElementById('reminders-tbody');

      if (data.reminders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No reminders sent yet</td></tr>';
      } else {
        tbody.innerHTML = data.reminders.map(r => `
          <tr>
            <td>${formatDate(r.sentAt)}</td>
            <td>${escapeHtml(r.email)}</td>
            <td>${escapeHtml(r.productTitle)}</td>
            <td>
              <span class="status-badge ${r.clicked ? 'clicked' : r.opened ? 'opened' : 'sent'}">
                ${r.clicked ? 'Clicked' : r.opened ? 'Opened' : 'Sent'}
              </span>
            </td>
          </tr>
        `).join('');
      }

      // Pagination
      const pagination = document.getElementById('pagination');
      if (data.pagination.pages > 1) {
        let html = '';
        for (let i = 1; i <= data.pagination.pages; i++) {
          html += `<button class="${i === data.pagination.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }
        pagination.innerHTML = html;
        pagination.querySelectorAll('button').forEach(btn => {
          btn.addEventListener('click', () => loadReminders(parseInt(btn.dataset.page)));
        });
      } else {
        pagination.innerHTML = '';
      }
    } catch (err) {
      console.error('Reminders load error:', err);
    }
  }

  // ===== Settings =====
  async function loadSettings() {
    try {
      const data = await api('GET', '/settings');
      if (!data) return;

      document.getElementById('email-enabled').checked = data.emailEnabled;
      document.getElementById('email-subject').value = data.emailSubject;
      document.getElementById('email-body').value = data.emailBody;
      document.getElementById('current-plan').textContent = data.plan === 'pro' ? 'Pro' : 'Free';

      document.getElementById('btn-subscribe').style.display = data.plan === 'pro' ? 'none' : '';
    } catch (err) {
      console.error('Settings load error:', err);
    }
  }

  document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
    try {
      await api('PUT', '/settings', {
        emailEnabled: document.getElementById('email-enabled').checked,
        emailSubject: document.getElementById('email-subject').value,
        emailBody: document.getElementById('email-body').value,
      });
      showToast('Settings saved', 'success');
    } catch (err) {
      showToast('Failed to save', 'error');
    }
  });

  // ===== Billing =====
  document.getElementById('btn-subscribe')?.addEventListener('click', async () => {
    try {
      const data = await fetch(`/billing/subscribe?shop=${shopDomain}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shop-Domain': shopDomain,
        },
      }).then(r => r.json());

      if (data.confirmationUrl) {
        window.top.location.href = data.confirmationUrl;
      }
    } catch (err) {
      showToast('Failed to start subscription', 'error');
    }
  });

  document.getElementById('btn-upgrade')?.addEventListener('click', () => {
    switchPage('settings');
  });

  // ===== Helpers =====
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ===== Init =====
  if (shopDomain) {
    loadDashboard();
  } else {
    document.getElementById('app').innerHTML = `
      <div style="text-align:center; padding:60px 20px;">
        <h2>ReStock Reminder</h2>
        <p style="color:#475569; margin:12px 0 24px;">This app must be accessed from your Shopify admin panel.</p>
        <a href="https://apps.shopify.com/restock-reminder" class="btn btn-primary">Install from Shopify App Store</a>
      </div>
    `;
  }
})();
