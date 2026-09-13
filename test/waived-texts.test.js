'use strict';

// ---------------------------------------------------------------------------
// A WAIVED ORDER IS NEVER TOLD ABOUT A TOTAL.
//
// Neil, 11 September, on order #1975: the pickup text promised "the weight and
// the total" for an order that is free and can never be charged. The pickup
// text and the weigh-in text are two halves of one promise, so both are pinned.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { collectedMessage, waivedWeighInText } = require('../src/core/fulfilment');

test('a waived order is promised the weight, and not a total', () => {
  assert.equal(
    collectedMessage({ payment_status: 'WAIVED' }),
    "We're here for your laundry. We'll text you the weight once it's on the scale."
  );
});

test('every other order is still promised the weight and the total', () => {
  for (const status of ['UNPAID', 'PAID', 'FAILED', undefined]) {
    assert.equal(
      collectedMessage({ payment_status: status }),
      "We're here for your laundry. We'll text you the weight and the total once it's on the scale.",
      `payment_status ${status}`
    );
  }
});

test("the weigh-in text on a waived order is the weight, with no money in it", () => {
  const text = waivedWeighInText(14.68);
  assert.equal(text, 'Your laundry weighed 14.68 lb.');
  assert.ok(!/\$|total|charge|pound|off for/i.test(text), `money crept in: ${text}`);
});
