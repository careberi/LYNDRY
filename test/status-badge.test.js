'use strict';

// ---------------------------------------------------------------------------
// AWAITING CARD MUST MEAN WE ARE ACTUALLY WAITING FOR A CARD.
//
// Neil, 14 September, looking at Trisha Sledzikowski's page: a 15 September
// pickup badged AWAITING CARD directly under a panel reading "visa ending
// 1982", on an order whose payment column said WAIVED.
//
// TWO SEPARATE FAULTS MET ON ONE ROW.
//
//   1. The customer page's order query selected order columns only, so the
//      badge was handed an order with no customer on it. needsCardOnFile({})
//      is true - an empty object has no payment method - so EVERY waiting
//      order on EVERY customer page read AWAITING CARD, whatever card that
//      customer had. The orders board said BOOKED for the same rows, because
//      its own query does embed the customer. Ninth time an unselected column
//      has decided what a screen can know.
//
//   2. Even with the customer loaded, a WAIVED order would have asked the card
//      question at all. Waived means we have decided not to charge, so there is
//      nothing to wait for - the same distinction dispatch.collectable() draws
//      when it says nothing to charge is not the same as cannot charge.
//
// Nothing acted on this badge: the route, the collection and the reminders all
// read the rule from the customer directly. What it cost was a person being
// sent to chase a customer who owed nothing.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { statusBadge } = require('../src/routes/admin');

const withCard = { stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_1' };
const noCard = { stripe_customer_id: 'cus_1', default_payment_method_id: null };

const says = (html) => (/AWAITING CARD/.test(html) ? 'AWAITING CARD' : /BOOKED/.test(html) ? 'BOOKED' : html);

// --- fault one: the badge could not see the card ----------------------------

test('A CUSTOMER WITH A USABLE CARD DOES NOT SHOW AWAITING CARD', () => {
  // Neil's fix, in one line. This is the assertion that would have failed on
  // his screen and passed on the orders board beside it.
  const order = { status: 'REQUESTED', payment_status: 'UNPAID', customers: withCard };
  assert.equal(says(statusBadge('REQUESTED', order)), 'BOOKED');
});

test('and one with no card still does, because the badge has to still work', () => {
  const order = { status: 'REQUESTED', payment_status: 'UNPAID', customers: noCard };
  assert.equal(says(statusBadge('REQUESTED', order)), 'AWAITING CARD');
});

test('a half-saved customer is not a card', () => {
  // A Stripe customer exists the moment somebody opens the card page and
  // abandons it. Reading that as a saved card is how #2063 would have been
  // collected from.
  const order = {
    status: 'REQUESTED',
    payment_status: 'UNPAID',
    customers: { stripe_customer_id: 'cus_1' },
  };
  assert.equal(says(statusBadge('REQUESTED', order)), 'AWAITING CARD');
});

// --- fault two: settled money is not a card question ------------------------

test('A WAIVED ORDER NEVER SAYS AWAITING CARD, card or no card', () => {
  // The live row: Tue 15 Sep, WAIVED. Waived means we have decided not to
  // charge, so there is nothing to wait for.
  for (const customers of [withCard, noCard, {}]) {
    const order = { status: 'REQUESTED', payment_status: 'WAIVED', customers };
    assert.equal(says(statusBadge('REQUESTED', order)), 'BOOKED', JSON.stringify(customers));
  }
});

test('and neither does a PAID one', () => {
  // Cash at the door leaves an order PAID whose customer may have no card at
  // all. Asking them for one afterwards is asking for money already received.
  for (const customers of [withCard, noCard, {}]) {
    const order = { status: 'REQUESTED', payment_status: 'PAID', customers };
    assert.equal(says(statusBadge('REQUESTED', order)), 'BOOKED', JSON.stringify(customers));
  }
});

// --- the badge and the round must not disagree ------------------------------

test('THE CARD HALF IS THE ROUTES OWN RULE, not a second copy of it', () => {
  // A badge that answered differently from collectable() would be telling
  // somebody the opposite of what the round is actually doing.
  const dispatch = require('../src/core/dispatch');

  for (const customers of [withCard, noCard]) {
    for (const payment_status of ['UNPAID', 'FAILED']) {
      const order = { status: 'REQUESTED', payment_status, customers };
      assert.equal(
        says(statusBadge('REQUESTED', order)) === 'BOOKED',
        dispatch.collectable(order),
        JSON.stringify({ payment_status, customers })
      );
    }
  }
});

// --- anything that is not REQUESTED is untouched ----------------------------

test('the card question is only asked of an order still waiting to be collected', () => {
  for (const status of ['IN_PROCESS', 'AT_PARTNER', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    const html = statusBadge(status, { status, payment_status: 'UNPAID', customers: noCard });
    assert.ok(!/AWAITING CARD/.test(html), status);
  }
});

test('and a badge with no order at all does not crash', () => {
  assert.ok(statusBadge('REQUESTED'));
  assert.ok(statusBadge('DELIVERED'));
});

// --- the select list, which is the half that fails silently -----------------

test('THE CUSTOMER PAGE LOADS THE CUSTOMER WITH EACH ORDER', () => {
  // The whole of fault one. Without the embed the badge reads an empty object
  // and says AWAITING CARD for everybody, and it does not throw - which is why
  // it sat there until somebody noticed a contradiction on their own screen.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  const at = src.indexOf("router.get('/ops/customers/:id'");
  assert.notEqual(at, -1);

  const route = src.slice(at, at + 20000);

  // ANCHORED ON THE QUERY, NOT ON THE FIRST COLUMN IN IT. This pinned the
  // literal "'id, status, pickup_date" and broke the day the list learned to
  // select an order number - which is a change that could not possibly
  // reintroduce the bug it is guarding. A test that fails for the wrong reason
  // is one somebody loosens rather than reads.
  const q = route.indexOf(".from('orders')");
  assert.notEqual(q, -1, 'the order history query has moved');

  const block = route.slice(q, route.indexOf('.eq(', q));
  assert.match(block, /customers\(/, 'the order history query does not load the customer');
  assert.match(block, /default_payment_method_id/, 'it does not load what needsCardOnFile reads');
  assert.match(block, /stripe_customer_id/, 'it does not load what needsCardOnFile reads');
});
