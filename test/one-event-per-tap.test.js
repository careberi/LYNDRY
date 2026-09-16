'use strict';

// ---------------------------------------------------------------------------
// ONE TAP IS ONE ROW.
//
// Neil, 16 September: "If a sticker or bag step still writes the same event
// twice, keep one."
//
// It was real, and it was found by reading the live log rather than the code.
// Every one of these is one physical act wearing two rows:
//
//   #2068  "K3CPQF-1 weighed back at 1 lb"                     x2, 0.44s apart
//   #2068  "ZHMCKC-1 weighed back at 36 lb"                    x2, 0.62s
//   #2064  "WZ7MZ8 handed to the laundromat, van clip 10 off"  x2, 2.22s
//   #2062  "Weighed 19 lb" AND "Priced $38.00 at $2.00 a pound" x2, ~0.5s
//   #2062  "1 bag at the door" / #2060 "3 bags at the door"    x2, ~0.9s
//
// A doubled row is not neutral: this log is what a price dispute is settled
// from, and "weighed 19 lb / weighed 19 lb" reads as the bag going on the scale
// twice.
//
// TWO FIXES, AND THE ORDER OF THEM MATTERS:
//
//   the recorder   declines an identical row seconds after the last one. One
//                  owner, so a step added next year cannot forget
//   handed-off     respects the `already` its own function returns. The same
//                  answer known exactly rather than inferred from a clock
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const orderEvents = require('../src/core/order-events');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const secondsAgo = (n) => new Date(Date.now() - n * 1000).toISOString();

const written = (row) => ({ was: null, became: null, created_at: secondsAgo(1), ...row });

// --- the duplicates that were actually in the log --------------------------

test('the real duplicates found on #2068, #2064 and #2062 are all refused', () => {
  const cases = [
    ['WEIGHT', 'K3CPQF-1 weighed back at 1 lb', 0.44],
    ['WEIGHT', 'ZHMCKC-1 weighed back at 36 lb', 0.62],
    ['LABEL', 'WZ7MZ8 handed to the laundromat, van clip 10 off', 2.22],
    ['WEIGHT', 'Weighed 19 lb', 0.48],
    ['PRICE', 'Priced $38.00 at $2.00 a pound', 0.49],
    ['NOTE', '1 bag at the door', 0.79],
    ['NOTE', '3 bags at the door', 0.97],
    ['LABEL', 'BKFHKP-2 in the van on clip 13', 0.0],
  ];

  for (const [kind, summary, gap] of cases) {
    const previous = written({ kind, summary, created_at: secondsAgo(gap) });
    assert.equal(orderEvents.sameAs(previous, { kind, summary }), true, `${kind}: ${summary}`);
  }
});

// --- what it must NOT swallow ----------------------------------------------

test('two different bags at the same weight are two rows', () => {
  const previous = written({ kind: 'WEIGHT', summary: 'BKFHKP-1 weighed back at 18 lb' });

  assert.equal(
    orderEvents.sameAs(previous, { kind: 'WEIGHT', summary: 'BKFHKP-2 weighed back at 18 lb' }),
    false,
    'only an exact match is a repeat - the sticker number is what tells them apart'
  );
});

// THE WORST CASE FOR ANY SHORTCUT IS TWO ROWS THAT DIFFER IN THE LAST
// CHARACTER, and the bind route produces exactly that on a three-bag order.
// Comparing a prefix, a hash of the opening, or "close enough" would fold bag 1
// and bag 2 into one row and lose a bag off the record.
test('two rows that differ only in the final character are two rows', () => {
  const pairs = [
    ['LABEL', 'Label BKFHKP put on bag 1', 'Label BKFHKP put on bag 2'],
    ['LABEL', 'ZHMCKC-1 is in use', 'ZHMCKC-2 is in use'],
    ['LABEL', 'ZHMCKC-1: our bag tag off', 'ZHMCKC-2: our bag tag off'],
    ['WEIGHT', 'Weighed 18 lb', 'Weighed 19 lb'],
  ];

  for (const [kind, first, second] of pairs) {
    assert.equal(
      orderEvents.sameAs(written({ kind, summary: first }), { kind, summary: second }),
      false,
      `${first} / ${second}`
    );
    // ...and each is still its own repeat.
    assert.equal(orderEvents.sameAs(written({ kind, summary: first }), { kind, summary: first }), true);
  }
});

test('a genuine repeat, later, is still recorded', () => {
  const summary = 'Weighed 19 lb';
  const previous = written({ kind: 'WEIGHT', summary, created_at: secondsAgo(60) });

  assert.equal(orderEvents.sameAs(previous, { kind: 'WEIGHT', summary }), false);
});

