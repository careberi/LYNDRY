'use strict';

// ---------------------------------------------------------------------------
// WHO DOES EACH LEG.
//
// Neil, 25 September: "There also needs for me to override a pickup/delivery
// manually so i can assign a in house driver to it".
//
// THE DEFAULT IS DERIVED AND THE OVERRIDE IS STORED, which is what makes a
// screen able to say "chosen by hand" truthfully. Storing the default would be a
// second copy of a fact `config.courier.model` already holds.
//
// AND THE COLUMNS HAVE TO BE SELECTED. `carrierFor()` answers an undefined
// column with the DEFAULT, which is indistinguishable from nobody having
// decided - so a leg taken in house renders as a courier job, on the one screen
// Neil uses to check it, with a button offering to do what he has already done.
// That happened within a minute of the card existing. The last test in this file
// is the guard.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const carriers = require('../src/core/carriers');
const { config } = require('../src/config');

test('NOBODY HAVING DECIDED MEANS WHATEVER THE MODEL DOES', () => {
  const expected = config.courier.model === 'DYNAMIC' ? carriers.COURIER : carriers.DRIVER;

  assert.equal(carriers.carrierFor({}, carriers.PICKUP), expected);
  assert.equal(carriers.carrierFor({}, carriers.RETURN), expected);
  assert.equal(carriers.carrierFor(null, carriers.RETURN), expected);
  assert.equal(carriers.chosenByHand({}, carriers.RETURN), false);
});

test('AND A VALUE ALWAYS MEANS A PERSON DECIDED', () => {
  const ours = { return_carrier: 'DRIVER' };
  const theirs = { return_carrier: 'COURIER' };

  assert.equal(carriers.carrierFor(ours, carriers.RETURN), carriers.DRIVER);
  assert.equal(carriers.carrierFor(theirs, carriers.RETURN), carriers.COURIER);
  assert.equal(carriers.chosenByHand(ours, carriers.RETURN), true);
  assert.equal(carriers.chosenByHand(theirs, carriers.RETURN), true);
});

test('THE TWO LEGS ARE DECIDED SEPARATELY, WHICH IS THE POINT', () => {
  // A courier collects and our own van brings it back, or the other way round
  // because the courier refused the return. One column would force them to
  // agree.
  const split = { pickup_carrier: 'COURIER', return_carrier: 'DRIVER' };

  assert.equal(carriers.carrierFor(split, carriers.PICKUP), carriers.COURIER);
  assert.equal(carriers.carrierFor(split, carriers.RETURN), carriers.DRIVER);
});

test('junk in the column reads as nobody having decided, not as a crash', () => {
  for (const junk of ['', 'VAN', 'uber', 'driver', 123, {}, null]) {
    const order = { return_carrier: junk };
    const answer = carriers.carrierFor(order, carriers.RETURN);
    assert.ok(carriers.CARRIERS.includes(answer), `${JSON.stringify(junk)} gave ${answer}`);
  }

  // Lowercase is a real value typed by a person and is accepted.
  assert.equal(carriers.carrierFor({ return_carrier: 'driver' }, carriers.RETURN), carriers.DRIVER);
});

test('an unknown leg answers rather than throwing', () => {
  // A caller asking about a leg that does not exist is a bug, and refusing to
  // answer would turn it into an outage on a screen somebody is standing at.
  assert.ok(carriers.CARRIERS.includes(carriers.carrierFor({}, 'TO_THE_MOON')));
  assert.equal(carriers.chosenByHand({}, 'TO_THE_MOON'), false);
});

test('A LAUNDROMAT CANNOT SEND A COURIER FOR A LEG WE HAVE TAKEN', () => {
  // The whole reason this exists: a courier booked on a leg Neil is driving is a
  // second vehicle sent for bags somebody is already on the way for, and we pay
  // for it.
  const ours = { partner_weight_lb: 28.5, return_carrier: 'DRIVER' };
  const refused = carriers.mayBookReturnCourier(ours);

  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'ours_to_drive');
});

test('and it cannot send one before the bags are weighed', () => {
  // The laundromat's scale is the only scale under a courier, so nothing leaves
  // the counter before it has said something.
  //
  // EVERY ORDER HERE NAMES ITS CARRIER, and that is not decoration. The second
  // assertion used to be `{ partner_weight_lb: 28.5 }` with no carrier, which
  // relies on the DEFAULT being a courier - true only while `PRICING_MODEL` is
  // DYNAMIC, which the development `.env` carries and production does not. So this
  // test failed under the model production actually runs, and nobody saw it
  // because the suite had only ever been run with the dev environment loaded.
  // A test about the WEIGHT gate must not also be a test about the default.
  assert.equal(carriers.mayBookReturnCourier({ return_carrier: 'COURIER' }).reason, 'not_weighed');
  assert.equal(
    carriers.mayBookReturnCourier({ return_carrier: 'COURIER', partner_weight_lb: 28.5 }).ok,
    true
  );
  assert.equal(carriers.mayBookReturnCourier(null).ok, false);
});

