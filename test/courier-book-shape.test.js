'use strict';

// ---------------------------------------------------------------------------
// BOTH COURIERS TAKE THE SAME ARGUMENTS.
//
// `src/providers/couriers/index.js` passes them straight through - `book: (...args)
// => driver.book(...args)` - so a mismatch is invisible until a real delivery.
// And it WAS mismatched: Uber's adapter destructured `{ from, to }` while the
// fake one destructured `{ pickup, dropoff }`, and the fake did not throw. A
// caller written against Uber's names would have booked a fake delivery with
// `from: undefined`, stored it, and handed back a valid-looking id.
//
// DEVELOPMENT WOULD HAVE LOOKED LIKE IT WORKED, which is the worst shape this
// kind of bug comes in: the whole reason the fake courier exists is to prove the
// flow before anybody drives anywhere, and it would have proved the opposite of
// what it appeared to.
//
// IT READS THE SOURCE, which only `test/payment-methods.test.js` does otherwise
// and for the same reason: what is worth protecting is the shape of one call on
// two files, and the failure it prevents is silent and days late.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const fake = require('../src/providers/couriers/fake');

const SRC = (name) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', 'providers', 'couriers', name), 'utf8');

// The keys a function destructures from its single options object.
function destructured(source, fnName) {
  const at = source.indexOf(`function ${fnName}({`);
  if (at === -1) return null;

  const open = source.indexOf('{', at + `function ${fnName}`.length);
  const close = source.indexOf('}', open);
  const body = source.slice(open + 1, close);

  return body
    .split(',')
    .map((part) => part.split('=')[0].trim())
    .filter(Boolean)
    .filter((k) => /^[a-zA-Z_$][\w$]*$/.test(k))
    .sort();
}

test('THE TWO DRIVERS DESTRUCTURE THE SAME KEYS FROM book()', () => {
  const uber = destructured(SRC('uber.js'), 'book');
  const pretend = destructured(SRC('fake.js'), 'book');

  assert.ok(uber && uber.length, 'uber.js book() has been renamed or reshaped');
  assert.ok(pretend && pretend.length, 'fake.js book() has been renamed or reshaped');

  assert.deepEqual(
    pretend,
    uber,
    'the fake courier and the real one take different arguments, so development proves nothing'
  );
});

test('and the addresses are `from` and `to`, matching quote()', () => {
  // `quote()` already used from/to and `web.js` calls it that way, so the pair
  // that moved is the one that was inconsistent.
  const uber = destructured(SRC('uber.js'), 'book');

  assert.ok(uber.includes('from'), 'uber.js book() stopped taking `from`');
  assert.ok(uber.includes('to'), 'uber.js book() stopped taking `to`');
  assert.ok(!uber.includes('pickup'), 'the old `pickup` name is back');
  assert.ok(!uber.includes('dropoff'), 'the old `dropoff` name is back');
});

test('A BOOKING WITH NO ADDRESS IS REFUSED, NOT STORED', async () => {
  // The fake courier used to accept one and return a valid-looking delivery.
  // Being strict about what Uber is strict about is the entire value of it.
  await assert.rejects(
    fake.book({ to: { line1: 'somewhere' } }),
    /needs both a `from` and a `to`/,
    'a booking with no pickup address was accepted'
  );

  await assert.rejects(
    fake.book({ from: { line1: 'somewhere' } }),
    /needs both a `from` and a `to`/,
    'a booking with no dropoff address was accepted'
  );
});

test('a complete booking still works, and keeps what it was given', async () => {
  const delivery = await fake.book({
    from: { line1: '300 Main St', city: 'Hackensack' },
    to: { line1: '16-50 Chandler Dr', city: 'Fair Lawn' },
    externalId: 'LYNDRY-9005',
    quoteId: 'dqt_abc',
    leaveAtDoor: true,
  });

  assert.match(delivery.id, /^del_/);
  assert.equal(delivery.status, 'pending');
  assert.equal(delivery.leaveAtDoor, true);
  assert.equal(delivery.pin, null, 'a PIN was issued on a leave-at-door delivery');
});
