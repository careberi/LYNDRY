'use strict';

// ---------------------------------------------------------------------------
// WHAT A MANUAL RETRY SAYS, AND WHAT IT DOES NOT.
//
// Neil, 12 September, before pressing the button on order #2060: "dont mention
// anything if it fails. If it fails, ill give him a call tomorrow."
//
// The sentence it sends on success is his, word for word. The thing worth
// pinning alongside it is what the old one did wrong, because it is the kind of
// mistake that reads fine in a diff and is obvious on a phone: it opened with
// the weight, and the weight it had was ours (81.38 lb) rather than the one the
// customer was billed on (84 lb, the laundromat's), with a total that no longer
// matched either because a 50% promotion had come off in between.
//
// Nothing here touches the database, Stripe, or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { settledMessage } = require('../src/core/billing');

test("it is Neil's sentence, with the figures read off the order", () => {
  assert.equal(
    settledMessage({ order_number: 2060 }, 8400),
    'Good news, the $84.00 for order #2060 has gone through. Thanks!'
  );
});

test('the amount is what actually moved, not what the order is worth', () => {
  // They come apart only on the two legacy orders that took a deposit, and on
  // those "has gone through" is about the balance, not the total.
  assert.match(settledMessage({ order_number: 1900 }, 5900), /\$59\.00/);
});

test('it never restates a weight', () => {
  // The bug this replaced. A retry is not a second announcement of the price:
  // the customer was told the weight and the total at the weigh-in, and any
  // second copy of those figures is a chance to contradict them.
  const text = settledMessage({ order_number: 2060 }, 8400);
  assert.ok(!/\blb\b/.test(text), `a weight crept back into the retry message: ${text}`);
  assert.ok(!/a pound/.test(text), `a rate crept back into the retry message: ${text}`);
});

test('it is plain ASCII and one segment', () => {
  const text = settledMessage({ order_number: 2060 }, 8400);
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[^\x00-\x7F]/.test(text), `non-ASCII in the retry message: ${text}`);
  assert.ok(text.length <= 160, `${text.length} characters is more than one segment`);
});

// ---------------------------------------------------------------------------
// The silence. Read off the source, because reaching the failing branches of
// chargeOrder() needs Stripe and a database, and what matters is one word.
// ---------------------------------------------------------------------------

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'core', 'billing.js'),
  'utf8'
);

test('a refused retry tells the customer nothing', () => {
  const declined = source.slice(source.indexOf('declined: true'));
  const upToClose = declined.slice(0, declined.indexOf('};'));

  assert.match(upToClose, /message: null/, 'a declined charge is writing a message again');
});

test('a retry with no card on file tells the customer nothing either', () => {
  const needsCard = source.slice(source.indexOf('needsCard: true'));
  const upToClose = needsCard.slice(0, needsCard.indexOf('};'));

  assert.match(upToClose, /message: null/, 'the no-card branch is writing a message again');
});

test('both failing branches still hand back a link for the automatic paths', () => {
  // fulfilment.deliver() writes its own sentence out of setupUrl. Going quiet
  // here must not take the doorstep backstop's link with it.
  for (const flag of ['declined: true', 'needsCard: true']) {
    const branch = source.slice(source.indexOf(flag));
    assert.match(branch.slice(0, branch.indexOf('};')), /setupUrl: url/, `${flag} lost its link`);
  }
});
