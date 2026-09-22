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

test('never in quiet hours - it is the one unprompted sales text', () => {
  assert.equal(subscription.offerAfterDelivery({ ...firstPaid, quiet: true }).send, false);
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

function offerSource() {
  const src = withoutComments(SRC('core', 'fulfilment.js'));
  const at = src.indexOf('async function offerSubscription(');
  return src.slice(at, src.indexOf('\nasync function ', at + 10));
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
  assert.ok(/payment_status === 'PAID' && Number\(delivered\.price_cents\) > 0/.test(fn), 'this delivery is not checked for being paid');
});

test('it asks the pure rule, and every fact the rule needs', () => {
  const fn = offerSource();
  assert.ok(fn.includes('subscription.offerAfterDelivery('), fn);
  for (const fact of ['paid', 'paidDeliveries', 'hasPlan', 'planOrder:', 'quiet:']) {
    assert.ok(fn.includes(fact), `${fact} is not passed`);
  }
  assert.ok(fn.includes('recurring.forCustomer('), 'an existing plan is never looked for');
  assert.ok(fn.includes('scheduler.inQuietHours('), 'quiet hours are not checked');
});

test('it is a SYSTEM message, so it earns no follow-up chase', () => {
  assert.ok(/sendAndLog\([^)]*kind: 'SYSTEM'/.test(offerSource()));
});

test('a person working the thread is not talked over', () => {
  assert.ok(offerSource().includes('aiPause.isPaused('), 'it would sell a plan in the middle of a hand-run conversation');
});

test('it can never break a delivery', () => {
  const fn = offerSource();
  assert.ok(/try \{[\s\S]*\} catch \(err\) \{/.test(fn), 'an error would escape into deliver()');
});
