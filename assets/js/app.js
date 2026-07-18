import { firebaseConfig } from "./firebase-config.js";

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";

import {
  getAnalytics,
  isSupported as analyticsIsSupported
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-analytics.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  push,
  onValue,
  onDisconnect,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const appRoot = document.getElementById("appRoot");
const entryMode = document.body.dataset.entry === "alcohol" ? "alcohol" : "management";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const database = getDatabase(firebaseApp);

analyticsIsSupported()
  .then((supported) => {
    if (supported) getAnalytics(firebaseApp);
  })
  .catch(() => {});

setPersistence(auth, browserLocalPersistence).catch(console.error);

const PATHS = {
  users: "users",
  items: "inventory/alcohol/items",
  settings: "inventory/alcohol/settings",
  counts: "inventory/alcohol/countSessions",
  logs: "auditLogs",
  presence: "presence"
};

const ROLES = {
  admin: {
    label: "Administrator",
    sections: ["overview", "alcohol", "history", "audit", "users"],
    writeInventory: true
  },
  alcohol_manager: {
    label: "Alcohol Manager",
    sections: ["overview", "alcohol", "history"],
    writeInventory: true
  },
  alcohol_viewer: {
    label: "Alcohol Viewer",
    sections: ["overview", "alcohol", "history"],
    writeInventory: false
  }
};

const state = {
  user: null,
  profile: null,
  items: [],
  settings: {
    businessName: "Price King Distributors",
    currency: "GYD",
    defaultMarkup: 10,
    countDate: new Date().toISOString().slice(0, 10)
  },
  sessions: [],
  logs: [],
  users: [],
  currentSection: "overview",
  search: "",
  category: "",
  page: 1,
  pageSize: 50,
  subscriptions: [],
  connected: false
};

const $ = (id) => document.getElementById(id);
const integer = (value) => Math.max(0, Math.floor(number(value)));
const nonNegative = (value) => Math.max(0, number(value));

function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "").replace(/[,$]/g, "").replace(/[^\d.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function csvSafe(value) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvEscape(value) {
  return `"${csvSafe(value).replace(/"/g, '""')}"`;
}

function formatNumber(value, decimals = 0) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(number(value));
}

function formatMoney(value) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: state.settings.currency || "GYD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(number(value));
  } catch {
    return `$${formatNumber(value, 2)}`;
  }
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(Number(value) || value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function sanitizeItem(raw = {}, key = "") {
  return {
    id: String(raw.id || key || uid()),
    name: String(raw.name || raw.productName || "").trim(),
    category: String(raw.category || "Other").trim() || "Other",
    size: String(raw.size || "").trim(),
    cases: integer(raw.cases),
    unitsPerCase: integer(raw.unitsPerCase),
    looseUnits: integer(raw.looseUnits),
    caseCost: nonNegative(raw.caseCost),
    unitCost: nonNegative(raw.unitCost),
    sellingPrice: nonNegative(raw.sellingPrice),
    supplier: String(raw.supplier || "").trim(),
    reorderLevel: integer(raw.reorderLevel),
    notes: String(raw.notes || "").trim(),
    updatedAt: raw.updatedAt || Date.now(),
    updatedBy: String(raw.updatedBy || "")
  };
}

function totalQty(item) {
  return integer(item.cases) * integer(item.unitsPerCase) + integer(item.looseUnits);
}

function unitCost(item) {
  const direct = nonNegative(item.unitCost);
  if (direct > 0) return direct;
  const pack = integer(item.unitsPerCase);
  return pack > 0 ? nonNegative(item.caseCost) / pack : 0;
}

function calculate(item) {
  const quantity = totalQty(item);
  const costEach = unitCost(item);
  const sellingEach = nonNegative(item.sellingPrice);
  const stockCost = quantity * costEach;
  const salesValue = quantity * sellingEach;
  const profit = salesValue - stockCost;
  const markup = costEach > 0 ? ((sellingEach - costEach) / costEach) * 100 : 0;
  return { quantity, costEach, sellingEach, stockCost, salesValue, profit, markup };
}

function totals(items = state.items) {
  return items.reduce((acc, item) => {
    const calc = calculate(item);
    acc.products += 1;
    acc.cases += integer(item.cases);
    acc.units += calc.quantity;
    acc.cost += calc.stockCost;
    acc.sales += calc.salesValue;
    acc.profit += calc.profit;
    return acc;
  }, { products: 0, cases: 0, units: 0, cost: 0, sales: 0, profit: 0 });
}

function roleInfo() {
  return ROLES[state.profile?.role] || null;
}

function canWriteInventory() {
  return Boolean(roleInfo()?.writeInventory);
}

function canUseSection(section) {
  const allowedByRole = roleInfo()?.sections?.includes(section);
  if (!allowedByRole) return false;
  if (entryMode === "alcohol") return ["overview", "alcohol", "history"].includes(section);
  return true;
}

function initials(name) {
  const parts = String(name || "User").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "U";
}

function toast(message, type = "success") {
  let wrap = document.getElementById("toastWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "toastWrap";
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }
  const node = document.createElement("div");
  node.className = `toast ${type === "error" ? "error" : ""}`;
  node.textContent = message;
  wrap.appendChild(node);
  window.setTimeout(() => node.remove(), 3600);
}

function authErrorMessage(error) {
  const code = error?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "The email address or password is incorrect.";
  }
  if (code.includes("too-many-requests")) return "Too many attempts. Please wait and try again.";
  if (code.includes("network-request-failed")) return "Network error. Check the internet connection.";
  if (code.includes("invalid-email")) return "Enter a valid email address.";
  return error?.message || "The request could not be completed.";
}

function renderLoading(text = "Connecting securely to Firebase…") {
  appRoot.innerHTML = `
    <main class="center-page">
      <section class="center-card">
        <div class="spinner"></div>
        <h1>Please wait</h1>
        <p>${escapeHtml(text)}</p>
      </section>
    </main>
  `;
}

function renderLogin(message = "", messageType = "error") {
  const isAlcohol = entryMode === "alcohol";
  appRoot.innerHTML = `
    <main class="auth-page">
      <section class="auth-panel">
        <div class="auth-brand">
          <div class="brand-seal">PKD</div>
          <div>
            <h1>Price King Distributors</h1>
            <p>Secure Inventory System</p>
          </div>
        </div>

        <div class="auth-copy">
          <div class="eyebrow">${isAlcohol ? "ALCOHOL COUNT PORTAL" : "MANAGEMENT PORTAL"}</div>
          <h2>${isAlcohol ? "Alcohol Inventory Login" : "Management Login"}</h2>
          <p>
            ${isAlcohol
              ? "Sign in with the account assigned to alcohol counting. Inventory changes synchronize immediately across authorized devices."
              : "Authorized administrators can manage inventory, staff access, count history and system activity."}
          </p>
        </div>

        <form id="loginForm" class="auth-form">
          <div class="field">
            <label for="loginEmail">Email address</label>
            <input id="loginEmail" type="email" autocomplete="username" placeholder="name@company.com" required>
          </div>
          <div class="field">
            <label for="loginPassword">Password</label>
            <input id="loginPassword" type="password" autocomplete="current-password" placeholder="Enter password" required>
          </div>
          ${message ? `<div class="auth-message ${messageType}">${escapeHtml(message)}</div>` : ""}
          <button id="loginButton" class="btn btn-primary" type="submit">Sign In Securely</button>
          <div class="auth-links">
            <button id="resetPasswordButton" class="text-btn" type="button">Forgot password?</button>
          </div>
        </form>

        <div class="portal-switch">
          ${isAlcohol
            ? 'Administrator? <a href="../index.html">Open Management Portal</a>'
            : 'Alcohol-count staff? <a href="pages/alcohol.html">Open Alcohol Count Login</a>'}
        </div>
      </section>

      <aside class="auth-visual">
        <div class="visual-content">
          <div class="line"></div>
          <h2>Accurate stock.<br>Clear decisions.</h2>
          <p>Manage cases, loose units, cost prices, selling prices, stock value and potential profit from one synchronized system.</p>
        </div>
      </aside>
    </main>
  `;

  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    const button = $("loginButton");
    button.disabled = true;
    button.textContent = "Signing in…";
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      renderLogin(authErrorMessage(error), "error");
    }
  });

  $("resetPasswordButton").addEventListener("click", async () => {
    const email = $("loginEmail").value.trim();
    if (!email) {
      renderLogin("Enter your email address first, then select Forgot password.", "error");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      renderLogin("A password-reset email was sent. Check your inbox.", "success");
    } catch (error) {
      renderLogin(authErrorMessage(error), "error");
    }
  });
}

