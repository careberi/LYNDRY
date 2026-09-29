'use strict';

// ---------------------------------------------------------------------------
// A WHOLESALE ACCOUNT: ONE AGREED RATE, NO MINIMUM, NO PROMOTIONS.
//
// Neil, 29 September, about Bris Avrohom: "he's always charged at a dollar per
// pound... every time he places an order". Then two decisions taken with the
// alternative in front of him: no order minimum (at $1.00 a pound the $25.00
// floor binds everything under 25 lb, so "always a dollar a pound" would be
// false for most of what he actually sends) and no promotions (CLEAN50 on top
// of $1.00 is $0.50, below what the wash costs us).
//
// WHAT THIS FILE IS FOR. All three rules hang off ONE nullable column, so the
// failure to guard against is one of them quietly not being wired up - a rate
// that applies while the minimum still bites, or a discount that still comes
// off. Each is asserted separately, against the real functions and against
// function BODIES, never against a whole file.
//
// Nothing here touches the database, Stripe or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { config } = require('../src/config');
const wholesale = require('../src/core/wholesale');
const pricing = require('../src/core/pricing');
const promotions = require('../src/core/promotions');
const subscription = require('../src/core/subscription');
const booking = require('../src/core/booking');

// CRLF vs LF: this repo has had a test pass on a branch and fail on main over
// exactly this.
const SRC = (...bits) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8')
    .split('\r\n')
    .join('\n');

// A test that matches its own prose passes because somebody wrote the word
// down. Every assertion against source strips the comments first.
const code = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

function bodyOf(src, opening) {
  const at = src.indexOf(opening);
  assert.notEqual(at, -1, `${opening} has moved`);
  const end = src.indexOf('\n}\n', at);
  assert.notEqual(end, -1, `${opening} has no end`);
  return src.slice(at, end);
}

const BRIS = { id: 'c1', wholesale_rate_cents: 100 };
const ORDINARY = { id: 'c2', wholesale_rate_cents: null };

// --- the column IS the account ----------------------------------------------

test('A RATE IS WHAT MAKES SOMEBODY WHOLESALE, and there is no second flag', () => {
  assert.equal(wholesale.isWholesale(BRIS), true);
  assert.equal(wholesale.isWholesale(ORDINARY), false);
  assert.equal(wholesale.isWholesale(null), false);
  assert.equal(wholesale.isWholesale({}), false);

  // No boolean anywhere that could disagree with the figure.
  assert.ok(!/is_wholesale/.test(code(SRC('core', 'wholesale.js'))), 'a second field for one fact');
});

test('AND A ZERO OR A NEGATIVE IS NOT A PRICE', () => {
  // Reading either as a rate gives laundry away. They are data faults, so they
  // fall back to ordinary pricing rather than to free.
  for (const bad of [0, -100, null, undefined, 'free', NaN]) {
    assert.equal(wholesale.rateCentsFor({ wholesale_rate_cents: bad }), null, String(bad));
    assert.equal(
      wholesale.minimumCentsFor({ wholesale_rate_cents: bad }),
      config.pricing.minimumCents,
      String(bad)
    );
  }
});

// --- the rate ---------------------------------------------------------------

test('THE AGREED RATE BEATS BOTH ORDINARY RATES, INCLUDING THE PLAN ONE', () => {
  // A wholesale customer who also subscribes is still a wholesale customer.
  // $1.80 would be a price RISE, which is the direction nobody would report.
  assert.equal(wholesale.rateForBooking(BRIS, subscription.rateForCents(null)), 100);
  assert.equal(wholesale.rateForBooking(BRIS, subscription.rateForCents('a-plan-id')), 100);

  assert.equal(
    wholesale.rateForBooking(ORDINARY, subscription.rateForCents(null)),
    config.pricing.perPoundCents
  );
  assert.equal(
    wholesale.rateForBooking(ORDINARY, subscription.rateForCents('a-plan-id')),
    config.pricing.subscriptionPerPoundCents
  );
});

