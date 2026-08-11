'use strict';

const orders = require('./orders');
const billing = require('./billing');
const payments = require('../providers/payments');

// ---------------------------------------------------------------------------
// The rules for booking a pickup, in one place.
//
// There are two front doors now — a text message and the website — and they
// must agree. If the AI refuses a date the web form would accept, or the web
// form books a second order the AI would have blocked, the database ends up in
// a state neither of them expects.
//
// So neither of them decides anything. Both call bookPickup(), which returns a
// plain result, and each renders that result the way its own medium wants: the
// AI writes a sentence, the website shows a form error.
// ---------------------------------------------------------------------------

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Formats 2026-08-08 as "Saturday 8 Aug".
//
// Built from the string's own parts on purpose: a date-only string parsed as a
// Date is treated as UTC midnight, which displays as the previous day for
// anyone in New Jersey.
function readableDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dayName = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dayName} ${d} ${MONTHS[m - 1]}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// 1st, 2nd, 3rd, 4th … and 11th/12th/13th, which are the ones naive versions
// get wrong.
function ordinal(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
}

function hasAddress(customer) {
  return Boolean(customer.address_line1 && customer.city && customer.postal_code);
}

// Returns a human sentence if the date is unusable, or null if it is fine.
function dateProblem(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) {
    return "I didn't catch which day you meant. What day works?";
  }

  // A date the calendar doesn't have — 31 February, say — survives the pattern
  // above but is not a real day.
  const [y, m, d] = iso.split('-').map(Number);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  if (asDate.getUTCMonth() !== m - 1 || asDate.getUTCDate() !== d) {
    return `${MONTHS[m - 1] || 'That month'} doesn't have a ${d}${ordinal(d)}. What day did you mean?`;
  }

  if (iso < today()) {
    return `${readableDate(iso)} has already passed. What day did you mean?`;
  }

  return null;
}

const PICKUP_METHODS = ['LEAVE_OUTSIDE', 'HAND_TO_DRIVER'];

// ---------------------------------------------------------------------------
// Book a pickup.
//
// Returns one of:
//   { ok: true, order }
//   { ok: false, reason: 'no_address' }
//   { ok: false, reason: 'bad_date', detail }      detail is a full sentence
//   { ok: false, reason: 'already_booked', order }
//   { ok: false, reason: 'needs_card' }
// ---------------------------------------------------------------------------

async function bookPickup(customer, { pickupDate, pickupMethod, bagCount, notes } = {}) {
  if (!hasAddress(customer)) return { ok: false, reason: 'no_address' };

  const detail = dateProblem(pickupDate);
  if (detail) return { ok: false, reason: 'bad_date', detail };

  // One order awaiting collection at a time. The database enforces this with a
  // partial unique index too; catching it here means the customer gets a
  // sentence instead of a constraint violation.
  const existing = await orders.findAwaitingCollection(customer.id);
  if (existing) return { ok: false, reason: 'already_booked', order: existing };

  // No card, no booking.
  //
  // This lives in code rather than in Claude's instructions, and it applies to
  // the web form for exactly the same reason: nothing a customer types — or
  // posts — should be able to talk its way past it.
  //
  // Only enforced once payments are actually switched on, so the service still
  // works end to end before the payment provider is configured.
  if (payments.isConfigured && !billing.hasPaymentMethod(customer)) {
    return { ok: false, reason: 'needs_card' };
  }

  const prefs = customer.preferences || {};

  const order = await orders.create({
    customerId: customer.id,
    pickupDate,
    // Their saved default, unless they asked for something else this time.
    pickupMethod: PICKUP_METHODS.includes(pickupMethod)
      ? pickupMethod
      : prefs.default_pickup_method || 'LEAVE_OUTSIDE',
    bagCount,
    notes,
  });

  return { ok: true, order };
}

module.exports = {
  bookPickup,
  dateProblem,
  hasAddress,
  readableDate,
  today,
  PICKUP_METHODS,
};
