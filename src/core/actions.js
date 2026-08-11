'use strict';

const db = require('../db');
const orders = require('./orders');
const billing = require('./billing');
const booking = require('./booking');
const payments = require('../providers/payments');
const { config } = require('../config');
const { site } = require('../web/site');

// ---------------------------------------------------------------------------
// The seven actions.
//
// Claude decides WHICH of these to run. This file decides what actually
// happens. Every check that matters lives here, not in the prompt:
//
//   - a customer can only cancel their own order, and only before collection
//   - a locker is resolved from the caller's own order, never from what they typed
//   - dates are validated against today, not trusted
//
// Each function returns the text to send back. Writing the reply here rather
// than letting Claude write it means a price or a date in a confirmation is
// always a real value read from the database.
// ---------------------------------------------------------------------------

// --- Small helpers ----------------------------------------------------------

// readableDate, dateProblem and hasAddress live in src/core/booking.js now,
// so the AI and the website apply identical rules.
const { readableDate, dateProblem, timeProblem, normaliseTime, hasAddress } = booking;

// --- create_order -----------------------------------------------------------

async function createOrder(customer, input) {
  // The rules live in src/core/booking.js so the website and this agree. All
  // that happens here is turning the result into a sentence.
  const result = await booking.bookPickup(customer, {
    pickupDate: input.pickup_date,
    pickupTime: input.pickup_time,
    pickupMethod: input.pickup_method,
    bagCount: input.bag_count,
    notes: input.notes,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'no_address':
        return `I don't have an address on file for you. Send your street address and I'll get it saved.`;
      case 'bad_date':
      case 'bad_time':
        return result.detail;
      case 'already_booked':
        return (
          `You've already got a pickup booked for ${booking.whenLine(result.order)}. ` +
          `Want me to move it, or add a second one after that?`
        );
      case 'needs_card':
        return billing.setupLinkMessage(customer);
      default:
        return `Let me get a person on this. Someone will come back to you shortly.`;
    }
  }

  // The wording lives in src/core/booking.js so that booking by text and
  // booking on the website produce the identical confirmation.
  return booking.confirmationMessage(customer, result.order);
}

// --- get_order_status -------------------------------------------------------

async function getOrderStatus(customer) {
  const order = (await orders.findLatestInFlight(customer.id)) || (await orders.findMostRecent(customer.id));

  if (!order) {
    return `You haven't got anything booked with us yet. Say the word and I'll arrange a pickup.`;
  }

  const when = booking.whenLine(order);

  switch (order.status) {
    case 'REQUESTED':
      return `You're all set for ${when}. Nothing to do until then.`;
    case 'ASSIGNED':
      return `You're down for ${when} and your locker's ready.`;
    case 'DEPOSITED':
      return `Got your laundry in the locker, it's on the next collection.`;
    case 'IN_PROCESS':
      return `Got it, it's being washed now. Back with you within ${site.turnaround}.`;
    case 'OUT_FOR_DELIVERY':
      return `Washed, folded and out for delivery today.`;
    case 'DELIVERED': {
      const cost = order.price_cents ? ` It came to $${(order.price_cents / 100).toFixed(2)}.` : '';
      return `That one's back with you already.${cost} Want another pickup?`;
    }
    case 'CANCELED':
      return `That one was cancelled. Want me to book a new one?`;
    default:
      return `Let me check on that and come back to you.`;
  }
}

// --- reschedule_order -------------------------------------------------------

async function rescheduleOrder(customer, input) {
  const problem = dateProblem(input.new_date);
  if (problem) return problem;

  const timeIssue = timeProblem(input.new_time, input.new_date);
  if (timeIssue) return timeIssue;

  const order = await orders.findAwaitingCollection(customer.id);

  if (!order) {
    const inFlight = await orders.findLatestInFlight(customer.id);
    if (inFlight) {
      return `That one's already been collected, so I can't move it. Want to book your next pickup instead?`;
    }
    return `You haven't got a pickup booked to move. What day would suit you?`;
  }

  // undefined, not null, when the AI didn't mention a time — otherwise every
  // plain "move it to Friday" would wipe the time they asked for last week.
  const newTime = input.new_time === undefined ? undefined : normaliseTime(input.new_time);

  // Only a no-op if the day AND the time are both what's already on the order.
  // Checking the date alone would refuse "same day but make it 4 instead of 6".
  const sameDay = order.pickup_date === input.new_date;
  const sameTime = !newTime || newTime === normaliseTime(order.pickup_time);
  if (sameDay && sameTime) {
    return `You're already down for ${booking.whenLine(order)}.`;
  }

  const updated = await orders.reschedule(order, input.new_date, newTime);
  return booking.rescheduledMessage(updated);
}

