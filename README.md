# 📦 StockMate — Inventory Manager

A lightweight, zero-backend inventory management system built for small businesses. Runs entirely in the browser — no server needed. Host it free on **GitHub Pages**.

---

## ✨ Features

- **Product management** — Add, edit, delete products with name, category, quantity, price, and unit
- **Low stock alerts** — Visual banners, badge counters, and a dedicated Alerts view when items fall below your set threshold
- **Browser notifications** — Optional push notifications when stock is low
- **Dashboard** — Stats overview and "items needing attention" at a glance
- **Reports** — Charts for stock by category, status breakdown, and top products by value
- **CSV Import/Export** — Bulk load products from a spreadsheet, or export your inventory
- **Backup/Restore** — Full JSON data backup and restore
- **No login, no server** — All data stored in your browser's localStorage

---

## 🚀 Deploy to GitHub Pages

1. **Create a new GitHub repository** (e.g. `my-inventory`)
2. **Upload all files** maintaining the folder structure:
   ```
   index.html
   css/
     reset.css
     theme.css
     layout.css
     components.css
     notifications.css
   js/
     storage.js
     products.js
     notifications.js
     ui.js
     charts.js
     csv.js
     app.js
   README.md
   ```
3. Go to **Settings → Pages → Source** and select `main` branch, root folder
4. Your app will be live at `https://yourusername.github.io/my-inventory`

---

## 📂 File Structure

| File | Purpose |
|------|---------|
| `index.html` | App shell, all views and modals |
| `css/reset.css` | CSS normalize/reset |
| `css/theme.css` | Design tokens (colors, fonts, spacing) |
| `css/layout.css` | Sidebar, topbar, main layout |
| `css/components.css` | Buttons, cards, table, modals, toasts |
| `css/notifications.css` | Alert banner styles |
| `js/storage.js` | localStorage abstraction layer |
| `js/products.js` | CRUD operations + data model |
| `js/notifications.js` | Alert logic, badge, banner, browser push |
| `js/ui.js` | All DOM rendering — views, tables, modals, toasts |
| `js/charts.js` | Chart.js reports rendering |
| `js/csv.js` | CSV import + export |
| `js/app.js` | App bootstrap, event wiring, demo data seed |

---

## 📋 CSV Import Format

Your CSV must have these column headers (order doesn't matter, case-insensitive):

```
name, category, quantity, threshold, price, unit, notes
```

**Example:**
```csv
name,category,quantity,threshold,price,unit,notes
White Rice 5kg,Grains,50,10,12.00,bag,
Cooking Oil 1L,Oils,30,5,6.50,bottle,Supplier: ABC
```

Use the **Import CSV** button in the top bar to load your file.

---

## ⚠️ Low Stock Thresholds

Each product has its own **Minimum Quantity** (threshold). When the current quantity hits or falls below this number:
- A warning banner appears at the top
- The product appears in the **Alerts** tab
- The alert badge shows a count on the sidebar

Set a **default threshold** under ⚙️ Settings.

---

## 💾 Data & Privacy

All data is stored in **your browser's localStorage** — nothing is sent to any server. If you clear your browser data, your inventory will be cleared too. Use the **Export Backup** feature in Settings regularly to save your data.

---

## 🛠 Tech Stack

- Vanilla HTML, CSS, JavaScript (no framework)
- [Chart.js](https://www.chartjs.org/) for reports
- Google Fonts (Inter + Space Grotesk)
- Browser localStorage for persistence
- Works on GitHub Pages, Netlify, or any static host
