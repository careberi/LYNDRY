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
  'customers(id, name, address_line1, address_line2, city, state, postal_code, lat, lng, geocode_failed)';

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
  'collected_at, delivered_at, arrived_at, ' +
  'customers(id, name, address_line1, address_line2, city, state, postal_code, lat, lng, geocode_failed)';

// WHAT ONE BAG WEIGHS WHEN NOBODY HAS WEIGHED IT YET.
//
// A pickup has no weight until the driver puts it on the scale, but the
// laundromat has to be chosen before that. The minimum is the honest floor: at
// a $25 minimum and $2 a pound, anything we collect bills as at least 12.5 lb,
// so that is what it is worth assuming it weighs.
//
// Derived from the two numbers rather than written down, so changing either
// moves this with it.
function assumedPounds() {
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
function chooseLaundromat(from, candidates, { weekday, time, poundsToAdd, onward = null }) {
  const perMileCost = perMile();

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

      return {
        partner: p,
        miles,
        washCents,
        drivingCents,
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
function withEtas(stops, startMinutes, base) {
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

  const backMiles = from === base ? 0 : milesBetween(from, base);

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
async function board(dateIso, fromTime, driverId = null) {
  const date = dateIso || booking.today();
  const now = booking.nowInService();
  const start = fromTime || (date === now.date ? now.time : '09:00');

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
  const base = driver ? driversCore.baseOf(driver) : { ...geocode.BASE, own: false };

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
    (pickups || []).length * assumedPounds();

  // Where the van is when it goes to the laundromat: the last pickup, or base
  // if there are none.
  const orderedCollect = sequenceLeg(collectStops, base);
  const lastCollect = [...orderedCollect].reverse().find((s) => s.at);
  const fromPoint = lastCollect ? lastCollect.at : base;

  // Where it goes next, so the miles home from the laundromat are counted too.
  // The first delivery if there is one, otherwise back to base.
  const firstDelivery = deliverStops.find((s) => s.at);
  const onward = firstDelivery ? firstDelivery.at : base;

  const choice = chooseLaundromat(fromPoint, partnerRows, {
    weekday,
    time: start,
    poundsToAdd: dropWeight,
    onward,
  });

  const partnerStops = [];

  if (needsWash.length || (pickups || []).length) {
    partnerStops.push({
      kind: 'dropoff',
      at: choice.chosen ? choice.chosen.at : null,
      partner: choice.chosen,
      choice,
      bags: needsWash.length + (pickups || []).length,
      pounds: dropWeight,
      orders: needsWash,
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

  const walk = withEtas(stops, startMinutes, base);
  const r = R();
  const serviceMin = stops.reduce((t, s) => t + serviceMinutes(s.kind), 0);
  const driveMin = minutesFor(walk.miles);

  // What the day is worth, against what it costs to drive. Only bags with a
  // real weight count - an unweighed pickup has no price yet and guessing one
  // would put an invented number next to real ones.
  const billable = [...(inHand || [])].filter((o) => o.weight_lb != null);
  const revenueCents = billable.reduce((t, o) => t + estimatedBill(o.weight_lb), 0);
  const wholesaleCents =
    choice.chosen && choice.chosen.wholesale_per_lb_cents != null
      ? Math.round(
          billable.reduce((t, o) => t + Number(o.weight_lb), 0) *
            choice.chosen.wholesale_per_lb_cents
        )
      : null;
  const drivingCents = Math.round(walk.miles * perMile() * 100);

  return {
    date,
    start,
    weekday,
    driver,
    base,
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
      revenueCents,
      wholesaleCents,
      drivingCents,
      // Null rather than a number when we do not know what the wash costs.
      marginCents: wholesaleCents == null ? null : revenueCents - wholesaleCents - drivingCents,
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
  perMile,
  milesBetween,
  minutesFor,
  todaysRun,
  sequence,
  quoteAgainst,
  quote,
  estimatedBill,
};
