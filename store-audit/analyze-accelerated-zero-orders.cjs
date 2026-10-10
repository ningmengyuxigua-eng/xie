const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const observedDate = process.argv[2];
const metricDate = process.argv[3];
if (!/^\d{4}-\d{2}-\d{2}$/.test(observedDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(metricDate || '')) {
  throw new Error('Usage: node analyze-accelerated-zero-orders.cjs OBSERVED_DATE METRIC_DATE');
}
const acceleratedPath = path.join(root, 'ad-daily', observedDate, 'accelerated-ads.json');
const decisionsPath = path.join(root, 'analysis', 'active-ads', metricDate, 'active-ad-decisions.json');
const accelerated = JSON.parse(fs.readFileSync(acceleratedPath, 'utf8'));
const decisions = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
const ids = new Set(accelerated.items.map(x => String(x.adId)));
const money = value => Number(Number(value || 0).toFixed(2));
const rows = decisions.allItems.filter(x => ids.has(String(x.adId))).map(x => ({
  adId:x.adId, adName:x.adName, adType:x.adType, status:x.status,
  d1:x.evidence.d1, d7:x.evidence.d7, d30:x.evidence.d30,
}));
const zeroD1 = rows.filter(x => x.d1.conversions === 0);
const zero7 = rows.filter(x => x.d7.conversions === 0);
const zero30 = rows.filter(x => x.d30.conversions === 0).sort((a,b)=>b.d30.spend-a.d30.spend);
const highRisk = zero30.filter(x => x.d30.spend >= 100 || x.d30.clicks >= 30);
const mediumRisk = zero30.filter(x => !highRisk.includes(x) && (x.d30.spend >= 50 || x.d30.clicks >= 15));
const lowSample = zero30.filter(x => !highRisk.includes(x) && !mediumRisk.includes(x));
const totals = list => list.reduce((a,x)=>{a.spend+=x.d30.spend;a.clicks+=x.d30.clicks;return a;},{spend:0,clicks:0});
const zeroTotals = totals(zero30); zeroTotals.spend=money(zeroTotals.spend);
const firstObservationBatch = zero30.slice(0,3);
const output = {
  generatedAt:new Date().toISOString(), observedDate, metricDate,
  storeId:accelerated.storeId, displayName:accelerated.displayName,
  completeness:{acceleratedAds:accelerated.acceleratedAds,matched:rows.length,unmatched:accelerated.acceleratedAds-rows.length,status:rows.length===accelerated.acceleratedAds?'complete':'partial'},
  counts:{zeroD1:zeroD1.length,zero7:zero7.length,zero30:zero30.length,highRisk:highRisk.length,mediumRisk:mediumRisk.length,lowSample:lowSample.length},
  zero30Totals:zeroTotals,firstObservationBatch,zero30Items:zero30,
  executionPolicy:{mode:'observe_only',automaticChanges:false,firstBatchMax:3,waitFor:'D+3 attribution',observationDaysAfterChange:3},
};
const outDir = path.join(root, 'analysis', 'active-ads', metricDate);
const jsonPath = path.join(outDir, 'accelerated-zero-order-analysis.json');
const mdPath = path.join(outDir, 'accelerated-zero-order-analysis.md');
fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
const row = (x,i) => `| ${i+1} | ${x.adId} | ${String(x.adName).replaceAll('|','/')} | ${x.d30.clicks} | NT$${money(x.d30.spend).toFixed(2)} | ${x.d7.conversions} | ${x.d30.conversions} |`;
const lines = [
  `# ${accelerated.displayName}｜加速推廣零出單分析`, '',
  `加速推廣群組${accelerated.acceleratedAds}個；昨日零出單${zeroD1.length}個、近7天零出單${zero7.length}個、近30天零出單${zero30.length}個。`,
  `近30天零出單群組合計${zeroTotals.clicks}次點擊、花費NT$${zeroTotals.spend.toFixed(2)}。`, '',
  '## 近30天完全沒有出單', '',
  '| 順序 | 廣告群組ID | 群組 | 30天點擊 | 30天花費 | 7天轉換 | 30天轉換 |',
  '|---:|---:|---|---:|---:|---:|---:|',
  ...zero30.map(row), '',
  '## 第一批觀察', '',
  '目前不關閉加速。先觀察下列3個花費最高的群組至D+3：', '',
  ...firstObservationBatch.map((x,i)=>`${i+1}. ${x.adId}｜${x.adName}：30天${x.d30.clicks}次點擊、花費NT$${money(x.d30.spend).toFixed(2)}、0轉換。`), '',
  '## 執行規則', '',
  '- 等待D+3歸因後再判斷，不依單日結果關閉加速。',
  '- 第一輪最多處理3個群組；若需要調整，先處理1個並觀察3天。',
  '- 先檢查群組內是否存在有成交商品；有成交商品時只調整低效單品，不關整組。',
  '- 本分析沒有修改任何加速推廣或廣告狀態。',
];
fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);
console.log(JSON.stringify({jsonPath,mdPath,completeness:output.completeness,counts:output.counts,zero30Totals:output.zero30Totals,firstObservationBatch:firstObservationBatch.map(x=>x.adId)}));
