'use strict';

// ---------------------------------------------------------------------------
// THE SUBSCRIPTION OFFER AFTER THE FIRST PAID DELIVERY, AND THE DELIVERY TEXT.
//
// Neil's locked rules, 21 September:
//
//   - After the first paid delivery, if they have no subscription, send
//     exactly: "Would you like to set up a subscription for every week, every
//     2 weeks, or once a month? Subscription orders are $1.80/lb instead of
//     $2.00/lb."
//   - A separate message. Once. Never if they already have a plan. Never after
//     a waived or free delivery. A first PAID delivery that follows free ones
//     still counts.
//   - The delivery text says the laundry is at the door and carries the photo
//     link. No "same day", no "same day, no extra charge".
//
// The decision is pure (subscription.offerAfterDelivery) and is tested as
// behaviour. The wiring in fulfilment.js needs a database, so it is read.
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const subscription = require('../src/core/subscription');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const NEIL =
  'Would you like to set up a subscription for every week, every 2 weeks, or once a month? ' +
  'Subscription orders are $1.80/lb instead of $2.00/lb.';

const firstPaid = { paid: true, paidDeliveries: 1, hasPlan: false, planOrder: false, quiet: false };

// --- the words --------------------------------------------------------------

test('the offer is Neil\'s sentence, exactly', () => {
  assert.equal(subscription.postDeliveryOffer(), NEIL);
});

test('it fits in one segment of plain text', () => {
  const text = subscription.postDeliveryOffer();
  assert.ok(text.length <= 160, `${text.length} characters`);
  assert.ok(/^[\x20-\x7E]*$/.test(text), 'a character outside plain ASCII would triple the cost');
});

// --- when it goes -----------------------------------------------------------

test('the first paid delivery with no plan gets it', () => {
  const verdict = subscription.offerAfterDelivery(firstPaid);
  assert.equal(verdict.send, true);
  assert.equal(verdict.text, NEIL);
});

test('a free or waived delivery never does', () => {
  // Free and waived orders are $0 or WAIVED, and deliver() reads both as not
  // paid before this is ever asked.
  assert.equal(subscription.offerAfterDelivery({ ...firstPaid, paid: false }).send, false);
});

test('once: the second paid delivery never gets it', () => {
  assert.equal(subscription.offerAfterDelivery({ ...firstPaid, paidDeliveries: 2 }).send, false);
  assert.equal(subscription.offerAfterDelivery({ ...firstPaid, paidDeliveries: 7 }).send, false);
});

test('never to somebody who already has a plan', () => {
  assert.equal(subscription.offerAfterDelivery({ ...firstPaid, hasPlan: true }).send, false);
});

test('never after a pickup that was itself on a plan', () => {
  assert.equal(subscription.offerAfterDelivery({ ...firstPaid, planOrder: true }).send, false);
});

// NEIL, 21 SEPTEMBER: "Do not skip the subscription ask after 9pm. Send it
// with delivery or first thing next morning." This test used to pin a skip.
test('in quiet hours it is deferred to the morning, never dropped', () => {
  const verdict = subscription.offerAfterDelivery({ ...firstPaid, quiet: true });
  assert.equal(verdict.send, false, 'a sales question went out in quiet hours');
  assert.equal(verdict.defer, true, 'a late delivery dropped the question for good');
});

test('every other refusal still wins over quiet hours', () => {
  for (const not of [{ paid: false }, { hasPlan: true }, { planOrder: true }, { paidDeliveries: 2 }]) {
    const verdict = subscription.offerAfterDelivery({ ...firstPaid, ...not, quiet: true });
    assert.equal(verdict.send, false, JSON.stringify(not));
    assert.ok(!verdict.defer, `deferred something that should never go: ${JSON.stringify(not)}`);
  }
});

test('nothing at all passed is nothing sent', () => {
  assert.equal(subscription.offerAfterDelivery().send, false);
});

// --- the wiring -------------------------------------------------------------

