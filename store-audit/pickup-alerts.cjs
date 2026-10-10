#!/usr/bin/env node

'use strict';

const fs = require('fs');

const DEFAULT_THRESHOLD_DAYS = 4;
const DEFAULT_LIMIT = 20;
const MESSAGE_TEMPLATES = Object.freeze({
  gentle: '您好～提醒您，包裹目前已送達取件門市，仍在等待領取，請您於取件期限前前往領取。若已取件可忽略此訊息，謝謝您～',
  consequence: '您好～提醒您，包裹目前仍在門市待取，請務必於取件期限前完成領取。若逾期未取，包裹將退回，訂單也會轉為不成立；多次未領取包裹，蝦皮官方可能限制貨到付款、蝦皮店到店取貨或帳號交易功能。再麻煩您儘快前往領取，謝謝您～',
});
const RESOLVED_EVENTS = new Set([
  'picked_up',
  'delivered',
  'signed',
  'completed',
  'cancelled',
  'returned',
  'refunded',
]);

function parseTimestamp(value, fieldName) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return timestamp;
}

function evaluatePickupAlerts(orders, options = {}) {
  const thresholdDays = options.thresholdDays ?? DEFAULT_THRESHOLD_DAYS;
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT);
  const nowMs = parseTimestamp(options.now ?? new Date().toISOString(), 'now');
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;

  if (!Array.isArray(orders)) throw new Error('Input must be an array of orders');
  if (!Number.isInteger(thresholdDays) || thresholdDays < 1) {
    throw new Error('thresholdDays must be a positive integer');
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }

  const due = [];
  const counts = {
    input: orders.length,
    missingPickupReadyAt: 0,
    resolved: 0,
    notDue: 0,
    alreadyNotified: 0,
    due: 0,
  };

  for (const order of orders) {
    const pickupReadyMs = parseTimestamp(order.pickupReadyAt, 'pickupReadyAt');
    if (pickupReadyMs === null) {
      counts.missingPickupReadyAt += 1;
      continue;
    }

    if (RESOLVED_EVENTS.has(order.latestEventCode)) {
      counts.resolved += 1;
      continue;
    }

    const dueMs = pickupReadyMs + thresholdMs;
    if (nowMs < dueMs) {
      counts.notDue += 1;
      continue;
    }

    if (order.notifiedForPickupReadyAt === order.pickupReadyAt) {
      counts.alreadyNotified += 1;
      continue;
    }

    counts.due += 1;
    if (due.length < limit) {
      due.push({
        storeId: String(order.storeId),
        orderInternalId: String(order.orderInternalId),
        orderNumber: order.orderNumber ? String(order.orderNumber) : null,
        pickupReadyAt: order.pickupReadyAt,
        dueAt: new Date(dueMs).toISOString(),
        waitingHours: Math.floor((nowMs - pickupReadyMs) / (60 * 60 * 1000)),
        alertKey: `${order.storeId}:${order.orderInternalId}:${order.pickupReadyAt}`,
        messageOptions: [
          { templateKey: 'gentle', label: '溫和提醒版', text: MESSAGE_TEMPLATES.gentle },
          { templateKey: 'consequence', label: '後果提醒版', text: MESSAGE_TEMPLATES.consequence },
        ],
      });
    }
  }

  due.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return { thresholdDays, limit, counts, alerts: due };
}

function readArgs(argv) {
  const args = { input: null, now: null, limit: DEFAULT_LIMIT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--now') args.now = argv[++i];
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (!args.input) args.input = argv[i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.input) throw new Error('Usage: node pickup-alerts.cjs <orders.json> [--now ISO] [--limit 1-20]');
  return args;
}

if (require.main === module) {
  try {
    const args = readArgs(process.argv.slice(2));
    const orders = JSON.parse(fs.readFileSync(args.input, 'utf8'));
    process.stdout.write(`${JSON.stringify(evaluatePickupAlerts(orders, args), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { evaluatePickupAlerts, MESSAGE_TEMPLATES };
