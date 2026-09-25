'use strict';

const crypto = require('node:crypto');
const { config } = require('../../config');

// ---------------------------------------------------------------------------
// Uber Direct.
//
// RUN AGAINST THE REAL API ON 25 SEPTEMBER, in test mode, from a Fair Lawn
// house to a Hackensack laundromat and back. Everything below marked OBSERVED
// was watched happening; the fake courier beside this file returns the same
// shape, so development still runs on that.
//
// OBSERVED, and the two that were wrong in the first draft are marked:
//   - auth is https://auth.uber.com/oauth/v2/token. login.uber.com answers
//     identically, so either works and this is the one that is used
//   - A QUOTE FOR A PICKUP AT A CUSTOMER'S HOUSE IS ACCEPTED AND PRICED. That
//     was the existential question and the API's answer is yes. It is not the
//     CONTRACTUAL answer - see the note at the foot of this comment
//   - the fee is PER LEG and the same in both directions for the same pair
//   - there is no distance anywhere in the response. `duration` is 60-90
//     minutes on every trip from one mile to ten, so it is a delivery-window
//     estimate and not a drive time, and neither one can stand in for mileage
//   - THE FEE DOES NOT TRACK OUR STRAIGHT-LINE MILES. $7.99 at 0.9 and 2.3
//     miles, $9.99 at 6.0, $10.99 at 5.7, 6.8, 7.7 and 9.8. Two adjacent towns
//     came back a dollar apart. Uber prices its own routed distance, which it
//     does not show us, so our band table is an ESTIMATE and this is the only
//     thing that knows the real number
//   - WRONG IN THE FIRST DRAFT: the PIN is at
//     dropoff.verification_requirements.pincode.value, not at the top level.
//     Read from the top level it was always null, which would have left the
//     laundromat with no PIN to check a delivery against
//   - WRONG IN THE FIRST DRAFT: the simulated courier goes pending -> pickup ->
//     dropoff -> delivered and SKIPS pickup_complete. Nothing may require that
//     status to have been seen
//   - the pickup photo arrives as a URL on pickup.verification.picture, and is
//     an EMPTY STRING until the photo is actually taken
//   - test mode needs test_specifications.robo_courier_specification, and the
//     courier only starts moving once pickup_ready_dt has passed. `live_mode`
//     comes back false, which is the thing to assert on rather than trusting
//     which credentials were loaded
//   - A FREE-TEXT ADDRESS WORKS AND IS PRICED THE SAME as the structured form,
//     tested side by side on nine addresses with identical answers. Sloppy
//     capitalisation, a missing state and an apartment number all quoted fine
//   - THERE ARE TWO REFUSALS AND THEY MEAN DIFFERENT THINGS.
//     `unknown_location` is "I cannot place this at all" - gibberish got it.
//     `address_undeliverable` is "I placed it and will not go there"
//   - AND `address_undeliverable` IS STILL AMBIGUOUS, which is the one to be
//     careful about. A nonsense house number in a town Uber covers is PRICED
//     (9999 Nowhere Blvd, Fair Lawn came back $10.99), and a town with no house
//     number at all is priced too - so it resolves loosely and prices what it
//     landed on. `100 Grand Ave, Englewood` was refused while `350 Engle St,
//     Englewood` quoted at $9.99, which is Englewood being covered and that one
//     address resolving to some other Grand Avenue out of range. So the code
//     means "the place I landed on is not deliverable", which is NOT the same
//     as "your town is outside our area" - and nothing may tell a customer the
//     latter on the strength of it
//   - a quote expires after 15 minutes
//
// FROM THEIR DOCS, NOT WATCHED: a package is capped at 50 lb and a courier may
// refuse anything bigger; Uber accepts no liability for lost or damaged items;
// a PIN cannot be combined with leaving it at the door (this file refuses that
// combination itself rather than finding out at a doorstep).
//
// THE REMAINING UNKNOWN IS NOT IN THIS FILE. Uber's written US terms describe
// collecting from a merchant's own premises, and a customer's house is not
// that. CleanCloud does this leg commercially in the US, so the practice is
// ordinary in this trade - but they hold the Uber account their laundromats
// ride on, and a self-serve account gets the terms as written. That is a
// question for Uber, not for code.
// ---------------------------------------------------------------------------

const AUTH_URL = 'https://auth.uber.com/oauth/v2/token';
const API = 'https://api.uber.com/v1/customers';

const TIMEOUT_MS = 15_000;

// One token, reused until it is nearly expired. Uber's tokens last 30 days;
// asking for a new one per request would be rude and slow.
let token = null;

