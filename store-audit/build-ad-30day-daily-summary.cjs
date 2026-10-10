const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const storeId = '27857268786685';
const displayName = '拾味廚房雜貨鋪';
const start = process.argv[2] || '2026-09-08';
const end = process.argv[3] || '2026-10-07';
const outputFolder = process.argv[4] || end;
const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'));

const staged = db.prepare(`
  SELECT metric_date metricDate, 'daily_export' source, COUNT(*) adRows,
         SUM(CASE WHEN spend>0 THEN 1 ELSE 0 END) adsWithSpend,
         SUM(impressions) impressions, SUM(clicks) clicks, SUM(conversions) conversions,
         SUM(sales_count) salesCount, ROUND(SUM(spend),2) spend, ROUND(SUM(revenue),2) revenue
  FROM ad_export_daily_staging
  WHERE store_id=? AND metric_date BETWEEN ? AND ?
  GROUP BY metric_date
`).all(storeId, start, end);

const formal = db.prepare(`
  SELECT metric_date metricDate, 'daily_ui' source, COUNT(*) adRows,
         SUM(CASE WHEN spend>0 THEN 1 ELSE 0 END) adsWithSpend,
         SUM(impressions) impressions, SUM(clicks) clicks, SUM(conversions) conversions,
         SUM(sales_count) salesCount, ROUND(SUM(spend),2) spend, ROUND(SUM(revenue),2) revenue
  FROM ad_daily_fact
  WHERE store_id=? AND metric_date BETWEEN ? AND ?
  GROUP BY metric_date
`).all(storeId, start, end);

const byDate = new Map();
for (const row of formal) byDate.set(row.metricDate, row);
for (const row of staged) byDate.set(row.metricDate, row);
const daily = [...byDate.values()].sort((a, b) => a.metricDate.localeCompare(b.metricDate)).map((row) => {
  const impressions = Number(row.impressions || 0);
  const clicks = Number(row.clicks || 0);
  const conversions = Number(row.conversions || 0);
  const spend = Number(row.spend || 0);
  const revenue = Number(row.revenue || 0);
  return {
    ...row,
    ctr: impressions ? Number((clicks / impressions).toFixed(4)) : 0,
    conversionRate: clicks ? Number((conversions / clicks).toFixed(4)) : 0,
    roas: spend ? Number((revenue / spend).toFixed(2)) : 0,
    dataStatus: row.metricDate === end ? 'provisional' : 'closed',
  };
});

const totals = daily.reduce((a, x) => {
  for (const key of ['adRows','adsWithSpend','impressions','clicks','conversions','salesCount','spend','revenue']) a[key] += Number(x[key] || 0);
  return a;
}, { adRows:0, adsWithSpend:0, impressions:0, clicks:0, conversions:0, salesCount:0, spend:0, revenue:0 });
totals.spend = Number(totals.spend.toFixed(2));
totals.revenue = Number(totals.revenue.toFixed(2));
totals.ctr = totals.impressions ? Number((totals.clicks / totals.impressions).toFixed(4)) : 0;
totals.conversionRate = totals.clicks ? Number((totals.conversions / totals.clicks).toFixed(4)) : 0;
totals.roas = totals.spend ? Number((totals.revenue / totals.spend).toFixed(2)) : 0;

const rangePath = path.join(root, 'backfill', 'ads', outputFolder, 'range-summary.json');
const rangeSummary = fs.existsSync(rangePath) ? JSON.parse(fs.readFileSync(rangePath, 'utf8')) : null;
const rangeTotals = rangeSummary?.adLevel?.totals || null;
const reconciliation = rangeTotals ? {
  rangeExport: rangeTotals,
  dailySum: totals,
  difference: {
    impressions: totals.impressions - rangeTotals.impressions,
    clicks: totals.clicks - rangeTotals.clicks,
    conversions: totals.conversions - rangeTotals.conversions,
    salesCount: totals.salesCount - rangeTotals.salesCount,
    spend: Number((totals.spend - rangeTotals.spend).toFixed(2)),
    revenue: Number((totals.revenue - rangeTotals.revenue).toFixed(2)),
  },
  note: 'Daily exports and range exports are independently generated Shopee reports. Differences are retained and not force-adjusted.',
} : null;

const output = { generatedAt:new Date().toISOString(), storeId, displayName, rangeStart:start, rangeEnd:end, dayCount:daily.length, totals, reconciliation, daily };
const outDir = path.join(root, 'backfill', 'ads', outputFolder);
fs.mkdirSync(outDir, { recursive:true });
const jsonPath = path.join(outDir, 'daily-summary.json');
const csvPath = path.join(outDir, 'daily-summary.csv');
const mdPath = path.join(outDir, 'daily-summary.md');
fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
const columns = ['metricDate','source','dataStatus','adRows','adsWithSpend','impressions','clicks','ctr','conversions','conversionRate','salesCount','spend','revenue','roas'];
fs.writeFileSync(csvPath, '\uFEFF' + [columns.join(','), ...daily.map((x) => columns.map((k) => x[k]).join(','))].join('\r\n'));
const lines = [
  `# ${displayName} 廣告30天每日摘要`, '',
  `期間：${start} 至 ${end}（${daily.length}天）`, '',
  `總花費：NT$${totals.spend.toFixed(2)}；廣告營收：NT$${totals.revenue.toFixed(2)}；ROAS：${totals.roas.toFixed(2)}；點擊：${totals.clicks}；轉換：${totals.conversions}。`, '',
  '| 日期 | 來源 | 有花費廣告 | 花費 | 營收 | ROAS | 點擊 | 轉換 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...daily.map((x) => `| ${x.metricDate} | ${x.source} | ${x.adsWithSpend} | ${Number(x.spend).toFixed(2)} | ${Number(x.revenue).toFixed(2)} | ${x.roas.toFixed(2)} | ${x.clicks} | ${x.conversions} |`),
  '',
  '最後一天為當日暫定資料；區間匯出與逐日匯出差異保留於JSON的reconciliation欄位。',
];
fs.writeFileSync(mdPath, lines.join('\n'));
db.close();
console.log(JSON.stringify({ jsonPath, csvPath, mdPath, dayCount:daily.length, totals, difference:reconciliation?.difference || null }));
