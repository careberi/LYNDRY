'use strict';

// ---------------------------------------------------------------------------
// THE $25 SHOW-UP HOLD.
//
// Neil, 14 September: the card must accept a $25 hold before a pickup is
// confirmed. At the door the driver weighs the bags and we charge the real
// total - capture it out of the hold if it fits, capture the $25 and charge the
// rest if it does not. And if that extra charge is refused:
//
//   keep the $25, do not take the bags, do not start the wash.
//
// MOST OF WHAT IS PINNED HERE IS THAT LAST LINE, because every way it can go
// wrong is a way the $25 quietly turns back into laundry we owe somebody:
//
//   not folded into Card          it did not pay for a wash
//   not off tomorrow's price      the rebooked pickup is full price
//   not a part payment            amount_paid_cents must not move
//   not Payment Hold              we are not holding any laundry
//   not recoverable in cash       there is nothing to recover
//
// And one guarantee in the other direction, which is the one that could break a
// working business overnight: an order with NO hold on it is still collectable.
// Every order on the board today is one of those.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const billing = require('../src/core/billing');
const dispatch = require('../src/core/dispatch');
const payments = require('../src/core/payments');
const fulfilment = require('../src/core/fulfilment');
const booking = require('../src/core/booking');
const { config } = require('../src/config');

// CRLF NORMALISED AT THE READ. A source-slicing test passed on a branch and
// failed on main once with identical bytes, because the helper looked for a
// bare newline and the checkout had written \r\n.
const SRC = (...bits) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8')
    .split('\r\n')
    .join('\n');

const SQL = (name) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', name), 'utf8')
    .split('\r\n')
    .join('\n');

// The body of one function, comments stripped, so an assertion cannot match its
// own explanation - which has caught two tests in this suite already.
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

const card = {
  id: 'cus',
  stripe_customer_id: 'cus_1',
  default_payment_method_id: 'pm_1',
  card_brand: 'visa',
  card_last4: '4242',
};

// --- what it is, and what it is not -----------------------------------------

test('THE HOLD IS $25', () => {
  assert.equal(billing.showUpCents(), 2500);
  assert.equal(config.pricing.authorizationCents, 2500);
});

test('and it is its own constant, never the order minimum', () => {
  // They are the same number today by coincidence. The minimum is the floor on
  // what a wash COSTS; this is what a doorstep visit is worth when no wash
  // happens. Collapsing them would tie a trip charge to a pricing decision.
  const src = SRC('config.js');
  assert.match(src, /authorizationCents/);
  assert.ok(
    !/authorizationCents:\s*(config\.)?pricing\.minimumCents|authorizationCents:\s*minimumCents/.test(src),
    'the hold was defined as the order minimum'
  );

  const showUp = bodyOf(SRC('core', 'billing.js'), 'function showUpCents(');
  assert.ok(!/minimumCents/.test(showUp), 'showUpCents reads the order minimum');
});

// --- the arithmetic Neil described ------------------------------------------

test('A TOTAL UNDER THE HOLD IS CAPTURED AND NOTHING MORE IS CHARGED', () => {
  // "If the total is $25 or less, capture that amount from the hold."
  assert.deepEqual(billing.doorSplit(1800, 2500), { total: 1800, capture: 1800, charge: 0 });
});

test('A TOTAL OVER THE HOLD CAPTURES THE $25 AND CHARGES THE REST', () => {
  // "If the total is more than $25, capture the $25 and charge the rest on the
  // same card." 42 lb at $2.00 is $84.00.
  assert.deepEqual(billing.doorSplit(8400, 2500), { total: 8400, capture: 2500, charge: 5900 });
});

test('exactly the hold is one capture and no second charge', () => {
  assert.deepEqual(billing.doorSplit(2500, 2500), { total: 2500, capture: 2500, charge: 0 });
});

test('no hold means the whole thing is charged, exactly as before', () => {
  assert.deepEqual(billing.doorSplit(8400, 0), { total: 8400, capture: 0, charge: 8400 });
});

