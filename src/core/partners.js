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
// THE DEFAULTS ONLY. The live numbers are set by the admin on the settings
// screen and read from app_settings; these are what a fresh database starts
// with and what is used if that read ever fails.
const TOLERANCE_LB = 2;
const TOLERANCE_PCT = 0.05;

// NEIL'S THREE BANDS.
//
//   NORMAL      inside the normal percentage. Two scales describing the same
//               laundry. Nothing to do.
//   ACCEPTABLE  past normal, inside the exception line. Not worth stopping
//               for, and worth COUNTING: a partner who sits here every single
//               time has a scale that needs replacing, and one order in this
//               band tells you nothing while forty do.
//   EXCEPTION   past the exception line. Nothing is invoiced automatically -
//               it is raised and an admin sets the poundage by hand.
//
// ONE SET OF NUMBERS FOR EVERY PARTNER, which is Neil's call: "it doesn't
// matter if they have a bad scale. They need to get another one if they're
// going to be doing our service." A per-partner override would let a bad scale
// quietly loosen its own tolerance, which is the opposite of the point.
const BANDS = Object.freeze({ NORMAL: 'NORMAL', ACCEPTABLE: 'ACCEPTABLE', EXCEPTION: 'EXCEPTION' });

// THE FLOOR MATTERS AS MUCH AS THE PERCENTAGE. 5% of a 10 lb bag is half a
// pound, which is inside what two honest scales differ by - without a minimum
// every small order would raise an exception and the queue would be noise. A
// flat allowance alone is no good either: 2 lb is far too tight on a 60 lb
// load, where a 3 lb gap is ordinary. So it is the larger of the two, which is
// how scale error actually behaves.
function bandFor(ourWeightLb, difference, limits) {
  const ours = Number(ourWeightLb || 0);
  const gap = Math.abs(difference);

  const minLb = Number(limits.minLb);
  const normal = Math.max(minLb, ours * (Number(limits.normalPct) / 100));
  const acceptable = Math.max(minLb, ours * (Number(limits.acceptablePct) / 100));

  if (gap <= normal) return BANDS.NORMAL;
  if (gap <= acceptable) return BANDS.ACCEPTABLE;
  return BANDS.EXCEPTION;
}

function toleranceFor(ourWeightLb) {
  return Math.max(TOLERANCE_LB, Number(ourWeightLb || 0) * TOLERANCE_PCT);
}

// Compare the two figures on an order. Returns null when there is nothing to
// compare, so callers can treat "no answer yet" and "they agree" differently.
// `limits` comes from the settings row. Passed in rather than read here so this
// stays a pure function - it is called in loops on the partner page, and a
// database read per row would be a page that gets slower the more orders a
// laundromat has done.
function compareWeights(order, limits = null) {
  const ours = order.weight_lb == null ? null : Number(order.weight_lb);
  const theirs = order.partner_weight_lb == null ? null : Number(order.partner_weight_lb);
  if (ours == null || theirs == null) return null;

  const difference = theirs - ours;
  const tolerance = toleranceFor(ours);

  const bands = limits || {
    normalPct: TOLERANCE_PCT * 100,
    acceptablePct: TOLERANCE_PCT * 100,
    minLb: TOLERANCE_LB,
  };

  const band = bandFor(ours, difference, bands);

  return {
    ours,
    theirs,
    band,
    // The percentage the two are apart, for saying it out loud. Against OUR
    // weight, because that is the one we measured and the one being checked.
    pct: ours > 0 ? (Math.abs(difference) / ours) * 100 : 0,
    // Signed, because the direction is the interesting part. Positive means
    // the laundromat read HEAVIER than us, which is the direction somebody
    // inflating a figure would push it.
    difference,
    absolute: Math.abs(difference),
    tolerance,
    // Kept as the old name so nothing that already asks about it breaks. It
    // means the same thing it always did - past the line where a person has to
    // look - and that line is now the EXCEPTION band.
    overThreshold: band === BANDS.EXCEPTION,
    heavier: difference > 0,
  };
}

