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

  // `reason: 'payment_hold'` IS NOT A COLUMN, and it has to be allowed here or
  // this test refuses the refusal key. It is the word collectRefusal() hands
  // back to say WHY a stop is off the round - the same key deliver() has used
  // for a while - and it never reaches the database. Stripped by its exact
  // shape rather than loosened to a weaker pattern, so a genuine
  // `.select('payment_hold')` or `.eq('payment_hold', ...)` still fails.
  const withoutRefusalKey = code.split("reason: 'payment_hold'").join('');

  assert.ok(!/payment_hold/.test(withoutRefusalKey), 'a payment_hold column crept in');
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

// --- what Grok found, 14 September ------------------------------------------

test('THE QUOTE MUST NOT DRAW A HELD ORDER AS A DELIVERY', () => {
  // todaysRun() is the picture of the day that /ops/routing measures a new
  // order against. A held bag may well be in the van, and it is not going to a
  // doorstep, so counting it as a stop quotes the afternoon against a delivery
  // nobody is going to drive.
  const src = SOURCE('dispatch.js');
  const at = src.indexOf('async function todaysRun');
  assert.notEqual(at, -1);
  const body = src.slice(at, src.indexOf('function sequence', at));
  assert.ok(body.includes('!paymentHold(o)'), 'the quote still delivers held orders');
});

test('AND ITS PICKUPS USE THE SAME SIBLING BLOCK THE BOARD USES', () => {
  // It said filter(collectable), which is one of the two reasons a pickup is
  // not a stop. It knew nothing about the sibling block at all.
  const src = SOURCE('dispatch.js');
  const at = src.indexOf('async function todaysRun');
  const body = src.slice(at, src.indexOf('function sequence', at));
  assert.ok(body.includes('routableCheck('), 'the quote does not apply the sibling block');
});

test('ONE OWNER FOR ROUTABLE, so three readers cannot answer differently', () => {
  // board(), todaysRun() and reminders.js all ask "can this pickup be driven
  // today". The answer is two rules - a card, and nothing outstanding - and
  // each caller writing its own `&&` is how one of them ends up with one rule.
  const src = SOURCE('dispatch.js');
  const at = src.indexOf('async function board');
  const body = src.slice(at, at + 8000);
  assert.ok(body.includes('routableCheck('), 'board() stopped using the shared check');
  assert.ok(
    !body.includes('collectable(o) &&'),
    'board() has grown its own copy of the rule again'
  );
});

test('THE DELIVERY DOOR REFUSES, NOT ONLY THE VAN DOOR', () => {
  // outForDelivery() stops a held order being loaded. deliver() stops one that
  // was already in the van when the charge failed, and is what makes the rule
  // true of the JSON API and of the order page reached directly.
  const src = SOURCE('fulfilment.js');
  const at = src.indexOf('async function deliver(');
  assert.notEqual(at, -1);
  const body = src.slice(at, at + 1600);
  assert.ok(body.includes('dispatch.paymentHold(order)'), 'deliver() does not refuse a hold');
  assert.ok(body.includes('payment_hold'), 'deliver() does not name the refusal');
});

test('IT REFUSES BEFORE THE PHOTO, so nothing is uploaded for a delivery that is not happening', () => {
  const src = SOURCE('fulfilment.js');
  const at = src.indexOf('async function deliver(');
  const body = src.slice(at, at + 4000);
  assert.ok(
    body.indexOf('dispatch.paymentHold(order)') < body.indexOf('A photo is required'),
    'the driver is asked for a photo on the way to being refused'
  );
});

test('BOTH REFUSALS SAY reason, which is the word both front doors read', () => {
  // ops.js send() switches on result.reason and the order page renders
  // result.detail. A refusal keyed on anything else is a refusal nothing can
  // tell apart from any other - it shipped once as `error`.
  const src = SOURCE('fulfilment.js');
  for (const fn of ['async function outForDelivery', 'async function deliver(']) {
    const at = src.indexOf(fn);
    const body = src.slice(at, at + 1600);
    assert.ok(
      body.includes("reason: 'payment_hold'"),
      `${fn} does not refuse with reason: 'payment_hold'`
    );
  }
});

