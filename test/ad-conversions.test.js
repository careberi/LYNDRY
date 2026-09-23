'use strict';

// ---------------------------------------------------------------------------
// TELLING GOOGLE WHICH CLICKS BECAME PAYING CUSTOMERS.
//
// Neil, 11 September, after ringing a lead who had no idea what LYNDRY was:
// optimise for customers who PAY, not for people who fill in a form. Finished
// 16 September.
//
// Most of what is pinned here is the MUST-NOTs, because each one either sends
// something that should never leave, or teaches Google to buy the wrong person:
//
//   one click id per row     GCLID, GBRAID and WBRAID are three columns to
//                            Data Manager, and a row fills exactly one of them
//   nothing identifying      no name, no email, no address, no order number,
//                            and since 23 September no phone in any form. The
//                            hashed-phone column served customers with no
//                            click id at all, who need enhanced conversions -
//                            forbidden by CLAUDE.md - so they are excluded and
//                            the column went with them
//   headers on line one      Data Manager reads the first line as the column
//                            names. The legacy "Parameters:TimeZone=" line was
//                            eaten as one, and a file full of conversions
//                            imported nothing
//   the event's own time     never "now" - that is what makes re-uploading the
//                            same file every day a no-op at Google instead of
//                            inflating the count for ever
//   a cancel is not a book   half the Google orders so far were cancelled, and
//                            counting them buys more cancellers
//   a favour is not revenue  a WAIVED order took no money
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ads = require('../src/core/ad-conversions');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const order = (over = {}) => ({
  id: 'o1',
  created_at: '2026-09-12T15:04:00Z',
  status: 'DELIVERED',
  payment_status: 'PAID',
  amount_paid_cents: 3450,
  paid_at: '2026-09-13T18:22:00Z',
  delivered_at: '2026-09-13T19:00:00Z',
  ...over,
});

const clicker = (over = {}) => ({
  id: 'c1',
  phone: '+12015551234',
  gclid: 'Cj0KCQ-abc123',
  gbraid: null,
  wbraid: null,
  first_touch_source: null,
  orders: [order()],
  ...over,
});

const texter = (over = {}) =>
  clicker({ id: 'c2', gclid: null, first_touch_source: ads.GOOGLE_AD_TEXT, ...over });

const named = (rows, name) => rows.filter((r) => r.name === name);

// --- the two events ---------------------------------------------------------

test('a click that booked and paid produces exactly two rows', () => {
  const rows = ads.rowsFor([clicker()]);

  assert.equal(rows.length, 2);
  assert.equal(named(rows, ads.BOOKED).length, 1);
  assert.equal(named(rows, ads.PAID).length, 1);
});

test('the paid row carries the money actually collected, not the price', () => {
  const rows = ads.rowsFor([clicker({ orders: [order({ amount_paid_cents: 3450 })] })]);

  assert.equal(named(rows, ads.PAID)[0].value, '34.50');
  assert.equal(named(rows, ads.BOOKED)[0].value, ads.BOOKED_VALUE.toFixed(2));
});

test('once per customer, however many orders they have placed', () => {
  const rows = ads.rowsFor([
    clicker({
      orders: [
        order({ id: 'o1', created_at: '2026-09-12T15:04:00Z' }),
        order({ id: 'o2', created_at: '2026-09-14T15:04:00Z', amount_paid_cents: 9900 }),
        order({ id: 'o3', created_at: '2026-09-18T15:04:00Z', amount_paid_cents: 8800 }),
      ],
    }),
  ]);

  assert.equal(rows.length, 2, 'three orders, still one booking and one first payment');
  assert.equal(named(rows, ads.PAID)[0].value, '34.50', 'the FIRST payment, not the latest');
});

test('the earliest order wins even when the rows arrive out of order', () => {
  const rows = ads.rowsFor([
    clicker({
      orders: [
        order({ id: 'late', created_at: '2026-09-20T15:00:00Z', amount_paid_cents: 9900 }),
        order({ id: 'early', created_at: '2026-09-12T15:04:00Z', amount_paid_cents: 3450 }),
      ],
    }),
  ]);

  assert.equal(named(rows, ads.PAID)[0].value, '34.50');
});

