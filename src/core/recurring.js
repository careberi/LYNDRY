'use strict';

const db = require('../db');
const booking = require('./booking');
const orders = require('./orders');
const subscription = require('./subscription');
const { sendAndLog } = require('./notify');

// ---------------------------------------------------------------------------
// Standing orders.
//
// "Same time every week." A customer says it once and the pickups happen
// without them asking again.
//
// A CUSTOMER MAY HAVE SEVERAL. Sheets and towels on Tuesday morning,
// everything else on Saturday lunchtime, is a real arrangement and used to be
// impossible - the schedule lived in four columns on the customer row, so
// there was exactly one and nowhere to put a second. It is a table now, one
// row per arrangement.
//
// NOTHING IN THE APP RUNS THESE. `npm run cron:recurring` does, once a day,
// from Railway's scheduler. Without it a customer can be told their weekly
// pickup is arranged and never be collected from.
// ---------------------------------------------------------------------------

// THE LABELS HERE ARE INTERNAL. What a customer reads comes from
// subscription.frequencyLabel() - "every 2 weeks", not "every other week" -
// because Neil fixed the customer-facing wording when subscriptions landed and
// two sets of words for one cadence is how they drift.
//
// MONTHLY IS EVERY FOUR WEEKS ON THE SAME WEEKDAY, not the same date each
// month. The whole model is weekday-based: `weekday` is a column, the van runs
// a weekday route, and the anchor arithmetic below counts in whole weeks. A
// date-based month would walk a customer's pickup through all seven weekdays
// over a year, which is not a round anybody drives. 13 pickups a year, not 12.
const CADENCES = Object.freeze({
  WEEKLY: { label: 'every week', days: 7 },
  FORTNIGHTLY: { label: 'every other week', days: 14 },
  MONTHLY: { label: 'every month', days: 28 },
});

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// How far ahead a pickup is booked. One day, so the warning text lands the
// evening before rather than a week out when they have forgotten agreeing.
const BOOK_AHEAD_DAYS = 1;

// --- Date arithmetic --------------------------------------------------------
//
// Done on the date string's own parts, never by parsing it into a Date and
// reading local fields: a date-only string parses as UTC midnight, which is
// the previous day in New Jersey and would move every schedule back a day.

function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// The next date on or after `from` that falls on `weekday`.
function nextWeekday(from, weekday) {
  let candidate = from;
  let guard = 0;
  while (weekdayOf(candidate) !== weekday && guard < 8) {
    candidate = addDays(candidate, 1);
    guard += 1;
  }
  return candidate;
}

// --- Reading them -----------------------------------------------------------

