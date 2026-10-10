const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function isoFrom(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const n = Number(value);
    return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? null : d.toISOString();
}

function normalizeStatus(value) {
  const s = String(value ?? '').toLowerCase();
  if (['active', 'live', 'normal', '1'].includes(s)) return 'active';
  if (['draft'].includes(s)) return 'draft';
  if (['pending', 'review', 'pending_review'].includes(s)) return 'pending_review';
  if (['suspended', 'banned', 'blocked'].includes(s)) return 'suspended';
  if (['delisted', 'unlisted', 'inactive', '0'].includes(s)) return 'delisted';
  if (['deleted'].includes(s)) return 'deleted';
  return 'unknown';
}

const root = __dirname;
const storeId = arg('store-id', '27857268786685');
const mode = arg('mode', 'baseline');
const inputPath = path.resolve(arg('input', path.join(root, '2026-10-06', 'products.json')));
const observationDate = arg('date', path.basename(path.dirname(inputPath)));
const dbPath = path.resolve(arg('db', path.join(root, 'db', 'store-audit.sqlite')));
const rows = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!Array.isArray(rows)) throw new Error('Input must be a JSON array');
if (!['baseline', 'incremental'].includes(mode)) throw new Error('mode must be baseline or incremental');

const stat = fs.statSync(inputPath);
const observedAt = stat.mtime.toISOString();
const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex');
const runId = `product-${mode}-${observationDate}-${sourceHash.slice(0, 12)}`;
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');

const priorRun = db.prepare('SELECT status,processed_count,existing_count,new_count,queued_count FROM product_discovery_run WHERE run_id=?').get(runId);
if (priorRun?.status === 'complete') {
  db.close();
  console.log(JSON.stringify({ runId, mode, source: inputPath, status: 'already_imported', ...priorRun, batchSize: 20 }));
  process.exit(0);
}