function deliverSource() {
  const src = withoutComments(SRC('core', 'fulfilment.js'));
  const at = src.indexOf('async function deliver(');
  return src.slice(at, src.indexOf('\nasync function ', at + 10));
}

// The facts, the send and the morning sweep live in subscription-offer.js,
// which fulfilment.deliver() and scheduler.tick() both call.
function offerSource() {
  return withoutComments(SRC('core', 'subscription-offer.js'));
}

test('deliver() sends the offer as its own message, after the delivery', () => {
  const fn = deliverSource();
  const stepAt = fn.indexOf("step(order, 'DELIVERED'");
  // The end of the step() call - the builder closes and `by` is passed.
  const stepEnds = fn.indexOf('}, by);', stepAt);
  const offerAt = fn.indexOf('offerSubscription(');
  assert.ok(stepAt > 0 && stepEnds > stepAt, 'deliver() no longer moves the order');
  assert.ok(offerAt > stepEnds, 'the offer has to come after the delivery step, not inside or before it');
  assert.ok(offerAt > fn.indexOf('if (!result.ok) return result;'), 'a refused delivery would still get the offer');
});

test('a paid delivery after free ones is still the first PAID one', () => {
  // This is the query, not the pure rule: free and waived orders are $0 or
  // WAIVED, so they never enter the count and the first paid one counts one.
  const fn = offerSource();
  const q = fn.slice(fn.indexOf(".from('orders')"), fn.indexOf('paidDeliveries = (rows'));
  assert.ok(q.length > 0, 'the count query moved; point this test at it');
  assert.ok(/\.gt\('price_cents', 0\)/.test(q) && /\.eq\('payment_status', 'PAID'\)/.test(q), q);
  assert.equal(subscription.offerAfterDelivery({ ...firstPaid, paidDeliveries: 1 }).send, true);
});

test('the delivery text carries no offer and no "same day"', () => {
  const fn = deliverSource();
  assert.ok(!/same day/i.test(fn), 'same-day wording is back in the delivery text');
  assert.ok(!/regular thing/i.test(fn), 'the old offer is back on the end of the delivery text');
  assert.ok(!/every other week/i.test(fn), 'the two-frequency offer is back');
});

test('the delivery text says the laundry is at the door, with the photo', () => {
  const fn = deliverSource();
  assert.ok(/Your laundry is at your door\./.test(fn), 'the door sentence is gone');
  assert.ok(/Photo: \$\{photoUrl\}/.test(fn), 'the photo link is gone');
  // The link follows the door sentence and nothing runs on after it.
  assert.ok(/\$\{opener\}\$\{photo\}/.test(fn), 'the photo is not beside the door sentence');
});

test('"first paid" is counted off the orders: delivered, paid and over $0', () => {
  const fn = offerSource();
  assert.ok(fn.includes(".eq('status', 'DELIVERED')"), fn);
  assert.ok(fn.includes(".eq('payment_status', 'PAID')"), fn);
  assert.ok(fn.includes(".gt('price_cents', 0)"), 'a free order would count as paid');
  assert.ok(/payment_status === 'PAID' && Number\(order\.price_cents\) > 0/.test(fn), 'this delivery is not checked for being paid');
});

test('it asks the pure rule, and every fact the rule needs', () => {
  const fn = offerSource();
  assert.ok(fn.includes('subscription.offerAfterDelivery('), fn);
  for (const fact of ['paid', 'paidDeliveries', 'hasPlan', 'planOrder:', 'quiet:']) {
    assert.ok(fn.includes(fact), `${fact} is not passed`);
  }
  assert.ok(fn.includes('recurring.forCustomer('), 'an existing plan is never looked for');
  assert.ok(fn.includes("require('./scheduler').inQuietHours("), 'quiet hours are not checked');
  // Judged by when the van was at the door, so the daytime path and the
  // morning sweep cannot disagree about a delivery at 8:59pm.
  assert.ok(fn.includes('serviceClockOf((order && order.delivered_at)'), 'quiet hours are judged by the clock, not the delivery');
});

