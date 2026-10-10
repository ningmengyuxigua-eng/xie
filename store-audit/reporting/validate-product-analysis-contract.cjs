const fs = require('node:fs');
const path = require('node:path');

const contractPath = path.join(__dirname, '..', 'config', 'product-analysis-report-contract.json');
const registryPath = path.join(__dirname, '..', 'config', 'report-registry.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const errors = [];

if (contract.schemaVersion !== 1) errors.push('schemaVersion must be 1');
if (!contract.contractVersion) errors.push('contractVersion is required');
if (!Array.isArray(contract.identityKey) || !contract.identityKey.includes('product_id')) errors.push('identityKey must include product_id');
if (!Array.isArray(contract.observationKey) || !contract.observationKey.includes('traffic_scope')) errors.push('observationKey must include traffic_scope');

const groups = new Set();
const allFields = new Set();
for (const [index, dimension] of (contract.dimensions || []).entries()) {
  if (!dimension.group || groups.has(dimension.group)) errors.push(`dimensions[${index}].group is missing or duplicated`);
  groups.add(dimension.group);
  if (!Array.isArray(dimension.fields) || !dimension.fields.length) errors.push(`dimensions[${index}].fields is empty`);
  for (const field of dimension.fields || []) {
    if (!/^[a-z][a-z0-9_]*$/.test(field)) errors.push(`invalid field name: ${field}`);
    allFields.add(field);
  }
}

for (const [setName, fields] of Object.entries(contract.requiredFieldSets || {})) {
  if (!Array.isArray(fields) || !fields.length) errors.push(`requiredFieldSets.${setName} is empty`);
  for (const field of fields || []) if (!allFields.has(field)) errors.push(`requiredFieldSets.${setName} references unknown field ${field}`);
}

for (const level of ['case', 'partial', 'final']) {
  if (!contract.generationGates?.[level]) errors.push(`generationGates.${level} is required`);
}
if (contract.generationGates?.final?.requiredFieldCompleteness !== 1) errors.push('final requiredFieldCompleteness must be 1.0');
if (contract.generationGates?.final?.requiredCoverageDays !== 60) errors.push('final requiredCoverageDays must be 60');
if (contract.nullRules?.missingIsNotZero !== true) errors.push('missingIsNotZero must be true');
if (contract.nullRules?.legacyViews30MayNotPopulateNaturalViews !== true) errors.push('legacy views30 must not populate natural views');
if (contract.nullRules?.adImpressionsMayNotPopulateNaturalViews !== true) errors.push('ad impressions must not populate natural views');

if (!(registry.reports || []).some((report) => report.key === contract.reportKey)) {
  errors.push(`report registry is missing ${contract.reportKey}`);
}

if (errors.length) {
  console.error(JSON.stringify({ ok: false, contractPath, errors }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  contractPath,
  contractVersion: contract.contractVersion,
  dimensionCount: groups.size,
  fieldCount: allFields.size,
  reportKey: contract.reportKey,
  finalCoverageDays: contract.generationGates.final.requiredCoverageDays,
  finalCompleteness: contract.generationGates.final.requiredFieldCompleteness
}, null, 2));
