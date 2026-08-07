'use strict';

const db = require('../db');
const { config } = require('../config');

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
  IN_PROCESS: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELED: [],
});

// Statuses where the laundry is not yet in our hands. These are the only ones
// a customer can cancel from, and the only ones that count as "your open
// order" when working out which locker belongs to whom.
const AWAITING_COLLECTION = Object.freeze(['REQUESTED', 'ASSIGNED', 'DEPOSITED']);

// Everything that isn't finished or cancelled.
const IN_FLIGHT = Object.freeze([...AWAITING_COLLECTION, 'IN_PROCESS', 'OUT_FOR_DELIVERY']);

// When a status is reached, which timestamp column records it.
const TIMESTAMP_FOR = Object.freeze({
  DEPOSITED: 'deposited_at',
  IN_PROCESS: 'collected_at',
  DELIVERED: 'delivered_at',
});

function canTransition(from, to) {
  return (ALLOWED_NEXT[from] || []).includes(to);
}

function isCancellable(status) {
  return AWAITING_COLLECTION.includes(status);
}

// ---------------------------------------------------------------------------
// Reading orders
// ---------------------------------------------------------------------------

// The one order a customer is waiting to have collected, or null.
//
// The database guarantees there is at most one of these per customer, so this
// can never be ambiguous — which is what open_locker() relies on.
async function findAwaitingCollection(customerId) {
  const { data, error } = await db
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
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

async function create({ customerId, pickupDate, pickupMethod, bagCount, notes }) {
  const { data, error } = await db
    .from('orders')
    .insert({
      customer_id: customerId,
      status: 'REQUESTED',
      service: 'WASH_DRY_FOLD',
      pickup_date: pickupDate,
      pickup_method: pickupMethod || null,
      bag_count: bagCount || null,
      notes: notes || null,

      // The rate is recorded on the order itself so that changing the price
      // later never silently re-prices work already done.
      price_per_lb_cents: config.pricing.perPoundCents,
    })
    .select('*')
    .single();

  if (error) throw error;
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

async function reschedule(order, newDate) {
  if (!isCancellable(order.status)) {
    throw new Error('That order has already been collected, so it cannot be rescheduled.');
  }

  const { data, error } = await db
    .from('orders')
    .update({ pickup_date: newDate })
    .eq('id', order.id)
    .in('status', AWAITING_COLLECTION)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('That order changed while we were updating it. Try again.');

  return data;
}

module.exports = {
  ALLOWED_NEXT,
  AWAITING_COLLECTION,
  IN_FLIGHT,
  canTransition,
  isCancellable,
  findAwaitingCollection,
  findLatestInFlight,
  findMostRecent,
  create,
  transition,
  reschedule,
};
