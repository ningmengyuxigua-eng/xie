CREATE TABLE IF NOT EXISTS product_traffic_daily (
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  product_name TEXT,
  source_status INTEGER,
  sales_ratio REAL,
  sales_twd REAL,
  orders REAL,
  units REAL,
  buyers REAL,
  product_card_impressions INTEGER,
  unique_product_card_impressions INTEGER,
  product_clicks INTEGER,
  unique_product_clicks INTEGER,
  ctr REAL,
  order_conversion_rate REAL,
  average_order_value_twd REAL,
  natural_impressions INTEGER,
  natural_clicks INTEGER,
  natural_scope_status TEXT NOT NULL DEFAULT 'not_separated'
    CHECK(natural_scope_status IN ('verified','estimated','not_separated','unavailable')),
  has_ad_entry INTEGER CHECK(has_ad_entry IN (0,1) OR has_ad_entry IS NULL),
  campaign_id TEXT,
  is_boost_with_ads INTEGER CHECK(is_boost_with_ads IN (0,1) OR is_boost_with_ads IS NULL),
  source_path TEXT NOT NULL,
  source_payload_hash TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(store_id, product_id, metric_date)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS product_traffic_source_daily (
  store_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  channel TEXT NOT NULL,
  source_code TEXT NOT NULL,
  sales_twd REAL,
  orders REAL,
  units REAL,
  buyers REAL,
  impressions INTEGER,
  unique_impressions INTEGER,
  clicks INTEGER,
  unique_clicks INTEGER,
  ctr REAL,
  order_conversion_rate REAL,
  ad_expense_twd REAL,
  ad_roas REAL,
  source_path TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(store_id, metric_date, channel, source_code)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS product_traffic_collection_day (
  store_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  expected_products INTEGER,
  collected_products INTEGER NOT NULL DEFAULT 0,
  expected_pages INTEGER,
  collected_pages INTEGER NOT NULL DEFAULT 0,
  page_size INTEGER NOT NULL DEFAULT 20,
  collection_status TEXT NOT NULL CHECK(collection_status IN ('pending','partial','complete','failed')),
  natural_scope_status TEXT NOT NULL DEFAULT 'not_separated',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  raw_directory TEXT NOT NULL,
  error_summary TEXT,
  PRIMARY KEY(store_id, metric_date)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_product_traffic_daily_date
  ON product_traffic_daily(store_id, metric_date, product_id);
CREATE INDEX IF NOT EXISTS idx_product_traffic_daily_product
  ON product_traffic_daily(store_id, product_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_traffic_source_date
  ON product_traffic_source_daily(store_id, metric_date, channel);
