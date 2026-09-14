'use strict';

// ---------------------------------------------------------------------------
// PAYMENT HOLD.
//
// Neil's locks, 14 September, on order #2060 - collected, weighed, charged,
// refused, sitting washed at Best Wash, and still drawable as a delivery stop
// because collectable() only ever gated the pickup door.
//
//   pickup      collectable() as before, PLUS the sibling block
//   plant drop  already blocked by van_confirmed_at - nothing added
//   retrieval   ALLOWED on hold, so their shelf is not our warehouse
//   delivery    REFUSED while held
//
// Hold is DERIVED. There is no payment_hold column and no PART_PAID status. It
// is written as a balance rather than as "payment_status === FAILED" because the
// cash ledger will make it partial, and this rule must not be re-opened then.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dispatch = require('../src/core/dispatch');
const orders = require('../src/core/orders');

const SOURCE = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'core', f), 'utf8');

const withCard = { stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_1' };

// #2060 as it actually stands.
const held = {
  order_number: 2060,
  status: 'READY',
  payment_status: 'FAILED',
  price_cents: 8400,
  customer_id: 'shamar',
  customers: withCard,
};

// --- the balance ------------------------------------------------------------

test('a refused charge leaves the whole price outstanding', () => {
  assert.equal(dispatch.balance(held), 8400);
});

test('PAID and WAIVED owe nothing', () => {
  assert.equal(dispatch.balance({ ...held, payment_status: 'PAID' }), 0);
  assert.equal(dispatch.balance({ ...held, payment_status: 'WAIVED' }), 0);
});

test('UNPAID IS ZERO, AND THAT IS THE POINT, NOT AN OVERSIGHT', () => {
  // recordWeight() prices a bag on the doorstep a minute before loadVan()
  // charges for it, so IN_PROCESS + priced + UNPAID is the normal state of an
  // order with the driver standing in front of it. Counting that as money owed
  // would put his current stop on hold underneath him.
  const midDoorstep = { ...held, status: 'IN_PROCESS', payment_status: 'UNPAID' };
  assert.equal(dispatch.balance(midDoorstep), 0);
  assert.equal(dispatch.paymentHold(midDoorstep), false);
});

test('no price, no balance, and never a crash', () => {
  assert.equal(dispatch.balance({ ...held, price_cents: null }), 0);
  assert.equal(dispatch.balance(null), 0);
  assert.equal(dispatch.paymentHold(null), false);
});

// --- the hold ---------------------------------------------------------------

test('WE HAVE THE LAUNDRY AND THE MONEY DID NOT ARRIVE', () => {
  assert.equal(dispatch.paymentHold(held), true);
});

test('a refusal at the doorstep is NOT a hold', () => {
  // declinedAtTheDoor() leaves the bags on the step and uncollects the order, so
  // it goes back to REQUESTED. Nothing is being held.
  assert.equal(dispatch.paymentHold({ ...held, status: 'REQUESTED' }), false);
});

test('a delivered order is not held however it was paid', () => {
  assert.equal(dispatch.paymentHold({ ...held, status: 'DELIVERED' }), false);
});

test('every in-hand status can hold, and only those', () => {
  for (const status of orders.IN_OUR_HANDS) {
    assert.equal(dispatch.paymentHold({ ...held, status }), true, status);
  }
  for (const status of ['REQUESTED', 'DELIVERED', 'CANCELED']) {
    assert.equal(dispatch.paymentHold({ ...held, status }), false, status);
  }
});

test('WAIVED IS ROUTABLE. Nothing to charge is not cannot charge', () => {
  const waived = { ...held, payment_status: 'WAIVED', price_cents: 0 };
  assert.equal(dispatch.paymentHold(waived), false);
  assert.equal(dispatch.collectable(waived), true);
});

// --- which legs it gates ----------------------------------------------------

test('THE DELIVERY LEG REFUSES A HELD ORDER', () => {
  const board = SOURCE('dispatch.js');
  const at = board.indexOf('const deliverStops');
  assert.notEqual(at, -1);
  const block = board.slice(at, at + 400);
  assert.match(block, /!paymentHold\(o\)/, 'the delivery leg is not gated');
});

test('THE RETRIEVAL LEG IS NOT GATED, which is the lock', () => {
  // Refusing to collect finished work leaves our bags on somebody else's shelf
  // at their cost. Hold keeps laundry off a doorstep, not off a laundromat.
  const board = SOURCE('dispatch.js');
  const at = board.indexOf("kind: 'pickup_partner'");
  assert.notEqual(at, -1);
  const block = board.slice(at - 900, at + 200);
  assert.ok(!/paymentHold/.test(block), 'retrieval got gated and must not be');
});

test('the plant drop-off leg has nothing added to it', () => {
  // loadVan() charges before it writes van_confirmed_at, and only a stamped
  // order reaches that leg, so unpaid work cannot get to a laundromat anyway.
  // A second guard here would be a second copy of the rule.
  const fulfilment = SOURCE('fulfilment.js');
  const at = fulfilment.indexOf('async function markAtPartner');
  if (at !== -1) {
    const block = fulfilment.slice(at, at + 700);
    assert.ok(!/paymentHold/.test(block), 'the partner drop got a gate it does not need');
  }
});

test('outForDelivery() refuses, so a hidden stop is not the only guard', () => {
  const fulfilment = SOURCE('fulfilment.js');
  const at = fulfilment.indexOf('async function outForDelivery');
  assert.notEqual(at, -1);
  const block = fulfilment.slice(at, at + 1400);
  assert.match(block, /dispatch\.paymentHold\(order\)/);
  assert.match(block, /payment_hold/);
});

// --- the shape of the thing -------------------------------------------------

test('NOTHING IS STORED. No column, no new status', () => {
  // Comments stripped first, the same trick payment-methods.test.js uses: the
  // comments here say at length that there is no payment_hold column, and a
  // naive search finds its own prose.
  const code = SOURCE('dispatch.js')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  assert.ok(!/payment_hold/.test(code), 'a payment_hold column crept in');
  assert.ok(!/PART_PAID/.test(code), 'a PART_PAID status crept in');
});

test('it is written as a balance, so the cash ledger drops in later', () => {
  // The whole reason balance() exists rather than a FAILED check inline.
  const src = SOURCE('dispatch.js');
  const at = src.indexOf('function paymentHold');
  const block = src.slice(at, at + 400);
  assert.match(block, /balance\(order\) > 0/);
});

test('entering hold raises an issue, and only while the laundry is ours', () => {
  const billing = SOURCE('billing.js');
  const at = billing.indexOf('async function markFailed');
  assert.notEqual(at, -1);
  const block = billing.slice(at, billing.indexOf('async function retryOutstanding', at));
  assert.match(block, /IN_OUR_HANDS\.includes\(order\.status\)/, 'it pages for doorstep declines too');
  assert.match(block, /issues[\s\S]{0,40}\.raise\(/, 'nothing is raised');
});

test('BOTH FIELD LISTS CARRY WHAT balance() READS', () => {
  // This is the bug that got through code review and was caught only by running
  // the board against real rows: BOARD_FIELDS carried payment_status but not
  // price_cents, so every balance evaluated to zero, nothing was ever held, and
  // #2060 stayed a delivery stop. It does not throw. It just quietly does
  // nothing, which is the worst way for a money rule to fail.
  //
  // Sixth time an unselected column has decided what a screen can know:
  // BOARD_FIELDS and RUN_FIELDS for the card gate, the order page's
  // payment_attempts and its ready_at / delivered_at, the three reminder
  // queries, and now this.
  const src = SOURCE('dispatch.js');
  for (const list of ['BOARD_FIELDS', 'RUN_FIELDS']) {
    const at = src.indexOf(`const ${list} =`);
    assert.notEqual(at, -1, `${list} not found`);
    const block = src.slice(at, src.indexOf(';', src.indexOf("customers", at)));
    assert.match(block, /price_cents/, `${list} does not select price_cents`);
    assert.match(block, /payment_status/, `${list} does not select payment_status`);
  }
});
