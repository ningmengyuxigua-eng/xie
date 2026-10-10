ALTER TABLE product_master ADD COLUMN seller_sku TEXT;
ALTER TABLE product_master ADD COLUMN source_url TEXT;
ALTER TABLE product_master ADD COLUMN content_hash TEXT;
ALTER TABLE product_master ADD COLUMN detail_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE product_master ADD COLUMN last_detail_synced_at TEXT;
ALTER TABLE product_master ADD COLUMN listed_at TEXT;
ALTER TABLE product_master ADD COLUMN listed_at_source TEXT;
ALTER TABLE product_master ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE product_master ADD COLUMN lifecycle_status_observed_at TEXT;
ALTER TABLE product_master ADD COLUMN delisted_at TEXT;

CREATE TABLE IF NOT EXISTS product_versions (
  version_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT,
  seller_sku TEXT,
  source_status TEXT,
  price_min REAL,
  price_max REAL,
  content_hash TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  source_path TEXT,
  UNIQUE(store_id,product_id,content_hash)
);

CREATE TABLE IF NOT EXISTS product_discovery_run (
  run_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  scan_date TEXT NOT NULL,
  scan_mode TEXT NOT NULL CHECK(scan_mode IN ('baseline','incremental','identity_reconciliation')),
  status TEXT NOT NULL CHECK(status IN ('running','complete','failed','partial')),
  source_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  processed_count INTEGER NOT NULL DEFAULT 0,
  existing_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_summary TEXT
);

CREATE TABLE IF NOT EXISTS product_discovery_event (
  event_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('baseline_import','new_product','rediscovered','status_changed')),
  observed_at TEXT NOT NULL,
  run_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES product_discovery_run(run_id)
);

CREATE TABLE IF NOT EXISTS product_detail_queue (
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL CHECK(status IN ('pending','processing','complete','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(store_id,product_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS product_lifecycle_event (
  event_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK(to_status IN ('unknown','draft','pending_review','active','suspended','delisted','deleted')),
  effective_at TEXT,
  observed_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_path TEXT,
  run_id TEXT,
  FOREIGN KEY(run_id) REFERENCES product_discovery_run(run_id)
);

CREATE INDEX IF NOT EXISTS idx_product_master_last_seen
  ON product_master(store_id,last_seen_at);
CREATE INDEX IF NOT EXISTS idx_product_discovery_run_date
  ON product_discovery_run(store_id,scan_date,scan_mode);
CREATE INDEX IF NOT EXISTS idx_product_discovery_event_product
  ON product_discovery_event(store_id,product_id,observed_at);
CREATE INDEX IF NOT EXISTS idx_product_detail_queue_status
  ON product_detail_queue(store_id,status,priority,created_at);
CREATE INDEX IF NOT EXISTS idx_product_master_lifecycle
  ON product_master(store_id,lifecycle_status,listed_at);
CREATE INDEX IF NOT EXISTS idx_product_lifecycle_event_product
  ON product_lifecycle_event(store_id,product_id,observed_at);
