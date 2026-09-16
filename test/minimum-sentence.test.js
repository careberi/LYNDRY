'use strict';

// ---------------------------------------------------------------------------
// THE MINIMUM IS $25, AND A PAID WASH OPTION DOES NOT MOVE IT.
//
// Audit finding #4. The minimum is a floor on what a small wash is worth; a
// $2 fragrance-free option is separate work that sits on top of it. Three
// sentences described that and only one of them described it correctly.
//
//   recordWeight    right - named the floor, named the surcharge separately
//   settleWeight    asked `beforeDiscount > byWeight`, so a 13 lb load at
//                   $26.00 plus a $2.00 option came to $28.00, 28 > 26 was
//                   true, and the customer was told their order was UNDER a
//                   minimum they were $3 over
//   doorTotalText   asked the right question and printed the wrong number:
//                   "under our $27.00 minimum", where $27 is the bill
//
// Both wrong copies now call the one that was right. What this file pins is
// the arithmetic in the sentence, because that is what a customer checks.
//
// Nothing here touches the database, Stripe or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { config } = require('../src/config');

const SRC = fs
  .readFileSync(path.join(__dirname, '..', 'src', 'core', 'fulfilment.js'), 'utf8')
  .split('\r\n')
  .join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// --- one owner --------------------------------------------------------------

test('THERE IS ONE SENTENCE ABOUT A PRICE, NOT THREE', () => {
  const code = withoutComments(SRC);

  assert.match(code, /function pricedSentence\(/, 'the shared sentence has gone');

  // Every caller goes through it. Three copies of a sentence about somebody's
  // bill is three chances to be wrong about it, which is how this happened.
  // The declaration matches the same shape, so it comes out first.
  const calls = (code.split('function pricedSentence({').join('').match(/pricedSentence\(\{/g) || [])
    .length;
  assert.equal(calls, 3, `expected three callers, found ${calls}`);

  // And nobody builds the minimum clause by hand any more.
  const strays = code.split('\n').filter((l) => /under our/.test(l) && !/pricedSentence/.test(l));
  assert.deepEqual(
    strays.map((s) => s.trim()).filter((s) => !s.startsWith('return `${opening}, which is under our')),
    [],
    'a minimum sentence is still written out by hand'
  );
});

test('THE BROKEN PREDICATE IS GONE', () => {
  // `beforeDiscount > byWeight` is true for any order carrying a surcharge,
  // whatever it weighs, which is why it claimed the minimum on a 13 lb load.
  const code = withoutComments(SRC);
  assert.ok(
    !/beforeDiscount > byWeight/.test(code),
    'the minimum is still decided by comparing the bill to the pounds'
  );
});

test('and the minimum clause names the floor, never the bill', () => {
  const code = withoutComments(SRC);
  const at = code.indexOf('function pricedSentence');
  const body = code.slice(at, code.indexOf('\n}', at));

  assert.match(body, /money\(floor\)/, 'the minimum clause does not name the floor');
  assert.ok(
    !/under our \$\{money\(beforeDiscount\)\}/.test(body),
    'the bill is still being called the minimum'
  );
});

// --- what the customer reads ------------------------------------------------

// THE REAL FUNCTION, NOT A COPY OF IT.
//
// The first version of this file re-declared pricedSentence() here so it could
// run standalone. That made every assertion below worthless: the predicate
// could be broken in fulfilment.js and this file would still pass, because it
// was reading its own copy. Caught by deliberately breaking the real one and
// watching the suite stay green.
const { pricedSentence } = require('../src/core/fulfilment');

const money = (c) => `$${(c / 100).toFixed(2)}`;

const say = (lb, surcharge) => {
  const floor = config.pricing.minimumCents;
  const byWeight = lb * config.pricing.perPoundCents;
  const total = Math.max(byWeight, floor) + surcharge;
  return {
    total,
    text: pricedSentence({
      opening: `Your laundry weighed ${lb} lb`,
      byWeight,
      floor,
      surcharge,
      total,
      perPound: '$2.00 a pound',
    }),
  };
};

test('AN ORDER OVER THE MINIMUM IS NEVER TOLD IT IS UNDER ONE', () => {
  // The exact case that was wrong: 13 lb is $26.00, comfortably over the $25
  // floor, and a $2 option takes the bill to $28.
  const { text, total } = say(13, 200);

  assert.equal(total, 2800);
  assert.ok(!/minimum/.test(text), `a 13 lb order still mentions a minimum: ${text}`);

  // And the sum in it works, which is the thing a customer actually checks.
  assert.match(text, /\$26\.00 at \$2\.00 a pound/);
  assert.match(text, /plus \$2\.00 for the wash options/);
  assert.match(text, /\$28\.00 in total/);
});

test('an order under the minimum says so, and says the FLOOR', () => {
  const { text, total } = say(8, 0);

  assert.equal(total, 2500);
  assert.match(text, /under our \$25\.00 minimum/);
  assert.ok(!/\$27/.test(text));
});

test('AND A SURCHARGE UNDER THE MINIMUM SITS ON TOP OF IT, VISIBLY', () => {
  // $25 floor plus a $2 option is a $27 bill and a $25 minimum. The sentence
  // has to carry both numbers or the customer is left to guess which is which.
  const { text, total } = say(8, 200);

  assert.equal(total, 2700);
  assert.match(text, /under our \$25\.00 minimum/, 'the floor moved');
  assert.match(text, /plus \$2\.00 for the wash options/, 'the extra is invisible');
  assert.match(text, /so that is \$27\.00\./, 'the bill is not stated');

  // The thing Neil named: never "the $27 minimum".
  assert.ok(!/\$27\.00 minimum/.test(text), 'the surcharge is being called the minimum');
});

test('and an ordinary order is unchanged', () => {
  const { text } = say(38, 0);
  assert.equal(text, 'Your laundry weighed 38 lb, so that is $76.00 at $2.00 a pound.');
});

test('THE MINIMUM IN THE SENTENCE IS THE ONE THE CODE ENFORCES', () => {
  // Read from config rather than typed, so the sentence cannot drift from the
  // floor that priced the order.
  assert.equal(config.pricing.minimumCents, 2500);
  assert.match(say(8, 0).text, new RegExp(money(config.pricing.minimumCents).replace('$', '\\$')));
});
