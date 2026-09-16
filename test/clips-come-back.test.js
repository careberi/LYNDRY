'use strict';

// ---------------------------------------------------------------------------
// A CLIP THAT COMES OFF GOES BACK IN THE POOL.
//
// Found on 16 September by the start-of-shift inventory screen, on its first
// run against real data: fifteen of fifty clips - 1 to 14 and 16 - were held
// against DELIVERED orders, so the van was down to thirty five and falling by
// one per bag delivered.
//
// THE MECHANISM, because it is subtle and will be re-broken otherwise.
// bag_labels has two columns for a clip coming off:
//
//   unclipped_at        it is off the bag
//   clip_returned_at    it is physically back in the van
//
// bags.clipsInUse() - the ONLY thing that decides which numbers are free -
// keys on clip_returned_at and deliberately not on unclipped_at, because a clip
// pulled off at a laundromat counter is in the driver's pocket and handing it
// to another bag is how two bags end up wearing the same number.
//
// unclipOrder() stamped only the first of those. Every caller of it believed
// the clip was back in the van; none of them said so in the column that counts.
//
// The gap between the two was only ever real for the old three-card plant drop,
// whose "clips back in the van" tap and route are both gone.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const bagsSrc = () => withoutComments(SRC('core', 'bags.js'));

const fn = (src, name) => {
  const at = src.indexOf(`async function ${name}`);
  assert.ok(at > 0, `${name} is missing`);
  // To the next top-level function, which is a real boundary rather than a
  // guessed number of characters.
  const next = src.indexOf('\nasync function ', at + 10);
  const plain = src.indexOf('\nfunction ', at + 10);
  const ends = [next, plain].filter((n) => n > 0);
  return src.slice(at, ends.length ? Math.min(...ends) : src.length);
};

// --- the fix ----------------------------------------------------------------

test('taking the clips off an order puts the numbers back in the pool', () => {
  const unclip = fn(bagsSrc(), 'unclipOrder');

  assert.ok(unclip.includes('clip_returned_at'), 'the clip never returns to the pool');
  assert.ok(unclip.includes('unclipped_at:'), 'it must still record coming off the bag');
});

test('both stamps are the same instant, not two clocks', () => {
  const unclip = fn(bagsSrc(), 'unclipOrder');

  // One `new Date()`, read into a variable and used twice. Two separate calls
  // would put two different times on one physical act.
  assert.equal(
    (unclip.match(/new Date\(\)/g) || []).length,
    1,
    'the two columns must carry one timestamp'
  );
  assert.ok(/unclipped_at: now, clip_returned_at: now/.test(unclip), unclip);
});

test('it still never clears the clip number itself', () => {
  const unclip = fn(bagsSrc(), 'unclipOrder');

  assert.ok(
    !/clip_number: null/.test(unclip),
    'the order page has to be able to say which clip a bag travelled under'
  );
});

test('it only touches clips that are still on, so it is safe to run twice', () => {
  const unclip = fn(bagsSrc(), 'unclipOrder');

  assert.ok(unclip.includes("is('unclipped_at', null)"), unclip);
  assert.ok(unclip.includes("not('clip_number', 'is', null)"), unclip);
});

// --- the rule it has to agree with -----------------------------------------

// THIS IS THE WHOLE REASON THE BUG EXISTED. If clipsInUse() is ever changed to
// key on unclipped_at, the two halves stop disagreeing and this test should
// fail loudly rather than the pool quietly changing meaning.
test('the pool is still decided by clip_returned_at and nothing else', () => {
  const inUse = fn(bagsSrc(), 'clipsInUse');

  assert.ok(inUse.includes("is('clip_returned_at', null)"), inUse);
  assert.ok(
    !inUse.includes("is('unclipped_at', null)"),
    'a clip off a bag at a counter is in a pocket, not in the van'
  );
});

test('handing a bag over at the plant frees the clip the same way', () => {
  const handOff = fn(bagsSrc(), 'handOffBag');

  assert.ok(handOff.includes('clip_returned_at'), handOff);
  assert.ok(handOff.includes('unclipped_at'), handOff);
});

test('the two ways a clip comes off agree with each other', () => {
  const src = bagsSrc();

  for (const name of ['unclipOrder', 'handOffBag']) {
    const body = fn(src, name);
    assert.ok(body.includes('clip_returned_at'), `${name} leaves the clip out of the pool`);
  }
});

// --- every caller means the same thing --------------------------------------

// All four say, in their own words, that the number is back in the van. That is
// why the fix belongs in unclipOrder() rather than in the delivery step alone -
// patching one would leave the same leak reachable from the other three.
test('every path that unclips an order expects the number back', () => {
  const callers = [
    ['core', 'fulfilment.js'],
    ['routes', 'admin.js'],
  ];

  let found = 0;
  for (const bits of callers) {
    found += (SRC(...bits).match(/unclipOrder\(/g) || []).length;
  }

  assert.ok(found >= 3, `expected the known callers, found ${found}`);
});

test('nothing else in the codebase writes clip_returned_at behind its back', () => {
  // Only bags.js may move a clip in or out of the pool. A second writer is how
  // the two ideas of "free" drift apart again.
  for (const bits of [['core', 'fulfilment.js'], ['routes', 'admin.js'], ['core', 'run.js']]) {
    const src = withoutComments(SRC(...bits));
    assert.ok(
      !/clip_returned_at:\s/.test(src),
      `${bits.join('/')} writes clip_returned_at directly`
    );
  }
});
