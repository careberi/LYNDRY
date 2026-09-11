'use strict';

// ---------------------------------------------------------------------------
// WHICH LAUNDROMAT EACH BAG GOES TO, AND HOW MANY DROP-OFF STOPS THAT MAKES.
//
// Neil, 11 September: order #1975 pinned to Fancy K, everything else to the
// live choice. The quiet failure is a pin that gets ignored because the live
// choice is cheaper - the route looks perfectly sensible and sends the bags to
// the wrong counter.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { dropoffGroups } = require('../src/core/dispatch');

const BEST_WASH = { id: 'bw', name: 'Best Wash Laundromat' };
const FANCY_K = { id: 'fk', name: 'Fancy K Laundry' };
const PARTNERS = [BEST_WASH, FANCY_K];

const order = (n, extra = {}) => ({ id: `o${n}`, order_number: n, ...extra });
const summary = (groups) =>
  groups.map((g) => ({
    to: g.partner ? g.partner.name : null,
    orders: g.orders.map((o) => o.order_number),
    pinned: g.pinned,
    fromPlan: g.fromPlan,
  }));

test('nothing pinned: everything goes to the live choice, in one stop', () => {
  const groups = dropoffGroups([order(1), order(2, { intended_partner_id: 'fk' })], PARTNERS, BEST_WASH);
  assert.deepEqual(summary(groups), [
    { to: 'Best Wash Laundromat', orders: [1, 2], pinned: false, fromPlan: false },
  ]);
});

test('a pinned order goes where it was pinned, even when the live choice is cheaper', () => {
  const groups = dropoffGroups(
    [order(2059), order(1975, { intended_partner_id: 'fk', partner_pinned_at: '2026-09-11T17:00:00Z' })],
    PARTNERS,
    BEST_WASH
  );
  assert.deepEqual(summary(groups), [
    { to: 'Best Wash Laundromat', orders: [2059], pinned: false, fromPlan: false },
    { to: 'Fancy K Laundry', orders: [1975], pinned: true, fromPlan: false },
  ]);
});

test('an unpinned plan does not beat the live choice', () => {
  // #1975's own problem: planned for Fancy K on 5 Sep, before Best Wash existed.
  const groups = dropoffGroups([order(1975, { intended_partner_id: 'fk' })], PARTNERS, BEST_WASH);
  assert.equal(groups[0].partner, BEST_WASH);
});

test('a pin to the live choice shares its stop', () => {
  const groups = dropoffGroups(
    [order(1), order(2, { intended_partner_id: 'bw', partner_pinned_at: '2026-09-11T17:00:00Z' })],
    PARTNERS,
    BEST_WASH
  );
  assert.deepEqual(summary(groups), [
    { to: 'Best Wash Laundromat', orders: [1, 2], pinned: true, fromPlan: false },
  ]);
});

test('a pin to a laundromat that is no longer active is routed like any other order', () => {
  const groups = dropoffGroups(
    [order(1, { intended_partner_id: 'closed-for-good', partner_pinned_at: '2026-09-11T17:00:00Z' })],
    PARTNERS,
    BEST_WASH
  );
  assert.deepEqual(summary(groups), [
    { to: 'Best Wash Laundromat', orders: [1], pinned: false, fromPlan: false },
  ]);
});

test('no live choice: each order falls back to its own plan, and says so', () => {
  const groups = dropoffGroups(
    [order(1, { intended_partner_id: 'bw' }), order(2, { intended_partner_id: 'fk' }), order(3)],
    PARTNERS,
    null
  );
  assert.deepEqual(summary(groups), [
    { to: 'Best Wash Laundromat', orders: [1], pinned: false, fromPlan: true },
    { to: 'Fancy K Laundry', orders: [2], pinned: false, fromPlan: true },
    { to: null, orders: [3], pinned: false, fromPlan: false },
  ]);
});