test('BOTH FIELD LISTS CARRY customer_id, AND THIS IS THE SEVENTH TIME', () => {
  // The sibling block groups on customer_id and neither select list asked for
  // it, so every row came back undefined, heldCustomerIds() was handed a list
  // of nothing, and the rule blocked nobody from the moment it was written.
  //
  // It did not throw. The live check that was supposed to prove it worked had
  // called heldCustomerIds() directly with a real id rather than going through
  // board() - so it tested the helper and not the wiring, which is the same
  // mistake as checking a screen and not the route behind it. Grok found it.
  const src = SOURCE('dispatch.js');
  for (const list of ['BOARD_FIELDS', 'RUN_FIELDS']) {
    const at = src.indexOf(`const ${list} =`);
    assert.notEqual(at, -1, `${list} not found`);
    const block = src.slice(at, src.indexOf(';', src.indexOf('customers', at)));
    const naked = block.split('stripe_customer_id').join('');
    assert.ok(naked.includes('customer_id'), `${list} does not select customer_id`);
  }
});

// ---------------------------------------------------------------------------
// THE DOORS, AFTER THE 15 SEPTEMBER AUDIT.
//
// Everything below is about the gap between what the BOARD decided and what
// the BUTTON would still do. The board applied three rules; fulfilment's
// collect() applied one. So a stop could be off the round and collectable
// anyway - from the order page, a second phone, or POST /ops/collected.
//
// CLAUDE.md already states the rule this broke: a screen that hides a control
// while the route behind it still fires is not a guard, and all the doors
// refuse together or none of them do.
// ---------------------------------------------------------------------------

test('THE SIBLING QUERY ASKS FOR WHAT HAS BEEN PAID', () => {
  // balance() reads amount_paid_cents, an unselected column is undefined, and
  // Number(undefined || 0) is 0 - so a part-paid order looks wholly unpaid and
  // goes on parking every other pickup that customer has after the cash has
  // arrived. Same trap as the two field lists above, one query along.
  const src = SOURCE('dispatch.js');
  const at = src.indexOf('async function heldCustomerIds');
  assert.notEqual(at, -1, 'heldCustomerIds has moved');

  const select = src.slice(src.indexOf('.select(', at), src.indexOf('.in(', at));
  assert.ok(
    select.includes('amount_paid_cents'),
    'heldCustomerIds does not select amount_paid_cents'
  );
  assert.ok(select.includes('price_cents'), 'heldCustomerIds stopped selecting price_cents');
});

test('THE BOARD LOOKS AT A LAUNDROMAT FLOOR TOO', () => {
  // A charge that fails while the bags are at a partner is a hold like any
  // other, and the sibling block already acts on it - the board simply never
  // drew a card naming it, because the in-hand query left AT_PARTNER out.
  const src = SOURCE('dispatch.js');
  const at = src.indexOf('let handQuery = db');
  assert.notEqual(at, -1, 'the in-hand query has moved');

  const block = src.slice(at, src.indexOf(';', at));
  for (const status of ['IN_PROCESS', 'AT_PARTNER', 'READY', 'OUT_FOR_DELIVERY']) {
    assert.ok(block.includes(status), `the in-hand query does not include ${status}`);
  }
});

test('and a bag at a laundromat is not counted as being in the van', () => {
  // The hazard that came with the line above: carryingBags summed the whole
  // in-hand list, which stopped meaning "aboard" the moment AT_PARTNER joined
  // it. Left alone it would draw "this is more than the van holds" over a van
  // that is half empty.
  const src = SOURCE('dispatch.js');
  const at = src.indexOf('const carryingBags =');
  assert.notEqual(at, -1, 'carryingBags has moved');

  const block = src.slice(at, src.indexOf(';', at));
  assert.ok(
    block.includes('ABOARD'),
    'carryingBags counts everything in hand, including a partner floor'
  );
});

test('COLLECT REFUSES FOR ALL THREE REASONS, NOT JUST THE CARD', () => {
  const order = {
    order_number: 1,
    customer_id: 'A',
    customers: withCard,
    payment_status: 'UNPAID',
  };

  assert.equal(dispatch.collectRefusal(order, new Set()), null);
  assert.equal(dispatch.collectRefusal(order, new Set(['A'])).reason, 'payment_hold');

  assert.equal(
    dispatch.collectRefusal(
      { ...order, authorization_refused_at: '2026-09-16T00:00:00Z' },
      new Set()
    ).reason,
    'hold_refused'
  );

  assert.equal(
    dispatch.collectRefusal({ ...order, customers: {} }, new Set()).reason,
    'no_card_on_file'
  );
});

