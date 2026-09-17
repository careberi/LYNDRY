'use strict';

// ---------------------------------------------------------------------------
// THE DRIVER IS TOLD WHICH CLIP TO PUT ON THE BAG HE HAS JUST WEIGHED.
//
// Neil, 17 September:
//
//   "The issue is NOT that the backend failed to assign a clip. The clip WAS
//    assigned. I know this because when I later arrived at the laundromat
//    drop-off, the system showed a clip number for the bag. The actual failure
//    was: at CUSTOMER PICKUP, after I weighed the bag, the system never told me
//    which physical Van Clip to put on that bag."
//
// He is right on both halves. On order #2069 assignClip() reserved clips 1 and
// 3 at the scale and both were on the bags by the laundromat - and nothing at
// the doorstep ever said a number out loud.
//
// WHAT WAS ACTUALLY BROKEN, and none of it was assignClip():
//
//   1. tasksForCollect() emits two steps per bag - tag, weigh - and the comment
//      says the clip is "shown rather than confirmed". Nothing showed it. Not
//      the task title, not the card, not the tick list.
//   2. The only place the number appeared was the ?note= flash on the weigh
//      route's redirect, which is gone by the next tap.
//   3. And on the per-bag screen it was not even that: that route never read
//      req.query.note at all, so the sentence was thrown away.
//   4. That screen was unreachable anyway. Its guard was
//      `position > order.bag_count`, and bag_count is written by
//      finishPickup() at the END of the stop - so during a pickup it is zero
//      and every position redirected back to the run.
//
// These tests are about what a driver sees, which is the thing that was
// missing. They run tasksForCollect() and render the real pages.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

// --- the stand-ins -----------------------------------------------------------
//
// Nothing here touches a database. db.js is replaced before run.js is required,
// and bags.forOrder() answers from a list this file owns.

const dbPath = require.resolve(path.join(__dirname, '..', 'src', 'db.js'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    from() {
      throw new Error('nothing in these tests may reach the database');
    },
  },
};

const bagsPath = require.resolve(path.join(__dirname, '..', 'src', 'core', 'bags.js'));
const realBags = require('../src/core/bags');

let LABELS = [];

require.cache[bagsPath].exports = {
  ...realBags,
  forOrder: async () => LABELS,
};

const runCore = require('../src/core/run');
const { pickupBagBody } = require('../src/web/run-page');

const ORDER = {
  id: 'order-1',
  order_number: 2069,
  status: 'IN_PROCESS',
  driver_id: 'driver-1',
  here_texted_at: '2026-09-17T13:28:00.000Z',
  collected_at: '2026-09-17T13:28:02.000Z',
  bag_count: null,
  van_confirmed_at: null,
};

// #2069's two bags, as they stood the moment the second one came off the scale.
function bothWeighed() {
  return [
    {
      id: 'label-1',
      order_id: 'order-1',
      leg: 'PICKUP',
      code: '2XEBWZ',
      sticker_seq: null,
      position: 1,
      weight_lb: 8,
      clip_number: 1,
      clipped_at: null,
      unclipped_at: null,
      loaded_at: null,
    },
    {
      id: 'label-2',
      order_id: 'order-1',
      leg: 'PICKUP',
      code: 'KQKXM8',
      sticker_seq: null,
      position: 2,
      weight_lb: 11,
      clip_number: 3,
      clipped_at: null,
      unclipped_at: null,
      loaded_at: null,
    },
  ];
}

const weigh = (tasks, position) => tasks.find((t) => t.key === `weigh_${position}`);

// --- what the run works out --------------------------------------------------

test('a weighed bag carries the number that was reserved for it', async () => {
  LABELS = bothWeighed();
  const tasks = await runCore.tasksForCollect(ORDER);

  assert.equal(weigh(tasks, 1).clip, 1);
  assert.equal(weigh(tasks, 2).clip, 3);
});

test('and the finished step says so, because that is the record of the bag', async () => {
  LABELS = bothWeighed();
  const tasks = await runCore.tasksForCollect(ORDER);

  // The sticker, the weight and the number now riding on it. The last of the
  // three is what gets said out loud at a laundromat counter.
  assert.equal(weigh(tasks, 1).title, '2XEBWZ - 8 lb, Van Clip #1');
  assert.equal(weigh(tasks, 2).title, 'KQKXM8 - 11 lb, Van Clip #3');
});

test('a bag with no clip on it yet is titled exactly as it always was', async () => {
  // Belt and braces: the clip half of the sentence is conditional, so an order
  // predating any of this still reads properly.
  LABELS = bothWeighed().map((l) => ({ ...l, clip_number: null }));
  const tasks = await runCore.tasksForCollect(ORDER);

  assert.equal(weigh(tasks, 1).title, '2XEBWZ - 8 lb');
});

test('THE INSTRUCTION IS THE BAG HE IS HOLDING, not the first one he did', async () => {
  // He works the bags in order, so the highest position still outstanding is
  // the one that has just come off the scale.
  LABELS = bothWeighed();
  const tasks = await runCore.tasksForCollect(ORDER);

  for (const task of tasks) {
    assert.deepEqual(
      task.putClip,
      { clip: 3, code: 'KQKXM8', position: 2 },
      `${task.key} does not carry the outstanding clip`
    );
  }
});