// --- who is left out --------------------------------------------------------

test('a cancelled first pickup is not a booked pickup', () => {
  const rows = ads.rowsFor([
    clicker({
      orders: [
        order({ id: 'gone', created_at: '2026-09-10T08:00:00Z', status: 'CANCELED', amount_paid_cents: 0, paid_at: null }),
        order({ id: 'real', created_at: '2026-09-11T08:00:00Z' }),
      ],
    }),
  ]);

  const booked = named(rows, ads.BOOKED);
  assert.equal(booked.length, 1);
  assert.ok(booked[0].at.startsWith('2026-09-11'), `credited the cancelled one: ${booked[0].at}`);
});

test('a customer whose only pickup was cancelled produces nothing at all', () => {
  const rows = ads.rowsFor([
    clicker({ orders: [order({ status: 'CANCELED', amount_paid_cents: 0, paid_at: null })] }),
  ]);

  assert.deepEqual(rows, []);
});

test('a waived order books but never counts as a payment', () => {
  const rows = ads.rowsFor([
    clicker({ orders: [order({ payment_status: 'WAIVED', amount_paid_cents: 0, paid_at: null })] }),
  ]);

  assert.equal(named(rows, ads.BOOKED).length, 1);
  assert.equal(named(rows, ads.PAID).length, 0, 'a favour is not revenue');
});

// THE WAIVED GUARD IS ITS OWN RULE, not a restatement of the amount check.
// An order can be charged and afterwards written off - #1975 is the shape, a
// pickup Neil decided under no circumstance to bill for - and it then carries
// real money AND a WAIVED status. That is not a sale to report to Google.
test('a waived order that already took money is still not a payment', () => {
  const rows = ads.rowsFor([
    clicker({
      orders: [order({ payment_status: 'WAIVED', amount_paid_cents: 3800, paid_at: '2026-09-13T18:22:00Z' })],
    }),
  ]);

  assert.equal(named(rows, ads.PAID).length, 0, 'money on the order does not make a favour a sale');
  assert.equal(named(rows, ads.BOOKED).length, 1, 'it was still a booked pickup');
});

test('an order that took no money is not a payment', () => {
  const rows = ads.rowsFor([clicker({ orders: [order({ amount_paid_cents: 0, paid_at: null })] })]);

  assert.equal(named(rows, ads.PAID).length, 0);
});

test('a customer with no click id and no named source is not ours to claim', () => {
  const rows = ads.rowsFor([clicker({ gclid: null, gbraid: null, wbraid: null })]);

  assert.deepEqual(rows, [], 'crediting Google for an organic customer is the whole thing to avoid');
});

test('a customer with no orders produces nothing', () => {
  assert.deepEqual(ads.rowsFor([clicker({ orders: [] })]), []);
  assert.deepEqual(ads.rowsFor([clicker({ orders: null })]), []);
});

test('nothing at all is a file with no rows, not a crash', () => {
  assert.deepEqual(ads.rowsFor([]), []);
  assert.deepEqual(ads.rowsFor(null), []);
});

// --- one click id per row, in its own column --------------------------------
//
// THESE USED TO BE ABOUT KEEPING A CLICK ID AND A HASHED PHONE APART, because
// the file carried a Phone Number column for customers who tapped a message ad
// and never loaded the site. Data Manager only accepts those with enhanced
// conversions, which CLAUDE.md forbids, so the rows are excluded and the column
// is gone. The rule they protected is stronger now and is structural: there is
// no phone column to leak into.

test('each click id lands in its own column and the others stay empty', () => {
  for (const field of ['gclid', 'gbraid', 'wbraid']) {
    const who = ads.identify(clicker({ gclid: null, [field]: 'Xy-restricted-ios' }));

    assert.equal(who[field], 'Xy-restricted-ios', field);
    for (const other of ['gclid', 'gbraid', 'wbraid']) {
      if (other !== field) assert.equal(who[other], '', `${field} leaked into ${other}`);
    }
  }
});

