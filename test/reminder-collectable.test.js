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

// Everything from a function's opening line to the start of the next one.
function bodyOf(fnName) {
  const at = SOURCE.indexOf(`async function ${fnName}(`);
  assert.notEqual(at, -1, `${fnName} not found in reminders.js`);
  const next = SOURCE.indexOf('async function ', at + 20);
  return SOURCE.slice(at, next === -1 ? SOURCE.length : next);
}

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
  //
  // IT IS routableCheck() AND NOT collectable(), which is Grok's finding of 14
  // September. No card is only ONE of the two reasons the van is not coming.
  // The other is the sibling block, and a customer parked behind their own
  // unpaid order was still being told to have the bag out in the morning.
  for (const fn of ['sendDue', 'pendingFor', 'allPending']) {
    const body = bodyOf(fn);
    assert.ok(body.includes('routableCheck('), `${fn} never calls routableCheck()`);
    assert.ok(body.includes('routable('), `${fn} never applies the predicate`);
  }
});

test('ROUTABLE IS THE SAME FUNCTION THE ROUTE USES, not a second copy', () => {
  // The whole finding in one assertion. If this file ever grows its own version
  // of "a card, and nothing outstanding", this is what catches it.
  assert.equal(reminders.routableCheck, dispatch.routableCheck);
});

test('ALL THREE QUERIES CARRY customer_id, which the sibling half groups on', () => {
  // SEVENTH TIME. Unselected, customer_id is undefined on every row, so the set
  // of held customers is built out of nothing, nobody is blocked, and this gate
  // silently does half its job. It does not throw and nothing looks wrong.
  for (const fn of ['sendDue', 'pendingFor', 'allPending']) {
    assert.match(queryFor(fn), /customer_id/, `${fn} does not select customer_id`);
  }
});

test('with nobody held, routable IS collectable - so a waived order still gets one', async () => {
  // routableCheck() short-circuits on an empty list, so this reaches no
  // database. What it pins is the composition: the sibling half must never
  // change the answer for somebody who is holding nothing of ours.
  const routable = await reminders.routableCheck([]);
  for (const order of [
    { payment_status: 'UNPAID', customers: withCard },
    { payment_status: 'UNPAID', customers: noCard },
    { payment_status: 'WAIVED', customers: noCard },
  ]) {
    assert.equal(routable(order), dispatch.collectable(order), JSON.stringify(order));
  }
});

test('the fields are one constant, not typed out three times', () => {
  // Three copies would drift, and the drift is invisible until every reminder
  // in the system stops.
  assert.match(reminders.CARD_FIELDS, /payment_status/);
  assert.match(reminders.CUSTOMER_CARD_FIELDS, /stripe_customer_id/);
  assert.match(reminders.CUSTOMER_CARD_FIELDS, /default_payment_method_id/);
});

// --- the reminder explains the pending charge -------------------------------

test('THE REMINDER SAYS WHAT IS ON HOLD, because it is the only message that can', () => {
  // The hold is placed by the night-before pass minutes before this goes out. A
  // booking made a fortnight ago was confirmed before any hold existed, so its
  // confirmation could not mention one - this text is the first and only chance
  // to explain the pending charge they are about to see.
  const body = reminders.reminderMessage({
    pickup_date: '2026-09-16',
    pickup_window_start: '17:00',
    pickup_window_end: '21:00',
    pickup_method: 'LEAVE_OUTSIDE',
    authorization_intent_id: 'pi_1',
    authorized_cents: 2500,
  });

  assert.match(body, /\$25\.00 is on hold/);
  assert.match(body, /real total at the door/);
});

test('AND SAYS NOTHING WHEN THERE IS NO HOLD', () => {
  // Read off the order, so a waived order, a free one and any pickup whose hold
  // was deferred get no sentence without anybody having to remember them.
  for (const order of [
    { pickup_date: '2026-09-16', pickup_method: 'LEAVE_OUTSIDE' },
    { pickup_date: '2026-09-16', pickup_method: 'LEAVE_OUTSIDE', payment_status: 'WAIVED' },
    // Captured or released: the id is cleared, so there is nothing held.
    { pickup_date: '2026-09-16', pickup_method: 'LEAVE_OUTSIDE', authorized_at: 'x', captured_cents: 2500 },
  ]) {
    assert.ok(!/hold/i.test(reminders.reminderMessage(order)), JSON.stringify(order));
  }
});

