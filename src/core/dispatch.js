'use strict';

const db = require('../db');
const geocode = require('./geocode');
const booking = require('./booking');
const { config } = require('../config');

// ---------------------------------------------------------------------------
// Can we take this one?
//
// An order comes in at eleven o'clock. The driver is already out. The only
// question worth answering is whether adding this stop fits into what he is
// already doing, and what it costs to say yes - and the answer has to arrive
// while somebody is still looking at their phone.
//
// TWO RULES, AND THEY ARE THE WHOLE DESIGN.
//
//   1. NEVER RE-SEQUENCE A RUN THAT IS ALREADY PHYSICAL. Once bags are in the
//      van with numbers on them, the van IS the route. Re-solving it would
//      invalidate every tag in the back and send a driver looking for bag 4 in
//      the position bag 9 is actually in. A new stop is SPLICED into the
//      remaining sequence and nothing else moves.
//
//   2. ONLY PICKUPS. A pickup needs nothing but a stop; a delivery needs a bag
//      that is already on the truck, and it is not. Nothing can be delivered
//      until it has been washed and collected back, so "can you bring my
//      laundry this afternoon" is never a question this answers.
//
// Distances are straight-line times the road factor, deliberately. The planner
// page uses a real routing service; this does not, because a driver holding a
// phone waiting on a network call to find out whether to take an order is
// worse than a rough answer given immediately.
// ---------------------------------------------------------------------------

const R = () => config.routing;

// What a mile actually costs: fuel, wear, and the driver's time to drive it.
// At the defaults about $1.17, of which roughly 70% is the wage.
function perMile() {
  const r = R();
  return r.gasPerGallon / r.milesPerGallon + r.wearPerMile + r.wagePerHour / r.milesPerHour;
}

function milesBetween(a, b) {
  return geocode.milesBetween(a, b) * R().roadFactor;
}

function minutesFor(miles) {
  return (miles / R().milesPerHour) * 60;
}

// --- What the driver is doing today ----------------------------------------

const RUN_FIELDS =
  'id, order_number, status, stop_number, loaded_at, pickup_date, weight_lb, ' +
  'customers(id, name, address_line1, address_line2, city, state, postal_code, lat, lng, geocode_failed, estimated_weight_lb)';

// Every stop on today's run, in the order it will be driven.
//
// TWO KINDS, AND UNTIL NOW ONLY ONE OF THEM WAS HERE. The load-out pass builds
// its sequence by scanning bags, and a pickup has no bag to scan yet - so
// today's pickups were getting no stop number and appearing in no run. A run
// made only of deliveries answers "does this fit" against half a day's work.
async function todaysRun() {
  const today = booking.today();

  // Deliveries: bags physically in the van.
  const { data: loaded, error: loadedError } = await db
    .from('orders')
    .select(RUN_FIELDS)
    .not('loaded_at', 'is', null)
    .in('status', ['IN_PROCESS', 'AT_PARTNER', 'READY', 'OUT_FOR_DELIVERY'])
    .order('stop_number', { ascending: true, nullsFirst: false });

  if (loadedError) throw loadedError;

  // Pickups: booked for today and not collected yet.
  const { data: pickups, error: pickupError } = await db
    .from('orders')
    .select(RUN_FIELDS)
    .eq('pickup_date', today)
    .in('status', ['REQUESTED', 'ASSIGNED', 'DEPOSITED']);

  if (pickupError) throw pickupError;

  const stops = [
    ...(loaded || []).map((o) => ({ order: o, kind: 'deliver' })),
    ...(pickups || []).map((o) => ({ order: o, kind: 'collect' })),
  ];

  for (const stop of stops) {
    stop.at = await geocode.locate(stop.order.customers || {});
    stop.lat = stop.at ? stop.at.lat : null;
    stop.lng = stop.at ? stop.at.lng : null;
  }

  return stops;
}

// Put them in driving order and work out what the day costs.
//
// A stop we cannot place goes last rather than being dropped - it still has to
// be driven to, and a total that quietly excludes it is a lie.
function sequence(stops) {
  const placed = stops.filter((s) => s.at);
  const unplaced = stops.filter((s) => !s.at);

  const { ordered } = geocode.sequence(
    placed.map((s) => ({ at: s.at, stop: s })),
    geocode.BASE
  );

  const ordered_ = ordered.map((o) => o.stop).concat(unplaced);

  let miles = 0;
  let from = geocode.BASE;
  ordered_.forEach((s) => {
    if (!s.at) return;
    miles += milesBetween(from, s.at);
    from = s.at;
  });
  if (ordered_.some((s) => s.at)) miles += milesBetween(from, geocode.BASE);

  const r = R();
  const serviceMin = ordered_.reduce(
    (t, s) => t + (s.kind === 'deliver' ? r.minutesPerDelivery : r.minutesPerPickup),
    0
  );

  const driveMin = minutesFor(miles);

  return {
    stops: ordered_,
    miles,
    driveMin,
    serviceMin,
    totalMin: driveMin + serviceMin,
    unplaced: unplaced.length,
  };
}

// --- A whole day, in the order it gets driven -------------------------------
//
// THE DAY HAS THREE LEGS, AND THEY ARE IN THAT ORDER FOR A PHYSICAL REASON.
//
//   1. COLLECT   dirty bags off doorsteps
//   2. PARTNER   drop those at a laundromat, and pick up whatever they have
//                finished since last time
//   3. DELIVER   clean bags back to doorsteps
//
// You cannot deliver laundry you have not collected from the laundromat, and
// you cannot drop bags you have not picked up. Sequencing the whole day as one
// travelling-salesman problem would produce a shorter route that cannot be
// driven, which is worse than a longer one that can. So each leg is sequenced
// geographically on its own and the legs stay in order.
//
// Within a leg the rule from the top of this file still holds: anything with a
// stop number already on it - bags physically in the van - keeps that order,
// because the van IS the route and re-solving it would send the driver looking
// for bag 4 where bag 9 actually is.

