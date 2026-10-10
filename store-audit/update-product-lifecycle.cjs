const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const allowed = new Set(['unknown', 'draft', 'pending_review', 'active', 'suspended', 'delisted', 'deleted']);
const storeId = arg('store-id', '27857268786685');
const productId = arg('product-id');
const toStatus = arg('status');
const reason = arg('reason', 'manual_review');
const effectiveAt = arg('effective-at', null);
const observedAt = arg('observed-at', new Date().toISOString());
const sourcePath = arg('source', null);
const dbPath = path.resolve(arg('db', path.join(__dirname, 'db', 'store-audit.sqlite')));

if (!productId) throw new Error('--product-id is required');
if (!allowed.has(toStatus)) throw new Error(`--status must be one of: ${[...allowed].join(', ')}`);

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
const product = db.prepare('SELECT lifecycle_status FROM product_master WHERE store_id=? AND product_id=?').get(storeId, productId);
if (!product) {
  db.close();
  throw new Error(`Unknown product: ${storeId}/${productId}`);
}

if (product.lifecycle_status === toStatus) {
  db.close();
  console.log(JSON.stringify({ storeId, productId, status: 'unchanged', lifecycleStatus: toStatus }));
  process.exit(0);
}

const eventId = crypto.createHash('sha256')
  .update(`${storeId}|${productId}|${product.lifecycle_status}|${toStatus}|${observedAt}|${reason}`)
  .digest('hex');
db.exec('BEGIN IMMEDIATE');
try {
  db.prepare(`UPDATE product_master SET
      lifecycle_status=?, lifecycle_status_observed_at=?, current_status=?,
      delisted_at=CASE WHEN ? IN ('delisted','deleted') THEN COALESCE(?,?) WHEN ?='active' THEN NULL ELSE delisted_at END
    WHERE store_id=? AND product_id=?`)
    .run(toStatus, observedAt, toStatus, toStatus, effectiveAt, observedAt, toStatus, storeId, productId);
  db.prepare(`INSERT INTO product_lifecycle_event
      (event_id,store_id,product_id,from_status,to_status,effective_at,observed_at,reason,source_path,run_id)
    VALUES (?,?,?,?,?,?,?,?,?,NULL)`)
    .run(eventId, storeId, productId, product.lifecycle_status, toStatus, effectiveAt, observedAt, reason, sourcePath);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  db.close();
  throw error;
}
db.close();
console.log(JSON.stringify({ storeId, productId, status: 'updated', from: product.lifecycle_status, to: toStatus, effectiveAt, observedAt, eventId }));
