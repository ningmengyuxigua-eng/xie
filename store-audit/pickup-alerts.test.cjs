'use strict';

const assert = require('assert/strict');
const { evaluatePickupAlerts, MESSAGE_TEMPLATES } = require('./pickup-alerts.cjs');

const storeId = '27857268786685';
const now = '2026-10-09T10:45:00+08:00';
const base = {
  storeId,
  orderNumber: 'TEST-ORDER',
  pickupReadyAt: '2026-10-05T10:45:00+08:00',
  latestEventCode: 'pickup_ready',
};

const result = evaluatePickupAlerts([
  { ...base, orderInternalId: 'due' },
  { ...base, orderInternalId: 'delivered', latestEventCode: 'delivered' },
  { ...base, orderInternalId: 'cancelled', latestEventCode: 'cancelled' },
  { ...base, orderInternalId: 'notified', notifiedForPickupReadyAt: base.pickupReadyAt },
  {
    ...base,
    orderInternalId: 'not-due',
    pickupReadyAt: '2026-10-06T10:45:00+08:00',
  },
  { storeId, orderInternalId: 'missing', latestEventCode: 'shipped' },
], { now });

assert.deepEqual(result.counts, {
  input: 6,
  missingPickupReadyAt: 1,
  resolved: 2,
  notDue: 1,
  alreadyNotified: 1,
  due: 1,
});
assert.equal(result.alerts.length, 1);
assert.equal(result.alerts[0].orderInternalId, 'due');
assert.equal(result.alerts[0].orderNumber, 'TEST-ORDER');
assert.equal(result.alerts[0].waitingHours, 96);
assert.equal(result.alerts[0].dueAt, '2026-10-09T02:45:00.000Z');
assert.deepEqual(result.alerts[0].messageOptions.map((option) => option.templateKey), ['gentle', 'consequence']);
assert.equal(result.alerts[0].messageOptions[0].text, MESSAGE_TEMPLATES.gentle);
assert.match(result.alerts[0].messageOptions[1].text, /可能限制貨到付款/);

console.log('pickup-alerts tests: OK');