function renderAccessDenied(reason) {
  appRoot.innerHTML = `
    <main class="center-page">
      <section class="center-card">
        <div class="brand-seal">PKD</div>
        <h1>Access has not been granted</h1>
        <p>${escapeHtml(reason)}</p>
        <button id="deniedSignOut" class="btn btn-primary" type="button">Return to Login</button>
      </section>
    </main>
  `;
  $("deniedSignOut").addEventListener("click", () => signOut(auth));
}

function sectionTitle(section) {
  const titles = {
    overview: ["Dashboard Overview", "Realtime inventory and system summary"],
    alcohol: ["Alcohol Inventory Count", "Cases, units, costs and selling-price control"],
    history: ["Count History", "Saved stock-count snapshots"],
    audit: ["Activity Log", "Recorded changes made by authorized users"],
    users: ["User Access", "Assign roles and control portal access"]
  };
  return titles[section] || titles.overview;
}

function navButton(section, icon, label) {
  if (!canUseSection(section)) return "";
  return `<button class="nav-btn ${state.currentSection === section ? "active" : ""}" type="button" data-section="${section}">
    <span class="nav-icon">${icon}</span><span>${label}</span>
  </button>`;
}

function renderAppShell() {
  const profile = state.profile;
  const [title, subtitle] = sectionTitle(state.currentSection);

  appRoot.innerHTML = `
    <div class="app-shell">
      <aside id="sidebar" class="sidebar">
        <div class="sidebar-brand">
          <div class="brand-seal">PKD</div>
          <div><h1>Price King</h1><p>Inventory Portal</p></div>
        </div>

        <div class="nav-label">WORKSPACE</div>
        <nav class="nav-list">
          ${navButton("overview", "⌂", "Overview")}
          ${navButton("alcohol", "▦", "Alcohol Count")}
          ${navButton("history", "◷", "Count History")}
          ${navButton("audit", "≡", "Activity Log")}
          ${navButton("users", "♙", "User Access")}
        </nav>

        <div class="sidebar-user">
          <div class="user-line">
            <div class="user-avatar">${escapeHtml(initials(profile.displayName || state.user.email))}</div>
            <div>
              <strong title="${escapeHtml(profile.displayName || state.user.email)}">${escapeHtml(profile.displayName || state.user.email)}</strong>
              <small>${escapeHtml(ROLES[profile.role]?.label || profile.role)}</small>
            </div>
          </div>
          <button id="signOutButton" class="signout-btn" type="button">Sign Out</button>
        </div>
      </aside>

      <div class="main-column">
        <header class="topbar">
          <div class="topbar-left">
            <button id="mobileMenuButton" class="mobile-menu" type="button">☰</button>
            <div>
              <h2 id="topbarTitle">${escapeHtml(title)}</h2>
              <p id="topbarSubtitle">${escapeHtml(subtitle)}</p>
            </div>
          </div>
          <div class="topbar-actions">
            <div id="syncChip" class="sync-chip ${state.connected ? "" : "offline"}">
              <span class="sync-dot"></span>
              <span>${state.connected ? "Firebase Synced" : "Connecting…"}</span>
            </div>
            <button id="printButton" class="btn btn-secondary" type="button">Print</button>
          </div>
        </header>

        <main class="main-content">
          <section id="section-overview" class="page-section ${state.currentSection === "overview" ? "active" : ""}"></section>
          <section id="section-alcohol" class="page-section ${state.currentSection === "alcohol" ? "active" : ""}"></section>
          <section id="section-history" class="page-section ${state.currentSection === "history" ? "active" : ""}"></section>
          <section id="section-audit" class="page-section ${state.currentSection === "audit" ? "active" : ""}"></section>
          <section id="section-users" class="page-section ${state.currentSection === "users" ? "active" : ""}"></section>
        </main>
      </div>
    </div>
    <div id="modalHost"></div>
    <div id="toastWrap" class="toast-wrap"></div>
  `;

  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => showSection(button.dataset.section));
  });

  $("signOutButton").addEventListener("click", async () => {
    await addAudit("logout", "Signed out");
    await signOut(auth);
  });

  $("mobileMenuButton").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  $("printButton").addEventListener("click", () => window.print());

  renderCurrentSection();
}