// WHAT THE LAUNDROMAT IS INVOICED FOR.
//
// Their own reported weight, higher or lower than ours - Neil's rule, and the
// reason it is not simply "the lower of the two" is that we are buying a wash
// of what they actually put in the machine. If their scale says 50 and ours
// said 45, they washed 50 lb as far as they can tell, and arguing it down by
// five pounds every time is not a relationship that lasts.
//
// UNLESS THE TWO DISAGREE TOO MUCH. Past the exception line nothing is
// invoiced automatically. Returns null, which is not "nothing" - it is "a
// person has to decide", and the caller raises it.
function partnerBillFor(check) {
  if (!check) return null;
  return check.band === BANDS.EXCEPTION ? null : check.theirs;
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

    // Entered in hours because that is how a laundromat talks about it, stored
    // in minutes because that is what the arithmetic wants.
    turnaround_minutes: isLaundromat
      ? (() => {
          const hours = wholeFrom(form.turnaround_hours);
          return hours == null ? null : hours * 60;
        })()
      : null,
    dropoff_cutoff: isLaundromat ? clean(form.dropoff_cutoff, 8) : null,

    // HOW OFTEN THEY BILL US AND HOW LONG WE HAVE TO PAY. Laundromat-only, and
    // cleared with the rest when a record is switched to a management company,
    // for the same reason: terms left on somebody they were never agreed with
    // get read as real later.
    //
    // Both fall back rather than accepting anything: the column has a CHECK on
    // it, and a typo in a form field is not worth a 500 on the save.
    billing_period: isLaundromat
      ? BILLING_PERIODS.includes(String(form.billing_period))
        ? String(form.billing_period)
        : 'BIWEEKLY'
      : 'BIWEEKLY',

    payment_terms_days: isLaundromat
      ? Math.min(120, Math.max(0, wholeFrom(form.payment_terms_days) ?? 15))
      : 15,

    notes: clean(form.notes, 2000),
  };
}

