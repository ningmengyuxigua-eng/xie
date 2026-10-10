const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { root, writeReport } = require('./report-utils.cjs');

const metricDate = process.argv[2] || '2026-10-07';
const snapshotDate = process.argv[3] || '2026-10-08';
const storeId = '27857268786685';
const displayName = '拾味廚房雜貨鋪';
const version = 1;
const ruleVersion = 'active-ad-history-1.0';
const decisionPath = path.join(root, 'analysis', 'active-ads', snapshotDate, 'active-ad-decisions.json');
const dailyCsvPath = path.join(root, 'backfill', 'raw', 'ads', 'daily', metricDate.slice(0,7), `${metricDate}-overall.csv`);
const settingsPath = path.join(root, 'config', 'system-settings.json');
for (const p of [decisionPath,dailyCsvPath,settingsPath]) if (!fs.existsSync(p)) throw new Error(`Missing source: ${p}`);
const decisions = JSON.parse(fs.readFileSync(decisionPath,'utf8'));
const db = new DatabaseSync(path.join(root,'db','store-audit.sqlite'));
const totals = db.prepare(`
  SELECT COUNT(*) adRows,SUM(CASE WHEN spend>0 THEN 1 ELSE 0 END) adsWithSpend,
    SUM(impressions) impressions,SUM(clicks) clicks,SUM(conversions) conversions,
    SUM(sales_count) salesCount,ROUND(SUM(spend),2) spend,ROUND(SUM(revenue),2) revenue,
    SUM(CASE WHEN match_status='unmatched' THEN 1 ELSE 0 END) unmatched,
    SUM(CASE WHEN match_status='ambiguous' THEN 1 ELSE 0 END) ambiguous
  FROM ad_export_daily_staging WHERE store_id=? AND metric_date=?
`).get(storeId,metricDate);
db.close();
const roas = totals.spend ? Number((totals.revenue/totals.spend).toFixed(2)) : 0;
const generatedAt = new Date().toISOString();
const actions = decisions.actionItems.slice(0,20).map((x) => ({
  entityType:x.adType==='manual_mpd'?'ad_group':'ad', entityId:x.adId, entityName:x.adName,
  priority:x.priority, status:x.status, reason:x.reason, recommendation:x.reason,
  risk:x.risk, evidencePeriod:'rolling_30d', evidence:x.evidence,
}));
const opportunities = decisions.scaleCandidates.slice(0,20).map((x) => ({
  entityType:x.adType==='manual_mpd'?'ad_group':'ad', entityId:x.adId, entityName:x.adName,
  status:'scale_candidate', reason:x.reason, risk:x.risk, evidencePeriod:'rolling_30d', evidence:x.evidence,
}));
const report = {
  identity:{storeId,storeDisplayName:displayName,reportKey:'ad_daily',definitionVersion:version,
    periodStart:metricDate,periodEnd:metricDate,dataCutoffAt:`${snapshotDate}T09:09:18+08:00`,dataStatus:'provisional'},
  summary:{headline:`${metricDate}廣告表現與進行中廣告決策`,metrics:[
    {key:'spend',label:'廣告花費',value:totals.spend||0,unit:'TWD',comparison:null},
    {key:'revenue',label:'廣告營收',value:totals.revenue||0,unit:'TWD',comparison:null},
    {key:'roas',label:'ROAS',value:roas,unit:'ratio',comparison:null},
    {key:'clicks',label:'點擊',value:totals.clicks||0,unit:'count',comparison:null},
    {key:'conversions',label:'轉換',value:totals.conversions||0,unit:'count',comparison:null},
    {key:'ads_with_spend',label:'有花費廣告',value:totals.adsWithSpend||0,unit:'count',comparison:null},
  ]},
  actions,opportunities,
  dataQuality:{isComplete:true,missingDates:[],unmatchedRows:totals.unmatched||0,
    warnings:[...(totals.unmatched? [`${totals.unmatched}筆廣告名稱未配對主檔`]:[]),'D-1資料需於D-3回補延遲歸因']},
  execution:{state:'not_executed',approvalRequired:true,approvedBy:null,executedAt:null},
  traceability:{runId:null,ruleVersion,sourceFingerprint:null,generatedAt},
};
const money=(v)=>Number(v||0).toFixed(2);
const md=[`# ${displayName}｜廣告D-1日報`,'',`資料期間：${metricDate}`,
  `資料狀態：provisional；需於D-3回補。`,'','## 核心指標','',
  `- 花費：NT$${money(totals.spend)}；廣告營收：NT$${money(totals.revenue)}；ROAS：${roas.toFixed(2)}`,
  `- 點擊：${totals.clicks||0}；轉換：${totals.conversions||0}；有花費廣告：${totals.adsWithSpend||0}`,
  '','## 需要行動','',...actions.map(x=>`- ${x.entityId}｜${x.entityName}｜${x.status}｜${x.reason}｜風險：${x.risk}`),
  '','## 機會項目','',...opportunities.map(x=>`- ${x.entityId}｜${x.entityName}｜${x.reason}｜風險：${x.risk}`),
  '','## 資料品質','',`- 未配對：${totals.unmatched||0}；歧義配對：${totals.ambiguous||0}。`,
  '','## 執行狀態','', '- 未執行；所有廣告調整需要人工審核。',''].join('\n');

const result = writeReport({reportKey:'ad_daily',version,period:{start:metricDate,end:metricDate},
  dataCutoffAt:report.identity.dataCutoffAt,dataStatus:'provisional',ruleVersion,
  parameters:{metricDate,snapshotDate},sources:[decisionPath,dailyCsvPath,settingsPath],sourceContext:{totals},report,markdown:md});
report.traceability.runId=result.runId;report.traceability.sourceFingerprint=result.sourceFingerprint;
fs.writeFileSync(result.reportPath,JSON.stringify(report,null,2));
console.log(JSON.stringify({runId:result.runId,reportPath:result.reportPath,manifestPath:result.manifestPath,metrics:report.summary.metrics.length,actions:actions.length,opportunities:opportunities.length}));
