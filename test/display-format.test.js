'use strict';

// ---------------------------------------------------------------------------
// MM/DD/YYYY AND XXX-XXX-XXXX, EVERYWHERE A PERSON SEES ONE.
//
// Neil's decision lock, 14 September. Display only: nothing stored moves, and
// nothing handed to a carrier or to Stripe moves either.
//
// Two halves are pinned here, and the second is the one that matters:
//
//   the shapes      every case from the spec, including the awkward ones
//   ONE OWNER       there were three phone formatters and four date ones, and
//                   the whole point of the lock is that a screen cannot show
//                   two shapes of the same fact
//
// AND ONE DELIBERATE EXCEPTION. A text message is prose, not a record: a
// customer reads "Wednesday 16 Sep" in a sentence on their phone, and
// "09/16/2026" in the middle of one reads as a form. booking.readableDate() is
// left exactly as it was, and a test below holds it there.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const format = require('../src/core/format');
const booking = require('../src/core/booking');
const { formatPhone, normalisePhone } = require('../src/core/phone');
const { site } = require('../src/web/site');

const SRC = (...bits) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8')
    .split('\r\n')
    .join('\n');

// --- dates ------------------------------------------------------------------

test('A DATE IS MM/DD/YYYY', () => {
  assert.equal(format.displayDate('2026-09-15'), '09/15/2026');
  assert.equal(format.displayDate('2026-01-02'), '01/02/2026');
});

test('A DATE-ONLY STRING IS READ OFF THE STRING, NEVER PARSED', () => {
  // "2026-09-15" parsed as a Date is UTC midnight, which is the evening of the
  // 14th in New Jersey - so it renders as the day before for everybody who
  // matters. This is the single most likely way this change could go wrong.
  for (const iso of ['2026-01-01', '2026-03-08', '2026-07-04', '2026-11-01', '2026-12-31']) {
    const [y, m, d] = iso.split('-');
    assert.equal(format.displayDate(iso), `${m}/${d}/${y}`, iso);
  }
});

test('AND A TIMESTAMP IS CONVERTED TO NEW JERSEY FIRST', () => {
  // Neil's weird case: a UTC timestamp near midnight must not land on the
  // wrong calendar day. 02:30 UTC on the 16th is 10:30pm on the 15th here.
  assert.equal(format.displayDate('2026-09-16T02:30:00Z'), '09/15/2026');
  assert.equal(format.displayDate('2026-09-15T14:30:00Z'), '09/15/2026');
});

test('A DATE AND A TIME ARE TWO THINGS SIDE BY SIDE', () => {
  // His example, exactly: the date keeps the format, the time sits beside it.
  assert.equal(format.displayDateTime('2026-09-15T12:30:00Z'), '09/15/2026 · 8:30 AM');
});

test('AND THE TIME FORMAT IS NOT WHAT CHANGED', () => {
  // "show the time separately in the existing local-time format". Most of ops
  // reads 12-hour; the order console's stage rail has always read 24-hour.
  // Both survive, because the lock is about dates.
  assert.equal(
    format.displayDateTime('2026-09-15T22:30:00Z', { hour12: false }),
    '09/15/2026 · 18:30'
  );
  assert.equal(format.displayTime('2026-09-15T22:30:00Z'), '6:30 PM');
  assert.equal(format.displayTime('2026-09-15T22:30:00Z', { hour12: false }), '18:30');
});

test('A MISSING DATE IS NOT INVENTED', () => {
  for (const nothing of [null, undefined, '']) {
    assert.equal(format.displayDate(nothing), format.NO_DATE, JSON.stringify(nothing));
    assert.equal(format.displayDate(nothing, { empty: '' }), '');
    assert.equal(format.displayDateTime(nothing), format.NO_DATE);
  }
});

test('and something that is not a date is shown as it was given', () => {
  assert.equal(format.displayDate('not a date'), 'not a date');
});

// --- phones -----------------------------------------------------------------

test('A US PHONE NUMBER IS XXX-XXX-XXXX', () => {
  // Every shape the spec names, from every direction it can arrive.
  for (const raw of ['+12015541877', '12015541877', '2015541877', '(201) 554-1877', '201.554.1877']) {
    assert.equal(format.displayPhone(raw), '201-554-1877', raw);
  }
});

