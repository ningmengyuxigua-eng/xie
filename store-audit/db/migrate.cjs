const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, 'store-audit.sqlite');
const migrationDir = path.join(__dirname, 'migrations');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
const applied = new Set(db.prepare('SELECT version FROM schema_version').all().map((x) => Number(x.version)));
const files = fs.readdirSync(migrationDir).filter((x) => /^\d{3}_.+\.sql$/.test(x)).sort();
const results = [];

for (const file of files) {
  const version = Number(file.slice(0, 3));
  if (applied.has(version)) {
    results.push({ version, file, status:'already_applied' });
    continue;
  }
  const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO schema_version(version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
    db.exec('COMMIT');
    results.push({ version, file, status:'applied' });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
const currentVersion = db.prepare('SELECT MAX(version) version FROM schema_version').get().version;
db.close();
console.log(JSON.stringify({ dbPath, currentVersion, results }));
