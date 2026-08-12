'use strict';

const orders = require('./orders');
const billing = require('./billing');
const payments = require('../providers/payments');
const { site } = require('../web/site');
const { config } = require('../config');

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
// The pickup windows
// ---------------------------------------------------------------------------
//
// A van cannot be at forty doors at arbitrary minutes, so we do not pretend it
// can. A customer names a time; we put them in the window that contains it and
// tell them the window. We never quote a minute, and we never negotiate.
//
// THESE ARE PLACEHOLDER VALUES taken from Neil's example and not yet confirmed
// against a real round. They are the only place windows are defined: change
// them here and every quote, confirmation and ops screen follows. Existing
// orders are unaffected, because the window they were promised is stored on
// the order itself rather than recomputed.
//
// A gap between windows is deliberate and fine. A time that falls in one gets
// the next window that starts after it.
const PICKUP_WINDOWS = Object.freeze([
  Object.freeze({ start: '09:00', end: '12:00' }),
  Object.freeze({ start: '13:00', end: '14:00' }),
  Object.freeze({ start: '15:00', end: '18:00' }),
]);

// How close to a window's start we will still accept a booking for it. Below
// this, the van is already loaded and moving, so it goes to the next one.
const WINDOW_CUTOFF_MIN = 60;

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

// "between 3 and 6pm" from a stored window, or from anything window-shaped.
//
// Returns null when there is no window, which is normal: an order booked with
// no time at all simply doesn't mention one.
function describeWindow(startValue, endValue) {
  const from = normaliseTime(startValue);
  const to = normaliseTime(endValue);
  if (!from || !to) return null;

  const startMin = toMinutes(from);
  const endMin = toMinutes(to);
  const a = clockParts(startMin);
  const b = clockParts(endMin);

  // The suffix goes on the end only, unless the window straddles noon and the
  // two halves differ: without that, 11 to 1 reads as "between 11 and 1pm".
  const startLabel =
    a.meridiem === b.meridiem ? bareClock(startMin) : `${bareClock(startMin)}${a.meridiem}`;

  return `between ${startLabel} and ${bareClock(endMin)}${b.meridiem}`;
}

// The window an order was promised. Reads what is stored, never recomputes.
function arrivalWindow(order) {
  if (!order) return null;
  return describeWindow(order.pickup_window_start, order.pickup_window_end);
}

// ---------------------------------------------------------------------------
// Choosing a window
// ---------------------------------------------------------------------------
//
// Given a day, a time somebody asked for, and what time it is now, work out
// which window they get. Returns { date, start, end } or null when there is
// nothing left today and the caller should look at tomorrow.
//
// The rules, in order:
//   - a window that has already started, or starts within the hour, is gone
//   - otherwise the window containing the requested time
//   - otherwise the next window that starts after it
//   - no time asked for at all means the first window still available
function chooseWindow(date, requestedTime) {
  const now = nowInService();
  const isToday = date === now.date;
  const nowMin = toMinutes(now.time);

  const usable = PICKUP_WINDOWS.filter((w) =>
    isToday ? toMinutes(w.start) - WINDOW_CUTOFF_MIN > nowMin : true
  );

  if (!usable.length) return null;

  const clean = normaliseTime(requestedTime);
  if (!clean) return { date, ...usable[0] };

  const asked = toMinutes(clean);

  const containing = usable.find(
    (w) => asked >= toMinutes(w.start) && asked <= toMinutes(w.end)
  );
  if (containing) return { date, ...containing };

  const next = usable.find((w) => toMinutes(w.start) >= asked);
  if (next) return { date, ...next };

  // Asked for a time later than every window, "9pm" say. The closest we can
  // actually do is the last window of the day, which beats throwing them to
  // nine the next morning for being three hours optimistic.
  return { date, ...usable[usable.length - 1] };
}

// The day after an ISO date, without going near a Date object's timezone.
function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + 1));
  return at.toISOString().slice(0, 10);
}

// The window a customer actually gets, rolling to tomorrow when today is done.
// Always returns something, so nothing ever has to ask the customer to pick.
function windowFor(date, requestedTime) {
  return chooseWindow(date, requestedTime) || {
    ...chooseWindow(nextDay(date), requestedTime),
    rolledToNextDay: true,
  };
}

// Every window, as a sentence, for the website and the AI's context.
function listWindows() {
  return PICKUP_WINDOWS.map((w) => describeWindow(w.start, w.end).replace('between ', '')).join(', ');
}