test('IT DOES NOT SECOND-GUESS $2.00 AGAINST $1.80', () => {
  // subscription.rateForCents() is the only thing allowed to choose between
  // those two. A copy of that decision here is how the two drift.
  const src = code(SRC('core', 'wholesale.js'));
  assert.ok(!/subscriptionPerPoundCents/.test(src), 'wholesale.js picks the plan rate itself');
  assert.ok(!/rateForCents/.test(src), 'wholesale.js reaches into the plan rate');
});

test('AND A BOOKING READS BOTH OFF IT, rather than reading config', () => {
  const body = code(bodyOf(SRC('core', 'orders.js'), 'async function create('));

  assert.match(body, /wholesale\.rateForBooking\(/, 'the rate ignores an agreed one');
  assert.match(body, /wholesale\.minimumCentsFor\(/, 'the minimum ignores an agreed rate');

  // The old line took the minimum straight off config, which is what made the
  // floor apply to everybody whatever their rate.
  assert.ok(
    !/minimum_cents:\s*config\.pricing\.minimumCents/.test(body),
    'the order minimum is still typed from config'
  );
});

// --- the minimum ------------------------------------------------------------

test('A WHOLESALE PICKUP HAS NO FLOOR, and 15 lb bills fifteen dollars', () => {
  assert.equal(wholesale.minimumCentsFor(BRIS), 0);
  assert.equal(wholesale.minimumCentsFor(ORDINARY), config.pricing.minimumCents);

  // Through the real pricing, on an order booked the way create() books one.
  const order = {
    price_per_lb_cents: wholesale.rateForBooking(BRIS, subscription.rateForCents(null)),
    minimum_cents: wholesale.minimumCentsFor(BRIS),
    surcharge_cents: 0,
  };

  assert.equal(pricing.priceOn(order, 15).beforeDiscount, 1500);
  assert.equal(pricing.priceOn(order, 15).atMinimum, false);
  assert.equal(pricing.priceOn(order, 50).beforeDiscount, 5000);

  // The same loads for anybody else.
  const ordinary = {
    price_per_lb_cents: config.pricing.perPoundCents,
    minimum_cents: config.pricing.minimumCents,
    surcharge_cents: 0,
  };
  assert.equal(pricing.priceOn(ordinary, 15).beforeDiscount, 3000);
  assert.equal(pricing.priceOn(ordinary, 8).beforeDiscount, config.pricing.minimumCents);
});

test('ZERO IS A DELIBERATE NOTHING, NOT A GAP', () => {
  // pricing.floorFor() reads null as "an order taken before minimums existed"
  // and falls back to deposit_cents. A wholesale order has to say zero.
  assert.equal(wholesale.minimumCentsFor(BRIS), 0);
  assert.equal(pricing.floorFor({ minimum_cents: 0, deposit_cents: 2500 }), 0);
});

// --- the promotions ---------------------------------------------------------

const CLEAN50 = [
  {
    grantId: 'g1',
    code: 'CLEAN50',
    kind: 'PERCENT_OFF',
    value: 50,
    applies_to: 'FIRST_ORDER',
    max_orders: null,
    claimedOrderId: null,
  },
];

test('NOTHING COMES OFF A WHOLESALE PRICE', () => {
  const order = { id: 'o1' };

  assert.equal(
    promotions.usableOn(CLEAN50, { order, delivered: 0, priceCents: 5000, customer: ORDINARY })
      .length,
    1,
    'an ordinary customer stopped getting their promotion'
  );

  assert.deepEqual(
    promotions.usableOn(CLEAN50, { order, delivered: 0, priceCents: 5000, customer: BRIS }),
    [],
    'a discount still comes off a wholesale price'
  );
});

test('AND THE GRANT IS REFUSED, NEVER WITHDRAWN', () => {
  // A promise made to somebody is not something to delete quietly. The rule is
  // about what comes off a price, not about the record of what they hold.
  const body = code(bodyOf(SRC('core', 'promotions.js'), 'async function heldBy('));
  assert.ok(!/wholesale/.test(body), 'heldBy() now hides a grant somebody was given');
});

test('THE BOARD PREDICTS WHAT PRICING WOULD ACTUALLY DO', () => {
  // A screen promising a discount the till is going to refuse is the screen and
  // the till disagreeing about what somebody owes.
  const body = code(bodyOf(SRC('core', 'promotions.js'), 'async function expectedForMany('));
  assert.match(body, /wholesale_rate_cents/, 'the board never asks who is wholesale');
  assert.match(body, /usableOn\(held, \{ order, delivered, customer:/, 'the customer is not passed');
});

test('A WHOLESALE PICKUP TAKES NO SLOT OFF A CAPPED OFFER', () => {
  // The cap counts ORDERS and a slot is claimed at BOOKING, so one held by
  // somebody who can never spend it is a free order a real new customer never
  // gets - and it is only released by a cancellation.
  const body = code(bodyOf(SRC('core', 'promotions.js'), 'async function claimSlot('));
  assert.match(body, /wholesale\.isWholesale\(/, 'claimSlot no longer refuses a wholesale account');

  const asks = body.indexOf('wholesale.isWholesale(');
  const claims = body.indexOf('claimed_order_id:');
  assert.ok(asks > -1 && claims > -1, 'claimSlot has changed shape');
  assert.ok(asks < claims, 'the slot is taken before anybody asks whether they are wholesale');
});

// --- what the customer is told ----------------------------------------------

const ORDER = (over = {}) => ({
  order_number: 2099,
  pickup_date: '2026-10-01',
  pickup_window_start: '09:00',
  pickup_window_end: '12:00',
  price_per_lb_cents: config.pricing.perPoundCents,
  minimum_cents: config.pricing.minimumCents,
  ...over,
});

test('THE CONFIRMATION NEVER QUOTES A MINIMUM THAT IS NOT THERE', () => {
  const customer = { ...BRIS, name: 'Bris', preferences: {} };

  const text = booking.confirmationMessage(
    customer,
    ORDER({ price_per_lb_cents: 100, minimum_cents: 0 })
  );

  assert.match(text, /\$1\.00 a pound/, 'the agreed rate is not in the confirmation');
  assert.ok(!/minimum/.test(text), `a wholesale confirmation still quotes a minimum: ${text}`);
  assert.ok(!/\$2\.00/.test(text), 'the published rate leaked into a wholesale confirmation');
});

test('and an ordinary confirmation is unchanged', () => {
  const customer = { ...ORDINARY, name: 'Carl', preferences: {} };
  const text = booking.confirmationMessage(customer, ORDER());

  assert.match(text, /\$2\.00 a pound/);
  assert.match(text, new RegExp(`\\$${(config.pricing.minimumCents / 100).toFixed(2)} minimum`));
});

test('THE MINIMUM IN THAT SENTENCE IS READ OFF THE ORDER', () => {
  const body = code(bodyOf(SRC('core', 'booking.js'), 'function confirmationMessage('));
  assert.match(body, /order\.minimum_cents/, 'the confirmation still reads config for the floor');
});

// --- what the AI is told ----------------------------------------------------

test('THE MODEL IS TOLD THIS BEATS THE LOCKED FACTS', () => {
  // THE FACTS, LOCKED says $2.00, $1.80 and a $25 minimum, and a model handed a
  // block headed LOCKED will quote it. So the override belongs in the notes
  // about THAT customer, and it has to name what it overrides.
  const src = code(SRC('core', 'brain.js'));
  assert.match(src, /wholesale\.isWholesale\(customer\)/, 'the notes never mention an agreed rate');
  assert.match(src, /THE FACTS, LOCKED - never quote those/, 'the override does not say it wins');
});

test('AND THE SENTENCE IT IS HANDED IS WRITTEN ONCE', () => {
  assert.equal(
    wholesale.describe(BRIS),
    'Wholesale account: $1.00 a pound on every order, no order minimum, and no promotions or discounts.'
  );
  assert.equal(wholesale.describe(ORDINARY), null);

  // Nobody writes a second copy of it.
  for (const file of [
    ['core', 'brain.js'],
    ['routes', 'admin.js'],
    ['core', 'actions.js'],
  ]) {
    assert.ok(
      !/a pound on every order/.test(code(SRC(...file))),
      `${file.join('/')} writes its own copy of the wholesale sentence`
    );
  }
});
