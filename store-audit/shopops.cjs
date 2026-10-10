#!/usr/bin/env node
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const projectRoot = path.join(root, '..');
const dbPath = path.join(root, 'db', 'store-audit.sqlite');
const args = process.argv.slice(2);

function run(script, scriptArgs = []) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...scriptArgs], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function value(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}

function status() {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const result = {
    system: '拾味廚房雜貨鋪營運決策系統',
    schemaVersion: db.prepare('SELECT MAX(version) version FROM schema_version').get().version,
    databaseIntegrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    products: db.prepare('SELECT COUNT(*) count FROM product_master').get().count,
    productsWithListedAt: db.prepare('SELECT COUNT(*) count FROM product_master WHERE listed_at IS NOT NULL').get().count,
    lifecycleEvents: db.prepare('SELECT COUNT(*) count FROM product_lifecycle_event').get().count,
    pendingProductDetails: db.prepare("SELECT COUNT(*) count FROM product_detail_queue WHERE status='pending'").get().count,
    reportDefinitions: db.prepare('SELECT COUNT(*) count FROM report_definition').get().count,
    enabledReports: db.prepare('SELECT COUNT(*) count FROM report_definition WHERE enabled=1').get().count,
    collectorEnabled: false,
  };
  db.close();
  console.log(JSON.stringify(result, null, 2));
}

function versionInfo() {
  const packageInfo = require(path.join(projectRoot, 'package.json'));
  const versionPolicy = require(path.join(root, 'config', 'version-policy.json'));
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const schemaVersion = db.prepare('SELECT MAX(version) version FROM schema_version').get().version;
  db.close();
  console.log(JSON.stringify({
    applicationVersion: packageInfo.version,
    databaseSchemaVersion: schemaVersion,
    releaseChannel: versionPolicy.releaseChannel,
    nodeVersion: process.versions.node,
    storeDisplayName: '拾味廚房雜貨鋪',
  }, null, 2));
}

function help() {
  console.log(`拾味廚房雜貨鋪營運決策系統\n\n` +
    `用法：D:\\xiapi\\shopops.cmd <command> [options]\n\n` +
    `  status                         顯示精簡系統狀態\n` +
    `  context                        重新產生專案精簡上下文\n` +
    `  migrate                        執行尚未套用的資料庫遷移\n` +
    `  reports-sync                   同步報表定義\n` +
    `  product-import --input FILE    只匯入新商品，已知商品直接跳過\n` +
    `  product-baseline [--input FILE]匯入本機商品基線\n` +
    `  product-status --product-id ID --status STATUS [--reason TEXT]\n` +
    `                                 記錄下架、重新上架等生命週期事件\n` +
    `  validate                       執行資料庫與設定驗證\n` +
    `  version                        顯示程式、資料庫及執行環境版本\n` +
    `  pre-update --target VERSION    更新前驗證；加--prepare建立備份\n` +
    `  help                           顯示此說明\n\n` +
    `商品採集器目前保留介面但未啟用。`);
}

const command = args[0] || 'status';
if (command === 'status') status();
else if (command === 'version') versionInfo();
else if (command === 'pre-update') run('pre-update-check.cjs', args.slice(1));
else if (command === 'context') run('build-project-context.cjs');
else if (command === 'migrate') run(path.join('db', 'migrate.cjs'));
else if (command === 'reports-sync') run(path.join('reporting', 'sync-report-definitions.cjs'));
else if (command === 'product-import') {
  const input = value('input');
  if (!input) throw new Error('product-import requires --input FILE');
  run('import-product-discovery.cjs', ['--mode', 'incremental', '--input', input, '--date', value('date', new Date().toISOString().slice(0, 10))]);
} else if (command === 'product-baseline') {
  run('import-product-discovery.cjs', ['--mode', 'baseline', '--input', value('input', path.join(root, '2026-10-06', 'products.json')), '--date', value('date', '2026-10-06')]);
} else if (command === 'product-status') {
  const forwarded = args.slice(1);
  run('update-product-lifecycle.cjs', forwarded);
} else if (command === 'validate') {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const result = {
    ok: db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok' && db.prepare('PRAGMA foreign_key_check').all().length === 0,
    integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    foreignKeyErrors: db.prepare('PRAGMA foreign_key_check').all().length,
    schemaVersion: db.prepare('SELECT MAX(version) version FROM schema_version').get().version,
  };
  db.close();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} else if (command === 'help' || command === '--help' || command === '-h') help();
else {
  help();
  process.exitCode = 1;
}
