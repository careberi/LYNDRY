'use strict';

const db = require('../db');
const { config } = require('../config');
// Required lazily inside the function that uses it: order-events reads db
// only, but orders is required by half of core/ and a top-level require
// here is one more edge in that graph for one call site.


// ---------------------------------------------------------------------------
// The order state machine.
//
// An order moves through fixed steps and MUST NOT skip any of them. This file
// is the only place allowed to change an order's status — everything else asks
// it to, and it refuses anything that isn't a legal move.
//
// Why enforce it here rather than trusting the caller: a driver tapping the
// wrong button, a duplicate webhook, or a confused AI could otherwise mark
// laundry delivered that nobody has collected yet.
//
//   REQUESTED -> ASSIGNED -> DEPOSITED -> IN_PROCESS -> OUT_FOR_DELIVERY -> DELIVERED
//
// ASSIGNED and DEPOSITED are the locker path and unused at launch. Residential
// orders go REQUESTED -> IN_PROCESS when the driver collects the bag.
// ---------------------------------------------------------------------------

const ALLOWED_NEXT = Object.freeze({
  REQUESTED: ['ASSIGNED', 'IN_PROCESS', 'CANCELED'],
  ASSIGNED: ['DEPOSITED', 'CANCELED'],
  DEPOSITED: ['IN_PROCESS', 'CANCELED'],

  // The partner leg is optional. A bag we wash ourselves goes straight from
  // the van to the round; a bag a laundromat washes stops at AT_PARTNER and
  // READY on the way. Both are legal, so the machine does not force us to
  // invent a partner visit that never happened.
  IN_PROCESS: ['AT_PARTNER', 'OUT_FOR_DELIVERY'],
  AT_PARTNER: ['READY'],
  READY: ['OUT_FOR_DELIVERY'],

  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELED: [],
});

// Statuses where the laundry is not yet in our hands. These are the only ones
// a customer can cancel from, and the only ones that count as "your open
// order" when working out which locker belongs to whom.
const AWAITING_COLLECTION = Object.freeze(['REQUESTED', 'ASSIGNED', 'DEPOSITED']);

// Everything that isn't finished or cancelled.
const IN_FLIGHT = Object.freeze([
  ...AWAITING_COLLECTION,
  'IN_PROCESS',
  'AT_PARTNER',
  'READY',
  'OUT_FOR_DELIVERY',
]);

// Statuses where we are holding the customer's laundry. Used to answer "can
// this still be cancelled" and "is this our problem right now".
const IN_OUR_HANDS = Object.freeze(['IN_PROCESS', 'AT_PARTNER', 'READY', 'OUT_FOR_DELIVERY']);

// When a status is reached, which timestamp column records it.
const TIMESTAMP_FOR = Object.freeze({
  DEPOSITED: 'deposited_at',
  IN_PROCESS: 'collected_at',
  AT_PARTNER: 'at_partner_at',
  READY: 'ready_at',
  DELIVERED: 'delivered_at',
});

// Reaching one of these means the driver has DRIVEN AWAY from the stop, so the
// guided run's "I'm here" flag is cleared with the move.
//
// IN_PROCESS is deliberately not in the list. Collecting the bags is not the
// end of that stop - the scale comes after it, at the same door - and clearing
// arrival there would bounce the driver back to "go to this location" while he
// is standing in the hall holding the bag he just picked up.
const LEAVES_THE_STOP = Object.freeze(['AT_PARTNER', 'DELIVERED', 'CANCELED']);

function canTransition(from, to) {
  return (ALLOWED_NEXT[from] || []).includes(to);
}

function isCancellable(status) {
  return AWAITING_COLLECTION.includes(status);
}

// ---------------------------------------------------------------------------
// Reading orders
// ---------------------------------------------------------------------------

// EVERY pickup a customer is waiting to have collected, soonest first.
//
// There can be more than one now. The database allows one per DAY rather than
// one in total, because a van makes a single visit to a door on a given day but
// there is no reason somebody cannot book Thursday and Friday - which a real
// customer tried to do and was refused.
async function findAllAwaitingCollection(customerId) {
  const { data, error } = await db
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
    .in('status', AWAITING_COLLECTION)
    .order('pickup_date', { ascending: true })
    .order('pickup_window_start', { ascending: true, nullsFirst: true });

  if (error) throw error;
  return data || [];
}

