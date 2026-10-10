#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const projectRoot = path.join(root, '..');
const dbPath = path.join(root, 'db', 'store-audit.sqlite');

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function value(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function semverParts(input) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(input || '');
  return match ? match.slice(1).map(Number) : null;
}

function isGreaterVersion(target, current) {
  const a = semverParts(target);
  const b = semverParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function copyTree(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.cpSync(source, destination, { recursive: true, force: true });
}

const packageInfo = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const fileVersion = fs.readFileSync(path.join(projectRoot, 'VERSION'), 'utf8').trim();
const versionPolicy = JSON.parse(fs.readFileSync(path.join(root, 'config', 'version-policy.json'), 'utf8'));
const storeProfile = JSON.parse(fs.readFileSync(path.join(root, 'config', 'store-profile.json'), 'utf8'));
const pickupPolicy = JSON.parse(fs.readFileSync(path.join(root, 'config', 'pickup-message-policy.json'), 'utf8'));
const targetVersion = value('target');

const db = new DatabaseSync(dbPath, { readOnly: true });
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all().length;
const schemaVersion = db.prepare('SELECT MAX(version) version FROM schema_version').get().version;
db.close();

const checks = {
  applicationVersionsMatch:
    packageInfo.version === fileVersion && fileVersion === versionPolicy.applicationVersion,
  targetVersionValid: targetVersion ? isGreaterVersion(targetVersion, fileVersion) : null,
  databaseIntegrityOk: integrity === 'ok',
  databaseForeignKeysOk: foreignKeyErrors === 0,
  databaseSchemaMatchesPolicy: schemaVersion === versionPolicy.databaseSchemaVersion,
  storeIdentityMatchesDefault:
    storeProfile.storeId === '27857268786685' &&
    storeProfile.connectionName === 'xie1' &&
    storeProfile.displayName === '拾味廚房雜貨鋪' &&
    storeProfile.platform === 'Shopee' &&
    storeProfile.market === 'TW',
  automaticChatSendingDisabled: pickupPolicy.automaticSendingEnabled === false,
};

let backupPath = null;
if (hasFlag('prepare')) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destinationName = `pre-update-${stamp}-v${fileVersion}-to-v${targetVersion || 'unspecified'}`;
  backupPath = path.join(root, 'backups', destinationName);
  fs.mkdirSync(backupPath, { recursive: true });
  fs.copyFileSync(dbPath, path.join(backupPath, 'store-audit.sqlite'));
  copyTree(path.join(root, 'config'), path.join(backupPath, 'config'));
  copyTree(path.join(root, 'state'), path.join(backupPath, 'state'));
  fs.writeFileSync(path.join(backupPath, 'backup-manifest.json'), `${JSON.stringify({
    createdAt: new Date().toISOString(),
    currentVersion: fileVersion,
    targetVersion,
    databaseSchemaVersion: schemaVersion,
    storeId: storeProfile.storeId,
  }, null, 2)}\n`);
}

checks.preUpdateBackupCreated = Boolean(backupPath && fs.existsSync(path.join(backupPath, 'store-audit.sqlite')));
checks.scheduledCollectionPaused = hasFlag('confirm-scheduler-paused');
checks.liveStoreNameVerified = hasFlag('confirm-live-store');

const technicalKeys = [
  'applicationVersionsMatch', 'databaseIntegrityOk', 'databaseForeignKeysOk',
  'databaseSchemaMatchesPolicy', 'storeIdentityMatchesDefault',
  'automaticChatSendingDisabled',
];
if (targetVersion) technicalKeys.push('targetVersionValid');
const technicalPassed = technicalKeys.every((key) => checks[key] === true);
const manualRequirementsPassed = checks.preUpdateBackupCreated && checks.scheduledCollectionPaused && checks.liveStoreNameVerified;

const result = {
  readyToUpdate: technicalPassed && manualRequirementsPassed,
  currentVersion: fileVersion,
  targetVersion,
  databaseSchemaVersion: schemaVersion,
  storeId: storeProfile.storeId,
  storeDisplayName: storeProfile.displayName,
  checks,
  backupPath,
  reminders: [
    'Pause scheduled collectors before replacing program files.',
    'Verify the live Ziniao store name and storeId using a read-only request.',
    'Keep the pre-update backup until post-update validation and one small manual collection pass.',
    'Do not copy credentials, cookies or API keys into the project.',
    'After update: migrate, validate, verify store name, run one small batch, then resume schedules.',
  ],
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!technicalPassed) process.exitCode = 1;
else if (!manualRequirementsPassed) process.exitCode = 2;
