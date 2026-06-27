/**
 * csv.js — Import and export inventory as CSV.
 *
 * Expected CSV columns (case-insensitive):
 *   name, category, quantity, threshold, price, unit, notes
 */

const CSV = (() => {

  const HEADERS = ['name', 'category', 'quantity', 'threshold', 'price', 'unit', 'notes'];

  // ── Export ─────────────────────────────────────
  function exportProducts() {
    const products = Products.getAll();
    if (products.length === 0) {
      UI.showToast('No products to export.', 'info');
      return;
    }

    const rows = [HEADERS.join(',')];
    products.forEach(p => {
      rows.push([
        csvCell(p.name),
        csvCell(p.category),
        p.quantity,
        p.threshold,
        p.price,
        csvCell(p.unit),
        csvCell(p.notes || ''),
      ].join(','));
    });

    download(rows.join('\n'), 'stockmate_inventory.csv', 'text/csv');
    UI.showToast('Exported ' + products.length + ' products.', 'success');
  }

  // ── Import ─────────────────────────────────────
  function importFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text    = e.target.result;
        const results = parseCSV(text);
        if (results.added === 0) {
          UI.showToast('No valid rows found in CSV.', 'error');
          return;
        }
        UI.showToast(`Imported ${results.added} products (${results.skipped} skipped).`, 'success');
        UI.refreshAll();
      } catch (err) {
        console.error('CSV import error:', err);
        UI.showToast('Failed to parse CSV. Check format.', 'error');
      }
    };
    reader.readAsText(file);
  }

  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return { added: 0, skipped: 0 };

    const headerLine = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
    let added = 0, skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCSVLine(lines[i]);
      if (cols.length === 0 || cols.every(c => !c.trim())) continue;

      const row = {};
      headerLine.forEach((h, idx) => { row[h] = (cols[idx] || '').trim().replace(/^"|"$/g, ''); });

      const name = row['name'] || row['productname'] || row['product'];
      if (!name) { skipped++; continue; }

      Products.add({
        name,
        category:  row['category'] || 'General',
        quantity:  parseFloat(row['quantity'] || row['qty'] || 0) || 0,
        threshold: parseFloat(row['threshold'] || row['minimum'] || row['min'] || 5) || 5,
        price:     parseFloat(row['price'] || row['unitprice'] || 0) || 0,
        unit:      row['unit'] || row['uom'] || 'pcs',
        notes:     row['notes'] || row['note'] || '',
      });
      added++;
    }

    return { added, skipped };
  }

  // ── Helpers ────────────────────────────────────
  function csvCell(val) {
    const s = String(val ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  }

  function splitCSVLine(line) {
    const result = [];
    let current  = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  function download(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Template Download ──────────────────────────
  function downloadTemplate() {
    const sample = [
      HEADERS.join(','),
      'White Rice 5kg,Grains,50,10,12.00,bag,Supplier: ABC',
      'Cooking Oil 1L,Oils,30,5,6.50,bottle,',
      'Sugar 1kg,Baking,20,8,3.00,bag,',
    ].join('\n');
    download(sample, 'stockmate_template.csv', 'text/csv');
  }

  return { exportProducts, importFromFile, downloadTemplate };
})();