const LEGS = Object.freeze({
  collect: { order: 1, label: 'Pick up', blurb: 'Dirty bags off doorsteps' },
  dropoff: { order: 2, label: 'Drop at laundromat', blurb: 'Hand the dirty bags over' },
  pickup_partner: { order: 2, label: 'Collect from laundromat', blurb: 'Take the finished bags' },
  deliver: { order: 3, label: 'Deliver', blurb: 'Clean bags back to the door' },
});

const BOARD_FIELDS =
  'id, order_number, status, stop_number, loaded_at, pickup_date, pickup_window_start, ' +
  'pickup_window_end, pickup_time, bag_count, weight_lb, partner_id, ' +
  // The guided run reads its position from these, so they travel with the board
  // rather than being fetched again per stop.
  // navigating_at rides with arrived_at because they answer two halves of the
  // same question - has he set off, and has he got there. Selecting one and
  // not the other left the arrival button permanently hidden.
  'collected_at, delivered_at, arrived_at, navigating_at, ' +
  // WHAT CAME BACK OFF THE LAUNDROMAT, which is how the collect stop knows
  // whether this order has been weighed back in yet. Without them the run has
  // no way to tell a bag still sitting on a shelf from one already in the van,
  // and the driver is offered "scan them in" for work nobody has checked.
  'return_bag_count, return_weight_lb, ' +
  // Where this order was PLANNED to go, chosen when it was booked. The live
  // choice wins when it has one; this is what stops a stop being drawn as "a
  // laundromat" with no address when it does not.
  'intended_partner_id, ' +
  'customers(id, name, address_line1, address_line2, city, state, postal_code, lat, lng, geocode_failed, estimated_weight_lb)';

