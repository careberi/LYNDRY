'use strict';

// ---------------------------------------------------------------------------
// A SUBSCRIBER IS NEVER TOLD $2.00.
//
// Found by an outside audit, 16 September, and it was real. Every text that
// named a price per pound built it from `site.pricePerLb` - which is
// config.pricing.perPoundCents, the ONE-TIME rate - while the arithmetic
// beside it was built from `order.price_per_lb_cents`, which is $1.80 on a
// subscription.
//
// So a subscriber weighed at 38 lb was charged 38 x $1.80 = $68.40 and texted
// "$68.40 at $2.00 a pound". The money was right. The sentence was wrong, and
// it was wrong on the one message that tells somebody what has just left their
// account - where the arithmetic is visibly broken to anybody who checks it.
//
// CLAUDE.md already carries the instruction that caught this: "if the charge
// point moves again, grep for 'a pound'". Four sentences had been fixed that
// way when the charge MOMENT moved. This is the same grep after the RATE
// moved, which is why the rule below is about where a number comes from rather
// than about any one sentence:
//
//   A MESSAGE ABOUT AN ORDER READS THAT ORDER'S RATE.
//   A message about the business in general may name the one-time rate,
//   because somebody with no order pays it.
//
// Nothing here touches the database, Stripe or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const subscription = require('../src/core/subscription');
const { config } = require('../src/config');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// --- the shape of the fix ---------------------------------------------------

test('THE RATE IN A MESSAGE COMES FROM THE ORDER, NEVER FROM site', () => {
  // The four sentences that were wrong, and the one place they read a rate now.
  // Checked against the source because these are built inside functions that
  // charge cards and send texts, and a test that called them would do both.
  const fulfilment = withoutComments(SRC('core', 'fulfilment.js'));

  // Not one `site.pricePerLb` survives in a message in this file.
  assert.ok(
    !/site\.pricePerLb/.test(fulfilment),
    'fulfilment.js still builds a message from the one-time rate'
  );

  // And the helper that replaced it reads the order.
  assert.match(fulfilment, /function perPoundOf\(order\)/);
  assert.match(fulfilment, /order\.price_per_lb_cents\) \|\| config\.pricing\.perPoundCents/);
});

test('and the card ask reads it off the order the booking just made', () => {
  // This one is sent seconds after a pickup is booked, to somebody deciding
  // whether to hand over a card. A subscriber was quoted $2.00 in it.
  const actions = withoutComments(SRC('core', 'actions.js'));

  assert.match(actions, /result\.order && result\.order\.price_per_lb_cents/);

  // The card sentence no longer names the one-time rate.
  const at = actions.indexOf('const money = result.freeOrder');
  assert.notEqual(at, -1, 'the card ask has moved');
  const block = actions.slice(at, at + 600);
  assert.ok(!/site\.pricePerLb/.test(block), 'the card ask still quotes the one-time rate');
});

// --- what the customer actually reads ---------------------------------------

test('THE TWO RATES RENDER AS ENGLISH, AND NEVER AS "$1.80/lb a pound"', () => {
  // subscription.js keeps two shapes for one number precisely because mixing
  // them produced that string the first time. The message sites use perPound.
  assert.equal(subscription.perPound(180), '$1.80 a pound');
  assert.equal(subscription.perPound(200), '$2.00 a pound');

  // The label shape stays out of sentences.
  assert.equal(subscription.rate(180), '$1.80/lb');
  assert.ok(!subscription.perPound(180).includes('/lb'));
});

test('a subscription order and a one-time order quote different rates', () => {
  // The bug in one assertion: these two must not produce the same sentence.
  const sub = subscription.perPound(180);
  const once = subscription.perPound(config.pricing.perPoundCents);

  assert.notEqual(sub, once);
  assert.match(sub, /1\.80/);
  assert.match(once, /2\.00/);
});

test('AND THE ARITHMETIC AGREES WITH THE WORDS', () => {
  // What made this reportable rather than cosmetic: the sum in the message did
  // not work. 38 lb charged at $1.80 is $68.40, and "at $2.00 a pound" beside
  // it is arithmetic a customer can see is wrong.
  const weight = 38;

  for (const cents of [180, 200]) {
    const total = Math.round(weight * cents);
    const said = subscription.perPound(cents);
    const rateFromWords = Number(said.match(/\$(\d+\.\d\d)/)[1]) * 100;

    assert.equal(
      Math.round(weight * rateFromWords),
      total,
      `${weight} lb at ${said} does not come to ${(total / 100).toFixed(2)}`
    );
  }
});

// --- and the rate survives the trip to the order ----------------------------

test('A SUBSCRIPTION PICKUP IS WRITTEN AT $1.80 AND AN EXTRA ONE IS NOT', () => {
  // The other half of the audit's report - that an auto-booked pickup could
  // lose its plan and revert to $2.00 - rests on this, and it holds: the rate
  // is decided by the subscription the pickup belongs to, at the moment the
  // row is written.
  assert.equal(subscription.rateForCents('a-plan-id'), 180);
  assert.equal(subscription.rateForCents(null), 200);
});

test('and the nightly pass hands the plan down to the order it books', () => {
  // recurring.bookDue -> booking.bookPickup -> orders.create, and the id has to
  // survive all three. A break anywhere in that chain prices a subscriber's
  // pickup as a one-time without anything failing loudly.
  const recurring = withoutComments(SRC('core', 'recurring.js'));
  const booking = withoutComments(SRC('core', 'booking.js'));
  const orders = withoutComments(SRC('core', 'orders.js'));

  assert.match(recurring, /subscriptionId: schedule\.id/, 'the nightly pass stopped passing the plan');
  assert.match(booking, /subscriptionId: subscriptionId \|\| null/, 'bookPickup stopped forwarding it');
  assert.match(orders, /subscription_id: subscriptionId \|\| null/, 'create stopped writing it');
  assert.match(
    orders,
    /price_per_lb_cents: subscription\.rateForCents\(subscriptionId\)/,
    'create stopped pricing off the plan'
  );

  // AND THE QUERY SELECTS IT. An unselected column reads as undefined, which
  // is indistinguishable from "no subscription" - so the whole chain above
  // would run correctly and still write $2.00. This is the trap CLAUDE.md
  // records a dozen times, and it is the only way the audit's claim could
  // have been true.
  const due = recurring.slice(recurring.indexOf('async function dueOn'));
  const query = due.slice(due.indexOf("from('recurring_schedules')"), due.indexOf('if (error) throw error;'));
  assert.match(query, /select\('\*/, 'dueOn stopped selecting the schedule id');
});

// --- what is deliberately left alone ----------------------------------------

test('A MESSAGE WITH NO ORDER BEHIND IT STILL NAMES THE ONE-TIME RATE', () => {
  // Not every $2.00 is a bug, and blanket-replacing them would have been the
  // wrong fix. Somebody who has never booked anything pays $2.00, so the
  // introduction, the AI's answer to "what does it cost" and the first card
  // ask are all correct as they stand. They are about the business, not about
  // an order.
  const onboarding = withoutComments(SRC('core', 'onboarding.js'));
  assert.match(onboarding, /site\.pricePerLb/, 'the introduction stopped naming a rate at all');

  // The card-page authorization text has a customer and no order, so it stays
  // general too.
  const billing = withoutComments(SRC('core', 'billing.js'));
  assert.match(billing, /function consentText/);
});
