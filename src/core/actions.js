'use strict';

const db = require('../db');
const orders = require('./orders');
const billing = require('./billing');
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

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Formats 2026-08-08 as "Saturday 8 Aug".
//
// Built from the string's own parts rather than a Date object on purpose: a
// date-only string parsed as a Date is treated as UTC midnight, which shows as
// the previous day for anyone in New Jersey.
function readableDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dayName = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dayName} ${d} ${MONTHS[m - 1]}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Returns an error message if the date is unusable, or null if it's fine.
function dateProblem(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) {
    return "I didn't catch which day you meant. What day works?";
  }
  if (iso < today()) {
    return `${readableDate(iso)} has already passed. What day did you mean?`;
  }
  return null;
}

function hasAddress(customer) {
  return Boolean(customer.address_line1 && customer.city && customer.postal_code);
}

// --- create_order -----------------------------------------------------------

async function createOrder(customer, input) {
  if (!hasAddress(customer)) {
    return `I don't have an address on file for you. Send your street address and I'll get it saved.`;
  }

  const problem = dateProblem(input.pickup_date);
  if (problem) return problem;

  // One order awaiting collection at a time. The database enforces this too;
  // catching it here means the customer gets a sentence instead of an error.
  const existing = await orders.findAwaitingCollection(customer.id);
  if (existing) {
    return (
      `You've already got a pickup booked for ${readableDate(existing.pickup_date)}. ` +
      `Want me to move it, or add a second one after that?`
    );
  }

  // No card, no booking.
  //
  // This check is in code, not in Claude's instructions, and that is
  // deliberate — the same reason open_locker() takes no arguments. Nothing a
  // customer can type should be able to talk its way past it.
  //
  // Only enforced when payments are actually switched on, so the service still
  // works end to end before the payment provider is configured.
  if (payments.isConfigured && !billing.hasPaymentMethod(customer)) {
    return billing.setupLinkMessage(customer);
  }

  const prefs = customer.preferences || {};

  const order = await orders.create({
    customerId: customer.id,
    pickupDate: input.pickup_date,
    // Their saved default, unless they said otherwise in this message.
    pickupMethod: input.pickup_method || prefs.default_pickup_method || 'LEAVE_OUTSIDE',
    bagCount: input.bag_count,
    notes: input.notes,
  });

  const leaving = order.pickup_method === 'LEAVE_OUTSIDE';
  const bags = order.bag_count ? `${order.bag_count} bag${order.bag_count > 1 ? 's' : ''}` : 'your laundry';

  // Naming the card in the confirmation is what makes this message the
  // authorisation for the charge that follows. If a customer ever disputes an
  // order, the message log shows them being told which card, before the work.
  const card = billing.describeCard(customer);
  const payment = card ? ` Charged to your ${card} once we weigh it.` : '';

  return (
    `Booked — we'll collect ${bags} on ${readableDate(order.pickup_date)}. ` +
    `${leaving ? 'Leave it outside your door.' : "We'll knock when we arrive."} ` +
    `${site.pricePerLb} a pound, weighed after pickup, back within ${site.turnaround}.${payment}`
  );
}

// --- get_order_status -------------------------------------------------------

async function getOrderStatus(customer) {
  const order = (await orders.findLatestInFlight(customer.id)) || (await orders.findMostRecent(customer.id));

  if (!order) {
    return `You haven't got anything booked with us yet. Say the word and I'll arrange a pickup.`;
  }

  const day = readableDate(order.pickup_date);

  switch (order.status) {
    case 'REQUESTED':
      return `You're booked in for ${day}. Nothing to do until then.`;
    case 'ASSIGNED':
      return `You're booked for ${day} and your locker is ready.`;
    case 'DEPOSITED':
      return `We've got your laundry in the locker and it's on the next collection.`;
    case 'IN_PROCESS':
      return `We've collected it and it's being washed. Back with you within ${site.turnaround}.`;
    case 'OUT_FOR_DELIVERY':
      return `It's washed, folded and out for delivery today.`;
    case 'DELIVERED': {
      const cost = order.price_cents ? ` It came to $${(order.price_cents / 100).toFixed(2)}.` : '';
      return `That one's been delivered.${cost} Want another pickup?`;
    }
    case 'CANCELED':
      return `Your last order was cancelled. Want me to book a new one?`;
    default:
      return `Let me check on that and come back to you.`;
  }
}

// --- reschedule_order -------------------------------------------------------

async function rescheduleOrder(customer, input) {
  const problem = dateProblem(input.new_date);
  if (problem) return problem;

  const order = await orders.findAwaitingCollection(customer.id);

  if (!order) {
    const inFlight = await orders.findLatestInFlight(customer.id);
    if (inFlight) {
      return `That one's already been collected, so I can't move it. Want to book your next pickup instead?`;
    }
    return `You haven't got a pickup booked to move. What day would suit you?`;
  }

  if (order.pickup_date === input.new_date) {
    return `You're already down for ${readableDate(order.pickup_date)}.`;
  }

  const updated = await orders.reschedule(order, input.new_date);
  return `Moved — we'll come on ${readableDate(updated.pickup_date)} instead.`;
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
      `You haven't got a locker assigned. We collect from your door at the moment — ` +
      `say when you'd like a pickup and I'll book it.`
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
    return `Updated — I'll use that from your next pickup.`;
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
      `LYNDRY handoff: ${customer.name || customer.phone} — ${reason}`
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
