const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'config', 'report-registry.json'), 'utf8'));
const defaults = registry.defaults;
const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'));
const now = new Date().toISOString();
const upsert = db.prepare(`
  INSERT INTO report_definition(
    report_key,definition_version,title,module,default_period,max_detail_rows,
    output_formats_json,enabled,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(report_key) DO UPDATE SET
    definition_version=excluded.definition_version,title=excluded.title,module=excluded.module,
    default_period=excluded.default_period,max_detail_rows=excluded.max_detail_rows,
    output_formats_json=excluded.output_formats_json,enabled=excluded.enabled,updated_at=excluded.updated_at
`);
db.exec('BEGIN IMMEDIATE');
try {
  for (const report of registry.reports) {
    upsert.run(report.key, registry.schemaVersion, report.title, report.module, report.period,
      defaults.maxDetailRows, JSON.stringify(report.formats), report.enabled ? 1 : 0, now, now);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
const counts = db.prepare('SELECT enabled,COUNT(*) count FROM report_definition GROUP BY enabled ORDER BY enabled').all();
db.close();
console.log(JSON.stringify({ definitions:registry.reports.length, counts }));