test('gclid wins when a row somehow carries more than one', () => {
  const who = ads.identify(clicker({ gbraid: 'B-1', wbraid: 'W-1' }));

  assert.equal(who.gclid, 'Cj0KCQ-abc123');
  assert.equal(who.gbraid, '', 'two identifiers on one row is what Google warns against');
  assert.equal(who.wbraid, '');
});

test('a customer with no click id at all is left out of the file', () => {
  // Including the starter-text customers, whatever their phone looks like.
  // They are still recorded in the database; they simply may not be uploaded.
  assert.equal(ads.identify(texter()), null);
  assert.equal(ads.identify(texter({ phone: 'not a number' })), null);
  assert.equal(ads.identify(clicker({ gclid: null, gbraid: null, wbraid: null })), null);
});

test('the ones that are left out are counted rather than dropped quietly', () => {
  // What refusing enhanced conversions costs, in people, so it can be said out
  // loud instead of turning up as an unexplained gap in a report.
  assert.equal(ads.excludedForNoClickId([clicker(), texter(), texter({ id: 'c3' })]), 2);
  assert.equal(ads.excludedForNoClickId([clicker()]), 0);

  // Somebody with no click id who did NOT come from a message ad was never
  // attributable in the first place and is not part of that cost.
  assert.equal(ads.excludedForNoClickId([clicker({ gclid: null, first_touch_source: null })]), 0);
});

// --- what leaves the building ----------------------------------------------

test('no phone reaches the file in any form, hashed or otherwise', () => {
  const file = ads.csv(ads.rowsFor([clicker(), texter()]));

  assert.ok(!/phone/i.test(ads.HEADER.join(',')), 'there is a phone column again');
  assert.ok(!/[0-9a-f]{64}/.test(file), 'something that looks like a SHA-256 is in the file');
  assert.ok(!file.includes('2015551234'), file);
});

test('the module no longer hashes anything', () => {
  // The hashing existed for one column that has gone. A hash function with no
  // caller is an invitation to put the column back without the argument that
  // took it out - see CLAUDE.md on enhanced conversions.
  const src = withoutComments(SRC('core', 'ad-conversions.js'));

  assert.ok(!src.includes('createHash'), src);
  assert.ok(!src.includes('hashPhone'), src);
});

test('nothing identifying appears anywhere in the file', () => {
  const file = ads.csv(ads.rowsFor([clicker(), texter()]));

  for (const leak of ['+12015551234', '2015551234', 'Elliot', '@', 'Scott Ct']) {
    assert.ok(!file.includes(leak), `${leak} must never leave`);
  }
  // And the order id is not in there either - it names a row in our database.
  assert.ok(!file.includes('o1'));
});

test('the module never selects a name, an email or an address', () => {
  const src = withoutComments(SRC('core', 'ad-conversions.js'));
  const query = src.slice(src.indexOf("from('customers')"), src.indexOf('if (error) throw error'));

  for (const column of ['name', 'email', 'address', 'notes']) {
    assert.ok(!query.includes(`${column}`), `${column} has no business here`);
  }
  assert.ok(query.includes('phone'), 'the phone is needed, to hash it');
});

// --- the file Google reads --------------------------------------------------

test('THE VERY FIRST LINE IS THE COLUMN HEADERS, AND NOTHING COMES BEFORE IT', () => {
  // This is the exact failure that made the first connection import nothing.
  // Data Manager reads line one as the column names, and the legacy
  // "Parameters:TimeZone=" line was taken as a single column called
  // Parameters_TimeZone_America_New_York - so a file full of conversions
  // arrived as one unusable column.
  const lines = ads.csv(ads.rowsFor([clicker()])).split('\n');

  assert.equal(lines[0], ads.HEADER.join(','));
  assert.ok(!lines[0].startsWith('Parameters'), 'the legacy time zone line is back');
  assert.ok(!ads.csv([]).startsWith('Parameters'), 'an empty file still carries it');
});

