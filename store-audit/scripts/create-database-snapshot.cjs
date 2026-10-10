#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

async function main() {
  const [sourceArg, targetArg] = process.argv.slice(2);
  if (!sourceArg || !targetArg) throw new Error('Usage: create-database-snapshot.cjs <source.sqlite> <target.sqlite>');
  const sourcePath = path.resolve(sourceArg);
  const targetPath = path.resolve(targetArg);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (fs.existsSync(targetPath)) fs.rmSync(targetPath);
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const integrity = source.prepare('PRAGMA integrity_check').get().integrity_check;
  const foreignKeyErrors = source.prepare('PRAGMA foreign_key_check').all().length;
  if (integrity !== 'ok' || foreignKeyErrors !== 0) throw new Error('Source database validation failed');
  await backup(source, targetPath);
  source.close();
  const snapshot = new DatabaseSync(targetPath, { readOnly: true });
  const snapshotIntegrity = snapshot.prepare('PRAGMA integrity_check').get().integrity_check;
  const schemaVersion = snapshot.prepare('SELECT MAX(version) version FROM schema_version').get().version;
  snapshot.close();
  if (snapshotIntegrity !== 'ok') throw new Error('Snapshot integrity check failed');
  console.log(JSON.stringify({ sourcePath, targetPath, schemaVersion, integrity: snapshotIntegrity }));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