// WHAT ONE BAG WEIGHS WHEN NOBODY HAS WEIGHED IT YET.
//
// A pickup has no weight until the driver puts it on the scale, but the
// laundromat has to be chosen before that. The minimum is the honest floor: at
// a $25 minimum and $2 a pound, anything we collect bills as at least 12.5 lb,
// so that is what it is worth assuming it weighs.
//
// Derived from the two numbers rather than written down, so changing either
// moves this with it.
// "14:30" or "14:30:00" -> minutes since midnight.
function toMinutesOfDay(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function assumedPounds(customer) {
  // What they have actually weighed, when we know it.
  const learned = customer && customer.estimated_weight_lb;
  if (learned != null && Number(learned) > 0) return Number(learned);

  // COLD START ONLY. This figure is where a $25 minimum meets $2 a pound - a
  // billing break-even, not a physical floor. Somebody can hand over 7 lb and
  // owe $25, so it over-states a small load and is only defensible until there
  // is a real number for this customer.
  return config.pricing.minimumCents / config.pricing.perPoundCents;
}

// WHICH LAUNDROMAT SHOULD THIS BAG GO TO?
//
// THE CHEAPEST ONE ALL IN, not the nearest. This sorted purely by distance
// until Neil caught it sending bags past a laundromat charging 30c a pound to
// one charging $1.10 - a $10 difference on a 12.5 lb bag that no plausible
// detour makes back, since a mile of van costs about a dollar.
//
// All in means both halves:
//
//   THE WASH        pounds times their wholesale rate
//   THE DRIVING     the detour to get there and back out again, at the real
//                   cost of a mile - fuel at the configured mpg, wear, and the
//                   driver's wage for the time. All of it is in config.routing
//                   and applies system-wide, so one set of numbers moves every
//                   answer the system gives.
//
// A partner with no agreed rate is still usable - we simply cannot price the
// wash, so only the driving counts and the page says the figure is partial. It
// must not be treated as free, which would make an unpriced partner win every
// time.
//
// Then skip anyone shut at the time we would arrive or with no room left, and
// take the next cheapest. A full partner is routed around rather than blocked
// at: a driver holding a bag at a loading dock needs somewhere to put it, not
// an error message.
//
// Capacity that was never entered is UNKNOWN, not zero, and unknown does not
// disqualify anybody - refusing a partner over a blank form field would quietly
// take the only laundromat we have out of service.
//
// Returns the chosen partner plus every one passed over and why, and what each
// would have cost, so the page can show its working rather than a name.
function chooseLaundromat(
  from,
  candidates,
  { weekday, time, poundsToAdd, onward = null, promiseMinutes = null }
) {
  const perMileCost = perMile();
  const nowMinutes = toMinutesOfDay(time);

  const considered = candidates
    .map((p) => {
      // Out to them and back onto the round. Measuring only the trip out would
      // favour a partner in a dead end, because the miles home are real.
      const out = p.at ? milesBetween(from, p.at) : Infinity;
      const back = p.at ? milesBetween(p.at, onward || from) : Infinity;
      const miles = out + back;

      const washCents =
        p.wholesale_per_lb_cents == null
          ? null
          : Math.round(poundsToAdd * p.wholesale_per_lb_cents);

      const drivingCents = Number.isFinite(miles) ? Math.round(miles * perMileCost * 100) : null;

      // Would a bag dropped now still be ready in time to go back tomorrow?
      // Unknown turnaround is treated as a risk rather than as zero: a partner
      // who has never told us how long they take has not told us they are fast.
      const readyBy =
        p.turnaround_minutes == null ? null : nowMinutes + Number(p.turnaround_minutes);
      const tooSlow = readyBy != null && readyBy > promiseMinutes;

      const cutoff = p.dropoff_cutoff ? toMinutesOfDay(p.dropoff_cutoff) : null;
      const pastCutoff = cutoff != null && nowMinutes >= cutoff;

      return {
        partner: p,
        miles,
        washCents,
        drivingCents,
        readyBy,
        tooSlow,
        pastCutoff,
        // Null when we cannot price the wash. Sorted last rather than treated
        // as zero, so a partner with no agreed rate never wins on a blank.
        totalCents: washCents == null || drivingCents == null ? null : washCents + drivingCents,
        open: p.openNow,
        room: p.capacity.remaining == null ? null : p.capacity.remaining - poundsToAdd >= 0,
      };
    })
    .sort((a, b) => {
      if (a.totalCents == null && b.totalCents == null) return a.miles - b.miles;
      if (a.totalCents == null) return 1;
      if (b.totalCents == null) return -1;
      return a.totalCents - b.totalCents;
    });

  for (const c of considered) {
    if (!c.partner.at) {
      c.why = 'no address we could put on the map';
      continue;
    }
    if (!c.open) {
      c.why = `shut at ${time}`;
      continue;
    }
    if (c.room === false) {
      c.why = 'no room left today';
      continue;
    }
    // PAST THE CUTOFF IS TOMORROW'S WASH, whatever their closing time says. A
    // laundromat that stops taking work at 4pm is shut for our purposes at 4pm
    // even with the lights on until 9.
    if (c.pastCutoff) {
      c.why = `past their ${c.partner.dropoff_cutoff.slice(0, 5)} drop-off cutoff`;
      continue;
    }
    // TOO SLOW TO KEEP THE PROMISE. A cheap laundromat that takes 30 hours
    // breaks a next-day promise, and no saving on the wash is worth that -
    // the promise is a hard constraint, not a cost to weigh against others.
    if (c.tooSlow) {
      c.why = `${Math.round(c.partner.turnaround_minutes / 60)}h turnaround - too slow for next day`;
      continue;
    }
    c.chosen = true;

    // Everyone further down the list was never looked at, and saying so is
    // different from saying they were rejected. "Further away" is the honest
    // reason; a bare blank reads as a bug in the working.
    considered
      .filter((other) => !other.chosen && !other.why)
      .forEach((other) => {
        other.why =
          other.totalCents == null
            ? 'no agreed rate, so we cannot price it'
            : `costs more all in`;
      });

    return { chosen: c.partner, considered, weekday };
  }

  return { chosen: null, considered, weekday };
}

// Minutes on the ground at one stop.
function serviceMinutes(kind) {
  const r = R();
  if (kind === 'deliver') return r.minutesPerDelivery;
  if (kind === 'dropoff' || kind === 'pickup_partner') return r.minutesPerPartnerVisit;
  return r.minutesPerPickup;
}

// Walk the sequence adding drive time and time on the ground, so every stop
// carries the clock time the driver should be standing there.
//
// This is the "hour by hour" half of the board. It is an estimate and the page
// says so - the point is not the minute, it is seeing that the run runs out of
// day before it runs out of stops.
function withEtas(stops, startMinutes, base, home = base) {
  let clock = startMinutes;
  let from = base;
  let miles = 0;

  for (const stop of stops) {
    if (stop.at) {
      const legMiles = milesBetween(from, stop.at);
      miles += legMiles;
      clock += minutesFor(legMiles);
      from = stop.at;
    }
    stop.etaMinutes = Math.round(clock);
    stop.eta = `${String(Math.floor(clock / 60) % 24).padStart(2, '0')}:${String(
      Math.round(clock) % 60
    ).padStart(2, '0')}`;
    clock += serviceMinutes(stop.kind);
  }

  const backMiles = from === home ? 0 : milesBetween(from, home);

  return {
    miles: miles + backMiles,
    endMinutes: Math.round(clock + minutesFor(backMiles)),
  };
}

// Sequence one leg, keeping anything already numbered in the van in its
// existing order and solving the rest around it.
function sequenceLeg(stops, base) {
  const numbered = stops
    .filter((s) => s.order && s.order.stop_number != null)
    .sort((a, b) => a.order.stop_number - b.order.stop_number);

  const rest = stops.filter((s) => !(s.order && s.order.stop_number != null));
  const placed = rest.filter((s) => s.at);
  const unplaced = rest.filter((s) => !s.at);

  const { ordered } = geocode.sequence(
    placed.map((s) => ({ at: s.at, stop: s })),
    base
  );

  return [...numbered, ...ordered.map((o) => o.stop), ...unplaced];
}

// The whole board for one day, from one time of day onward.
//
// `driverId` narrows it to one person's work and routes from THEIR home base.
// Without a driver it is everybody's work from the service base, which is what
// the board was before drivers had bases - useful for seeing the whole day at
// once, but it is not a route anybody drives.
// WHERE THE VAN ACTUALLY IS, when the day is already underway.
//
// The route was always solved from the home base, even at three in the
// afternoon with the driver standing in Glen Rock - a plan made at six in the
// morning and redisplayed, rather than one being revised. Everything after the
// first stop was measured from the wrong place.
//
// The last stop he FINISHED is where he is: he is standing at it, or he has
// just pulled away from it. Nothing else in the system knows his position -
// there is no phone tracking and there should not be, because a driver's
// location all day is a thing we would then be holding.
//
// Returns null before he has finished anything, which is the honest answer:
// the day has not started, so the base is still where it starts.
async function currentPosition(driverId, dateIso) {
  const from = `${dateIso}T00:00:00`;

  const { data, error } = await db
    .from('orders')
    .select(
      'id, collected_at, at_partner_at, delivered_at, partner_id, ' +
        'customers(address_line1, address_line2, city, state, postal_code, lat, lng, geocode_failed)'
    )
    .eq('driver_id', driverId)
    .or(`collected_at.gte.${from},at_partner_at.gte.${from},delivered_at.gte.${from}`);

  if (error) throw error;

  // The most recent thing that happened, whatever kind of thing it was.
  let latest = null;
  for (const order of data || []) {
    for (const [at, kind] of [
      [order.collected_at, 'door'],
      [order.at_partner_at, 'partner'],
      [order.delivered_at, 'door'],
    ]) {
      if (at && at >= from && (!latest || at > latest.at)) {
        latest = { at, kind, order };
      }
    }
  }

  if (!latest) return null;

  if (latest.kind === 'partner' && latest.order.partner_id) {
    const { data: partner } = await db
      .from('partners')
      .select('lat, lng')
      .eq('id', latest.order.partner_id)
      .maybeSingle();

    if (partner && partner.lat != null) {
      return { lat: Number(partner.lat), lng: Number(partner.lng), at: latest.at, kind: 'partner' };
    }
    return null;
  }

  const where = await geocode.locate(latest.order.customers || {});
  return where ? { ...where, at: latest.at, kind: 'door' } : null;
}

// ---------------------------------------------------------------------------
// WHERE IS THIS ORDER GOING? Answered when the order is BOOKED, not when a
// board happens to be drawn.
//
// Neil's call. The laundromat used to be worked out live, over and over, and
// only written down once the bags had actually been handed over - so a driver
// looking at tomorrow's round saw a stop called "a laundromat" with no address
// on it, and an "I'm here" button for a place the screen could not name.
//
// IT IS A PLAN, NOT A LOCK. It is chosen against the pickup day and the start
// of the customer's window, which is the best guess available at booking time -
// but a partner can be shut, full, or gone by then, so everything downstream
// re-checks before the bags change hands. orders.partner_id remains the record
// of where it ACTUALLY went, and the two are kept apart deliberately: "we meant
// to go to Fancy K and ended up at Bergen Wash" is worth being able to see.
//
// Never throws. A booking must not fail because a geocoder was slow or nobody
// has added a laundromat yet - an order with no plan is a real state, and the
// screens say so rather than inventing a destination.
// ---------------------------------------------------------------------------

async function planPartnerFor(order, customer) {
  try {
    const partnersCore = require('./partners');

    const where = await geocode.locate(customer || {});
    if (!where) return null;

    const laundromats = (await partnersCore.list({ type: 'LAUNDROMAT' })).filter(
      (p) => p.status === 'ACTIVE'
    );
    if (!laundromats.length) return null;

    const hoursByPartner = await partnersCore.hoursForAll();
    const loadByPartner = await partnersCore.loadByPartner();

    // The weekday of the PICKUP, not of today. Booking on a Tuesday for a
    // Thursday collection has to ask who is open on Thursday.
    const [y, m, d] = String(order.pickup_date).split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    // The start of the window they were promised. A bag collected in the 9-12
    // window reaches a laundromat late morning, so that is the hour to ask
    // about - not midnight, and not whenever this code happens to run.
    const time = order.pickup_window_start || booking.PICKUP_WINDOWS[0].start;

    const rows = laundromats.map((p) => {
      const hours = hoursByPartner.get(p.id) || [];
      return {
        ...p,
        at: p.lat != null && p.lng != null ? { lat: Number(p.lat), lng: Number(p.lng) } : null,
        hours,
        openNow: partnersCore.isOpenAt(hours, weekday, time),
        capacity: partnersCore.capacityOf(p, loadByPartner.get(p.id)),
      };
    });

    const choice = chooseLaundromat(where, rows, {
      weekday,
      time,
      // Nothing has been weighed yet, so the honest floor is what the minimum
      // charge implies - the same estimate the routing board uses.
      poundsToAdd: assumedPounds(customer),
      onward: null,
      promiseMinutes: 24 * 60 + toMinutesOfDay(booking.endOfDeliveryDay()),
    });

    return choice.chosen || null;
  } catch (err) {
    console.error(`Could not plan a laundromat for order ${order.id}: ${err.message}`);
    return null;
  }
}

// Writes the plan onto the order. Separate from choosing it so a caller can
// re-plan without writing, and so a failed write cannot lose a booking.
async function savePlannedPartner(order, customer) {
  const chosen = await planPartnerFor(order, customer);
  if (!chosen) return null;

  const { error } = await db
    .from('orders')
    .update({
      intended_partner_id: chosen.id,
      intended_partner_at: new Date().toISOString(),
    })
    .eq('id', order.id);

  if (error) {
    console.error(`Could not save the planned laundromat: ${error.message}`);
    return null;
  }

  return chosen;
}

async function board(dateIso, fromTime, driverId = null) {
  const date = dateIso || booking.today();
  const now = booking.nowInService();

  // WHEN THE DAY STARTS, IF NOBODY SAID.
  //
  // "Now" is right during working hours and nonsense outside them. Opened at
  // ten past midnight the board defaulted to 00:11, at which point no
  // laundromat on earth is open - so it correctly reported that there was
  // nowhere to put the bags, and correctly looked like it had lost the
  // laundromat. Neil read it as exactly that.
  //
  // So a time outside the day's pickup windows falls forward to the first one.
  // A round is not planned at midnight; the earliest anybody could actually
  // set off is when the first window opens, and that is the honest default.
  const dayStart = booking.PICKUP_WINDOWS[0].start;
  const dayEnd = booking.PICKUP_WINDOWS[booking.PICKUP_WINDOWS.length - 1].end;

  const clockNow = date === now.date ? now.time : dayStart;
  const withinDay = clockNow >= dayStart && clockNow < dayEnd;

  const start = fromTime || (withinDay ? clockNow : dayStart);

  const [hh, mm] = String(start).split(':').map(Number);
  const startMinutes = (Number.isFinite(hh) ? hh : 9) * 60 + (Number.isFinite(mm) ? mm : 0);

  // Which day of the week this is, for the opening-hours check. Built from the
  // ISO date rather than a Date in local time, so a server in another timezone
  // cannot land on the wrong weekday.
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

  // --- whose day is this, and where does it start ---------------------------
  //
  // Required lazily: drivers.js reads roles and geocode, and a top-level
  // require here would close a loop through orders.js.
  const driversCore = require('./drivers');
  const driver = driverId ? await driversCore.find(driverId) : null;
  const home = driver ? driversCore.baseOf(driver) : { ...geocode.BASE, own: false };

  // THE ROUTE IS SOLVED FROM WHERE HE IS, NOT WHERE HE STARTED.
  //
  // Only for today - a future day has not begun, so its route starts at the
  // base like any plan does. The base is still where the day ENDS, which is why
  // both are kept: `base` is the point everything is measured from now, `home`
  // is where he goes back to.
  const position = driverId && date === now.date ? await currentPosition(driverId, date) : null;
  const base = position || home;

  // --- everything in flight -------------------------------------------------

  let pickupQuery = db
    .from('orders')
    .select(BOARD_FIELDS)
    .eq('pickup_date', date)
    .in('status', ['REQUESTED', 'ASSIGNED', 'DEPOSITED']);
  if (driverId) pickupQuery = pickupQuery.eq('driver_id', driverId);

  const { data: pickups, error: pickupError } = await pickupQuery;
  if (pickupError) throw pickupError;

  // Bags we are holding that still need washing, and bags a laundromat has
  // finished. Not filtered by date: a bag collected yesterday and still in the
  // van is today's problem whatever its pickup date says.
  let handQuery = db
    .from('orders')
    .select(BOARD_FIELDS)
    .in('status', ['IN_PROCESS', 'READY', 'OUT_FOR_DELIVERY']);
  if (driverId) handQuery = handQuery.eq('driver_id', driverId);

  const { data: inHand, error: handError } = await handQuery;
  if (handError) throw handError;

  // --- the laundromats ------------------------------------------------------

  const partnersCore = require('./partners');
  const laundromats = (await partnersCore.list({ type: 'LAUNDROMAT' })).filter(
    (p) => p.status === 'ACTIVE'
  );
  const hoursByPartner = await partnersCore.hoursForAll();
  const loadByPartner = await partnersCore.loadByPartner();

  const partnerRows = laundromats.map((p) => {
    const hours = hoursByPartner.get(p.id) || [];
    return {
      ...p,
      at: p.lat != null && p.lng != null ? { lat: Number(p.lat), lng: Number(p.lng) } : null,
      hours,
      hoursText: partnersCore.describeHours(hours),
      turnaround_minutes: p.turnaround_minutes,
      dropoff_cutoff: p.dropoff_cutoff,
      openNow: partnersCore.isOpenAt(hours, weekday, start),
      capacity: partnersCore.capacityOf(p, loadByPartner.get(p.id)),
    };
  });

  // --- leg 1: doorstep pickups ---------------------------------------------
  //
  // A COLLECTED BAG THAT HAS NOT BEEN WEIGHED IS STILL AT THE DOOR.
  //
  // The scale comes after "in the van" and happens at the same stop, so an
  // IN_PROCESS order with no weight on it has not finished its pickup. Leaving
  // it out here made the stop vanish from the guided run the instant the driver
  // tapped Collected, taking the weighing with it - he drove off with a bag
  // nobody had weighed and no screen asking him to.
  //
  // It also cannot go to the laundromat yet: the weight has to be ours, taken
  // before the bag left our hands.
  const unweighed = (inHand || []).filter((o) => o.status === 'IN_PROCESS' && o.weight_lb == null);

  const collectStops = [...(pickups || []), ...unweighed].map((o) => ({ kind: 'collect', order: o }));

  // --- leg 3: doorstep deliveries ------------------------------------------
  //
  // OUT_FOR_DELIVERY is on the van now. READY is at a laundromat and will be on
  // the van once leg 2 has happened, which is exactly why leg 2 comes first.
  const deliverStops = (inHand || [])
    .filter((o) => o.status === 'OUT_FOR_DELIVERY' || o.status === 'READY')
    .map((o) => ({ kind: 'deliver', order: o }));

  for (const stop of [...collectStops, ...deliverStops]) {
    stop.at = await geocode.locate(stop.order.customers || {});
  }

  // --- leg 2: the laundromat --------------------------------------------
  //
  // Two different visits and they are not the same stop even at the same
  // address: dropping dirty bags off and collecting finished ones are separate
  // lines on a run sheet, and merging them hides one of them.

  // Bags to drop: what we are already holding unwashed, plus everything leg 1
  // is about to pick up. Weighed only - an unweighed bag is still standing at
  // the customer's door as far as the run is concerned, and handing it over
  // would leave us billing off the laundromat's scale instead of our own.
  const needsWash = (inHand || []).filter(
    (o) => o.status === 'IN_PROCESS' && o.weight_lb != null
  );
  // WHAT IS GOING TO THE LAUNDROMAT, IN POUNDS.
  //
  // Weighed bags contribute what they weigh. A pickup that has not been
  // weighed yet contributes the minimum-implied weight rather than nothing -
  // counting it as zero made the pounds tiny, which made the wash cost tiny,
  // which made the wholesale rate irrelevant and handed the decision back to
  // distance alone. That is exactly the bug: a 30c partner and a $1.10 partner
  // look identical if you assume there is no laundry.
  const dropWeight =
    needsWash.reduce((t, o) => t + Number(o.weight_lb || 0), 0) +
    (pickups || []).reduce((t, o) => t + assumedPounds(o.customers), 0);

  // Where the van is when it goes to the laundromat: the last pickup, or base
  // if there are none.
  const orderedCollect = sequenceLeg(collectStops, base);
  const lastCollect = [...orderedCollect].reverse().find((s) => s.at);
  const fromPoint = lastCollect ? lastCollect.at : base;

  // Where it goes next, so the miles home from the laundromat are counted too.
  // The first delivery if there is one, otherwise back to base.
  const firstDelivery = deliverStops.find((s) => s.at);
  const onward = firstDelivery ? firstDelivery.at : base;

  // WHEN A BAG DROPPED NOW HAS TO BE BACK ON THE VAN. The promise is the end of
  // tomorrow's last window, so a laundromat has until then to finish - anything
  // slower breaks it. Expressed in minutes from the start of today so it can be
  // compared against a turnaround.
  const promiseMinutes = 24 * 60 + toMinutesOfDay(booking.endOfDeliveryDay());

  const choice = chooseLaundromat(fromPoint, partnerRows, {
    weekday,
    time: start,
    poundsToAdd: dropWeight,
    onward,
    promiseMinutes,
  });

  const partnerStops = [];

  if (needsWash.length || (pickups || []).length) {
    // FALL BACK TO THE PLAN MADE AT BOOKING.
    //
    // The live choice above is the better answer when it has one: it knows
    // what is open right now, what is already on each partner's floor, and
    // where the van actually is. But it can come back empty - nothing open at
    // this hour, nobody within range - and an empty answer used to draw a stop
    // called "a laundromat" with no address and an "I'm here" button for a
    // place the screen could not name.
    //
    // An order booked since 0048 carries the laundromat it was planned for, so
    // there is something to show. It is marked as a plan rather than a live
    // choice, because the driver deserves to know the difference between "this
    // is where you are going" and "this is where we meant to send you, ring
    // ahead".
    const planned =
      !choice.chosen &&
      partnerRows.find((p) =>
        [...needsWash, ...(pickups || [])].some((o) => o.intended_partner_id === p.id)
      );

    partnerStops.push({
      kind: 'dropoff',
      at: choice.chosen ? choice.chosen.at : planned ? planned.at : null,
      partner: choice.chosen || planned || null,
      fromPlan: Boolean(!choice.chosen && planned),
      choice,
      bags: needsWash.length + (pickups || []).length,
      pounds: dropWeight,
      // Everything being handed over: what is already in the van unwashed AND
      // what leg 1 is about to collect. It listed only the former, so a stop
      // dropping three bags picked up this morning showed a bag count and no
      // order numbers at all.
      orders: [...needsWash, ...(pickups || [])],
    });
  }

  // Collecting finished bags happens at whichever laundromat actually has them,
  // which is recorded on the order and is not a choice to make.
  const readyByPartner = new Map();
  for (const o of (inHand || []).filter((x) => x.status === 'READY' && x.partner_id)) {
    if (!readyByPartner.has(o.partner_id)) readyByPartner.set(o.partner_id, []);
    readyByPartner.get(o.partner_id).push(o);
  }

  for (const [partnerId, list] of readyByPartner) {
    const partner = partnerRows.find((p) => p.id === partnerId);
    partnerStops.push({
      kind: 'pickup_partner',
      at: partner ? partner.at : null,
      partner,
      orders: list,
      bags: list.length,
      pounds: list.reduce((t, o) => t + Number(o.weight_lb || 0), 0),
      orders: list,
    });
  }

  // --- put the day together -------------------------------------------------

  const stops = [...orderedCollect, ...partnerStops, ...sequenceLeg(deliverStops, base)];

  stops.forEach((s, i) => {
    s.position = i + 1;
    s.leg = LEGS[s.kind];
  });

  // WHAT THE VAN CAN ACTUALLY CARRY.
  //
  // A hard constraint, not a cost: a plan that puts 500 lb in a 400 lb van is
  // not expensive, it is impossible. Nothing checked it before because the van
  // did not exist as far as the system was concerned.
  //
  // Falls back to the configured defaults when nobody has entered a van, so an
  // unconfigured system plans exactly as it did rather than refusing to plan.
  let vehicle = null;
  if (driverId) {
    const { data } = await db
      .from('vehicles')
      .select('*')
      .eq('driver_id', driverId)
      .eq('status', 'ACTIVE')
      .maybeSingle();
    vehicle = data || null;
  }

  const capacity = {
    maxWeightLb: vehicle ? Number(vehicle.max_weight_lb) : null,
    maxBags: vehicle ? Number(vehicle.max_bags) : null,
    name: vehicle ? vehicle.name : null,
  };

  // The heaviest the van gets: everything collected before the laundromat, plus
  // whatever clean load is already aboard. Measured at the worst moment rather
  // than averaged, because that is the moment it either fits or does not.
  const carryingLb =
    dropWeight + (inHand || []).filter((o) => o.status === 'READY').reduce((t, o) => t + Number(o.weight_lb || 0), 0);

  const carryingBags =
    (pickups || []).reduce((t, o) => t + Number(o.bag_count || 1), 0) +
    (inHand || []).reduce((t, o) => t + Number(o.bag_count || 1), 0);

  const overWeight = capacity.maxWeightLb != null && carryingLb > capacity.maxWeightLb;
  const overBags = capacity.maxBags != null && carryingBags > capacity.maxBags;

  const walk = withEtas(stops, startMinutes, base, home);
  const r = R();
  const serviceMin = stops.reduce((t, s) => t + serviceMinutes(s.kind), 0);
  const driveMin = minutesFor(walk.miles);

  // WHAT THE DAY IS ACTUALLY WORTH.
  //
  // This was a gross figure dressed up as a margin, and it was wrong in two
  // directions at once.
  //
  //   LABOUR was only counted while the van was MOVING. The wage is inside
  //   perMile(), so time on the ground - four minutes a door, ten at a
  //   laundromat - was free. On a nine-stop afternoon that is 42 paid minutes
  //   and $14 of a $22 "margin".
  //
  //   REVENUE counted only bags already on a scale, while the driving cost
  //   covered the whole route including every pickup still to be made. A day of
  //   mostly-collections looked like all cost and no income.
  //
  // So: every paid minute counts, and a pickup contributes what it is expected
  // to bill using the same weight estimate the router already uses for
  // capacity. Card fees are in too - 2.9% and 30c is real money on a $50 order.
  //
  // IT IS STILL A CONTRIBUTION MARGIN, NOT PROFIT. Insurance, the phone, the
  // software, and Neil's own time are not in it, and the page says so.
  const r2 = R();

  // Bags with a real weight bill their real weight; a pickup not yet collected
  // bills what this customer's laundry usually weighs.
  const weighed = (inHand || []).filter((o) => o.weight_lb != null);
  const expected = (pickups || []).map((o) => assumedPounds(o.customers));

  const revenueCents =
    weighed.reduce((t, o) => t + estimatedBill(o.weight_lb), 0) +
    expected.reduce((t, lb) => t + estimatedBill(lb), 0);

  const poundsWashed =
    weighed.reduce((t, o) => t + Number(o.weight_lb), 0) +
    expected.reduce((t, lb) => t + lb, 0);

  const wholesaleCents =
    choice.chosen && choice.chosen.wholesale_per_lb_cents != null
      ? Math.round(poundsWashed * choice.chosen.wholesale_per_lb_cents)
      : null;

  // Fuel and wear only - the wage comes out separately below, so that a minute
  // parked at a door costs the same as a minute driving, which it does.
  const perMileVehicle = r2.gasPerGallon / r2.milesPerGallon + r2.wearPerMile;
  const vehicleCents = Math.round(walk.miles * perMileVehicle * 100);

  // EVERY paid minute, not just the moving ones, at THIS driver's rate.
  //
  // Two drivers are rarely paid the same, and a margin is only worth reading if
  // it uses what that particular round actually costs. Falls back to the
  // configured rate when nobody has set one, which is what a business with a
  // single pay rate wants.
  const wagePerHour = driver && driver.wage_cents_hour ? driver.wage_cents_hour / 100 : r2.wagePerHour;
  const labourCents = Math.round(((driveMin + serviceMin) / 60) * wagePerHour * 100);

  // One charge per order that will actually be billed.
  // WHAT WE ACTUALLY GROSSED, and what is still owed to us by the work.
  //
  // Two different questions and they must not be added together:
  //
  //   GROSSED   delivered. The card is charged at the door, so a delivered
  //             order is money that has moved. Anything delivered and unpaid is
  //             a decline, counted separately rather than quietly included -
  //             it is not cash until it is cash.
  //
  //   EXPECTED  weighed but not yet back at a door. A real number, because the
  //             scale has already decided what it bills. This is the money
  //             sitting in a laundromat and in the back of the van.
  //
  // Unweighed pickups are in NEITHER. Their weight is a guess, and a guess does
  // not belong in a figure called cash.
  let deliveredQuery = db
    .from('orders')
    .select('price_cents, paid_at, payment_status')
    .eq('status', 'DELIVERED')
    .gte('delivered_at', `${date}T00:00:00`)
    .lte('delivered_at', `${date}T23:59:59`);
  if (driverId) deliveredQuery = deliveredQuery.eq('driver_id', driverId);

  const { data: deliveredToday } = await deliveredQuery;

  const grossedCents = (deliveredToday || [])
    .filter((o) => o.paid_at)
    .reduce((t, o) => t + (o.price_cents || 0), 0);

  const unpaidCents = (deliveredToday || [])
    .filter((o) => !o.paid_at)
    .reduce((t, o) => t + (o.price_cents || 0), 0);

  // Already on a scale, not yet through a door - wherever it is.
  const expectedCents = (inHand || [])
    .filter((o) => o.weight_lb != null)
    .reduce((t, o) => t + estimatedBill(o.weight_lb), 0);

  const charges = weighed.length + expected.length;
  const cardFeeCents = Math.round(
    (revenueCents * r2.cardFeePercent) / 100 + charges * r2.cardFeeFixedCents
  );

  return {
    date,
    start,
    weekday,
    driver,
    base,
    home,
    vehicle,
    load: {
      ...capacity,
      pounds: carryingLb,
      bags: carryingBags,
      overWeight,
      overBags,
      // A day that cannot be driven as planned. It is shown rather than
      // silently trimmed - the driver decides what comes off the van, not us.
      overloaded: overWeight || overBags,
    },
    // Null when the day has not started. The page says which of the two the
    // route was solved from, because "9.4 miles" means different things
    // measured from a depot and from wherever the van is parked.
    position,
    stops,
    partners: partnerRows,
    choice,
    miles: walk.miles,
    driveMin,
    serviceMin,
    totalMin: driveMin + serviceMin,
    endMinutes: walk.endMinutes,
    overDay: driveMin + serviceMin > r.workingDayMinutes,
    unplaced: stops.filter((s) => !s.at).length,
    money: {
      // Cash that has moved today, and cash the scale has already decided on
      // but which is still out there.
      grossedCents,
      unpaidCents,
      expectedCents,
      wagePerHour,
      revenueCents,
      wholesaleCents,
      vehicleCents,
      labourCents,
      cardFeeCents,
      poundsWashed,
      // Everything except the wash, which we cannot price without an agreed
      // rate. Kept separate so the page can show a partial figure honestly
      // rather than a whole one that is wrong.
      knownCostCents: vehicleCents + labourCents + cardFeeCents,
      // Null rather than a number when the wash cannot be priced.
      marginCents:
        wholesaleCents == null
          ? null
          : revenueCents - wholesaleCents - vehicleCents - labourCents - cardFeeCents,
    },
  };
}

// --- The question -----------------------------------------------------------

// Where does this new stop go, and what does it cost?
//
// Cheapest insertion: try it between every pair of consecutive stops that has
// not been driven yet and take the cheapest detour. `doneCount` is how much of
// the run is already behind the driver - those legs are history and a stop
// cannot be put back into them.
function quoteAgainst(run, newStop, doneCount = 0) {
  const remaining = run.stops.slice(doneCount).filter((s) => s.at);
  const startFrom =
    doneCount > 0 && run.stops[doneCount - 1] && run.stops[doneCount - 1].at
      ? run.stops[doneCount - 1].at
      : geocode.BASE;

  // The chain the new stop could be spliced into: where the driver is now,
  // every stop still to come, and the trip home.
  const chain = [startFrom, ...remaining.map((s) => s.at), geocode.BASE];

  let bestDetour = Infinity;
  let at = 0;

  for (let i = 0; i < chain.length - 1; i += 1) {
    const detour =
      milesBetween(chain[i], newStop) +
      milesBetween(newStop, chain[i + 1]) -
      milesBetween(chain[i], chain[i + 1]);

    if (detour < bestDetour) {
      bestDetour = detour;
      at = i;
    }
  }

  const r = R();
  const addMin = minutesFor(bestDetour) + r.minutesPerPickup;
  const addCost = bestDetour * perMile() + (r.minutesPerPickup / 60) * r.wagePerHour;

  const runAfter = run.totalMin + addMin;
  const fits = runAfter <= r.workingDayMinutes;

  return {
    // 1-based, and counted from the start of the whole run so it lines up with
    // the stop numbers written on the tags.
    position: doneCount + at + 1,
    addMiles: bestDetour,
    addMin,
    addCost,
    runBefore: run.totalMin,
    runAfter,
    dayMinutes: r.workingDayMinutes,
    fits,

    // Under the threshold AND it fits. Both, always: a two-minute detour on a
    // day that is already full is still an overrun.
    auto: fits && addMin < r.autoAcceptUnderMinutes,
    threshold: r.autoAcceptUnderMinutes,
  };
}

// The whole question, from an address.
//
// Returns { ok: false, reason } rather than throwing, because every caller is
// answering somebody who is waiting.
async function quote({ address, estimateLb = null, doneCount = 0 }) {
  const at = await geocode.lookupOnce(address);

  if (!at) {
    return { ok: false, reason: 'no_location', detail: 'That address could not be found on the map.' };
  }

  const run = sequence(await todaysRun());

  if (!run.stops.length) {
    // Nothing booked. The honest answer is not "it fits" - it is that there is
    // no run to fit into, and one stop on its own is a trip out for one order.
    return {
      ok: true,
      empty: true,
      at,
      detail: 'Nothing else is on today, so this would be a trip out on its own.',
    };
  }

  const answer = quoteAgainst(run, at, doneCount);
  const revenue = estimateLb == null ? null : estimatedBill(estimateLb);

  // A detour can fit the day and still not be worth driving. Ninety minutes
  // out of the way for a $50 bag fits an eight hour shift and loses money, and
  // "it fits" would be a true answer to the wrong question.
  //
  // Only when a weight was given - without one there is no bill to compare
  // against and a guess would be worse than silence.
  const losesMoney = revenue != null && answer.addCost * 100 > revenue;

  return {
    ok: true,
    at,
    run,
    ...answer,
    estimateLb,
    revenue,
    losesMoney,
    // AUTO-ACCEPT NEVER FIRES ON A STOP THAT LOSES MONEY, however short the
    // detour. quoteAgainst works this out before there is a bill to compare
    // against, so it has to be corrected here rather than there - and a
    // threshold that waves through a loss is worse than no threshold.
    auto: answer.auto && !losesMoney,
  };
}

// What a bag that size would bill, at today's rate and minimum. An estimate,
// and named like one - nothing is charged until it is on a scale.
function estimatedBill(lb) {
  const byWeight = Math.round(Number(lb) * config.pricing.perPoundCents);
  return Math.max(byWeight, config.pricing.minimumCents);
}

module.exports = {
  LEGS,
  board,
  chooseLaundromat,
  planPartnerFor,
  savePlannedPartner,
  perMile,
  milesBetween,
  minutesFor,
  todaysRun,
  sequence,
  quoteAgainst,
  quote,
  estimatedBill,
};