test('the headers are spelled the way Data Manager spells them', () => {
  // Not ours to prettify. These are the names that make the mapping step map
  // itself; "Conversion Name" is the legacy spelling and is not one of them.
  assert.deepEqual(ads.HEADER, [
    'GCLID',
    'GBRAID',
    'WBRAID',
    'Conversion action',
    'Conversion date and time',
    'Conversion value',
    'Conversion currency',
  ]);
});

test('the conversion time is the service clock and carries its own offset', () => {
  // 02:30 UTC is the previous evening in New Jersey. Getting this wrong puts
  // every evening conversion on the wrong day.
  assert.equal(ads.conversionTime('2026-09-16T02:30:00Z'), '2026-09-15T22:30:00-04:00');

  // THE OFFSET IS READ, NOT TYPED, so the March and November changeovers need
  // nobody to remember them. It used to live on the Parameters line, which is
  // gone - a bare timestamp would now be read in whatever fallback zone the
  // connection happens to carry.
  assert.equal(ads.conversionTime('2026-01-16T02:30:00Z'), '2026-01-15T21:30:00-05:00');
  assert.match(
    ads.conversionTime('2026-09-16T18:00:00Z'),
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[-+]\d{2}:\d{2}$/
  );
});

test('an unreadable timestamp is left out rather than sent as nonsense', () => {
  assert.equal(ads.conversionTime('not a date'), null);
  assert.equal(ads.conversionTime(null), null);

  const rows = ads.rowsFor([clicker({ orders: [order({ created_at: 'rubbish', paid_at: 'rubbish', delivered_at: null })] })]);
  assert.deepEqual(rows, []);
});

