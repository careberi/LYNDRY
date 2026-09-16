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
//   never both identifiers   Google's own guidance is that a click id next to
//                            user data "can cause matching conflicts". A row
//                            carries one or the other, never the two
//   nothing identifying      no name, no email, no address, no order number.
//                            A phone only ever leaves hashed
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

// --- the two identifiers never share a row ---------------------------------

test('a row carries a click id OR a hashed phone, never both', () => {
  const rows = ads.rowsFor([clicker(), texter()]);

  assert.ok(rows.length >= 2);
  for (const row of rows) {
    assert.ok(
      Boolean(row.click) !== Boolean(row.phone),
      `both or neither on one row: ${JSON.stringify(row)}`
    );
  }
});

test('a click id wins over the starter text when a customer somehow has both', () => {
  const who = ads.identify(clicker({ first_touch_source: ads.GOOGLE_AD_TEXT }));

  assert.equal(who.click, 'Cj0KCQ-abc123');
  assert.equal(who.phone, '', 'a click id is exact; adding the phone is what Google warns against');
});

test('gbraid and wbraid are click ids too', () => {
  for (const field of ['gbraid', 'wbraid']) {
    const who = ads.identify(clicker({ gclid: null, [field]: 'Xy-restricted-ios' }));
    assert.equal(who.click, 'Xy-restricted-ios', field);
  }
});

test('a starter-text customer with an unusable phone is dropped, not sent blank', () => {
  assert.equal(ads.identify(texter({ phone: 'not a number' })), null);
  assert.equal(ads.identify(texter({ phone: '' })), null);
  assert.equal(ads.identify(texter({ phone: null })), null);
});

// --- what leaves the building ----------------------------------------------

test('the phone is SHA-256 of E.164 and is never the number itself', () => {
  const hashed = ads.hashPhone('+12015551234');

  assert.match(hashed, /^[0-9a-f]{64}$/);
  assert.ok(!hashed.includes('2015551234'));
  assert.equal(hashed, require('node:crypto').createHash('sha256').update('+12015551234').digest('hex'));
});

test('a number that is not E.164 hashes to nothing rather than to garbage', () => {
  for (const bad of ['2015551234', '(201) 555-1234', '+0123', '', null, undefined, '+1201555123456789']) {
    assert.equal(ads.hashPhone(bad), null, String(bad));
  }
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

test('the time zone line comes first and the header second', () => {
  const lines = ads.csv(ads.rowsFor([clicker()])).split('\n');

  assert.equal(lines[0], 'Parameters:TimeZone=America/New_York');
  assert.equal(lines[1], ads.HEADER.join(','));
});

test('the conversion time is the service clock, not UTC', () => {
  // 02:30 UTC is the previous evening in New Jersey. Getting this wrong puts
  // every evening conversion on the wrong day.
  assert.equal(ads.conversionTime('2026-09-16T02:30:00Z'), '2026-09-15 22:30:00');
  assert.match(ads.conversionTime('2026-09-16T18:00:00Z'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
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
  assert.ok(!first.includes(String(new Date().getFullYear()) + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0') + ' '), 'today\'s date suggests "now" crept in');
});

test('nothing in the module reads the clock to build a row', () => {
  const src = withoutComments(SRC('core', 'ad-conversions.js'));
  const derive = src.slice(src.indexOf('function rowsFor'), src.indexOf('function field'));

  assert.ok(!derive.includes('Date.now'), derive);
  assert.ok(!/new Date\(\)/.test(derive), derive);
});

test('every row has all six columns, in order', () => {
  const lines = ads.csv(ads.rowsFor([clicker(), texter()])).trim().split('\n').slice(2);

  assert.ok(lines.length >= 2);
  for (const line of lines) {
    assert.equal(line.split(',').length, ads.HEADER.length, line);
  }
});

test('a value that could break the file is quoted rather than shifting a column', () => {
  const file = ads.csv([{ click: 'a,b', name: 'x"y', at: '2026-09-16 10:00:00', value: '1.00', phone: '' }]);
  const line = file.trim().split('\n').pop();

  assert.ok(line.includes('"a,b"'), line);
  assert.ok(line.includes('"x""y"'), line);
});

test('the currency is on every row', () => {
  const lines = ads.csv(ads.rowsFor([clicker()])).trim().split('\n').slice(2);

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
  const src = withoutComments(SRC('routes', 'web.js'));
  const start = src.indexOf("router.get('/ads/conversions.csv'");
  const route = src.slice(start, src.indexOf('catch (err)', start));

  assert.ok(route.includes('status(404)'), route);
  assert.ok(!route.includes('401'), 'a 401 challenge would announce the file exists');
  assert.ok(!route.includes('WWW-Authenticate'), route);
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
