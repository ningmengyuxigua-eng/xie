const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const metricDate = process.argv[2];
const apply = process.argv.includes('--apply');
const storeId = '27857268786685';
const normalize = (value) => String(value || '').replace(/\s*\[\d+\]\s*$/, '').trim();
const db = new DatabaseSync(path.join(__dirname, 'db', 'store-audit.sqlite'));
const products = db.prepare('SELECT product_id productId,product_name productName FROM product_master WHERE store_id=?').all(storeId);
const byName = new Map();
for (const product of products) {
  const key = normalize(product.productName);
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(product);
}
const ads = db.prepare(`
  SELECT DISTINCT m.ad_id adId,m.ad_name adName FROM ad_daily_fact f
  JOIN ad_master m ON m.store_id=f.store_id AND m.ad_id=f.ad_id
  WHERE f.store_id=? AND f.metric_date=? AND m.ad_type='single_product' AND m.product_id IS NULL
`).all(storeId, metricDate);
const matches = ads.map((ad) => ({ ...ad, candidates: byName.get(normalize(ad.adName)) || [] }));
const unique = matches.filter((item) => item.candidates.length === 1);
if (apply && unique.length) {
  const update = db.prepare('UPDATE ad_master SET product_id=? WHERE store_id=? AND ad_id=? AND product_id IS NULL');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of unique) update.run(item.candidates[0].productId, storeId, item.adId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
db.close();
console.log(JSON.stringify({ metricDate, apply, unmappedAds: ads.length, uniqueMatches: unique.length,
  unresolved: matches.filter((item) => item.candidates.length !== 1).map((item) => ({ adId:item.adId,adName:item.adName,candidateCount:item.candidates.length })),
  mapped: unique.map((item) => ({ adId:item.adId,adName:item.adName,productId:item.candidates[0].productId })) }, null, 2));
