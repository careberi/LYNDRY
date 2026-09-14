'use strict';

// ---------------------------------------------------------------------------
// WHICH PROMOTION IS COMING ON AN ORDER.
//
// Neil, 13 September: "on this screen, I should be able to see what promotion
// is being applied to this order. So there needs to be another column here."
//
// The column has two sources and they are not the same kind of claim. A priced
// order carries promotion_id and discount_cents on its own row, written by
// fulfilment at the moment it priced - a FACT, read and never recomputed. An
// unweighed order is a PREDICTION, and these are the rules it is made under.
//
// usableOn() is the reason this is testable at all: the four conditions used to
// live inside discountFor(), where nothing could reach them without a database
// and a price. They are one function now, called by the money path and by the
// board, so the screen cannot promise a discount the pricing code would refuse.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { usableOn } = require('../src/core/promotions');

const ORDER = { id: 'order-1' };
const grant = (over = {}) => ({
  grantId: 'g1',
  applies_to: 'EVERY_ORDER',
  kind: 'PERCENT_OFF',
  value: 50,
  max_orders: null,
  min_order_cents: null,
  claimedOrderId: null,
  ...over,
});

test('a plain grant applies', () => {
  assert.equal(usableOn([grant()], { order: ORDER }).length, 1);
});

test('FIRST_ORDER is gone once anything has been DELIVERED', () => {
  const first = [grant({ applies_to: 'FIRST_ORDER' })];
  assert.equal(usableOn(first, { order: ORDER, delivered: 0 }).length, 1);
  assert.equal(usableOn(first, { order: ORDER, delivered: 1 }).length, 0);
});

test('A CAPPED PROMOTION ONLY SHOWS ON THE ORDER HOLDING ITS SLOT', () => {
  // The slot is taken at booking, so by the time anything is priced the answer
  // is settled. A board that showed "first 20 free" against order twenty-one
  // would be repeating a promise nobody made.
  const capped = [grant({ max_orders: 20, claimedOrderId: 'order-99' })];
  assert.equal(usableOn(capped, { order: ORDER }).length, 0);

  const ours = [grant({ max_orders: 20, claimedOrderId: 'order-1' })];
  assert.equal(usableOn(ours, { order: ORDER }).length, 1);
});

test('an uncapped promotion needs no claim', () => {
  // max_orders null means nothing to run out of, so claimedOrderId is null on
  // every grant of it - which must not read as "somebody else has the slot".
  const uncapped = [grant({ max_orders: null, claimedOrderId: null })];
  assert.equal(usableOn(uncapped, { order: ORDER }).length, 1);
});

test('THE MINIMUM IS ONLY CHECKED WHEN THERE IS A PRICE, and that is the point', () => {
  // "Valid on orders over $30" cannot be answered before a bag is weighed.
  // The money path always has a price and enforces it; the board does not, and
  // showing the promotion somebody is holding is the honest answer there -
  // nobody knows yet whether the load clears the minimum, us included.
  const over30 = [grant({ min_order_cents: 3000 })];

  assert.equal(usableOn(over30, { order: ORDER, priceCents: 2000 }).length, 0, 'priced under, refused');
  assert.equal(usableOn(over30, { order: ORDER, priceCents: 4000 }).length, 1, 'priced over, applies');
  assert.equal(usableOn(over30, { order: ORDER }).length, 1, 'unpriced, shown');
});

test('the conditions stack rather than overriding each other', () => {
  const both = [grant({ applies_to: 'FIRST_ORDER', max_orders: 20, claimedOrderId: 'order-1' })];
  assert.equal(usableOn(both, { order: ORDER, delivered: 0 }).length, 1);
  assert.equal(usableOn(both, { order: ORDER, delivered: 2 }).length, 0, 'first-order still bites');
});

test('nothing held is nothing shown, and never a crash', () => {
  assert.deepEqual(usableOn([], { order: ORDER }), []);
});
