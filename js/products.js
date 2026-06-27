/**
 * products.js — CRUD operations for inventory products.
 * Products are stored as an array in localStorage under "products".
 */

const Products = (() => {

  function getAll() {
    return Storage.get('products', []);
  }

  function getById(id) {
    return getAll().find(p => p.id === id) || null;
  }

  function add(data) {
    const products = getAll();
    const product = {
      id:        'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name:      (data.name || '').trim(),
      category:  (data.category || 'General').trim(),
      quantity:  parseFloat(data.quantity) || 0,
      threshold: parseFloat(data.threshold) ?? getSettings().defaultThreshold ?? 5,
      price:     parseFloat(data.price) || 0,
      unit:      (data.unit || 'pcs').trim(),
      notes:     (data.notes || '').trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    products.unshift(product);
    Storage.set('products', products);
    return product;
  }

  function update(id, data) {
    const products = getAll();
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) return null;
    products[idx] = {
      ...products[idx],
      name:      (data.name ?? products[idx].name).toString().trim(),
      category:  (data.category ?? products[idx].category).toString().trim(),
      quantity:  parseFloat(data.quantity ?? products[idx].quantity) || 0,
      threshold: parseFloat(data.threshold ?? products[idx].threshold) || 5,
      price:     parseFloat(data.price ?? products[idx].price) || 0,
      unit:      (data.unit ?? products[idx].unit).toString().trim(),
      notes:     (data.notes ?? products[idx].notes).toString().trim(),
      updatedAt: Date.now(),
    };
    Storage.set('products', products);
    return products[idx];
  }

  function remove(id) {
    const products = getAll().filter(p => p.id !== id);
    Storage.set('products', products);
  }

  function getStatus(product) {
    if (product.quantity <= 0) return 'out';
    if (product.quantity <= product.threshold) return 'low';
    return 'ok';
  }

  function getLowStock() {
    return getAll().filter(p => getStatus(p) !== 'ok');
  }

  function getStats() {
    const all = getAll();
    const low = all.filter(p => getStatus(p) === 'low');
    const out = all.filter(p => getStatus(p) === 'out');
    const totalValue = all.reduce((sum, p) => sum + (p.quantity * p.price), 0);
    return { total: all.length, low: low.length, out: out.length, totalValue };
  }

  function getCategories() {
    const cats = [...new Set(getAll().map(p => p.category).filter(Boolean))];
    return cats.sort();
  }

  // Returns products filtered + sorted
  function query({ search = '', category = '', status = '', sortKey = 'name', sortDir = 'asc' } = {}) {
    let results = getAll();

    if (search) {
      const q = search.toLowerCase();
      results = results.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q)
      );
    }

    if (category) {
      results = results.filter(p => p.category === category);
    }

    if (status) {
      results = results.filter(p => getStatus(p) === status);
    }

    results.sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return results;
  }

  return { getAll, getById, add, update, remove, getStatus, getLowStock, getStats, getCategories, query };
})();

// ── Settings ──
function getSettings() {
  return Storage.get('settings', {
    defaultThreshold: 5,
    bizName: 'My Business',
    currency: '$',
    notifEnabled: false,
  });
}

function saveSettings(data) {
  const current = getSettings();
  Storage.set('settings', { ...current, ...data });
}