test('and it never captures more than was held', () => {
  // A hold is a promise about a ceiling. Stripe would refuse it anyway; this is
  // so nothing in our own arithmetic ever asks.
  for (const total of [0, 1, 2499, 2500, 2501, 100000]) {
    assert.ok(billing.doorSplit(total, 2500).capture <= 2500, String(total));
    assert.equal(
      billing.doorSplit(total, 2500).capture + billing.doorSplit(total, 2500).charge,
      total
    );
  }
});

// --- was the pickup confirmed -----------------------------------------------

test('a live hold reads HELD, and still does once the money is taken', () => {
  assert.equal(billing.showUpState({ authorization_intent_id: 'pi_1' }), 'HELD');
  // The id is cleared at capture; authorized_at is what says the card agreed.
  assert.equal(billing.showUpState({ authorized_at: 'x', captured_cents: 2500 }), 'HELD');
});

test('A REFUSAL BEATS AN EARLIER HOLD, because it is the later fact', () => {
  // The order held, went to a door, was refused the balance and is back on
  // tomorrow's board. What matters now is the no.
  assert.equal(
    billing.showUpState({ authorized_at: 'x', authorization_refused_at: 'y' }),
    'REFUSED'
  );
});

test('NOBODY ASKED IS NOT A REFUSAL, and that is the whole safety of this', () => {
  // Every order on the board the morning this deploys.
  assert.equal(billing.showUpState({}), 'UNASKED');
  assert.equal(billing.showUpState(null), 'UNASKED');
});

test('a live hold is read as an amount, not a boolean', () => {
  assert.deepEqual(billing.showUpHold({ authorization_intent_id: 'pi_1', authorized_cents: 2500 }), {
    intentId: 'pi_1',
    cents: 2500,
  });
  assert.equal(billing.showUpHold({ authorized_at: 'x', captured_cents: 2500 }), null);
});

// --- the gate ---------------------------------------------------------------

test('A REFUSED HOLD IS NOT A STOP ON THE ROUND', () => {
  const order = { payment_status: 'UNPAID', authorization_refused_at: 'x', customers: card };
  assert.equal(dispatch.collectable(order), false);
});

test('AN ORDER NOBODY ASKED IS STILL COLLECTABLE - no empty round', () => {
  // The single most expensive thing this change could have got wrong: reading
  // a missing hold as a failed one takes every existing pickup off the van.
  assert.equal(dispatch.collectable({ payment_status: 'UNPAID', customers: card }), true);
});

test('and a waived order is collected however the card behaved', () => {
  // Nothing to charge is not the same as cannot charge - the rule collectable()
  // already keeps, and a hold must not be a way round it.
  assert.equal(
    dispatch.collectable({ payment_status: 'WAIVED', authorization_refused_at: 'x', customers: {} }),
    true
  );
});

test('BOTH FIELD LISTS SELECT WHAT THE GATE READS', () => {
  // Eleventh time. An unselected column reads as undefined, which here is
  // indistinguishable from a card that never refused - so every refused pickup
  // would go quietly back on the round.
  const src = SRC('core', 'dispatch.js');

  for (const list of ['BOARD_FIELDS', 'RUN_FIELDS']) {
    const at = src.indexOf(`const ${list} =`);
    assert.notEqual(at, -1, list);
    const block = src.slice(at, src.indexOf(';', src.indexOf('customers', at)));
    assert.match(block, /authorization_refused_at/, `${list} does not select the refusal`);
    assert.match(block, /authorization_intent_id/, `${list} does not select the hold`);
  }
});

test('and so does the one screen that explains a hold', () => {
  const src = SRC('routes', 'admin.js');
  for (const column of [
    'authorization_intent_id',
    'authorized_cents',
    'authorization_refused_reason',
    'captured_cents',
  ]) {
    assert.match(src, new RegExp(column), `the order page never selects ${column}`);
  }
});

// --- THE BAGS STAYED. What the $25 is, and what it is not. ------------------

