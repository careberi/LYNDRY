'use strict';

// ---------------------------------------------------------------------------
// A CLIP THE DRIVER TAKES OFF AT A DOOR IS AVAILABLE AGAIN. BEHAVIOUR, NOT
// GREP.
//
// Neil, 17 September, describing what he had actually found:
//
//   "clean return bag has a clip / driver removes that clip during doorstep
//    prep / the per-bag action sets unclipped_at / but clipsInUse() considers a
//    clip unavailable until clip_returned_at is set / final unclipOrder() only
//    updates rows whose unclipped_at is still NULL / because doorstep prep
//    already populated unclipped_at, final cleanup skips the row / the physical
//    clip is back in the van but the software can continue treating it as
//    occupied"
//
// Every word of that was true, and every test in the suite passed while it was.
// The ones that existed asserted that the right columns appeared in the right
// functions - which they did. What nobody had written down is the thing a
// driver actually experiences: put clip 1 on a bag, take it off at a door, and
// see whether the next bag can have clip 1.
//
// SO THIS RUNS THE FUNCTIONS AGAINST A DATABASE. A small in-memory stand-in for
// the one table these four functions touch, supporting exactly the filters they
// use. It writes nothing anywhere real - src/db.js is replaced before bags.js
// is ever required, and node --test gives each file its own process.
//
// The five steps below are Neil's, in his order.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// --- the stand-in ------------------------------------------------------------

const DB = { bag_labels: [], orders: [] };

function matches(row, filters, table) {
  return filters.every(([kind, column, value]) => {
    // clipsInUse() reaches through the embedded order for the driver.
    let actual;
    if (column.startsWith('orders.')) {
      const order = DB.orders.find((o) => o.id === row.order_id) || {};
      actual = order[column.slice('orders.'.length)];
    } else {
      actual = row[column];
    }

    if (kind === 'eq') return actual === value;
    if (kind === 'is') return value === null ? actual == null : actual === value;
    if (kind === 'not') return value === null ? actual != null : actual !== value;
    throw new Error(`the stand-in does not know the filter ${kind}`);
  });
}

function builder(table) {
  const q = { filters: [], patch: null, op: 'select' };

  const run = () => {
    const hits = DB[table].filter((row) => matches(row, q.filters, table));
    if (q.op === 'update') {
      for (const row of hits) Object.assign(row, q.patch);
    }
    // clipsInUse() asks for the embedded order; nothing here reads it back.
    return { data: hits.map((r) => ({ ...r })), error: null };
  };

  const api = {
    select: () => api,
    update: (patch) => {
      q.op = 'update';
      q.patch = patch;
      return api;
    },
    eq: (c, v) => (q.filters.push(['eq', c, v]), api),
    is: (c, v) => (q.filters.push(['is', c, v]), api),
    not: (c, _op, v) => (q.filters.push(['not', c, v]), api),
    maybeSingle: async () => {
      const { data } = run();
      return { data: data[0] || null, error: null };
    },
    single: async () => {
      const { data } = run();
      return { data: data[0] || null, error: null };
    },
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };

  return api;
}

