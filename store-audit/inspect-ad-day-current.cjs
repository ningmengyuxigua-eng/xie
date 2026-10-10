const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const metricDate = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate || '')) throw new Error('Usage: node inspect-ad-day-current.cjs YYYY-MM-DD');
const storeId = '27857268786685';
const db = new DatabaseSync(path.join(__dirname, 'db', 'store-audit.sqlite'), { readOnly: true });
const missingActive = db.prepare(`
  SELECT m.ad_id adId,m.ad_name adName,m.ad_type adType,m.current_status currentStatus,m.last_seen_at lastSeenAt
  FROM ad_master m
  LEFT JOIN ad_daily_fact f ON f.store_id=m.store_id AND f.ad_id=m.ad_id AND f.metric_date=?
  WHERE m.store_id=? AND m.current_status='進行中' AND f.ad_id IS NULL
`).all(metricDate, storeId);
const topSpend = db.prepare(`
  SELECT f.ad_id adId,m.ad_name adName,m.ad_type adType,m.product_id productId,
         f.impressions,f.clicks,f.ctr,f.spend,f.conversions,f.revenue,f.roas,
         e.evaluation_status evaluationStatus,e.priority
  FROM ad_daily_fact f
  JOIN ad_master m ON m.store_id=f.store_id AND m.ad_id=f.ad_id
  LEFT JOIN ad_evaluation e ON e.store_id=f.store_id AND e.metric_date=f.metric_date AND e.ad_id=f.ad_id
    AND e.product_id_or_zero=COALESCE(m.product_id,'0') AND e.rule_version='1.0.0-draft'
  WHERE f.store_id=? AND f.metric_date=?
  ORDER BY f.spend DESC
  LIMIT 10
`).all(storeId, metricDate);
const risky = db.prepare(`
  SELECT f.ad_id adId,m.ad_name adName,m.ad_type adType,m.product_id productId,
         f.impressions,f.clicks,f.spend,f.conversions,f.revenue,f.roas
  FROM ad_daily_fact f JOIN ad_master m ON m.store_id=f.store_id AND m.ad_id=f.ad_id
  WHERE f.store_id=? AND f.metric_date=? AND f.clicks>=5 AND f.conversions=0
  ORDER BY f.clicks DESC,f.spend DESC
  LIMIT 20
`).all(storeId, metricDate);
const summary = db.prepare(`
  SELECT COUNT(*) ads,
         SUM(CASE WHEN f.spend>0 THEN 1 ELSE 0 END) spendingAds,
         SUM(CASE WHEN f.clicks>0 THEN 1 ELSE 0 END) clickedAds,
         SUM(f.impressions) impressions,SUM(f.clicks) clicks,SUM(f.spend) spend,
         SUM(f.conversions) conversions,SUM(f.revenue) revenue
  FROM ad_daily_fact f WHERE f.store_id=? AND f.metric_date=?
`).get(storeId, metricDate);
const trend = db.prepare(`
  SELECT metric_date metricDate,COUNT(*) ads,SUM(impressions) impressions,SUM(clicks) clicks,
         SUM(spend) spend,SUM(conversions) conversions,SUM(revenue) revenue
  FROM ad_daily_fact WHERE store_id=? AND metric_date<=?
  GROUP BY metric_date ORDER BY metric_date DESC LIMIT 7
`).all(storeId, metricDate).reverse();
db.close();
console.log(JSON.stringify({ metricDate, summary, missingActive, topSpend, risky, trend }, null, 2));