test('THE KEPT $25 IS NOT CARD AND NOT CASH - it is its own line', () => {
  const split = payments.splitFor({ price_cents: 0 }, [
    { method: 'CARD', amount_cents: 2500, applies_to_wash: false },
  ]);

  assert.equal(split.trip, 2500);
  assert.equal(split.card, 0, 'it was folded into Card');
  assert.equal(split.cash, 0);
});

test('AND IT DOES NOT PAY FOR A WASH, on this order or the next one', () => {
  // Neil: do not treat the $25 as a wash we owe them if we left the bags
  // behind. The rebooked pickup starts at its full price.
  const split = payments.splitFor({ price_cents: 8400 }, [
    { method: 'CARD', amount_cents: 2500, applies_to_wash: false },
  ]);

  assert.equal(split.paid, 0, 'the trip charge counted as money towards the wash');
  assert.equal(split.balance, 8400);
  assert.equal(split.settled, false);
});

test('the cached sum on the order is the wash rows only', () => {
  // resettle() writes amount_paid_cents, which is what dispatch.balance()
  // subtracts. A trip charge in there would make a full-price order read as
  // $25 already paid.
  const body = bodyOf(SRC('core', 'payments.js'), 'async function resettle(');
  assert.match(body, /applies_to_wash/, 'resettle sums every row');
  assert.match(body, /filter/, 'resettle does not filter the rows it sums');
});

test('and the row itself is written as not-for-the-wash', () => {
  const body = bodyOf(SRC('core', 'payments.js'), 'async function recordShowUp(');
  assert.match(body, /applies_to_wash: false/);
  assert.match(body, /METHODS\.CARD/, 'a kept show-up charge is not cash');
});

test('an ordinary card payment is still wash money', () => {
  // The default has to stay true, or every order ever paid reads as unpaid.
  const body = bodyOf(SRC('core', 'payments.js'), 'async function recordCard(');
  assert.ok(!/applies_to_wash/.test(body), 'recordCard started setting the flag');
  assert.match(SQL('0094_payments_ledger.sql'), /applies_to_wash boolean not null default true/);
});

test('THE ORDER PAGE SHOWS THE TRIP OUTSIDE THE BALANCE', () => {
  const console_ = require('../src/web/order-console');
  const money = (c) => `$${(c / 100).toFixed(2)}`;

  const left = console_.paidTable(
    payments.splitFor({ price_cents: 0 }, [
      { method: 'CARD', amount_cents: 2500, applies_to_wash: false },
    ]),
    { money }
  );

  assert.match(left, /Trip/);
  // An unpriced order is not a paid one. Total $0 / Balance $0 / Paid over a
  // doorstep refusal would call an order settled that was never charged for.
  assert.ok(!/chip ok/.test(left), 'a doorstep refusal reads as Paid');
  assert.match(left, /does not come off the rebooked pickup/);
});

// --- what the customer is told ----------------------------------------------

test('THE DOORSTEP TEXT SAYS THE TRIP WAS CHARGED AND THE WASH WAS NOT', () => {
  const text = fulfilment.leftAtDoorText({
    weight: 42,
    priceCents: 8400,
    needsCard: false,
    destination: 'here: lyndry.com/pay/ab12cd',
    keptCents: 2500,
  });

  assert.match(text, /\$25\.00/, 'it never mentions what was taken');
  assert.match(text, /trip/i);
  assert.match(text, /left the bags where we found them/);
  assert.ok(!/credit|towards|next time|off your next/i.test(text), 'it offered the $25 as credit');
});

test('and with nothing kept it says nothing has been taken, as it always did', () => {
  const text = fulfilment.leftAtDoorText({
    weight: 42,
    priceCents: 8400,
    needsCard: false,
    destination: 'here: lyndry.com/pay/ab12cd',
  });

  assert.match(text, /nothing has been taken/i);
  assert.ok(!/\$25\.00/.test(text));
});

