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
  'id, name, phone, role, status, drives, base_address_line1, base_address_line2, ' +
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
function baseOf(driver) {
  if (driver && driver.base_lat != null && driver.base_lng != null) {
    return { lat: Number(driver.base_lat), lng: Number(driver.base_lng), own: true };
  }
  return { ...geocode.BASE, own: false };
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

// Save a base from the team form. Clearing the address clears the pin with it,
// otherwise a driver who moved would keep routing from where they used to be.
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
    // Any edit re-pins from scratch. Working out whether the change was
    // material would be more code than one geocoder call for something that
    // happens a handful of times a year.
    base_lat: null,
    base_lng: null,
    base_geocoded_at: null,
    base_geocode_failed: false,
  };

  const { data, error } = await db.from('ops_users').update(row).eq('id', id).select(DRIVER_FIELDS).single();
  if (error) throw error;

  if (row.base_address_line1) locate(data).catch(() => {});

  return data;
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
async function nearest(at, { drivers = null } = {}) {
  if (!at || at.lat == null || at.lng == null) return null;

  const list = drivers || (await active());
  if (!list.length) return null;

  let best = null;
  for (const driver of list) {
    const base = baseOf(driver);
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

  const best = await nearest(at);
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

  const rows = list.map((driver) => ({
    driver,
    base: baseOf(driver),
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
  DRIVER_FIELDS,
  active,
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
