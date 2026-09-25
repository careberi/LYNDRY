'use strict';

// ---------------------------------------------------------------------------
// NOBODY IS SENT TO A HOUSE THAT DOES NOT EXIST.
//
// The development database is full of invented customers at invented addresses.
// A real Uber courier dispatched against one of those rows is a real person
// driving to a door that is not there, a real charge for the trip, and - on the
// return leg - somebody's laundry left at an address nobody checked.
//
// THE DEPLOYED DEVELOPMENT SITE RUNS AS PRODUCTION ON PURPOSE, so that it
// behaves like production. An environment check alone would therefore have
// handed it the live courier the moment credentials were pasted in "to test
// properly", which is exactly how the Telnyx hazard got in. The question that
// decides it is whose rows these are.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const couriers = require('../src/providers/couriers');
const fake = require('../src/providers/couriers/fake');

const on = (configured, production, realData) => couriers.pick({ configured, production, realData });

test('A REAL COURIER IS ONLY EVER SENT BY THE REAL BUSINESS', () => {
  assert.equal(on(true, true, true), 'uber', 'production stopped being able to book a courier');
  assert.equal(on(true, true, false), 'uber-test', 'the dev site could dispatch a real driver');
  assert.equal(on(true, false, false), 'uber-test', 'this laptop could dispatch a real driver');
});

test('and with no account, invented data gets a courier that does not exist', () => {
  assert.equal(on(false, false, false), 'fake');
  assert.equal(on(false, true, false), 'fake');

  // The real business with no courier configured REFUSES rather than pretending
  // - a booking that silently did nothing would leave somebody's laundry on a
  // doorstep with nobody coming for it.
  assert.equal(on(false, true, true), 'disabled');
});

test('THE FAKE COURIER REFUSES WHAT UBER REFUSES', async () => {
  // A PIN needs somebody to read it out; leaving it at the door means nobody is
  // there. Uber rejects the combination, so this does too - the whole value of
  // a pretend courier is that it is strict about the same things.
  await assert.rejects(
    fake.book({ requirePin: true, leaveAtDoor: true, pickup: {}, dropoff: {} }),
    /PIN cannot be required on a delivery left at the door/
  );
});

test('a booked delivery carries a four-digit PIN and no courier yet', async () => {
  const delivery = await fake.book({ pickup: {}, dropoff: {}, requirePin: true });

  assert.match(delivery.pin, /^\d{4}$/, 'the PIN is not four digits');
  assert.equal(delivery.status, 'pending');
  assert.equal(delivery.courier, null, 'a courier was assigned before anybody accepted the job');
});

test('AND IT WALKS THE SAME ROAD A REAL ONE DOES', async () => {
  // Every screen in the new flow is written against these statuses, so the
  // order and the names have to be Uber's rather than convenient.
  const delivery = await fake.book({ pickup: {}, dropoff: {}, requirePin: true });
  const seen = [delivery.status];

  for (let i = 0; i < 10; i += 1) {
    const next = fake.advance(delivery.id);
    if (next.status === seen[seen.length - 1]) break;
    seen.push(next.status);
  }

  assert.deepEqual(seen, ['pending', 'pickup', 'pickup_complete', 'dropoff', 'delivered']);

  const done = await fake.status(delivery.id);
  assert.ok(done.courier && done.courier.name, 'nobody was ever assigned');
  assert.ok(done.pickupPhotoUrl, 'no photo was taken at the doorstep');
});

test('leaving it at the door produces a photo without being asked', async () => {
  // Uber turns the delivery photo on by itself for leave-at-door, and that
  // photo is what the customer is texted as the delivered message.
  const delivery = await fake.book({ pickup: {}, dropoff: {}, leaveAtDoor: true });
  for (let i = 0; i < 5; i += 1) fake.advance(delivery.id);

  const done = await fake.status(delivery.id);
  assert.equal(done.status, 'delivered');
  assert.ok(done.dropoffPhotoUrl, 'a bag was left at a door with nothing to show for it');
  assert.equal(done.pin, null, 'a PIN was issued on a leave-at-door delivery');
});

test('a quote expires, because Uber\'s does', async () => {
  const q = await fake.quote({ miles: 3 });
  assert.equal(q.ok, true);
  assert.ok(q.feeCents > 0);

  // Fifteen minutes is Uber's window. Anything built against this has to cope
  // with the quote that priced an order being stale by the time it is booked.
  const life = new Date(q.expiresAt).getTime() - Date.now();
  assert.ok(life > 0 && life <= 15 * 60 * 1000 + 1000, `quote lifetime was ${life}ms`);
});

test('and a trip past the last band has no price rather than a guessed one', async () => {
  const q = await fake.quote({ miles: 40 });
  assert.equal(q.ok, false);
  assert.equal(q.reason, 'out_of_range');
});

test('NOTHING OUTSIDE THE ADAPTER KNOWS UBER EXISTS', () => {
  // The rule every vendor in this codebase follows. Switching courier should be
  // one new file beside uber.js, which it cannot be if the name has leaked.
  const root = path.join(__dirname, '..', 'src');
  const guilty = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const here = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'couriers') walk(here);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;

      const src = fs
        .readFileSync(here, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');

      // config.js is allowed to name it: it is the one place environment
      // variables are read, and UBER_CLIENT_ID has to be spelled somewhere.
      if (path.basename(here) === 'config.js') continue;

      // WHAT COUNTS IS A DEPENDENCY, NOT THE WORD. The first version of this
      // failed on brain.js, which names Uber in the sentence reassuring a
      // nervous customer that Stripe is the payment company behind Google,
      // Amazon and Uber. That is prose about a payment processor, not a courier
      // leaking out of its adapter - so the test asks about the things that
      // would actually make switching courier hard.
      const leaks = [
        [/require\([^)]*uber[^)]*\)/i, 'requires the Uber adapter directly'],
        [/api\.uber\.com|auth\.uber\.com/i, 'calls Uber\'s API'],
        [/\bUBER_[A-Z_]+\b/, 'reads an UBER_ environment variable'],
        [/\bdelivery_quotes\b|\bdropoff_verification\b|\bdeliverable_action\b/, 'uses Uber\'s field names'],
      ];

      for (const [pattern, why] of leaks) {
        if (pattern.test(src)) guilty.push(`${path.relative(root, here).split('\\').join('/')}: ${why}`);
      }
    }
  };

  walk(root);
  assert.deepEqual(guilty, [], 'Uber is named outside the courier adapter');
});