function showSection(section) {
  if (!canUseSection(section)) return;
  state.currentSection = section;
  const [title, subtitle] = sectionTitle(section);
  document.querySelectorAll(".page-section").forEach((node) => node.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((node) => node.classList.toggle("active", node.dataset.section === section));
  $(`section-${section}`)?.classList.add("active");
  $("topbarTitle").textContent = title;
  $("topbarSubtitle").textContent = subtitle;
  $("sidebar")?.classList.remove("open");
  renderCurrentSection();
}

function renderCurrentSection() {
  if (state.currentSection === "overview") renderOverview();
  if (state.currentSection === "alcohol") renderAlcohol();
  if (state.currentSection === "history") renderHistory();
  if (state.currentSection === "audit") renderAudit();
  if (state.currentSection === "users") renderUsers();
}

function updateSyncChip() {
  const chip = $("syncChip");
  if (!chip) return;
  chip.classList.toggle("offline", !state.connected);
  chip.querySelector("span:last-child").textContent = state.connected ? "Firebase Synced" : "Offline / Connecting";
}

function renderOverview() {
  const target = $("section-overview");
  if (!target) return;
  const sum = totals();
  const recent = state.logs.slice(0, 5);
  const today = new Date();

  target.innerHTML = `
    <section class="hero-card card">
      <div>
        <div class="eyebrow">${entryMode === "alcohol" ? "ALCOHOL COUNT WORKSPACE" : "MANAGEMENT WORKSPACE"}</div>
        <h1>Welcome, ${escapeHtml(state.profile.displayName || state.user.email)}.</h1>
        <p>The figures below update automatically whenever an authorized user changes the alcohol inventory.</p>
      </div>
      <div class="hero-aside">
        <div class="hero-date">
          <span>Current count date</span>
          <strong>${escapeHtml(formatDate(state.settings.countDate))}</strong>
        </div>
      </div>
    </section>

    <section class="kpi-grid">
      <article class="kpi-card"><span>Products</span><strong>${formatNumber(sum.products)}</strong></article>
      <article class="kpi-card"><span>Total Units</span><strong>${formatNumber(sum.units)}</strong></article>
      <article class="kpi-card"><span>Full Cases</span><strong>${formatNumber(sum.cases)}</strong></article>
      <article class="kpi-card gold"><span>Stock Cost</span><strong>${formatMoney(sum.cost)}</strong></article>
      <article class="kpi-card gold"><span>Sales Value</span><strong>${formatMoney(sum.sales)}</strong></article>
      <article class="kpi-card green"><span>Potential Profit</span><strong class="${sum.profit < 0 ? "negative" : ""}">${formatMoney(sum.profit)}</strong></article>
    </section>

    <section class="overview-grid">
      <article class="module-card card">
        <div class="eyebrow">ACTIVE MODULE</div>
        <h3>Alcohol Inventory Count</h3>
        <p>Track cases, units per case, loose bottles, cost prices, selling prices, stock value and profit. Every authorized device receives changes in realtime.</p>
        <div class="module-card-footer">
          <span class="status-badge">${state.connected ? "LIVE SYNC ACTIVE" : "WAITING FOR CONNECTION"}</span>
          <button id="openAlcoholButton" class="btn btn-primary" type="button">Open Alcohol Count</button>
        </div>
      </article>

      <article class="activity-preview card">
        <div class="eyebrow">RECENT SYSTEM ACTIVITY</div>
        <h3>${state.profile.role === "admin" ? "Latest changes" : "Your workspace"}</h3>
        <div class="mini-list">
          ${state.profile.role === "admin" && recent.length
            ? recent.map((log) => `
                <div class="mini-row">
                  <div><strong>${escapeHtml(log.actionLabel || log.action || "Activity")}</strong><span>${escapeHtml(log.userEmail || "")}</span></div>
                  <span>${escapeHtml(formatDateTime(log.timestamp))}</span>
                </div>`).join("")
            : `<div class="mini-row"><div><strong>Realtime inventory</strong><span>Changes save directly to Firebase</span></div><span>${state.connected ? "Online" : "Connecting"}</span></div>
               <div class="mini-row"><div><strong>Access role</strong><span>${escapeHtml(ROLES[state.profile.role]?.label || state.profile.role)}</span></div><span>Active</span></div>`}
        </div>
      </article>
    </section>
  `;

  $("openAlcoholButton").addEventListener("click", () => showSection("alcohol"));
}

function inventoryFilters() {
  const categories = [...new Set(state.items.map((item) => item.category).filter(Boolean))].sort();
  return `
    <div class="toolbar-left">
      <input id="inventorySearch" type="search" placeholder="Search product, size or supplier" value="${escapeHtml(state.search)}">
      <select id="inventoryCategory">
        <option value="">All categories</option>
        ${categories.map((category) => `<option value="${escapeHtml(category)}" ${state.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
      </select>
    </div>
    <div class="toolbar-right">
      <select id="pageSize">
        ${[25,50,100,250].map((size) => `<option value="${size}" ${state.pageSize === size ? "selected" : ""}>${size} rows</option>`).join("")}
      </select>
    </div>
  `;
}

function filteredItems() {
  const search = state.search.trim().toLowerCase();
  return state.items.filter((item) => {
    const matchesCategory = !state.category || item.category === state.category;
    const haystack = `${item.name} ${item.category} ${item.size} ${item.supplier}`.toLowerCase();
    return matchesCategory && (!search || haystack.includes(search));
  });
}

function renderAlcohol() {
  const target = $("section-alcohol");
  if (!target) return;
  const canWrite = canWriteInventory();
  const sum = totals();

  target.innerHTML = `
    <section class="card">
      <div class="inventory-header">
        <div class="section-heading">
          <div>
            <div class="eyebrow">ALCOHOL INVENTORY</div>
            <h2>${escapeHtml(state.settings.businessName || "Price King Distributors")}</h2>
            <p>Count date: <strong>${escapeHtml(formatDate(state.settings.countDate))}</strong> · Firebase keeps all authorized devices synchronized.</p>
          </div>
          <div class="section-actions">
            ${canWrite ? '<button id="addItemButton" class="btn btn-primary" type="button">＋ Add Item</button>' : ""}
            ${canWrite ? '<button id="importButton" class="btn btn-secondary" type="button">Upload Excel/CSV</button>' : ""}
            ${canWrite ? '<button id="inventorySettingsButton" class="btn btn-secondary" type="button">Count Settings</button>' : ""}
            <button id="exportCsvButton" class="btn btn-secondary" type="button">Export CSV</button>
            <button id="exportExcelButton" class="btn btn-secondary" type="button">Export Excel</button>
            ${canWrite ? '<button id="saveSnapshotButton" class="btn btn-gold" type="button">Save Count Snapshot</button>' : ""}
          </div>
        </div>
      </div>
      <div class="toolbar">${inventoryFilters()}</div>
    </section>

    <section class="kpi-grid">
      <article class="kpi-card"><span>Products</span><strong>${formatNumber(sum.products)}</strong></article>
      <article class="kpi-card"><span>Total Units</span><strong>${formatNumber(sum.units)}</strong></article>
      <article class="kpi-card"><span>Full Cases</span><strong>${formatNumber(sum.cases)}</strong></article>
      <article class="kpi-card gold"><span>Stock Cost</span><strong>${formatMoney(sum.cost)}</strong></article>
      <article class="kpi-card gold"><span>Sales Value</span><strong>${formatMoney(sum.sales)}</strong></article>
      <article class="kpi-card green"><span>Potential Profit</span><strong>${formatMoney(sum.profit)}</strong></article>
    </section>

    <section class="table-card card">
      <div class="table-scroll">
        <table id="inventoryTable">
          <thead>
            <tr>
              <th class="sticky-name">Product Name</th>
              <th>Category</th>
              <th>Size</th>
              <th>Cases</th>
              <th>Units/Case</th>
              <th>Loose</th>
              <th>Total Qty</th>
              <th class="price-header">Case Cost</th>
              <th class="price-header">Unit Cost</th>
              <th class="price-header">Selling/Unit</th>
              <th>Stock Cost</th>
              <th>Sales Value</th>
              <th>Profit</th>
              <th>Markup</th>
              <th>Supplier</th>
              ${canWrite ? "<th>Actions</th>" : ""}
            </tr>
          </thead>
          <tbody id="inventoryBody"></tbody>
          <tfoot id="inventoryFoot"></tfoot>
        </table>
        <div id="inventoryEmpty" class="empty-state hidden">
          <div class="icon">▦</div>
          <h3>No inventory items found</h3>
          <p>${canWrite ? "Add an item or upload an Excel/CSV inventory file." : "No stock has been entered yet."}</p>
        </div>
      </div>
      <div class="pagination">
        <span id="paginationInfo"></span>
        <div>
          <button id="prevPage" class="btn btn-secondary btn-small" type="button">Previous</button>
          <span id="pageIndicator"></span>
          <button id="nextPage" class="btn btn-secondary btn-small" type="button">Next</button>
        </div>
      </div>
    </section>
  `;

  bindInventoryToolbar();
  renderInventoryRows();

  if (canWrite) {
    $("addItemButton").addEventListener("click", () => openItemModal());
    $("importButton").addEventListener("click", openImportModal);
    $("inventorySettingsButton").addEventListener("click", openInventorySettingsModal);
    $("saveSnapshotButton").addEventListener("click", saveCountSnapshot);
  }
  $("exportCsvButton").addEventListener("click", exportCsv);
  $("exportExcelButton").addEventListener("click", exportExcel);
}

function bindInventoryToolbar() {
  $("inventorySearch").addEventListener("input", (event) => {
    state.search = event.target.value;
    state.page = 1;
    renderInventoryRows();
  });
  $("inventoryCategory").addEventListener("change", (event) => {
    state.category = event.target.value;
    state.page = 1;
    renderInventoryRows();
  });
  $("pageSize").addEventListener("change", (event) => {
    state.pageSize = integer(event.target.value) || 50;
    state.page = 1;
    renderInventoryRows();
  });
  $("prevPage").addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      renderInventoryRows();
    }
  });
  $("nextPage").addEventListener("click", () => {
    const pages = Math.max(1, Math.ceil(filteredItems().length / state.pageSize));
    if (state.page < pages) {
      state.page += 1;
      renderInventoryRows();
    }
  });
}

function renderInventoryRows() {
  const body = $("inventoryBody");
  if (!body) return;

  const canWrite = canWriteInventory();
  const filtered = filteredItems();
  const pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const rows = filtered.slice(start, start + state.pageSize);

  $("inventoryEmpty").classList.toggle("hidden", filtered.length > 0);
  $("inventoryTable").classList.toggle("hidden", filtered.length === 0);

  body.innerHTML = rows.map((item) => {
    const calc = calculate(item);
    const low = item.reorderLevel > 0 && calc.quantity <= item.reorderLevel;
    return `
      <tr class="${low ? "low-stock" : ""}">
        <td class="sticky-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}${low ? '<span class="low-badge">LOW</span>' : ""}</td>
        <td>${escapeHtml(item.category)}</td>
        <td>${escapeHtml(item.size)}</td>
        <td>${formatNumber(item.cases)}</td>
        <td>${formatNumber(item.unitsPerCase)}</td>
        <td>${formatNumber(item.looseUnits)}</td>
        <td><strong>${formatNumber(calc.quantity)}</strong></td>
        <td class="price-cell">${formatMoney(item.caseCost)}</td>
        <td class="price-cell">${formatMoney(calc.costEach)}</td>
        <td class="price-cell">${formatMoney(item.sellingPrice)}</td>
        <td>${formatMoney(calc.stockCost)}</td>
        <td>${formatMoney(calc.salesValue)}</td>
        <td class="${calc.profit < 0 ? "negative" : "positive"}">${formatMoney(calc.profit)}</td>
        <td>${formatNumber(calc.markup,1)}%</td>
        <td>${escapeHtml(item.supplier || "—")}</td>
        ${canWrite ? `<td><div class="row-actions">
          <button class="row-btn edit-item" data-id="${escapeHtml(item.id)}" type="button">Edit</button>
          <button class="row-btn delete delete-item" data-id="${escapeHtml(item.id)}" type="button">Delete</button>
        </div></td>` : ""}
      </tr>
    `;
  }).join("");

  const filteredTotals = totals(filtered);
  $("inventoryFoot").innerHTML = filtered.length ? `
    <tr>
      <td colspan="3">FILTERED TOTAL</td>
      <td>${formatNumber(filteredTotals.cases)}</td>
      <td></td><td></td>
      <td>${formatNumber(filteredTotals.units)}</td>
      <td></td><td></td><td></td>
      <td>${formatMoney(filteredTotals.cost)}</td>
      <td>${formatMoney(filteredTotals.sales)}</td>
      <td>${formatMoney(filteredTotals.profit)}</td>
      <td colspan="${canWrite ? 3 : 2}"></td>
    </tr>` : "";

  $("paginationInfo").textContent = filtered.length
    ? `Showing ${formatNumber(start + 1)}–${formatNumber(Math.min(start + state.pageSize, filtered.length))} of ${formatNumber(filtered.length)}`
    : "Showing 0 items";
  $("pageIndicator").textContent = `Page ${state.page} of ${pages}`;
  $("prevPage").disabled = state.page <= 1;
  $("nextPage").disabled = state.page >= pages;

  document.querySelectorAll(".edit-item").forEach((button) => {
    button.addEventListener("click", () => openItemModal(state.items.find((item) => item.id === button.dataset.id)));
  });
  document.querySelectorAll(".delete-item").forEach((button) => {
    button.addEventListener("click", () => deleteInventoryItem(button.dataset.id));
  });
}

function openModal(content, small = false) {
  const host = $("modalHost");
  host.innerHTML = `<div id="modalBackdrop" class="modal-backdrop"><section class="modal ${small ? "small" : ""}">${content}</section></div>`;
  $("modalBackdrop").addEventListener("mousedown", (event) => {
    if (event.target.id === "modalBackdrop") closeModal();
  });
  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModal));
}

function closeModal() {
  const host = $("modalHost");
  if (host) host.innerHTML = "";
}

function openInventorySettingsModal() {
  openModal(`
    <form id="inventorySettingsForm">
      <div class="modal-header">
        <div><div class="eyebrow">ALCOHOL INVENTORY</div><h2>Count Settings</h2></div>
        <button class="icon-btn" type="button" data-close-modal>×</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="field full-span">
            <label for="settingsBusinessName">Business / report name</label>
            <input id="settingsBusinessName" type="text" maxlength="100" value="${escapeHtml(state.settings.businessName || "Price King Distributors")}">
          </div>
          <div class="field">
            <label for="settingsCountDate">Count date</label>
            <input id="settingsCountDate" type="date" value="${escapeHtml(state.settings.countDate || new Date().toISOString().slice(0,10))}">
          </div>
          <div class="field">
            <label for="settingsCurrency">Currency</label>
            <select id="settingsCurrency">
              ${["GYD","USD","CAD","TTD","JMD","BBD"].map((currency) => `<option value="${currency}" ${state.settings.currency === currency ? "selected" : ""}>${currency}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="settingsMarkup">Default markup %</label>
            <input id="settingsMarkup" type="number" min="0" step="0.01" value="${nonNegative(state.settings.defaultMarkup)}">
          </div>
          <div class="field">
            <label>Firebase synchronization</label>
            <input type="text" value="${state.connected ? "Connected and synchronized" : "Waiting for connection"}" readonly>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-close-modal>Cancel</button>
        <button id="saveInventorySettings" class="btn btn-primary" type="submit">Save Settings</button>
      </div>
    </form>
  `, true);

  $("inventorySettingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      businessName: $("settingsBusinessName").value.trim() || "Price King Distributors",
      countDate: $("settingsCountDate").value || new Date().toISOString().slice(0,10),
      currency: $("settingsCurrency").value,
      defaultMarkup: nonNegative($("settingsMarkup").value),
      updatedAt: serverTimestamp(),
      updatedBy: state.user.uid
    };
    const button = $("saveInventorySettings");
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      await set(ref(database, PATHS.settings), payload);
      await addAudit("settings_updated", `Updated alcohol count settings for ${payload.countDate}`);
      closeModal();
      toast("Count settings saved and synchronized.");
    } catch (error) {
      toast(firebaseWriteMessage(error), "error");
      button.disabled = false;
      button.textContent = "Save Settings";
    }
  });
}