test('a doorstep text stays inside two segments', () => {
  // It goes to somebody standing behind a door with their laundry still on the
  // step, and every segment is billed.
  const text = fulfilment.leftAtDoorText({
    weight: 42.2,
    priceCents: 8440,
    needsCard: false,
    destination: 'here: lyndry.com/pay/ab12cd',
    keptCents: 2500,
  });

  assert.ok(text.length <= 306, `${text.length} characters is three segments`);
});

test('THE CONFIRMATION NAMES THE HOLD, because a statement will', () => {
  // A $25 pending charge with nothing explaining it is a phone call at best.
  const customer = { ...card, preferences: { water_temp: 'COLD' } };
  const order = {
    order_number: 2071,
    pickup_date: '2026-09-16',
    pickup_window_start: '17:00',
    pickup_window_end: '21:00',
    pickup_method: 'LEAVE_OUTSIDE',
    authorization_intent_id: 'pi_1',
    authorized_cents: 2500,
  };

  const held = booking.confirmationMessage(customer, order, { source: booking.DOORS.WEB });
  assert.match(held, /hold \$25\.00/);
  assert.match(held, /Visa ending 4242/);
});

test('and says nothing about a hold when there is not one', () => {
  const customer = { ...card, preferences: { water_temp: 'COLD' } };
  const order = {
    order_number: 2071,
    pickup_date: '2026-09-16',
    pickup_window_start: '17:00',
    pickup_window_end: '21:00',
    pickup_method: 'LEAVE_OUTSIDE',
  };

  const plain = booking.confirmationMessage(customer, order, { source: booking.DOORS.WEB });
  assert.ok(!/hold/i.test(plain), 'an unheld booking claims a hold');
});

