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
  perMile,
  milesBetween,
  minutesFor,
  todaysRun,
  sequence,
  quoteAgainst,
  quote,
  estimatedBill,
};