function openItemModal(item = null) {
  const editing = Boolean(item);
  const current = sanitizeItem(item || {
    category: "Rum",
    cases: 0,
    unitsPerCase: 12,
    looseUnits: 0,
    reorderLevel: 0
  });

  openModal(`
    <form id="itemForm">
      <div class="modal-header">
        <div><div class="eyebrow">ALCOHOL INVENTORY</div><h2>${editing ? "Edit Inventory Item" : "Add Inventory Item"}</h2></div>
        <button class="icon-btn" type="button" data-close-modal>×</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="field full-span">
            <label for="itemName">Product name <em>*</em></label>
            <input id="itemName" type="text" value="${escapeHtml(current.name)}" placeholder="Example: Johnnie Walker Black Label" required>
          </div>
          <div class="field">
            <label for="itemCategory">Category</label>
            <select id="itemCategory">
              ${["Rum","Whisky / Whiskey","Wine","Beer / Stout","Vodka","Gin","Tequila / Mezcal","Brandy / Cognac","Champagne / Sparkling","Liqueur","Cider","Ready-to-Drink","Other"].map((category) =>
                `<option value="${escapeHtml(category)}" ${current.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`
              ).join("")}
            </select>
          </div>
          <div class="field">
            <label for="itemSize">Bottle size</label>
            <input id="itemSize" type="text" value="${escapeHtml(current.size)}" placeholder="750ML">
          </div>

          <section class="quantity-box full-span">
            <h3 class="box-title">Stock Count</h3>
            <div class="form-grid three">
              <div class="field"><label for="itemCases">Number of cases</label><input id="itemCases" type="number" min="0" step="1" value="${current.cases}"></div>
              <div class="field"><label for="itemUnitsPerCase">Units in each case</label><input id="itemUnitsPerCase" type="number" min="0" step="1" value="${current.unitsPerCase}"></div>
              <div class="field"><label for="itemLooseUnits">Loose units</label><input id="itemLooseUnits" type="number" min="0" step="1" value="${current.looseUnits}"></div>
            </div>
            <div class="calc-strip">
              <div class="calc-item"><span>Total Quantity</span><strong id="formTotalQty">0</strong></div>
              <div class="calc-item"><span>Full Cases</span><strong id="formCases">0</strong></div>
              <div class="calc-item"><span>Loose Units</span><strong id="formLoose">0</strong></div>
            </div>
          </section>

          <section class="price-box full-span">
            <h3 class="box-title">Cost and Selling Prices</h3>
            <div class="form-grid">
              <div class="field"><label for="itemCaseCost">Cost per case</label><input id="itemCaseCost" type="number" min="0" step="0.01" value="${current.caseCost || ""}" placeholder="0.00"></div>
              <div class="field"><label for="itemUnitCost">Cost per unit</label><input id="itemUnitCost" type="number" min="0" step="0.01" value="${current.unitCost || ""}" placeholder="Auto from case cost"></div>
              <div class="field"><label for="itemSellingPrice">Selling price per unit</label><input id="itemSellingPrice" type="number" min="0" step="0.01" value="${current.sellingPrice || ""}" placeholder="0.00"></div>
              <div class="field">
                <label for="itemMarkup">Markup %</label>
                <div style="display:grid;grid-template-columns:1fr auto">
                  <input id="itemMarkup" style="border-radius:8px 0 0 8px" type="number" min="0" step="0.01" value="${calculate(current).markup || state.settings.defaultMarkup}">
                  <button id="applyMarkup" class="btn btn-primary" style="border-radius:0 8px 8px 0" type="button">Apply</button>
                </div>
              </div>
            </div>
            <div class="calc-strip">
              <div class="calc-item"><span>Unit Cost</span><strong id="formUnitCost">${formatMoney(0)}</strong></div>
              <div class="calc-item"><span>Profit Per Unit</span><strong id="formUnitProfit">${formatMoney(0)}</strong></div>
              <div class="calc-item"><span>Potential Profit</span><strong id="formProfit">${formatMoney(0)}</strong></div>
            </div>
          </section>

          <div class="field"><label for="itemSupplier">Supplier</label><input id="itemSupplier" type="text" value="${escapeHtml(current.supplier)}" placeholder="Optional"></div>
          <div class="field"><label for="itemReorder">Reorder level</label><input id="itemReorder" type="number" min="0" step="1" value="${current.reorderLevel}"></div>
          <div class="field full-span"><label for="itemNotes">Notes</label><textarea id="itemNotes" rows="2">${escapeHtml(current.notes)}</textarea></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-close-modal>Cancel</button>
        <button id="saveItemButton" class="btn btn-primary" type="submit">${editing ? "Save Changes" : "Add Item"}</button>
      </div>
    </form>
  `);

  const preview = () => {
    const temp = {
      cases: integer($("itemCases").value),
      unitsPerCase: integer($("itemUnitsPerCase").value),
      looseUnits: integer($("itemLooseUnits").value),
      caseCost: nonNegative($("itemCaseCost").value),
      unitCost: nonNegative($("itemUnitCost").value),
      sellingPrice: nonNegative($("itemSellingPrice").value)
    };
    const calc = calculate(temp);
    $("formTotalQty").textContent = formatNumber(calc.quantity);
    $("formCases").textContent = formatNumber(temp.cases);
    $("formLoose").textContent = formatNumber(temp.looseUnits);
    $("formUnitCost").textContent = formatMoney(calc.costEach);
    $("formUnitProfit").textContent = formatMoney(calc.sellingEach - calc.costEach);
    $("formProfit").textContent = formatMoney(calc.profit);
  };

  ["itemCases","itemUnitsPerCase","itemLooseUnits","itemCaseCost","itemUnitCost","itemSellingPrice"].forEach((id) => $(id).addEventListener("input", preview));
  $("applyMarkup").addEventListener("click", () => {
    const cost = unitCost({
      unitsPerCase: $("itemUnitsPerCase").value,
      caseCost: $("itemCaseCost").value,
      unitCost: $("itemUnitCost").value
    });
    if (cost <= 0) {
      toast("Enter the case cost or unit cost first.", "error");
      return;
    }
    const markup = nonNegative($("itemMarkup").value || state.settings.defaultMarkup);
    $("itemSellingPrice").value = (cost * (1 + markup / 100)).toFixed(2);
    preview();
  });
  preview();

  $("itemForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("itemName").value.trim();
    if (!name) return toast("Enter a product name.", "error");

    const itemId = current.id || uid();
    const payload = {
      id: itemId,
      name,
      category: $("itemCategory").value,
      size: $("itemSize").value.trim(),
      cases: integer($("itemCases").value),
      unitsPerCase: integer($("itemUnitsPerCase").value),
      looseUnits: integer($("itemLooseUnits").value),
      caseCost: nonNegative($("itemCaseCost").value),
      unitCost: nonNegative($("itemUnitCost").value),
      sellingPrice: nonNegative($("itemSellingPrice").value),
      supplier: $("itemSupplier").value.trim(),
      reorderLevel: integer($("itemReorder").value),
      notes: $("itemNotes").value.trim(),
      updatedAt: serverTimestamp(),
      updatedBy: state.user.uid
    };

    const saveButton = $("saveItemButton");
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
    try {
      await set(ref(database, `${PATHS.items}/${itemId}`), payload);
      await addAudit(editing ? "item_updated" : "item_added", `${editing ? "Updated" : "Added"} ${name}`, { itemId, itemName: name });
      closeModal();
      toast(editing ? "Inventory item updated." : "Inventory item added.");
    } catch (error) {
      console.error(error);
      toast(firebaseWriteMessage(error), "error");
      saveButton.disabled = false;
      saveButton.textContent = editing ? "Save Changes" : "Add Item";
    }
  });
}

