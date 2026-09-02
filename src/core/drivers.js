'use strict';

const db = require('../db');
const geocode = require('./geocode');
const roles = require('./roles');

// ---------------------------------------------------------------------------
// Drivers, their home bases, and whose order is whose.
//
// The system ran for a long time on the assumption that there was one driver,
// and it never said so - the route started at a single hardcoded point and an
// order belonged to nobody. This is the file that makes the assumption explicit
// and then removes it.
//
// A DRIVER WORKS OUT OF SOMEWHERE. Fair Lawn is not Maryland, and a route
// solved from the wrong start point is wrong from the first mile. The base is
// an address on their row, geocoded through the same rate-limited lookup as a
// customer's and a partner's.
//
// AN ORDER BELONGS TO ONE OF THEM, assigned automatically to whoever is nearest
// and reassignable by hand. The automatic answer is a starting position, not a
// verdict: it knows about distance and nothing at all about who is off sick,
// who is already carrying a full van, or who is better with a difficult
// building. Neil asked for automatic; making it correctable costs a dropdown
// and prevents the failure where the system is confidently wrong all morning.
// ---------------------------------------------------------------------------

const DRIVER_FIELDS =
  'id, name, phone, role, status, drives, wage_cents_hour, base_address_line1, base_address_line2, ' +
  'base_city, base_state, base_postal_code, base_lat, base_lng, base_geocode_failed';

// Anyone who actually drives a round.
//
// orders.drive, not orders.act. An admin holds orders.act because fixing a
// fat-fingered weight is admin work, and filtering on that put every admin in
// the assignment pool - orders were being handed to whoever was at a desk. An
// admin is an admin; they do not have a round.
async function active() {
  const { data, error } = await db
    .from('ops_users')
    .select(DRIVER_FIELDS)
    .eq('status', 'ACTIVE')
    .order('name', { ascending: true });

  if (error) throw error;

  return (data || []).filter((u) => roles.can(u, 'orders.drive'));
}