test('AND ANYTHING THAT IS NOT ONE IS LEFT ALONE, never forced into the shape', () => {
  // Neil's rule. A half-typed number displayed as though it were whole is
  // worse than an obviously odd one, because somebody will read it out.
  for (const raw of ['555', '', '+447700900123', 'ask at the desk']) {
    assert.equal(format.displayPhone(raw), raw, JSON.stringify(raw));
  }
  assert.equal(format.displayPhone(null), '');
});

test('THE STORED FORMAT DID NOT MOVE', () => {
  // Display only. normalisePhone() still writes +1 and ten digits, which is
  // what the carrier sends from and what an inbound text matches against.
  assert.equal(normalisePhone('201-554-1877'), '+12015541877');
  assert.equal(normalisePhone('(201) 554-1877'), '+12015541877');
  assert.equal(normalisePhone('+12015541877'), '+12015541877');

  const src = SRC('core', 'format.js');
  assert.ok(!/require\('\.\.\/db'\)/.test(src), 'the formatter reached for the database');
});

// --- one owner --------------------------------------------------------------

test('EVERY PHONE FORMATTER IS THE SAME ONE', () => {
  // There were three. A screen showing "(201) 554-1877" beside "+12015541877"
  // is exactly what having more than one produces.
  assert.equal(formatPhone('+12015541877'), '201-554-1877');
  assert.equal(site.publicPhoneDisplay, format.displayPhone(site.publicPhoneLink));
  assert.equal(site.callPhoneDisplay, format.displayPhone(site.callPhoneLink));
});

test('and no bracketed number is written out by hand anywhere', () => {
  // Including the placeholders in the forms, which are numbers a person sees.
  const root = path.join(__dirname, '..');
  const files = [
    ['src', 'routes', 'admin.js'],
    ['src', 'routes', 'account.js'],
    ['src', 'routes', 'web.js'],
    ['src', 'web', 'site.js'],
    ['src', 'web', 'partners-page.js'],
    ['public', 'pages', 'partners.html'],
  ];

  for (const bits of files) {
    const src = fs.readFileSync(path.join(root, ...bits), 'utf8');
    const found = src.match(/\(\d{3}\) ?\d{3}-\d{4}/g) || [];
    assert.deepEqual(found, [], `${bits.join('/')} writes a bracketed number`);
  }
});

test('EVERY OPS DATE HELPER IS THE SAME ONE', () => {
  const src = SRC('routes', 'admin.js');

  for (const fn of ['function shortDate(', 'function longDate(', 'function dateTime(']) {
    const at = src.indexOf(fn);
    assert.notEqual(at, -1, fn);
    const body = src.slice(at, src.indexOf('\n}\n', at));
    assert.match(body, /format\.display/, `${fn} formats a date itself`);
  }

  // And the name tables they used to build strings from are gone, so nothing
  // here can grow a second format back by accident.
  assert.ok(!/const MONTHS = \[/.test(src), 'the month names came back');
  assert.ok(!/const FULL_MONTHS = \[/.test(src), 'the long month names came back');
});

// --- the one exception ------------------------------------------------------

test('A TEXT MESSAGE STILL READS LIKE A SENTENCE', () => {
  // readableDate() writes the prose form, and every confirmation, reminder and
  // weigh-in text is built on it. "09/16/2026" in the middle of a sentence on
  // somebody's phone reads as a form, and the weekday is load-bearing: it is
  // how a customer checks we understood which day they meant.
  assert.equal(booking.readableDate('2026-09-16'), 'Wednesday 16 Sep');
});

test('and the screens do not use it', () => {
  // The ops screens and the portal go through format.js. A screen reaching for
  // readableDate() is the drift this lock exists to prevent.
  for (const bits of [
    ['web', 'checkouts-page.js'],
    ['web', 'order-console.js'],
    ['web', 'scheduled-page.js'],
  ]) {
    // COMMENTS STRIPPED, because the note in checkouts-page.js explaining why
    // it does NOT use readableDate() contains the word - so the assertion
    // matched its own explanation. Third time that has caught a test in this
    // suite.
    const src = SRC(...bits)
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');

    assert.ok(!/readableDate\(/.test(src), `${bits.join('/')} still formats a date as prose`);
  }
});