test('AND A DECLINED CARD REFUSES THE DELIVERY, WHICH IT DID NOT', () => {
  // THE HOLE THIS CLOSES WAS LIVE. CLAUDE.md's lock is per leg: retrieval off a
  // laundromat is allowed while a payment is held, because refusing it leaves our
  // bags on somebody else's shelf, and the DELIVERY to the customer's door is
  // refused. `outForDelivery()` and `deliver()` both enforce that. This function -
  // the only thing between a declined card and an Uber courier - did not.
  //
  // It is one tap away under a courier: the card is charged at the weigh-in, a
  // decline writes `payment_status = 'FAILED'`, and the attendant's very next
  // action is this button.
  const held = {
    return_carrier: 'COURIER',
    partner_weight_lb: 28.5,
    status: 'READY',
    payment_status: 'FAILED',
    price_cents: 4500,
    amount_paid_cents: 0,
  };

  assert.equal(carriers.mayBookReturnCourier(held).ok, false, 'a held order can still be sent back');
  assert.equal(carriers.mayBookReturnCourier(held).reason, 'payment_hold');

  // PAID AND WAIVED GO BACK AS NORMAL. Nothing to charge is not the same as cannot
  // charge, and confusing the two would strand exactly the customers we have
  // decided to do a favour for.
  for (const payment_status of ['PAID', 'WAIVED', 'UNPAID']) {
    assert.equal(
      carriers.mayBookReturnCourier({ ...held, payment_status }).ok,
      true,
      `a ${payment_status} order is being held back`
    );
  }

  // AND A PART PAYMENT THAT CLEARS THE BALANCE IS NOT A HOLD. The rule is written
  // as money rather than as a status, so cash landing against a failed card
  // releases it without this rule being re-opened.
  assert.equal(
    carriers.mayBookReturnCourier({ ...held, amount_paid_cents: 4500 }).ok,
    true,
    'a balance settled in cash is still treated as held'
  );
});

test('THE COLUMNS ARE SELECTED WHEREVER THEY ARE READ', () => {
  // THE TRAP THAT ACTUALLY BIT, one minute after the control existed. An
  // unselected column is undefined, `carrierFor()` answers undefined with the
  // default, and a leg taken in house rendered as a courier job on the one
  // screen Neil uses to check it - with a button offering to do what he had
  // already done.
  //
  // CLAUDE.md counts this happening to CARD_FIELDS, BOARD_FIELDS, RUN_FIELDS and
  // the order page's own list. It is the same mistake every time.
  //
  // PER LEG, NOT PER FILE. The portal only ever asks about the return leg, so
  // requiring it to select `pickup_carrier` would be a test demanding a column
  // nothing reads - which is how a guard trains people to add things to shut it
  // up rather than to think.
  const files = ['routes/admin.js', 'routes/shop.js', 'core/courier-legs.js'];

  for (const relative of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', relative), 'utf8');

    const needs = new Set();
    // `mayBookReturnCourier()` reads the return leg without its caller naming it.
    if (/mayBookReturnCourier\(/.test(src) || /carriers\.RETURN/.test(src)) {
      needs.add(carriers.COLUMN[carriers.RETURN]);
    }
    if (/carriers\.PICKUP/.test(src)) {
      needs.add(carriers.COLUMN[carriers.PICKUP]);
    }

    for (const column of needs) {
      assert.ok(
        src.includes(column),
        `${relative} reads that leg's carrier but never selects ${column}, so it will always ` +
          'see the default - which is indistinguishable from nobody having decided'
      );
    }
  }
});

test('and the order page selects both, because it offers both', () => {
  // It draws a control for each leg, so it needs each column. This is the one
  // that was wrong.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  // ANCHORED ON HOW THE DECLARATION ENDS, not on the first semicolon. A lazy
  // match to `;` stopped inside a COMMENT - "van_confirmed_at is step 4;" - and
  // reported the columns missing when they were there. The declaration is a
  // chain of quoted strings joined with `+`, so its last line is the one ending
  // in `';`.
  const fields = /const ORDER_FIELDS =[\s\S]*?';$/m.exec(src);

  assert.ok(fields, 'ORDER_FIELDS has been renamed or removed');
  assert.ok(fields[0].includes('pickup_carrier'), 'the order page cannot see who does the pickup');
  assert.ok(fields[0].includes('return_carrier'), 'the order page cannot see who does the delivery');
});
