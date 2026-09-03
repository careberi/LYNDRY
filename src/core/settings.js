'use strict';

const db = require('../db');
const geocode = require('./geocode');

// ---------------------------------------------------------------------------
// The switches that change how the service behaves right now.
//
// One row in `app_settings`, and one job: is the service taking orders, and if
// not, what does Neil want people told.
//
// CACHED FOR A FEW SECONDS, NOT FOR THE PROCESS LIFETIME. Every inbound text
// reads this, so hitting the database each time is waste; but a switch nobody
// can turn off without a redeploy is not a switch. Ten seconds is short enough
// that flipping it feels immediate and long enough that a busy minute does not
// hammer the table.
// ---------------------------------------------------------------------------

const CACHE_MS = 10 * 1000;

const DEFAULTS = Object.freeze({
  taking_orders: true,
  paused_reason: null,
});

let cached = null;
let cachedAt = 0;

async function read({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < CACHE_MS) return cached;

  const { data, error } = await db
    .from('app_settings')
    .select('*')
    .eq('id', true)
    .maybeSingle();

  if (error) {
    // A settings table having a bad day must not take the service down, and
    // the safe default is OPEN: refusing every order because a read failed
    // would be a worse outage than the one we are handling.
    console.error('Could not read app_settings:', error.message);
    return cached || { ...DEFAULTS };
  }

  cached = data || { ...DEFAULTS };
  cachedAt = Date.now();
  return cached;
}

// Are we booking?
async function takingOrders() {
  const s = await read();
  return s.taking_orders !== false;
}

// Why we are not, as a sentence, or null.
async function pausedReason() {
  const s = await read();
  return s.taking_orders === false ? s.paused_reason || null : null;
}

// Flip it. `reason` is only kept when switching OFF - Neil's call, and it is
// the right one: being open needs no explanation, and a stale reason left
// lying around would surface the next time somebody paused without typing one.
async function setTakingOrders(taking, reason, opsUserId) {
  const { data, error } = await db
    .from('app_settings')
    .update({
      taking_orders: Boolean(taking),
      paused_reason: taking ? null : String(reason || '').trim().slice(0, 300) || null,
      updated_at: new Date().toISOString(),
      updated_by: opsUserId || null,
    })
    .eq('id', true)
    .select('*')
    .maybeSingle();

  if (error) throw error;

  cached = data;
  cachedAt = Date.now();
  return data;
}

// ---------------------------------------------------------------------------
// WHERE THE VAN LIVES.
//
// This used to be a pair of coordinates frozen into geocode.js with no street
// address attached and nobody's name on the decision. Neil looked at the
// routing board and said the base "is not associated with me", which was
// exactly right - it was a point somebody had once typed, and there was no way
// to move it without a code change and a deploy.
//
// It is load-bearing in a way that is easy to miss: every route is measured
// from it, every driver with no base of their own falls back to it, and
// nearest-driver assignment compares against it. Wrong by a mile and every
// route is wrong from its first mile.
//
// THE CONSTANT SURVIVES AS THE LAST RESORT. A database that has never had a
// base set behaves exactly as it did before, which is what makes this safe to
// deploy without filling the form in first.
// ---------------------------------------------------------------------------

async function serviceBase() {
  const row = await read();

  const address = {
    line1: row.base_address_line1 || null,
    city: row.base_city || null,
    state: row.base_state || null,
    postal_code: row.base_postal_code || null,
  };

  const placed = row.base_lat != null && row.base_lng != null;

  return {
    ...address,
    // `set` is whether somebody chose this, `placed` is whether we could find
    // it on a map. They come apart: an address that the geocoder could not
    // place is set but not placed, and the page has to say so rather than
    // quietly routing from Fair Lawn as though nothing were wrong.
    set: Boolean(address.line1),
    placed,
    failed: Boolean(row.base_geocode_failed),
    lat: placed ? Number(row.base_lat) : geocode.BASE.lat,
    lng: placed ? Number(row.base_lng) : geocode.BASE.lng,
  };
}

