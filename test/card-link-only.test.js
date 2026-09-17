'use strict';

// ---------------------------------------------------------------------------
// THE LINK ON ITS OWN, WITH NO SENTENCE AROUND IT.
//
// Neil's ask, 16 September: a button on the customer page and in the send area
// of a conversation that texts THE SAME /pay address the card row already
// mints, with nothing else in the message, and shows him the whole address
// afterwards so he can copy it.
//
// TWO DOORS ONTO ONE LINK, WHICH IS THE WHOLE POINT. What must never happen is
// a second way of MAKING a link - a second token, a second payment_links row, a
// second thing the webhook has to recognise. billing.createSetupLink() is the
// one minting path and this uses it, exactly as "Ask for a card", the AI and
// the website do.
//
// AND THE OLD TEMPLATE STAYS. He said so in as many words. This is a second
// door, not a replacement for the sentence.
//
// SAID OUT LOUD BECAUSE IT IS A REAL COST: a text that is nothing but a URL is
// the shape carriers score hardest in 10DLC filtering, and the shape a phishing
// message takes. It is a button a person presses - the same exception
// updateCardText() already makes - and nothing automatic may reach for it.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const intake = require('../src/core/intake');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(line))
    .join('\n');

const ROUTE = () => {
  const src = withoutComments(SRC('routes', 'admin.js'));
  const from = src.indexOf("router.post('/ops/customers/:id/card-link'");
  assert.ok(from > 0, 'the route is gone');
  return src.slice(from, src.indexOf('\nrouter.', from + 10));
};

// --- one link, minted one way -----------------------------------------------

test('it mints the same link "Ask for a card" mints', () => {
  const route = ROUTE();

  assert.ok(route.includes('billing.createSetupLink(person)'), route.slice(0, 600));

  // A second way of making one would be a second token, a second payment_links
  // row and a second thing the webhook has to recognise.
  assert.ok(!/crypto\.randomBytes/.test(route), 'it mints a token of its own');
  assert.ok(!/payment_links/.test(route), 'it writes its own link row');
});

test('the link is minted on the press, never when a page is drawn', () => {
  // A Stripe session lives about a day, so one made when the page was drawn is
  // a dead page by the time anybody taps it - and drawing the page would leave
  // a trail of sessions behind.
  const admin = withoutComments(SRC('routes', 'admin.js'));
  const gets = admin.split('\n').filter((l) => /createSetupLink/.test(l));

  for (const line of gets) {
    assert.ok(!/router\.get/.test(line), `a GET mints a link: ${line}`);
  }
});

// --- the message is the URL and nothing else --------------------------------

test('nothing is wrapped around the URL', () => {
  const route = ROUTE();

  // The whole ask in one line: the body handed to notify is `url`, bare.
  assert.ok(
    /sendAndLog\(person\.phone,\s*url,\s*person\.id,/.test(route),
    'the message is not the bare url'
  );

  // No template literal building a sentence out of it anywhere before the send.
  const beforeSend = route.slice(0, route.indexOf('sendAndLog'));
  assert.ok(!/`\$\{url\}/.test(beforeSend), 'something is being built around the link');
});

test('it goes through notify, like every other outbound', () => {
  const route = ROUTE();

  assert.ok(route.includes('notify'), route.slice(0, 400));
  assert.ok(!/sms\.sendMessage/.test(route), 'it reaches past notify to the carrier');
});

test('it is not stamped sent_by', () => {
  // A person pressed a button; nobody is working the thread by hand. sent_by is
  // what puts brain.js into its handover behaviour.
  assert.ok(!ROUTE().includes('sentBy'), 'the bare link stamps sent_by');
});

test("it says it asked for a card, so the table can say it is waiting", () => {
  assert.ok(ROUTE().includes("askedFor: 'card'"), 'the card row will not say it was asked');
});

// --- who it refuses ----------------------------------------------------------

test('an opted-out number is refused before anything is minted or sent', () => {
  const route = ROUTE();

  const refusal = route.indexOf("'UNSUBSCRIBED'");
  const mint = route.indexOf('createSetupLink');
  const send = route.indexOf('sendAndLog');

  assert.ok(refusal > 0, 'STOP is not checked at all');
  assert.ok(refusal < mint, 'a link is minted for somebody who opted out');
  assert.ok(refusal < send, 'the opt-out check is after the send');
});

test('with payments switched off it says so rather than throwing Stripe at somebody', () => {
  const route = ROUTE();

  const off = route.indexOf('paymentsConfigured()');
  assert.ok(off > 0, 'it does not check whether there is a payment provider');
  assert.ok(off < route.indexOf('createSetupLink'), 'it mints before it checks');
});

test('the redirect it comes back to cannot be built out of whatever was posted', () => {
  // An open redirector on our own domain is a ready-made phishing link.
  const route = ROUTE();

  assert.ok(/\\d\{10,15\}\$\/\.test\(thread\)/.test(route), route.slice(0, 900));
});

// --- he gets the address back -----------------------------------------------

test('the whole address comes back on screen, not the word "sent"', () => {
  const route = ROUTE();

  const done = route.slice(route.indexOf("said('done'"));
  assert.ok(done.includes('${url}'), done.slice(0, 200));
});

test('a refused send still hands back the link rather than losing it', () => {
  const route = ROUTE();
  const refused = route.slice(route.indexOf('sent.refused'));

  assert.ok(refused.includes('${url}'), refused.slice(0, 300));
});

// --- two buttons, two names --------------------------------------------------

test('the table asks in words and the button sends a link, and they are named apart', () => {
  const card = intake.FIELDS.find((f) => f.key === 'card');

  assert.equal(card.ask, 'Ask for a card');
  assert.equal(card.update, 'Ask them to update it');

  // Two controls a thumb apart reading the same words and sending different
  // messages is the sort of thing somebody presses once and then distrusts.
  assert.ok(!/send card link/i.test(card.ask + card.update), `${card.ask} / ${card.update}`);
});

test('the old template is untouched and still carries its sentence', () => {
  // Neil: keep the old ASK FOR A CARD template. It is what the AI, the website
  // and the card row all send, and none of them changed.
  const billing = withoutComments(SRC('core', 'billing.js'));
  const fn = billing.slice(billing.indexOf('async function setupLinkMessage'));

  assert.ok(/Before your first pickup we need a card on file/.test(fn), fn.slice(0, 400));
  assert.ok(/charged after we weigh it/.test(fn), fn.slice(0, 400));
});

// --- where it is, and where it is not ---------------------------------------

test('it is on the customer page and in the conversation send area, and nowhere else', () => {
  const admin = withoutComments(SRC('routes', 'admin.js'));
  const buttons = (admin.match(/>Send card link</g) || []).length;

  assert.equal(buttons, 2, 'the button is not in exactly the two places Neil asked for');
});

test('nothing automatic reaches for the bare link', () => {
  // The exception is a person pressing a button. Everything the system sends on
  // its own still says what the link is for in the same breath - see
  // billing.cardDestination().
  for (const file of [
    ['core', 'card-chase.js'],
    ['core', 'payment-chase.js'],
    ['core', 'fulfilment.js'],
    ['core', 'reminders.js'],
    ['core', 'leads.js'],
  ]) {
    const src = withoutComments(SRC(...file));
    assert.ok(
      !/card-link/.test(src),
      `${file.join('/')} reaches for the bare card link`
    );
  }
});