async function accessToken() {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;

  const body = new URLSearchParams({
    client_id: config.uber.clientId,
    client_secret: config.uber.clientSecret,
    grant_type: 'client_credentials',
    scope: 'eats.deliveries',
  });

  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Uber refused our credentials (HTTP ${res.status}).`);
  }

  const json = await res.json();
  token = {
    value: json.access_token,
    expiresAt: Date.now() + Number(json.expires_in || 2592000) * 1000,
  };
  return token.value;
}

async function call(path, { method = 'GET', body = null } = {}) {
  const bearer = await accessToken();

  const res = await fetch(`${API}/${config.uber.customerId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    // ONE LINE, NOT A PAGE - the same rule the Telnyx adapter learned the hard
    // way, where a Cloudflare error page buried the one line anybody needed.
    const detail = (json && (json.message || json.code)) || text.replace(/\s+/g, ' ').slice(0, 200);
    const error = new Error(`Uber refused the request (HTTP ${res.status}): ${detail}`);
    error.status = res.status;
    error.code = json && json.code;
    throw error;
  }

  return json;
}

// An address in the shape Uber wants it.
//
// A PLAIN STRING GOES STRAIGHT THROUGH, and is priced identically to the
// structured form - tested side by side on nine addresses on 25 September, with
// the same answer every time, including a missing state, lowercase, and an
// apartment number. Which is what lets a public page with one free-text box ask
// for a price without parsing what somebody typed into fields first.
const address = (a) => {
  if (typeof a === 'string') return a;

  return JSON.stringify({
    street_address: [a.line1, a.line2].filter(Boolean),
    city: a.city,
    state: a.state,
    zip_code: a.postalCode,
    country: 'US',
  });
};

// --- the interface ----------------------------------------------------------

async function quote({ from, to, pickupReadyAt, pickupDeadlineAt, dropoffReadyAt, dropoffDeadlineAt }) {
  try {
    const json = await call('/delivery_quotes', {
      method: 'POST',
      body: {
        pickup_address: address(from),
        dropoff_address: address(to),
        pickup_ready_dt: pickupReadyAt,
        pickup_deadline_dt: pickupDeadlineAt,
        dropoff_ready_dt: dropoffReadyAt,
        dropoff_deadline_dt: dropoffDeadlineAt,
      },
    });

    return {
      ok: true,
      quoteId: json.id,
      feeCents: json.fee,
      expiresAt: json.expires,
      durationMinutes: json.duration,
      currency: json.currency || 'usd',
    };
  } catch (err) {
    // A refusal to quote is an ANSWER, not a failure: out of range, or an
    // address Uber cannot place. The caller shows the customer something
    // useful rather than an error.
    //
    // THE CODE IS PASSED THROUGH UNTRANSLATED, on purpose.
    // `unknown_location` is Uber unable to place the address at all, and
    // `address_undeliverable` is Uber placing it somewhere it will not drive -
    // which covers both a town outside the area AND an address that resolved to
    // the wrong Grand Avenue. Turning either into "we do not serve you" would
    // tell a Bergen County customer something false; the caller says something
    // true of both instead.
    if (err.status === 400 || err.status === 404) {
      return { ok: false, reason: err.code || 'no_quote', detail: err.message };
    }
    throw err;
  }
}

async function book({
  from,
  to,
  pickupReadyAt,
  pickupDeadlineAt,
  dropoffReadyAt,
  dropoffDeadlineAt,
  manifest,
  requirePin = false,
  leaveAtDoor = false,
  note = null,
  quoteId = null,
  externalId = null,
}) {
  if (requirePin && leaveAtDoor) {
    throw new Error('A PIN cannot be required on a delivery left at the door.');
  }

  const json = await call('/deliveries', {
    method: 'POST',
    body: {
      quote_id: quoteId || undefined,
      // OUR ORDER NUMBER, WHICH IS ALL THE COURIER EVER LEARNS. Not the
      // customer's name: a courier collecting laundry does not need to know
      // whose it is, and the laundromat must never be told.
      external_id: externalId || undefined,

      pickup_address: address(from),
      pickup_name: from.name,
      pickup_phone_number: from.phone,
      pickup_business_name: from.businessName || undefined,
      pickup_notes: from.notes || undefined,

      dropoff_address: address(to),
      dropoff_name: to.name,
      dropoff_phone_number: to.phone,
      dropoff_business_name: to.businessName || undefined,
      dropoff_notes: note || to.notes || undefined,

      manifest_items: manifest,

      pickup_ready_dt: pickupReadyAt,
      pickup_deadline_dt: pickupDeadlineAt,
      dropoff_ready_dt: dropoffReadyAt,
      dropoff_deadline_dt: dropoffDeadlineAt,

      // A photo of the bags at collection, which is what proves the bags at the
      // counter are the bags that left the doorstep.
      pickup_verification: { picture: true },

      ...(requirePin ? { dropoff_verification: { pincode: { enabled: true } } } : {}),
      ...(leaveAtDoor
        ? {
            deliverable_action: 'deliverable_action_leave_at_door',
            undeliverable_action: 'return',
          }
        : {}),

      // TEST MODE. UNVERIFIED: the reference describes a simulated courier for
      // test credentials. Wherever this ends up living, nothing on a
      // development database may ever dispatch a real person.
      ...(config.uber.testMode ? { test_specifications: { robo_courier_specification: { mode: 'auto' } } } : {}),
    },
  });

  return shape(json);
}

