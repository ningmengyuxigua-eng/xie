const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const dbDir = path.join(root, 'db');
const dbPath = path.join(dbDir, 'store-audit.sqlite');
fs.mkdirSync(dbDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ad_master (
    store_id TEXT NOT NULL,
    ad_id TEXT NOT NULL,
    ad_name TEXT,
    ad_type TEXT NOT NULL,
    current_status TEXT,
    daily_budget REAL,
    target_roas REAL,
    product_id TEXT,
    source_url TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (store_id, ad_id)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS ad_daily_fact (
    store_id TEXT NOT NULL,
    metric_date TEXT NOT NULL,
    ad_id TEXT NOT NULL,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    ctr REAL,
    spend REAL NOT NULL DEFAULT 0,
    add_to_cart INTEGER,
    conversions INTEGER NOT NULL DEFAULT 0,
    sales_count INTEGER NOT NULL DEFAULT 0,
    revenue REAL NOT NULL DEFAULT 0,
    roas REAL,
    direct_conversions INTEGER,
    direct_sales_count INTEGER,
    direct_revenue REAL,
    direct_roas REAL,
    source_status TEXT,
    data_status TEXT NOT NULL CHECK (data_status IN ('provisional','revised','final')),
    observed_at TEXT NOT NULL,
    revised_at TEXT,
    source_path TEXT,
    PRIMARY KEY (store_id, metric_date, ad_id),
    FOREIGN KEY (store_id, ad_id) REFERENCES ad_master(store_id, ad_id)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS ad_product_daily_fact (
    store_id TEXT NOT NULL,
    metric_date TEXT NOT NULL,
    ad_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    ctr REAL,
    spend REAL NOT NULL DEFAULT 0,
    conversions INTEGER NOT NULL DEFAULT 0,
    sales_count INTEGER NOT NULL DEFAULT 0,
    revenue REAL NOT NULL DEFAULT 0,
    roas REAL,
    source_status TEXT,
    data_status TEXT NOT NULL CHECK (data_status IN ('provisional','revised','final')),
    observed_at TEXT NOT NULL,
    revised_at TEXT,
    source_path TEXT,
    PRIMARY KEY (store_id, metric_date, ad_id, product_id),
    FOREIGN KEY (store_id, ad_id) REFERENCES ad_master(store_id, ad_id)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS ad_evaluation (
    store_id TEXT NOT NULL,
    metric_date TEXT NOT NULL,
    ad_id TEXT NOT NULL,
    product_id_or_zero TEXT NOT NULL DEFAULT '0',
    rule_version TEXT NOT NULL,
    evaluation_status TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    evidence_json TEXT NOT NULL,
    recommendation TEXT,
    requires_human_action INTEGER NOT NULL DEFAULT 0 CHECK (requires_human_action IN (0,1)),
    evaluated_at TEXT NOT NULL,
    PRIMARY KEY (store_id, metric_date, ad_id, product_id_or_zero, rule_version)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS ad_sync_run (
    run_id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    metric_date TEXT NOT NULL,
    scope TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running','complete','partial','failed')),
    page_cursor TEXT,
    processed_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    checkpoint_path TEXT,
    error_summary TEXT
  );

  CREATE TABLE IF NOT EXISTS ad_monthly_summary (
    store_id TEXT NOT NULL,
    month TEXT NOT NULL,
    ad_id TEXT NOT NULL,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    spend REAL NOT NULL DEFAULT 0,
    conversions INTEGER NOT NULL DEFAULT 0,
    sales_count INTEGER NOT NULL DEFAULT 0,
    revenue REAL NOT NULL DEFAULT 0,
    roas REAL,
    refreshed_at TEXT NOT NULL,
    PRIMARY KEY (store_id, month, ad_id)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS product_ad_monthly_summary (
    store_id TEXT NOT NULL,
    month TEXT NOT NULL,
    product_id TEXT NOT NULL,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    spend REAL NOT NULL DEFAULT 0,
    conversions INTEGER NOT NULL DEFAULT 0,
    sales_count INTEGER NOT NULL DEFAULT 0,
    revenue REAL NOT NULL DEFAULT 0,
    roas REAL,
    refreshed_at TEXT NOT NULL,
    PRIMARY KEY (store_id, month, product_id)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS store_profile (
    store_id TEXT PRIMARY KEY,
    connection_name TEXT,
    marketplace_account TEXT,
    display_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    market TEXT NOT NULL,
    public_url TEXT,
    verified_at TEXT NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS platform_rule_registry (
    market TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_authority TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    content_hash TEXT,
    enforcement_level TEXT NOT NULL,
    affected_modules_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    PRIMARY KEY (market, rule_id)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS shop_health_daily (
    store_id TEXT NOT NULL,
    metric_date TEXT NOT NULL,
    rating REAL,
    review_count INTEGER,
    chat_response_rate REAL,
    non_fulfillment_rate REAL,
    late_shipment_rate REAL,
    penalty_points INTEGER,
    live_products INTEGER,
    followers INTEGER,
    operations_status TEXT,
    source_path TEXT,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (store_id, metric_date)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS backfill_run (
    run_id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    module TEXT NOT NULL,
    range_start TEXT NOT NULL,
    range_end TEXT NOT NULL,
    chunk_type TEXT NOT NULL,
    chunk_size INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running','complete','partial','failed')),
    cursor_date TEXT,
    cursor_page INTEGER,
    processed_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    checkpoint_path TEXT,
    error_summary TEXT
  );

  CREATE TABLE IF NOT EXISTS backfill_manifest (
    store_id TEXT NOT NULL,
    module TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    source_granularity TEXT NOT NULL,
    source_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    PRIMARY KEY (store_id, module, period_start, period_end, content_hash)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS product_master (
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT,
    current_status TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (store_id, product_id)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS product_observations (
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    observation_date TEXT NOT NULL,
    window_type TEXT NOT NULL,
    window_days INTEGER,
    views_value INTEGER,
    sales_value INTEGER,
    sold_total INTEGER,
    stock INTEGER,
    source_path TEXT,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (store_id, product_id, observation_date, window_type)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS ad_export_daily_staging (
    store_id TEXT NOT NULL,
    metric_date TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    row_number INTEGER NOT NULL,
    ad_name TEXT NOT NULL,
    source_status TEXT,
    ad_type TEXT,
    product_id TEXT,
    bidding_mode TEXT,
    placement TEXT,
    start_date TEXT,
    end_date TEXT,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    add_to_cart INTEGER,
    conversions INTEGER NOT NULL DEFAULT 0,
    direct_conversions INTEGER,
    sales_count INTEGER NOT NULL DEFAULT 0,
    direct_sales_count INTEGER,
    revenue REAL NOT NULL DEFAULT 0,
    direct_revenue REAL,
    spend REAL NOT NULL DEFAULT 0,
    matched_ad_id TEXT,
    match_status TEXT NOT NULL CHECK (match_status IN ('matched_unique_name','unmatched','ambiguous')),
    source_path TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    PRIMARY KEY (store_id, metric_date, source_hash, row_number)
  ) WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS idx_ad_daily_store_date
    ON ad_daily_fact(store_id, metric_date);
  CREATE INDEX IF NOT EXISTS idx_ad_daily_ad_date
    ON ad_daily_fact(store_id, ad_id, metric_date);
  CREATE INDEX IF NOT EXISTS idx_ad_product_store_product_date
    ON ad_product_daily_fact(store_id, product_id, metric_date);
  CREATE INDEX IF NOT EXISTS idx_ad_eval_status_date
    ON ad_evaluation(store_id, evaluation_status, metric_date);
  CREATE INDEX IF NOT EXISTS idx_ad_export_stage_date_name
    ON ad_export_daily_staging(store_id, metric_date, ad_name);
`);

const reportingMigrationPath = path.join(root, 'db', 'migrations', '005_report_center.sql');
if (fs.existsSync(reportingMigrationPath)) {
  db.exec(fs.readFileSync(reportingMigrationPath, 'utf8'));
}

const productFactColumns = new Set(db.prepare(`PRAGMA table_info(ad_product_daily_fact)`).all().map((row) => row.name));
if (!productFactColumns.has('product_name')) {
  db.exec(`ALTER TABLE ad_product_daily_fact ADD COLUMN product_name TEXT`);
}

db.prepare(`INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES (?, ?)`)
  .run(1, new Date().toISOString());
db.prepare(`INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES (?, ?)`)
  .run(2, new Date().toISOString());
db.prepare(`INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES (?, ?)`)
  .run(3, new Date().toISOString());
db.prepare(`INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES (?, ?)`)
  .run(4, new Date().toISOString());
db.prepare(`INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES (?, ?)`)
  .run(5, new Date().toISOString());

const profile = JSON.parse(fs.readFileSync(path.join(root, 'config', 'store-profile.json'), 'utf8'));
db.prepare(`
  INSERT INTO store_profile
    (store_id, connection_name, marketplace_account, display_name, platform, market, public_url, verified_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(store_id) DO UPDATE SET
    connection_name=excluded.connection_name,
    marketplace_account=excluded.marketplace_account,
    display_name=excluded.display_name,
    platform=excluded.platform,
    market=excluded.market,
    public_url=excluded.public_url,
    verified_at=excluded.verified_at
`).run(profile.storeId, profile.connectionName, profile.marketplaceAccount, profile.displayName,
  profile.platform, profile.market, profile.publicUrl, profile.verifiedAt);

const ruleRegistry = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'shopee-tw-rule-registry.json'), 'utf8'));
const upsertRule = db.prepare(`
  INSERT INTO platform_rule_registry
    (market, rule_id, category, title, source_url, source_authority, checked_at, enforcement_level, affected_modules_json, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
  ON CONFLICT(market, rule_id) DO UPDATE SET
    category=excluded.category,
    title=excluded.title,
    source_url=excluded.source_url,
    source_authority=excluded.source_authority,
    checked_at=excluded.checked_at,
    enforcement_level=excluded.enforcement_level,
    affected_modules_json=excluded.affected_modules_json,
    status='active'
`);
for (const rule of ruleRegistry.rules) {
  upsertRule.run(ruleRegistry.market, rule.ruleId, rule.category, rule.title, rule.sourceUrl,
    rule.sourceAuthority, ruleRegistry.checkedAt, rule.enforcementLevel, JSON.stringify(rule.affectedModules));
}

const healthPath = path.join(root, 'shop-health', '2026-10-07.json');
if (fs.existsSync(healthPath)) {
  const health = JSON.parse(fs.readFileSync(healthPath, 'utf8'));
  db.prepare(`
    INSERT INTO shop_health_daily
      (store_id, metric_date, rating, review_count, chat_response_rate, non_fulfillment_rate,
       live_products, followers, operations_status, source_path, observed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store_id, metric_date) DO UPDATE SET
      rating=excluded.rating,
      review_count=excluded.review_count,
      chat_response_rate=excluded.chat_response_rate,
      non_fulfillment_rate=excluded.non_fulfillment_rate,
      live_products=excluded.live_products,
      followers=excluded.followers,
      operations_status=excluded.operations_status,
      source_path=excluded.source_path,
      observed_at=excluded.observed_at
  `).run(health.storeId, health.metricDate, health.rating, health.reviewCount,
    health.chatResponseRate, health.nonFulfillmentRate, health.liveProducts, health.followers,
    health.operationsStatus, healthPath, health.source.capturedAt);
}

const tables = db.prepare(`
  SELECT name FROM sqlite_master
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all().map((row) => row.name);
db.close();

console.log(JSON.stringify({ dbPath, schemaVersion: 5, tables }));
