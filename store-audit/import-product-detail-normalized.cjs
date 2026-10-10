const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const storeId = '27857268786685';
const inputPath = path.resolve(process.argv[2] || '');
if (!inputPath || !fs.existsSync(inputPath)) throw new Error('Usage: node import-product-detail-normalized.cjs NORMALIZED_JSON');
const rows = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!Array.isArray(rows) || rows.length > 20) throw new Error('Normalized detail batch must contain 1-20 products');
const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'));
const now = new Date().toISOString();
const iso = value => {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (Number.isFinite(number)) return new Date(number < 1e12 ? number * 1000 : number).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
};
const update = db.prepare(`
  UPDATE product_master SET
    product_name=COALESCE(?,product_name), seller_sku=COALESCE(?,seller_sku),
    source_url=COALESCE(?,source_url), detail_status='complete', last_detail_synced_at=?,
    listed_at=COALESCE(listed_at,?), listed_at_source=COALESCE(listed_at_source,?),
    lifecycle_status=CASE WHEN ? THEN 'delisted' ELSE 'active' END,
    lifecycle_status_observed_at=?
  WHERE store_id=? AND product_id=?
`);
const insertVersion = db.prepare(`
  INSERT OR IGNORE INTO product_versions
  (version_id,store_id,product_id,product_name,seller_sku,source_status,price_min,price_max,content_hash,valid_from,valid_to,source_path)
  VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?)
`);
let updated = 0;
db.exec('BEGIN IMMEDIATE');
try {
  for (const row of rows) {
    const productId = String(row.productId || '').trim();
    if (!/^\d+$/.test(productId)) throw new Error(`Invalid product ID: ${productId}`);
    const listedAt = iso(row.first_publish_time ?? row.create_time);
    const listedAtSource = row.first_publish_time != null ? 'first_publish_time' : row.create_time != null ? 'create_time' : null;
    const status = row.is_unlisted ? 'unlisted' : String(row.status ?? 'active');
    const content = JSON.stringify({name:row.name,sku:row.sku,status,priceMin:row.priceMin,priceMax:row.priceMax,variationCount:row.variationCount});
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const result = update.run(row.name ?? null, row.sku ?? null, row.url ?? null, now,
      listedAt, listedAtSource, row.is_unlisted ? 1 : 0, now, storeId, productId);
    if (!result.changes) throw new Error(`Product missing from master: ${productId}`);
    const versionId = crypto.createHash('sha256').update(`${storeId}|${productId}|${hash}`).digest('hex');
    insertVersion.run(versionId, storeId, productId, row.name ?? null, row.sku ?? null, status,
      row.priceMin ?? null, row.priceMax ?? null, hash, now, inputPath);
    updated++;
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  db.close();
  throw error;
}
db.close();
console.log(JSON.stringify({status:'complete',updated,inputPath}));