async function forCustomer(customerId, { includeEnded = false } = {}) {
  let query = db
    .from('recurring_schedules')
    .select('*')
    .eq('customer_id', customerId)
    .order('weekday', { ascending: true });

  if (!includeEnded) query = query.neq('status', 'ENDED');

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Does this customer have any standing order at all?
//
// Takes a customer whose schedules have already been loaded onto them, because
// the callers that ask this - the delivery text deciding whether to offer one,
// the AI's context - are already holding the customer and must not each fire
// their own query.
function isScheduled(customer) {
  return Boolean(customer && (customer.schedules || []).some((s) => s.status === 'ACTIVE'));
}

// "every week on Tuesday at 8am". One schedule, in the words a customer reads
// and the words Neil reads, so the two are never different sentences.
function describe(schedule) {
  if (!schedule) return null;

  const cadence = CADENCES[schedule.cadence];
  if (!cadence) return null;

  const when = schedule.time_of_day ? ` at ${booking.readableTime(schedule.time_of_day)}` : '';
  const paused = schedule.paused_until ? `, paused until ${booking.readableDate(schedule.paused_until)}` : '';

  return `${cadence.label} on ${DAY_NAMES[schedule.weekday]}${when}${paused}`;
}

// All of them, as one phrase: "every week on Tuesday and every week on Saturday".
function describeAll(schedules) {
  const active = (schedules || []).filter((s) => s.status === 'ACTIVE');
  if (!active.length) return null;
  return active.map(describe).filter(Boolean).join(', and ');
}

// When this schedule next comes route.
function nextDate(schedule, fromDate = booking.today()) {
  if (!schedule || schedule.status !== 'ACTIVE') return null;

  let candidate = nextWeekday(fromDate, schedule.weekday);

  // ANY CADENCE WIDER THAN A WEEK COUNTS FROM THE ANCHOR, and this used to be
  // written out for FORTNIGHTLY alone. Generalised when MONTHLY arrived rather
  // than copied, because two cadences doing the same arithmetic in two places
  // is two chances to get the off-week wrong.
  //
  // Reads identically for FORTNIGHTLY: weeks is 2, an odd gap is the off week,
  // and it is pushed on by one week.
  const weeks = (CADENCES[schedule.cadence] || CADENCES.WEEKLY).days / 7;

  if (weeks > 1) {
    const anchor = String(schedule.started_on || candidate).slice(0, 10);
    const anchorDay = nextWeekday(anchor, schedule.weekday);

    // Whole weeks between the anchor and the candidate.
    const weeksApart = Math.round(
      (Date.parse(`${candidate}T00:00:00Z`) - Date.parse(`${anchorDay}T00:00:00Z`)) / (7 * 86400000)
    );

    // Positive remainder, so a candidate BEFORE the anchor cannot come back
    // negative and push the pickup the wrong way. `%` keeps the sign of the
    // left operand in JavaScript, which is the bug this avoids.
    const off = ((weeksApart % weeks) + weeks) % weeks;

    if (off) candidate = addDays(candidate, (weeks - off) * 7);
  }

  // Paused, or skipping this one. Roll forward a cadence at a time until past
  // the pause, rather than cancelling the schedule outright.
  if (schedule.paused_until) {
    const step = CADENCES[schedule.cadence].days;
    let guard = 0;
    while (candidate <= String(schedule.paused_until).slice(0, 10) && guard < 60) {
      candidate = addDays(candidate, step);
      guard += 1;
    }
  }

  return candidate;
}

// --- The daily sweep --------------------------------------------------------

// Every schedule due on `date`, with the customer it belongs to.
async function dueOn(date) {
  const { data, error } = await db
    .from('recurring_schedules')
    .select('*, customers(*)')
    .eq('status', 'ACTIVE')
    .eq('weekday', weekdayOf(date));

  if (error) throw error;

  const due = [];

  for (const schedule of data || []) {
    if (!schedule.customers || schedule.customers.status !== 'ACTIVE') continue;
    if (nextDate(schedule) !== date) continue;

    // Never book on top of something ON THAT DAY. They may have arranged this
    // pickup themselves, the sweep may have already run, or two of their
    // schedules may fall on the same day, which is one pickup and not two.
    //
    // The day matters, not merely whether they have anything open. Checking for
    // any open pickup was right while a customer could only have one; now that
    // they can have several, it would skip a standing order for ever the moment
    // somebody booked a different day by hand.
    const existing = await orders.findAwaitingOn(schedule.customer_id, date);
    if (existing) continue;

    due.push(schedule);
  }

  return due;
}

// Book tomorrow's standing orders and warn everyone the evening before.
//
// Safe to run repeatedly: dueOn skips anybody who already has a pickup
// waiting, so a second run in the same day books nothing.
async function bookDue({ date } = {}) {
  const target = date || addDays(booking.today(), BOOK_AHEAD_DAYS);
  const schedules = await dueOn(target);

  const booked = [];
  const failed = [];

  for (const schedule of schedules) {
    const customer = schedule.customers;

    try {
      const result = await booking.bookPickup(customer, {
        pickupDate: target,
        // The time on the schedule itself, so Tuesday at 8am and Saturday at
        // noon are genuinely different arrangements rather than the same one
        // twice. Falls back to their usual time when the schedule has none.
        pickupTime:
          schedule.time_of_day || (customer.preferences && customer.preferences.usual_pickup_time),
        fromSchedule: true,
        // THE PLAN IT IS BOOKED UNDER, which is what makes it $1.80 a pound.
        //
        // Passed as the schedule's own id rather than looked up from the
        // customer, so a pickup is priced by the arrangement that actually
        // created it. A customer with two subscriptions gets each pickup priced
        // against its own, and an extra pickup they book by hand belongs to
        // neither and stays at the one-time rate.
        subscriptionId: schedule.id,
        // The door the arrangement was made at, carried onto the pickup. See
        // addSchedule() above.
        placedVia: schedule.placed_via || null,
      });

      if (!result.ok) {
        failed.push({ customer, reason: result.reason });
        console.warn(`Standing order for ${customer.phone} not booked: ${result.reason}`);
        continue;
      }

      // THE WARNING. Sent the day before, every time, with the way out in the
      // same message. Nobody discovers a charge after the fact.
      //
      // UNLESS THE CARD WOULD NOT TAKE THE HOLD, in which case the van is not
      // coming and this sentence would be a promise nothing can keep.
      // collectable() has already taken the stop off tomorrow's round, and a
      // reminder to put the bag out at eight in the morning for a van that will
      // not arrive is the exact failure the reminder gate exists to prevent -
      // one rule along.
      //
      // It still goes out as A text, because a standing-order customer who
      // hears nothing has no way to know anything is wrong.
      await sendAndLog(
        customer.phone,
        result.holdRefused
          ? booking.holdRefusedMessage(customer, result.order)
          : `Your usual pickup is tomorrow, ${booking.whenLine(result.order)}. ` +
            `Order #${result.order.order_number}. ` +
            `Reply SKIP if you don't need it this week and we'll cancel it, no charge.`,
        customer.id
      );

      // THAT MESSAGE IS THE DAY-BEFORE REMINDER, so it is recorded as one.
      // Without this the nightly pass would find the order unreminded an hour
      // later and send a second, near-identical text the same evening.
      await db
        .from('orders')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', result.order.id)
        .then(({ error }) => {
          if (error) console.error(`Could not record the reminder: ${error.message}`);
        });

      booked.push(result.order);
    } catch (err) {
      failed.push({ customer, reason: err.message });
      console.error(`Standing order for ${customer.phone} threw:`, err.message);
    }
  }

  console.log(`Standing orders for ${target}: ${booked.length} booked, ${failed.length} not.`);

  return { date: target, booked, failed };
}

// --- Changing them ----------------------------------------------------------

// Add a standing order, or move an existing one for the same day.
//
// Keyed on customer + weekday + cadence, so asking twice for "Tuesdays" edits
// the Tuesday one rather than creating a second that would quietly never fire
// - bookPickup refuses a second pickup on a day that already has one.
// `placedVia` is where the ARRANGEMENT was made, and every pickup it books
// inherits it. Migration 0092, and the reason is order #2060: it was set up in
// the website wizard, so the pickups it books are a web customer's pickups -
// but bookPickup() was never told, and orders.placed_via read null. Null then
// looks exactly like a thread booking, which is how a customer who had never
// used the text thread came to be sent a payment link in one.
async function addSchedule(customer, { cadence, weekday, timeOfDay = null, placedVia = null }) {
  if (!CADENCES[cadence]) throw new Error(`Unknown cadence: ${cadence}`);

  const day = Number(weekday);
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error(`Unknown weekday: ${weekday}`);

  const existing = (await forCustomer(customer.id, { includeEnded: true })).find(
    (s) => s.weekday === day && s.cadence === cadence
  );

  const patch = {
    time_of_day: timeOfDay ? booking.normaliseTime(timeOfDay) : null,
    paused_until: null,
    status: 'ACTIVE',
    updated_at: new Date().toISOString(),
  };

  // Only written when the caller says. Editing a schedule from somewhere else
  // must not quietly reassign where the arrangement was originally made.
  if (booking.DOORS[placedVia]) patch.placed_via = booking.DOORS[placedVia];

  if (existing) {
    const { data, error } = await db
      .from('recurring_schedules')
      .update(patch)
      .eq('id', existing.id)
      .select('*')
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await db
    .from('recurring_schedules')
    .insert({ customer_id: customer.id, cadence, weekday: day, ...patch })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// BOOK THE NEXT ONE, NOW, WITHOUT SAYING ANYTHING.
//
// Neil's ask: the moment a standing pickup is collected, the following one
// should appear in their upcoming orders. Before this the nightly pass booked
// it the evening before, so somebody on a weekly pickup saw an empty board for
// six days out of seven and had no way to tell the arrangement was still live.
//
// IT SENDS NOTHING. bookDue() texts as it books, because there it books the
// day before and the message says "tomorrow". This runs a week early, where
// that sentence would be a lie - so the customer hears about it in the ordinary
// evening reminder instead, which now carries the SKIP line for any pickup a
// schedule made.
//
// SAFE TO RUN TWICE. bookPickup() refuses a second pickup on a day that
// already has one, so this and the nightly pass cannot double-book between
// them - whichever gets there first wins and the other is a no-op.
// `after` is the date of the pickup that has just been collected. The next one
// is counted from the DAY AFTER it, not from today: a Thursday pickup collected
// on Thursday morning is still "today", so counting from today would land on the
// same Thursday and book a second pickup for a day the van has already been to.
// Nothing refuses that either, because the first one is no longer awaiting
// collection - it is in the van.
async function bookNext(customer, { after = null } = {}) {
  const schedules = await forCustomer(customer.id);
  const booked = [];
  const from = after ? addDays(after, 1) : booking.today();

  for (const schedule of schedules) {
    const date = nextDate(schedule, from);
    if (!date) continue;

    const result = await booking.bookPickup(customer, {
      pickupDate: date,
      pickupTime:
        schedule.time_of_day || (customer.preferences && customer.preferences.usual_pickup_time),
      fromSchedule: true,
      placedVia: schedule.placed_via || null,
    });

    if (result.ok) booked.push(result.order);
  }

  return booked;
}

// End one schedule, or all of them when no id is given - "stop the weekly
// pickups" from somebody with two means both.
async function stop(customer, scheduleId = null) {
  let query = db
    .from('recurring_schedules')
    .update({ status: 'ENDED', updated_at: new Date().toISOString() })
    .eq('customer_id', customer.id)
    .neq('status', 'ENDED');

  if (scheduleId) query = query.eq('id', scheduleId);

  const { data, error } = await query.select('*');
  if (error) throw error;
  return data || [];
}

// Skip until a date. "Skip this week" is a pause until the next occurrence.
async function pauseUntil(customer, date, scheduleId = null) {
  let query = db
    .from('recurring_schedules')
    .update({ paused_until: date, updated_at: new Date().toISOString() })
    .eq('customer_id', customer.id)
    .eq('status', 'ACTIVE');

  if (scheduleId) query = query.eq('id', scheduleId);

  const { data, error } = await query.select('*');
  if (error) throw error;
  return data || [];
}


// WHICH DAY A REPEAT WOULD FIRST LAND ON, WITHOUT CREATING ANYTHING.
//
// nextDate() is pure and reads only the fields set here, which is what makes it
// safe to ask about a schedule that does not exist yet.
//
// FORTNIGHTLY IS ANCHORED ON TODAY, which is right for a new arrangement and
// approximate for a weekday this customer already had a schedule for - see
// addSchedule(), which reuses that row and keeps its original started_on. The
// booked pickup is whatever this returns; the arrangement then continues from
// its own anchor. Worth knowing, not worth a second copy of the anchoring rule.
function firstRepeatDate({ cadence, weekdays = [], from = booking.today() }) {
  const days = (weekdays || [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);

  if (!CADENCES[cadence] || !days.length) return null;

  const dates = days
    .map((weekday) => nextDate({ status: 'ACTIVE', cadence, weekday, started_on: from }, from))
    .filter(Boolean)
    .sort();

  return dates[0] || null;
}

// BOOK THE PICKUP FIRST, THEN SET UP THE REPEAT. ONE IMPLEMENTATION, TWO DOORS.
//
// Neil, 14 September: do not create a standing schedule before the pickup
// exists. Both doors used to do the opposite - create the schedule, read the
// first date off it, then book - because the schedule is what decides the day.
// firstRepeatDate() answers that question without writing anything, so the
// order can come first.
//
// WHAT THAT REMOVES IS THE ENTIRE UNDO PATH, and the undo was the dangerous
// part. The wizard called recurring.stop(customer) when a booking was refused,
// which ENDS EVERY schedule the customer has - so a refused Friday checkout
// would have cancelled the Tuesday pickup they had had for a month. Deleting
// by id instead was not safe either: addSchedule() REUSES an existing row for
// the same weekday and cadence, including an ended one, so the id handed back
// may be a row that predates this booking entirely.
//
// Nothing is created before the booking, so there is nothing to undo after it.
//
// A SCHEDULE THAT FAILS AFTER A SUCCESSFUL BOOKING LEAVES THE ORDER STANDING.
// The pickup is real and the customer has been told about it; throwing it away
// because the repeat did not save would be the worse of the two failures. It
// says so in the result and shouts in the log.
async function bookAndSchedule(customer, { pickupDate, pickupTime, notes, cadence, weekdays }) {
  const days = (weekdays || [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);

  const repeat = Boolean(CADENCES[cadence] && days.length);
  const firstDate = repeat ? firstRepeatDate({ cadence, weekdays: days }) : pickupDate;

  const result = await booking.bookPickup(customer, {
    pickupDate: firstDate || '',
    pickupTime: pickupTime || '',
    // The date came from the arrangement rather than from a day they picked,
    // which is what lets "stop repeating" call this pickup off with the rest.
    fromSchedule: repeat,
    notes: notes || null,
  });

  // NOTHING WAS CREATED, so a refusal is just a refusal.
  if (!result.ok) return result;

  if (!repeat) return result;

  const schedules = [];
  try {
    for (const weekday of days) {
      schedules.push(
        await addSchedule(customer, {
          cadence,
          weekday,
          timeOfDay: pickupTime || null,
          // The wizard is the web door and the schedule remembers it, so every
          // pickup this arrangement books is known to be a web customer's.
          placedVia: booking.DOORS.WEB,
        })
      );
    }
  } catch (err) {
    console.error(
      `Booked #${result.order.order_number} but could not set up the standing order: ${err.message}`
    );
    // AND IT STAYS A ONE-TIME PICKUP, which is the honest outcome rather than a
    // consolation. The subscription does not exist, so there is no plan for
    // this pickup to belong to and no reason it should be $1.80. The caller is
    // told `scheduleFailed` and says so on the screen.
    return { ...result, scheduleFailed: true, schedules };
  }

  // THE FIRST PICKUP JOINS THE SUBSCRIPTION IT JUST CREATED.
  //
  // Neil: the subscription starts with the first scheduled order and the
  // customer gets $1.80 immediately. That pickup was written a few lines above,
  // before any schedule existed - the order has to come first, because nothing
  // created beforehand is safe to undo when a booking is refused, which is what
  // the long note above this function is about.
  //
  // So it is stamped afterwards rather than passed in, and the rate is
  // rewritten with it. This is the ONE place a rate is corrected after the
  // fact, and it is safe for the reason the rest of the file relies on: nothing
  // has been charged, and nobody has been told anything. bookPickup() does not
  // text - every caller builds the confirmation itself - so the message the
  // customer receives is written from the order AFTER this line.
  //
  // The in-memory copy is updated too. Without it the confirmation would read
  // the $2.00 the row no longer holds, which is exactly the class of bug this
  // codebase keeps finding: two copies of one fact, and the one that reaches a
  // phone is the stale one.
  const plan = schedules[0];

  if (plan && plan.id) {
    const rate = subscription.subscriptionCents();

    const { error } = await db
      .from('orders')
      .update({ subscription_id: plan.id, price_per_lb_cents: rate })
      .eq('id', result.order.id);

    if (error) {
      // The pickup and the plan both exist and only the link failed, so the
      // customer has a subscription whose first pickup is priced as a one-time.
      // Loud, and left alone rather than half-fixed.
      console.error(
        `Booked #${result.order.order_number} on a new subscription but could not price it as one: ${error.message}`
      );
    } else {
      result.order.subscription_id = plan.id;
      result.order.price_per_lb_cents = rate;
    }
  }

  return { ...result, schedules };
}

module.exports = {
  CADENCES,
  DAY_NAMES,
  BOOK_AHEAD_DAYS,
  weekdayOf,
  addDays,
  nextWeekday,
  forCustomer,
  isScheduled,
  describe,
  describeAll,
  nextDate,
  dueOn,
  bookDue,
  addSchedule,
  firstRepeatDate,
  bookAndSchedule,
  bookNext,
  stop,
  pauseUntil,
};
