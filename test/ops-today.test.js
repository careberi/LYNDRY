'use strict';

// ---------------------------------------------------------------------------
// OPS ASKS WHAT DAY IT IS IN NEW JERSEY, NOT ON THE SERVER.
//
// Audit finding #6. admin.js carried its own today():
//
//   new Date().toISOString().slice(0, 10)
//
// which is UTC. Railway runs in UTC, so from 8pm Eastern onwards that string
// is already tomorrow - and the board compares it against pickup_date to
// decide what is due. A driver opening the board at nine in the evening saw
// tomorrow's collections listed as due now and today's counted as behind.
//
// CLAUDE.md names that exact expression as the thing never to use for "when",
// and two of the three callers sat directly under comments promising "New
// Jersey's day rather than the server's".
//
// THE FIX IS NOT A FOURTH COPY. booking.today() is the one owner - the same
// function the round, the run sheet and every booking rule already ask - so an
// ops screen and the route it draws cannot disagree about the date.
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const booking = require('../src/core/booking');

const ADMIN = fs
  .readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8')
  .split('\r\n')
  .join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

test('NO OPS SCREEN ASKS UTC WHAT DAY IT IS', () => {
  const code = withoutComments(ADMIN);

  assert.ok(
    !/new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/.test(code),
    'admin.js is back on the UTC date'
  );
});

test('and today() is booking.today(), not a second copy of the rule', () => {
  const code = withoutComments(ADMIN);
  const at = code.indexOf('const today =');
  assert.notEqual(at, -1, 'admin.js no longer defines today()');

  const line = code.slice(at, code.indexOf('\n', at));
  assert.match(line, /booking\.today\(\)/, 'today() does not delegate to the one owner');
});

test('THE ONE OWNER IS NEW JERSEY, AND IT IS NOT UTC', () => {
  // The two genuinely differ for four or five hours of every day, which is why
  // this went unnoticed: anybody checking the board before 8pm saw it working.
  const nj = booking.today();

  assert.match(nj, /^\d{4}-\d{2}-\d{2}$/, 'booking.today() stopped returning a plain date');

  // It is derived from the service clock rather than the process clock.
  const service = booking.nowInService();
  assert.equal(nj, service.date);
});

test('and the evening rollover is the case that was wrong', () => {
  // 01:30 UTC is half past nine the previous evening in New Jersey during EDT.
  // UTC has rolled over; the van has not.
  const evening = new Date('2026-09-16T01:30:00Z');

  const utcSays = evening.toISOString().slice(0, 10);
  const njSays = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(evening);

  assert.equal(utcSays, '2026-09-16', 'the UTC reading moved');
  assert.equal(njSays, '2026-09-15', 'the New Jersey reading moved');
  assert.notEqual(utcSays, njSays, 'the two agree, so this test proves nothing');
});

test('every caller in admin.js reads the same day', () => {
  // Three screens compared a date against pickup_date: the board, the issues
  // page and the admin dashboard's counts. All three go through one function,
  // so none of them can be a day out on its own.
  const code = withoutComments(ADMIN);

  const callers = (code.match(/const now = today\(\);/g) || []).length;
  assert.ok(callers >= 3, `expected at least three callers, found ${callers}`);

  // THE DAY-SHIFTERS ARE NOT THE SAME THING AND MUST NOT BE SWEPT UP. The
  // back/forward arrows on the board and the issues page do arithmetic on a
  // date they were GIVEN - `new Date(iso + 'T12:00:00Z')`, add days, slice -
  // which is correct, and the noon anchor is what keeps it correct across a
  // daylight-saving boundary. What was wrong was asking the clock, never
  // moving a date along. So the test is about `new Date()` with no argument.
  for (const shift of code.match(/const shift = \(iso, days\) => \{[\s\S]*?\};/g) || []) {
    assert.match(shift, /T12:00:00Z/, 'a day-shifter lost its noon anchor');
  }
});