// The NEXT pickup a customer is waiting to have collected, or null.
//
// The soonest one, which is what somebody means by "my pickup" nine times in
// ten. It used to be `.maybeSingle()` on the assumption that there could only
// ever be one; that assumption is gone, and maybeSingle would now THROW rather
// than choose - so this orders and takes the first instead.
//
// Anything that must not guess between two - rescheduling, cancelling - should
// call findAllAwaitingCollection and ask which, rather than quietly acting on
// whichever comes first.
async function findAwaitingCollection(customerId) {
  const all = await findAllAwaitingCollection(customerId);
  return all[0] || null;
}

// The pickup on one particular day, or null. What "have they already got
// something booked for Thursday" asks.
async function findAwaitingOn(customerId, pickupDate) {
  const { data, error } = await db
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
    .eq('pickup_date', pickupDate)
    .in('status', AWAITING_COLLECTION)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// The order a customer would mean if they said "my laundry" — anything not
// yet finished, most recent first.
async function findLatestInFlight(customerId) {
  const { data, error } = await db
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
    .in('status', IN_FLIGHT)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// The order whose laundry we are physically holding right now, or null.
//
// Different from findLatestInFlight, which also counts a booking nobody has
// collected yet. This is the one that decides what a customer may still
// change: once we have the bag, the address it goes back to and the way it
// gets washed are settled.
async function findInOurHands(customerId) {
  const { data, error } = await db
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
    .in('status', IN_OUR_HANDS)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function findMostRecent(customerId) {
  const { data, error } = await db
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Changing orders
// ---------------------------------------------------------------------------

async function create({
  customerId,
  pickupDate,
  pickupTime,
  pickupWindowStart,
  pickupWindowEnd,
  pickupMethod,
  bagCount,
  notes,
  fromSchedule,
  preferences,
  surchargeCents,
}) {
  const { data, error } = await db
    .from('orders')
    .insert({
      customer_id: customerId,
      status: 'REQUESTED',
      service: 'WASH_DRY_FOLD',
      pickup_date: pickupDate,

      // Null is a real answer here — plenty of people just say "tomorrow" and
      // don't care what time. Only set when they actually named one.
      pickup_time: pickupTime || null,

      // The window we promised. Stored rather than derived, so changing the
      // configured windows later cannot rewrite what a booked customer was
      // already told in a text message sitting on their phone.
      pickup_window_start: pickupWindowStart || null,
      pickup_window_end: pickupWindowEnd || null,

      // True when a standing order created this rather than the customer
      // asking for it in the moment.
      from_schedule: Boolean(fromSchedule),

      pickup_method: pickupMethod || null,
      bag_count: bagCount || null,
      notes: notes || null,

      // THE WASH DETAILS THIS ORDER WAS BOOKED WITH, snapshotted here for the
      // same reason the price is: so that changing them later cannot rewrite
      // work already handed over. A customer with a 2pm load at the laundromat
      // and a 5pm load being booked with different details must not have the
      // first one's instructions change on the shelf.
      preferences: preferences || null,

      // The paid wash options, in cents, as they stood when this order was
      // taken. Stored beside the rate so changing what an option costs cannot
      // re-price work already quoted.
      surcharge_cents: Math.max(0, Number(surchargeCents) || 0),

      // Both halves of the price are recorded on the order itself, so that
      // changing either later never silently re-prices work already done.
      price_per_lb_cents: config.pricing.perPoundCents,
      minimum_cents: config.pricing.minimumCents,
    })
    .select('*, customers(*)')
    .single();

  if (error) throw error;

  // WHOSE ORDER IS IT. Assigned to whichever active driver's home base is
  // nearest, and reassignable afterwards - the automatic answer knows about
  // distance and nothing about who is off sick.
  //
  // Required lazily to keep the require graph acyclic: drivers.js reaches
  // geocode and roles, and a top-level require here would close a loop through
  // whatever else pulls orders in.
  //
  // Best effort, and after the insert. A geocoder having a slow minute must
  // never fail a booking somebody is waiting on - the order exists either way
  // and an unassigned one is a real state that the boards show as its own row.
  try {
    const drivers = require('./drivers');
    const driverId = await drivers.assign(data);
    if (driverId) data.driver_id = driverId;
  } catch (err) {
    console.warn(`could not assign order ${data.order_number} to a driver:`, err.message);
  }

  return data;
}

// Moves an order to a new status, refusing anything the state machine doesn't
// allow. Returns the updated order.
async function transition(order, to) {
  if (!canTransition(order.status, to)) {
    throw new Error(
      `An order cannot go from ${order.status} to ${to}. ` +
        `From ${order.status} the only options are: ${(ALLOWED_NEXT[order.status] || []).join(', ') || 'none'}.`
    );
  }

  const changes = { status: to };
  const stamp = TIMESTAMP_FOR[to];
  if (stamp) changes[stamp] = new Date().toISOString();

  // navigating_at goes with it. Both describe "the driver is at this order's
  // next stop right now", and leaving one behind would let the arrival button
  // appear on the NEXT stop before he had set off for it.
  if (LEAVES_THE_STOP.includes(to)) {
    changes.arrived_at = null;
    changes.navigating_at = null;
  }

  const { data, error } = await db
    .from('orders')
    .update(changes)
    // Only move it if it is still in the status we checked. Two things
    // happening at once cannot both succeed.
    .eq('id', order.id)
    .eq('status', order.status)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('That order changed while we were updating it. Try again.');

  return data;
}

async function reschedule(order, newDate, newTime, window, by = null) {
  if (!isCancellable(order.status)) {
    throw new Error('That order has already been collected, so it cannot be rescheduled.');
  }

  const changes = { pickup_date: newDate };

  // Three different things, and they must not be confused:
  //   undefined -> the time was not mentioned. Leave it alone. "Move it to
  //                Friday" means the same time on a different day.
  //   null      -> they cleared it. Any time now works.
  //   'HH:MM'   -> a new time.
  if (newTime !== undefined) changes.pickup_time = newTime;

  // A move always gets a freshly chosen window, because the day changed and
  // today's remaining windows are not tomorrow's.
  if (window) {
    changes.pickup_date = window.date;
    changes.pickup_window_start = window.start;
    changes.pickup_window_end = window.end;
  }

  const { data, error } = await db
    .from('orders')
    .update(changes)
    .eq('id', order.id)
    .in('status', AWAITING_COLLECTION)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('That order changed while we were updating it. Try again.');

  // A MOVE IS A CHANGE TO AN ORDER, AND EVERY CHANGE IS ON THE RECORD.
  //
  // This one was not. A customer could move their own pickup by text, or from
  // /account, and leave no trace of who changed it or when - so "why is this
  // Friday when I booked Thursday" had no answer. CLAUDE.md says every change
  // to an order is written to order_events; this was the exception nobody had
  // noticed.
  //
  // Recorded AFTER the write, so a refused move logs nothing. Best effort like
  // every other entry: the audit trail must never be the thing that stops a
  // customer rescheduling.
  //
  // `by` is passed by the caller, because the two doors are different people -
  // the AI acting for the customer, and staff acting on the board - and "who
  // moved this" is the whole question.
  const wasWhen = [order.pickup_date, order.pickup_window_start]
    .filter(Boolean)
    .join(' ');
  const nowWhen = [data.pickup_date, data.pickup_window_start].filter(Boolean).join(' ');

  if (wasWhen !== nowWhen) {
    await require('./order-events').record(order.id, {
      kind: 'SCHEDULE',
      summary: 'Pickup moved',
      was: wasWhen || 'not set',
      became: nowWhen || 'not set',
      by: by || { actor: 'customer' },
    });
  }

  return data;
}

// Has this business ever actually delivered an order?
//
// Which decides whether being shut is "we have not opened yet" or "we have
// stopped for a bit", and those are two different sentences to a customer.
// Saying we will let them know when we are taking pickups AGAIN, to somebody
// who found us the week before we launched, is a plain untruth - Neil caught
// exactly that going to a real number.
//
// DERIVED, NEVER STORED. A "have we launched" flag would be a second copy of
// something the orders table already knows, and it would be wrong the first
// time somebody forgot to set it. This answers itself and flips on its own the
// day the first order lands.
async function hasEverDelivered() {
  const { count, error } = await db
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .not('delivered_at', 'is', null);

  if (error) {
    // Cannot tell? Assume we HAVE launched, which is the conservative side:
    // "we will let you know when we are taking pickups" is true either way,
    // whereas claiming to be brand new to a long-standing customer is not.
    console.error('Could not tell whether we have ever delivered:', error.message);
    return true;
  }

  return (count || 0) > 0;
}

module.exports = {
  hasEverDelivered,
  LEAVES_THE_STOP,
  ALLOWED_NEXT,
  AWAITING_COLLECTION,
  IN_FLIGHT,
  IN_OUR_HANDS,
  canTransition,
  isCancellable,
  findAwaitingCollection,
  findAllAwaitingCollection,
  findAwaitingOn,
  findLatestInFlight,
  findInOurHands,
  findMostRecent,
  create,
  transition,
  reschedule,
};
