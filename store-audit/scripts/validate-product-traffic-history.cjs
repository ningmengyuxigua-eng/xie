const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const storeId = process.argv[2] || '27857268786685';
const expectedStart = process.argv[3] || '2026-08-14';
const expectedEnd = process.argv[4] || '2026-10-09';
const dbPath = path.join(__dirname,'..','db','store-audit.sqlite');
const outDir = path.join(__dirname,'..','product-report','2026-10-10');
fs.mkdirSync(outDir,{recursive:true});
const db = new DatabaseSync(dbPath,{readOnly:true});

const dates=[];
for(let d=new Date(`${expectedStart}T00:00:00Z`), end=new Date(`${expectedEnd}T00:00:00Z`);d<=end;d.setUTCDate(d.getUTCDate()+1)) dates.push(d.toISOString().slice(0,10));
const dayRows=db.prepare(`SELECT metric_date,expected_products,collected_products,expected_pages,collected_pages,collection_status,natural_scope_status FROM product_traffic_collection_day WHERE store_id=? AND metric_date BETWEEN ? AND ? ORDER BY metric_date`).all(storeId,expectedStart,expectedEnd);
const present=new Set(dayRows.map(x=>x.metric_date));
const missingDates=dates.filter(x=>!present.has(x));
const incompleteDays=dayRows.filter(x=>x.collection_status!=='complete'||x.expected_products!==x.collected_products||x.expected_pages!==x.collected_pages);
const coverage=db.prepare(`SELECT COUNT(*) row_count,COUNT(DISTINCT metric_date) day_count,COUNT(DISTINCT product_id) product_count,MIN(metric_date) first_date,MAX(metric_date) last_date,SUM(CASE WHEN natural_scope_status='verified' THEN 1 ELSE 0 END) verified_natural_rows,SUM(CASE WHEN product_card_impressions IS NULL THEN 1 ELSE 0 END) missing_total_impression_rows FROM product_traffic_daily WHERE store_id=? AND metric_date BETWEEN ? AND ?`).get(storeId,expectedStart,expectedEnd);
const sourceCoverage=db.prepare(`SELECT COUNT(*) row_count,COUNT(DISTINCT metric_date) day_count,COUNT(DISTINCT channel||':'||source_code) source_count FROM product_traffic_source_daily WHERE store_id=? AND metric_date BETWEEN ? AND ?`).get(storeId,expectedStart,expectedEnd);
const result={
  generatedAt:new Date().toISOString(),storeId,storeDisplayName:'拾味廚房雜貨鋪',period:{start:expectedStart,end:expectedEnd,expectedDays:dates.length},
  productCardTraffic:{...coverage,complete:missingDates.length===0&&incompleteDays.length===0&&coverage.day_count===dates.length},
  sourceTraffic:sourceCoverage,
  missingDates,incompleteDays,
  trafficMetric:{status:'approved',scope:'product_card_total',reason:'商品卡總瀏覽用於商品零瀏覽與下架候選篩選；廣告曝光與點擊獨立保存。'},
  automationGate:{ready:missingDates.length===0&&incompleteDays.length===0,reason:'product_card_history_complete'},
  reportGate:{status:dates.length>=60?'final_traffic_coverage':'partial',formalPptAllowed:false}
};
fs.writeFileSync(path.join(outDir,'traffic-history-validation.json'),JSON.stringify(result,null,2));
const md=`# 商品流量歷史回補驗證\n\n- 賣場：拾味廚房雜貨鋪\n- 期間：${expectedStart} 至 ${expectedEnd}（${dates.length} 天）\n- 商品日資料：${coverage.row_count.toLocaleString()} 筆\n- 歷史商品：${coverage.product_count.toLocaleString()} 個\n- 商品卡總流量：${result.productCardTraffic.complete?'完整':'不完整'}\n- 缺失日期：${missingDates.length}\n- 不完整日期：${incompleteDays.length}\n- 下架篩選口徑：商品卡總瀏覽量\n- 廣告資料：獨立分欄，不併入商品卡流量\n- 定時任務：可啟用每日增量\n- 正式下架審核：需滿 60 日覆蓋與其他排除條件\n`;
fs.writeFileSync(path.join(outDir,'traffic-history-validation.md'),md);
db.close();
console.log(JSON.stringify(result,null,2));
