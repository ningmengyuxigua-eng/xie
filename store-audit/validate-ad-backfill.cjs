const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const storeId = '27857268786685';
const displayName = '拾味廚房雜貨鋪';
const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'));

const daily = db.prepare(`
  SELECT metric_date AS metricDate,
         COUNT(*) AS rows,
         SUM(CASE WHEN match_status='matched_unique_name' THEN 1 ELSE 0 END) AS matched,
         SUM(CASE WHEN match_status='unmatched' THEN 1 ELSE 0 END) AS unmatched,
         SUM(CASE WHEN match_status='ambiguous' THEN 1 ELSE 0 END) AS ambiguous,
         ROUND(SUM(spend), 2) AS spend,
         ROUND(SUM(revenue), 2) AS revenue,
         SUM(conversions) AS conversions
  FROM ad_export_daily_staging
  WHERE store_id=?
  GROUP BY metric_date
  ORDER BY metric_date
`).all(storeId);

const unmatched = db.prepare(`
  SELECT ad_name AS adName, COUNT(DISTINCT metric_date) AS days,
         ROUND(SUM(spend), 2) AS spend, ROUND(SUM(revenue), 2) AS revenue,
         SUM(conversions) AS conversions
  FROM ad_export_daily_staging
  WHERE store_id=? AND match_status='unmatched'
  GROUP BY ad_name
  ORDER BY spend DESC, days DESC
  LIMIT 20
`).all(storeId);

const summary = {
  generatedAt: new Date().toISOString(),
  storeId,
  displayName,
  completedDailyExports: daily.length,
  stagedRows: daily.reduce((n, x) => n + Number(x.rows), 0),
  matchedRows: daily.reduce((n, x) => n + Number(x.matched), 0),
  unmatchedRows: daily.reduce((n, x) => n + Number(x.unmatched), 0),
  ambiguousRows: daily.reduce((n, x) => n + Number(x.ambiguous), 0),
  daily,
  unmatchedTop20: unmatched,
};

const output = path.join(root, 'progress', 'ad-backfill-validation.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(summary, null, 2));
db.close();
console.log(JSON.stringify({ output, completedDailyExports: summary.completedDailyExports, stagedRows: summary.stagedRows, matchedRows: summary.matchedRows, unmatchedRows: summary.unmatchedRows, ambiguousRows: summary.ambiguousRows }));
