'use strict';

// ---------------------------------------------------------------------------
// NO CARD MEANS NO REMINDER.
//
// Neil, 14 September: "reminders must use dispatch.collectable() so no-card
// orders get no night-before text and do not show PICKUP REMINDER SCHEDULED."
//
// dispatch.collectable() took an unbillable order off the driver's route on 13
// September, and nothing in reminders.js read it. So the van was not coming and
// the customer was still being told to have the bag out - which is worse than
// silence, because they act on it. #2063 was the live case.
//
// TWO HALVES ARE PINNED HERE AND THE SECOND ONE IS THE DANGEROUS HALF.
//
//   1. The gate itself: no card, no reminder; a card, a reminder; waived, a
//      reminder.
//   2. THE SELECT LISTS. collectable() reads orders.payment_status and the
//      customer's stripe_customer_id / default_payment_method_id. An unselected
//      column comes back undefined, which is indistinguishable from an absent
//      card - so a query that forgets them does not fail loudly, it silently
//      answers "no card" for EVERYBODY and cancels every reminder in the
//      system. That trap has bitten five times in this codebase; these tests
//      read the source so it cannot come back quietly.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const reminders = require('../src/core/reminders');
const dispatch = require('../src/core/dispatch');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'reminders.js'), 'utf8');

const withCard = { stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_1' };
const noCard = { stripe_customer_id: 'cus_1', default_payment_method_id: null };

// --- the gate ---------------------------------------------------------------

test('IT IS THE ROUTE’S OWN FUNCTION, not a second copy of the rule', () => {
  // The whole point. If these ever answer differently, a customer is told to
  // put a bag out for a van that is not coming.
  for (const order of [
    { payment_status: 'UNPAID', customers: withCard },
    { payment_status: 'UNPAID', customers: noCard },
    { payment_status: 'WAIVED', customers: noCard },
    { payment_status: 'PAID', customers: withCard },
  ]) {
    assert.equal(reminders.collectable(order), dispatch.collectable(order), JSON.stringify(order));
  }
});

test('no card on file is not reminded', () => {
  assert.equal(reminders.collectable({ payment_status: 'UNPAID', customers: noCard }), false);
});

test('a card on file is reminded', () => {
  assert.equal(reminders.collectable({ payment_status: 'UNPAID', customers: withCard }), true);
});

test('A WAIVED ORDER IS STILL REMINDED, card or no card', () => {
  // Nothing to charge is not the same as cannot charge. The van IS coming, so
  // the bag has to be out. Getting this backwards would strand exactly the
  // customers we have decided to do a favour for.
  assert.equal(reminders.collectable({ payment_status: 'WAIVED', customers: noCard }), true);
  assert.equal(reminders.collectable({ payment_status: 'WAIVED', customers: withCard }), true);
});

test('a half-saved customer is not a card', () => {
  // A Stripe customer exists the moment somebody opens the card page and
  // abandons it. #2063 had one. Reading that as a saved card is how she would
  // have been reminded anyway.
  assert.equal(
    reminders.collectable({ payment_status: 'UNPAID', customers: { stripe_customer_id: 'cus_1' } }),
    false
  );
  assert.equal(
    reminders.collectable({ payment_status: 'UNPAID', customers: { default_payment_method_id: 'pm_1' } }),
    false
  );
});

test('a missing customer is refused rather than crashing the night’s pass', () => {
  assert.equal(reminders.collectable({ payment_status: 'UNPAID' }), false);
  assert.equal(reminders.collectable(null), false);
});

// --- the select lists, which are the half that fails silently ---------------

// Everything between `.from('orders')` and the end of that query.
function queryFor(fnName) {
  const at = SOURCE.indexOf(`async function ${fnName}(`);
  assert.notEqual(at, -1, `${fnName} not found in reminders.js`);
  const from = SOURCE.indexOf(".from('orders')", at);
  assert.notEqual(from, -1, `${fnName} does not query orders`);
  return SOURCE.slice(from, SOURCE.indexOf('if (error) throw error;', from));
}

test('ALL THREE QUERIES CARRY WHAT collectable() READS', () => {
  // Forgetting one of these does not throw. It answers "no card" for every
  // order and silently cancels every reminder in the system, which is a worse
  // outcome than the bug being fixed.
  for (const fn of ['sendDue', 'pendingFor', 'allPending']) {
    const q = queryFor(fn);
    assert.ok(/payment_status|CARD_FIELDS/.test(q), `${fn} does not select payment_status`);
    assert.ok(
      /stripe_customer_id|CUSTOMER_CARD_FIELDS/.test(q),
      `${fn} does not select the customer's card fields`
    );
  }
});

test('pendingFor() loads a customer at all, which it did not before', () => {
  // It selected order columns only, so collectable() would have been handed a
  // row with no customer on it and answered false for everybody.
  assert.match(queryFor('pendingFor'), /customers\s*\(/);
});

test('THE THREE FUNCTIONS ARE ALL GATED, not just the one that sends', () => {
  // A badge that promises a text nobody will send is the same failure in a
  // quieter place: sendDue texts, pendingFor draws "PICKUP REMINDER SCHEDULED"
  // in the thread, allPending fills /ops/scheduled.
  for (const fn of ['sendDue', 'pendingFor', 'allPending']) {
    const at = SOURCE.indexOf(`async function ${fn}(`);
    const body = SOURCE.slice(at, SOURCE.indexOf('\n}\n', at));
    assert.ok(/collectable\(/.test(body), `${fn} never calls collectable()`);
  }
});

test('the fields are one constant, not typed out three times', () => {
  // Three copies would drift, and the drift is invisible until every reminder
  // in the system stops.
  assert.equal(reminders.CARD_FIELDS, 'payment_status');
  assert.match(reminders.CUSTOMER_CARD_FIELDS, /stripe_customer_id/);
  assert.match(reminders.CUSTOMER_CARD_FIELDS, /default_payment_method_id/);
});

// --- what this change deliberately does NOT do ------------------------------

test('a skipped order is not stamped, so a card arriving later can still earn one', () => {
  // reminder_sent_at means "we sent it". Stamping an order we deliberately said
  // nothing about would mean nobody is ever reminded, even if the card lands an
  // hour later and the pass runs again.
  const at = SOURCE.indexOf("reason: 'no card on file'");
  assert.notEqual(at, -1, 'the skip reason is not there');
  const around = SOURCE.slice(at - 600, at + 200);
  assert.ok(!/reminder_sent_at/.test(around), 'a stamp crept into the no-card skip');
});

test('nothing about the timing, the wording or quiet hours moved', () => {
  // The scope was the gate. Anything else changing here is out of this branch.
  assert.equal(reminders.JUST_BOOKED_HOURS, 3);
  const body = reminders.reminderMessage({
    order_number: 2063,
    pickup_date: '2026-09-14',
    pickup_window_start: '08:00:00',
    pickup_window_end: '10:00:00',
    preferences: {},
  });
  assert.match(body, /tomorrow/i);
  assert.ok(!/card|payment|pay/i.test(body), 'the reminder started talking about money');
});
