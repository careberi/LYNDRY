'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const wholesale = require('../src/core/wholesale');
const subscription = require('../src/core/subscription');

// Exercise the first-pickup subscription flow without a live database or texts.
for (const [label, agreedRate, expectedRate] of [
  ['wholesale', 100, 100],
  ['standard', null, subscription.subscriptionCents()],
]) {
  test(`${label} first subscription pickup saves and confirms the right rate`, async () => {
    const writes = [];
    const db = {
      from(table) {
        let patch;
        const query = {
          select() { return query; },
          eq() { return query; },
          order() { return query; },
          update(value) { patch = value; return query; },
          insert(value) { patch = value; return query; },
          single() { return Promise.resolve({ data: { id: 'plan-1', ...patch } }); },
          then(resolve, reject) {
            if (table === 'orders') writes.push(patch);
            return Promise.resolve({ data: table === 'recurring_schedules' ? [] : null }).then(resolve, reject);
          },
        };
        return query;
      },
    };
    const customer = { id: 'customer-1', wholesale_rate_cents: agreedRate };
    const booking = {
      today: () => '2026-09-29',
      DOORS: { WEB: 'WEB' },
      bookPickup: async () => ({
        ok: true,
        order: { id: 'order-1', price_per_lb_cents: agreedRate || 200, minimum_cents: agreedRate ? 0 : 2500 },
      }),
    };
    const module = { exports: {} };
    const dependencies = {
      '../db': db, './booking': booking, './orders': {},
      './subscription': subscription, './wholesale': wholesale,
      './notify': { sendAndLog() { throw new Error('Unexpected text'); } },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/core/recurring.js'), 'utf8'), {
      module, console,
      require(name) {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
      },
    });
    const result = await module.exports.bookAndSchedule(customer, {
      cadence: 'WEEKLY', weekdays: [2], pickupTime: '',
    });
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].price_per_lb_cents, expectedRate);
    assert.equal(writes[0].subscription_id, 'plan-1');
    assert.equal(result.order.price_per_lb_cents, expectedRate);
    assert.equal(result.order.subscription_id, 'plan-1');
    assert.equal(result.order.minimum_cents, agreedRate ? 0 : 2500);
  });
}