const dbPath = require.resolve(path.join(__dirname, '..', 'src', 'db.js'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { from: (table) => builder(table) },
};

const bags = require('../src/core/bags');
const { config } = require('../src/config');

// --- the world ---------------------------------------------------------------

const DRIVER = 'driver-1';

function reset() {
  DB.orders = [{ id: 'order-1', driver_id: DRIVER }];
  DB.bag_labels = [];
}

let next = 0;
function addBag(extra = {}) {
  next += 1;
  const row = {
    id: `label-${next}`,
    order_id: 'order-1',
    code: `CODE${next}`,
    sticker_seq: 1,
    leg: 'DELIVERY',
    clip_number: null,
    clipped_at: null,
    unclipped_at: null,
    clip_returned_at: null,
    unloaded_at: null,
    ...extra,
  };
  DB.bag_labels.push(row);
  return row;
}

const rowFor = (label) => DB.bag_labels.find((r) => r.id === label.id);

// --- Neil's five steps -------------------------------------------------------

test('1-5: a clean bag takes clip 1, the driver removes it, and clip 1 comes back', async () => {
  reset();

  // 1. A clean delivery bag receives clip 1.
  const bag = addBag();
  const assigned = await bags.assignClip(bag, DRIVER);

  assert.equal(assigned.ok, true, assigned.detail);
  assert.equal(assigned.clip, 1, 'the first clip out of an empty van is not 1');

  // 2. Clip 1 is in use.
  assert.deepEqual([...(await bags.clipsInUse(DRIVER))], [1], 'clip 1 is not counted as out');

  // 3. The driver removes it at the customer's door. This is the tap behind
  //    POST /ops/run/door/:id/clip.
  const released = await bags.releaseClip(rowFor(bag));
  assert.equal(released.ok, true);
  assert.equal(released.clip, 1);

  // 4. Clip 1 is no longer in use.
  assert.deepEqual([...(await bags.clipsInUse(DRIVER))], [], 'clip 1 is still held after it came off');

  // 5. The next eligible bag receives clip 1 again, as the lowest free clip.
  const nextBag = addBag();
  const reassigned = await bags.assignClip(nextBag, DRIVER);

  assert.equal(reassigned.clip, 1, 'clip 1 was not handed out again');
});

test('and both columns end up honest: off the bag, and back in the van', async () => {
  reset();
  const bag = addBag();
  await bags.assignClip(bag, DRIVER);
  await bags.releaseClip(rowFor(bag));

  const row = rowFor(bag);
  assert.ok(row.unclipped_at, 'nothing says the clip came off the bag');
  assert.ok(row.clip_returned_at, 'nothing says the number is free');
});

// --- the bug itself, reproduced ----------------------------------------------

test('THE STRANDED CLIP: unclipped by hand, then swept, comes back', async () => {
  // This is the exact shape that leaked. The doorstep tap stamped unclipped_at
  // and nothing else; unclipOrder() then filtered on `unclipped_at is null` and
  // skipped the row, so the number was never freed by anything.
  reset();

  const bag = addBag();
  await bags.assignClip(bag, DRIVER);

  // The old doorstep tap, written out: one column, no clip meaning.
  rowFor(bag).unclipped_at = new Date().toISOString();

  assert.deepEqual([...(await bags.clipsInUse(DRIVER))], [1], 'unclipping alone should not free it');

  const freed = await bags.unclipOrder('order-1');

  assert.deepEqual(freed, [1], 'the sweep skipped a clip that was already off the bag');
  assert.deepEqual([...(await bags.clipsInUse(DRIVER))], [], 'the clip is still stranded');
});

test('the sweep still frees a clip nobody has touched, and says which', async () => {
  reset();
  const a = addBag();
  const b = addBag();
  await bags.assignClip(a, DRIVER);
  await bags.assignClip(b, DRIVER);

  assert.deepEqual([...(await bags.clipsInUse(DRIVER))].sort(), [1, 2]);
  assert.deepEqual(await bags.unclipOrder('order-1'), [1, 2]);
  assert.deepEqual([...(await bags.clipsInUse(DRIVER))], []);
});

test('it never moves unclipped_at backwards', async () => {
  // A driver who said the clip came off ten minutes ago is right about when.
  reset();
  const bag = addBag();
  await bags.assignClip(bag, DRIVER);

  const earlier = '2026-09-17T09:00:00.000Z';
  rowFor(bag).unclipped_at = earlier;

  await bags.unclipOrder('order-1');
  assert.equal(rowFor(bag).unclipped_at, earlier, 'the honest timestamp was overwritten');
});

test('releasing twice is not an error and frees nothing twice', async () => {
  reset();
  const bag = addBag();
  await bags.assignClip(bag, DRIVER);

  const first = await bags.releaseClip(rowFor(bag));
  const stamp = rowFor(bag).clip_returned_at;

  const second = await bags.releaseClip(rowFor(bag));

  assert.equal(first.clip, 1);
  assert.equal(second.already, true, 'a second tap does not read as already done');
  assert.equal(rowFor(bag).clip_returned_at, stamp, 'the second tap rewrote the timestamp');
});

test('a bag with no clip is not an error either', async () => {
  reset();
  const bag = addBag();

  const result = await bags.releaseClip(rowFor(bag));
  assert.equal(result.ok, true);
  assert.equal(result.clip, null);
});

// --- the pool itself ----------------------------------------------------------

test('the pool is ten, and the eleventh bag is told so rather than given clip 11', async () => {
  reset();
  assert.equal(config.routing.vanClips, 10);

  for (let n = 1; n <= 10; n += 1) {
    const assigned = await bags.assignClip(addBag(), DRIVER);
    assert.equal(assigned.clip, n, `bag ${n} did not get clip ${n}`);
  }

  const eleventh = await bags.assignClip(addBag(), DRIVER);

  assert.equal(eleventh.ok, false, 'it invented clip 11');
  assert.match(eleventh.detail, /10 clips/);
});

test('freeing one in the middle hands that number out next, not the highest', async () => {
  // Lowest free, so the numbers stay small and a driver reaches for clip 3
  // rather than clip 47.
  reset();
  const made = [];
  for (let n = 1; n <= 4; n += 1) made.push(addBag());
  for (const bag of made) await bags.assignClip(bag, DRIVER);

  await bags.releaseClip(rowFor(made[1])); // clip 2 comes off

  const assigned = await bags.assignClip(addBag(), DRIVER);
  assert.equal(assigned.clip, 2, 'it took the next number up instead of the free one');
});

test("another driver's clips are not in this van", async () => {
  reset();
  DB.orders.push({ id: 'order-2', driver_id: 'driver-2' });

  const mine = addBag();
  const theirs = addBag({ order_id: 'order-2' });

  await bags.assignClip(mine, DRIVER);
  await bags.assignClip(theirs, 'driver-2');

  assert.deepEqual([...(await bags.clipsInUse(DRIVER))], [1]);
  assert.deepEqual([...(await bags.clipsInUse('driver-2'))], [1], 'two vans cannot both hold clip 1');
});
