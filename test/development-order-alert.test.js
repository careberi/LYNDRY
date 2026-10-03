'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(isDevelopment) {
  const sent = [];
  let recipientLookups = 0;
  const modules = {
    '../config': { config: { baseUrl: 'https://example.test', supabase: { isDevelopment } } },
    '../web/site': { site: {} },
    './issues': { alertRecipients: async () => {
      recipientLookups++;
      return ['+12025550101', '+12025550102'];
    } },
    './notify': { sendAndLog: async (...args) => sent.push(args) },
  };
  const context = { require: name => modules[name], module: { exports: {} }, console: { log() {}, error() {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/core/order-alerts'), 'utf8'), context);
  return { alerts: context.module.exports, sent, lookups: () => recipientLookups };
}

const booking = {
  customer: { id: 'customer', phone: '+12025550102', name: 'Test customer', address_line1: 'Test address' },
  order: { order_number: 9030 },
  booking: { whenLine: () => 'Friday at 23:00 Eastern' },
  needsCard: false,
};

test('development booking does not create staff or support-number conversations', async () => {
  const f = fixture(true);
  const result = await f.alerts.newOrder(booking);
  assert.equal(f.lookups(), 0);
  assert.equal(f.sent.length, 0);
  assert.equal(result.skipped, 'development order texts go to the customer');
});

test('production retains its existing staff booking alerts', async () => {
  const f = fixture(false);
  await f.alerts.newOrder(booking);
  assert.equal(f.lookups(), 1);
  assert.deepEqual(f.sent.map(args => args[0]), ['+12025550101', '+12025550102']);
  assert.ok(f.sent.every(args => args[2] === null));
});
