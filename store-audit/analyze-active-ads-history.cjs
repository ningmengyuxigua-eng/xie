const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const storeId = '27857268786685';
const displayName = '拾味廚房雜貨鋪';
const analysisDate = process.argv[2] || '2026-10-06';
const snapshotDate = process.argv[3] || '2026-10-07';
const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'));

function minusDays(text, days) {
  const d = new Date(`${text}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
const start7 = minusDays(analysisDate, 6);
const start30 = minusDays(analysisDate, 29);
const startLife = '2026-08-14';

const rows = db.prepare(`
  WITH metrics AS (
    SELECT metric_date, matched_ad_id ad_id, impressions, clicks, conversions, sales_count, spend, revenue
    FROM ad_export_daily_staging
    WHERE store_id=? AND match_status='matched_unique_name' AND metric_date<=?
    UNION ALL
    SELECT metric_date, ad_id, impressions, clicks, conversions, sales_count, spend, revenue
    FROM ad_daily_fact
    WHERE store_id=? AND metric_date<=?
      AND NOT EXISTS (
        SELECT 1 FROM ad_export_daily_staging s
        WHERE s.store_id=ad_daily_fact.store_id AND s.metric_date=ad_daily_fact.metric_date
      )
  ), agg AS (
    SELECT ad_id,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN impressions ELSE 0 END) impressions7,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN clicks ELSE 0 END) clicks7,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN conversions ELSE 0 END) conversions7,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN spend ELSE 0 END) spend7,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN revenue ELSE 0 END) revenue7,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN impressions ELSE 0 END) impressions30,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN clicks ELSE 0 END) clicks30,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN conversions ELSE 0 END) conversions30,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN sales_count ELSE 0 END) sales30,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN spend ELSE 0 END) spend30,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN revenue ELSE 0 END) revenue30,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN clicks ELSE 0 END) clicksLife,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN conversions ELSE 0 END) conversionsLife,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN spend ELSE 0 END) spendLife,
      SUM(CASE WHEN metric_date BETWEEN ? AND ? THEN revenue ELSE 0 END) revenueLife,
      SUM(CASE WHEN metric_date=? THEN spend ELSE 0 END) spendD1,
      SUM(CASE WHEN metric_date=? THEN revenue ELSE 0 END) revenueD1,
      SUM(CASE WHEN metric_date=? THEN conversions ELSE 0 END) conversionsD1
    FROM metrics GROUP BY ad_id
  )
  SELECT m.ad_id adId, m.ad_name adName, m.ad_type adType, m.product_id productId,
         m.daily_budget dailyBudget, m.target_roas targetRoas,
         COALESCE(a.impressions7,0) impressions7, COALESCE(a.clicks7,0) clicks7,
         COALESCE(a.conversions7,0) conversions7, COALESCE(a.spend7,0) spend7, COALESCE(a.revenue7,0) revenue7,
         COALESCE(a.impressions30,0) impressions30, COALESCE(a.clicks30,0) clicks30,
         COALESCE(a.conversions30,0) conversions30, COALESCE(a.sales30,0) sales30,
         COALESCE(a.spend30,0) spend30, COALESCE(a.revenue30,0) revenue30,
         COALESCE(a.clicksLife,0) clicksLife, COALESCE(a.conversionsLife,0) conversionsLife,
         COALESCE(a.spendLife,0) spendLife, COALESCE(a.revenueLife,0) revenueLife,
         COALESCE(a.spendD1,0) spendD1, COALESCE(a.revenueD1,0) revenueD1, COALESCE(a.conversionsD1,0) conversionsD1
  FROM ad_master m LEFT JOIN agg a ON a.ad_id=m.ad_id
  WHERE m.store_id=? AND EXISTS (
    SELECT 1 FROM ad_daily_fact snapshot
    WHERE snapshot.store_id=m.store_id AND snapshot.ad_id=m.ad_id AND snapshot.metric_date=?
  )
  ORDER BY m.ad_type, m.ad_id