async function deleteInventoryItem(itemId) {
  const item = state.items.find((entry) => entry.id === itemId);
  if (!item) return;
  if (!window.confirm(`Delete "${item.name}" from the alcohol inventory?`)) return;
  try {
    await remove(ref(database, `${PATHS.items}/${itemId}`));
    await addAudit("item_deleted", `Deleted ${item.name}`, { itemId, itemName: item.name });
    toast("Inventory item deleted.");
  } catch (error) {
    console.error(error);
    toast(firebaseWriteMessage(error), "error");
  }
}

function firebaseWriteMessage(error) {
  if (String(error?.code || "").includes("permission-denied")) {
    return "Firebase denied this change. Check the user's role and Realtime Database Rules.";
  }
  return error?.message || "The change could not be saved.";
}

const HEADER_ALIASES = {
  name: ["product name","product","item name","item","rum name","alcohol name","description","name"],
  category: ["category","type","alcohol type","product category"],
  size: ["size","bottle size","volume","ml"],
  cases: ["cases","case qty","case quantity","number of cases","case count"],
  unitsPerCase: ["units per case","qty per case","quantity per case","bottles per case","pieces per case","pack size","case pack","how much in a case"],
  looseUnits: ["loose units","loose qty","loose quantity","single units","loose bottles"],
  totalQty: ["qty","quantity","total qty","total quantity","stock qty","stock quantity","count"],
  caseCost: ["case cost","cost per case","case price","wholesale case price"],
  unitCost: ["cost per unit","unit cost","cost price","buying price","unit price"],
  sellingPrice: ["selling price","selling price per unit","shelf price","js shelf price","retail price","sale price"],
  supplier: ["supplier","vendor","distributor"],
  reorderLevel: ["reorder level","minimum stock","min stock","low stock level"],
  notes: ["notes","remarks","comment","comments"]
};

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[_/-]+/g, " ")
    .replace(/[^a-z0-9% ]/g, "")
    .replace(/\s+/g, " ").trim();
}

function fieldForHeader(header) {
  const normalized = normalizeHeader(header);
  if (!normalized) return "";
  if (normalized.includes("total") && (normalized.includes("price") || normalized.includes("value"))) {
    if (HEADER_ALIASES.totalQty.includes(normalized)) return "totalQty";
    return "";
  }
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return field;
  }
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((alias) => normalized.includes(alias) || alias.includes(normalized))) return field;
  }
  return "";
}

function detectHeaderRow(matrix) {
  let bestIndex = 0;
  let bestScore = -1;
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 30); rowIndex += 1) {
    const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
    const fields = new Set(row.map(fieldForHeader).filter(Boolean));
    let score = fields.size + (fields.has("name") ? 5 : 0) + (fields.has("totalQty") || fields.has("cases") ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = rowIndex;
    }
  }
  return bestIndex;
}

async function parseImportFile(file) {
  if (!window.XLSX) throw new Error("The Excel import library did not load. Refresh and try again.");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error("No worksheet was found.");
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { header: 1, defval: "", raw: false, blankrows: false });
  if (!matrix.length) throw new Error("The uploaded file is empty.");

  const headerIndex = detectHeaderRow(matrix);
  const columnMap = {};
  (matrix[headerIndex] || []).forEach((header, index) => {
    const field = fieldForHeader(header);
    if (field && columnMap[field] === undefined) columnMap[field] = index;
  });
  if (columnMap.name === undefined) throw new Error("No Product Name, Item Name or Rum Name column was found.");

  const imported = [];
  for (const row of matrix.slice(headerIndex + 1)) {
    if (!Array.isArray(row)) continue;
    const getField = (field) => columnMap[field] === undefined ? "" : row[columnMap[field]];
    const name = String(getField("name") ?? "").trim();
    if (!name) continue;

    let cases = integer(getField("cases"));
    let unitsPerCase = integer(getField("unitsPerCase"));
    let looseUnits = integer(getField("looseUnits"));
    const suppliedTotal = integer(getField("totalQty"));

    if (suppliedTotal > 0) {
      if (cases > 0 && unitsPerCase > 0) {
        looseUnits = Math.max(0, suppliedTotal - cases * unitsPerCase);
      } else {
        cases = 0;
        looseUnits = suppliedTotal;
      }
    }

    imported.push(sanitizeItem({
      id: uid(),
      name,
      category: String(getField("category") || "Other").trim(),
      size: String(getField("size") || "").trim(),
      cases,
      unitsPerCase,
      looseUnits,
      caseCost: getField("caseCost"),
      unitCost: getField("unitCost"),
      sellingPrice: getField("sellingPrice"),
      supplier: getField("supplier"),
      reorderLevel: getField("reorderLevel"),
      notes: getField("notes"),
      updatedAt: Date.now(),
      updatedBy: state.user.uid
    }));
  }
  if (!imported.length) throw new Error("No inventory rows with product names were found.");
  return imported;
}

