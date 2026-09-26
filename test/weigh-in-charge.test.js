'use strict';

// ---------------------------------------------------------------------------
// THE HOLD COVERS THE DELIVERY, AND THE WEIGH-IN SPENDS IT.
//
// Neil, 25 September: "hold gets placed on order (the hold shouls be at least
// the amount of the delivery. Then once the luandromat weights the order, the
// card should be charged."
//
// Two halves, and each was broken in a way that leaves no trace.
//
// THE HOLD WAS A FLAT $25 WHATEVER THE DELIVERY COST. `quote.holdCents()` knew
// how to work the amount out and nothing called it, so an order whose two
// courier legs cost $31 held $25 - less than the one thing we are certain to be
// out of pocket for. Nothing fails when a hold is too small; it is simply
// smaller than it should have been, discovered at a refusal weeks later.
//
// AND THE WEIGH-IN CHARGED THE FULL TOTAL BESIDE THE HOLD RATHER THAN THROUGH
// IT. `settleWeight()` called `chargeOrder()`, which does not know a hold
// exists. Under the van that was harmless, because the door had already spent
// the hold by then. Under a courier nobody goes to the door, so the hold is
// still sitting at Stripe: the customer would see a pending $25 AND a real
// charge for the same load of laundry.
//
// AND THERE WAS NO PRICING BRANCH FOR THEIR SCALE ALONE, which is the courier's
// ordinary case and not an edge one - so the whole thing returned "Nothing has
// been weighed yet" about an order that had just been weighed.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const quote = require('../src/core/quote');
const billing = require('../src/core/billing');
const { config } = require('../src/config');

const SRC = (...bits) => fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8');

// The code with the prose stripped out. An assertion about what a function DOES
// must not be satisfiable - or breakable - by the comment explaining it.
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function bodyOf(src, signature) {
  const at = src.indexOf(signature);
  assert.notEqual(at, -1, `${signature} has been renamed or removed`);

  const next = src.indexOf('\nasync function ', at + 10);
  const plain = src.indexOf('\nfunction ', at + 10);
  const end = [next, plain].filter((n) => n !== -1).sort((a, b) => a - b)[0];

  return src.slice(at, end === undefined ? src.length : end);
}

const FLOOR = config.pricing.authorizationCents;

// --- 1. what gets held ------------------------------------------------------

test('THE HOLD COVERS THE DEAREST PAIR OF COURIER LEGS', () => {
  // IT WAS `holdCents({ deliveryFeeCents })` AND NOTHING COULD SUPPLY THE FEE.
  // `orders.delivery_fee_cents` was never written by anything, so this answered the
  // flat floor on every booking. And no per-order figure exists when a hold is
  // placed: the pickup is booked today and no courier has been quoted for it.
  // Derived from the band table now, so it self-corrects.
  const dearest = Math.max(...config.courier.bands.map((b) => b.legCents));

  assert.equal(quote.holdCents(), Math.max(FLOOR, dearest * 2));
  assert.ok(quote.holdCents() >= dearest * 2, 'the hold no longer covers the dearest pair of legs');
});

test('and a hold is never a number Stripe would refuse', () => {
  // A hold of NaN cents is refused on every booking, and `Math.max(undefined, n)`
  // is how that happened once already - the floor was read off the courier block
  // of config, where it does not live.
  const held = quote.holdCents();

  assert.ok(Number.isFinite(held), `holdCents() produced ${held}`);
  assert.ok(held >= FLOOR, 'the hold dropped below the floor');
  assert.equal(held, Math.round(held), 'a fraction of a cent');
});

test('billing agrees with it, whatever it is handed', () => {
  // `holdFor()` keeps the order in its signature and must not read it: the column
  // it used to read never existed in practice, and a caller passing a stale one
  // must not change the amount.
  const held = quote.holdCents();

  for (const order of [null, undefined, {}, { delivery_fee_cents: 999999 }]) {
    assert.equal(billing.holdFor(order), held, `holdFor(${JSON.stringify(order)}) read the order`);
  }
});

