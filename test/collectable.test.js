'use strict';

// ---------------------------------------------------------------------------
// NO CARD MEANS NO COLLECTION.
//
// Neil, 13 September, on order #2063 sitting on the next morning's board badged
// AWAITING CARD: "no card means no collection, she is off the route."
//
// It closes a gap CLAUDE.md already claimed was closed. The board has badged
// unbillable orders for a long time and the note beside that badge said it was
// "what keeps an unbillable order off the driver's run sheet" - but nothing
// read it. Neither dispatch nor the run looked at a card at all. The badge was
// a label, and a driver would have been sent to a doorstep at 8am for laundry
// that could not be billed.
//
// The two halves have to move together: the route leaves the stop out, AND
// collect() refuses it. A screen that hides a control while the route behind it
// still fires is not a guard - the same rule the reconciliation refusal keeps.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { collectable } = require('../src/core/dispatch');

const withCard = { stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_1' };
const noCard = { stripe_customer_id: 'cus_1', default_payment_method_id: null };

test('a card on file is collectable', () => {
  assert.equal(collectable({ payment_status: 'UNPAID', customers: withCard }), true);
});

test('NO CARD IS NOT, WHICH IS THE WHOLE POINT', () => {
  assert.equal(collectable({ payment_status: 'UNPAID', customers: noCard }), false);
});

test('A WAIVED ORDER IS COLLECTED WHATEVER IT HOLDS', () => {
  // Nothing to charge is not the same as cannot charge, and confusing the two
  // would strand exactly the customers we have decided to do a favour for.
  assert.equal(collectable({ payment_status: 'WAIVED', customers: noCard }), true);
});

test('a half-saved customer is not a card', () => {
  // A Stripe customer exists the moment somebody opens the card page. Reading
  // that as a saved card is how #2063 would have been collected anyway.
  assert.equal(
    collectable({ payment_status: 'UNPAID', customers: { stripe_customer_id: 'cus_1' } }),
    false
  );
  assert.equal(
    collectable({ payment_status: 'UNPAID', customers: { default_payment_method_id: 'pm_1' } }),
    false
  );
});

test('a missing customer is refused rather than crashing', () => {
  assert.equal(collectable({ payment_status: 'UNPAID' }), false);
  assert.equal(collectable(null), false);
});

test('AN ORDER ALREADY PAID FOR STAYS COLLECTABLE', () => {
  // Not a case that happens on the pickup leg today, but the rule is about
  // whether we CAN bill, and a paid order plainly could be.
  assert.equal(collectable({ payment_status: 'PAID', customers: withCard }), true);
});
