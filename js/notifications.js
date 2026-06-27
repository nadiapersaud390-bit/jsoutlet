/**
 * notifications.js — Low stock alerts and browser notifications.
 */

const Notifications = (() => {

  function check() {
    const lowItems = Products.getLowStock();
    updateBadge(lowItems.length);
    updateBanner(lowItems);
    updateAlertsView(lowItems);
    return lowItems;
  }

  function updateBadge(count) {
    const badge = document.getElementById('alert-badge');
    if (!badge) return;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  }

  function updateBanner(lowItems) {
    const banner = document.getElementById('notif-banner');
    const text   = document.getElementById('notif-banner-text');
    if (!banner || !text) return;

    if (lowItems.length === 0) {
      banner.style.display = 'none';
      return;
    }

    const outItems = lowItems.filter(p => Products.getStatus(p) === 'out');
    const hasCritical = outItems.length > 0;

    banner.style.display = 'flex';
    banner.className = 'notif-banner' + (hasCritical ? ' critical' : '');

    const parts = [];
    if (outItems.length > 0) {
      parts.push(`${outItems.length} item${outItems.length > 1 ? 's' : ''} out of stock`);
    }
    const lowOnly = lowItems.filter(p => Products.getStatus(p) === 'low');
    if (lowOnly.length > 0) {
      parts.push(`${lowOnly.length} running low`);
    }

    const names = lowItems.slice(0, 3).map(p => p.name).join(', ');
    const extra  = lowItems.length > 3 ? ` +${lowItems.length - 3} more` : '';
    text.textContent = `⚠ ${parts.join(' · ')}: ${names}${extra}`;
  }

  function updateAlertsView(lowItems) {
    const container = document.getElementById('alerts-container');
    if (!container) return;

    if (lowItems.length === 0) {
      container.innerHTML = '<p class="empty-state">No active alerts. Stock levels look good! ✅</p>';
      return;
    }

    const settings = getSettings();
    const currency = settings.currency || '$';

    container.innerHTML = lowItems
      .sort((a, b) => a.quantity - b.quantity)
      .map(p => {
        const status = Products.getStatus(p);
        const isCritical = status === 'out';
        return `
          <div class="alert-item ${isCritical ? 'alert-critical' : 'alert-low'}">
            <span class="alert-icon">${isCritical ? '🚨' : '⚠️'}</span>
            <div class="alert-body">
              <div class="alert-title">${escapeHtml(p.name)}</div>
              <div class="alert-sub">
                ${isCritical ? 'Out of stock' : `Only ${p.quantity} ${escapeHtml(p.unit)} remaining`}
                · Min. required: ${p.threshold} ${escapeHtml(p.unit)}
                · Category: ${escapeHtml(p.category)}
              </div>
            </div>
            <button class="btn btn-sm btn-ghost" onclick="UI.openEditModal('${p.id}')">Update Qty</button>
          </div>`;
      })
      .join('');
  }

  function sendBrowserNotif(lowItems) {
    const settings = getSettings();
    if (!settings.notifEnabled) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const outCount = lowItems.filter(p => Products.getStatus(p) === 'out').length;
    const title = outCount > 0
      ? `🚨 ${outCount} item(s) out of stock!`
      : `⚠️ ${lowItems.length} item(s) running low`;

    const body = lowItems.slice(0, 5).map(p => `• ${p.name} (${p.quantity} left)`).join('\n');
    new Notification(title, { body, icon: '' });
  }

  async function requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }

  return { check, sendBrowserNotif, requestPermission };
})();

// Tiny HTML escape helper used across modules
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
