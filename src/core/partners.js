'use strict';

const db = require('../db');
const geocode = require('./geocode');

// ---------------------------------------------------------------------------
// The businesses we work with, and how far their scale is allowed to be off.
//
// Two kinds, because they are two different relationships. A LAUNDROMAT is
// somewhere we pay to wash bags and has a rate, a capacity and opening hours.
// A PROPERTY_MANAGER sends us customers and has none of those.
// ---------------------------------------------------------------------------

const TYPES = Object.freeze({
  LAUNDROMAT: 'Laundromat',
  PROPERTY_MANAGER: 'Management company',
});

const STATUSES = Object.freeze({
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  ENDED: 'Ended',
});

// --- How far apart two scales are allowed to be -----------------------------
//
// Two scales never agree exactly. A bag read on ours in a van and theirs on a
// counter will differ by a bit, and flagging every bit would train everybody to
// ignore the flag - which is the real failure, because then the one that
// matters gets ignored too.
//
// THE TOLERANCE IS THE LARGER OF A FIXED AMOUNT AND A PERCENTAGE, and it has to
// be both. A flat 2 lb is far too tight on a 60 lb load, where a 3 lb gap is
// ordinary; a flat 5% is far too loose on a 10 lb load, where half a pound
// should not be missed. Taking whichever is larger means the tolerance grows
// with the bag, which is how scale error actually behaves.
const TOLERANCE_LB = 2;
const TOLERANCE_PCT = 0.05;

function toleranceFor(ourWeightLb) {
  return Math.max(TOLERANCE_LB, Number(ourWeightLb || 0) * TOLERANCE_PCT);
}

// Compare the two figures on an order. Returns null when there is nothing to
// compare, so callers can treat "no answer yet" and "they agree" differently.
function compareWeights(order) {
  const ours = order.weight_lb == null ? null : Number(order.weight_lb);
  const theirs = order.partner_weight_lb == null ? null : Number(order.partner_weight_lb);
  if (ours == null || theirs == null) return null;

  const difference = theirs - ours;
  const tolerance = toleranceFor(ours);

  return {
    ours,
    theirs,
    // Signed, because the direction is the interesting part. Positive means
    // the laundromat read HEAVIER than us, which is the direction somebody
    // inflating a figure would push it.
    difference,
    absolute: Math.abs(difference),
    tolerance,
    overThreshold: Math.abs(difference) > tolerance,
    heavier: difference > 0,
  };
}

// --- Reading and writing them ----------------------------------------------