test('THE AMOUNT IS DECIDED IN ONE PLACE, NOT AT THE FOUR CALL SITES', () => {
  // FOUR things place a hold: bookPickup(), the card being saved, the
  // night-before pass and the admin retry button. Asking each to work the amount
  // out makes "somebody forgot" the failure - silently, in the direction of
  // holding too little. CLAUDE.md records that exact polarity costing four
  // orders with `bookedByTheSystem`. So the DEFAULT has to be right, and the
  // callers pass nothing.
  const authorize = code(bodyOf(SRC('core', 'billing.js'), 'async function authorizeShowUp('));

  assert.match(
    authorize,
    /amountCents == null \? holdFor\(order\)/,
    'the default hold is not read off the order, so a courier delivery can be held short'
  );

  const callers = [
    ['core', 'booking.js'],
    ['core', 'card-saved.js'],
    ['core', 'show-up-holds.js'],
    ['routes', 'admin.js'],
  ];

  for (const bits of callers) {
    const src = code(SRC(...bits));
    const calls = [...src.matchAll(/authorizeShowUp\(([^)]*)\)/g)].map((m) => m[1]);

    assert.ok(calls.length, `${bits.join('/')} no longer places a hold`);

    for (const args of calls) {
      assert.ok(
        !/amountCents/.test(args),
        `${bits.join('/')} works the hold amount out for itself - the next caller added will forget`
      );
    }
  }
});

// --- 2. the laundromat's scale on its own -----------------------------------

test('A LAUNDROMAT SCALE ON ITS OWN IS A PRICE, NOT "NOTHING HAS BEEN WEIGHED"', () => {
  const settle = code(bodyOf(SRC('core', 'fulfilment.js'), 'async function settleWeight('));

  // Under a courier nothing of ours touches the bags, so `weight_lb` is null for
  // ever and `partner_weight_lb` arrives alone. Every branch above it needs ours.
  assert.match(
    settle,
    /else if \(theirs != null\)/,
    'a courier order with only the laundromat scale still falls through to no_weight'
  );

  // And it must come BEFORE the refusal, or it can never be reached.
  assert.ok(
    settle.indexOf('else if (theirs != null)') < settle.indexOf("reason: 'no_weight'"),
    'the branch is after the refusal that made it necessary'
  );
});

test('and their figure is what we pay them, with no band', () => {
  const settle = code(bodyOf(SRC('core', 'fulfilment.js'), 'async function settleWeight('));
  const branch = settle.slice(settle.indexOf('else if (theirs != null)'), settle.indexOf("reason: 'no_weight'"));

  assert.match(branch, /billable = theirs/, 'the only scale that weighed it is not what bills');
  assert.match(branch, /partnerBill = theirs/, 'the laundromat is not invoiced for the weight it read');

  // THE BANDS DESCRIBE A GAP BETWEEN TWO SCALES. With one scale there is no gap,
  // so there is no band to be in - and `partnerBillFor()` exists to withhold an
  // invoice past the exception line, which there is no line to be past.
  assert.ok(!/band = /.test(branch), 'a band is being invented for a comparison that did not happen');
  assert.ok(!/partnerBillFor/.test(branch), 'an exception line is being applied where nothing was compared');
});

// --- 3. spending the hold ---------------------------------------------------

