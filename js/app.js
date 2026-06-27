/**
 * app.js — Entry point. Wires up all event listeners and boots the app.
 */

document.addEventListener('DOMContentLoaded', () => {

  // ── Navigation ──────────────────────────────────
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const view = item.dataset.view;
      UI.showView(view);
      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open');
      }
    });
  });

  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', e => {
    const sidebar = document.getElementById('sidebar');
    const toggle  = document.getElementById('menu-toggle');
    if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
      if (!sidebar.contains(e.target) && e.target !== toggle) {
        sidebar.classList.remove('open');
      }
    }
  });

  // ── Notification Banner ─────────────────────────
  document.getElementById('notif-close').addEventListener('click', () => {
    document.getElementById('notif-banner').style.display = 'none';
  });

  // ── Add Product Button ──────────────────────────
  document.getElementById('add-product-btn').addEventListener('click', () => {
    UI.openAddModal();
  });

  // ── Modal Buttons ───────────────────────────────
  document.getElementById('modal-close').addEventListener('click', UI.closeModal);
  document.getElementById('modal-cancel').addEventListener('click', UI.closeModal);
  document.getElementById('modal-save').addEventListener('click', UI.saveModal);

  // Close modal on overlay click
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) UI.closeModal();
  });

  // Save on Enter in text inputs
  document.getElementById('product-modal').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      UI.saveModal();
    }
  });

  // ── Product Table: Search + Filters ────────────
  document.getElementById('search-input').addEventListener('input', e => {
    UI.setSearch(e.target.value);
  });

  document.getElementById('category-filter').addEventListener('change', e => {
    UI.setCatFilter(e.target.value);
  });

  document.getElementById('status-filter').addEventListener('change', e => {
    UI.setStatFilter(e.target.value);
  });

  // ── Table Sorting ───────────────────────────────
  document.querySelectorAll('.product-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => UI.setSort(th.dataset.sort));
  });

  // ── CSV Import ──────────────────────────────────
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('csv-file-input').click();
  });

  document.getElementById('csv-file-input').addEventListener('change', e => {
    CSV.importFromFile(e.target.files[0]);
    e.target.value = ''; // reset so same file can be re-imported
  });

  // ── Reports: Export ─────────────────────────────
  document.getElementById('export-csv').addEventListener('click', CSV.exportProducts);

  document.getElementById('export-print').addEventListener('click', () => {
    window.print();
  });

  // ── Settings ────────────────────────────────────
  document.getElementById('save-settings').addEventListener('click', () => {
    UI.saveSettingsForm();
  });

  document.getElementById('setting-notifs').addEventListener('change', async e => {
    if (e.target.checked) {
      const granted = await Notifications.requestPermission();
      if (!granted) {
        e.target.checked = false;
        UI.showToast('Browser notifications blocked. Enable in browser settings.', 'error');
      }
    }
  });

  // ── Data Management (Settings View) ─────────────
  document.getElementById('clear-data-btn').addEventListener('click', () => {
    if (confirm('This will delete ALL products and settings. Are you sure?')) {
      Storage.clearAll();
      UI.showToast('All data cleared.', 'info');
      UI.refreshAll();
    }
  });

  document.getElementById('export-data-btn').addEventListener('click', () => {
    const data = Storage.exportAll();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'stockmate_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    UI.showToast('Backup exported.', 'success');
  });

  document.getElementById('import-data-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        Storage.importAll(data);
        UI.showToast('Backup restored successfully.', 'success');
        UI.refreshAll();
        UI.loadSettingsForm();
      } catch {
        UI.showToast('Invalid backup file.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ── Periodic low-stock check ─────────────────────
  // Checks every 5 minutes and sends browser notif if enabled
  setInterval(() => {
    const low = Notifications.check();
    if (low.length > 0) {
      Notifications.sendBrowserNotif(low);
    }
  }, 5 * 60 * 1000);

  // ── Boot ────────────────────────────────────────
  seedDemoDataIfEmpty();
  UI.loadSettingsForm();
  UI.showView('dashboard');
  Notifications.check();

  console.log('✅ StockMate initialized.');
});

// ── Demo Seed (first launch only) ─────────────────
function seedDemoDataIfEmpty() {
  if (Products.getAll().length > 0) return;

  const demos = [
    { name: 'White Rice 5kg',      category: 'Grains',      quantity: 120, threshold: 20, price: 12.50, unit: 'bag'    },
    { name: 'Cooking Oil 1L',      category: 'Oils',        quantity: 45,  threshold: 15, price: 6.99,  unit: 'bottle' },
    { name: 'Refined Sugar 1kg',   category: 'Baking',      quantity: 8,   threshold: 10, price: 3.25,  unit: 'bag'    },
    { name: 'Chicken (Frozen) 2kg',category: 'Meat',        quantity: 20,  threshold: 8,  price: 18.00, unit: 'pack'   },
    { name: 'Coca Cola 2L',        category: 'Beverages',   quantity: 0,   threshold: 5,  price: 5.50,  unit: 'bottle' },
    { name: 'Wheat Flour 2kg',     category: 'Baking',      quantity: 55,  threshold: 10, price: 4.75,  unit: 'bag'    },
    { name: 'Dishwashing Liquid',  category: 'Cleaning',    quantity: 3,   threshold: 6,  price: 2.80,  unit: 'bottle' },
    { name: 'Corned Beef 340g',    category: 'Canned Goods',quantity: 35,  threshold: 12, price: 7.20,  unit: 'can'    },
    { name: 'Milk Powder 400g',    category: 'Dairy',       quantity: 14,  threshold: 5,  price: 11.00, unit: 'tin'    },
    { name: 'Toilet Paper 6pk',    category: 'Hygiene',     quantity: 22,  threshold: 8,  price: 8.50,  unit: 'pack'   },
  ];

  demos.forEach(d => Products.add(d));
}