test('A REFUSED HOLD IS NEVER DESCRIBED AS HAVING NO CARD', () => {
  // They gave us one. Telling them otherwise sends somebody looking for a
  // problem that is not there.
  const message = booking.holdRefusedMessage(
    { ...card },
    { order_number: 2071, pickup_date: '2026-09-16', placed_via: 'THREAD' },
    { setupUrl: 'https://lyndry.com/pay/ab12cd' }
  );

  assert.match(message, /Visa ending 4242/);
  assert.match(message, /Nothing has been taken/);
  assert.ok(!/don't have a card|no card on file/i.test(message));
  assert.ok(message.length <= 306, `${message.length} characters is three segments`);
});

// --- the must-not list ------------------------------------------------------

test('NO UNPAID BAGS IN THE VAN: the card is tried before anything is written', () => {
  // Neil's must-not, and it is structural rather than a check. loadVan() works
  // the price out in memory, charges, and only then writes van_confirmed_at.
  const body = bodyOf(SRC('core', 'fulfilment.js'), 'async function loadVan(');

  const charged = body.indexOf('chargeAtTheDoor');
  const refused = body.indexOf('declinedAtTheDoor');
  // The WRITE, not the double-tap guard at the top of the function, which reads
  // the same column and is deliberately the first thing that happens.
  const confirmed = body.indexOf('van_confirmed_at: new Date()');

  assert.ok(charged > -1 && confirmed > -1 && refused > -1);
  assert.ok(charged < confirmed, 'the van is confirmed before the card is tried');
  assert.ok(refused < confirmed, 'a refusal does not return before the write');
});

test('AND NONE REACH A LAUNDROMAT, because only a stamped order can leave', () => {
  // The second must-not falls out of the first: the drop-off leg is built from
  // orders the van is confirmed to hold.
  const src = SRC('core', 'dispatch.js');
  assert.match(src, /van_confirmed_at/, 'the drop-off leg stopped reading van_confirmed_at');
});

test('THE BAGS ARE PUT BACK, NOT HALF COLLECTED', () => {
  const body = bodyOf(SRC('core', 'fulfilment.js'), 'async function declinedAtTheDoor(');

  assert.match(body, /unclipOrder/, 'the clips stay out of the pool');
  assert.match(body, /releaseOrder/, 'a live sticker is left on a bag on a doorstep');
  assert.match(body, /orders\.uncollect/, 'the order stays collected');
});

test('AND THE $25 IS NOT GIVEN BACK THERE', () => {
  // releaseShowUp() is for a pickup called off before anybody drove to it. The
  // trip happened here.
  const body = bodyOf(SRC('core', 'fulfilment.js'), 'async function declinedAtTheDoor(');
  assert.ok(!/releaseShowUp|refund/.test(body), 'the doorstep gives the show-up charge back');
});

test('a cancelled pickup DOES give it back, and from the one place that may', () => {
  // Nobody drove anywhere, so there is no trip to charge for - and a hold left
  // on a cancelled pickup is real money on somebody's card for a week.
  const src = SRC('core', 'orders.js');
  const at = src.indexOf("if (to === 'CANCELED')");
  assert.notEqual(at, -1);
  assert.match(src.slice(at, at + 1400), /releaseShowUp/);
});

test('A STANDING ORDER DOES NOT PROMISE A VAN THAT IS NOT COMING', () => {
  // bookDue() sends its own day-before text rather than going through the
  // reminder sweep, so the gate that keeps a refused pickup off the round does
  // not reach it. "Your usual pickup is tomorrow" on a stop nobody is driving
  // to is the exact failure the reminder gate was built for, one rule along.
  const body = bodyOf(SRC('core', 'recurring.js'), 'async function bookDue(');

  assert.match(body, /holdRefused/, 'bookDue promises tomorrow whatever the card said');
  const promise = body.indexOf('usual pickup is tomorrow');
  const refused = body.indexOf('holdRefused');
  assert.ok(refused > -1 && refused < promise, 'the promise is not behind the check');
});

test('PAYMENT HOLD DOES NOT REACH A DOORSTEP REFUSAL', () => {
  // Neil: Payment Hold and cash apply only when we already have the laundry.
  // An uncollected order is not in our hands, so the derived rule answers no
  // without anybody having to remember this case.
  const order = { status: 'REQUESTED', payment_status: 'FAILED', price_cents: 8400 };
  assert.equal(dispatch.paymentHold(order), false);
});

test('and neither does the cash button', async () => {
  const refusal = await payments.recordCash(
    { id: 'o1', status: 'REQUESTED', payment_status: 'FAILED', price_cents: 8400 },
    { amountCents: 2500 }
  );

  assert.equal(refusal.ok, false);
  assert.equal(refusal.reason, 'not_in_our_hands');
});

// --- a free order is not a refused one --------------------------------------

test('AN ORDER THAT COMES TO NOTHING IS NOT DECLINED AT THE DOOR', async () => {
  // Found writing the hold and it predates it. chargeOrder() answers ok:false
  // for a price of zero - right at a weigh-in, where zero means unpriced, and
  // catastrophic at a door, where loadVan() turns any ok:false into bags left
  // on the step. A customer on the first-20-orders-free promotion with a load
  // under the minimum prices at exactly $0.
  const result = await billing.chargeAtTheDoor(
    { id: 'o1', payment_status: 'UNPAID' },
    {},
    { totalCents: 0 }
  );

  assert.equal(result.ok, true, 'a free order was refused at the door');
  assert.equal(result.nothingToCharge, true);
});

test('and it is told the weight, never a $0.00 total', () => {
  // They were promised "nothing to pay". The same rule a waived order keeps.
  const body = bodyOf(SRC('core', 'fulfilment.js'), 'async function loadVan(');
  assert.match(body, /charge\.waived \|\| charge\.nothingToCharge/);
  assert.match(body, /waivedWeighInText/);
});

// --- the migration ----------------------------------------------------------

test('the migration adds columns and changes nothing that exists', () => {
  const sql = SQL('0095_show_up_authorization.sql');

  for (const column of [
    'authorization_intent_id',
    'authorized_cents',
    'authorized_at',
    'captured_cents',
    'captured_at',
    'authorization_refused_at',
    'authorization_attempts',
  ]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`), column);
  }

  const statements = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .replace(/comment on [\s\S]*?;/g, '');

  assert.ok(!/drop |alter column|payment_status/.test(statements), 'the migration changes a column');
});
