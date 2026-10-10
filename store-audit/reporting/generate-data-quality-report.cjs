const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { root, writeReport } = require('./report-utils.cjs');

const metricDate = process.argv[2] || '2026-10-07';
const snapshotDate = process.argv[3] || '2026-10-08';
const storeId='27857268786685',displayName='拾味廚房雜貨鋪',version=1,ruleVersion='data-quality-1.0';
const csvPath=path.join(root,'backfill','raw','ads','daily',metricDate.slice(0,7),`${metricDate}-overall.csv`);
const checkpointPath=path.join(root,'ad-daily',snapshotDate,'ad-level-checkpoint.json');
const settingsPath=path.join(root,'config','system-settings.json');
for(const p of [csvPath,checkpointPath,settingsPath]) if(!fs.existsSync(p)) throw new Error(`Missing source: ${p}`);
const checkpoint=JSON.parse(fs.readFileSync(checkpointPath,'utf8').replace(/^\uFEFF/,''));
const db=new DatabaseSync(path.join(root,'db','store-audit.sqlite'));
const stage=db.prepare(`SELECT COUNT(*) rows,
 SUM(CASE WHEN match_status='matched_unique_name' THEN 1 ELSE 0 END) matched,
 SUM(CASE WHEN match_status='unmatched' THEN 1 ELSE 0 END) unmatched,
 SUM(CASE WHEN match_status='ambiguous' THEN 1 ELSE 0 END) ambiguous
 FROM ad_export_daily_staging WHERE store_id=? AND metric_date=?`).get(storeId,metricDate);
const manifest=db.prepare(`SELECT row_count,status,content_hash FROM backfill_manifest
 WHERE store_id=? AND module='advertising' AND period_start=? AND period_end=? AND source_granularity='daily_export'
 ORDER BY imported_at DESC LIMIT 1`).get(storeId,metricDate,metricDate);
const start='2026-08-14',end=metricDate;
const dates=[];for(let d=new Date(`${start}T00:00:00Z`),e=new Date(`${end}T00:00:00Z`);d<=e;d.setUTCDate(d.getUTCDate()+1))dates.push(d.toISOString().slice(0,10));
const covered=new Set([
  ...db.prepare(`SELECT DISTINCT metric_date d FROM ad_export_daily_staging WHERE store_id=? AND metric_date BETWEEN ? AND ?`).all(storeId,start,end).map(x=>x.d),
  ...db.prepare(`SELECT DISTINCT metric_date d FROM ad_daily_fact WHERE store_id=? AND metric_date BETWEEN ? AND ?`).all(storeId,start,end).map(x=>x.d),
]);
const missingDates=dates.filter(x=>!covered.has(x));
const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
const definitions=db.prepare('SELECT COUNT(*) n FROM report_definition').get().n;
db.close();
const warnings=[];
if(stage.unmatched)warnings.push(`${stage.unmatched}筆名稱未配對廣告主檔`);
if(stage.ambiguous)warnings.push(`${stage.ambiguous}筆名稱有歧義`);
if(missingDates.length)warnings.push(`歷史範圍缺少${missingDates.length}天`);
if(checkpoint.status!=='complete')warnings.push(`${snapshotDate}進行中廣告同步未完成`);
const actions=[];
if(stage.unmatched)actions.push({entityType:'data_mapping',entityId:`ads-${metricDate}`,priority:3,status:'mapping_review',reason:`${stage.unmatched}筆未配對`,recommendation:'補抓或更新廣告主檔後重新配對',risk:'未配對資料不進入正式廣告決策',evidencePeriod:metricDate});
if(missingDates.length)actions.push({entityType:'data_gap',entityId:`history-${start}-${end}`,priority:5,status:'missing_dates',reason:`缺少${missingDates.length}天`,recommendation:'按每天最多一份報表分批回填',risk:'期間彙總可能不完整',evidencePeriod:`${start}_to_${end}`});
const generatedAt=new Date().toISOString();
const complete=Boolean(manifest&&manifest.status==='complete'&&integrity==='ok'&&!missingDates.length&&checkpoint.status==='complete');
const report={
 identity:{storeId,storeDisplayName:displayName,reportKey:'data_quality_daily',definitionVersion:version,periodStart:metricDate,periodEnd:metricDate,dataCutoffAt:`${snapshotDate}T09:09:18+08:00`,dataStatus:complete?'provisional':'partial'},
 summary:{headline:`${metricDate}資料品質與完整性`,metrics:[
  {key:'source_rows',label:'來源筆數',value:stage.rows||0,unit:'count',comparison:null},
  {key:'matched_rows',label:'成功配對',value:stage.matched||0,unit:'count',comparison:null},
  {key:'unmatched_rows',label:'未配對',value:stage.unmatched||0,unit:'count',comparison:null},
  {key:'missing_dates',label:'缺失日期',value:missingDates.length,unit:'count',comparison:null},
  {key:'report_definitions',label:'報表定義',value:definitions,unit:'count',comparison:null},
 ]},
 actions:actions.slice(0,20),opportunities:[],
 dataQuality:{isComplete:complete,missingDates,unmatchedRows:stage.unmatched||0,warnings},
 execution:{state:'not_executed',approvalRequired:false,approvedBy:null,executedAt:null},
 traceability:{runId:null,ruleVersion,sourceFingerprint:null,generatedAt},
};
const md=[`# ${displayName}｜資料品質日報`,'',`資料期間：${metricDate}`,'',
 '## 核心指標','',`- 來源${stage.rows||0}筆；成功配對${stage.matched||0}筆；未配對${stage.unmatched||0}筆；歧義${stage.ambiguous||0}筆。`,
 `- 開店日至${metricDate}缺失日期：${missingDates.length}；SQLite完整性：${integrity}；報表定義：${definitions}。`,
 `- ${snapshotDate}進行中廣告同步：${checkpoint.status}，${checkpoint.lastCompletedPage}/${checkpoint.pageCount}頁。`,
 '','## 需要行動','',...(actions.length?actions.map(x=>`- ${x.status}｜${x.reason}｜${x.recommendation}｜風險：${x.risk}`):['- 無阻塞項目。']),
 '','## 資料品質限制','',...warnings.map(x=>`- ${x}`),''].join('\n');
const result=writeReport({reportKey:'data_quality_daily',version,period:{start:metricDate,end:metricDate},
 dataCutoffAt:report.identity.dataCutoffAt,dataStatus:report.identity.dataStatus,ruleVersion,
 parameters:{metricDate,snapshotDate},sources:[csvPath,checkpointPath,settingsPath],
 sourceContext:{stage,manifest,missingDates,integrity,definitions,checkpointStatus:checkpoint.status},report,markdown:md});
report.traceability.runId=result.runId;report.traceability.sourceFingerprint=result.sourceFingerprint;
fs.writeFileSync(result.reportPath,JSON.stringify(report,null,2));
console.log(JSON.stringify({runId:result.runId,reportPath:result.reportPath,manifestPath:result.manifestPath,isComplete:complete,actions:actions.length,warnings:warnings.length}));
