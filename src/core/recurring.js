'use strict';

const db = require('../db');
const booking = require('./booking');
const { sendAndLog } = require('./notify');
const { site } = require('../web/site');

// ---------------------------------------------------------------------------
// Standing orders: come every week, or every other week.
//
// The whole feature is: work out whose pickup falls tomorrow, book it, and
// tell them the day before so nobody is charged without warning. That last
// part is not politeness. A $25 charge appearing with no heads-up is the
// single most reliable way to earn a chargeback.
//
// Deliberately NOT a subscription. Nothing is charged for having a schedule,
// and every pickup it creates is an ordinary order priced by weight, with its
// own confirmation, its own window and its own minimum. What it removes is the
// asking, not the pricing.
//
// There is no scheduler in this codebase and this does not add one. A single
// endpoint runs the sweep below once a day, and it is safe to run twice, ten
// times, or by hand: it books nothing that already exists.
// ---------------------------------------------------------------------------

const CADENCES = Object.freeze({
  WEEKLY: { label: 'every week', days: 7 },
  FORTNIGHTLY: { label: 'every other week', days: 14 },
});

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// How far ahead a pickup is booked. One day, so the warning text lands the
// evening before rather than a week out when they have forgotten agreeing.
const BOOK_AHEAD_DAYS = 1;

function isScheduled(customer) {
  return Boolean(customer.recurring_cadence && customer.recurring_weekday != null);
}

// "every week on Tuesday". Used in confirmations and on the ops screens, so
// the words a customer reads and the words Neil reads are the same words.
function describe(customer) {
  if (!isScheduled(customer)) return null;

  const cadence = CADENCES[customer.recurring_cadence];
  if (!cadence) return null;

  return `${cadence.label} on ${DAY_NAMES[customer.recurring_weekday]}`;
}

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

// The first date on or after `from` that falls on the wanted weekday.
function nextWeekday(from, weekday) {
  const gap = (weekday - weekdayOf(from) + 7) % 7;
  return addDays(from, gap);
}

// When this customer's next pickup should be, counting from today.
//
// FORTNIGHTLY counts from the day the schedule started, so "every other
// Tuesday" stays on the same fortnight rather than drifting whenever a week
// is skipped.
function nextDate(customer, fromDate = booking.today()) {
  if (!isScheduled(customer)) return null;

  let candidate = nextWeekday(fromDate, customer.recurring_weekday);

  if (customer.recurring_cadence === 'FORTNIGHTLY') {
    const anchor = customer.recurring_started_at
      ? String(customer.recurring_started_at).slice(0, 10)
      : candidate;

    const anchorDay = nextWeekday(anchor, customer.recurring_weekday);

    // Whole weeks between the anchor and the candidate. Odd means this is the
    // off week, so push a week later.
    const weeksApart = Math.round(
      (Date.parse(`${candidate}T00:00:00Z`) - Date.parse(`${anchorDay}T00:00:00Z`)) /
        (7 * 86400000)
    );

    if (Math.abs(weeksApart % 2) === 1) candidate = addDays(candidate, 7);
  }

  // Paused, or skipping this one. Roll forward a cadence at a time until past
  // the pause, rather than cancelling the schedule outright.
  if (customer.recurring_paused_until) {
    const step = CADENCES[customer.recurring_cadence].days;
    let guard = 0;
    while (candidate <= customer.recurring_paused_until && guard < 60) {
      candidate = addDays(candidate, step);
      guard += 1;
    }
  }

  return candidate;
}

// --- The daily sweep --------------------------------------------------------

// Everyone with a standing order due on `date` who has nothing booked already.
async function dueOn(date) {
  const { data, error } = await db
    .from('customers')
    .select('*')
    .not('recurring_cadence', 'is', null)
    .eq('status', 'ACTIVE');

  if (error) throw error;

  const due = [];

  for (const customer of data || []) {
    if (nextDate(customer) !== date) continue;

    // Never book on top of something. They may have arranged this week's
    // pickup themselves, or the sweep may have already run today.
    const existing = await require('./orders').findAwaitingCollection(customer.id);
    if (existing) continue;

    due.push(customer);
  }

  return due;
}

// Book tomorrow's standing orders and warn everyone the evening before.
//
// Safe to run repeatedly: dueOn skips anybody who already has a pickup
// waiting, so a second run in the same day books nothing.
async function bookDue({ date } = {}) {
  const target = date || addDays(booking.today(), BOOK_AHEAD_DAYS);
  const customers = await dueOn(target);

  const booked = [];
  const failed = [];

  for (const customer of customers) {
    try {
      const result = await booking.bookPickup(customer, {
        pickupDate: target,
        // Their usual time, so a standing order lands in the window they are
        // used to rather than the first one of the day.
        pickupTime: customer.preferences && customer.preferences.usual_pickup_time,
        fromSchedule: true,
      });

      if (!result.ok) {
        failed.push({ customer, reason: result.reason });
        console.warn(`Standing order for ${customer.phone} not booked: ${result.reason}`);
        continue;
      }

      // THE WARNING. Sent the day before, every time, with the way out in the
      // same message. Nobody discovers a charge after the fact.
      await sendAndLog(
        customer.phone,
        `Your usual pickup is tomorrow, ${booking.whenLine(result.order)}. ` +
          `Order #${result.order.order_number}. ` +
          `Reply SKIP if you don't need it this week and we'll cancel it, no charge.`,
        customer.id
      );

      booked.push(result.order);
    } catch (err) {
      failed.push({ customer, reason: err.message });
      console.error(`Standing order for ${customer.phone} threw:`, err.message);
    }
  }

  console.log(`Standing orders for ${target}: ${booked.length} booked, ${failed.length} not.`);

  return { date: target, booked, failed };
}

// --- Changing a schedule ----------------------------------------------------

async function setSchedule(customer, { cadence, weekday }) {
  if (!CADENCES[cadence]) throw new Error(`Unknown cadence: ${cadence}`);

  const { data, error } = await db
    .from('customers')
    .update({
      recurring_cadence: cadence,
      recurring_weekday: weekday,
      // The anchor a fortnightly schedule counts from. Only set when there was
      // no schedule before, so changing the day does not shift the fortnight.
      recurring_started_at: customer.recurring_started_at || new Date().toISOString(),
      recurring_paused_until: null,
    })
    .eq('id', customer.id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function stop(customer) {
  const { data, error } = await db
    .from('customers')
    .update({
      recurring_cadence: null,
      recurring_weekday: null,
      recurring_started_at: null,
      recurring_paused_until: null,
    })
    .eq('id', customer.id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

// Skip until a date. "Skip this week" is a pause until the next occurrence.
async function pauseUntil(customer, date) {
  const { data, error } = await db
    .from('customers')
    .update({ recurring_paused_until: date })
    .eq('id', customer.id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  CADENCES,
  DAY_NAMES,
  isScheduled,
  describe,
  nextDate,
  nextWeekday,
  addDays,
  weekdayOf,
  dueOn,
  bookDue,
  setSchedule,
  stop,
  pauseUntil,
};