const insertRun = db.prepare(`INSERT OR REPLACE INTO product_discovery_run
  (run_id,store_id,scan_date,scan_mode,status,source_path,source_hash,processed_count,existing_count,new_count,queued_count,started_at,finished_at,error_summary)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
insertRun.run(runId, storeId, observationDate, mode, 'running', inputPath, sourceHash, 0, 0, 0, 0, new Date().toISOString(), null, null);

const exists = db.prepare('SELECT 1 FROM product_master WHERE store_id=? AND product_id=?');
const insertMaster = db.prepare(`INSERT INTO product_master
  (store_id,product_id,product_name,current_status,first_seen_at,last_seen_at,seller_sku,source_url,content_hash,detail_status,last_detail_synced_at,listed_at,listed_at_source,lifecycle_status,lifecycle_status_observed_at,delisted_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertObservation = db.prepare(`INSERT OR IGNORE INTO product_observations
  (store_id,product_id,observation_date,window_type,window_days,views_value,sales_value,sold_total,stock,source_path,observed_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const insertVersion = db.prepare(`INSERT OR IGNORE INTO product_versions
  (version_id,store_id,product_id,product_name,seller_sku,source_status,price_min,price_max,content_hash,valid_from,valid_to,source_path)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertEvent = db.prepare(`INSERT OR IGNORE INTO product_discovery_event
  (event_id,store_id,product_id,event_type,observed_at,run_id,details_json)
  VALUES (?,?,?,?,?,?,?)`);
const insertLifecycle = db.prepare(`INSERT OR IGNORE INTO product_lifecycle_event
  (event_id,store_id,product_id,from_status,to_status,effective_at,observed_at,reason,source_path,run_id)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);
const insertQueue = db.prepare(`INSERT OR IGNORE INTO product_detail_queue
  (store_id,product_id,reason,priority,status,attempts,last_error,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?)`);

let processed = 0, existingCount = 0, newCount = 0, queuedCount = 0;
for (let offset = 0; offset < rows.length; offset += 20) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows.slice(offset, offset + 20)) {
      const productId = String(row.productId ?? row.product_id ?? '').trim();
      if (!productId) continue;
      processed++;
      if (exists.get(storeId, productId)) {
        existingCount++;
        continue; // Existing products are intentionally not reread or rewritten.
      }
      const listedAt = isoFrom(row.first_publish_time ?? row.firstPublishTime ?? row.create_time ?? row.createTime);
      const listedAtSource = row.first_publish_time != null || row.firstPublishTime != null
        ? 'first_publish_time'
        : (row.create_time != null || row.createTime != null ? 'create_time' : null);
      const lifecycle = row.is_unlisted === true
        ? 'delisted'
        : normalizeStatus(row.lifecycleStatus ?? row.lifecycle_status ?? row.status);
      const content = {
        productName: row.name ?? row.productName ?? null,
        sellerSku: row.sku ?? row.sellerSku ?? null,
        sourceStatus: row.status ?? null,
        lifecycleStatus: lifecycle,
        listedAt,
        priceMin: row.priceMin ?? null,
        priceMax: row.priceMax ?? null,
        variationCount: row.variationCount ?? null,
      };
      const contentHash = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
      const eventType = mode === 'baseline' ? 'baseline_import' : 'new_product';
      const eventId = crypto.createHash('sha256').update(`${runId}|${productId}|${eventType}`).digest('hex');
      const versionId = crypto.createHash('sha256').update(`${storeId}|${productId}|${contentHash}`).digest('hex');

      const detailComplete = row.detailComplete === true;
      insertMaster.run(storeId, productId, content.productName, row.status == null ? null : String(row.status), observedAt, observedAt,
        content.sellerSku, row.url ?? null, contentHash, mode === 'baseline' ? 'baseline_only' : (detailComplete ? 'complete' : 'pending'), detailComplete ? observedAt : null,
        listedAt, listedAtSource, lifecycle, observedAt, lifecycle === 'delisted' ? observedAt : null);
      insertObservation.run(storeId, productId, observationDate, 'rolling', 30,
        Number.isFinite(Number(row.views30)) ? Number(row.views30) : null,
        Number.isFinite(Number(row.sales30)) ? Number(row.sales30) : null,
        Number.isFinite(Number(row.sold)) ? Number(row.sold) : null,
        null, inputPath, observedAt);
      insertVersion.run(versionId, storeId, productId, content.productName, content.sellerSku,
        row.status == null ? null : String(row.status), row.priceMin ?? null, row.priceMax ?? null, contentHash, observedAt, null, inputPath);
      insertEvent.run(eventId, storeId, productId, eventType, observedAt, runId,
        JSON.stringify({ source: path.basename(inputPath), listedAtKnown: Boolean(listedAt), lifecycleStatus: lifecycle }));
      insertLifecycle.run(`${eventId}-lifecycle`, storeId, productId, null, lifecycle, listedAt, observedAt,
        mode === 'baseline' ? 'baseline_import' : 'new_product_discovered', inputPath, runId);
      if (mode === 'incremental' && !detailComplete) {
        insertQueue.run(storeId, productId, 'new_product', 1, 'pending', 0, null, observedAt, observedAt);
        queuedCount++;
      }
      newCount++;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.prepare('UPDATE product_discovery_run SET status=?,processed_count=?,existing_count=?,new_count=?,queued_count=?,finished_at=?,error_summary=? WHERE run_id=?')
      .run('failed', processed, existingCount, newCount, queuedCount, new Date().toISOString(), error.message, runId);
    db.close();
    throw error;
  }
}

db.prepare('UPDATE product_discovery_run SET status=?,processed_count=?,existing_count=?,new_count=?,queued_count=?,finished_at=? WHERE run_id=?')
  .run('complete', processed, existingCount, newCount, queuedCount, new Date().toISOString(), runId);
const result = { runId, mode, source: inputPath, processed, existingCount, newCount, queuedCount, batchSize: 20 };
db.close();
console.log(JSON.stringify(result));
