'use strict';

// ---------------------------------------------------------------------------
// THE CARD PAGE SAVES CARDS, AND ONLY CARDS.
//
// Order #2060, 12 September: a customer saved Link rather than a card, was
// charged $84.00 off-session at the laundromat three hours later, and their
// bank refused it. Because a wallet carries no card object we could not even
// name the card back to them - their text said "your card" instead of "your
// Visa ending 4242".
//
// Neither surface listed its payment method types, so both offered whatever the
// Stripe account had switched on. Asked directly that day, the hosted page was
// offering card, Klarna, Link, Cash App Pay and Amazon Pay, and our own page
// was additionally offering Bancontact, Kakao Pay and Naver Pay.
//
// THIS TEST READS THE SOURCE, which is unusual here and deliberate. What is
// worth protecting is one argument on two Stripe calls, and the failure it
// prevents is somebody deleting it in a tidy-up with nothing going wrong until
// a charge is refused days later on somebody else's order. A test that really
// called Stripe would need the network and a live account; this needs neither
// and guards the same line.
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'providers', 'payments', 'stripe.js'),
  'utf8'
);

// The body of one function, brace-balanced from its declaration.
function bodyOf(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} is gone from the Stripe provider`);

  // Step over the parameter list first. A destructured argument opens a brace
  // of its own, so the first { after the name is not the body - reading from
  // there stops at the end of the signature and every assertion below would
  // then be passing on nothing.
  let parens = 0;
  let i = source.indexOf('(', start);
  for (; i < source.length; i += 1) {
    if (source[i] === '(') parens += 1;
    else if (source[i] === ')') {
      parens -= 1;
      if (parens === 0) break;
    }
  }

  let depth = 0;
  for (i = source.indexOf('{', i); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  throw new Error(`could not read the body of ${name}`);
}

// The same body with the comment lines dropped.
//
// The comments in this codebase explain the decisions being tested, and
// createSetupIntent's says the words "automatic payment methods" while
// explaining why that is gone. A test searching the raw text would forbid
// writing down its own reason for existing.
function codeOf(name) {
  return bodyOf(name)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const SURFACES = [
  ['the hosted card page', 'createSetupLink'],
  ['the card field on our own page', 'createSetupIntent'],
];

for (const [what, fn] of SURFACES) {
  test(`${what} names cards and nothing else`, () => {
    assert.ok(
      codeOf(fn).includes("payment_method_types: ['card']"),
      `${fn} no longer restricts itself to cards, so somebody can save a thing we cannot charge later`
    );
  });

  test(`${what} does not hand the choice back to the account's settings`, () => {
    // automatic_payment_methods offers whatever is switched on in the Stripe
    // dashboard, which is how Bancontact reached a Bergen County laundry round.
    // Turning it back on has to be a decision, not a merge.
    assert.ok(
      !codeOf(fn).includes('automatic_payment_methods'),
      `${fn} is back to offering whatever the Stripe account has enabled`
    );
  });
}

test('the saved card is still marked for charging while nobody is there', () => {
  // Dropping this would make every saved card unusable at the weigh-in, which
  // is the one moment it exists for.
  assert.ok(codeOf('createSetupIntent').includes("usage: 'off_session'"));
});

test('the reader really reads a body, not a signature', () => {
  // The bug this test had on its first run: the brace balancer started at the
  // destructured parameter list, so every assertion above was searching the
  // function's signature and passing on an empty string.
  assert.ok(bodyOf('createSetupIntent').includes('setupIntents.create'));
  assert.ok(bodyOf('createSetupLink').includes('checkout.sessions.create'));
});
