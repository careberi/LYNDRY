'use strict';

const crypto = require('node:crypto');
const { config } = require('../../config');
const quote = require('../../core/quote');

// ---------------------------------------------------------------------------
// A courier that does not exist.
//
// Used everywhere the data is invented, which is the whole development
// environment. It is deliberately NOT a stub that returns nothing: the entire
// order flow - two courier legs, a PIN, a pickup photo, a weigh-in at the
// counter, a delivery photo - has to be buildable and walkable before Neil has
// an Uber account, because every screen in it depends on what a courier event
// actually looks like.
//
// SO IT LIES IN THE SAME SHAPE AS THE TRUTH. The quote comes from the real band
// table, the PIN is four digits like Uber's, the statuses are Uber's own names
// in Uber's own order, and the delivery id looks like theirs. Anything that
// works against this should work against the real one, and anything that does
// not is a bug worth finding on a laptop rather than at somebody's door.
//
// NOTHING IS STORED. Deliveries live in memory for the life of the process,
// which is the honest lifetime of a pretend courier - a restart loses them, and
// an order that needs to survive a restart keeps its own record in `orders`
// like everything else. A table here would be a second copy of a fact the order
// already holds, for a courier that is not real.
// ---------------------------------------------------------------------------

// Uber's own sequence, which is what the screens will be written against.
//
// UBER'S SIMULATED COURIER SKIPPED pickup_complete, watched on 25 September:
// pending -> pickup -> dropoff -> delivered, with the pickup photo appearing on
// the move to dropoff. It is a documented status and a real courier may well
// send it, so it stays here - this driver walking through the longer sequence is
// what proves a screen copes with it.
//
// SO NOTHING MAY REQUIRE HAVING SEEN IT. Anything asking "have the bags been
// collected" reads the photo, or the fact that the status is past `pickup`, and
// never "was pickup_complete observed" - because on the real thing it was not.
const FLOW = [
  'pending', // created, nobody assigned yet
  'pickup', // courier on the way to collect
  'pickup_complete', // bags in the car, photo taken. UBER MAY SKIP THIS
  'dropoff', // on the way to the destination
  'delivered', // handed over, or left at the door
];

// PAST THE DOORSTEP, whichever route the courier's statuses took. This is what
// a screen asks instead of looking for one status it may never be sent.
const COLLECTED = new Set(['pickup_complete', 'dropoff', 'delivered']);

const deliveries = new Map();

const id = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

// FOUR DIGITS, LIKE UBER'S. Random rather than sequential: a PIN somebody can
// predict from the last one is not a check on anything, and this is the value
// that proves the bags at the counter are the bags that were collected.
const pin = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

const NAMES = ['Marcus', 'Renata', 'Devon', 'Priya', 'Tomas', 'Yasmin', 'Abel', 'Noor'];

function courierFor(deliveryId) {
  // Stable per delivery, so a screen refreshed twice does not change the name
  // of the person supposedly driving to the door.
  const n = parseInt(deliveryId.slice(-2), 16) % NAMES.length;
  return { name: NAMES[n], phone: '+12015550142', vehicle: 'Toyota Corolla' };
}

// --- the interface ----------------------------------------------------------

// WHAT THE TRIP WOULD COST. The real one asks Uber and gets a price for that
// specific trip; this reads the published band table, which is what the public
// quote page already shows. The two agreeing is the point: if the band table
// and Uber's live quote disagree, the customer was told the wrong number, and
// that is a thing to find out here.
// `from` and `to` ARE ACCEPTED AND IGNORED, so one caller works for both
// drivers. The real one asks Uber about those two addresses and never looks at
// `miles`; this one has nobody to ask and never looks at the addresses.
async function quoteTrip({ miles }) {
  const band = quote.bandFor(miles);

  if (!band) {
    return { ok: false, reason: 'out_of_range', maxMiles: config.courier.maxMiles };
  }

  return {
    ok: true,
    quoteId: id('dqt'),

    // ONE LEG, LIKE UBER'S. The real fee came back per leg and the same in both
    // directions, so a caller doubles it for the round trip - and this has to
    // quote the same thing or every price built on it is twice what it should
    // be. It returned the round trip until the real API was measured.
    feeCents: band.legCents,
    // Uber's quotes expire after fifteen minutes, so anything built against
    // this has to cope with a quote going stale before it is used.
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    durationMinutes: Math.round(10 + miles * 3),
  };
}

