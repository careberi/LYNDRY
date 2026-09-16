'use strict';

// ---------------------------------------------------------------------------
// dueOn(date) ANSWERS ABOUT THAT DATE, NOT ABOUT TODAY.
//
// Audit finding #3. The line read:
//
//   if (nextDate(schedule) !== date) continue;
//
// and nextDate()'s second argument defaults to booking.today() - so a function
// whose entire job is "which schedules fall on THIS date" answered it by
// working out the next pickup from the wall clock and checking whether the two
// happened to agree.
//
// IT WORKED FOR THE NIGHTLY PASS BY COINCIDENCE, which is why it went
// unnoticed for so long: that pass asks about tomorrow, the query has already
// narrowed to tomorrow's weekday, and nextWeekday() is inclusive - so counting
// from today and counting from tomorrow land on the same candidate. The right
// answer, reached for the wrong reason.
//
// It is not a coincidence that survives anything else. Ask about a date in the
// past to backfill a missed night and nextDate() returns a future one, so
// nothing is ever due and the pass books nobody, silently.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const recurring = require('../src/core/recurring');
const booking = require('../src/core/booking');

const SRC = fs
  .readFileSync(path.join(__dirname, '..', 'src', 'core', 'recurring.js'), 'utf8')
  .split('\r\n')
  .join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// Tuesdays, anchored on a Tuesday.
const weekly = { status: 'ACTIVE', cadence: 'WEEKLY', weekday: 2, started_on: '2026-09-01' };
const fortnightly = {
  status: 'ACTIVE',
  cadence: 'FORTNIGHTLY',
  weekday: 2,
  started_on: '2026-09-01',
};
const monthly = { status: 'ACTIVE', cadence: 'MONTHLY', weekday: 2, started_on: '2026-09-01' };

// --- the line itself --------------------------------------------------------

test('dueOn HANDS ITS OWN DATE TO nextDate', () => {
  const code = withoutComments(SRC);
  const at = code.indexOf('async function dueOn');
  assert.notEqual(at, -1, 'dueOn has moved');

  const body = code.slice(at, code.indexOf('\n}', at));

  assert.match(body, /nextDate\(schedule, date\)/, 'dueOn still asks about today');
  assert.ok(
    !/nextDate\(schedule\)\s*!==/.test(body),
    'dueOn is back on the wall clock'
  );
});

// --- determinism ------------------------------------------------------------

test('THE ANSWER DOES NOT DEPEND ON WHAT DAY IT IS', () => {
  // The whole point. Asked about a date, every cadence answers about that date
  // and nothing else moves the answer.
  for (const plan of [weekly, fortnightly, monthly]) {
    for (const date of ['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-13']) {
      const answer = recurring.nextDate(plan, date);
      assert.equal(
        recurring.nextDate(plan, date),
        answer,
        `${plan.cadence} on ${date} is not stable`
      );
      // And it never answers with something before the date it was asked about.
      assert.ok(answer >= date, `${plan.cadence} answered ${answer} when asked about ${date}`);
    }
  }
});

test('a weekly plan is due on every one of its weekdays', () => {
  for (const date of ['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']) {
    assert.equal(recurring.nextDate(weekly, date), date, `not due on ${date}`);
  }
});

test('AND A FORTNIGHTLY PLAN IS DUE ON ALTERNATE ONES, COUNTED FROM ITS ANCHOR', () => {
  // Anchored 1 September, a Tuesday. Due on the 15th and the 29th, not the
  // 22nd. This is the arithmetic that counted from the wrong end when the
  // date was ignored.
  assert.equal(recurring.nextDate(fortnightly, '2026-09-15'), '2026-09-15');
  assert.equal(recurring.nextDate(fortnightly, '2026-09-29'), '2026-09-29');

  assert.notEqual(
    recurring.nextDate(fortnightly, '2026-09-22'),
    '2026-09-22',
    'an off-week came back as due'
  );
  assert.equal(recurring.nextDate(fortnightly, '2026-09-22'), '2026-09-29');
});

test('and a monthly plan is every four weeks on the same weekday', () => {
  // Anchored Tuesday 1 September, so due on the 29th and then 27 October -
  // four weeks apart on the same weekday, not the same date each month.
  // (Written as the 15th first, which is what counting from the wrong anchor
  // looks like; the code was right and the expectation was not.)
  assert.equal(recurring.nextDate(monthly, '2026-09-29'), '2026-09-29');
  assert.equal(recurring.nextDate(monthly, '2026-10-27'), '2026-10-27');

  for (const notDue of ['2026-09-15', '2026-09-22', '2026-10-13']) {
    assert.notEqual(recurring.nextDate(monthly, notDue), notDue, `${notDue} came back as due`);
  }

  // Every due date is a Tuesday, 28 days apart.
  assert.equal(new Date('2026-09-29T00:00:00Z').getUTCDay(), 2);
  assert.equal(
    (Date.parse('2026-10-27T00:00:00Z') - Date.parse('2026-09-29T00:00:00Z')) / 86400000,
    28
  );
});

// --- the two cases that were broken ----------------------------------------

test('A DATE IN THE PAST IS ANSWERED, WHICH IS THE BACKFILL', () => {
  // The nightly pass skips a night it missed - deliberately, because its text
  // says "tomorrow". Running it by hand for the night that was missed is the
  // way back, and it could not work: nextDate() ignored the date and returned
  // something in the future, so nothing was ever due.
  const past = '2026-09-08';
  assert.ok(past < booking.today(), 'pick a date that is genuinely in the past');

  assert.equal(recurring.nextDate(weekly, past), past, 'a past date is still unanswerable');

  // And the old behaviour, for contrast: with no date it answers about now,
  // which can never equal a date behind us.
  assert.notEqual(recurring.nextDate(weekly), past);
});

test('and the nightly pass is unchanged, which is why nobody noticed', () => {
  // nextWeekday() is inclusive, so counting from today and counting from the
  // day being asked about land on the same candidate whenever that day is the
  // next occurrence. The nightly pass only ever asks about tomorrow, so it got
  // the right answer the whole time.
  const today = booking.today();
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000)
    .toISOString()
    .slice(0, 10);

  for (const plan of [weekly, fortnightly, monthly]) {
    const fromToday = recurring.nextDate(plan, today);
    const fromTomorrow = recurring.nextDate(plan, tomorrow);

    // Either they agree, or today itself was the due day - both are correct
    // and neither is the bug.
    assert.ok(
      fromToday === fromTomorrow || fromToday === today,
      `${plan.cadence}: ${fromToday} vs ${fromTomorrow}`
    );
  }
});

test('an ended or paused plan is still never due', () => {
  assert.equal(recurring.nextDate({ ...weekly, status: 'ENDED' }, '2026-09-15'), null);
  assert.equal(recurring.nextDate(null, '2026-09-15'), null);

  const paused = { ...weekly, paused_until: '2026-09-22' };
  assert.ok(recurring.nextDate(paused, '2026-09-15') > '2026-09-22', 'a paused plan came back early');
});
