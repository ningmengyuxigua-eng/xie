const fs = require('node:fs');
const path = require('node:path');
const storeProfile = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'store-profile.json'), 'utf8'));
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const metricDate = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate || '')) throw new Error('Usage: node summarize-ad-day.cjs YYYY-MM-DD');

const storeId = '27857268786685';
const outDir = path.join(root, 'ad-daily', metricDate);
const evaluation = JSON.parse(fs.readFileSync(path.join(outDir, 'ad-evaluation.json'), 'utf8').replace(/^\uFEFF/, ''));
const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'));
const byType = db.prepare(`
  SELECT m.ad_type AS adType, COUNT(*) AS ads,
         SUM(f.impressions) AS impressions, SUM(f.clicks) AS clicks,
         SUM(f.spend) AS spend, SUM(f.revenue) AS revenue,
         SUM(f.conversions) AS conversions
  FROM ad_daily_fact f
  JOIN ad_master m ON m.store_id=f.store_id AND m.ad_id=f.ad_id
  WHERE f.store_id=? AND f.metric_date=?
  GROUP BY m.ad_type ORDER BY m.ad_type
`).all(storeId, metricDate);
const dataStatus = db.prepare(`
  SELECT CASE
    WHEN SUM(CASE WHEN data_status='revised' THEN 1 ELSE 0 END) > 0 THEN 'revised'
    WHEN SUM(CASE WHEN data_status='provisional' THEN 1 ELSE 0 END) > 0 THEN 'provisional'
    ELSE 'final'
  END AS status
  FROM ad_daily_fact WHERE store_id=? AND metric_date=?
`).get(storeId, metricDate).status;
db.close();

const money = (value) => Number(value || 0).toFixed(2);
const ratio = (numerator, denominator, scale = 1) => denominator ? (numerator / denominator * scale).toFixed(2) : '0.00';
const taipeiDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const isCurrentDay = metricDate === taipeiDate;
const generatedAtTaipei = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date());
const t = evaluation.totals;
const lines = [
  `# ${metricDate} 進行中廣告日報`,
  '',
  `- 賣場：${storeProfile.displayName}（${storeId}）`,
  `- 範圍：${evaluation.completeness.collectedRows}/${evaluation.completeness.expectedActiveAds} 筆進行中廣告，${evaluation.scope === 'all_active_ads' ? '完整' : '部分'}資料`,
  `- 數據狀態：${dataStatus === 'revised' ? 'D+3 revised（已回補延遲歸因）' : (isCurrentDay ? `當日暫定（截至 ${generatedAtTaipei}）` : 'D-1 provisional；需要於 D+3 回補延遲歸因')}`,
  `- 總曝光：${t.impressions}；點擊：${t.clicks}；CTR：${ratio(t.clicks, t.impressions, 100)}%`,
  `- 廣告列表顯示值加總：花費 NT$${money(t.spend)}；廣告銷售額 NT$${money(t.revenue)}；ROAS ${ratio(t.revenue, t.spend)}`,
  `- 轉換：${t.conversions}；點擊轉換率：${ratio(t.conversions, t.clicks, 100)}%`,
  '',
  '## 類型彙總',
  '',
  '| 類型 | 廣告數 | 曝光 | 點擊 | 花費 | 銷售額 | ROAS | 轉換 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...byType.map((row) => `| ${row.adType} | ${row.ads} | ${row.impressions} | ${row.clicks} | NT$${money(row.spend)} | NT$${money(row.revenue)} | ${ratio(row.revenue, row.spend)} | ${row.conversions} |`),
  '',
  '## 優先處理',
  '',
  ...evaluation.actionItems.map((item) => `- ${item.adId}｜${item.adName}｜${item.status}｜曝光 ${item.evidence.impressions}、點擊 ${item.evidence.clicks}、花費 NT$${money(item.evidence.spend)}、銷售額 NT$${money(item.evidence.revenue)}。${item.recommendation}`),
  '',
  '## 有效候選',
  '',
  ...evaluation.effectiveItems.map((item) => `- ${item.adId}｜${item.adName}｜ROAS ${Number(item.evidence.roas || 0).toFixed(2)} / 目標 ${Number(item.evidence.targetRoas || 0).toFixed(2)}；花費 NT$${money(item.evidence.spend)}、銷售額 NT$${money(item.evidence.revenue)}。${item.recommendation}`),
  '',
  '## 限制與下一步',
  '',
  '- 尚未匯入商品成本，因此不判定盈利或虧損，也不自動調整預算與停用廣告。',
  '- 廣告列表會將部分金額與千位曝光縮寫；商品層下鑽使用詳情頁精確值並另行對帳。',
  '- 先下鑽本日有行動訊號的廣告群組；商品層資料仍按每批最多 20 筆保存。',
  '- 累積至少 7 個完整日後，才加入 7 日背景與連續異常判斷。',
];

const reportPath = path.join(outDir, 'daily-report.md');
fs.writeFileSync(reportPath, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ reportPath, byType }));
