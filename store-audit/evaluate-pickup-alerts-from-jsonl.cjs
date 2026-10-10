#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { evaluatePickupAlerts } = require('./pickup-alerts.cjs');

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function readJsonLines(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSONL at line ${index + 1}`);
      }
    });
}

function readArgs(argv) {
  const args = { input: null, state: null, now: null, limit: 20, markNotified: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--state') args.state = argv[++i];
    else if (argv[i] === '--now') args.now = argv[++i];
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--mark-notified') args.markNotified = true;
    else if (!args.input) args.input = argv[i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.input) throw new Error('JSONL input path is required');
  if (!args.state) args.state = path.join(__dirname, 'state', 'pickup-alert-state.json');
  return args;
}

function main() {
  const args = readArgs(process.argv.slice(2));
  const state = readJson(args.state, { version: 1, notified: {} });
  state.notified ||= {};
  const rows = readJsonLines(args.input);
  const candidates = rows
    .filter((row) => row.latestEventCode === 'pickup_ready' && row.latestEventAt)
    .map((row) => {
      const pickupReadyAt = row.latestEventAt.replace(
        /^([0-9]{4})\/([0-9]{2})\/([0-9]{2})\s+([0-9]{2}:[0-9]{2})$/,
        '$1-$2-$3T$4:00+08:00'
      );
      const alertKey = `${row.storeId}:${row.orderInternalId}:${pickupReadyAt}`;
      return {
        storeId: row.storeId,
        orderInternalId: row.orderInternalId,
        orderNumber: row.orderNumber,
        pickupReadyAt,
        latestEventCode: row.latestEventCode,
        notifiedForPickupReadyAt: state.notified[alertKey] ? pickupReadyAt : null,
      };
    });

  const evaluation = evaluatePickupAlerts(candidates, {
    now: args.now || new Date().toISOString(),
    limit: args.limit,
  });
  const outputPath = path.join(path.dirname(args.input), 'pickup-alert-evaluation.json');
  const result = {
    evaluatedAt: args.now || new Date().toISOString(),
    sourceJsonl: args.input,
    inputRows: rows.length,
    pickupReadyCandidates: candidates.length,
    ...evaluation,
  };
  writeJsonAtomic(outputPath, result);

  if (args.markNotified) {
    const notifiedAt = result.evaluatedAt;
    for (const alert of evaluation.alerts) {
      state.notified[alert.alertKey] = {
        orderNumber: alert.orderNumber,
        pickupReadyAt: alert.pickupReadyAt,
        notifiedAt,
      };
    }
    writeJsonAtomic(args.state, state);
  }

  process.stdout.write(`${JSON.stringify({
    inputRows: rows.length,
    pickupReadyCandidates: candidates.length,
    due: evaluation.counts.due,
    alreadyNotified: evaluation.counts.alreadyNotified,
    markedNotified: args.markNotified ? evaluation.alerts.length : 0,
    alertOrderNumbers: evaluation.alerts.map((alert) => alert.orderNumber),
    outputPath,
    statePath: args.state,
  })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