// THE TIME IS THE EVENT'S OWN, WHICH IS WHAT MAKES RE-UPLOADING SAFE. Google
// identifies a click conversion by click id + name + time, so an unchanged file
// served every day is ignored as a duplicate. A "now" here would make every
// re-run a fresh conversion and inflate the count without limit.
test('the same customers produce a byte-identical file on a later run', () => {
  const people = [clicker(), texter()];
  const first = ads.csv(ads.rowsFor(people));
  const second = ads.csv(ads.rowsFor(people));

  assert.equal(first, second);
  const today = new Date();
  const stamp =
    today.getFullYear() +
    '-' +
    String(today.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(today.getDate()).padStart(2, '0') +
    'T';
  assert.ok(!first.includes(stamp), 'today\'s date suggests "now" crept in');
});

test('nothing in the module reads the clock to build a row', () => {
  const src = withoutComments(SRC('core', 'ad-conversions.js'));
  const derive = src.slice(src.indexOf('function rowsFor'), src.indexOf('function field'));

  assert.ok(!derive.includes('Date.now'), derive);
  assert.ok(!/new Date\(\)/.test(derive), derive);
});

test('every row has all seven columns, in order', () => {
  const lines = ads.csv(ads.rowsFor([clicker(), texter()])).trim().split('\n').slice(1);

  assert.ok(lines.length >= 2);
  for (const line of lines) {
    assert.equal(line.split(',').length, ads.HEADER.length, line);
  }
});

test('a value that could break the file is quoted rather than shifting a column', () => {
  const file = ads.csv([
    { gclid: 'a,b', gbraid: '', wbraid: '', name: 'x"y', at: '2026-09-16T10:00:00-04:00', value: '1.00' },
  ]);
  const line = file.trim().split('\n').pop();

  assert.ok(line.includes('"a,b"'), line);
  assert.ok(line.includes('"x""y"'), line);
});

test('the currency is on every row', () => {
  const lines = ads.csv(ads.rowsFor([clicker()])).trim().split('\n').slice(1);

  assert.ok(lines.length >= 1);
  for (const line of lines) assert.ok(line.includes('USD'), line);
});

// --- the starter text -------------------------------------------------------

test('the exact starter text is recognised, whatever the handset does to it', () => {
  const yes = [
    "Hi, I'd like to book a laundry pickup.",
    'Hi, I’d like to book a laundry pickup.',
    'hi id like to book a laundry pickup',
    "  HI, I'D LIKE TO BOOK A LAUNDRY PICKUP  ",
  ];

  for (const text of yes) assert.equal(ads.isAdStarterText(text), true, text);
});

test('anything with words of their own is a person, not the button', () => {
  const no = [
    "Hi, I'd like to book a laundry pickup. Tomorrow if you can?",
    'I would like to book a laundry pickup',
    'book a laundry pickup',
    'Hi',
    '',
    null,
    undefined,
  ];

  for (const text of no) assert.equal(ads.isAdStarterText(text), false, String(text));
});

// --- the door it is served through ------------------------------------------

test('a blank password switches the route off rather than opening it', () => {
  const src = withoutComments(SRC('routes', 'web.js'));
  const fn = src.slice(src.indexOf('function credentialsMatch'), src.indexOf("router.get('/ads/conversions.csv'"));

  assert.ok(/if \(!expected\) return false;/.test(fn), fn);
});

test('a wrong credential is a 404, so the file cannot be found by probing', () => {
  // THIS TEST USED TO REFUSE A 401 ANYWHERE IN THE ROUTE, and it was right to
  // fail when one appeared. The rule it was protecting has been narrowed rather
  // than dropped: Google's connector only sends its password after it has been
  // challenged for one, so a route that never challenges never receives it, and
  // the feed reported "Invalid credentials" against a correct password for as
  // long as it existed.
  //
  // WHAT SURVIVES IS THE HALF THAT WAS DOING THE WORK. A wrong credential is
  // still a 404, so nobody can confirm this file by throwing a password at it.
  // Only a request offering NOTHING is challenged. See
  // test/conversion-feed-auth.test.js, which holds all three answers apart.
  const src = withoutComments(SRC('routes', 'web.js'));
  const start = src.indexOf("router.get('/ads/conversions.csv'");
  const route = src.slice(start, src.indexOf('catch (err)', start));

  assert.ok(route.includes('status(404)'), route);

  // The branch that runs when the credential is present and wrong.
  const failed = route.slice(route.indexOf('credentialsMatch'));
  assert.ok(failed.includes('404'), failed);
  assert.ok(!failed.includes('401'), 'a wrong credential announces the file exists');

  // And the challenge is reachable only when nothing was offered at all.
  assert.ok(route.includes('if (!offered)'), route);
});

test('the credential is compared in constant time', () => {
  const src = withoutComments(SRC('routes', 'web.js'));
  const fn = src.slice(src.indexOf('function credentialsMatch'), src.indexOf("router.get('/ads/conversions.csv'"));

  assert.ok(fn.includes('timingSafeEqual'), fn);
  assert.ok(fn.includes('left.length !== right.length'), 'timingSafeEqual throws on a length mismatch');
});

test('the feed is never indexed, never cached and disallowed in robots', () => {
  const src = withoutComments(SRC('routes', 'web.js'));
  const start = src.indexOf("router.get('/ads/conversions.csv'");
  const route = src.slice(start, src.indexOf('catch (err)', start));

  assert.ok(route.includes('noindex'), route);
  assert.ok(route.includes('no-store'), route);
  assert.ok(src.includes("'/ads'"), 'robots.txt must disallow it');
});

test('it is a GET that writes nothing', () => {
  const src = withoutComments(SRC('core', 'ad-conversions.js'));

  // Database writes specifically. A bare '.update(' would also match
  // createHash().update(), which is how a phone gets hashed.
  for (const write of ['.insert(', '.delete(', '.upsert(']) {
    assert.ok(!src.includes(write), `${write} - this is a report`);
  }
  assert.ok(!/from\([^)]*\)[\s\S]{0,120}\.update\(/.test(src), 'no table write');
});

// --- and it never sends anything to a customer ------------------------------

test('nothing in the conversion path can text anybody', () => {
  const src = withoutComments(SRC('core', 'ad-conversions.js'));

  assert.ok(!src.includes('notify'), src);
  assert.ok(!src.includes('sendMessage'), src);
});