// Returns a human sentence if the time is unusable, or null if it is fine.
//
// A time that has already gone by is NOT a problem any more. It used to ask
// "did you mean tomorrow, or later today?", which reads as arguing with the
// customer about what time it is, and in one real thread the AI asked the
// customer whether 3pm had happened yet. With fixed windows there is nothing
// to argue about: a time that has passed simply lands in the next window, and
// we tell them which one that is.
function timeProblem(value) {
  if (value === undefined || value === null || value === '') return null;

  const clean = normaliseTime(value);
  if (!clean) return "I didn't catch what time you meant. Roughly when suits you?";

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

  const timeDetail = timeProblem(pickupTime);
  if (timeDetail) return { ok: false, reason: 'bad_time', detail: timeDetail };

  // One order awaiting collection at a time. The database enforces this with a
  // partial unique index too; catching it here means the customer gets a
  // sentence instead of a constraint violation.
  const existing = await orders.findAwaitingCollection(customer.id);
  if (existing) return { ok: false, reason: 'already_booked', order: existing };

  // The card is NOT asked for here.
  //
  // It used to be: no card meant no order, so somebody arranging their first
  // pickup got a payment link instead of a booking, and once they had paid
  // there was nothing to resume. They ended up with a saved card and no
  // pickup, which happened to a real customer.
  //
  // Now the order is written first and the minimum is charged against it
  // straight afterwards. A booking with no minimum paid is simply not
  // confirmed: deposit_paid_at stays null and it stays off the run sheet.
  const prefs = customer.preferences || {};

  // The window is decided here and stored, never recomputed. If today is done
  // it rolls to tomorrow rather than asking the customer to choose again.
  const window = windowFor(pickupDate, pickupTime);

  const order = await orders.create({
    customerId: customer.id,
    pickupDate: window.date,
    pickupTime: normaliseTime(pickupTime),
    pickupWindowStart: window.start,
    pickupWindowEnd: window.end,
    // Their saved default, unless they asked for something else this time.
    pickupMethod: PICKUP_METHODS.includes(pickupMethod)
      ? pickupMethod
      : prefs.default_pickup_method || 'LEAVE_OUTSIDE',
    bagCount,
    notes,
  });

  // Now take the minimum. The order exists either way; what this decides is
  // whether it is confirmed.
  const deposit = await billing.chargeDeposit(order, customer);

  // Whether we had to move them off the day they asked for. Not a failure and
  // not worth arguing about, but worth one clause in the confirmation: a
  // customer who says "today" and silently gets tomorrow writes back to ask
  // why, which is a conversation nobody needed to have.
  return {
    ok: true,
    order: deposit.order || order,
    rolled: window.date !== pickupDate,
    deposit,
  };
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
  const window = arrivalWindow(order);
  return window ? `${day} ${window}` : day;
}

// The text sent when a pickup is booked, whichever door it came through.
//
// Naming the card here is load-bearing: this message is the authorisation for
// the charge that follows, so if an order is ever disputed the message log
// shows the customer being told which card, before any work was done.
function confirmationMessage(customer, order, { rolled = false } = {}) {
  const bags = order.bag_count
    ? `${order.bag_count} bag${order.bag_count > 1 ? 's' : ''}`
    : 'it';

  const handover =
    order.pickup_method === 'HAND_TO_DRIVER'
      ? `Just have ${bags} ready and we'll knock when we arrive.`
      : `Just leave ${bags} outside your door and we'll text you as soon as we've got it.`;

  // What was actually taken, and what happens to the rest.
  //
  // The minimum is stated as a charge that has already happened, because it
  // has. Anything vaguer invites "why is there $25 on my card".
  const card = billing.describeCard(customer);
  const minimum = billing.money(config.pricing.minimumCents);

  const money = order.deposit_paid_at
    ? `We've taken the ${minimum} minimum on your ${card}. It's ${site.pricePerLb} a pound, ` +
      `so if it comes to more than that we'll charge the difference once we weigh it.`
    : card
      ? `It's ${site.pricePerLb} a pound, weighed after pickup and charged to your ${card}.`
      : `It's ${site.pricePerLb} a pound, weighed after pickup.`;

  // Plain hyphens and straight quotes only, here and in every other outbound
  // message. One em dash triples what this costs to send; the reasoning is in
  // full at the top of src/core/notify.js, which warns if one creeps back in.
  // The order number is in here so the customer has it if they ever ring or
  // email about this pickup. It is the same number the driver sees on the run
  // sheet, which is the whole point of having one.
  const reference = order.order_number ? ` Order #${order.order_number}.` : '';

  // handover carries the "we'll text you" promise for a doorstep pickup and
  // the "we'll knock" one for a handover, so it is not repeated here.
  // Stated, not apologised for. "Today's rounds are done" is a fact about the
  // van, not a negotiation, and it stops them wondering why the day moved.
  const opener = rolled
    ? `Today's rounds are finished, so the earliest we can get to you is`
    : `Of course! We'll be there`;

  return (
    `${opener} ${whenLine(order)}. ${handover} ` +
    `${money} Back with you within ${site.turnaround}.${reference}`
  );
}

function rescheduledMessage(order) {
  return `No problem at all, we've moved it to ${whenLine(order)}.`;
}

module.exports = {
  SERVICE_TZ,
  PICKUP_WINDOWS,
  windowFor,
  describeWindow,
  listWindows,
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
