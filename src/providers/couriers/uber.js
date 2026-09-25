'use strict';

const crypto = require('node:crypto');
const { config } = require('../../config');

// ---------------------------------------------------------------------------
// Uber Direct.
//
// WRITTEN FROM THE DOCUMENTATION AND NOT YET RUN AGAINST THE REAL API, because
// there is no Uber account yet. Everything below that is marked UNVERIFIED is a
// faithful reading of developer.uber.com and nothing more. The fake courier
// beside this file is what development actually runs on, and it returns the
// same shape, so the day credentials exist the only thing that should change is
// which file is chosen.
//
// WHAT IS CONFIRMED FROM THEIR DOCS:
//   - a quote is priced for ONE SPECIFIC TRIP and expires after 15 minutes.
//     There are no distance bands in the API; the band table on the pricing
//     page is our own estimate and the two can disagree
//   - pickup_ready_dt / pickup_deadline_dt / dropoff_ready_dt /
//     dropoff_deadline_dt, RFC 3339. The pickup deadline must be at least 10
//     minutes after the ready time and at least 20 minutes from now
//   - dropoff_verification.pincode.enabled makes Uber generate a 4-digit PIN
//     and return it, AND Uber texts it to the recipient as well
//   - a PIN cannot be combined with leaving it at the door
//   - deliverable_action_leave_at_door turns the delivery photo on by itself
//   - a package is capped at 50 lb, and a courier may refuse anything too big
//   - Uber accepts no liability for lost or damaged items
//
// THE SINGLE BIGGEST UNKNOWN is not in this file at all: whether Uber's terms
// permit collecting from a CUSTOMER'S HOME rather than a merchant's premises.
// Their US terms describe the latter. That is a question for Uber, not for code.
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

// An address in the shape Uber wants it. UNVERIFIED: their reference shows a
// structured object; some endpoints accept a single string.
const address = (a) =>
  JSON.stringify({
    street_address: [a.line1, a.line2].filter(Boolean),
    city: a.city,
    state: a.state,
    zip_code: a.postalCode,
    country: 'US',
  });

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
    if (err.status === 400 || err.status === 404) {
      return { ok: false, reason: 'no_quote', detail: err.message };
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

  return {
    deliveryId: data.id,
    externalId: data.external_id || null,
    status: data.status || null,
    courier: data.courier
      ? { name: data.courier.name, phone: data.courier.phone_number, vehicle: data.courier.vehicle_type }
      : null,
    pickupPhotoUrl:
      (data.pickup && data.pickup.verification && data.pickup.verification.picture &&
        data.pickup.verification.picture.image_url) || null,
    dropoffPhotoUrl:
      (data.dropoff && data.dropoff.verification && data.dropoff.verification.picture &&
        data.dropoff.verification.picture.image_url) || null,
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
    pin:
      (json.verification_requirements &&
        json.verification_requirements.pincode &&
        json.verification_requirements.pincode.value) || null,
    courier: json.courier
      ? { name: json.courier.name, phone: json.courier.phone_number, vehicle: json.courier.vehicle_type }
      : null,
    pickupPhotoUrl:
      (json.pickup && json.pickup.verification && json.pickup.verification.picture &&
        json.pickup.verification.picture.image_url) || null,
    dropoffPhotoUrl:
      (json.dropoff && json.dropoff.verification && json.dropoff.verification.picture &&
        json.dropoff.verification.picture.image_url) || null,
    trackingUrl: json.tracking_url || null,
    feeCents: json.fee,
    leaveAtDoor: json.deliverable_action === 'deliverable_action_leave_at_door',
    events: [],
  };
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