test('the amount is read off the order, never assumed from config', () => {
  // Two copies of one number disagree the day the amount moves, and this one is
  // printed on a customer's statement beside ours.
  const body = reminders.reminderMessage({
    pickup_date: '2026-09-16',
    pickup_method: 'LEAVE_OUTSIDE',
    authorization_intent_id: 'pi_1',
    authorized_cents: 1500,
  });

  assert.match(body, /\$15\.00 is on hold/);
  assert.ok(!/\$25\.00/.test(body));
});

test('A STANDING ORDER STILL FITS IN TWO SEGMENTS WITH IT', () => {
  // That reminder already carries the SKIP line. This sentence plus that one
  // plus a long dropoff spot lands a couple of characters inside the ceiling,
  // which is why the wording was measured rather than chosen - a third segment
  // on every standing-order reminder is real money, every week, for ever.
  const worst = reminders.reminderMessage({
    pickup_date: '2026-09-16',
    pickup_window_start: '17:00',
    pickup_window_end: '21:00',
    pickup_method: 'LEAVE_OUTSIDE',
    from_schedule: true,
    preferences: { special_instructions: 'side door by the garage' },
    authorization_intent_id: 'pi_1',
    authorized_cents: 2500,
  });

  assert.match(worst, /SKIP/);
  assert.match(worst, /is on hold/);
  assert.ok(worst.length <= 306, `${worst.length} characters is three segments`);
});

test('AND THE CONSTANT CARRIES EVERYTHING collectable() READS', () => {
  // It pinned the exact string 'payment_status', which passed happily on the
  // day collectable() learned about the $25 hold and stopped being true a line
  // later: an unselected column reads as undefined, indistinguishable from a
  // card that never refused, so a pickup already dropped from the round would
  // still be told to put the bag out at eight in the morning.
  //
  // Asserting what the constant MUST CONTAIN rather than what it equals is the
  // version that survives the next column.
  for (const column of ['payment_status', 'authorization_refused_at', 'authorized_cents']) {
    assert.match(reminders.CARD_FIELDS, new RegExp(column), column);
  }
});

// --- what this change deliberately does NOT do ------------------------------

test('a skipped order is not stamped, so a card arriving later can still earn one', () => {
  // reminder_sent_at means "we sent it". Stamping an order we deliberately said
  // nothing about would mean nobody is ever reminded, even if the card lands an
  // hour later and the pass runs again.
  const at = SOURCE.indexOf("'no card on file'");
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

test('THE SKIP LOG NAMES A REFUSED HOLD AS A REFUSED HOLD', () => {
  // There are three reasons a pickup is not routable and the log could only
  // say two. A card that refused the $25 hold makes collectable() false, so it
  // fell through to the else and was written down as "no card on file" - a
  // different problem, with a different fix, which sends whoever reads the log
  // chasing a card that is already on the account.
  //
  // THE GATE ITSELF WAS ALWAYS RIGHT. routableCheck() removed the stop either
  // way; only the sentence explaining it was wrong. That is why this is a test
  // about the log and not about the round.
  const at = SOURCE.indexOf('if (!routable(order))');
  assert.notEqual(at, -1, 'the routable skip has moved');

  const block = SOURCE.slice(at, SOURCE.indexOf('continue;', at));

  assert.ok(block.includes("'payment hold'"), 'the sibling hold lost its name');
  assert.ok(block.includes("'show-up hold refused'"), 'a refused hold is still called a missing card');
  assert.ok(block.includes("'no card on file'"), 'the genuine no-card case lost its name');
  assert.ok(block.includes('showUpState'), 'nothing asks whether the hold was refused');
});

test('and a skipped reminder still does not stamp reminder_sent_at', () => {
  // Unchanged, and worth pinning beside the edit above: if a card arrives
  // before the pass runs again, the column must still mean "we sent it".
  const at = SOURCE.indexOf('if (!routable(order))');
  const block = SOURCE.slice(at, SOURCE.indexOf('continue;', at));
  assert.ok(!/reminder_sent_at/.test(block), 'a skipped reminder now stamps the column');
});