async function status(deliveryId) {
  const json = await call(`/deliveries/${encodeURIComponent(deliveryId)}`);
  return json ? shape(json) : null;
}

async function cancel(deliveryId) {
  try {
    const json = await call(`/deliveries/${encodeURIComponent(deliveryId)}/cancel`, { method: 'POST' });
    return { ok: true, ...shape(json) };
  } catch (err) {
    return { ok: false, reason: err.code || 'refused', detail: err.message };
  }
}

// --- webhooks ---------------------------------------------------------------

function parseWebhook(body) {
  const data = body && body.data ? body.data : body;
  if (!data || !data.id) return null;

  // THE SAME PATHS AS `shape`, THROUGH THE SAME WALK. A webhook carries the
  // whole delivery, so reading it a second way by hand is how one of the two
  // ends up with the top-level PIN bug again.
  return {
    deliveryId: data.id,
    externalId: data.external_id || null,
    status: data.status || null,
    pin: dig(data, ['dropoff', 'verification_requirements', 'pincode', 'value']),
    courier: data.courier
      ? { name: data.courier.name, phone: data.courier.phone_number, vehicle: data.courier.vehicle_type }
      : null,
    pickupPhotoUrl: dig(data, ['pickup', 'verification', 'picture', 'image_url']),
    dropoffPhotoUrl: dig(data, ['dropoff', 'verification', 'picture', 'image_url']),
  };
}

// UNVERIFIED, and the one thing here that must not be guessed at when it goes
// live: an unsigned webhook is anybody on the internet telling us a courier has
// collected somebody's laundry. Compared in constant time, and a missing secret
// refuses rather than waves through.
function verifySignature({ rawBody, headers }) {
  const secret = config.uber.webhookSecret;
  const offered = headers && (headers['x-uber-signature'] || headers['X-Uber-Signature']);

  if (!secret || !offered) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(String(offered));
  const b = Buffer.from(expected);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- one shape, whichever courier ------------------------------------------

function shape(json) {
  return {
    id: json.id,
    status: json.status,

    // ON THE DROPOFF, NOT AT THE TOP LEVEL. The first draft read
    // json.verification_requirements and got null every time, which would have
    // left the laundromat with nothing to check an arriving bag against.
    //
    // AND IT IS NOT courier.public_phone_info.pin_code, which sits in the same
    // response, is eight digits, and is the code for ringing the courier
    // through Uber's masked number. Reading that one would have handed somebody
    // a PIN that opens a phone call and verifies nothing.
    pin: dig(json, ['dropoff', 'verification_requirements', 'pincode', 'value']),

    courier: json.courier
      ? { name: json.courier.name, phone: json.courier.phone_number, vehicle: json.courier.vehicle_type }
      : null,

    // AN EMPTY STRING UNTIL THE PHOTO EXISTS. `dig` returns null for one, so a
    // screen asking "is there a photo yet" gets an answer rather than a URL
    // that renders as a broken image.
    pickupPhotoUrl: dig(json, ['pickup', 'verification', 'picture', 'image_url']),
    dropoffPhotoUrl: dig(json, ['dropoff', 'verification', 'picture', 'image_url']),

    trackingUrl: json.tracking_url || null,
    feeCents: json.fee,
    leaveAtDoor: json.deliverable_action === 'deliverable_action_leave_at_door',
    events: [],
  };
}

// One walk down a nested response, where a missing branch and an empty string
// are both "not yet".
function dig(json, path) {
  let node = json;
  for (const key of path) {
    if (node == null || typeof node !== 'object') return null;
    node = node[key];
  }
  return node === '' || node == null ? null : node;
}

const live = {
  name: 'uber',
  configured: true,
  quote,
  book,
  status,
  cancel,
  parseWebhook,
  verifySignature,
};

module.exports = live;

// The same adapter with Uber's simulated courier switched on. A separate name
// so the startup banner and the tests can tell them apart at a glance.
module.exports.testMode = { ...live, name: 'uber-test' };

// FOR THE TESTS, AND FOR NOTHING ELSE. `shape` is the function that knows where
// in Uber's response each thing lives, and the PIN was in the wrong place in the
// first draft - so it is held against a real captured response rather than
// against the documentation that got it wrong.
module.exports.shape = shape;
