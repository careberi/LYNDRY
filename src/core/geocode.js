'use strict';

const db = require('../db');
const { site } = require('../web/site');
const { config } = require('../config');

// ---------------------------------------------------------------------------
// Turning an address into a point on the map.
//
// Needed for exactly one thing: putting a delivery round in a sensible order.
// Without coordinates a "stop number" would be the order the driver happened
// to scan bags in, which is worse than no number at all - a sequence you
// cannot trust is one you have to re-check at every door.
//
// Nominatim, which is OpenStreetMap's own geocoder. Free, no account, no key.
// In exchange it asks for three things and this file honours all of them:
//
//   1. NO MORE THAN ONE REQUEST A SECOND. Enforced below by a queue, not by
//      hoping. Everything goes through one promise chain, so twelve stops
//      being looked up at once take twelve seconds rather than arriving as a
//      burst that gets us blocked.
//   2. Identify yourself. A real User-Agent with a contact address, which is
//      why this runs on the server - a browser cannot set one.
//   3. Cache the result. An address does not move, so a customer is looked up
//      once, ever. A failure is cached too, so a bad address is not retried
//      every single time a round is built.
//
// If it is down or slow, nothing breaks: a stop with no coordinates still gets
// delivered, it just sorts to the end of the round and says so on screen.
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const GAP_MS = 1100;
const TIMEOUT_MS = 8000;

// One request at a time, at least GAP_MS apart. Every call joins the back of
// this chain, which is the whole rate limiter.
let queue = Promise.resolve();

function throttled(work) {
  const next = queue.then(async () => {
    const result = await work();
    await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    return result;
  });

  // The queue must survive a failure, or one bad lookup wedges every later
  // one behind a rejected promise.
  queue = next.catch(() => {});
  return next;
}

// The address as one line, the way a person would write it on an envelope.
// address_line2 is deliberately left out: "Apt 4B" helps a driver find a door
// and only confuses a geocoder.
function addressLine(customer) {
  return [customer.address_line1, customer.city, customer.state, customer.postal_code]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
}

async function lookup(query) {
  const url =
    `${ENDPOINT}?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Required by Nominatim's usage policy. A contact address means they
        // can ask us to stop rather than simply blocking us.
        'User-Agent': `${site.name}/1.0 (${site.email})`,
        'Accept-Language': 'en',
      },
    });

    if (!response.ok) return null;

    const results = await response.json();
    if (!Array.isArray(results) || !results.length) return null;

    const lat = Number(results[0].lat);
    const lng = Number(results[0].lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    // Timeout, network, malformed JSON. All the same answer: we do not know
    // where this is, and the round carries on without it.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Where is this customer? Cached on their row after the first answer.
//
// Returns { lat, lng } or null. Never throws - a geocoder that is having a bad
// day must not be able to stop a driver loading a van.
async function locate(customer) {
  if (customer.lat != null && customer.lng != null) {
    return { lat: Number(customer.lat), lng: Number(customer.lng) };
  }

  // Already tried and found nothing. Asking again on every round build would
  // spend our whole rate budget on the one address that will never resolve.
  if (customer.geocode_failed) return null;

  const query = addressLine(customer);
  if (!query) return null;

  const found = await throttled(() => lookup(query));

  try {
    await db
      .from('customers')
      .update(
        found
          ? { lat: found.lat, lng: found.lng, geocoded_at: new Date().toISOString(), geocode_failed: false }
          : { geocoded_at: new Date().toISOString(), geocode_failed: true }
      )
      .eq('id', customer.id);
  } catch (err) {
    console.error(`Could not cache a geocode for ${customer.id}: ${err.message}`);
  }

  if (!found) {
    console.warn(`No coordinates found for "${query}" - that stop will sort last.`);
  }

  return found;
}

// --- Putting stops in order -------------------------------------------------

const R_MI = 3958.8;
const rad = (d) => (d * Math.PI) / 180;

function milesBetween(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.sqrt(h));
}

// Nearest neighbour from base, then 2-opt to untangle it.
//
// The same shape as the route planner's solver and for the same reason: for a
// dozen stops it lands where a person would after staring at a map, and it is
// instant. It is NOT optimal, and it does not need to be - a driver who knows
// the roads better than the arithmetic can still deliver them in any order he
// likes. The numbers are a default, not an instruction.
//
// Straight-line distance, deliberately. Real driving distances would mean a
// routing service on the critical path of a driver loading a van, and being
// wrong by a street is cheap while being unable to load is not.
function sequence(points, base) {
  const known = points.filter((p) => p.at);
  const unknown = points.filter((p) => !p.at);

  const remaining = [...known];
  const ordered = [];
  let current = base;

  while (remaining.length) {
    let best = 0;
    let bestDistance = Infinity;

    remaining.forEach((point, i) => {
      const d = milesBetween(current, point.at);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });

    current = remaining[best].at;
    ordered.push(remaining[best]);
    remaining.splice(best, 1);
  }

  const total = (list) => {
    let sum = 0;
    let from = base;
    list.forEach((p) => {
      sum += milesBetween(from, p.at);
      from = p.at;
    });
    return sum;
  };

  let best = total(ordered);
  let improved = true;
  let guard = 0;

  while (improved && guard < 40) {
    improved = false;
    guard += 1;

    for (let i = 0; i < ordered.length - 1; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const candidate = ordered
          .slice(0, i)
          .concat(ordered.slice(i, j + 1).reverse(), ordered.slice(j + 1));
        const length = total(candidate);
        if (length < best - 1e-9) {
          best = length;
          ordered.splice(0, ordered.length, ...candidate);
          improved = true;
        }
      }
    }
  }

  // Anything we could not place goes last, so it is obvious on screen that it
  // was not sequenced rather than being silently dropped into the middle.
  return { ordered: ordered.concat(unknown), miles: best };
}

// Where the van starts and ends. One constant rather than a setting, because
// there is one van and Neil knows where it lives; a config key nobody sets is
// how this ends up defaulting to the middle of the ocean.
const BASE = Object.freeze({ lat: 40.9404, lng: -74.1182 });

module.exports = { locate, sequence, milesBetween, addressLine, BASE };
