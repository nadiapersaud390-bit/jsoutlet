/**
 * ui.js — All DOM rendering, modals, toasts, view switching.
 */

const UI = (() => {

  // ── State ──────────────────────────────────────
  let currentPage  = 1;
  const PAGE_SIZE  = 15;
  let sortKey      = 'name';
  let sortDir      = 'asc';
  let filterSearch = '';
  let filterCat    = '';
  let filterStatus = '';

  // ── View Switching ─────────────────────────────
  function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const view = document.getElementById('view-' + viewId);
    if (view) view.classList.add('active');

    const navItem = document.querySelector(`[data-view="${viewId}"]`);
    if (navItem) navItem.classList.add('active');

    const titles = {
      dashboard: 'Dashboard',
      products:  'Products',
      alerts:    'Alerts',
      reports:   'Reports',
      settings:  'Settings',
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = titles[viewId] || 'StockMate';

    if (viewId === 'reports') Charts.render();
    if (viewId === 'products') renderProductTable();
    if (viewId === 'dashboard') renderDashboard();
  }

  // ── Dashboard ──────────────────────────────────
  function renderDashboard() {
    const stats    = Products.getStats();
    const settings = getSettings();
    const currency = settings.currency || '$';

    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-low').textContent   = stats.low;
    document.getElementById('stat-out').textContent   = stats.out;
    document.getElementById('stat-value').textContent = currency + stats.totalValue.toFixed(2);

    // Attention list
    const attentionEl  = document.getElementById('attention-list');
    const lowItems = Products.getLowStock().sort((a, b) => a.quantity - b.quantity);

    if (lowItems.length === 0) {
      attentionEl.innerHTML = '<p class="empty-state">All products are well stocked. ✅</p>';
    } else {
      attentionEl.innerHTML = lowItems.slice(0, 8).map(p => {
        const status = Products.getStatus(p);
        return `
          <div class="attention-item ${status === 'out' ? 'critical' : ''}">
            <span class="attention-name">${escapeHtml(p.name)}</span>
            <span class="attention-qty">${status === 'out' ? '🚨 Out of stock' : `⚠️ ${p.quantity} ${escapeHtml(p.unit)} left`}</span>
            <button class="btn btn-sm btn-ghost" onclick="UI.openEditModal('${p.id}')">Update</button>
          </div>`;
      }).join('');
    }

    // Recent products
    const recentEl = document.getElementById('recent-list');
    const recent   = Products.getAll().slice(0, 8);
    if (recent.length === 0) {
      recentEl.innerHTML = '<p class="empty-state">No products yet. Add your first product above.</p>';
    } else {
      recentEl.innerHTML = recent.map(p => {
        const status = Products.getStatus(p);
        const chip = statusChip(status);
        return `
          <div class="product-card" onclick="UI.openEditModal('${p.id}')">
            <div class="product-card-name">${escapeHtml(p.name)}</div>
            <div class="product-card-meta">${escapeHtml(p.category)}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">
              <span style="font-size:.85rem;color:var(--text-secondary)">${p.quantity} ${escapeHtml(p.unit)}</span>
              ${chip}
            </div>
          </div>`;
      }).join('');
    }

    document.getElementById('last-updated').textContent =
      'Updated: ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── Product Table ──────────────────────────────
  function renderProductTable() {
    const results = Products.query({
      search:   filterSearch,
      category: filterCat,
      status:   filterStatus,
      sortKey,
      sortDir,
    });

    const total     = results.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = 1;

    const page = results.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    const tbody    = document.getElementById('product-tbody');
    const settings = getSettings();
    const currency = settings.currency || '$';

    if (page.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No products found.</td></tr>`;
    } else {
      tbody.innerHTML = page.map(p => {
        const status = Products.getStatus(p);
        return `
          <tr>
            <td class="name-cell">${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.category)}</td>
            <td><strong>${p.quantity}</strong> ${escapeHtml(p.unit)}</td>
            <td>${p.threshold}</td>
            <td>${currency}${p.price.toFixed(2)}</td>
            <td>${statusChip(status)}</td>
            <td>
              <div class="action-btns">
                <button class="btn btn-sm btn-ghost" onclick="UI.openEditModal('${p.id}')">Edit</button>
                <button class="btn btn-sm btn-ghost" onclick="UI.confirmDelete('${p.id}')">Delete</button>
              </div>
            </td>
          </tr>`;
      }).join('');
    }

    renderPagination(totalPages);
    refreshCategoryFilter();
  }

  function renderPagination(totalPages) {
    const pag = document.getElementById('pagination');
    if (!pag) return;
    let html = '';
    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="UI.goPage(${i})">${i}</button>`;
    }
    pag.innerHTML = html;
  }

  function goPage(n) {
    currentPage = n;
    renderProductTable();
  }

  function refreshCategoryFilter() {
    const sel   = document.getElementById('category-filter');
    const cats  = Products.getCategories();
    const current = sel.value;
    sel.innerHTML = '<option value="">All Categories</option>' +
      cats.map(c => `<option value="${escapeHtml(c)}" ${c === current ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
    sel.value = current;

    // Also populate modal datalist
    const dl = document.getElementById('category-list');
    if (dl) dl.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }

  // ── Modals ─────────────────────────────────────
  function openAddModal() {
    document.getElementById('modal-title').textContent = 'Add Product';
    document.getElementById('edit-id').value    = '';
    document.getElementById('field-name').value = '';
    document.getElementById('field-category').value = '';
    document.getElementById('field-qty').value  = '';
    document.getElementById('field-threshold').value = getSettings().defaultThreshold ?? 5;
    document.getElementById('field-price').value = '';
    document.getElementById('field-unit').value = 'pcs';
    document.getElementById('field-notes').value = '';
    document.getElementById('modal-overlay').classList.add('open');
    document.getElementById('field-name').focus();
  }

  function openEditModal(id) {
    const p = Products.getById(id);
    if (!p) return;
    document.getElementById('modal-title').textContent = 'Edit Product';
    document.getElementById('edit-id').value          = p.id;
    document.getElementById('field-name').value       = p.name;
    document.getElementById('field-category').value   = p.category;
    document.getElementById('field-qty').value        = p.quantity;
    document.getElementById('field-threshold').value  = p.threshold;
    document.getElementById('field-price').value      = p.price;
    document.getElementById('field-unit').value       = p.unit;
    document.getElementById('field-notes').value      = p.notes;
    document.getElementById('modal-overlay').classList.add('open');
    document.getElementById('field-name').focus();
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
  }

  function saveModal() {
    const id   = document.getElementById('edit-id').value;
    const name = document.getElementById('field-name').value.trim();
    if (!name) { showToast('Product name is required.', 'error'); return; }

    const qty = parseFloat(document.getElementById('field-qty').value);
    if (isNaN(qty) || qty < 0) { showToast('Quantity must be 0 or more.', 'error'); return; }

    const data = {
      name,
      category:  document.getElementById('field-category').value.trim() || 'General',
      quantity:  qty,
      threshold: parseFloat(document.getElementById('field-threshold').value) || getSettings().defaultThreshold || 5,
      price:     parseFloat(document.getElementById('field-price').value) || 0,
      unit:      document.getElementById('field-unit').value.trim() || 'pcs',
      notes:     document.getElementById('field-notes').value.trim(),
    };

    if (id) {
      Products.update(id, data);
      showToast('Product updated.', 'success');
    } else {
      Products.add(data);
      showToast('Product added.', 'success');
    }

    closeModal();
    refreshAll();
  }

  function confirmDelete(id) {
    const p = Products.getById(id);
    if (!p) return;
    document.getElementById('confirm-message').textContent =
      `Delete "${p.name}"? This cannot be undone.`;
    document.getElementById('confirm-overlay').classList.add('open');
    document.getElementById('confirm-ok').onclick = () => {
      Products.remove(id);
      document.getElementById('confirm-overlay').classList.remove('open');
      showToast('Product deleted.', 'info');
      refreshAll();
    };
    document.getElementById('confirm-cancel').onclick = () => {
      document.getElementById('confirm-overlay').classList.remove('open');
    };
  }

  // ── Toast ──────────────────────────────────────
  function showToast(msg, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 300ms';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ── Status Chip Helper ─────────────────────────
  function statusChip(status) {
    const map = {
      ok:      ['chip-ok',      'In Stock'],
      low:     ['chip-warning', 'Low Stock'],
      out:     ['chip-danger',  'Out of Stock'],
    };
    const [cls, label] = map[status] || map.ok;
    return `<span class="chip ${cls}">${label}</span>`;
  }

  // ── Refresh All ────────────────────────────────
  function refreshAll() {
    Notifications.check();
    const activeView = document.querySelector('.view.active')?.id?.replace('view-', '');
    if (activeView === 'dashboard')  renderDashboard();
    if (activeView === 'products')   renderProductTable();
    if (activeView === 'reports')    Charts.render();
  }

  // ── Settings Form ──────────────────────────────
  function loadSettingsForm() {
    const s = getSettings();
    document.getElementById('setting-threshold').value = s.defaultThreshold ?? 5;
    document.getElementById('setting-bizname').value   = s.bizName ?? '';
    document.getElementById('setting-currency').value  = s.currency ?? '$';
    document.getElementById('setting-notifs').checked  = s.notifEnabled ?? false;
  }

  function saveSettingsForm() {
    saveSettings({
      defaultThreshold: parseInt(document.getElementById('setting-threshold').value) || 5,
      bizName:          document.getElementById('setting-bizname').value.trim(),
      currency:         document.getElementById('setting-currency').value.trim() || '$',
      notifEnabled:     document.getElementById('setting-notifs').checked,
    });
    showToast('Settings saved.', 'success');
  }

  return {
    showView,
    renderDashboard,
    renderProductTable,
    openAddModal,
    openEditModal,
    closeModal,
    saveModal,
    confirmDelete,
    showToast,
    refreshAll,
    loadSettingsForm,
    saveSettingsForm,
    goPage,
    // Expose filter state setters
    setSearch(v)   { filterSearch = v; currentPage = 1; renderProductTable(); },
    setCatFilter(v){ filterCat    = v; currentPage = 1; renderProductTable(); },
    setStatFilter(v){ filterStatus = v; currentPage = 1; renderProductTable(); },
    setSort(k) {
      if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = k; sortDir = 'asc'; }
      renderProductTable();
    },
  };
})();
