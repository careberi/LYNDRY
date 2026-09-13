'use strict';

// ---------------------------------------------------------------------------
// ASKING SOMEBODY TO REPLACE A CARD THAT DOES NOT WORK.
//
// Neil, 13 September: "I should have a button in the order page - to send a
// text message link to update their payment method." It is the gap order #2060
// left: the only button that minted a card link was the nudge, and that one
// only shows for somebody with NO payment method at all, so the one case where
// you actually want to ask was the one case with no way to ask.
//
// Then, after Shamar's phone went to voicemail: "give me the link to just
// update it in the text as well... tell him that the payment method is needed
// in order for the laundry to go out for delivery."
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { updateCardText, holdingItBack } = require('../src/core/billing');
const { site } = require('../src/web/site');

const PAY_URL = 'https://lyndry.com/pay/zZyU4MzZN10UJccgk-iKYldS';
const held = (over = {}) =>
  updateCardText({ orderNumber: 2060, priceCents: 8400, url: PAY_URL, holding: true, ...over });

test('it names the order and the amount, because that is question one', () => {
  // A text asking for card details that does not say what it is about is
  // indistinguishable from a phishing message.
  assert.match(held(), /#2060/);
  assert.match(held(), /\$84\.00/);
});

test('it says nothing has been taken, because that is question two', () => {
  // Leaving it out turns a request into an accusation.
  assert.match(held(), /nothing has been taken/i);
});

test('it is not the first-card sentence, which is a different conversation', () => {
  // setupLinkMessage() opens "Before your first pickup we need a card on file"
  // and goes to somebody who has never given us one. Sent to a customer whose
  // card was just refused it reads as though we have lost track of them.
  assert.ok(!/first pickup/i.test(held()), held());
});

test('IT CARRIES BOTH ROUTES: the link to tap and the address to type', () => {
  // The exception to the door rule, and the only message that is. Everything
  // the system sends on its own still points a web customer at their account -
  // this one is pressed by a person who is already chasing somebody, where
  // signing in with a texted code is real friction. The typeable address stays
  // beside it so the cautious reader still has the safe route.
  const text = held();
  assert.ok(text.includes(PAY_URL), text);
  assert.ok(text.includes(`${site.domain}/account`), text);
});

test('it says why while the laundry is still ours', () => {
  // Neil's rule: "we just need the payment method updated before we make
  // delivery." Saying so is the difference between a request and a mystery.
  assert.match(held(), /before your laundry can go out for delivery/i);
});

test('and does NOT once the laundry is back with them', () => {
  // By then it would be a threat about nothing.
  const delivered = held({ holding: false });
  assert.ok(!/go out for delivery/i.test(delivered), delivered);
  assert.ok(delivered.includes(PAY_URL), delivered);
});

test('IT ASKS FOR A PAYMENT METHOD, NOT A CARD', () => {
  // Shamar never saved a card - he saved a Link wallet, which is why we hold
  // no brand and no last four for him. "Your card" names something he does
  // not have, and the same is true of anybody paying by wallet.
  for (const text of [held(), held({ priceCents: null })]) {
    assert.ok(!/card/i.test(text), `still says card: ${text}`);
  }
});

test('THE REASON IS ONLY CLAIMED WHILE IT IS TRUE, AND OUT_FOR_DELIVERY IS NOT', () => {
  // The van is on its way back with it. Saying "before your laundry can go out
  // for delivery" there promises to withhold something already gone, and
  // contradicts the standing rule that a declined card never holds up a
  // delivery. IN_OUR_HANDS counts it; this sentence must not.
  assert.ok(holdingItBack('IN_PROCESS'));
  assert.ok(holdingItBack('AT_PARTNER'));
  assert.ok(holdingItBack('READY'));
  assert.ok(!holdingItBack('OUT_FOR_DELIVERY'), 'the van has already left');
  assert.ok(!holdingItBack('DELIVERED'));
  assert.ok(!holdingItBack('REQUESTED'));
});

test('it is asked for, never threatened', () => {
  // "We need a card before it can go back out" is something they can act on.
  // Anything about keeping their clothes is a standoff, and a standoff by text
  // is the one that goes badly.
  for (const text of [held(), held({ holding: false })]) {
    assert.ok(!/\b(hold|holding|keep|keeping|until you pay|refuse)\b/i.test(text), text);
  }
});

test('an order with nothing owed asks without naming a figure', () => {
  // A card replaced before anything is weighed has no total to quote, and
  // inventing one would be the only wrong thing this message could do.
  const text = held({ priceCents: null });
  assert.match(text, /#2060/);
  assert.ok(!/\$/.test(text), text);
});

test('no link means the account on its own, and never the word "null"', () => {
  const text = updateCardText({ orderNumber: 2060, priceCents: 8400, url: null, holding: true });
  assert.ok(!text.includes('null'), text);
  assert.match(text, /sign in with this number/);
});

test('every version is plain ASCII and inside two segments', () => {
  // It grew past one segment when it gained the link and the reason. Two is the
  // ceiling: a third is money on every send for a sentence nobody asked for.
  for (const text of [held(), held({ holding: false }), held({ priceCents: null })]) {
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[^\x00-\x7F]/.test(text), `non-ASCII: ${text}`);
    assert.ok(text.length <= 306, `${text.length} characters is over two segments`);
  }
});
