'use strict';

const orders = require('./orders');
const billing = require('./billing');
const events = require('./order-events');
const payments = require('../providers/payments');
const { site } = require('../web/site');
const { config } = require('../config');
const wash = require('./wash');
const settings = require('./settings');

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

// Add days to a date string without ever making a Date out of it.
//
// Date.UTC then getUTCDate is safe here because nothing is being converted
// between zones - it is calendar arithmetic on a plain "2026-08-13".
function addDays(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// How far New Jersey is from UTC at a given instant. Negative, and it changes
// twice a year, which is the whole reason this is worked out rather than
// hardcoded to -4 or -5.
function offsetAt(instant) {
  const parts = {};
  for (const p of CLOCK.formatToParts(instant)) parts[p.type] = p.value;
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute)
  );
  return asIfUtc - instant;
}

// "2026-08-14" plus "18:00" in New Jersey, as a real instant in time.
//
// Two passes on purpose. The first guesses the offset from the naive time; on
// the two days a year the clocks move, that guess can be an hour out, and the
// second pass corrects it using the offset that actually applies at the
// instant we landed on.
function instantAt(iso, hhmm) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const [hh, mi] = String(hhmm).split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mi);

  const first = naive - offsetAt(naive);
  return naive - offsetAt(first);
}

// The hour by which a bag has to be back: the end of the last window the van
// runs. Derived rather than written down again, so changing the windows moves
// the promise with them.
function endOfDeliveryDay() {
  return PICKUP_WINDOWS[PICKUP_WINDOWS.length - 1].end;
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

// Have they actually told us how to wash their clothes?
//
// There are NO default preferences. Washing somebody's clothes warm when they
// never said so is how clothes get ruined, and "we've set you up with cold
// water and standard detergent" went to a real customer who had chosen
// nothing. A first booking is refused until these exist, which is what makes
// the asking mandatory rather than polite.
function hasPreferences(customer) {
  const prefs = customer.preferences || {};

  // VALIDATED, NOT MERELY PRESENT. A value we no longer offer - an old
  // HYPOALLERGENIC detergent, or a softener stored as the boolean it used to
  // be - would otherwise satisfy a "is it set" check and then quietly fall back
  // to the default when the wash lines were built. That is somebody's clothes
  // washed a way they did not choose, with nothing anywhere saying so.
  //
  // Failing here just means they are asked again, which is the right outcome.
  return wash.KEYS.every((key) => wash.isValid(key, prefs[key]));
}

// Is this address somewhere the van actually goes?
//
// BERGEN COUNTY, and Neil has now drawn the line that CLAUDE.md said was
// undrawn. It used to be "New Jersey with an 07xxx zip", which is most of the
// north of the state - fine while the promise was "Northern New Jersey" and
// far too wide for one van working out of Fair Lawn.
//
// A ZIP LIST RATHER THAN A CLEVER TEST, because a county has no arithmetic. It
// is long, it is boring, and it is checkable by a person - which matters,
// since being wrong here turns away somebody we could serve.
//
// What this is NOT: proof the address exists. Nothing here checks that
// 16-50 Chandler Dr is a real door; that needs an address validation service
// and is a separate, deliberate decision.
const BERGEN_ZIPS = new Set([
  // South and the Meadowlands edge
  '07010', '07020', '07022', '07024', '07026', '07031',
  '07070', '07071', '07072', '07073', '07074', '07075',
  // North west, up the Ramapo side
  '07401', '07407', '07410', '07417', '07423', '07430', '07432', '07436',
  '07446', '07450', '07452', '07458', '07463', '07481', '07495',
  // Hackensack and the central belt
  '07601', '07603', '07604', '07605', '07606', '07607', '07608',
  // The Northern Valley and the Palisades
  '07620', '07621', '07624', '07626', '07627', '07628', '07630', '07631',
  '07632', '07640', '07641', '07642', '07643', '07644', '07645', '07646',
  '07647', '07648', '07649', '07650', '07652', '07653', '07656', '07657',
  '07660', '07661', '07662', '07663', '07666', '07670', '07675', '07676',
  '07677',
]);

// NEIL'S OWN NUMBER, WHICH CAN ALWAYS BOOK.
//
// He has to be able to put an order through while the service is shut and from
// an address outside the county - that is how the thing gets tested end to end
// and how he takes a favour for somebody he knows.
//
// It waives exactly two rules, both of which are decisions about who we choose
// to serve rather than facts a booking needs: the closed sign, and the county
// boundary. An address, wash preferences, a card and a real date are still
// required of him like anybody else, because those are what make an order
// possible to actually do.
function alwaysAllowed(customer) {
  const digits = String((customer || {}).phone || '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length === 10 && config.alwaysBookNumbers.includes(ten);
}

function inServiceArea(customer) {
  const state = String(customer.state || '').trim().toUpperCase();
  if (state && state !== 'NJ') return false;

  const zip = String(customer.postal_code || '').trim().slice(0, 5);
  return BERGEN_ZIPS.has(zip);
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
// These are the only place windows are defined: change them here and every
// quote, confirmation and ops screen follows. Existing orders are unaffected,
// because the window they were promised is stored on the order itself rather
// than recomputed - so widening a window never needs a backfill and never
// changes what somebody was already told.
//
// They may be left with gaps between them. A time that falls in a gap gets the
// next window that starts after it.
// Roughly three hours each, and they run back to back from six in the morning
// to nine at night. The width is the point: a van doing a whole county cannot
// promise a half-hour, and a window we miss is worse than a wide one we keep.
//
// They are not all exactly three hours because the day is not shaped that way.
// Midday to two is the short one - it is the lunch gap, and the run tends to be
// thin there. Five to nine is the long one, because it is when most people are
// home, so it takes the most stops and needs the most room.
//
// Six in the morning and nine at night are the outer edges: early enough for
// somebody leaving for work, late enough for somebody getting back from it.
const PICKUP_WINDOWS = Object.freeze([
  Object.freeze({ start: '06:00', end: '09:00' }),
  Object.freeze({ start: '09:00', end: '12:00' }),
  Object.freeze({ start: '12:00', end: '14:00' }),
  Object.freeze({ start: '14:00', end: '17:00' }),
  Object.freeze({ start: '17:00', end: '21:00' }),
]);

// How much of a window must be LEFT for it to still take a booking. Measured
// against the window's end, not its start: a window that is underway is still
// a real option — the van is out until it closes. "Today at 4:30", texted at
// 3:32, belongs in the 3 to 6 window, and the first version of this rule
// threw it to tomorrow, which put a real order on the wrong day.
const WINDOW_CUTOFF_MIN = 60;

// Where the day starts for somebody who did not name a time. The early window
// exists for people who ask for it, not for people who said nothing.
const DEFAULT_FROM = '09:00';

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
    isToday ? toMinutes(w.end) - WINDOW_CUTOFF_MIN >= nowMin : true
  );

  if (!usable.length) return null;

  // SOMEBODY WHO NAMES NO TIME DOES NOT GET THE FIRST WINDOW OF THE DAY.
  //
  // "Laundry tomorrow" is not a request to be knocked on at six in the morning.
  // The day now opens at 6am for the people who want it, so taking the earliest
  // window as the default would quietly promise every silent customer the one
  // slot almost none of them meant. Default to the first window starting at or
  // after DEFAULT_FROM, and only fall back to the earliest when the day is too
  // far gone for anything else.
  const clean = normaliseTime(requestedTime);
  if (!clean) {
    const sensible = usable.find((w) => toMinutes(w.start) >= toMinutes(DEFAULT_FROM));
    return { date, ...(sensible || usable[0]) };
  }

  const asked = toMinutes(clean);

  // END-EXCLUSIVE, because the windows now run back to back and every boundary
  // belongs to two of them. Somebody who says "noon" means the start of the
  // midday run, not the last minute of the morning one - inclusive matching
  // took the earlier window and quietly promised them a van before they asked
  // for it.
  const containing = usable.find(
    (w) => asked >= toMinutes(w.start) && asked < toMinutes(w.end)
  );
  if (containing) return { date, ...containing };

  // The one time end-exclusive gets wrong: the very last minute of the day.
  // "Nine at night" has no window starting after it, and it is exactly the
  // close of the evening run rather than something later.
  const last = usable[usable.length - 1];
  if (asked === toMinutes(last.end)) return { date, ...last };

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

// WHICH WINDOWS ARE STILL BOOKABLE TODAY, and which have gone.
//
// The AI used to be handed the clock and the full list of windows and asked to
// work out which one a requested time would land in. That is arithmetic, and it
// got it wrong on a real customer: at 11:43 in the morning somebody asked for
// 7am today and the recap read the time straight back to them - "today, 13 Aug
// at 7am" - four hours after it had gone.
//
// So it is computed here and handed over as an answer instead. Same rule as
// everywhere else: the code decides, the AI puts it in a sentence.
function windowsToday(now = nowInService()) {
  const nowMin = toMinutes(now.time);

  const open = [];
  const gone = [];

  for (const w of PICKUP_WINDOWS) {
    // Same cutoff chooseWindow() uses, so the two can never disagree about
    // whether a window is still worth offering.
    if (toMinutes(w.end) - WINDOW_CUTOFF_MIN >= nowMin) open.push(w);
    else gone.push(w);
  }

  const say = (list) =>
    list.map((w) => describeWindow(w.start, w.end).replace('between ', '')).join(', ');

  return {
    open,
    gone,
    openText: say(open),
    goneText: say(gone),
    // What somebody gets if they ask for a time today that has already passed.
    // Null when the day is done and anything they ask for rolls to tomorrow.
    nextText: open.length ? say([open[0]]) : null,
    dayIsDone: open.length === 0,
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
//   { ok: false, reason: 'not_taking_orders', detail }   detail is Neil's reason, or null
//   { ok: false, reason: 'no_address' }
//   { ok: false, reason: 'bad_date', detail }      detail is a full sentence
//   { ok: false, reason: 'already_booked', order }
//   { ok: false, reason: 'needs_card' }
// ---------------------------------------------------------------------------

async function bookPickup(customer, { pickupDate, pickupTime, pickupMethod, bagCount, notes, fromSchedule } = {}) {
  // NOT TAKING ORDERS. Checked first, before anything else, because when the
  // service is shut every other reason a booking might fail is beside the
  // point - and because this is the guard that has to hold when the AI is
  // talked round. The prompt asks it not to book; this is what makes sure.
  //
  // A STANDING ORDER IS NOT EXEMPT. The nightly job books tomorrow's recurring
  // pickups, and a van that is not running cannot collect them either.
  const owner = alwaysAllowed(customer);

  if (!owner && !(await settings.takingOrders())) {
    return { ok: false, reason: 'not_taking_orders', detail: await settings.pausedReason() };
  }

  if (!hasAddress(customer)) return { ok: false, reason: 'no_address' };

  // Checked at booking rather than only at signup, because an address can be
  // edited later and the van's range is the van's range.
  if (!owner && !inServiceArea(customer)) return { ok: false, reason: 'out_of_area' };

  // No preferences, no booking. The AI is told to ask; this is what makes
  // sure, because a model is not a guarantee and a wash nobody specified is
  // not a wash we should run.
  if (!hasPreferences(customer)) return { ok: false, reason: 'no_preferences' };

  const detail = dateProblem(pickupDate);
  if (detail) return { ok: false, reason: 'bad_date', detail };

  const timeDetail = timeProblem(pickupTime);
  if (timeDetail) return { ok: false, reason: 'bad_time', detail: timeDetail };

  // ONE PICKUP PER DAY, not one in total.
  //
  // A van makes a single visit to a door on a given day, so a second booking
  // for the same date is a mistake rather than a request. Booking Thursday and
  // Friday is a perfectly ordinary thing to want, and refusing it sent a real
  // customer to a human for something the business plainly wants to say yes to.
  //
  // The database enforces the same rule with a partial unique index; catching
  // it here means the customer gets a sentence instead of a constraint error.
  const existing = await orders.findAwaitingOn(customer.id, pickupDate);
  if (existing) return { ok: false, reason: 'already_booked', order: existing };

  // The order is written BEFORE the card is considered.
  //
  // It used to be the other way round: no card meant no order, so somebody
  // arranging their first pickup got a payment link instead of a booking, and
  // once they had paid there was nothing to resume. They ended up with a saved
  // card and no pickup, which happened to a real customer.
  //
  // So the pickup is recorded first and the card is a separate question asked
  // straight after. A booking with no card on file is simply not confirmed: it
  // exists, it can be resumed the moment a card is saved, and until then it
  // stays off the driver's run sheet, because nobody should drive to a door
  // for an order we have no way to bill.
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
    // Marks an auto-booked pickup so it can be told apart on the ops board
    // from one somebody actually asked for.
    fromSchedule: Boolean(fromSchedule),
    // Their saved default, unless they asked for something else this time.
    pickupMethod: PICKUP_METHODS.includes(pickupMethod)
      ? pickupMethod
      : prefs.default_pickup_method || 'LEAVE_OUTSIDE',
    bagCount,
    notes,
  });

  await events.record(order.id, {
    kind: 'CREATED',
    summary: fromSchedule
      ? `Booked automatically from a standing order for ${window.date}`
      : `Booked for ${window.date}`,
    became: window.date,
    by: { actor: fromSchedule ? 'system' : 'customer' },
    reason: window.date !== pickupDate ? `Asked for ${pickupDate}, rolled to the next slot` : null,
  });

  // WHERE IT IS GOING, DECIDED NOW. Neil's call: the system should have the
  // address the moment the order is placed, rather than working it out again
  // every time somebody draws a board - which meant a driver looking at
  // tomorrow's round saw a stop called "a laundromat" with no address on it.
  //
  // Deliberately NOT awaited, and deliberately unable to fail the booking. It
  // may geocode, which is a rate-limited public service, and a customer waiting
  // on a confirmation text must never wait on it. If it does not land, the
  // boards still choose live exactly as they always did - this only means the
  // answer is already there.
  //
  // require() here rather than at the top: dispatch requires this file, so a
  // module-level import would be a cycle. Node caches it, so the cost is one
  // lookup.
  require('./dispatch')
    .savePlannedPartner(order, customer)
    .catch((err) => console.error(`Could not plan a laundromat: ${err.message}`));

  // NO MONEY MOVES HERE. The card is charged once, at the door. All this asks
  // is whether we have a card to charge when we get there.
  //
  // `rolled` is whether we had to move them off the day they asked for. Not a
  // failure and not worth arguing about, but worth one clause in the
  // confirmation: a customer who says "today" and silently gets tomorrow
  // writes back to ask why, which is a conversation nobody needed to have.
  return {
    ok: true,
    order,
    rolled: window.date !== pickupDate,
    needsCard: billing.needsCardOnFile(customer),
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
function confirmationMessage(customer, order, { rolled = false, opener = null } = {}) {
  const prefs = customer.preferences || {};

  // Where the bag changes hands, BOTH WAYS.
  //
  // Dropoff is not asked for as a separate question. The spot they named for
  // pickup is where it comes back, stated plainly here so they can correct it
  // if they want somewhere else. A fourth setup question to collect something
  // that is the same answer 95% of the time is friction for nothing.
  const pickupSpot = (prefs.special_instructions || '').trim();
  const dropoffSpot = (prefs.dropoff_spot || '').trim();

  let handover;
  if (order.pickup_method === 'HAND_TO_DRIVER') {
    handover = `We'll knock when we arrive, and again when we bring it back.`;
  } else if (dropoffSpot && dropoffSpot !== pickupSpot) {
    handover =
      `Leave the bag ${pickupSpot ? `at the ${pickupSpot}` : 'outside your door'}, ` +
      `and we'll drop it back at the ${dropoffSpot}.`;
  } else if (pickupSpot) {
    handover = `Leave the bag at the ${pickupSpot}, and that's where we'll bring it back.`;
  } else {
    handover = `Leave the bag outside your door, and that's where we'll bring it back.`;
  }

  // Their wash, as they chose it. Drops out entirely if somehow unset.
  const wash = prefs.water_temp
    ? ` Washed ${String(prefs.water_temp).toLowerCase()} with ` +
      `${prefs.detergent === 'HYPOALLERGENIC' ? 'hypoallergenic' : 'standard'} detergent, ` +
      `${prefs.fabric_softener ? 'softener on' : 'no softener'}.`
    : '';

  // The price, and WHEN it gets taken. Stated as something that has not
  // happened yet, because it has not: no money moves until the bag is weighed.
  //
  // "once we weigh it" is the load-bearing half of this sentence. Without it a
  // customer reasonably reads "charged to your Visa" as "already charged", and
  // then reads the weigh text an hour later as a second bill.
  const card = billing.describeCard(customer);
  const minimum = billing.money(config.pricing.minimumCents);

  const money = card
    ? ` It's ${site.pricePerLb} a pound with a ${minimum} minimum. We weigh it after pickup, text you the total, and take it off your ${card} when we drop it back.`
    : ` It's ${site.pricePerLb} a pound with a ${minimum} minimum. We weigh it after pickup and text you the total before anything is taken.`;

  const address = customer.address_line1 ? ` at ${customer.address_line1}` : '';

  // "Today's rounds are done" is a fact about the van, not a negotiation.
  // `opener` lets the payment webhook lead with "Card saved" without naming
  // the card twice in one text, which a real customer got.
  const lead = rolled
    ? `${opener || 'Of course'}! Today's rounds are finished, so order #${order.order_number} is in for the earliest we can do:`
    : `${opener || 'Of course'}! Order #${order.order_number} is booked:`;

  // THE CONFIRMATION IS THE ONE COMPLETE DOCUMENT of the order: number, day
  // and window, address, handover, wash, money, turnaround. Every later text
  // in the order's life says only the one new thing that just happened - a
  // real thread said "24 hours" three times and the total four, and Neil
  // called it out. This is the only message allowed to say everything.
  return (
    `${lead} pickup ${whenLine(order)}${address}. ${handover}${wash}${money} ` +
    `Back with you the ${site.turnaround}.`
  );
}
function rescheduledMessage(order) {
  return `No problem at all, we've moved it to ${whenLine(order)}.`;
}

module.exports = {
  BERGEN_ZIPS,
  SERVICE_TZ,
  addDays,
  instantAt,
  endOfDeliveryDay,
  PICKUP_WINDOWS,
  windowFor,
  describeWindow,
  listWindows,
  windowsToday,
  bookPickup,
  whenLine,
  confirmationMessage,
  rescheduledMessage,
  dateProblem,
  timeProblem,
  hasAddress,
  hasPreferences,
  inServiceArea,
  alwaysAllowed,
  readableDate,
  readableTime,
  arrivalWindow,
  normaliseTime,
  today,
  nowInService,
  PICKUP_METHODS,
};
