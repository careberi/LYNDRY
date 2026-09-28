'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requiredFee, verifyRoundTrip } = require('../src/core/public-courier-availability');

const quote = (options, expiresAt = '2030-01-01T00:05:00.000Z') => ({ ok: true, options, expiresAt });
const both = (uber, doorDash) => [
  { service: 'Uber', feeCents: uber },
  { service: 'DoorDash Drive', feeCents: doorDash },
];

test('a public price requires Uber and DoorDash and budgets for either courier', () => {
  assert.equal(requiredFee(quote(both(674, 750))), 750);
  assert.equal(requiredFee(quote([{ service: 'Uber', feeCents: 674 }])), null);
  assert.equal(requiredFee({ ok: false, options: both(674, 750) }), null);
});

test('round-trip verification checks each direction without creating an order', async () => {
  const calls = [];
  const results = [quote(both(674, 750)), quote(both(700, 825), '2030-01-01T00:04:00.000Z')];
  const client = { quote: async (trip) => { calls.push(trip); return results.shift(); } };
  const customer = { line1: '1 Customer St' };
  const partner = { line1: '2 Laundry Ave' };
  const verified = await verifyRoundTrip(client, { customer, partner });
  assert.deepEqual(calls, [{ from: customer, to: partner }, { from: partner, to: customer }]);
  assert.deepEqual(verified, {
    pickupCents: 750,
    returnCents: 825,
    source: 'SHIPDAY',
    expiresAt: '2030-01-01T00:04:00.000Z',
  });
});

test('missing either courier in either direction withholds the public price', async () => {
  const client = { quote: async ({ from }) => from.line1 === '1 Customer St'
    ? quote(both(674, 750))
    : quote([{ service: 'Uber', feeCents: 700 }]) };
  assert.equal(await verifyRoundTrip(client, {
    customer: { line1: '1 Customer St' }, partner: { line1: '2 Laundry Ave' },
  }), null);
});