// --- cancel_order -----------------------------------------------------------

async function cancelOrder(customer) {
  const order = await orders.findAwaitingCollection(customer.id);

  if (!order) {
    const inFlight = await orders.findLatestInFlight(customer.id);
    if (inFlight) {
      return `Your laundry is already with us, so that one can't be cancelled. It'll be back within ${site.turnaround}.`;
    }
    return `You haven't got anything booked to cancel.`;
  }

  await orders.transition(order, 'CANCELED');
  return `Cancelled, no charge. Text me whenever you want to book again.`;
}

// --- open_locker ------------------------------------------------------------

async function openLocker(customer) {
  // The compartment is resolved from THIS customer's own order. Nothing the
  // customer typed is used to choose it — that is the whole security model.
  const order = await orders.findAwaitingCollection(customer.id);

  if (!order || !order.locker_id) {
    return (
      `You haven't got a locker assigned. We collect from your door at the moment. ` +
      `Say when you'd like a pickup and I'll book it.`
    );
  }

  // Phase 7 wires this to the real hardware. Until then, refuse honestly
  // rather than telling someone a door opened when it did not.
  return `Locker unlocking isn't switched on yet. Email ${site.email} and we'll sort it out.`;
}

// --- update_profile ---------------------------------------------------------

// Columns on the customer row, versus keys inside the preferences JSON.
const PROFILE_COLUMNS = ['name', 'email', 'address_line1', 'address_line2', 'city', 'state', 'postal_code'];
const PREFERENCE_KEYS = [
  'water_temp',
  'detergent',
  'fabric_softener',
  'special_instructions',
  'default_pickup_method',
];

async function updateProfile(customer, input) {
  const field = String(input.field || '');
  const value = String(input.value || '').trim();

  if (!value) return `What would you like me to change it to?`;

  if (PROFILE_COLUMNS.includes(field)) {
    const stored = field === 'state' ? value.toUpperCase() : value;
    const { error } = await db.from('customers').update({ [field]: stored }).eq('id', customer.id);
    if (error) throw error;
    return `Updated. I've got that saved.`;
  }

  if (PREFERENCE_KEYS.includes(field)) {
    const preferences = { ...(customer.preferences || {}) };
    preferences[field] =
      field === 'fabric_softener' ? /^(yes|true|y|please)$/i.test(value) : value;

    const { error } = await db.from('customers').update({ preferences }).eq('id', customer.id);
    if (error) throw error;
    return `Updated. I'll use that from your next pickup.`;
  }

  // Claude asked to change something we don't store. Hand over rather than
  // silently doing nothing.
  return `I'll pass that to someone who can sort it. You'll hear back shortly.`;
}

// --- handoff_to_human -------------------------------------------------------

async function handoffToHuman(customer, input, { notify }) {
  const reason = String(input.reason || 'no reason given');

  console.log(`HANDOFF  ${customer.phone} (${customer.name || 'unnamed'}): ${reason}`);

  if (config.supportPhone && notify) {
    await notify(
      config.supportPhone,
      `LYNDRY handoff: ${customer.name || customer.phone}: ${reason}`
    ).catch((err) => console.error('Could not notify support:', err.message));
  }

  return `Let me get a person on this. Someone will come back to you shortly.`;
}

// ---------------------------------------------------------------------------
// Run whichever action Claude chose
// ---------------------------------------------------------------------------

async function run(name, input, customer, helpers = {}) {
  switch (name) {
    case 'create_order':
      return createOrder(customer, input);
    case 'get_order_status':
      return getOrderStatus(customer);
    case 'reschedule_order':
      return rescheduleOrder(customer, input);
    case 'cancel_order':
      return cancelOrder(customer);
    case 'open_locker':
      return openLocker(customer);
    case 'update_profile':
      return updateProfile(customer, input);
    case 'handoff_to_human':
      return handoffToHuman(customer, input, helpers);
    default:
      // Claude named a tool that doesn't exist. Should be impossible, but
      // failing into a human is the safe direction.
      console.error(`Unknown action requested: ${name}`);
      return `Let me get a person on this. Someone will come back to you shortly.`;
  }
}

module.exports = { run, readableDate };
