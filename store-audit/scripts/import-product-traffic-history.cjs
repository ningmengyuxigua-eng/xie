const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const storeId = process.argv[2] || '27857268786685';
const rawRoot = path.resolve(process.argv[3] || path.join(__dirname, '..', 'product-traffic', 'raw'));
const dbPath = path.resolve(process.argv[4] || path.join(__dirname, '..', 'db', 'store-audit.sqlite'));
const requestedStart = process.argv[5] || null;
const requestedEnd = process.argv[6] || requestedStart;
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');

const clean = (value) => value === -1000000 || value === undefined ? null : value;
const bool = (value) => value === undefined || value === null ? null : value ? 1 : 0;
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const isoNow = () => new Date().toISOString();

const upsertDay = db.prepare(`
  INSERT INTO product_traffic_collection_day(
    store_id,metric_date,expected_products,collected_products,expected_pages,collected_pages,
    page_size,collection_status,natural_scope_status,started_at,completed_at,raw_directory,error_summary
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(store_id,metric_date) DO UPDATE SET
    expected_products=excluded.expected_products,collected_products=excluded.collected_products,
    expected_pages=excluded.expected_pages,collected_pages=excluded.collected_pages,
    page_size=excluded.page_size,collection_status=excluded.collection_status,
    natural_scope_status=excluded.natural_scope_status,completed_at=excluded.completed_at,
    raw_directory=excluded.raw_directory,error_summary=excluded.error_summary
`);

const upsertTraffic = db.prepare(`
  INSERT INTO product_traffic_daily(
    store_id,product_id,metric_date,product_name,source_status,sales_ratio,sales_twd,orders,units,buyers,
    product_card_impressions,unique_product_card_impressions,product_clicks,unique_product_clicks,
    ctr,order_conversion_rate,average_order_value_twd,natural_impressions,natural_clicks,natural_scope_status,
    has_ad_entry,campaign_id,is_boost_with_ads,source_path,source_payload_hash,observed_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(store_id,product_id,metric_date) DO UPDATE SET
    product_name=excluded.product_name,source_status=excluded.source_status,sales_ratio=excluded.sales_ratio,
    sales_twd=excluded.sales_twd,orders=excluded.orders,units=excluded.units,buyers=excluded.buyers,
    product_card_impressions=excluded.product_card_impressions,
    unique_product_card_impressions=excluded.unique_product_card_impressions,
    product_clicks=excluded.product_clicks,unique_product_clicks=excluded.unique_product_clicks,
    ctr=excluded.ctr,order_conversion_rate=excluded.order_conversion_rate,
    average_order_value_twd=excluded.average_order_value_twd,natural_impressions=NULL,natural_clicks=NULL,
    natural_scope_status='not_separated',has_ad_entry=excluded.has_ad_entry,campaign_id=excluded.campaign_id,
    is_boost_with_ads=excluded.is_boost_with_ads,source_path=excluded.source_path,
    source_payload_hash=excluded.source_payload_hash,observed_at=excluded.observed_at
`);

const upsertSource = db.prepare(`
  INSERT INTO product_traffic_source_daily(
    store_id,metric_date,channel,source_code,sales_twd,orders,units,buyers,impressions,unique_impressions,
    clicks,unique_clicks,ctr,order_conversion_rate,ad_expense_twd,ad_roas,source_path,observed_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(store_id,metric_date,channel,source_code) DO UPDATE SET
    sales_twd=excluded.sales_twd,orders=excluded.orders,units=excluded.units,buyers=excluded.buyers,
    impressions=excluded.impressions,unique_impressions=excluded.unique_impressions,
    clicks=excluded.clicks,unique_clicks=excluded.unique_clicks,ctr=excluded.ctr,
    order_conversion_rate=excluded.order_conversion_rate,ad_expense_twd=excluded.ad_expense_twd,
    ad_roas=excluded.ad_roas,source_path=excluded.source_path,observed_at=excluded.observed_at
`);

