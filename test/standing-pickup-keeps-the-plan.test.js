'use strict';

// ---------------------------------------------------------------------------
// EVERY DOOR THAT BOOKS OFF A SCHEDULE PASSES THE SCHEDULE'S ID.
//
// Shamar Allen, 17 September. His arrangement - every 2 weeks on Saturday at
// 1pm - is a subscription, and the pickup it had already booked, #2061, was
// written at $2.00 a pound with no plan on it. One order is fixed by editing a
// row. The next one is fixed by this rule.
//
// THERE ARE TWO DOORS AND ONLY ONE OF THEM WAS KEEPING IT:
//
//   recurring.bookDue()   the nightly pass, the evening before
//   recurring.bookNext()  fired by fulfilment.collect() the moment the
//                         previous pickup goes in the van, days earlier
//
// bookNext() gets there first almost every time, and dueOn() then skips the day
// because a pickup already exists - so the door that did pass the plan was the
// one that hardly ever ran, and every second, third and fourth pickup a
// subscriber had was written as a one-time.
//
// NOTHING FAILED WHEN IT WAS WRONG. orders.create() reads
// subscription.rateForCents(subscriptionId); null is a perfectly good answer
// meaning $2.00. The row is created, the board is happy, the round is
// unchanged, and the only symptom is a card charged 10% too much at a door -
// by which point orders.price_per_lb_cents has been snapshotted and the order
// keeps the wrong rate until somebody edits it.
//
// AND THE TEST THAT SHOULD HAVE CAUGHT IT MATCHED THE WHOLE FILE.
// subscription-rate-in-texts.js asserted the plan was passed by searching all
// of recurring.js, which bookDue() satisfied on its own - so it was green on
// the day bookNext() was written and green every day since. The same shape as
// the CARD_FIELDS test CLAUDE.md records, which asserted a constant EQUALLED
// one column name and passed on the day the rule changed. The fix in both
// cases is to assert against the thing the rule is about - here a function
// body, and a LIST of them, so a third door cannot ride on the first one's
// line.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const recurring = require('../src/core/recurring');
const subscription = require('../src/core/subscription');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

// The body of one function, comments stripped, so an assertion cannot match its
// own explanation.
function bodyOf(src, signature) {
  const at = src.indexOf(signature);
  assert.notEqual(at, -1, `${signature} has moved`);
  const end = src.indexOf('\n}\n', at);
  assert.notEqual(end, -1, `could not find the end of ${signature}`);

  return src
    .slice(at, end)
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

// Both of them, by name. A door added later has to be added here too, which is
// the only part of this that stops the next version of the same bug.
const DOORS = ['async function bookDue(', 'async function bookNext('];

// --- the rule ----------------------------------------------------------------

test('EVERY DOOR THAT BOOKS OFF A SCHEDULE PASSES THE PLAN', () => {
  const src = SRC('core', 'recurring.js');

  for (const door of DOORS) {
    assert.match(
      bodyOf(src, door),
      /subscriptionId: schedule\.id/,
      `${door} does not pass the plan, so the pickups it books are $2.00`
    );
  }
});

test('and the id it passes is actually loaded', () => {
  // An unselected column reads as undefined, which is indistinguishable from
  // "no subscription" - so the whole chain above would run correctly and still
  // write $2.00. CLAUDE.md records this trap biting eleven times.
  const src = SRC('core', 'recurring.js');

  // bookNext reads its schedules from forCustomer(); bookDue from dueOn().
  for (const fn of ['async function forCustomer(', 'async function dueOn(']) {
    assert.match(bodyOf(src, fn), /select\('\*/, `${fn} stopped selecting the schedule id`);
  }
});

test('NEITHER DOOR PRICES ANYTHING ITSELF', () => {
  // subscription.rateForCents() is the only thing allowed to decide a rate, and
  // it is called once, in orders.create(). A door that wrote its own would be a
  // second rule, free to disagree.
  const src = SRC('core', 'recurring.js');

  for (const door of DOORS) {
    assert.ok(
      !/price_per_lb_cents/.test(bodyOf(src, door)),
      `${door} writes a rate of its own`
    );
  }

  assert.match(
    SRC('core', 'orders.js'),
    /price_per_lb_cents: subscription\.rateForCents\(subscriptionId\)/,
    'create() stopped pricing off the plan'
  );
});

test('a plan gives $1.80 and no plan gives $2.00', () => {
  assert.equal(subscription.rateForCents('a-plan-id'), 180);
  assert.equal(subscription.rateForCents(null), 200);
});

// --- the arrangement it was found on -----------------------------------------

test("Shamar's fortnightly Saturdays are the case this was found on", () => {
  // #2061 is 2026-09-26. bookNext() counts from the day AFTER the pickup it has
  // just collected, so it is that call on the 26th - not the nightly pass on
  // 9 October - that creates the pickup on the 10th.
  const his = {
    status: 'ACTIVE',
    cadence: 'FORTNIGHTLY',
    weekday: 6,
    started_on: '2026-09-12',
    time_of_day: '13:00',
    paused_until: null,
  };

  assert.equal(recurring.nextDate(his, '2026-09-27'), '2026-10-10');
  assert.equal(recurring.describe(his), 'every other week on Saturday at 1pm');
  assert.equal(subscription.frequencyLabel(his.cadence), 'every 2 weeks');
});
