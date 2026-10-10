const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const metricDate = process.argv[2];
const adId = String(process.argv[3] || '');
const pageNumber = Number(process.argv[4] || 1);
if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate || '') || !/^\d+$/.test(adId)) {
  throw new Error('Usage: node import-ad-product-day-page.cjs YYYY-MM-DD AD_ID PAGE');
}

const storeId = '27857268786685';
const sourcePath = path.join(root, 'ad-daily', metricDate, 'groups', adId, `page-${pageNumber}.json`);
const page = JSON.parse(fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, ''));
if (String(page.adId) !== adId || Number(page.page) !== pageNumber) throw new Error('Ad or page mismatch');
if (!Array.isArray(page.rows) || page.rows.length > 20) throw new Error('Invalid batch size');

const number = (value) => {
  const text = String(value ?? '').replace(/,/g, '').trim().toLowerCase();
  const parsed = Number(text.match(/-?\d+(?:\.\d+)?/)?.[0] || 0);
  return text.includes('k') ? parsed * 1000 : parsed;
};
const optionalNumber = (value) => String(value ?? '').trim() === '-' ? null : number(value);
const percent = (value) => String(value ?? '').trim() === '-' ? null : number(value) / 100;
const now = new Date().toISOString();
const taipeiToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const ageDays = Math.floor((Date.parse(`${taipeiToday}T00:00:00Z`) - Date.parse(`${metricDate}T00:00:00Z`)) / 86400000);
const dataStatus = ageDays >= 3 ? 'revised' : 'provisional';
const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'));
const upsert = db.prepare(`
  INSERT INTO ad_product_daily_fact(
    store_id, metric_date, ad_id, product_id, product_name,
    impressions, clicks, ctr, spend, conversions, sales_count, revenue, roas,
    source_status, data_status, observed_at, revised_at, source_path
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '進行中', ?, ?, ?, ?)
  ON CONFLICT(store_id, metric_date, ad_id, product_id) DO UPDATE SET
    product_name=excluded.product_name,
    impressions=excluded.impressions, clicks=excluded.clicks, ctr=excluded.ctr,
    spend=excluded.spend, conversions=excluded.conversions,
    sales_count=excluded.sales_count, revenue=excluded.revenue, roas=excluded.roas,
    source_status=excluded.source_status, data_status=excluded.data_status,
    observed_at=excluded.observed_at, revised_at=excluded.revised_at,
    source_path=excluded.source_path
`);

db.exec('BEGIN IMMEDIATE');
try {
  for (const row of page.rows) {
    const m = row.metrics || {};
    upsert.run(
      storeId, metricDate, adId, String(row.productId), row.productName || '',
      number(m['瀏覽數']), number(m['點擊數']), percent(m['點擊率']), number(m['花費']),
      number(m['轉換數']), number(m['銷售數']), number(m['銷售額']), optionalNumber(m['投入產出比']),
      dataStatus, now, dataStatus === 'revised' ? now : null, sourcePath
    );
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM ad_product_daily_fact WHERE store_id=? AND metric_date=? AND ad_id=?`).get(storeId, metricDate, adId).count);
db.close();
console.log(JSON.stringify({ adId, page: pageNumber, processed: page.rows.length, databaseRows: total }));