// The cycles a laundromat can bill on. Mirrors the CHECK constraint, so the
// form and the database cannot disagree about what is allowed.
const BILLING_PERIODS = Object.freeze(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']);

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

// --- Opening hours ----------------------------------------------------------
//
// `partners.hours` is still free text and is still the human note. These read
// `partner_hours`, which is the version routing uses, and the rule is simple:
// A WEEKDAY WITH NO ROW IS CLOSED. Absence has to mean closed rather than
// unknown, because "we never filled it in" is not an answer a van can act on,
// and treating a blank as open is how a driver ends up at a shut door.

const WEEKDAYS = Object.freeze([
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]);

// "07:00:00" from Postgres and "07:00" from a form both mean the same thing.
function minutesOfDay(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function hhmm(value) {
  const mins = minutesOfDay(value);
  if (mins == null) return null;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

async function hoursFor(partnerId) {
  const { data, error } = await db
    .from('partner_hours')
    .select('*')
    .eq('partner_id', partnerId)
    .order('weekday', { ascending: true })
    .order('opens_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Every partner's hours in one query, as a Map keyed by partner id. The board
// needs all of them at once and a query each would be a route trip per
// laundromat for a table that will never be long.
async function hoursForAll() {
  const { data, error } = await db
    .from('partner_hours')
    .select('*')
    .order('weekday', { ascending: true })
    .order('opens_at', { ascending: true });

  if (error) throw error;

  const byPartner = new Map();
  for (const row of data || []) {
    if (!byPartner.has(row.partner_id)) byPartner.set(row.partner_id, []);
    byPartner.get(row.partner_id).push(row);
  }
  return byPartner;
}

// Is this partner open at this moment? `weekday` is 0-6 with Sunday as 0, the
// same as JavaScript's getDay(), and `time` is "HH:MM" on the service clock.
//
// Several rows on one weekday is a split shift - open for lunch, shut, open
// again - so a time counts as open if it falls in ANY of them.
function isOpenAt(rows, weekday, time) {
  const at = minutesOfDay(time);
  if (at == null) return false;

  return (rows || [])
    .filter((r) => Number(r.weekday) === Number(weekday))
    .some((r) => {
      const from = minutesOfDay(r.opens_at);
      const to = minutesOfDay(r.closes_at);
      if (from == null || to == null) return false;
      // End-exclusive: arriving at the exact minute they close is arriving
      // after they closed, and a van that leaves at 9pm sharp did not make it.
      return at >= from && at < to;
    });
}

// "Mon-Fri 7am-9pm, Sat 8am-6pm" from the rows, for showing on a page.
// Consecutive weekdays with identical hours are collapsed, because seven lines
// that all say the same thing is not something anybody reads.
function describeHours(rows) {
  const byDay = WEEKDAYS.map((_, day) =>
    (rows || [])
      .filter((r) => Number(r.weekday) === day)
      .map((r) => `${hhmm(r.opens_at)}-${hhmm(r.closes_at)}`)
      .join(', ')
  );

  // Monday first, because that is how opening hours are written on a door.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups = [];

  for (const day of order) {
    const spec = byDay[day];
    const last = groups[groups.length - 1];
    if (last && last.spec === spec) last.days.push(day);
    else groups.push({ spec, days: [day] });
  }

  const short = (day) => WEEKDAYS[day].slice(0, 3);
  const readable = (mins) => {
    const h24 = Math.floor(mins / 60);
    const m = mins % 60;
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''}${h24 < 12 ? 'am' : 'pm'}`;
  };

  // Shifts within one day join with "and", not a comma. Commas already separate
  // the day groups, so "Wed 7am-12pm, 2pm-8pm, Thu closed" leaves you unable to
  // tell which day the afternoon shift belongs to.
  const pretty = (spec) =>
    spec
      ? spec
          .split(', ')
          .map((range) => range.split('-').map((t) => readable(minutesOfDay(t))).join('-'))
          .join(' and ')
      : 'closed';

  return groups
    .filter((g) => g.spec || g.days.length < 7)
    .map((g) => {
      const label =
        g.days.length === 1
          ? short(g.days[0])
          : `${short(g.days[0])}-${short(g.days[g.days.length - 1])}`;
      return `${label} ${pretty(g.spec)}`;
    })
    .join(', ');
}

// Replace a partner's hours wholesale from a submitted form.
//
// Delete-then-insert rather than a diff: the form IS the whole week, so what
// is not in it is closed, and working out which individual rows changed would
// be more code for exactly the same result.
async function saveHours(partnerId, form) {
  const rows = [];

  for (let day = 0; day < 7; day += 1) {
    // A day can carry a second shift. The form names them hours_1_open and
    // hours_1_open_2, so a laundromat that shuts for lunch can say so.
    for (const suffix of ['', '_2']) {
      const opens = hhmm((form || {})[`hours_${day}_open${suffix}`]);
      const closes = hhmm((form || {})[`hours_${day}_close${suffix}`]);

      // Both or neither. Half a pair is somebody mid-edit, and guessing the
      // other half would invent an opening time nobody typed.
      if (!opens || !closes) continue;
      if (minutesOfDay(closes) <= minutesOfDay(opens)) continue;

      rows.push({ partner_id: partnerId, weekday: day, opens_at: opens, closes_at: closes });
    }
  }

  const { error: clearError } = await db.from('partner_hours').delete().eq('partner_id', partnerId);
  if (clearError) throw clearError;

  if (!rows.length) return [];

  const { data, error } = await db.from('partner_hours').insert(rows).select('*');
  if (error) throw error;
  return data || [];
}

// --- How much is at each laundromat right now -------------------------------
//
// There is no separate ledger for this and there must not be one. A bag is at a
// partner when its order says so, and its weight is on the order - so the load
// IS that query. A running total kept in a column would be a second version of
// the same fact, and the two would disagree the first time anything went wrong.
//
// AT_PARTNER means they are washing it. READY means they have finished but we
// have not collected it yet - it is still taking up their floor, so it still
// counts against what they can take today.
// WHAT IS COMING, NOT JUST WHAT IS THERE.
//
// loadByPartner() counts bags physically on a laundromat's floor. That is the
// right answer to "how full are they now" and the wrong one to "who should this
// order go to", because an order booked for tomorrow is not on anybody's floor
// yet - so ten orders already planned to one partner made it look empty and the
// eleventh went there too.
//
// Neil's rule: choose from the whole picture, today AND tomorrow. `dates` is
// the ISO days to count, and the caller decides which - normally the pickup day
// and the one after it, because a bag collected late is washed the next
// morning.
//
// Planned, NOT arrived: anything already AT_PARTNER or READY is counted by
// loadByPartner and counting it twice would make every partner look full.
async function plannedByPartner(dates) {
  const days = (dates || []).filter(Boolean);
  if (!days.length) return new Map();

  const { data, error } = await db
    .from('orders')
    .select('intended_partner_id, weight_lb, bag_count, pickup_date, status')
    .not('intended_partner_id', 'is', null)
    .in('pickup_date', days)
    .in('status', ['REQUESTED', 'ASSIGNED', 'DEPOSITED', 'IN_PROCESS']);

  if (error) throw error;

  const byPartner = new Map();
  for (const order of data || []) {
    const seen = byPartner.get(order.intended_partner_id) || { bags: 0, pounds: 0, unweighed: 0 };
    seen.bags += Number(order.bag_count || 1);
    if (order.weight_lb == null) seen.unweighed += 1;
    else seen.pounds += Number(order.weight_lb);
    byPartner.set(order.intended_partner_id, seen);
  }

  return byPartner;
}

async function loadByPartner() {
  const { data, error } = await db
    .from('orders')
    .select('partner_id, weight_lb, status')
    .not('partner_id', 'is', null)
    .in('status', ['AT_PARTNER', 'READY']);

  if (error) throw error;

  const byPartner = new Map();
  for (const order of data || []) {
    const seen = byPartner.get(order.partner_id) || { bags: 0, pounds: 0, unweighed: 0 };
    seen.bags += 1;
    // A bag dropped off before it was weighed has no pounds yet. Counting it
    // as zero would quietly understate how full somebody is, so it is counted
    // separately and shown as its own number.
    if (order.weight_lb == null) seen.unweighed += 1;
    else seen.pounds += Number(order.weight_lb);
    byPartner.set(order.partner_id, seen);
  }

  return byPartner;
}

// What one partner can still take today, given what they already have.
//
// `remaining` is null - not zero - when no capacity was ever entered. Unknown
// and full are different answers, and routing has to be able to tell them
// apart rather than treating a blank form field as a shut door.
function capacityOf(partner, load) {
  const used = (load && load.pounds) || 0;
  const cap = partner.daily_capacity_lb == null ? null : Number(partner.daily_capacity_lb);

  return {
    bags: (load && load.bags) || 0,
    unweighed: (load && load.unweighed) || 0,
    used,
    capacity: cap,
    remaining: cap == null ? null : Math.max(0, cap - used),
    full: cap != null && used >= cap,
    // How full, for a bar on a page. Null when there is nothing to be a
    // fraction of.
    fraction: cap ? Math.min(1, used / cap) : null,
  };
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
  BILLING_PERIODS,
  TYPES,
  STATUSES,
  WEEKDAYS,
  minutesOfDay,
  hoursFor,
  hoursForAll,
  isOpenAt,
  describeHours,
  saveHours,
  loadByPartner,
  plannedByPartner,
  capacityOf,
  BANDS,
  bandFor,
  partnerBillFor,
  TOLERANCE_LB,
  TOLERANCE_PCT,
  toleranceFor,
  compareWeights,
  list,
  activeLaundromats,
  find,
  create,
  update,
  // Exported so a partner added before the geocoder answered can be put on the
  // map later. create() calls it best-effort and swallows a failure, which is
  // right at the time - but something has to be able to try again.
  locate,
  weightHistory,
};
