CREATE TABLE IF NOT EXISTS order_master (
  store_id TEXT NOT NULL,
  order_internal_id TEXT NOT NULL,
  order_number TEXT,
  source_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK(source_status IN ('unknown','shipped','delivered','completed','cancelled','returned','refunded')),
  latest_event_code TEXT,
  latest_event_at TEXT,
  pickup_ready_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT,
  source_path TEXT,
  source_payload_hash TEXT,
  PRIMARY KEY(store_id, order_internal_id),
  UNIQUE(store_id, order_number)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS order_logistics_event (
  store_id TEXT NOT NULL,
  order_internal_id TEXT NOT NULL,
  event_code TEXT NOT NULL,
  event_at TEXT NOT NULL,
  source_event_hash TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_path TEXT,
  PRIMARY KEY(store_id, order_internal_id, source_event_hash),
  FOREIGN KEY(store_id, order_internal_id)
    REFERENCES order_master(store_id, order_internal_id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS pickup_alert (
  alert_key TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  order_internal_id TEXT NOT NULL,
  pickup_ready_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','notified','resolved','suppressed')),
  suggested_template_key TEXT NOT NULL DEFAULT 'gentle',
  selected_template_key TEXT,
  notified_at TEXT,
  resolved_at TEXT,
  resolution_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(store_id, order_internal_id, pickup_ready_at),
  FOREIGN KEY(store_id, order_internal_id)
    REFERENCES order_master(store_id, order_internal_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pickup_message_delivery (
  delivery_id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_key TEXT NOT NULL,
  template_key TEXT NOT NULL,
  send_mode TEXT NOT NULL CHECK(send_mode IN ('manual_copy','approval_queue','automatic')),
  approval_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK(approval_status IN ('not_required','pending','approved','rejected')),
  result_status TEXT NOT NULL CHECK(result_status IN ('prepared','sent','failed','cancelled')),
  attempted_at TEXT NOT NULL,
  error_code TEXT,
  error_summary TEXT,
  UNIQUE(alert_key, template_key),
  FOREIGN KEY(alert_key) REFERENCES pickup_alert(alert_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_sync_run (
  run_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  source_page INTEGER,
  batch_limit INTEGER NOT NULL DEFAULT 20,
  status TEXT NOT NULL CHECK(status IN ('running','partial','complete','failed')),
  processed_orders INTEGER NOT NULL DEFAULT 0,
  checkpoint_path TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_master_status
  ON order_master(store_id, source_status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_master_pickup_ready
  ON order_master(store_id, pickup_ready_at, source_status);
CREATE INDEX IF NOT EXISTS idx_order_event_time
  ON order_logistics_event(store_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_pickup_alert_status
  ON pickup_alert(store_id, status, due_at);