test('A WAIVED ORDER IS STILL PARKED BEHIND AN UNPAID ONE OF THEIR OWN', () => {
  // The one that reads like a contradiction and is not. collectable() asks
  // whether THIS order can be billed, and a waived one needs no card - that is
  // the point of waiving it. The sibling block asks whether this CUSTOMER has
  // laundry of ours they have not paid for, and deciding to do somebody a
  // favour today does not settle the bill on the bag sitting at a laundromat.
  //
  // The board already behaved this way, because it applied the sibling test
  // outside the waived short-circuit. Getting that order of tests wrong would
  // have quietly changed the round.
  const waived = { order_number: 2, customer_id: 'A', customers: {}, payment_status: 'WAIVED' };

  assert.equal(dispatch.collectRefusal(waived, new Set()), null, 'a waived order needs no card');
  assert.equal(
    dispatch.collectRefusal(waived, new Set(['A'])).reason,
    'payment_hold',
    'a waived order skipped its own sibling block'
  );
});

test('AND collect() READS THAT SAME PREDICATE', () => {
  // Source-read, because calling it would move an order and text somebody.
  const src = SOURCE('fulfilment.js');
  const at = src.indexOf('async function collect(');
  assert.notEqual(at, -1, 'collect() has moved');

  const body = src.slice(at, src.indexOf('async function', at + 30));

  assert.ok(body.includes('collectRefusal'), 'collect() does not use the shared refusal');
  assert.ok(body.includes('heldCustomerIds'), 'collect() never looks up the sibling hold');

  // And it no longer carries its own copy of the card test, which is how the
  // two doors came to disagree in the first place.
  assert.ok(!/needsCardOnFile/.test(body), 'collect() still has its own copy of the card predicate');
});

test('THE OFFICE IS PAGED ONCE, AND TOLD THE REMAINDER', () => {
  // #2060 was already FAILED when the hold rule shipped, so markFailed() never
  // ran for it - and raise() would not have paged anyway, because it returns an
  // open issue untouched.
  const billingSrc = SOURCE('billing.js');

  assert.ok(billingSrc.includes('ensurePaymentHold'), 'markFailed does not use ensurePaymentHold');
  assert.ok(billingSrc.includes('function paymentHoldReason'), 'the hold sentence has no owner');
  assert.ok(billingSrc.includes('ensureExistingHolds'), 'nothing sweeps the already-failed rows');

  const at = billingSrc.indexOf('function paymentHoldReason');
  const block = billingSrc.slice(at, billingSrc.indexOf('\n}', at));

  assert.ok(block.includes('dispatch.balance'), 'the hold sentence does not use the balance');
  assert.ok(
    !/money\(order\.price_cents\)/.test(block),
    'the hold sentence still quotes the full price'
  );

  const dispatchSrc = SOURCE('dispatch.js');
  assert.ok(
    dispatchSrc.includes('ensureExistingHolds'),
    'the board never names the holds that predate the rule'
  );
});

test('and the hold sentence names what is left, not what it cost', () => {
  // $70 in cash against an $84 bill used to page "$84.00 outstanding", which
  // sends somebody to ring a customer who has already paid most of it.
  const billing = require('../src/core/billing');

  assert.match(billing.paymentHoldReason({ order_number: 2060, price_cents: 8400 }), /\$84\.00/);
  assert.match(
    billing.paymentHoldReason({ order_number: 2060, price_cents: 8400, amount_paid_cents: 7000 }),
    /\$14\.00/
  );
});

test('a second page for the same customer is impossible, not discouraged', () => {
  // The board redraws on every load, so paging per draw would text every admin
  // all afternoon - which is how an alert becomes something people switch off.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'issues.js'), 'utf8');
  const at = src.indexOf('async function ensurePaymentHold');
  assert.notEqual(at, -1, 'ensurePaymentHold has gone');

  const body = src.slice(at, src.indexOf('// Text every admin', at));

  assert.ok(body.includes('HOLD_PREFIX'), 'nothing marks an issue as already being a hold');
  assert.ok(body.includes('paged: false'), 'the existing-issue path does not say it did not page');

  // Paging happens only through raise(), which is reached only when there is
  // no open issue at all.
  assert.ok(!/alertAdmins/.test(body), 'ensurePaymentHold pages directly');
});

test('THE DECLINE COMMENT NO LONGER TEACHES DELIVER-AND-CHASE', () => {
  // Neil reversed this on 14 September, and the comment above markFailed() in
  // chargeOrder() still described the old rule - which is what the next person
  // to read that file would have implemented.
  const src = SOURCE('billing.js');
  const at = src.indexOf('--- The card was refused');
  assert.notEqual(at, -1, 'the decline branch has moved');

  const block = src.slice(at, src.indexOf('await markFailed', at));

  assert.ok(!/We deliver anyway and chase by text/.test(block), 'the old rule is still taught');
  assert.ok(/PAYMENT HOLD/i.test(block), 'the comment does not name the rule that replaced it');
  assert.ok(/doorstep/i.test(block), 'the comment no longer keeps the doorstep exception');
});