function writeSource(date, channel, row, sourcePath, observedAt) {
  if (!row || !row.source) return;
  upsertSource.run(storeId,date,channel,String(row.source),clean(row.sales),clean(row.orders),clean(row.units),
    clean(row.buyers),clean(row.product_impressions),clean(row.unique_product_impressions),
    clean(row.product_clicks),clean(row.unique_product_clicks),clean(row.ctr),
    clean(row.product_clicks_to_orders_rate),clean(row.ads_expense),clean(row.ads_roas),sourcePath,observedAt);
}

const dateDirs = fs.existsSync(rawRoot)
  ? fs.readdirSync(rawRoot,{withFileTypes:true}).filter(x=>x.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(x.name))
      .filter(x=>(!requestedStart || x.name>=requestedStart) && (!requestedEnd || x.name<=requestedEnd)).sort()
  : [];
let importedDays=0, importedRows=0, sourceRows=0;
for (const dirent of dateDirs) {
  const date = dirent.name;
  const dayDir = path.join(rawRoot,date);
  const pages = fs.readdirSync(dayDir).filter(x=>/^page-\d{3}\.json$/.test(x)).sort();
  if (!pages.length) continue;
  const first = JSON.parse(fs.readFileSync(path.join(dayDir,pages[0]),'utf8'));
  const total = Number(first.response?.result?.total ?? 0);
  const pageSize = Number(first.pageSize || 20);
  const expectedPages = Math.ceil(total/pageSize);
  let dayRows=0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const file of pages) {
      const full = path.join(dayDir,file);
      const text = fs.readFileSync(full,'utf8');
      const payload = JSON.parse(text);
      const items = payload.response?.result?.item || [];
      for (const item of items) {
        upsertTraffic.run(storeId,String(item.id),date,item.name ?? null,clean(item.status),clean(item.sales_ratio),
          clean(item.sales),clean(item.orders),clean(item.units),clean(item.buyers),clean(item.product_impressions),
          clean(item.unique_product_impressions),clean(item.product_clicks),clean(item.unique_product_clicks),
          clean(item.ctr),clean(item.product_clicks_to_orders_rate),clean(item.sales_per_order),null,null,
          'not_separated',bool(item.view_ads),item.campaign_id == null ? null : String(item.campaign_id),
          bool(item.is_boost_with_ads),path.relative(path.join(__dirname,'..'),full).replaceAll('\\','/'),hash(text),
          payload.collectedAt || isoNow());
        dayRows++;
      }
    }
    const overviewPath = path.join(dayDir,'overview.json');
    if (fs.existsSync(overviewPath)) {
      const overview = JSON.parse(fs.readFileSync(overviewPath,'utf8'));
      const result = overview.response?.result || {};
      for (const [channel, group] of Object.entries(result)) {
        if (!group || channel === 'overview') continue;
        writeSource(date,channel,group.total, path.relative(path.join(__dirname,'..'),overviewPath).replaceAll('\\','/'),overview.collectedAt || isoNow());
        sourceRows++;
        for (const row of group.breakdown || []) {
          writeSource(date,channel,row,path.relative(path.join(__dirname,'..'),overviewPath).replaceAll('\\','/'),overview.collectedAt || isoNow());
          sourceRows++;
        }
      }
    }
    const complete = pages.length >= expectedPages;
    upsertDay.run(storeId,date,total,dayRows,expectedPages,pages.length,pageSize,complete?'complete':'partial',
      'not_separated',first.collectedAt || isoNow(),complete?isoNow():null,
      path.relative(path.join(__dirname,'..'),dayDir).replaceAll('\\','/'),null);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  importedDays++;
  importedRows += dayRows;
}

const coverage = db.prepare(`
  SELECT MIN(metric_date) first_date, MAX(metric_date) last_date, COUNT(DISTINCT metric_date) day_count,
         COUNT(*) row_count, COUNT(DISTINCT product_id) product_count,
         SUM(CASE WHEN natural_scope_status='verified' THEN 1 ELSE 0 END) verified_natural_rows
  FROM product_traffic_daily WHERE store_id=?
`).get(storeId);
db.close();
console.log(JSON.stringify({storeId,rawRoot,importedDays,importedRows,sourceRows,coverage},null,2));
