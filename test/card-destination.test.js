'use strict';

// ---------------------------------------------------------------------------
// WHERE WE SEND SOMEBODY TO FIX A CARD, AND WHY IT DEPENDS ON THE DOOR.
//
// Neil, 12 September, on order #2060: the customer placed the order on the
// website, saved a card on the website, and was then texted a link asking him
// to update it. "We're switching between two platforms... this can just come
// off as spam."
//
// An unsolicited text carrying a link that asks for card details is the shape
// of a phishing message, whoever sent it. So a web customer is sent back to
// the website, and a thread customer - who has a conversation with us and no
// account they have ever signed into - keeps the link, because in that thread
// a link is the natural continuation.
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const billing = require('../src/core/billing');
const { site } = require('../src/web/site');
const { chaseMessage } = require('../src/core/payment-chase');

const LINK = 'https://lyndry.com/pay/UtDU92aemeozUtDjCIp7wsjT';

test('a web order is sent to its own account, with no token to tap', () => {
  const tail = billing.cardDestination({ placed_via: 'WEB' }, LINK);

  assert.ok(tail.includes(`${site.domain}/account`), tail);
  assert.ok(!tail.includes(LINK), 'a payment link reached a web customer');
  assert.match(tail, /sign in with this number/);
});

test('a thread order keeps the link', () => {
  assert.equal(billing.cardDestination({ placed_via: 'THREAD' }, LINK), `here: ${LINK}`);
});

test('a phone order keeps the link too', () => {
  // Somebody who rang up has used neither the thread nor the website, so
  // sending them off to sign in is friction against a problem they do not have.
  assert.equal(billing.cardDestination({ placed_via: 'PHONE' }, LINK), `here: ${LINK}`);
});

test('an order from before the column behaves exactly as it always did', () => {
  // The safe direction: unknown falls back to what every order used to get.
  assert.equal(billing.cardDestination({ placed_via: null }, LINK), `here: ${LINK}`);
  assert.equal(billing.cardDestination({}, LINK), `here: ${LINK}`);
  assert.equal(billing.cardDestination(null, LINK), `here: ${LINK}`);
});

test('it is a sentence tail, so the caller says what went wrong', () => {
  // "Your card was declined. Update it ..." and "We don't have a card on file.
  // Add one ..." are the same destination from two different problems.
  const web = billing.cardDestination({ placed_via: 'WEB' }, null);
  const thread = billing.cardDestination({ placed_via: 'THREAD' }, LINK);

  for (const tail of [web, thread]) {
    assert.ok(/^(at|here)[: ]/.test(tail), `does not read as a tail: ${tail}`);
    assert.ok(tail.endsWith('.') || tail.endsWith(LINK), tail);
  }
});

test('no Stripe session is minted for somebody who will not be sent one', () => {
  assert.equal(billing.wantsPaymentLink({ placed_via: 'WEB' }), false);
  assert.equal(billing.wantsPaymentLink({ placed_via: 'THREAD' }), true);
  assert.equal(billing.wantsPaymentLink({ placed_via: null }), true);
  assert.equal(billing.wantsPaymentLink(null), true);
});

test('the payment chase follows the same rule', () => {
  const web = chaseMessage({ order_number: 2060, price_cents: 8400, placed_via: 'WEB' }, null);
  const thread = chaseMessage({ order_number: 2060, price_cents: 8400, placed_via: 'THREAD' }, LINK);

  assert.ok(web.includes(`${site.domain}/account`), web);
  assert.ok(!web.includes('null'), `a missing link leaked into the message: ${web}`);
  assert.ok(thread.includes(LINK), thread);
});