function openImportModal() {
  openModal(`
    <div class="modal-header">
      <div><div class="eyebrow">FIREBASE IMPORT</div><h2>Upload Excel or CSV</h2></div>
      <button class="icon-btn" type="button" data-close-modal>×</button>
    </div>
    <div class="modal-body">
      <div class="file-drop">
        <strong>Select an inventory file</strong>
        <p class="muted">Accepted: .xlsx, .xls and .csv · Maximum 20 MB</p>
        <input id="importFile" type="file" accept=".xlsx,.xls,.csv">
      </div>
      <div class="field import-options">
        <label for="importMode">Import method</label>
        <select id="importMode">
          <option value="replace">Replace the current alcohol inventory</option>
          <option value="append">Add imported rows to the current inventory</option>
        </select>
      </div>
      <p class="help-text">Recognized headings include Product Name, Rum Name, Size, Qty, Cases, Units Per Case, Cost Price, Cost Per Case and Selling Price.</p>
      <button id="downloadTemplate" class="text-btn" type="button">Download upload template</button>
      <div id="importMessage"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" type="button" data-close-modal>Cancel</button>
      <button id="runImport" class="btn btn-primary" type="button">Import to Firebase</button>
    </div>
  `, true);

  $("downloadTemplate").addEventListener("click", downloadTemplate);
  $("runImport").addEventListener("click", async () => {
    const file = $("importFile").files[0];
    const message = $("importMessage");
    if (!file) {
      message.innerHTML = '<div class="message error">Select an Excel or CSV file.</div>';
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      message.innerHTML = '<div class="message error">The file is larger than 20 MB.</div>';
      return;
    }

    const button = $("runImport");
    button.disabled = true;
    button.textContent = "Importing…";
    try {
      const imported = await parseImportFile(file);
      const mode = $("importMode").value;
      if (mode === "replace" && state.items.length) {
        const approved = window.confirm(`Replace ${state.items.length} current items with ${imported.length} imported items?`);
        if (!approved) {
          button.disabled = false;
          button.textContent = "Import to Firebase";
          return;
        }
      }

      const dataObject = {};
      if (mode === "append") {
        imported.forEach((item) => {
          dataObject[item.id] = { ...item, updatedAt: serverTimestamp() };
        });
        await update(ref(database, PATHS.items), dataObject);
      } else {
        imported.forEach((item) => {
          dataObject[item.id] = { ...item, updatedAt: Date.now() };
        });
        await set(ref(database, PATHS.items), dataObject);
      }

      await addAudit("inventory_imported", `Imported ${imported.length} alcohol inventory items`, { count: imported.length, mode });
      message.innerHTML = `<div class="message success">${imported.length} items imported and synchronized.</div>`;
      window.setTimeout(closeModal, 900);
    } catch (error) {
      console.error(error);
      message.innerHTML = `<div class="message error">${escapeHtml(error.message || firebaseWriteMessage(error))}</div>`;
      button.disabled = false;
      button.textContent = "Import to Firebase";
    }
  });
}

function exportRows(items = state.items) {
  return items.map((item, index) => {
    const calc = calculate(item);
    return {
      "No.": index + 1,
      "Product Name": item.name,
      "Category": item.category,
      "Size": item.size,
      "Cases": item.cases,
      "Units Per Case": item.unitsPerCase,
      "Loose Units": item.looseUnits,
      "Total Quantity": calc.quantity,
      "Cost Per Case": item.caseCost,
      "Cost Per Unit": calc.costEach,
      "Selling Price Per Unit": item.sellingPrice,
      "Total Stock Cost": calc.stockCost,
      "Total Sales Value": calc.salesValue,
      "Potential Profit": calc.profit,
      "Markup %": calc.markup,
      "Supplier": item.supplier,
      "Reorder Level": item.reorderLevel,
      "Notes": item.notes
    };
  });
}

function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function fileBase() {
  return `Price_King_Alcohol_Inventory_${state.settings.countDate || new Date().toISOString().slice(0,10)}`;
}

function exportCsv() {
  if (!state.items.length) return toast("There is no inventory to export.", "error");
  const rows = exportRows();
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ].join("\r\n");
  downloadBlob(`\uFEFF${csv}`, `${fileBase()}.csv`, "text/csv;charset=utf-8");
  addAudit("inventory_exported", "Exported alcohol inventory to CSV");
}

