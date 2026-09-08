'use strict';

// The weekday they said against the date they said. See weekdayMismatch() in
// src/core/booking.js, and the customer who asked for "Mon sept 18th" and was
// booked for a Friday.
//
// booking.js requires the database module, which needs the .env to exist -
// nothing here reads or writes anything, it just has to load. Run with
// `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');

const booking = require('../src/core/booking');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// A date well in the future, so "has already passed" can never interfere, and
// its own weekday worked out here rather than typed in - the test must not be
// able to be wrong about what day the 18th is.
const iso = '2031-09-18';
const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
const isDay = DAYS[dow];
const isNotDay = DAYS[(dow + 3) % 7];

test('a weekday that matches the date is fine', () => {
  assert.equal(booking.weekdayMismatch(iso, isDay), null);
  assert.equal(booking.weekdayMismatch(iso, isDay.slice(0, 3).toLowerCase()), null);
});

test('a weekday that contradicts the date is a question naming both days', () => {
  const q = booking.weekdayMismatch(iso, isNotDay);
  assert.ok(q, 'expected a question');
  assert.match(q, new RegExp(`is a ${isDay}, not a ${isNotDay}`));
  assert.match(q, /Did you mean /);
  assert.match(q, new RegExp(`${isDay} 18 Sep`), 'offers the date as said');
  assert.match(q, new RegExp(`${isNotDay} \\d{1,2} Sep`), 'offers the nearest date that IS the day said');
});

test('the real case: Mon sept 18th, when the 18th is a Friday', () => {
  // 2026-09-18 is a Friday. In the past by the time anybody reruns this, so
  // only the shape of the question is asserted, not the alternative date.
  const q = booking.weekdayMismatch('2026-09-18', 'Mon');
  assert.ok(q);
  assert.match(q, /The 18th is a Friday, not a Monday/);
});

test('sloppy weekday spellings are read', () => {
  const tue = '2031-09-16'; // a Tuesday
  assert.equal(new Date(`${tue}T12:00:00Z`).getUTCDay(), 2);
  for (const said of ['tues', 'Tue', 'TUESDAY', 'tuesday!', ' tue ']) {
    assert.equal(booking.weekdayMismatch(tue, said), null, said);
  }
  for (const said of ['thurs', 'Thur', 'weds']) {
    assert.ok(booking.weekdayMismatch(tue, said), said);
  }
});

test('no weekday, or one that cannot be read, is not a mismatch', () => {
  assert.equal(booking.weekdayMismatch(iso, undefined), null);
  assert.equal(booking.weekdayMismatch(iso, ''), null);
  assert.equal(booking.weekdayMismatch(iso, 'tomorrow'), null);
  assert.equal(booking.weekdayMismatch(iso, 'next week'), null);
});

test('a date that is not a date is left to dateProblem()', () => {
  assert.equal(booking.weekdayMismatch('sometime', 'Monday'), null);
  assert.equal(booking.weekdayMismatch(null, 'Monday'), null);
});
