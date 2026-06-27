/**
 * storage.js — All localStorage reads/writes live here.
 * Key prefix: "stockmate_"
 */

const Storage = (() => {
  const PREFIX = 'stockmate_';

  function key(name) { return PREFIX + name; }

  function get(name, fallback = null) {
    try {
      const raw = localStorage.getItem(key(name));
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('Storage.get error:', e);
      return fallback;
    }
  }

  function set(name, value) {
    try {
      localStorage.setItem(key(name), JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Storage.set error:', e);
      return false;
    }
  }

  function remove(name) {
    localStorage.removeItem(key(name));
  }

  function clearAll() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(PREFIX))
      .forEach(k => localStorage.removeItem(k));
  }

  function exportAll() {
    const data = {};
    Object.keys(localStorage)
      .filter(k => k.startsWith(PREFIX))
      .forEach(k => {
        try { data[k.replace(PREFIX, '')] = JSON.parse(localStorage.getItem(k)); }
        catch { data[k.replace(PREFIX, '')] = localStorage.getItem(k); }
      });
    return data;
  }

  function importAll(data) {
    Object.entries(data).forEach(([name, value]) => set(name, value));
  }

  return { get, set, remove, clearAll, exportAll, importAll };
})();