function exportExcel() {
  if (!state.items.length) return toast("There is no inventory to export.", "error");
  if (!window.XLSX) return exportCsv();
  const rows = exportRows();
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = Object.keys(rows[0]).map((header) => ({ wch: Math.min(36, Math.max(12, header.length + 2)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Alcohol Inventory");
  XLSX.writeFile(workbook, `${fileBase()}.xlsx`);
  addAudit("inventory_exported", "Exported alcohol inventory to Excel");
}

function downloadTemplate() {
  const headers = ["Product Name","Category","Size","Cases","Units Per Case","Loose Units","Cost Per Case","Cost Per Unit","Selling Price","Supplier","Reorder Level","Notes"];
  const sample = ["Johnnie Walker Black Label","Whisky / Whiskey","750ML",2,12,3,36000,"",2200,"Supplier Name",6,""];
  const csv = `${headers.map(csvEscape).join(",")}\r\n${sample.map(csvEscape).join(",")}`;
  downloadBlob(`\uFEFF${csv}`, "Price_King_Alcohol_Inventory_Upload_Template.csv", "text/csv;charset=utf-8");
}

async function saveCountSnapshot() {
  if (!state.items.length) return toast("Add inventory items before saving a snapshot.", "error");
  const approved = window.confirm(`Save a permanent count snapshot for ${formatDate(state.settings.countDate)}?`);
  if (!approved) return;

  const sum = totals();
  const snapshotItems = {};
  state.items.forEach((item) => {
    snapshotItems[item.id] = { ...item, updatedAt: number(item.updatedAt) || Date.now() };
  });

  try {
    const newRef = push(ref(database, PATHS.counts));
    await set(newRef, {
      id: newRef.key,
      countDate: state.settings.countDate,
      createdAt: serverTimestamp(),
      createdBy: state.user.uid,
      createdByEmail: state.user.email,
      itemCount: sum.products,
      totalCases: sum.cases,
      totalUnits: sum.units,
      stockCost: sum.cost,
      salesValue: sum.sales,
      potentialProfit: sum.profit,
      items: snapshotItems
    });
    await addAudit("count_snapshot_saved", `Saved count snapshot for ${state.settings.countDate}`, { sessionId: newRef.key });
    toast("Count snapshot saved.");
  } catch (error) {
    console.error(error);
    toast(firebaseWriteMessage(error), "error");
  }
}

function renderHistory() {
  const target = $("section-history");
  if (!target) return;
  target.innerHTML = `
    <div class="section-heading">
      <div><div class="eyebrow">COUNT RECORDS</div><h2>Saved Count Snapshots</h2><p>Snapshots preserve the inventory figures recorded on a specific count date.</p></div>
      <div class="section-actions">
        ${canWriteInventory() ? '<button id="historySaveSnapshot" class="btn btn-gold" type="button">Save Current Snapshot</button>' : ""}
      </div>
    </div>
    <section class="data-card card">
      ${state.sessions.length ? `
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr>
              <th>Count Date</th><th>Saved By</th><th class="number">Products</th><th class="number">Cases</th>
              <th class="number">Units</th><th class="number">Stock Cost</th><th class="number">Sales Value</th>
              <th class="number">Profit</th><th>Saved At</th><th>Actions</th>
            </tr></thead>
            <tbody>
              ${state.sessions.map((session) => `
                <tr>
                  <td><strong>${escapeHtml(formatDate(session.countDate))}</strong></td>
                  <td>${escapeHtml(session.createdByEmail || "—")}</td>
                  <td class="number">${formatNumber(session.itemCount)}</td>
                  <td class="number">${formatNumber(session.totalCases)}</td>
                  <td class="number">${formatNumber(session.totalUnits)}</td>
                  <td class="number">${formatMoney(session.stockCost)}</td>
                  <td class="number">${formatMoney(session.salesValue)}</td>
                  <td class="number ${number(session.potentialProfit) < 0 ? "negative" : "positive"}">${formatMoney(session.potentialProfit)}</td>
                  <td>${escapeHtml(formatDateTime(session.createdAt))}</td>
                  <td><div class="table-actions">
                    <button class="row-btn export-session" type="button" data-id="${escapeHtml(session.id)}">Export</button>
                    ${canWriteInventory() ? `<button class="row-btn restore-session" type="button" data-id="${escapeHtml(session.id)}">Restore</button>
                    <button class="row-btn delete delete-session" type="button" data-id="${escapeHtml(session.id)}">Delete</button>` : ""}
                  </div></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>` :
        `<div class="empty-state"><div class="icon">◷</div><h3>No count snapshots yet</h3><p>Save the current inventory to create the first historical record.</p></div>`}
    </section>
  `;

  $("historySaveSnapshot")?.addEventListener("click", saveCountSnapshot);
  document.querySelectorAll(".export-session").forEach((button) => button.addEventListener("click", () => exportSession(button.dataset.id)));
  document.querySelectorAll(".restore-session").forEach((button) => button.addEventListener("click", () => restoreSession(button.dataset.id)));
  document.querySelectorAll(".delete-session").forEach((button) => button.addEventListener("click", () => deleteSession(button.dataset.id)));
}

function sessionById(id) {
  return state.sessions.find((session) => session.id === id);
}

function exportSession(id) {
  const session = sessionById(id);
  if (!session?.items) return toast("This snapshot has no item details.", "error");
  const rows = exportRows(Object.entries(session.items).map(([key, item]) => sanitizeItem(item, key)));
  if (!rows.length) return toast("This snapshot is empty.", "error");
  const headers = Object.keys(rows[0]);
  const csv = [headers.map(csvEscape).join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\r\n");
  downloadBlob(`\uFEFF${csv}`, `Alcohol_Count_${session.countDate || id}.csv`, "text/csv;charset=utf-8");
}

async function restoreSession(id) {
  const session = sessionById(id);
  if (!session?.items) return;
  if (!window.confirm(`Replace the current inventory with the snapshot from ${formatDate(session.countDate)}?`)) return;
  try {
    const restored = {};
    Object.entries(session.items).forEach(([key, item]) => {
      restored[key] = { ...sanitizeItem(item, key), updatedAt: Date.now(), updatedBy: state.user.uid };
    });
    await set(ref(database, PATHS.items), restored);
    await addAudit("count_snapshot_restored", `Restored snapshot from ${session.countDate}`, { sessionId: id });
    toast("Snapshot restored to the current inventory.");
  } catch (error) {
    toast(firebaseWriteMessage(error), "error");
  }
}

async function deleteSession(id) {
  const session = sessionById(id);
  if (!session) return;
  if (!window.confirm(`Delete the saved snapshot from ${formatDate(session.countDate)}?`)) return;
  try {
    await remove(ref(database, `${PATHS.counts}/${id}`));
    await addAudit("count_snapshot_deleted", `Deleted snapshot from ${session.countDate}`, { sessionId: id });
    toast("Count snapshot deleted.");
  } catch (error) {
    toast(firebaseWriteMessage(error), "error");
  }
}

function renderAudit() {
  const target = $("section-audit");
  if (!target) return;
  target.innerHTML = `
    <div class="section-heading">
      <div><div class="eyebrow">AUDIT TRAIL</div><h2>System Activity Log</h2><p>Inventory and access changes recorded by Firebase.</p></div>
    </div>
    <section class="data-card card">
      ${state.logs.length ? `
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Date & Time</th><th>User</th><th>Action</th><th>Description</th><th>Module</th></tr></thead>
            <tbody>${state.logs.map((log) => `
              <tr>
                <td>${escapeHtml(formatDateTime(log.timestamp))}</td>
                <td>${escapeHtml(log.userEmail || log.uid || "—")}</td>
                <td><strong>${escapeHtml(log.actionLabel || log.action || "Activity")}</strong></td>
                <td>${escapeHtml(log.description || "")}</td>
                <td>${escapeHtml(log.module || "alcohol")}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>` :
        `<div class="empty-state"><div class="icon">≡</div><h3>No activity recorded</h3><p>New system changes will appear here.</p></div>`}
    </section>
  `;
}

function renderUsers() {
  const target = $("section-users");
  if (!target) return;
  target.innerHTML = `
    <div class="section-heading">
      <div><div class="eyebrow">ROLE-BASED ACCESS</div><h2>User Access Management</h2><p>Create the Authentication account in Firebase first, then add its UID and role here.</p></div>
      <div class="section-actions"><button id="addAccessButton" class="btn btn-primary" type="button">＋ Add Access Profile</button></div>
    </div>
    <section class="data-card card">
      ${state.users.length ? `
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Firebase UID</th><th>Role</th><th>Status</th><th>Last Login</th><th>Actions</th></tr></thead>
            <tbody>${state.users.map((user) => `
              <tr>
                <td><strong>${escapeHtml(user.displayName || "—")}</strong></td>
                <td>${escapeHtml(user.email || "—")}</td>
                <td><code>${escapeHtml(user.uid)}</code></td>
                <td><span class="role-badge ${user.role === "admin" ? "admin" : ""}">${escapeHtml(ROLES[user.role]?.label || user.role)}</span></td>
                <td><span class="role-badge ${user.active === false ? "inactive" : ""}">${user.active === false ? "Inactive" : "Active"}</span></td>
                <td>${escapeHtml(formatDateTime(user.lastLogin))}</td>
                <td><div class="table-actions">
                  <button class="row-btn edit-user" type="button" data-id="${escapeHtml(user.uid)}">Edit</button>
                  ${user.uid !== state.user.uid ? `<button class="row-btn delete delete-user" type="button" data-id="${escapeHtml(user.uid)}">Remove</button>` : ""}
                </div></td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>` :
        `<div class="empty-state"><div class="icon">♙</div><h3>No access profiles found</h3><p>Add a Firebase Authentication user's UID to grant portal access.</p></div>`}
    </section>
  `;

  $("addAccessButton").addEventListener("click", () => openUserModal());
  document.querySelectorAll(".edit-user").forEach((button) => button.addEventListener("click", () => openUserModal(state.users.find((user) => user.uid === button.dataset.id))));
  document.querySelectorAll(".delete-user").forEach((button) => button.addEventListener("click", () => deleteUserProfile(button.dataset.id)));
}

function openUserModal(user = null) {
  const editing = Boolean(user);
  openModal(`
    <form id="accessForm">
      <div class="modal-header">
        <div><div class="eyebrow">USER ACCESS</div><h2>${editing ? "Edit Access Profile" : "Add Access Profile"}</h2></div>
        <button class="icon-btn" type="button" data-close-modal>×</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="field full-span">
            <label for="accessUid">Firebase Authentication UID <em>*</em></label>
            <input id="accessUid" type="text" value="${escapeHtml(user?.uid || "")}" ${editing ? "readonly" : ""} required>
            <span class="help-text">Firebase Console → Authentication → Users → User UID.</span>
          </div>
          <div class="field"><label for="accessName">Display name <em>*</em></label><input id="accessName" type="text" value="${escapeHtml(user?.displayName || "")}" required></div>
          <div class="field"><label for="accessEmail">Email <em>*</em></label><input id="accessEmail" type="email" value="${escapeHtml(user?.email || "")}" required></div>
          <div class="field">
            <label for="accessRole">Role</label>
            <select id="accessRole">
              ${Object.entries(ROLES).map(([role, details]) => `<option value="${role}" ${user?.role === role ? "selected" : ""}>${escapeHtml(details.label)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="accessActive">Account status</label>
            <select id="accessActive">
              <option value="true" ${user?.active !== false ? "selected" : ""}>Active</option>
              <option value="false" ${user?.active === false ? "selected" : ""}>Inactive</option>
            </select>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-close-modal>Cancel</button>
        <button id="saveAccessButton" class="btn btn-primary" type="submit">Save Access</button>
      </div>
    </form>
  `, true);

  $("accessForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const userUid = $("accessUid").value.trim();
    const displayName = $("accessName").value.trim();
    const email = $("accessEmail").value.trim().toLowerCase();
    const role = $("accessRole").value;
    const active = $("accessActive").value === "true";
    if (!userUid || !displayName || !email) return toast("Complete all required fields.", "error");

    const button = $("saveAccessButton");
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const existing = user || {};
      await set(ref(database, `${PATHS.users}/${userUid}`), {
        uid: userUid,
        displayName,
        email,
        role,
        active,
        createdAt: existing.createdAt || Date.now(),
        createdBy: existing.createdBy || state.user.uid,
        updatedAt: serverTimestamp(),
        updatedBy: state.user.uid,
        lastLogin: existing.lastLogin || null
      });
      await addAudit(editing ? "user_access_updated" : "user_access_added", `${editing ? "Updated" : "Added"} access for ${email}`, { targetUid: userUid, role });
      closeModal();
      toast("User access saved.");
    } catch (error) {
      toast(firebaseWriteMessage(error), "error");
      button.disabled = false;
      button.textContent = "Save Access";
    }
  });
}

async function deleteUserProfile(userUid) {
  const user = state.users.find((entry) => entry.uid === userUid);
  if (!user) return;
  if (!window.confirm(`Remove portal access for ${user.email}? This does not delete the Firebase Authentication account.`)) return;
  try {
    await remove(ref(database, `${PATHS.users}/${userUid}`));
    await addAudit("user_access_removed", `Removed access for ${user.email}`, { targetUid: userUid });
    toast("Portal access removed.");
  } catch (error) {
    toast(firebaseWriteMessage(error), "error");
  }
}

async function addAudit(action, description, extra = {}) {
  if (!state.user || !state.profile?.active) return;
  const labels = {
    login: "Signed In",
    logout: "Signed Out",
    item_added: "Item Added",
    item_updated: "Item Updated",
    item_deleted: "Item Deleted",
    inventory_imported: "Inventory Imported",
    inventory_exported: "Inventory Exported",
    count_snapshot_saved: "Snapshot Saved",
    count_snapshot_restored: "Snapshot Restored",
    count_snapshot_deleted: "Snapshot Deleted",
    user_access_added: "Access Added",
    user_access_updated: "Access Updated",
    user_access_removed: "Access Removed",
    settings_updated: "Settings Updated"
  };
  try {
    const logRef = push(ref(database, PATHS.logs));
    await set(logRef, {
      id: logRef.key,
      uid: state.user.uid,
      userEmail: state.user.email || "",
      action,
      actionLabel: labels[action] || action,
      description,
      module: "alcohol",
      timestamp: serverTimestamp(),
      ...extra
    });
  } catch (error) {
    console.warn("Audit log could not be written:", error);
  }
}

function subscribeData() {
  unsubscribeData();

  state.subscriptions.push(onValue(ref(database, PATHS.items), (snapshot) => {
    const data = snapshot.val() || {};
    state.items = Object.entries(data)
      .map(([key, value]) => sanitizeItem(value, key))
      .filter((item) => item.name)
      .sort((a, b) => a.name.localeCompare(b.name) || a.size.localeCompare(b.size));
    if ($("section-overview")) renderCurrentSection();
  }, (error) => handleSubscriptionError(error, "inventory")));

  state.subscriptions.push(onValue(ref(database, PATHS.settings), (snapshot) => {
    state.settings = { ...state.settings, ...(snapshot.val() || {}) };
    if ($("section-overview")) renderCurrentSection();
  }));

  state.subscriptions.push(onValue(ref(database, PATHS.counts), (snapshot) => {
    const data = snapshot.val() || {};
    state.sessions = Object.entries(data)
      .map(([key, value]) => ({ id: key, ...value }))
      .sort((a, b) => number(b.createdAt) - number(a.createdAt));
    if (state.currentSection === "history") renderHistory();
  }));

  if (state.profile.role === "admin" && entryMode === "management") {
    state.subscriptions.push(onValue(ref(database, PATHS.logs), (snapshot) => {
      const data = snapshot.val() || {};
      state.logs = Object.entries(data)
        .map(([key, value]) => ({ id: key, ...value }))
        .sort((a, b) => number(b.timestamp) - number(a.timestamp))
        .slice(0, 500);
      if (state.currentSection === "overview") renderOverview();
      if (state.currentSection === "audit") renderAudit();
    }));

    state.subscriptions.push(onValue(ref(database, PATHS.users), (snapshot) => {
      const data = snapshot.val() || {};
      state.users = Object.entries(data)
        .map(([key, value]) => ({ uid: key, ...value }))
        .sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));
      if (state.currentSection === "users") renderUsers();
    }));
  }

  state.subscriptions.push(onValue(ref(database, ".info/connected"), async (snapshot) => {
    state.connected = snapshot.val() === true;
    updateSyncChip();

    if (state.connected && state.user) {
      const presenceRef = ref(database, `${PATHS.presence}/${state.user.uid}`);
      try {
        await onDisconnect(presenceRef).set({
          online: false,
          lastSeen: serverTimestamp(),
          email: state.user.email || ""
        });
        await set(presenceRef, {
          online: true,
          lastSeen: serverTimestamp(),
          email: state.user.email || ""
        });
      } catch (error) {
        console.warn("Presence update failed:", error);
      }
    }
  }));
}

function unsubscribeData() {
  state.subscriptions.forEach((unsubscribe) => {
    try { unsubscribe(); } catch {}
  });
  state.subscriptions = [];
}

function handleSubscriptionError(error, area) {
  console.error(`Firebase ${area} subscription failed:`, error);
  if (String(error?.code || "").includes("permission-denied")) {
    toast(`Firebase denied access to ${area}. Check the deployed database rules.`, "error");
  }
}

async function updateLastLogin() {
  try {
    await update(ref(database, `${PATHS.users}/${state.user.uid}`), {
      lastLogin: serverTimestamp(),
      lastLoginPortal: entryMode
    });
  } catch (error) {
    console.warn("Last-login update failed:", error);
  }
}

async function loadProfile(user) {
  const snapshot = await get(ref(database, `${PATHS.users}/${user.uid}`));
  return snapshot.exists() ? { uid: user.uid, ...snapshot.val() } : null;
}

function portalRoleAllowed(profile) {
  if (!profile?.active) return false;
  if (!ROLES[profile.role]) return false;
  if (entryMode === "management") return profile.role === "admin";
  return ["admin", "alcohol_manager", "alcohol_viewer"].includes(profile.role);
}

onAuthStateChanged(auth, async (user) => {
  unsubscribeData();

  if (!user) {
    state.user = null;
    state.profile = null;
    state.items = [];
    state.sessions = [];
    state.logs = [];
    state.users = [];
    renderLogin();
    return;
  }

  renderLoading("Checking your access permissions…");
  state.user = user;

  try {
    const profile = await loadProfile(user);
    if (!profile) {
      renderAccessDenied("Your Firebase Authentication account exists, but no portal access profile was found. Ask an administrator to add your UID under the Realtime Database users node.");
      return;
    }
    if (!profile.active) {
      renderAccessDenied("This portal account is inactive. Contact an administrator.");
      return;
    }
    if (!portalRoleAllowed(profile)) {
      const reason = entryMode === "management"
        ? "This page is for administrator accounts. Alcohol-count staff must use the Alcohol Count Login."
        : "This account does not have access to the Alcohol Count Portal.";
      renderAccessDenied(reason);
      return;
    }

    state.profile = profile;
    state.currentSection = "overview";
    await updateLastLogin();
    renderAppShell();
    subscribeData();
    await addAudit("login", `Signed in through the ${entryMode} portal`);
  } catch (error) {
    console.error(error);
    const message = String(error?.code || "").includes("permission-denied")
      ? "Firebase denied access while loading your profile. Deploy the included Realtime Database Rules and confirm that the first administrator profile is stored under users/UID."
      : authErrorMessage(error);
    renderAccessDenied(message);
  }
});
