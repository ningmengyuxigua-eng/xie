const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const sourceDate = process.argv[2] || '2026-10-06';
const sourcePath = path.join(root, sourceDate, 'advertisements.json');
const dbPath = path.join(root, 'db', 'store-audit.sqlite');
const storeId = '27857268786685';
const rows = JSON.parse(fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, ''));

const number = (value) => Number(String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0] || 0);
const status = (row) => String(row.name || '').split('\n').find((line) => ['進行中', '暫停中', '已結束', '已刪除'].includes(line)) || 'unknown';
const name = (row) => String(row.name || '').split('\n').find((line) => line && line !== '...' && !['進行中', '暫停中', '已結束', '已刪除'].includes(line)) || '';
const adType = (url) => String(url).includes('/manual-mpd/') ? 'manual_mpd' : String(url).includes('/manual/') ? 'single_product' : 'other';
const adId = (url) => String(url).match(/\/(\d+)\?/)?.[1] || null;
const now = new Date().toISOString();

const db = new DatabaseSync(dbPath);
const upsert = db.prepare(`
  INSERT INTO ad_master(
    store_id, ad_id, ad_name, ad_type, current_status, daily_budget,
    target_roas, product_id, source_url, first_seen_at, last_seen_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(store_id, ad_id) DO UPDATE SET
    ad_name = excluded.ad_name,
    ad_type = excluded.ad_type,
    current_status = excluded.current_status,
    daily_budget = excluded.daily_budget,
    target_roas = excluded.target_roas,
    source_url = excluded.source_url,
    last_seen_at = excluded.last_seen_at
`);

let imported = 0;
let skipped = 0;
db.exec('BEGIN IMMEDIATE');
try {
  for (const row of rows) {
    const id = adId(row.url);
    const type = adType(row.url);
    if (!id || type === 'other') { skipped += 1; continue; }
    upsert.run(
      storeId, id, name(row), type, status(row), number(row['每日預算']),
      number(row['目標投入產出比']), null, row.url, now, now
    );
    imported += 1;
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

const counts = db.prepare(`
  SELECT current_status AS status, ad_type AS type, COUNT(*) AS count
  FROM ad_master WHERE store_id = ?
  GROUP BY current_status, ad_type ORDER BY current_status, ad_type
`).all(storeId);
db.close();

console.log(JSON.stringify({ sourceDate, imported, skipped, counts }));