async function book({ pickup, dropoff, pickupReadyAt, pickupDeadlineAt, dropoffReadyAt, dropoffDeadlineAt, manifest, requirePin = false, leaveAtDoor = false, note = null }) {
  // THE ONE COMBINATION UBER REFUSES, refused here too. A PIN needs somebody to
  // read it out; leaving it at the door means nobody is there. Finding that out
  // on a laptop is the entire reason this file bothers to be strict.
  if (requirePin && leaveAtDoor) {
    throw new Error('A PIN cannot be required on a delivery left at the door.');
  }

  const deliveryId = id('del');
  const record = {
    id: deliveryId,
    status: 'pending',
    pin: requirePin ? pin() : null,
    leaveAtDoor,
    pickup,
    dropoff,
    manifest: manifest || null,
    note,
    windows: { pickupReadyAt, pickupDeadlineAt, dropoffReadyAt, dropoffDeadlineAt },
    courier: null,
    pickupPhotoUrl: null,
    dropoffPhotoUrl: null,
    createdAt: new Date().toISOString(),
    events: [],
  };

  deliveries.set(deliveryId, record);
  return shape(record);
}

async function status(deliveryId) {
  const record = deliveries.get(deliveryId);
  return record ? shape(record) : null;
}

async function cancel(deliveryId) {
  const record = deliveries.get(deliveryId);
  if (!record) return { ok: false, reason: 'unknown_delivery' };
  if (record.status === 'delivered') return { ok: false, reason: 'already_delivered' };

  record.status = 'canceled';
  record.events.push({ at: new Date().toISOString(), status: 'canceled' });
  return { ok: true, ...shape(record) };
}

// --- walking one forward ----------------------------------------------------
//
// The whole reason this driver exists. `npm run courier` uses it to push a
// delivery through the statuses a real one would, so the laundromat screen, the
// customer's texts and the order state machine can all be exercised end to end
// with nobody driving anywhere.

function advance(deliveryId) {
  const record = deliveries.get(deliveryId);
  if (!record) return null;

  const at = FLOW.indexOf(record.status);
  if (at === -1 || at === FLOW.length - 1) return shape(record);

  record.status = FLOW[at + 1];
  record.events.push({ at: new Date().toISOString(), status: record.status });

  // A courier is assigned the moment it stops being 'pending'.
  if (record.status === 'pickup' && !record.courier) record.courier = courierFor(record.id);

  // The photo at pickup, which Uber requires and which is what proves the bags
  // at the counter are the bags that were collected.
  if (record.status === 'pickup_complete') {
    record.pickupPhotoUrl = `https://example.invalid/fake-courier/${record.id}/pickup.jpg`;
  }

  // Leaving it at the door turns the delivery photo on automatically.
  if (record.status === 'delivered' && record.leaveAtDoor) {
    record.dropoffPhotoUrl = `https://example.invalid/fake-courier/${record.id}/dropoff.jpg`;
  }

  return shape(record);
}

function all() {
  return [...deliveries.values()].map(shape);
}

// --- webhooks ---------------------------------------------------------------

function parseWebhook(body) {
  const event = body && body.data ? body.data : body;
  if (!event || !event.id) return null;

  return {
    deliveryId: event.id,
    status: event.status || null,
    courier: event.courier || null,
    pickupPhotoUrl: (event.pickup && event.pickup.photo_url) || null,
    dropoffPhotoUrl: (event.dropoff && event.photo_url) || null,
  };
}

// Accepts anything, exactly like the fake SMS driver, and for the same reason:
// harmless where the data is invented, and never chosen where it is not.
const verifySignature = () => true;

// --- the shape everything else reads ---------------------------------------
//
// ONE SHAPE, WHICHEVER COURIER. The real adapter returns this too, so nothing
// above this folder ever learns Uber's field names.
function shape(record) {
  return {
    id: record.id,
    status: record.status,
    pin: record.pin,
    courier: record.courier,
    pickupPhotoUrl: record.pickupPhotoUrl,
    dropoffPhotoUrl: record.dropoffPhotoUrl,
    trackingUrl: `https://example.invalid/fake-courier/${record.id}`,
    leaveAtDoor: record.leaveAtDoor,
    windows: record.windows,
    events: record.events,
  };
}

module.exports = {
  name: 'fake',
  configured: true,
  quote: quoteTrip,
  book,
  status,
  cancel,
  parseWebhook,
  verifySignature,

  // Development only: walk a delivery forward, and see them all.
  advance,
  all,
  FLOW,
  COLLECTED,
};