async function find(id) {
  if (!id) return null;
  const { data, error } = await db.from('ops_users').select(DRIVER_FIELDS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

// The address fields under the names geocode expects, so one lookup serves
// customers, partners and drivers rather than three near-identical ones.
function baseAddress(driver) {
  if (!driver) return null;
  return {
    address_line1: driver.base_address_line1,
    address_line2: driver.base_address_line2,
    city: driver.base_city,
    state: driver.base_state,
    postal_code: driver.base_postal_code,
    lat: driver.base_lat,
    lng: driver.base_lng,
    geocode_failed: driver.base_geocode_failed,
  };
}

// WHERE THIS DRIVER'S DAY STARTS AND ENDS.
//
// Falls back to the service-wide base when they have no address of their own,
// which is what every route used before drivers had bases - so nothing breaks
// on the day this ships and a driver whose base is not filled in yet still gets
// a sensible route rather than none.
// `fallback` is the SERVICE base, which is now a setting somebody typed rather
// than a constant. It is passed in rather than read here because this is
// synchronous and called in a loop - a database read per driver, per render,
// for one value they all share is waste. Callers that have loaded settings pass
// it; anything that has not still gets the frozen constant, which is exactly
// what every route used before the setting existed.
function baseOf(driver, fallback = null) {
  if (driver && driver.base_lat != null && driver.base_lng != null) {
    return { lat: Number(driver.base_lat), lng: Number(driver.base_lng), own: true };
  }
  const base = fallback || geocode.BASE;
  return { lat: Number(base.lat), lng: Number(base.lng), own: false };
}

// The service base as everything that routes should see it: what Neil typed on
// the routing page, or the constant if he never has.
async function serviceBase() {
  // Required lazily. settings requires geocode and drivers requires both, and
  // a top-level require here closes the loop into a half-built module.
  return require('./settings').serviceBase();
}

// Put a driver's base on the map. Best effort and after the fact, like the
// partner one - a geocoder having a bad day must not stop somebody being added
// to the team.
async function locate(driver) {
  if (!driver) return driver;
  if (driver.base_lat != null && driver.base_lng != null) return driver;
  if (driver.base_geocode_failed) return driver;

  const query = geocode.addressLine(baseAddress(driver));
  if (!query) return driver;

  const found = await geocode.lookupOnce(query);

  await db
    .from('ops_users')
    .update(
      found
        ? {
            base_lat: found.lat,
            base_lng: found.lng,
            base_geocoded_at: new Date().toISOString(),
            base_geocode_failed: false,
          }
        : { base_geocoded_at: new Date().toISOString(), base_geocode_failed: true }
    )
    .eq('id', driver.id);

  return found ? { ...driver, base_lat: found.lat, base_lng: found.lng } : driver;
}

// Save a base from the profile form. Clearing the address clears the pin with
// it, otherwise somebody who moved would keep routing from where they used to
// be.
//
// ONLY RE-PINS WHEN THE ADDRESS ACTUALLY CHANGED. This used to null the pin on
// every call, which was harmless while it had its own button and is not now
// that it is part of saving a whole profile: correcting a typo in somebody's
// name would have thrown their location away and spent a geocoder request
// putting it back, and left them routing from the service base in between.
async function saveBase(id, form) {
  const clean = (value, max) => {
    const text = String(value == null ? '' : value).trim();
    return text ? text.slice(0, max) : null;
  };

  const state = clean(form.base_state, 2);

  const row = {
    base_address_line1: clean(form.base_address_line1, 160),
    base_address_line2: clean(form.base_address_line2, 160),
    base_city: clean(form.base_city, 80),
    base_state: state ? state.toUpperCase() : null,
    base_postal_code: clean(form.base_postal_code, 10),
  };

  const before = await find(id);

  const moved =
    !before ||
    before.base_address_line1 !== row.base_address_line1 ||
    before.base_city !== row.base_city ||
    before.base_postal_code !== row.base_postal_code;

  if (moved) {
    row.base_lat = null;
    row.base_lng = null;
    row.base_geocoded_at = null;
    row.base_geocode_failed = false;
  }

  const { data, error } = await db.from('ops_users').update(row).eq('id', id).select(DRIVER_FIELDS).single();
  if (error) throw error;

  if (moved && row.base_address_line1) locate(data).catch(() => {});

  return data;
}

// --- When somebody actually works -------------------------------------------
//
// Same shape as a partner's hours and read the same way, with ONE deliberate
// difference: a driver with NO hours at all is treated as always available.
//
// A partner with no hours is somebody we have not asked yet, and a van sent to
// a shut door wastes a trip - so unknown means closed. A driver with no hours
// is the one-van business that has never needed a rota, and refusing to assign
// them anything would stop the system dead the moment somebody is added.

async function hoursFor(opsUserId) {
  const { data, error } = await db
    .from('ops_user_hours')
    .select('*')
    .eq('ops_user_id', opsUserId)
    .order('weekday', { ascending: true })
    .order('starts_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Everybody's, in one query, as a Map. The assignment asks about the whole team
// at once and a query each would be a round trip per driver.
async function hoursForAll() {
  const { data, error } = await db
    .from('ops_user_hours')
    .select('*')
    .order('weekday', { ascending: true })
    .order('starts_at', { ascending: true });

  if (error) throw error;

  const byPerson = new Map();
  for (const row of data || []) {
    if (!byPerson.has(row.ops_user_id)) byPerson.set(row.ops_user_id, []);
    byPerson.get(row.ops_user_id).push(row);
  }
  return byPerson;
}

function minutesOfDay(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mins = Number(m[2]);
  return h > 23 || mins > 59 ? null : h * 60 + mins;
}

// Is this person working then? `weekday` is 0-6 with Sunday as 0, `time` is
// "HH:MM" on the service clock.
function isWorking(rows, weekday, time) {
  // No rota at all: always available. See the note above.
  if (!rows || !rows.length) return true;

  const at = minutesOfDay(time);
  if (at == null) return true;

  return rows
    .filter((r) => Number(r.weekday) === Number(weekday))
    .some((r) => {
      const from = minutesOfDay(r.starts_at);
      const to = minutesOfDay(r.ends_at);
      if (from == null || to == null) return false;
      // End-exclusive: a shift that ends at five is not being worked at five.
      return at >= from && at < to;
    });
}

// "Mon-Fri 7am-4pm, Sat 8am-1pm" from the rows. Consecutive days with identical
// hours collapse, because seven lines that say the same thing is not something
// anybody reads.
function describeHours(rows) {
  if (!rows || !rows.length) return 'Any day, any time';

  const byDay = [0, 1, 2, 3, 4, 5, 6].map((day) =>
    rows
      .filter((r) => Number(r.weekday) === day)
      .map((r) => `${String(r.starts_at).slice(0, 5)}-${String(r.ends_at).slice(0, 5)}`)
      .join(', ')
  );

  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups = [];

  for (const day of order) {
    const spec = byDay[day];
    const last = groups[groups.length - 1];
    if (last && last.spec === spec) last.days.push(day);
    else groups.push({ spec, days: [day] });
  }

  const clock = (mins) => {
    const h24 = Math.floor(mins / 60);
    const m = mins % 60;
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''}${h24 < 12 ? 'am' : 'pm'}`;
  };

  const pretty = (spec) =>
    spec
      ? spec
          .split(', ')
          .map((r) => r.split('-').map((t) => clock(minutesOfDay(t))).join('-'))
          .join(' and ')
      : 'off';

  return groups
    .filter((g) => g.spec || g.days.length < 7)
    .map((g) => {
      const label =
        g.days.length === 1
          ? names[g.days[0]]
          : `${names[g.days[0]]}-${names[g.days[g.days.length - 1]]}`;
      return `${label} ${pretty(g.spec)}`;
    })
    .join(', ');
}

// Replace somebody's whole week from a submitted form. Delete then insert: the
// form IS the week, so a day left out is a day off, exactly as partner hours
// work.
async function saveHours(opsUserId, form) {
  const rows = [];

  for (let day = 0; day < 7; day += 1) {
    for (const suffix of ['', '_2']) {
      const from = (form || {})[`shift_${day}_start${suffix}`];
      const to = (form || {})[`shift_${day}_end${suffix}`];

      const start = minutesOfDay(from);
      const end = minutesOfDay(to);

      // Both or neither. Half a pair is somebody mid-edit, and guessing the
      // other half invents a shift nobody typed.
      if (start == null || end == null || end <= start) continue;

      rows.push({
        ops_user_id: opsUserId,
        weekday: day,
        starts_at: String(from).slice(0, 5),
        ends_at: String(to).slice(0, 5),
      });
    }
  }

  const { error: clearError } = await db
    .from('ops_user_hours')
    .delete()
    .eq('ops_user_id', opsUserId);
  if (clearError) throw clearError;

  if (!rows.length) return [];

  const { data, error } = await db.from('ops_user_hours').insert(rows).select('*');
  if (error) throw error;
  return data || [];
}

// --- Who gets it ------------------------------------------------------------

// The nearest active driver to a point, by home base.
//
// Returns null rather than guessing when there is nobody to choose from, and
// the order stays unassigned. An unassigned order is a real state and the
// boards show it as one - inventing an owner would be worse, because the order
// would then look handled.
//
// Drivers with no base of their own are still candidates: they fall back to the
// service base, which is a real place a van leaves from. Excluding them would
// mean a team with no bases filled in gets nothing assigned at all.
async function nearest(at, { drivers = null, weekday = null, time = null } = {}) {
  if (!at || at.lat == null || at.lng == null) return null;

  const list = drivers || (await active());
  if (!list.length) return null;

  // NOBODY GETS WORK ON A DAY THEY DO NOT WORK.
  //
  // The system knew when a laundromat was open and nothing about when its own
  // drivers were, so a Sunday pickup went to somebody who does not work Sundays
  // and no screen said so. Only applied when the caller says WHEN - assignment
  // knows the pickup day, and something asking "who is nearest" in the abstract
  // should not be answered with "nobody, it is Sunday".
  let candidates = list;

  if (weekday != null) {
    const rota = await hoursForAll();
    const working = list.filter((driver) => isWorking(rota.get(driver.id), weekday, time || '09:00'));

    // If NOBODY is down as working, fall back to everybody rather than leaving
    // the order unassigned. A rota nobody filled in should not silently stop
    // work being handed out; an unassigned order is the thing that gets missed.
    if (working.length) candidates = working;
  }

  const fallback = await serviceBase();

  let best = null;
  for (const driver of candidates) {
    const base = baseOf(driver, fallback);
    const miles = geocode.milesBetween(base, at);
    if (!best || miles < best.miles) best = { driver, miles, ownBase: base.own };
  }

  return best;
}

// Give an order a driver. Safe to call more than once: it never moves an order
// that already has one, because reassignment is a decision somebody made and an
// automatic pass must not quietly undo it.
async function assign(order, { force = false } = {}) {
  if (!order) return null;
  if (order.driver_id && !force) return order.driver_id;

  const at = await geocode.locate(order.customers || {});
  if (!at) return null;

  // The day the pickup is actually booked for, so somebody who does not work
  // Sundays is not handed a Sunday. Built from the ISO date rather than a local
  // Date so a server in another timezone cannot land on the wrong weekday.
  let weekday = null;
  if (order.pickup_date) {
    const [y, m, d] = String(order.pickup_date).split('-').map(Number);
    weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  const best = await nearest(at, { weekday, time: order.pickup_time || '09:00' });
  if (!best) return null;

  const { error } = await db.from('orders').update({ driver_id: best.driver.id }).eq('id', order.id);
  if (error) throw error;

  return best.driver.id;
}

// --- Where their day stands -------------------------------------------------

// The stops that are done, and the one they are on.
//
// Derived from the timestamps already on the order rather than a "progress"
// column, for the same reason the partner load is a query: a second copy of a
// fact is a second thing that can be wrong, and this one would go stale every
// time somebody used the JSON API instead of the buttons.
function progressOf(orders) {
  const list = orders || [];

  const collected = list.filter((o) => o.collected_at).length;
  const delivered = list.filter((o) => o.delivered_at).length;
  const toCollect = list.filter((o) => !o.collected_at && o.status === 'REQUESTED').length;
  const carrying = list.filter(
    (o) => o.collected_at && !o.delivered_at && o.status !== 'CANCELED'
  ).length;

  // Where they physically are: the highest stop number they have finished.
  // Stop numbers are cleared on delivery, so this reads the loaded run rather
  // than assuming the numbers survive the day.
  const numbered = list.filter((o) => o.stop_number != null).sort((a, b) => a.stop_number - b.stop_number);
  const nextStop = numbered.find((o) => !o.delivered_at) || null;

  const total = list.length;
  const done = delivered;

  return {
    total,
    done,
    toCollect,
    collected,
    carrying,
    delivered,
    nextStop,
    // Null rather than 0 when there is nothing on, so a driver with an empty
    // day reads as "nothing on" instead of "0% done".
    fraction: total ? done / total : null,
    idle: total === 0,
  };
}

// Every driver with their day attached, for the strip on the orders board.
async function board(dateIso) {
  const list = await active();

  const { data, error } = await db
    .from('orders')
    .select(
      'id, order_number, status, driver_id, stop_number, pickup_date, collected_at, ' +
        'delivered_at, weight_lb, customers(city)'
    )
    .or(`pickup_date.eq.${dateIso},status.in.(IN_PROCESS,AT_PARTNER,READY,OUT_FOR_DELIVERY)`)
    .neq('status', 'CANCELED');

  if (error) throw error;

  const all = data || [];

  const fallback = await serviceBase();

  const rows = list.map((driver) => ({
    driver,
    base: baseOf(driver, fallback),
    orders: all.filter((o) => o.driver_id === driver.id),
    progress: progressOf(all.filter((o) => o.driver_id === driver.id)),
  }));

  // Orders nobody owns get their own row rather than being left out. This is
  // the list worth looking at: an order with no driver is the one that does not
  // get collected, and hiding it is how that happens quietly.
  const orphans = all.filter((o) => !o.driver_id);

  return { rows, orphans, total: all.length };
}

module.exports = {
  serviceBase,
  DRIVER_FIELDS,
  active,
  hoursFor,
  hoursForAll,
  isWorking,
  describeHours,
  saveHours,
  find,
  baseAddress,
  baseOf,
  locate,
  saveBase,
  nearest,
  assign,
  progressOf,
  board,
};
