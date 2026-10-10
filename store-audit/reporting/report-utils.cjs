const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const sha256 = (content) => crypto.createHash('sha256').update(content).digest('hex');
const fileHash = (filePath) => sha256(fs.readFileSync(filePath));
const stableJson = (value) => JSON.stringify(value, Object.keys(value).sort());

function writeReport({ reportKey, version, period, dataCutoffAt, dataStatus, ruleVersion, parameters, sources, sourceContext = null, report, markdown }) {
  const sourceEntries = sources.map((source) => ({
    path: path.relative(root, source).replaceAll('\\', '/'),
    sha256: fileHash(source),
    bytes: fs.statSync(source).size,
  }));
  if (sourceContext !== null) {
    const serialized = JSON.stringify(sourceContext);
    sourceEntries.push({ path:'inline:query-result', sha256:sha256(serialized), bytes:Buffer.byteLength(serialized) });
  }
  const sourceFingerprint = sha256(JSON.stringify(sourceEntries));
  const runId = `${reportKey}-${period.start}-${sourceFingerprint.slice(0, 16)}-v${version}`;
  const outDir = path.join(root, 'reports', reportKey, `${period.start}_to_${period.end}`, runId);
  fs.mkdirSync(outDir, { recursive:true });
  report.traceability.runId = runId;
  report.traceability.sourceFingerprint = sourceFingerprint;
  const reportPath = path.join(outDir, 'report.json');
  const markdownPath = path.join(outDir, 'report.md');
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(markdownPath, markdown);
  const artifacts = [reportPath, markdownPath].map((p) => ({
    type:path.extname(p).slice(1), path:path.relative(root,p).replaceAll('\\','/'), sha256:fileHash(p), bytes:fs.statSync(p).size,
  }));
  const manifest = {
    runId, reportKey, definitionVersion:version, storeId:report.identity.storeId,
    storeDisplayName:report.identity.storeDisplayName, period, dataCutoffAt, dataStatus,
    ruleVersion, sourceFingerprint, sources:sourceEntries, artifacts, generatedAt:report.traceability.generatedAt,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  artifacts.push({ type:'manifest', path:path.relative(root,manifestPath).replaceAll('\\','/'), sha256:fileHash(manifestPath), bytes:fs.statSync(manifestPath).size });

  const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'));
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO report_run(run_id,store_id,report_key,definition_version,period_start,period_end,
        data_cutoff_at,data_status,run_status,parameters_json,source_fingerprint,rule_version,
        summary_row_count,detail_row_count,started_at,finished_at,error_summary)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)
      ON CONFLICT(run_id) DO UPDATE SET data_cutoff_at=excluded.data_cutoff_at,data_status=excluded.data_status,
        run_status='complete',parameters_json=excluded.parameters_json,source_fingerprint=excluded.source_fingerprint,
        rule_version=excluded.rule_version,summary_row_count=excluded.summary_row_count,
        detail_row_count=excluded.detail_row_count,finished_at=excluded.finished_at,error_summary=NULL
    `).run(runId, report.identity.storeId, reportKey, version, period.start, period.end,
      dataCutoffAt, dataStatus, 'complete', JSON.stringify(parameters), sourceFingerprint, ruleVersion,
      report.summary.metrics.length, report.actions.length + report.opportunities.length, now, now);
    const insertArtifact = db.prepare(`
      INSERT INTO report_artifact(run_id,artifact_type,artifact_path,sha256,byte_size,created_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(run_id,artifact_type,artifact_path) DO UPDATE SET
        sha256=excluded.sha256,byte_size=excluded.byte_size,created_at=excluded.created_at
    `);
    for (const artifact of artifacts) insertArtifact.run(runId, artifact.type, artifact.path, artifact.sha256, artifact.bytes, now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
  return { runId, outDir, reportPath, markdownPath, manifestPath, sourceFingerprint, artifacts };
}

module.exports = { root, sha256, fileHash, writeReport };
