'use strict';

// ---------------------------------------------------------------------------
// WHERE THE PIN IS.
//
// The adapter was written from Uber's documentation and read the delivery PIN
// from the top level of the response. It is not there. It is on the dropoff, at
// dropoff.verification_requirements.pincode.value, and read from the top level
// it was null on every delivery - which would have left a laundromat attendant
// with no number to check an arriving bag against, silently, on every order.
//
// THE FIXTURES BELOW ARE A REAL RESPONSE, captured from Uber's test API on 25
// September 2026 for a Fair Lawn house to a Hackensack laundromat. They are
// trimmed of nothing that matters and edited only to shorten the addresses.
// A test written against the documentation would have passed the bug.
//
// THE OTHER TRAP IS IN HERE TOO: courier.public_phone_info.pin_code sits in the
// same response, looks exactly as PIN-shaped, and is the code for ringing the
// courier through Uber's masked number. Reading that one would hand somebody a
// number that opens a phone call and verifies nothing.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const uber = require('../src/providers/couriers/uber');

// As created: a courier is not assigned yet and no photo has been taken.
const CREATED = {
  id: 'del_SRs8AwHlQyCbX--uOZ5ksg',
  status: 'pending',
  live_mode: false,
  fee: 1099,
  currency: 'usd',
  tracking_url: 'https://direct.uber.com/track/del_SRs8AwHlQyCbX--uOZ5ksg',
  external_id: 'LYNDRY-TEST-9002',
  pickup: {
    name: 'LYNDRY customer',
    phone_number: '+12015551234',
    address: '16-50 Chandler Dr, Fair Lawn, NJ 07410, US',
    verification_requirements: { barcodes: null, picture: true, show_shipment_info: null },
  },
  dropoff: {
    name: 'Laundromat counter',
    phone_number: '+12015555678',
    address: '300 Main St, Hackensack, NJ 07601, US',
    verification_requirements: {
      barcodes: null,
      pincode: { value: '5678', enabled: true },
      show_shipment_info: null,
    },
  },
  courier: null,
};

// Once the bags are in the car: the photo exists and a courier is named. Note
// that Uber's simulated courier went straight from `pickup` to `dropoff` and
// never sent `pickup_complete`.
const COLLECTED = {
  ...CREATED,
  status: 'dropoff',
  pickup: {
    ...CREATED.pickup,
    verification: {
      picture: { image_url: 'https://tb-static.uber.com/prod/direct-stub-images/test-stub.jpeg' },
      barcodes: null,
      pictures: null,
    },
  },
  courier: {
    name: 'Alex H.',
    phone_number: '+15555550123',
    vehicle_type: 'car',
    public_phone_info: { pin_code: '14747552' },
  },
};

// On the way to the doorstep, before the courier has arrived: Uber sends the
// photo key with an EMPTY STRING in it rather than leaving it out.
const NO_PHOTO_YET = {
  ...CREATED,
  status: 'pickup',
  pickup: { ...CREATED.pickup, verification: { picture: { image_url: '' }, barcodes: null, pictures: null } },
};

test('THE PIN COMES OFF THE DROPOFF, NOT THE TOP LEVEL', () => {
  assert.equal(uber.shape(CREATED).pin, '5678');

  // The shape the bug had: a top-level verification_requirements that the real
  // response does not carry. Reading it must not be how the PIN is found.
  const decoy = { ...CREATED, verification_requirements: { pincode: { value: '0000' } } };
  assert.equal(uber.shape(decoy).pin, '5678', 'the PIN was read from the top level again');
});

test('and the courier\'s phone code is never mistaken for it', () => {
  const pin = uber.shape(COLLECTED).pin;

  assert.equal(pin, '5678');
  assert.notEqual(pin, '14747552', 'the masked-phone code was handed over as the delivery PIN');
  assert.equal(pin.length, 4, 'the PIN stopped being four digits');
});

test('A PHOTO THAT HAS NOT BEEN TAKEN IS ABSENT, NOT AN EMPTY URL', () => {
  // Uber sends image_url as "" until the courier takes the picture. A screen
  // asking "is there a photo yet" has to get an answer rather than a URL that
  // renders as a broken image.
  assert.equal(uber.shape(NO_PHOTO_YET).pickupPhotoUrl, null);
  assert.equal(uber.shape(CREATED).pickupPhotoUrl, null);

  assert.match(uber.shape(COLLECTED).pickupPhotoUrl, /^https:\/\//);
});

test('the courier is named once somebody accepts, and not before', () => {
  assert.equal(uber.shape(CREATED).courier, null);

  const courier = uber.shape(COLLECTED).courier;
  assert.equal(courier.name, 'Alex H.');
  assert.equal(courier.phone, '+15555550123');
});

test('A WEBHOOK IS READ THE SAME WAY AS A POLL', () => {
  // Two readers of one response is how one of them ends up back on the
  // top-level PIN. Whatever `shape` finds, the webhook parser finds.
  const fromPoll = uber.shape(COLLECTED);
  const fromHook = uber.parseWebhook({ data: COLLECTED });

  assert.equal(fromHook.pin, fromPoll.pin);
  assert.equal(fromHook.pickupPhotoUrl, fromPoll.pickupPhotoUrl);
  assert.equal(fromHook.status, fromPoll.status);
  assert.equal(fromHook.deliveryId, fromPoll.id);
  assert.equal(fromHook.externalId, 'LYNDRY-TEST-9002');
});

test('the fee and the tracking link survive, and nothing invents a distance', () => {
  const shaped = uber.shape(CREATED);

  assert.equal(shaped.feeCents, 1099);
  assert.match(shaped.trackingUrl, /^https:\/\//);

  // THERE IS NO DISTANCE IN UBER'S RESPONSE. Anything that starts reading one
  // off a delivery is reading a field that does not exist, so it must not be in
  // the shape at all rather than be there as undefined.
  assert.ok(!('miles' in shaped), 'a mileage field appeared that Uber never sends');
});
