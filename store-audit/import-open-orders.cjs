#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const dbPath = path.join(root, 'db', 'store-audit.sqlite');
const resolvedEvents = new Set(['picked_up', 'delivered', 'signed', 'completed', 'cancelled', 'returned', 'refunded']);

function normalizeTaipeiTimestamp(value) {
  if (!value) return null;
  const matched = String(value).match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2})$/);
  return matched ? `${matched[1]}-${matched[2]}-${matched[3]}T${matched[4]}:00+08:00` : new Date(value).toISOString();
}

function collectJsonl(input) {
  const stat = fs.statSync(input);
  if (stat.isFile()) return [input];
  return fs.readdirSync(input, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

function readRows(files) {
  const rows = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) rows.push({ ...JSON.parse(line), sourcePath: file });
  }
  return rows.sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)));
}

function main() {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node import-open-orders.cjs <jsonl-file-or-directory>');
  const files = collectJsonl(path.resolve(input));
  const rows = readRows(files);
  const statePath = path.join(root, 'state', 'pickup-alert-state.json');
  const legacyState = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { notified: {} };
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
  const upsertOrder = db.prepare(`
    INSERT INTO order_master(
      store_id, order_internal_id, order_number, source_status, latest_event_code,
      latest_event_at, pickup_ready_at, first_seen_at, last_seen_at, resolved_at,
      source_path, source_payload_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store_id, order_internal_id) DO UPDATE SET
      order_number=COALESCE(excluded.order_number, order_master.order_number),
      source_status=excluded.source_status,
      latest_event_code=excluded.latest_event_code,
      latest_event_at=excluded.latest_event_at,
      pickup_ready_at=COALESCE(excluded.pickup_ready_at, order_master.pickup_ready_at),
      last_seen_at=excluded.last_seen_at,
      resolved_at=COALESCE(excluded.resolved_at, order_master.resolved_at),
      source_path=excluded.source_path,
      source_payload_hash=excluded.source_payload_hash
  `);
  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO order_logistics_event(
      store_id, order_internal_id, event_code, event_at, source_event_hash, observed_at, source_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertAlert = db.prepare(`
    INSERT INTO pickup_alert(
      alert_key, store_id, order_internal_id, pickup_ready_at, due_at, status,
      suggested_template_key, notified_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'gentle', ?, ?, ?)
    ON CONFLICT(alert_key) DO UPDATE SET
      status=CASE WHEN pickup_alert.status='notified' THEN 'notified' ELSE excluded.status END,
      notified_at=COALESCE(pickup_alert.notified_at, excluded.notified_at),
      updated_at=excluded.updated_at
  `);
  const resolveAlerts = db.prepare(`
    UPDATE pickup_alert SET status='resolved', resolved_at=?, resolution_reason=?, updated_at=?
    WHERE store_id=? AND order_internal_id=? AND status IN ('pending','notified')
  `);

  let alerts = 0;
  for (const row of rows) {
    const observedAt = normalizeTaipeiTimestamp(row.observedAt || new Date().toISOString());
    const eventAt = normalizeTaipeiTimestamp(row.latestEventAt) || observedAt;
    const eventCode = row.latestEventCode || 'other';
    const status = resolvedEvents.has(eventCode) ? (eventCode === 'picked_up' ? 'delivered' : eventCode) : (row.sourceStatus || 'unknown');
    const pickupReadyAt = eventCode === 'pickup_ready' ? eventAt : null;
    const resolvedAt = resolvedEvents.has(eventCode) ? observedAt : null;
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
    const eventHash = crypto.createHash('sha256').update(`${eventCode}|${eventAt}`).digest('hex');
    upsertOrder.run(String(row.storeId), String(row.orderInternalId), row.orderNumber || null, status,
      eventCode, eventAt, pickupReadyAt, observedAt, observedAt, resolvedAt, row.sourcePath, payloadHash);
    insertEvent.run(String(row.storeId), String(row.orderInternalId), eventCode, eventAt, eventHash, observedAt, row.sourcePath);

    if (pickupReadyAt) {
      const alertKey = `${row.storeId}:${row.orderInternalId}:${pickupReadyAt}`;
      const dueAt = new Date(Date.parse(pickupReadyAt) + 4 * 86400000).toISOString();
      const legacy = legacyState.notified?.[alertKey];
      const alertStatus = legacy ? 'notified' : 'pending';
      upsertAlert.run(alertKey, String(row.storeId), String(row.orderInternalId), pickupReadyAt,
        dueAt, alertStatus, legacy?.notifiedAt || null, observedAt, observedAt);
      alerts += 1;
    } else if (resolvedEvents.has(eventCode)) {
      resolveAlerts.run(observedAt, eventCode, observedAt, String(row.storeId), String(row.orderInternalId));
    }
  }
  db.exec('COMMIT;');
  const result = {
    files: files.length,
    inputRows: rows.length,
    orders: db.prepare('SELECT COUNT(*) n FROM order_master').get().n,
    logisticsEvents: db.prepare('SELECT COUNT(*) n FROM order_logistics_event').get().n,
    pickupAlerts: db.prepare('SELECT COUNT(*) n FROM pickup_alert').get().n,
    pickupRowsProcessed: alerts,
  };
  db.close();
  console.log(JSON.stringify(result, null, 2));
}

try { main(); } catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
