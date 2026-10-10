const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const db = new DatabaseSync(path.join(__dirname, 'db', 'store-audit.sqlite'), { readOnly: true });
const result = {
  integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
  foreignKeyErrors: db.prepare('PRAGMA foreign_key_check').all().length,
  products: db.prepare('SELECT COUNT(*) count FROM product_master').get().count,
  newProducts: db.prepare("SELECT COUNT(*) count FROM product_master WHERE first_seen_at >= '2026-10-08'").get().count,
  listedKnown: db.prepare('SELECT COUNT(*) count FROM product_master WHERE listed_at IS NOT NULL').get().count,
  detailComplete: db.prepare("SELECT COUNT(*) count FROM product_master WHERE detail_status='complete'").get().count,
  pendingQueue: db.prepare("SELECT COUNT(*) count FROM product_detail_queue WHERE status='pending'").get().count,
  priceVersions: db.prepare('SELECT COUNT(*) count FROM product_versions WHERE price_min IS NOT NULL AND price_max IS NOT NULL').get().count,
  dateRange: db.prepare("SELECT MIN(listed_at) min,MAX(listed_at) max FROM product_master WHERE first_seen_at >= '2026-10-08'").get(),
  run: db.prepare("SELECT processed_count,existing_count,new_count,queued_count,status FROM product_discovery_run WHERE run_id='product-incremental-2026-10-08-6cef44337e04'").get(),
};
db.close();
console.log(JSON.stringify(result, null, 2));
