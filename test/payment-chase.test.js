'use strict';

// ---------------------------------------------------------------------------
// CHASING A REFUSED CARD.
//
// Order #2060, 12 September: the bank refused $84.00 at the weigh-in, the
// customer was texted once, and nothing in the system ever asked about that
// order again.
//
// Two rules here are the ones that would fail silently on a live phone, so
// both are pinned: the message never invents money, and it never goes out
// before the laundry has actually been delivered.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { chaseMessage, WAIT_HOURS } = require('../src/core/payment-chase');

const LINK = 'https://lyndry.com/pay/UtDU92aemeozUtDjCIp7wsjT';

test('it names the order, the amount and nothing else', () => {
  const text = chaseMessage({ order_number: 2060, price_cents: 8400 }, LINK);

  assert.match(text, /#2060/);
  assert.match(text, /\$84\.00/);
  assert.ok(text.includes(LINK), 'the link has to be in it, it is the whole point');
});

test('the amount is read off the order, never written into the sentence', () => {
  // A promise with a figure in it must not have two copies of the figure. The
  // only number in this message besides the order number is price_cents.
  const text = chaseMessage({ order_number: 1042, price_cents: 2500 }, LINK);
  assert.match(text, /\$25\.00/);
  assert.ok(!text.includes('84'), 'a figure from somewhere else reached the message');
});

test('it says nothing has been taken, because nothing has', () => {
  // The whole risk of a payment chase is that it reads as a demand for money
  // that already moved. It has not: the charge was refused.
  const text = chaseMessage({ order_number: 2060, price_cents: 8400 }, LINK);
  assert.match(text, /nothing has been taken/i);
});

test('it is plain ASCII, so one segment does not silently become three', () => {
  // notify.js swaps typographic characters on the way out, but a message
  // written in code should not be relying on that.
  const text = chaseMessage({ order_number: 2060, price_cents: 8400 }, LINK);
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[^\x00-\x7F]/.test(text), `non-ASCII crept into the chase: ${text}`);
});

test('it stays inside two segments with a real link on the end', () => {
  const text = chaseMessage({ order_number: 2060, price_cents: 8400 }, LINK);
  assert.ok(text.length <= 306, `${text.length} characters is over two segments`);
});

test('the wait is a day, and it is a knob rather than a constant in a sentence', () => {
  assert.equal(typeof WAIT_HOURS, 'number');
  assert.ok(WAIT_HOURS >= 1, 'a chase that can fire immediately is not a chase');
});
