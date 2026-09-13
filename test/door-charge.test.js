'use strict';

// ---------------------------------------------------------------------------
// THE CARD IS CHARGED AT THE DOOR, AND THE BAGS DO NOT MOVE IF IT IS REFUSED.
//
// Neil, 12 September, after order #2060 was refused $84.00 while three bags
// were already sitting on a laundromat floor: charge when the driver has
// weighed them, and "if the card is declined... we left it where we found it...
// we can pick up same time tomorrow."
//
// Nothing here touches the database or Stripe. What is pinned is the two
// sentences a customer reads and the guard that decides whether a pickup can be
// put back on a doorstep at all.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { doorTotalText, leftAtDoorText } = require('../src/core/fulfilment');
const orders = require('../src/core/orders');

const CARD = {
  stripe_customer_id: 'cus_x',
  default_payment_method_id: 'pm_x',
  card_brand: 'visa',
  card_last4: '4242',
};

// --- It cleared -------------------------------------------------------------

test('the total names the weight, the rate and what came off', () => {
  const text = doorTotalText({
    weight: 15,
    beforeDiscount: 3000,
    priceCents: 1500,
    deal: { cents: 1500, promotion: { blurb: '50% off your first order' } },
    minimumApplied: false,
    customer: CARD,
  });

  assert.equal(
    text,
    'Your laundry weighed 15 lb, so that is $30.00 at $2.00 a pound. ' +
      '50% off your first order takes $15.00 off, so the total is $15.00. ' +
      'Charged to your Visa ending 4242. Back with you the next day.'
  );
});

test('it uses the promotion blurb, never its internal name', () => {
  // The name is "CLEAN50 - 50% off first order" and a customer must never read
  // it. Same rule the AI has always followed.
  const text = doorTotalText({
    weight: 15,
    beforeDiscount: 3000,
    priceCents: 1500,
    deal: { cents: 1500, promotion: { name: 'CLEAN50 - 50% off first order', blurb: '50% off your first order' } },
    minimumApplied: false,
    customer: CARD,
  });

  assert.ok(!text.includes('CLEAN50'), text);
});

test('with no promotion it says the total once, not twice', () => {
  const text = doorTotalText({
    weight: 20,
    beforeDiscount: 4000,
    priceCents: 4000,
    deal: null,
    minimumApplied: false,
    customer: CARD,
  });

  assert.equal(text.match(/\$40\.00/g).length, 1, `the figure is repeated: ${text}`);
});

test('the minimum is explained when it is what set the price', () => {
  // "10 lb, so the total is $25.00 at $2.00 a pound" is arithmetic a customer
  // can see is wrong.
  const text = doorTotalText({
    weight: 10,
    beforeDiscount: 2500,
    priceCents: 2500,
    deal: null,
    minimumApplied: true,
    customer: CARD,
  });

  assert.match(text, /under our \$25\.00 minimum/);
  assert.ok(!text.includes('a pound'), text);
});

// --- It was refused ---------------------------------------------------------

test('the doorstep refusal says the weight, the total, and that the bags stayed', () => {
  const text = leftAtDoorText({
    weight: 84,
    priceCents: 8400,
    needsCard: false,
    destination: 'at lyndry.com/account - sign in with this number.',
  });

  assert.match(text, /weighed 84 lb/);
  assert.match(text, /\$84\.00/);
  assert.match(text, /nothing has been taken/);
  assert.match(text, /left the bags where we found them/);
  assert.match(text, /same time tomorrow/);
});

test('no card on file reads as adding one, not updating one', () => {
  const text = leftAtDoorText({
    weight: 84,
    priceCents: 8400,
    needsCard: true,
    destination: 'here: https://lyndry.com/pay/abc',
  });

  assert.match(text, /don't have a card on file/);
  assert.match(text, /Add one here/);
});

test('both refusals are plain ASCII and inside two segments', () => {
  for (const needsCard of [true, false]) {
    const text = leftAtDoorText({
      weight: 84,
      priceCents: 8400,
      needsCard,
      destination: 'here: https://lyndry.com/pay/UtDU92aemeozUtDjCIp7wsjT',
    });
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[^\x00-\x7F]/.test(text), `non-ASCII: ${text}`);
    assert.ok(text.length <= 306, `${text.length} characters is over two segments`);
  }
});

// --- Putting the pickup back ------------------------------------------------

test('a pickup with the driver still at the door can be put back', () => {
  assert.equal(orders.uncollectable({ status: 'IN_PROCESS' }), null);
});

test('nothing that has actually left the doorstep can be', () => {
  // The bags are somewhere else by then, so "we left it where we found it" is
  // not a thing that can be said about them.
  assert.ok(orders.uncollectable({ status: 'IN_PROCESS', van_confirmed_at: 'x' }));
  assert.ok(orders.uncollectable({ status: 'IN_PROCESS', at_partner_at: 'x' }));
  assert.ok(orders.uncollectable({ status: 'IN_PROCESS', delivered_at: 'x' }));
  assert.ok(orders.uncollectable({ status: 'REQUESTED' }));
  assert.ok(orders.uncollectable(null));
});

test('the state machine still refuses to un-collect on its own', () => {
  // IN_PROCESS -> REQUESTED is deliberately not a transition. Same shape as
  // reinstate(): only a named function may do it, never transition().
  assert.ok(!orders.ALLOWED_NEXT.IN_PROCESS.includes('REQUESTED'));
});