test('and it rides on EVERY card at the stop, including the one after it', async () => {
  // This is the whole point. After weighing bag 2 the next card is "Another
  // bag? Scan its tag" - a different step, about a different bag - and that is
  // the screen he is looking at when he needs to reach for clip 3.
  LABELS = bothWeighed();
  const tasks = await runCore.tasksForCollect(ORDER);

  const next = tasks.find((t) => !t.done);
  assert.ok(next, 'there is always a next step during a pickup');
  assert.equal(next.putClip.clip, 3);
});

test('the others still waiting are listed, so a stop can be picked back up', async () => {
  LABELS = bothWeighed();
  const tasks = await runCore.tasksForCollect(ORDER);

  assert.deepEqual(
    tasks[0].clipsOn.map((c) => [c.clip, c.code]),
    [[1, '2XEBWZ'], [3, 'KQKXM8']]
  );
});

test('an unweighed bag is not asked for a clip, because it has not got one', async () => {
  LABELS = bothWeighed().map((l, i) => (i === 1 ? { ...l, weight_lb: null, clip_number: null } : l));
  const tasks = await runCore.tasksForCollect(ORDER);

  assert.deepEqual(tasks[0].putClip, { clip: 1, code: '2XEBWZ', position: 1 });
  assert.equal(tasks[0].clipsOn.length, 1);
});

test('FINISH PICKUP CLEARS IT, and nothing new had to be stored to do that', async () => {
  // clipped_at is exactly the column for "he has been told and it is on".
  // assignClip() deliberately leaves it null and finishPickup() stamps every
  // one of them as the stop ends, so the instruction clears itself.
  LABELS = bothWeighed().map((l) => ({ ...l, clipped_at: '2026-09-17T13:30:07.000Z' }));
  const tasks = await runCore.tasksForCollect({ ...ORDER, van_confirmed_at: '2026-09-17T13:30:10.000Z' });

  for (const task of tasks) {
    assert.equal(task.putClip, null, `${task.key} is still asking for a clip after the pickup`);
  }
});

// --- what the screen actually draws ------------------------------------------

test('THE PER-BAG SCREEN PRINTS THE NUMBER, at the size of a thing you act on', async () => {
  LABELS = bothWeighed();
  const tasks = await runCore.tasksForCollect(ORDER);

  const html = pickupBagBody({ order: ORDER, position: 3, tasks });

  assert.match(html, /Put this clip on the bag/);
  assert.match(html, /Van Clip #3/);
  assert.match(html, /KQKXM8/);
});

test('and it renders the note the weigh route sent it', async () => {
  LABELS = bothWeighed();
  const tasks = await runCore.tasksForCollect(ORDER);

  const html = pickupBagBody({
    order: ORDER,
    position: 3,
    tasks,
    notice: 'KQKXM8 saved at 11.0 lb, on Van Clip #3. 2 bags weighed so far.',
  });

  assert.match(html, /KQKXM8 saved at 11\.0 lb/);
});

test('nothing outstanding draws no block at all', async () => {
  LABELS = bothWeighed().map((l) => ({ ...l, clipped_at: '2026-09-17T13:30:07.000Z' }));
  const tasks = await runCore.tasksForCollect(ORDER);

  const html = pickupBagBody({ order: ORDER, position: 3, tasks });
  assert.ok(!/Put this clip on the bag/.test(html), 'the block is drawn with nothing to say');
});

// --- and the two places the sentence used to be dropped ----------------------

const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');

test('the per-bag route reads ?note=, which it never did', () => {
  const at = ADMIN.indexOf("router.get('/ops/run/pickup/:number/:position'");
  assert.ok(at > 0, 'the per-bag route has moved');

  const route = ADMIN.slice(at, ADMIN.indexOf('\nrouter.', at + 10));
  assert.match(route, /notice: req\.query\.note/);
});

test('AND IT NO LONGER GUARDS ON bag_count, WHICH IS ZERO FOR THE WHOLE PICKUP', () => {
  // finishPickup() writes bag_count at the END of the stop. Anything on this
  // route comparing a position against it is refusing every bag on every live
  // pickup, which is what it did.
  const at = ADMIN.indexOf("router.get('/ops/run/pickup/:number/:position'");
  const route = ADMIN.slice(at, ADMIN.indexOf('\nrouter.', at + 10));

  // The comments say the words; the CODE is what refuses a driver.
  const code = route
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

  assert.ok(!/bag_count/.test(code), 'the per-bag page is gated on bag_count again');
  assert.match(code, /tag_/, 'it should count the bags the task list says there are');
});

test('both weigh redirects still NAME the clip, for the order page', () => {
  const at = ADMIN.indexOf("'/ops/orders/:id/bag-weight'");
  assert.ok(at > 0, 'the bag-weight route has moved');

  const route = ADMIN.slice(at, ADMIN.indexOf('\nrouter.', at + 10));
  const notes = route.match(/on Van Clip #\$\{clipped\.clip\}/g) || [];

  // One for the bag that completes the load, one for every bag before it. The
  // delivery leg has its own sentence and is not counted here.
  //
  // THE FLASH IS A RECORD, NOT THE INSTRUCTION - clipCall() is that, and it
  // stays up. This is what the ORDER PAGE has instead, since it draws no block.
  assert.equal(notes.length, 2, 'a pickup weigh that does not name the clip at all');
});
