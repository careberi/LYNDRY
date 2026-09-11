'use strict';

// ---------------------------------------------------------------------------
// BRINGING A CANCELLED ORDER BACK.
//
// orders.reinstate() is the only way out of CANCELED, and the rule that keeps
// it narrow is reinstatable(): an order that ever held laundry must never come
// back, because that would put a finished job back on the board.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const orders = require('../src/core/orders');

const cancelled = (extra = {}) => ({ order_number: 1975, status: 'CANCELED', ...extra });

test('CANCELED is still terminal in the state machine', () => {
  // reinstate() is a separate door. Nothing that goes through transition() -
  // the AI, the ops buttons, the website - may un-cancel an order.
  assert.deepEqual(orders.ALLOWED_NEXT.CANCELED, []);
  assert.equal(orders.canTransition('CANCELED', 'REQUESTED'), false);
});

test('a cancelled order that never reached us may come back', () => {
  assert.equal(orders.reinstatable(cancelled()), null);
});

test('only a cancelled order may be reinstated', () => {
  for (const status of ['REQUESTED', 'IN_PROCESS', 'DELIVERED']) {
    assert.ok(orders.reinstatable({ order_number: 1, status }), `${status} was allowed`);
  }
  assert.ok(orders.reinstatable(null), 'a missing order was allowed');
});

test('an order that ever held laundry never comes back', () => {
  for (const held of [
    { collected_at: '2026-09-01T10:00:00Z' },
    { weight_lb: 12.5 },
    { at_partner_at: '2026-09-01T12:00:00Z' },
    { delivered_at: '2026-09-02T18:00:00Z' },
  ]) {
    assert.ok(orders.reinstatable(cancelled(held)), `allowed with ${JSON.stringify(held)}`);
  }
});