test('THE WEIGH-IN CHARGES THROUGH THE HOLD, NEVER BESIDE IT', () => {
  const settle = code(bodyOf(SRC('core', 'fulfilment.js'), 'async function settleWeight('));

  assert.match(
    settle,
    /billing\.settleTotal\(/,
    'the weigh-in charges the full total fresh, so a courier customer sees a pending hold AND a charge'
  );
  assert.ok(
    !/billing\.chargeOrder\(/.test(settle),
    'the weigh-in still calls chargeOrder(), which does not know a hold exists'
  );
});

test('an order with no hold reaches chargeOrder anyway, through settleTotal', () => {
  // What keeps every van-era order on the board working: no live hold falls
  // straight through. Without this the change would be a rewrite of the charge
  // rather than a redirection of it.
  const fn = code(bodyOf(SRC('core', 'billing.js'), 'async function settleTotal('));
  assert.match(fn, /if \(!hold\) return chargeOrder\(/, 'an order with no hold has nowhere to go');
});

test('AND THE CAPTURED HOLD IS WASH MONEY ONCE THE LAUNDRY IS OURS', async () => {
  // THE BUG THIS EXISTS FOR. The refused-remainder branch wrote recordShowUp()
  // unconditionally - `applies_to_wash: false`, noted "the bags were left". True
  // at a doorstep, where this was the only caller. False at a laundromat counter,
  // where the weigh-in now calls it: the bags are on a shelf being washed.
  //
  // What it would have cost: $25 off the customer's card recorded as money for a
  // trip, so `balance()` still owes the whole total and `paymentHold()` holds
  // their delivery over money they have already paid.
  const fn = code(bodyOf(SRC('core', 'billing.js'), 'async function settleTotal('));
  const refused = fn.slice(fn.indexOf('if (kept > 0)'));

  assert.match(refused, /IN_OUR_HANDS/, 'the kept money is booked the same way whether or not we have the laundry');
  assert.match(refused, /ledger\.recordCard\(/, 'a part payment on laundry we hold is not recorded as a payment');
  assert.match(refused, /ledger\.recordShowUp\(/, 'the doorstep trip charge has been lost');

  // DERIVED, NOT A FLAG. Two callers today and either could forget, and the
  // failure is money quietly in the wrong column.
  const signature = fn.slice(0, fn.indexOf('{'));
  assert.ok(
    !/bagsLeft|keptIsTrip|atTheDoor|inOurHands/i.test(signature),
    'custody is being passed in rather than read off the order'
  );
});

test('the ledger is the ledger, and the provider is the provider', () => {
  // `billing.js` had two things called `payments` - the Stripe provider at the
  // top and the ledger in a require() buried in a function - so every
  // `payments.recordCard()` reached for a method the provider does not have. A
  // missing method throws synchronously, which is why the `.catch()` beside each
  // one never ran.
  const src = SRC('core', 'billing.js');

  assert.equal(
    (src.match(/^const payments = require/gm) || []).length,
    1,
    'there is not exactly one binding of the Stripe provider'
  );
  assert.equal(
    (src.match(/^const ledger = require/gm) || []).length,
    1,
    'there is not exactly one binding of the ledger'
  );
});

// --- 4. saying so ------------------------------------------------------------

test('A TEXT WE COULD NOT SEND DOES NOT UNDO A CHARGE', () => {
  // It was the last line before the return and it was unguarded: by the time it
  // runs the price is written, the promotion is spent and the card is charged, so
  // a carrier being down threw out of settleWeight() and every caller read that
  // as the weigh-in having failed.
  const settle = bodyOf(SRC('core', 'fulfilment.js'), 'async function settleWeight(');
  const send = settle.slice(settle.indexOf('await sendAndLog('));

  assert.match(send.slice(0, 200), /\.catch\(/, 'a failed text still throws out of a completed charge');
});

test('and nothing here calls the function that was renamed', () => {
  // `chargeAtTheDoor()` became `settleTotal()` because the weigh-in calls it from
  // a laundromat counter, and a name saying "at the door" is the kind of stale
  // label CLAUDE.md records costing an afternoon elsewhere. One name, not two.
  //
  // CODE ONLY, AND THAT IS THE POINT OF `code()`. The first version read whole
  // files and failed on billing.js's own note saying what the function used to be
  // called - a test refusing the explanation of the change it was written to
  // check. The old name SHOULD survive in prose; what must not survive is a call
  // to it.
  for (const bits of [['core', 'billing.js'], ['core', 'fulfilment.js'], ['core', 'subscription.js']]) {
    assert.ok(
      !/chargeAtTheDoor/.test(code(SRC(...bits))),
      `${bits.join('/')} still calls chargeAtTheDoor, so there are two names for one act`
    );
  }
});
