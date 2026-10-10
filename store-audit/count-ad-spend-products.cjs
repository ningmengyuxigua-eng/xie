const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const metricDate = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate || '')) throw new Error('Usage: node count-ad-spend-products.cjs YYYY-MM-DD');
const storeId = '27857268786685';
const db = new DatabaseSync(`${__dirname}/db/store-audit.sqlite`);

const one = (sql, ...args) => db.prepare(sql).get(...args).n;
const summary = {
  metricDate,
  singleAdsWithSpend: one(`SELECT COUNT(DISTINCT f.ad_id) n FROM ad_daily_fact f JOIN ad_master m ON m.store_id=f.store_id AND m.ad_id=f.ad_id WHERE f.store_id=? AND f.metric_date=? AND m.ad_type='single_product' AND f.spend>0`, storeId, metricDate),
  singleProductsWithSpend: one(`SELECT COUNT(DISTINCT m.product_id) n FROM ad_daily_fact f JOIN ad_master m ON m.store_id=f.store_id AND m.ad_id=f.ad_id WHERE f.store_id=? AND f.metric_date=? AND m.ad_type='single_product' AND f.spend>0 AND m.product_id IS NOT NULL`, storeId, metricDate),
  groupsWithSpend: one(`SELECT COUNT(*) n FROM ad_daily_fact f JOIN ad_master m ON m.store_id=f.store_id AND m.ad_id=f.ad_id WHERE f.store_id=? AND f.metric_date=? AND m.ad_type='manual_mpd' AND f.spend>0`, storeId, metricDate),
  groupsDrilled: one(`SELECT COUNT(DISTINCT ad_id) n FROM ad_product_daily_fact WHERE store_id=? AND metric_date=?`, storeId, metricDate),
  knownGroupProductsWithSpend: one(`SELECT COUNT(DISTINCT product_id) n FROM ad_product_daily_fact WHERE store_id=? AND metric_date=? AND spend>0`, storeId, metricDate),
  knownAllProductsWithSpend: one(`SELECT COUNT(DISTINCT product_id) n FROM (
    SELECT m.product_id FROM ad_daily_fact f JOIN ad_master m ON m.store_id=f.store_id AND m.ad_id=f.ad_id
      WHERE f.store_id=? AND f.metric_date=? AND m.ad_type='single_product' AND f.spend>0 AND m.product_id IS NOT NULL
    UNION
    SELECT product_id FROM ad_product_daily_fact WHERE store_id=? AND metric_date=? AND spend>0
  )`, storeId, metricDate, storeId, metricDate),
};
const pending = db.prepare(`
  SELECT f.ad_id AS adId, m.ad_name AS adName, f.spend
  FROM ad_daily_fact f JOIN ad_master m ON m.store_id=f.store_id AND m.ad_id=f.ad_id
  LEFT JOIN (SELECT DISTINCT store_id,metric_date,ad_id FROM ad_product_daily_fact) p
    ON p.store_id=f.store_id AND p.metric_date=f.metric_date AND p.ad_id=f.ad_id
  WHERE f.store_id=? AND f.metric_date=? AND m.ad_type='manual_mpd' AND f.spend>0 AND p.ad_id IS NULL
  ORDER BY f.spend DESC
`).all(storeId, metricDate);
summary.pendingGroupsWithSpend = pending.length;
summary.isExact = pending.length === 0;
summary.generatedAt = new Date().toISOString();
const snapshotPath = path.join(__dirname, 'ad-daily', metricDate, 'ad-spend-product-count.json');
fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
fs.writeFileSync(snapshotPath, JSON.stringify(summary, null, 2));
const pendingOutputPath = process.argv[3];
if (pendingOutputPath) fs.writeFileSync(pendingOutputPath, JSON.stringify(pending, null, 2));
console.log(JSON.stringify(pendingOutputPath ? { summary, snapshotPath, pendingOutputPath } : { summary, snapshotPath, pending: pending.slice(0, 20) }, null, 2));
db.close();