test('the window is wide enough for a slow tap and no wider', () => {
  assert.ok(orderEvents.SAME_TAP_SECONDS >= 5, 'a phone on two bars takes a few seconds');
  assert.ok(orderEvents.SAME_TAP_SECONDS <= 30, 'past this it starts swallowing real repeats');

  const summary = 'K3CPQF-1 weighed back at 1 lb';
  const just = written({ kind: 'WEIGHT', summary, created_at: secondsAgo(orderEvents.SAME_TAP_SECONDS - 1) });
  const past = written({ kind: 'WEIGHT', summary, created_at: secondsAgo(orderEvents.SAME_TAP_SECONDS + 1) });

  assert.equal(orderEvents.sameAs(just, { kind: 'WEIGHT', summary }), true);
  assert.equal(orderEvents.sameAs(past, { kind: 'WEIGHT', summary }), false);
});

test('the same sentence under a different kind is a different event', () => {
  const previous = written({ kind: 'NOTE', summary: 'Weighed 19 lb' });

  assert.equal(orderEvents.sameAs(previous, { kind: 'WEIGHT', summary: 'Weighed 19 lb' }), false);
});

test('a correction that only changes was/became is still a row', () => {
  const previous = written({ kind: 'WEIGHT', summary: 'Weight corrected', was: '19 lb', became: '18 lb' });

  assert.equal(
    orderEvents.sameAs(previous, { kind: 'WEIGHT', summary: 'Weight corrected', was: '18 lb', became: '17 lb' }),
    false,
    'the figures are the whole content of a correction'
  );
  assert.equal(
    orderEvents.sameAs(previous, { kind: 'WEIGHT', summary: 'Weight corrected', was: '19 lb', became: '18 lb' }),
    true
  );
});

test('nothing written before means nothing to compare against', () => {
  assert.equal(orderEvents.sameAs(null, { kind: 'WEIGHT', summary: 'Weighed 19 lb' }), false);
  assert.equal(orderEvents.sameAs(undefined, { kind: 'WEIGHT', summary: 'Weighed 19 lb' }), false);
});

test('a row with an unreadable or future timestamp is never treated as a repeat', () => {
  const summary = 'Weighed 19 lb';
  const bad = { kind: 'WEIGHT', summary, was: null, became: null, created_at: 'not a date' };
  const ahead = { kind: 'WEIGHT', summary, was: null, became: null, created_at: secondsAgo(-90) };

  assert.equal(orderEvents.sameAs(bad, { kind: 'WEIGHT', summary }), false);
  assert.equal(orderEvents.sameAs(ahead, { kind: 'WEIGHT', summary }), false, 'clock skew must not hide a row');
});

test('a summary long enough to be truncated still matches itself', () => {
  const long = 'x'.repeat(500);
  const previous = written({ kind: 'NOTE', summary: long.slice(0, 400) });

  assert.equal(orderEvents.sameAs(previous, { kind: 'NOTE', summary: long }), true);
});

// --- the log is still append only ------------------------------------------

test('nothing in the recorder updates or deletes a row', () => {
  const src = withoutComments(SRC('core', 'order-events.js'));

  for (const forbidden of ['.update(', '.delete(', '.upsert(']) {
    assert.ok(!src.includes(forbidden), `${forbidden} would make this log editable`);
  }
});

test('the duplicate check fails open - a broken lookup still writes the row', () => {
  const src = withoutComments(SRC('core', 'order-events.js'));
  const fn = src.slice(src.indexOf('async function lastEvent'), src.indexOf('async function record'));

  assert.ok(fn.includes('catch'), fn);
  assert.ok(/return null;\s*\}\s*\}/.test(fn), 'the catch has to answer "I cannot tell", which writes the row');
});

// THE LOOKUP IS SCOPED TO THE KIND, and that is the difference between this
// working and not: one weigh writes a WEIGHT and then a PRICE, so a double
// submit lands W, P, W, P - and against "the last row of any kind" the second W
// is compared to a P and sails through. #2062 is exactly that shape.
test('the previous row is looked up by kind, not just the latest row', () => {
  const src = withoutComments(SRC('core', 'order-events.js'));
  const fn = src.slice(src.indexOf('async function lastEvent'), src.indexOf('async function record'));

  assert.ok(fn.includes("eq('kind', kind)"), fn);
  assert.ok(fn.includes("eq('order_id', orderId)"), fn);
});

// --- and the step that knew all along --------------------------------------

test('handing a bag over twice writes one row, on the flag rather than the clock', () => {
  const src = withoutComments(SRC('routes', 'admin.js'));
  const start = src.indexOf("router.post('/ops/run/handed-off'");
  assert.ok(start > 0, 'the handed-off route is missing');
  const route = src.slice(start, src.indexOf('catch (err)', start));

  assert.ok(route.includes('bags.handOffBag(label)'), route);
  assert.ok(route.includes('if (!result.already)'), route);

  // And the function it is trusting still answers the question.
  const bagsSrc = withoutComments(SRC('core', 'bags.js'));
  const handOff = bagsSrc.slice(
    bagsSrc.indexOf('async function handOffBag'),
    bagsSrc.indexOf('async function', bagsSrc.indexOf('async function handOffBag') + 10)
  );
  assert.ok(handOff.includes('already: true'), handOff);
});
