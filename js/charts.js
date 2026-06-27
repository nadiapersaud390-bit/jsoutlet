/**
 * charts.js — Renders all report charts via Chart.js.
 */

const Charts = (() => {
  const instances = {};

  function destroyAll() {
    Object.keys(instances).forEach(k => {
      if (instances[k]) { instances[k].destroy(); delete instances[k]; }
    });
  }

  function render() {
    destroyAll();
    const products = Products.getAll();
    if (products.length === 0) return;

    renderCategoryChart(products);
    renderStatusChart(products);
    renderValueChart(products);
  }

  const PALETTE = [
    '#6c63ff', '#22d68e', '#f5a623', '#ff5c5c',
    '#56cffc', '#e879f9', '#facc15', '#34d399',
    '#f87171', '#60a5fa',
  ];

  function chartDefaults() {
    return {
      plugins: {
        legend: {
          labels: { color: '#8b93b8', font: { family: 'Inter', size: 12 } }
        }
      },
      scales: undefined, // overridden per chart
    };
  }

  // ── Category Bar Chart ─────────────────────────
  function renderCategoryChart(products) {
    const catMap = {};
    products.forEach(p => {
      catMap[p.category] = (catMap[p.category] || 0) + p.quantity;
    });
    const labels = Object.keys(catMap);
    const data   = labels.map(k => catMap[k]);

    const ctx = document.getElementById('chart-category');
    if (!ctx) return;

    instances.category = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Total Qty',
          data,
          backgroundColor: PALETTE,
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { ticks: { color: '#8b93b8' }, grid: { color: '#2c3250' } },
          y: { ticks: { color: '#8b93b8' }, grid: { color: '#2c3250' }, beginAtZero: true },
        }
      }
    });
  }

  // ── Status Doughnut ────────────────────────────
  function renderStatusChart(products) {
    const ok  = products.filter(p => Products.getStatus(p) === 'ok').length;
    const low = products.filter(p => Products.getStatus(p) === 'low').length;
    const out = products.filter(p => Products.getStatus(p) === 'out').length;

    const ctx = document.getElementById('chart-status');
    if (!ctx) return;

    instances.status = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['In Stock', 'Low Stock', 'Out of Stock'],
        datasets: [{
          data: [ok, low, out],
          backgroundColor: ['#22d68e', '#f5a623', '#ff5c5c'],
          borderColor: '#1e2336',
          borderWidth: 3,
        }]
      },
      options: {
        responsive: true,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#8b93b8', padding: 16, font: { size: 12 } }
          }
        }
      }
    });
  }

  // ── Top 10 Value Bar ───────────────────────────
  function renderValueChart(products) {
    const sorted = [...products]
      .map(p => ({ ...p, totalVal: p.quantity * p.price }))
      .filter(p => p.totalVal > 0)
      .sort((a, b) => b.totalVal - a.totalVal)
      .slice(0, 10);

    const settings = getSettings();
    const currency = settings.currency || '$';

    const ctx = document.getElementById('chart-value');
    if (!ctx) return;

    instances.value = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.map(p => p.name),
        datasets: [{
          label: `Value (${currency})`,
          data: sorted.map(p => p.totalVal.toFixed(2)),
          backgroundColor: '#6c63ff',
          borderRadius: 6,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#8b93b8', callback: v => currency + v }, grid: { color: '#2c3250' }, beginAtZero: true },
          y: { ticks: { color: '#8b93b8' }, grid: { color: '#2c3250' } },
        }
      }
    });
  }

  return { render };
})();
