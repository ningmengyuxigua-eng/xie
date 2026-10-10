const fs = require('node:fs');
const path = require('node:path');

const registryPath = path.join(__dirname, '..', 'config', 'report-registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const allowedFormats = new Set(['json', 'md', 'csv', 'html', 'pdf']);
const errors = [];
const keys = new Set();

if (registry.schemaVersion !== 1) errors.push('schemaVersion must be 1');
if (registry.defaults?.maxDetailRows !== 20) errors.push('default maxDetailRows must be 20');
for (const [index, report] of (registry.reports || []).entries()) {
  const prefix = `reports[${index}]`;
  if (!/^[a-z][a-z0-9_]*$/.test(report.key || '')) errors.push(`${prefix}.key is invalid`);
  if (keys.has(report.key)) errors.push(`${prefix}.key is duplicated`);
  keys.add(report.key);
  if (!report.title || !report.module || !report.cadence || !report.period) errors.push(`${prefix} is missing required fields`);
  if (!Array.isArray(report.formats) || !report.formats.length) errors.push(`${prefix}.formats is empty`);
  for (const format of report.formats || []) if (!allowedFormats.has(format)) errors.push(`${prefix}.formats contains ${format}`);
  if (!Array.isArray(report.blockedBy)) errors.push(`${prefix}.blockedBy must be an array`);
}

if (errors.length) {
  console.error(JSON.stringify({ ok:false, registryPath, errors }, null, 2));
  process.exit(1);
}
const enabled = registry.reports.filter((x) => x.enabled).map((x) => x.key);
const reserved = registry.reports.filter((x) => !x.enabled).map((x) => x.key);
console.log(JSON.stringify({ ok:true, registryPath, reportCount:registry.reports.length, enabled, reserved }));
