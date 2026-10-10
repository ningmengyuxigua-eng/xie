-- Reserved reporting schema. Review before applying to the live prototype database.
CREATE TABLE IF NOT EXISTS report_definition (
  report_key TEXT PRIMARY KEY,
  definition_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  module TEXT NOT NULL,
  default_period TEXT NOT NULL,
  max_detail_rows INTEGER NOT NULL DEFAULT 20 CHECK(max_detail_rows BETWEEN 0 AND 20),
  output_formats_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS report_run (
  run_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  report_key TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  period_start TEXT,
  period_end TEXT,
  data_cutoff_at TEXT NOT NULL,
  data_status TEXT NOT NULL CHECK(data_status IN ('provisional','revised','final','partial','blocked')),
  run_status TEXT NOT NULL CHECK(run_status IN ('queued','running','complete','failed','cancelled')),
  parameters_json TEXT NOT NULL,
  source_fingerprint TEXT,
  rule_version TEXT,
  summary_row_count INTEGER NOT NULL DEFAULT 0,
  detail_row_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_summary TEXT,
  FOREIGN KEY(report_key) REFERENCES report_definition(report_key)
);

CREATE TABLE IF NOT EXISTS report_artifact (
  run_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL CHECK(artifact_type IN ('json','md','csv','html','pdf','manifest')),
  artifact_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(run_id, artifact_type, artifact_path),
  FOREIGN KEY(run_id) REFERENCES report_run(run_id)
);

CREATE INDEX IF NOT EXISTS idx_report_run_store_key_period
  ON report_run(store_id, report_key, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_report_run_status
  ON report_run(run_status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_artifact_run
  ON report_artifact(run_id);

-- Scheduling, delivery and action execution tables are intentionally deferred.
-- They require explicit notification channels and an approval workflow.