`).all(
  storeId, analysisDate, storeId, analysisDate,
  start7, analysisDate, start7, analysisDate, start7, analysisDate, start7, analysisDate, start7, analysisDate,
  start30, analysisDate, start30, analysisDate, start30, analysisDate, start30, analysisDate, start30, analysisDate, start30, analysisDate,
  startLife, analysisDate, startLife, analysisDate, startLife, analysisDate, startLife, analysisDate,
  analysisDate, analysisDate, analysisDate, storeId, snapshotDate,
);

const ratio = (n, d, digits=2) => d ? Number((n / d).toFixed(digits)) : 0;
function classify(x) {
  const roas7 = ratio(x.revenue7, x.spend7);
  const roas30 = ratio(x.revenue30, x.spend30);
  const evidence = {
    d1: { spend:x.spendD1, revenue:x.revenueD1, conversions:x.conversionsD1, roas:ratio(x.revenueD1,x.spendD1) },
    d7: { impressions:x.impressions7, clicks:x.clicks7, conversions:x.conversions7, spend:Number(x.spend7.toFixed(2)), revenue:Number(x.revenue7.toFixed(2)), roas:roas7 },
    d30: { impressions:x.impressions30, clicks:x.clicks30, conversions:x.conversions30, sales:x.sales30, spend:Number(x.spend30.toFixed(2)), revenue:Number(x.revenue30.toFixed(2)), roas:roas30 },
    lifetime: { clicks:x.clicksLife, conversions:x.conversionsLife, spend:Number(x.spendLife.toFixed(2)), revenue:Number(x.revenueLife.toFixed(2)), roas:ratio(x.revenueLife,x.spendLife) },
  };
  const groupSuffix = x.adType === 'manual_mpd' ? '；群組需先下鑽商品層再調整' : '';
  if (x.spend30 >= 100 && x.conversions30 === 0 && x.clicks30 >= 20)
    return ['pause_candidate', 5, `近30天已有足夠點擊與花費但沒有轉換${groupSuffix}`, '可能持續消耗預算；停投前確認延遲歸因、商品庫存與促銷', evidence];
  if (x.spend30 >= 100 && x.conversions30 > 0 && roas30 < 1.5)
    return ['reduce_candidate', 4, `近30天有轉換但ROAS低於1.5${groupSuffix}`, '缺少毛利資料，不能直接判定虧損；先降預算並查低效商品', evidence];
  if (x.conversions30 >= 3 && roas30 >= 3 && x.conversions7 >= 1 && roas7 >= 2.5)
    return ['scale_candidate', 4, '近30天與近7天均有穩定轉換，具擴量條件', '擴量可能推高每次點擊成本；每次預算增幅宜控制在10%至20%', evidence];
  if (x.conversions30 > 0 && x.spend7 >= 50 && roas30 >= 2 && roas7 < 1.5)
    return ['recent_decline', 4, `30天有效但近7天明顯轉弱${groupSuffix}`, '可能是短期波動或歸因延遲；先查最近商品、價格、庫存和競價', evidence];
  if (x.conversions30 > 0 && roas30 >= 2)
    return ['hold_effective', 2, '近30天有轉換且ROAS至少2，先維持', '需補商品成本與平台費用後才能確認實際盈利', evidence];
  if (x.conversions30 === 0 && (x.clicks30 >= 15 || x.spend30 >= 50))
    return ['optimize_candidate', 3, `已有一定流量但尚未轉換${groupSuffix}`, '檢查價格、優惠、主圖、評價、庫存及落地頁後再決定是否停投', evidence];
  if (x.spend7 === 0)
    return ['no_recent_delivery', 2, '近7天沒有花費，需確認是否實際獲得曝光', '可能受出價、預算、庫存、審核或商品狀態影響', evidence];
  return ['observe_low_sample', 1, '目前樣本不足，繼續累積', '過早調整可能因小樣本造成誤判', evidence];
}

const items = rows.map((x) => {
  const [status, priority, reason, risk, evidence] = classify(x);
  return { ...x, status, priority, reason, risk, evidence };
}).sort((a,b) => b.priority-a.priority || b.evidence.d30.spend-a.evidence.d30.spend);

const counts = {};
const typeCounts = {};
for (const x of items) {
  counts[x.status] = (counts[x.status] || 0) + 1;
  typeCounts[x.adType] = (typeCounts[x.adType] || 0) + 1;
}
const totals30 = items.reduce((a,x) => {
  for (const k of ['spend','revenue','clicks','conversions']) a[k] += Number(x.evidence.d30[k] || 0);
  return a;
}, {spend:0,revenue:0,clicks:0,conversions:0});
totals30.spend = Number(totals30.spend.toFixed(2));
totals30.revenue = Number(totals30.revenue.toFixed(2));
totals30.roas = ratio(totals30.revenue, totals30.spend);

const output = {
  generatedAt:new Date().toISOString(), storeId, displayName, snapshotDate, analysisDate,
  windows:{ d7:[start7,analysisDate], d30:[start30,analysisDate], lifetime:[startLife,analysisDate] },
  completeness:{ activeAds:items.length, byType:typeCounts, currentSnapshot:'complete', decisionCutoff:'D-1' },
  profitabilityStatus:'unavailable_without_product_cost_and_platform_fee',
  counts, totals30,
  actionItems:items.filter(x=>x.priority>=3).slice(0,20),
  scaleCandidates:items.filter(x=>x.status==='scale_candidate').slice(0,20),
  allItems:items,
};

const outDir = path.join(root, 'analysis', 'active-ads', snapshotDate);
fs.mkdirSync(outDir,{recursive:true});
const jsonPath = path.join(outDir,'active-ad-decisions.json');
const csvPath = path.join(outDir,'active-ad-decisions.csv');
const mdPath = path.join(outDir,'active-ad-decisions.md');
fs.writeFileSync(jsonPath,JSON.stringify(output,null,2));
const cols=['adId','adName','adType','productId','dailyBudget','targetRoas','status','priority','reason','risk'];
const esc=(v)=>`"${String(v??'').replaceAll('"','""')}"`;
fs.writeFileSync(csvPath,'\uFEFF'+[cols.join(','),...items.map(x=>cols.map(k=>esc(x[k])).join(','))].join('\r\n'));
const money=v=>Number(v||0).toFixed(2);
const lines=[
  `# ${displayName} 進行中廣告決策表`, '',
  `決策截止日：${analysisDate}（D-1）；廣告狀態快照：${snapshotDate}。`, '',
  `進行中廣告：${items.length}；單品${typeCounts.single_product||0}；群組${typeCounts.manual_mpd||0}。`,
  `近30天花費NT$${money(totals30.spend)}、廣告營收NT$${money(totals30.revenue)}、ROAS ${totals30.roas.toFixed(2)}。`, '',
  '## 分類數量','',
  ...Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`- ${k}: ${v}`), '',
  '## 優先處理前20項','',
  '| 廣告ID | 類型 | 廣告 | 判斷 | 30天花費 | 30天營收 | ROAS | 30天轉換 | 理由 | 風險 |',
  '|---|---|---|---|---:|---:|---:|---:|---|---|',
  ...output.actionItems.map(x=>`| ${x.adId} | ${x.adType==='manual_mpd'?'群組':'單品'} | ${x.adName.replaceAll('|','/')} | ${x.status} | ${money(x.evidence.d30.spend)} | ${money(x.evidence.d30.revenue)} | ${x.evidence.d30.roas.toFixed(2)} | ${x.evidence.d30.conversions} | ${x.reason} | ${x.risk} |`),
  '', '## 擴量候選','',
  ...output.scaleCandidates.map(x=>`- ${x.adId}｜${x.adName}｜近30天花費NT$${money(x.evidence.d30.spend)}、營收NT$${money(x.evidence.d30.revenue)}、ROAS ${x.evidence.d30.roas.toFixed(2)}；近7天ROAS ${x.evidence.d7.roas.toFixed(2)}。`),
  '', '## 使用限制','',
  '- 未取得商品成本及平台費用，分類只能反映廣告效率，不能直接代表盈利。',
  '- 群組廣告在降預算或停投前，必須先檢查群組內商品層，避免關閉仍有貢獻的商品。',
  '- 所有動作均為候選建議，本階段不自動修改蝦皮廣告。',
];
fs.writeFileSync(mdPath,lines.join('\n'));
db.close();
console.log(JSON.stringify({jsonPath,csvPath,mdPath,activeAds:items.length,byType:typeCounts,counts,totals30,actionItems:output.actionItems.length,scaleCandidates:output.scaleCandidates.length}));
