'use strict';

// ---------------------------------------------------------------------------
// ASKING SOMEBODY TO REPLACE A CARD THAT DOES NOT WORK.
//
// Neil, 13 September: "I should have a button in the order page - to send a
// text message link to update their payment method. or a text message link
// with instructions on how to update their payment method online."
//
// It is the gap order #2060 left: the only button that minted a card link was
// the nudge, and that one only shows for somebody with NO payment method at
// all - so the one case where you actually want to ask was the one case with
// no way to ask.
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { updateCardText } = require('../src/core/billing');

const LINK = 'here: https://lyndry.com/pay/zZyU4MzZN10UJccgk-iKYldS';
const ACCOUNT = 'at lyndry.com/account - sign in with this number.';

test('it names the order and the amount, because that is question one', () => {
  // A text asking for card details that does not say what it is about is
  // indistinguishable from a phishing message.
  const text = updateCardText({ orderNumber: 2060, priceCents: 8400, destination: LINK });

  assert.match(text, /#2060/);
  assert.match(text, /\$84\.00/);
});

test('it says nothing has been taken, because that is question two', () => {
  // Leaving it out turns a request into an accusation.
  const text = updateCardText({ orderNumber: 2060, priceCents: 8400, destination: LINK });
  assert.match(text, /nothing has been taken/i);
});

test('it is not the first-card sentence, which is a different conversation', () => {
  // setupLinkMessage() opens "Before your first pickup we need a card on file"
  // and goes to somebody who has never given us one. Sent to a customer whose
  // card was just refused it reads as though we have lost track of them.
  const text = updateCardText({ orderNumber: 2060, priceCents: 8400, destination: LINK });
  assert.ok(!/first pickup/i.test(text), text);
});

test('it carries whichever destination the door decided', () => {
  const thread = updateCardText({ orderNumber: 2060, priceCents: 8400, destination: LINK });
  const web = updateCardText({ orderNumber: 2060, priceCents: 8400, destination: ACCOUNT });

  assert.ok(thread.endsWith(LINK), thread);
  assert.ok(web.endsWith(ACCOUNT), web);
  assert.ok(!web.includes('lyndry.com/pay/'), 'a payment link reached a web customer');
});

test('an order with nothing owed asks without naming a figure', () => {
  // A card replaced before anything is weighed has no total to quote, and
  // inventing one would be the only wrong thing this message could do.
  const text = updateCardText({ orderNumber: 2061, priceCents: null, destination: ACCOUNT });

  assert.match(text, /#2061/);
  assert.ok(!/\$/.test(text), text);
  assert.match(text, /nothing has been taken/i);
});

test('both versions are plain ASCII and one segment', () => {
  for (const destination of [LINK, ACCOUNT]) {
    const text = updateCardText({ orderNumber: 2060, priceCents: 8400, destination });
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[^\x00-\x7F]/.test(text), `non-ASCII: ${text}`);
    assert.ok(text.length <= 160, `${text.length} characters is more than one segment`);
  }
});
