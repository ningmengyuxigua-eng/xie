const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const metricDate = process.argv[2];
const pageNumber = Number(process.argv[3] || 1);
if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate || '')) throw new Error('Usage: node import-ad-day-page.cjs YYYY-MM-DD PAGE');

const storeId = '27857268786685';
const sourcePath = path.join(root, 'ad-daily', metricDate, `ad-level-page-${pageNumber}.json`);
const dbPath = path.join(root, 'db', 'store-audit.sqlite');
const page = JSON.parse(fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, ''));
if (page.rows.length > 20) throw new Error(`Batch row limit exceeded: ${page.rows.length}`);
if (page.page !== pageNumber) throw new Error(`Page mismatch: ${page.page}`);

const number = (value) => {
  const text = String(value ?? '').replace(/,/g, '').trim().toLowerCase();
  const parsed = Number(text.match(/-?\d+(?:\.\d+)?/)?.[0] || 0);
  return text.includes('k') ? parsed * 1000 : parsed;
};
const optionalNumber = (value) => String(value ?? '').trim() === '-' ? null : number(value);
const percent = (value) => String(value ?? '').trim() === '-' ? null : number(value) / 100;
const adIdFromUrl = (url) => String(url).match(/\/(\d+)\?/)?.[1] || null;
const adType = (url) => String(url).includes('/manual-mpd/') ? 'manual_mpd' : 'single_product';
const now = new Date().toISOString();
const taipeiToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const ageDays = Math.floor((Date.parse(`${taipeiToday}T00:00:00Z`) - Date.parse(`${metricDate}T00:00:00Z`)) / 86400000);
const dataStatus = ageDays >= 3 ? 'revised' : 'provisional';

let productMap = new Map();
const mappingPath = path.join(root, '2026-10-06', 'product-ad-mapping.json');
if (fs.existsSync(mappingPath)) {
  const mappings = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  const byAd = new Map();
  for (const item of mappings) {
    const id = String(item.adId || '');
    if (!id || id === 'auto-selection') continue;
    if (!byAd.has(id)) byAd.set(id, new Set());
    byAd.get(id).add(String(item.productId));
  }
  productMap = new Map([...byAd].filter(([, ids]) => ids.size === 1).map(([id, ids]) => [id, [...ids][0]]));
}

function parseIdentity(row) {
  const lines = String(row.adText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const status = lines.find((line) => ['進行中', '暫停中', '已結束', '已刪除'].includes(line)) || 'unknown';
  const ignored = new Set(['...', '無結束日期', '進行中', '暫停中', '已結束', '已刪除', '全站推廣 - 自訂ROAS', '商品廣告']);
  const name = lines.find((line) => !ignored.has(line) && !line.includes('獎勵方案')) || '';
  return { status, name };
}

const db = new DatabaseSync(dbPath);
const upsertMaster = db.prepare(`
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
    product_id = COALESCE(excluded.product_id, ad_master.product_id),
    source_url = excluded.source_url,
    last_seen_at = excluded.last_seen_at
`);
const upsertDaily = db.prepare(`
  INSERT INTO ad_daily_fact(
    store_id, metric_date, ad_id, impressions, clicks, ctr, spend,
    add_to_cart, conversions, sales_count, revenue, roas,
    direct_conversions, direct_sales_count, direct_revenue, direct_roas,
    source_status, data_status, observed_at, revised_at, source_path
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(store_id, metric_date, ad_id) DO UPDATE SET
    impressions = excluded.impressions,
    clicks = excluded.clicks,
    ctr = excluded.ctr,
    spend = excluded.spend,
    add_to_cart = excluded.add_to_cart,
    conversions = excluded.conversions,
    sales_count = excluded.sales_count,
    revenue = excluded.revenue,
    roas = excluded.roas,
    direct_conversions = excluded.direct_conversions,
    direct_sales_count = excluded.direct_sales_count,
    direct_revenue = excluded.direct_revenue,
    direct_roas = excluded.direct_roas,
    source_status = excluded.source_status,
    data_status = excluded.data_status,
    observed_at = excluded.observed_at,
    revised_at = excluded.revised_at,
    source_path = excluded.source_path
`);

const runId = `${metricDate}-ad-level-page-${pageNumber}-${Date.now()}`;
db.prepare(`INSERT INTO ad_sync_run(run_id, store_id, metric_date, scope, status, page_cursor, processed_count, error_count, started_at, finished_at, checkpoint_path)
  VALUES (?, ?, ?, 'active_ad_level', 'running', ?, 0, 0, ?, NULL, ?)`)
  .run(runId, storeId, metricDate, String(pageNumber), now, path.join(root, 'ad-daily', metricDate, 'ad-level-checkpoint.json'));

let inserted = 0;
db.exec('BEGIN IMMEDIATE');
try {
  for (const row of page.rows) {
    const id = adIdFromUrl(row.url);
    if (!id) throw new Error(`Missing ad ID for row: ${row.url}`);
    const identity = parseIdentity(row);
    const m = row.metrics;
    upsertMaster.run(
      storeId, id, identity.name, adType(row.url), identity.status,
      number(m['每日預算']), number(m['目標投入產出比']),
      productMap.get(id) || null, row.url, now, now
    );
    upsertDaily.run(
      storeId, metricDate, id,
      number(m['瀏覽數']), number(m['點擊數']), percent(m['點擊率']), number(m['花費']),
      optionalNumber(m['加入購物車次數']), number(m['轉換數']), number(m['銷售數']), number(m['銷售額']), optionalNumber(m['投入產出比']),
      optionalNumber(m['直接轉換數']), optionalNumber(m['直接銷售數']), optionalNumber(m['直接銷售額']), optionalNumber(m['直接投入產出比']),
      identity.status, dataStatus, now, dataStatus === 'revised' ? now : null, sourcePath
    );
    inserted += 1;
  }
  db.exec('COMMIT');
  db.prepare(`UPDATE ad_sync_run SET status='partial', processed_count=?, finished_at=? WHERE run_id=?`).run(inserted, new Date().toISOString(), runId);
} catch (error) {
  db.exec('ROLLBACK');
  db.prepare(`UPDATE ad_sync_run SET status='failed', error_count=1, finished_at=?, error_summary=? WHERE run_id=?`).run(new Date().toISOString(), error.message, runId);
  throw error;
}

const summary = db.prepare(`
  SELECT COUNT(*) AS rows, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
         ROUND(SUM(spend), 2) AS spend, ROUND(SUM(revenue), 2) AS revenue,
         SUM(conversions) AS conversions
  FROM ad_daily_fact WHERE store_id=? AND metric_date=?
`).get(storeId, metricDate);
db.close();

console.log(JSON.stringify({ metricDate, page: pageNumber, processed: inserted, summary }));