test('it is a SYSTEM message, so it earns no follow-up chase', () => {
  assert.ok(/sendAndLog\([^)]*kind: 'SYSTEM'/.test(offerSource()));
});

test('a person working the thread is not talked over', () => {
  assert.ok(offerSource().includes('aiPause.isPaused('), 'it would sell a plan in the middle of a hand-run conversation');
});

test('it can never break a delivery', () => {
  const fn = offerSource();
  const after = fn.slice(fn.indexOf('async function afterDelivery('), fn.indexOf('const LOOKBACK_HOURS'));
  assert.ok(/try \{[\s\S]*\} catch \(err\) \{/.test(after), 'an error would escape into deliver()');
});

// --- the morning send -------------------------------------------------------

const subscriptionOffer = require('../src/core/subscription-offer');

// 01:30 UTC on the 22nd is 9:30pm on the 21st in New Jersey; 14:00 UTC is 10am.
const NIGHT = '2026-09-22T01:30:00Z';
const DAY = '2026-09-21T14:00:00Z';

test('a delivery in quiet hours is picked up by the morning sweep', () => {
  assert.equal(subscriptionOffer.isDeferred({ delivered_at: NIGHT }, { now: new Date('2026-09-22T12:05:00Z') }), true);
});

test('a daytime delivery never is - it was asked, or refused, at the door', () => {
  assert.equal(subscriptionOffer.isDeferred({ delivered_at: DAY }, { now: new Date('2026-09-22T12:05:00Z') }), false);
});

test('the sweep never reaches back past a night', () => {
  assert.equal(subscriptionOffer.isDeferred({ delivered_at: NIGHT }, { now: new Date('2026-09-24T12:05:00Z') }), false);
  assert.equal(subscriptionOffer.isDeferred({}, { now: new Date() }), false);
});

test('the scheduler runs the sweep after the quiet-hours check, so it is first thing', () => {
  const src = withoutComments(SRC('core', 'scheduler.js'));
  const tick = src.slice(src.indexOf('async function tick('));
  const quiet = tick.indexOf('if (inQuietHours(when)) return { quiet: true };');
  const sweep = tick.indexOf('subscriptionOffer');
  assert.ok(quiet > 0 && sweep > quiet, 'the sweep could run at night');
});

test('the sweep asks everything again at send time and sends once', () => {
  const fn = offerSource();
  const due = fn.slice(fn.indexOf('async function sendDue('));
  assert.ok(due.includes('subscription.offerAfterDelivery(await factsFor('), 'the rule is not re-asked in the morning');
  assert.ok(due.includes('alreadyAsked(customer.phone, order.delivered_at)'), 'nothing stops it sending on every tick');
  // Its select carries every column the rule reads. An unselected column is
  // undefined, which the rule would read as "not paid" or "no plan".
  //
  // THE SELECT ITSELF, NOT THE FUNCTION. Every one of these names also appears
  // in the filters below it, so a test that searched the whole body passed with
  // all four missing from the select - found in review.
  const sel = (due.match(/\.select\('([^']*)'\)/) || [])[1] || '';
  const cols = sel.split(',').map((s) => s.trim());
  for (const col of ['payment_status', 'price_cents', 'subscription_id', 'delivered_at']) {
    assert.ok(cols.includes(col), `the sweep does not select ${col}: ${sel}`);
  }
});

test('the question says what it asked, which is what stops a second one', () => {
  assert.ok(/askedFor: 'service_type'/.test(offerSource()));
});

test('the leaf module reaches back into neither of its callers', () => {
  const src = offerSource();
  assert.ok(!/require\('\.\/fulfilment'\)/.test(src), 'a loop through fulfilment.js');
  // The scheduler is required only inside a function, never at load.
  const top = src.split('\n').filter((l) => /^const .*require\(/.test(l)).join('\n');
  assert.ok(!/scheduler/.test(top), 'scheduler.js required at load: a loop through the scheduler');
});
