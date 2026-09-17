'use strict';

// ---------------------------------------------------------------------------
// EVERY THREE WEEKS IS A CADENCE.
//
// Sahrish Khan, 17 September: "Can we do a monthly subscription starting on
// Monday 10/5 and then every 3 weeks?"
//
// Lyn answered correctly and the answer was no: "The only frequencies we can do
// are every week, every 2 weeks, or once a month, so every 3 weeks is not one I
// can set up." She settled for monthly, which is not what she asked for, and
// Neil then confirmed every 3 weeks to her by hand - a promise the system had
// no way to keep.
//
// THE GAP WAS ONE ROW OF A CHECK CONSTRAINT AND ONE ENTRY IN A LIST. The date
// arithmetic already counted in whole weeks off the anchor, having been
// generalised away from a hardcoded fortnight when MONTHLY arrived. These tests
// pin the arithmetic against real dates, and pin that the four places which
// have to agree about what a cadence is still do.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const recurring = require('../src/core/recurring');
const subscription = require('../src/core/subscription');

// Sahrish's own arrangement: Mondays, from Monday 5 October.
const HERS = Object.freeze({
  status: 'ACTIVE',
  cadence: 'EVERY_3_WEEKS',
  weekday: 1,
  started_on: '2026-10-05',
  time_of_day: '08:00',
  paused_until: null,
});

// --- the interval ------------------------------------------------------------

test('every 3 weeks is 21 days', () => {
  assert.equal(recurring.CADENCES.EVERY_3_WEEKS.days, 21);
});

test('and it sits between fortnightly and monthly, shortest to longest', () => {
  // The website draws its radio buttons in this order. A frequency picker that
  // does not run shortest to longest reads as a mistake.
  const days = subscription.FREQUENCIES.map((f) => recurring.CADENCES[f.cadence].days);
  assert.deepEqual(days, [7, 14, 21, 28]);
});

test('MONTHLY is still 28 days, which this did not change', () => {
  assert.equal(recurring.CADENCES.MONTHLY.days, 28);
});

// --- the dates she will actually be collected on -----------------------------

test('HER FIRST PICKUP IS MONDAY 5 OCTOBER, the day she asked for', () => {
  // Asked from the day she booked, which is what the nightly pass does.
  assert.equal(recurring.nextDate(HERS, '2026-09-17'), '2026-10-05');
});

test('and then every third Monday after it', () => {
  const dates = [];
  let from = '2026-10-05';

  for (let i = 0; i < 4; i += 1) {
    const next = recurring.nextDate(HERS, from);
    dates.push(next);
    from = recurring.addDays(next, 1);
  }

  assert.deepEqual(dates, ['2026-10-05', '2026-10-26', '2026-11-16', '2026-12-07']);
});

test('every one of those is a Monday', () => {
  for (const date of ['2026-10-05', '2026-10-26', '2026-11-16', '2026-12-07']) {
    assert.equal(recurring.weekdayOf(date), 1, `${date} is not a Monday`);
  }
});

test('THE MONDAYS IN BETWEEN ARE NOT HERS', () => {
  // The off-week test is the whole cadence. 12 and 19 October are Mondays and
  // must roll forward to the 26th rather than being collected.
  assert.equal(recurring.nextDate(HERS, '2026-10-12'), '2026-10-26');
  assert.equal(recurring.nextDate(HERS, '2026-10-19'), '2026-10-26');
});

test('and a date BEFORE the anchor does not push the pickup backwards', () => {
  // `%` keeps the sign of the left operand in JavaScript, so a candidate
  // earlier than the anchor can come back negative and move the pickup the
  // wrong way. It is the bug that would have collected her in September.
  for (const from of ['2026-09-17', '2026-09-21', '2026-09-28']) {
    const next = recurring.nextDate(HERS, from);
    assert.ok(next >= '2026-10-05', `${from} gave ${next}, which is before she starts`);
  }
});

test('a fortnightly Saturday is unaffected by any of this', () => {
  // Shamar Allen's arrangement, which shares the same arithmetic.
  const his = { ...HERS, cadence: 'FORTNIGHTLY', weekday: 6, started_on: '2026-09-12' };

  assert.equal(recurring.nextDate(his, '2026-09-13'), '2026-09-26');
  assert.equal(recurring.nextDate(his, '2026-09-27'), '2026-10-10');
});

// --- what a customer is told -------------------------------------------------

test('the customer-facing words are "every 3 weeks"', () => {
  assert.equal(subscription.frequencyLabel('EVERY_3_WEEKS'), 'every 3 weeks');
});

test('and the booking code will accept it', () => {
  assert.ok(subscription.isFrequency('EVERY_3_WEEKS'));
});

test('IT IS NOT CALLED TRIWEEKLY ANYWHERE, because that means two things', () => {
  // "Triweekly" is both three times a week and once every three weeks, and this
  // value ends up in a sentence somebody reads on a phone.
  for (const file of ['src/core/recurring.js', 'src/core/subscription.js', 'src/core/brain.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(!/triweekly/i.test(src), `${file} says triweekly`);
  }
});

// --- the three places that have to agree -------------------------------------

test('THE AI CAN BOOK EVERY CADENCE THE WEBSITE OFFERS', () => {
  // Lyn refused Sahrish off this enum, correctly, because the list was short.
  // A cadence on the website that the AI cannot set up is the same failure
  // pointing the other way.
  const brain = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'brain.js'), 'utf8');
  const at = brain.indexOf('        frequency: {');
  assert.ok(at > 0, 'the frequency tool parameter has moved');

  const block = brain.slice(at, brain.indexOf('},', at));

  for (const { cadence } of subscription.FREQUENCIES) {
    assert.ok(block.includes(`'${cadence}'`), `the AI cannot book ${cadence}`);
  }
});

test('AND THE DATABASE WILL ACCEPT EVERY ONE OF THEM', () => {
  // The constraint is the only thing in the stack that can refuse a cadence
  // outright, and it is the thing that actually refused this one.
  const sql = fs
    .readdirSync(path.join(__dirname, '..', 'supabase', 'migrations'))
    .filter((f) => /every_three_weeks/.test(f))
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', f), 'utf8'))
    .join('\n');

  assert.ok(sql, 'the cadence migration is missing');

  const check = sql.slice(sql.indexOf('add constraint recurring_cadence_check'));

  for (const { cadence } of subscription.FREQUENCIES) {
    assert.ok(check.includes(`'${cadence}'`), `the database would refuse ${cadence}`);
  }
});

test('and every cadence the website offers has an interval behind it', () => {
  // A frequency with no entry in recurring.CADENCES falls back to WEEKLY in
  // nextDate(), which would collect somebody every seven days without
  // anything anywhere saying so.
  for (const { cadence } of subscription.FREQUENCIES) {
    assert.ok(recurring.CADENCES[cadence], `${cadence} has no interval`);
    assert.equal(recurring.CADENCES[cadence].days % 7, 0, `${cadence} is not whole weeks`);
  }
});