async function list({ type = null, includeEnded = false } = {}) {
  let query = db.from('partners').select('*').order('name', { ascending: true });
  if (type) query = query.eq('type', type);
  if (!includeEnded) query = query.neq('status', 'ENDED');

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Every laundromat a bag can be dropped at today. What the driver picks from.
async function activeLaundromats() {
  const { data, error } = await db
    .from('partners')
    .select('id, name, city, daily_capacity_lb')
    .eq('type', 'LAUNDROMAT')
    .eq('status', 'ACTIVE')
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function find(id) {
  const { data, error } = await db.from('partners').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Money arrives from a form as dollars and is stored as whole cents. A blank
// field is null - genuinely unknown - and not zero, which would read as free.
function centsFrom(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 100);
}

function wholeFrom(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.round(number);
}

function clean(value, max) {
  const text = String(value == null ? '' : value).trim();
  return text ? text.slice(0, max) : null;
}

// Turn a submitted form into a row. Used by both create and update, so the two
// cannot disagree about what a field means.
function fromForm(form) {
  const type = TYPES[form.type] ? form.type : 'LAUNDROMAT';
  const isLaundromat = type === 'LAUNDROMAT';

  return {
    type,
    name: clean(form.name, 120),
    status: STATUSES[form.status] ? form.status : 'ACTIVE',

    address_line1: clean(form.address_line1, 160),
    address_line2: clean(form.address_line2, 160),
    city: clean(form.city, 80),
    state: clean(form.state, 2) ? clean(form.state, 2).toUpperCase() : null,
    postal_code: clean(form.postal_code, 10),

    contact_name: clean(form.contact_name, 120),
    phone: clean(form.phone, 40),
    email: clean(form.email, 160),

    // The laundromat-only fields are cleared rather than left behind when a
    // record is switched to a management company. A stale wholesale rate on a
    // landlord is the kind of thing that gets read as real a year later.
    hours: isLaundromat ? clean(form.hours, 300) : null,
    retail_per_lb_cents: isLaundromat ? centsFrom(form.retail_per_lb) : null,
    wholesale_per_lb_cents: isLaundromat ? centsFrom(form.wholesale_per_lb) : null,
    daily_capacity_lb: isLaundromat ? wholeFrom(form.daily_capacity_lb) : null,

    notes: clean(form.notes, 2000),
  };
}

async function create(form) {
  const row = fromForm(form);
  if (!row.name) return { ok: false, detail: 'A partner needs a name.' };

  const { data, error } = await db.from('partners').insert(row).select('*').single();
  if (error) throw error;

  // Best effort, and after the insert. A geocoder having a bad day must not
  // stop somebody adding a partner.
  locate(data).catch(() => {});

  return { ok: true, partner: data };
}

async function update(id, form) {
  const row = fromForm(form);
  if (!row.name) return { ok: false, detail: 'A partner needs a name.' };

  row.updated_at = new Date().toISOString();

  const before = await find(id);

  // Moving the pin only when the address actually changed, so editing a phone
  // number does not spend a geocoder request.
  const moved =
    !before ||
    before.address_line1 !== row.address_line1 ||
    before.postal_code !== row.postal_code;

  if (moved) {
    row.lat = null;
    row.lng = null;
    row.geocoded_at = null;
    row.geocode_failed = false;
  }

  const { data, error } = await db
    .from('partners')
    .update(row)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;

  if (moved) locate(data).catch(() => {});

  return { ok: true, partner: data };
}

// Put a partner on the map. Same shape as a customer, and reusing the same
// rate-limited, cached lookup rather than a second one.
async function locate(partner) {
  if (partner.lat != null && partner.lng != null) return partner;
  if (partner.geocode_failed) return partner;

  const query = geocode.addressLine(partner);
  if (!query) return partner;

  const found = await geocode.lookupOnce(query);

  await db
    .from('partners')
    .update(
      found
        ? { lat: found.lat, lng: found.lng, geocoded_at: new Date().toISOString(), geocode_failed: false }
        : { geocoded_at: new Date().toISOString(), geocode_failed: true }
    )
    .eq('id', partner.id);

  return { ...partner, ...(found || {}) };
}

// --- The scale history ------------------------------------------------------
//
// Every order this partner handled where both weights exist. Point three of
// what Neil asked for: one bag two pounds out is two scales, and the same
// partner two pounds heavy on forty bags in a row is something else.
async function weightHistory(partnerId, { limit = 200 } = {}) {
  const { data, error } = await db
    .from('orders')
    .select('id, order_number, at_partner_at, weight_lb, partner_weight_lb, partner_weight_at')
    .eq('partner_id', partnerId)
    .not('weight_lb', 'is', null)
    .not('partner_weight_lb', 'is', null)
    .order('partner_weight_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = (data || []).map((order) => ({ order, check: compareWeights(order) }));

  const compared = rows.filter((r) => r.check);
  const overs = compared.filter((r) => r.check.overThreshold);

  // The number that actually answers "is somebody doing this on purpose".
  //
  // An honest scale is wrong in both directions and averages near zero. A
  // scale that is heavy every single time averages heavy, and that shows up
  // here long before any single bag looks bad enough to argue about.
  const meanDrift = compared.length
    ? compared.reduce((sum, r) => sum + r.check.difference, 0) / compared.length
    : 0;

  const heavier = compared.filter((r) => r.check.heavier).length;

  return {
    rows,
    total: compared.length,
    flagged: overs.length,
    meanDrift,
    heavier,
    // Out of how many, so "9 of 10 heavier" reads as the warning it is.
    lighter: compared.length - heavier,
  };
}

module.exports = {
  TYPES,
  STATUSES,
  TOLERANCE_LB,
  TOLERANCE_PCT,
  toleranceFor,
  compareWeights,
  list,
  activeLaundromats,
  find,
  create,
  update,
  weightHistory,
};