// Save a new base and put it on the map. The lookup is done HERE rather than
// left to a later pass, because this is a form somebody just submitted and
// "it will sort itself out eventually" is not an answer when the next thing
// they do is look at the route it produced.
async function setServiceBase({ line1, city, state, postalCode }, opsUserId = null) {
  const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n) || null;

  const address = {
    address_line1: clean(line1, 120),
    city: clean(city, 80),
    state: clean(state, 2) || 'NJ',
    postal_code: clean(postalCode, 10),
  };

  const row = {
    base_address_line1: address.address_line1,
    base_city: address.city,
    base_state: address.state,
    base_postal_code: address.postal_code,
    // Cleared before the lookup, never after. A failed geocode must leave the
    // base unplaced rather than still pointing at the previous building - the
    // old pin is the one answer that is definitely wrong now.
    base_lat: null,
    base_lng: null,
    base_geocoded_at: null,
    base_geocode_failed: false,
    updated_at: new Date().toISOString(),
    updated_by: opsUserId,
  };

  if (address.address_line1) {
    const found = await geocode.lookupOnce(geocode.addressLine(address));
    if (found) {
      row.base_lat = found.lat;
      row.base_lng = found.lng;
      row.base_geocoded_at = new Date().toISOString();
    } else {
      row.base_geocode_failed = true;
      row.base_geocoded_at = new Date().toISOString();
    }
  }

  const { error } = await db.from('app_settings').update(row).eq('id', true);
  if (error) throw error;

  cached = null;
  return serviceBase();
}

// THE WEIGHT THRESHOLDS, as the comparison code wants them. Read through here
// so there is one place that knows the column names and one place that knows
// what to do when the row cannot be read.
async function weightLimits() {
  const row = await read();
  return {
    normalPct: Number(row.weight_normal_pct != null ? row.weight_normal_pct : 3),
    acceptablePct: Number(row.weight_acceptable_pct != null ? row.weight_acceptable_pct : 5),
    minLb: Number(row.weight_min_lb != null ? row.weight_min_lb : 2),

    // DIRTY IN AGAINST CLEAN OUT, which is a different question from two scales
    // weighing the same laundry and so has its own numbers. Water and grit come
    // out in the wash, so lighter is expected; heavier is not, whatever the
    // load weighs.
    dryLossPct: Number(row.weight_dry_loss_pct != null ? row.weight_dry_loss_pct : 8),
    gainLb: Number(row.weight_gain_lb != null ? row.weight_gain_lb : 0.5),
  };
}

// Set the three weight thresholds. Clamped rather than validated-and-refused:
// a percentage of 0 or 900 is a typo, not an attack, and quietly holding it to
// something sane beats a red error a busy person has to read.
async function setWeightLimits(
  { normalPct, acceptablePct, minLb, dryLossPct, gainLb },
  opsUserId = null
) {
  const clamp = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };

  const normal = clamp(normalPct, 0, 50, 3);

  const row = {
    weight_normal_pct: normal,
    // THE ACCEPTABLE BAND CANNOT SIT BELOW THE NORMAL ONE. If it did, the
    // middle band would be empty and every order past normal would go straight
    // to exception - which is the two-band behaviour this replaced, arrived at
    // by accident rather than on purpose.
    weight_acceptable_pct: Math.max(normal, clamp(acceptablePct, 0, 50, 5)),
    weight_min_lb: clamp(minLb, 0, 20, 2),
    weight_dry_loss_pct: clamp(dryLossPct, 0, 50, 8),
    // In pounds, not a percentage, and capped low: laundry does not gain weight
    // in a dryer, so a generous allowance here would only hide the one thing
    // this check exists to catch.
    weight_gain_lb: clamp(gainLb, 0, 10, 0.5),
    updated_at: new Date().toISOString(),
    updated_by: opsUserId,
  };

  const { error } = await db.from('app_settings').update(row).eq('id', true);
  if (error) throw error;

  cached = null;
  return row;
}

module.exports = {
  serviceBase,
  setServiceBase,
  weightLimits,
  setWeightLimits, read, takingOrders, pausedReason, setTakingOrders, CACHE_MS };
