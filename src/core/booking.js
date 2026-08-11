'use strict';

const orders = require('./orders');
const billing = require('./billing');
const payments = require('../providers/payments');
const { site } = require('../web/site');

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

// Everything about "when" is worked out in the timezone the vans actually
// drive in, not the server's.
//
// This used to be `new Date().toISOString()`, which is UTC. From 8pm New Jersey
// time onward UTC has already rolled over, so a customer texting "pickup today"
// on Tuesday evening was told Tuesday had already passed. Nobody caught it
// because nobody tested after 8pm.
const SERVICE_TZ = 'America/New_York';

const CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: SERVICE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// { date: '2026-08-11', time: '19:45' } — right now, in New Jersey.
function nowInService() {
  const parts = {};
  for (const p of CLOCK.formatToParts(new Date())) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function today() {
  return nowInService().date;
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

// ---------------------------------------------------------------------------
// What time, and the window we promise back
// ---------------------------------------------------------------------------
//
// A customer who says "tomorrow at 6" is told we'll be there between 5:30 and
// 7. We never quote the exact minute they asked for, because we would miss it
// and a missed promise is worse than a wider one.
//
// These two numbers are the whole rule. Widen or tighten the window by editing
// them; nothing else needs to change and nothing needs backfilling, because the
// order stores the time asked for rather than the window quoted.
const WINDOW_BEFORE_MIN = 30;
const WINDOW_AFTER_MIN = 60;

// Accepts what a form sends ("18:00") and what Postgres returns ("18:00:00"),
// and returns a clean "HH:MM" — or null if it is not a time at all.
//
// Deliberately strict: turning free text like "sixish" into a time is the AI's
// job, and it hands us a real clock value. This is the check that the value it
// handed over is genuinely one.
function normaliseTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || '').trim());
  if (!match) return null;

  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// 18:00 -> { hour: 6, minute: 0, meridiem: 'pm' }
function clockParts(minutes) {
  const h24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return {
    hour: h24 % 12 === 0 ? 12 : h24 % 12,
    minute,
    meridiem: h24 < 12 ? 'am' : 'pm',
  };
}

// "6", "5:30" — the bare clock reading, no am/pm.
function bareClock(minutes) {
  const { hour, minute } = clockParts(minutes);
  return minute === 0 ? `${hour}` : `${hour}:${String(minute).padStart(2, '0')}`;
}

// "6pm", "5:30am" — for a single time on its own.
function readableTime(value) {
  const clean = normaliseTime(value);
  if (!clean) return null;
  const minutes = toMinutes(clean);
  return `${bareClock(minutes)}${clockParts(minutes).meridiem}`;
}

// The sentence fragment a customer actually reads: "between 5:30 and 7pm".
//
// Returns null when no time was asked for, which is a normal thing to happen
// and means the confirmation simply doesn't mention a time.
function arrivalWindow(value) {
  const clean = normaliseTime(value);
  if (!clean) return null;

  const asked = toMinutes(clean);

  // Clamped to the same calendar day. Without this, "11pm" produces a window
  // that runs into tomorrow and reads as nonsense.
  const start = Math.max(0, asked - WINDOW_BEFORE_MIN);
  const end = Math.min(23 * 60 + 59, asked + WINDOW_AFTER_MIN);

  const from = clockParts(start);
  const to = clockParts(end);

  // Normally the suffix goes on the end only — "between 5:30 and 7pm". When the
  // window straddles noon or midnight the two halves differ, and dropping the
  // first suffix would turn 11:30am into "between 11 and 12:30pm".
  const fromLabel = from.meridiem === to.meridiem
    ? bareClock(start)
    : `${bareClock(start)}${from.meridiem}`;

  return `between ${fromLabel} and ${bareClock(end)}${to.meridiem}`;
}

// Returns a human sentence if the time is unusable, or null if it is fine.
function timeProblem(value, pickupDate) {
  if (value === undefined || value === null || value === '') return null;

  const clean = normaliseTime(value);
  if (!clean) return "I didn't catch what time you meant. Roughly when suits you?";

  // A time that has already gone by today. They almost certainly mean tomorrow,
  // but guessing which day someone meant is exactly the kind of assumption that
  // gets a driver sent out on the wrong evening — so ask.
  const now = nowInService();
  if (pickupDate === now.date && toMinutes(clean) <= toMinutes(now.time)) {
    return `${readableTime(clean)} today has already gone by. Did you mean tomorrow, or later today?`;
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

async function bookPickup(customer, { pickupDate, pickupTime, pickupMethod, bagCount, notes } = {}) {
  if (!hasAddress(customer)) return { ok: false, reason: 'no_address' };

  const detail = dateProblem(pickupDate);
  if (detail) return { ok: false, reason: 'bad_date', detail };

  // Checked against the date above, so "today at 6" can tell whether 6 has
  // already been and gone.
  const timeDetail = timeProblem(pickupTime, pickupDate);
  if (timeDetail) return { ok: false, reason: 'bad_time', detail: timeDetail };

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
    pickupTime: normaliseTime(pickupTime),
    // Their saved default, unless they asked for something else this time.
    pickupMethod: PICKUP_METHODS.includes(pickupMethod)
      ? pickupMethod
      : prefs.default_pickup_method || 'LEAVE_OUTSIDE',
    bagCount,
    notes,
  });

  return { ok: true, order };
}

// ---------------------------------------------------------------------------
// Describing a booking back to the customer
// ---------------------------------------------------------------------------
//
// These live here, next to the rules, because BOTH front doors send them and
// the messages table is meant to be the single record of what a customer was
// told. When the AI and the web form each had their own copy, booking by text
// and booking on the site produced two subtly different confirmations for the
// same thing — and only one of them ever got updated.

// "Wednesday 12 Aug between 5:30 and 7pm", or just the day when no time was
// asked for.
function whenLine(order) {
  const day = readableDate(order.pickup_date);
  const window = arrivalWindow(order.pickup_time);
  return window ? `${day} ${window}` : day;
}

// The text sent when a pickup is booked, whichever door it came through.
//
// Naming the card here is load-bearing: this message is the authorisation for
// the charge that follows, so if an order is ever disputed the message log
// shows the customer being told which card, before any work was done.
function confirmationMessage(customer, order) {
  const bags = order.bag_count
    ? `${order.bag_count} bag${order.bag_count > 1 ? 's' : ''}`
    : 'it';

  const handover =
    order.pickup_method === 'HAND_TO_DRIVER'
      ? `Have ${bags} ready and we'll knock.`
      : `Leave ${bags} outside.`;

  const card = billing.describeCard(customer);
  const money = card
    ? `${site.pricePerLb} a pound, weighed after pickup and charged to your ${card}.`
    : `${site.pricePerLb} a pound, weighed after pickup.`;

  // Plain hyphens and straight quotes only, here and in every other outbound
  // message. One em dash triples what this costs to send; the reasoning is in
  // full at the top of src/core/notify.js, which warns if one creeps back in.
  return (
    `Of course. We'll come ${whenLine(order)}. ${handover} ` +
    `We'll text you when we've got it. ${money} Back within ${site.turnaround}.`
  );
}

function rescheduledMessage(order) {
  return `No problem, we'll come ${whenLine(order)} instead.`;
}

module.exports = {
  bookPickup,
  whenLine,
  confirmationMessage,
  rescheduledMessage,
  dateProblem,
  timeProblem,
  hasAddress,
  readableDate,
  readableTime,
  arrivalWindow,
  normaliseTime,
  today,
  nowInService,
  PICKUP_METHODS,
};
