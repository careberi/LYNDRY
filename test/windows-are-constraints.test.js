'use strict';

// ---------------------------------------------------------------------------
// A PICKUP WINDOW IS A PROMISE, AND THE ROUTE HAS TO DRIVE INSIDE IT.
//
// Neil's decision lock, 16 September: "Customer pickup windows are
// constraints. Route optimization happens inside those constraints. The system
// should never optimize a route as though all of the day's pickups are
// available at the same time. Trisha's complaint is exactly the failure this
// rule is intended to prevent."
//
// WHAT HAPPENED. Order #2062 was promised 2 to 4pm - the right window, off the
// 3pm she asked for. It was collected at 09:46, four hours and fourteen
// minutes early, and she said so.
//
// The data was never wrong. `pickup_window_start` on that order reads 14:00,
// the confirmation text said 2 to 4pm, and the board drew her in the 2 to 4pm
// route. What was wrong is the one line that decides WHICH route a van is
// driving: after "the route you are catching up on" and "the route the clock
// is in" came a third fallback that looked FORWARD - the next route with any
// work left in it, whatever time of day that route was. The driver finished
// #2067 at 08:54, which emptied the 8 to 10 route; #2068 was not booked until
// 10:07, so the 10 to 12 and 12 to 2 routes were empty; and the only route on
// the whole day with anything in it was hers.
//
// So the van was sent to her door because there was nothing else to do, which
// is a route optimised as though all of the day's pickups were available at
// once. That is the sentence in the lock.
//
// Nothing here reads the database. `activeRoute()` was extracted out of
// `board()` for exactly that reason: it is the rule that decides where a van
// goes, it was wrong for two weeks with nothing failing, and it could only be
// reached through a query.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dispatch = require('../src/core/dispatch');
const booking = require('../src/core/booking');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// --- the day, built the way board() builds it -------------------------------

// One route per window, in the shape `board()` makes them. `work` says how many
// doorsteps are still outstanding in a given window; `begun` is the clock.
//
// It is built off the real PICKUP_WINDOWS rather than five typed-out times, so
// that moving a window moves this with it. Typing them out would make this a
// test of a copy.
function dayAt(clock, work = {}) {
  return booking.PICKUP_WINDOWS.map((w) => {
    const orders = Array.from({ length: work[w.start] || 0 }, (_, i) => ({
      id: `${w.start}-${i}`,
      pickup_window_start: w.start,
    }));

    return {
      start: w.start,
      end: w.end,
      label: `${w.start} to ${w.end}`,
      orders,
      unweighed: [],
      count: orders.length,
      begun: clock >= w.start,
      complete: orders.length === 0,
    };
  });
}

const at = (clock, work) => dispatch.activeRoute(dayAt(clock, work), { start: clock });

// --- 15 September, replayed -------------------------------------------------

// The morning as it actually was: #2067 collected at 08:54, so the 8 to 10
// route is empty; nothing booked in 10 to 12 or 12 to 2; Trisha's #2062 sitting
// in the 14:00 window.
const FIFTEENTH = { '14:00': 1 };

test('at 09:46 the van is on the morning route, not on hers', () => {
  const active = at('09:46', FIFTEENTH);

  assert.equal(active.start, '08:00');
});

test('the round at 09:46 holds nobody, and that is the right answer', () => {
  const active = at('09:46', FIFTEENTH);

  // An empty round is a real state and the honest one: there is nothing to
  // collect until two. It used to be treated as a reason to go and find work.
  assert.deepEqual(
    active.orders.map((o) => o.pickup_window_start),
    [],
    'a stop from a later window is in the sequence'
  );
});

test('her window is still ahead, so she is in what the rest of the day holds', () => {
  const day = dayAt('09:46', FIFTEENTH);
  const active = dispatch.activeRoute(day, { start: '09:46' });

  // This is `laterToday` in board(), written out: routes that are not the
  // active one and have not begun. She has to be somewhere - a stop that
  // silently vanishes reads as the board losing an order, which is the failure
  // the unassigned-order banner exists to prevent rather than cause.
  const laterToday = day.filter((r) => r !== active && !r.begun).flatMap((r) => r.orders);

  assert.equal(laterToday.length, 1);
  assert.equal(laterToday[0].pickup_window_start, '14:00');
});

test('at two o clock she is the round', () => {
  const active = at('14:00', FIFTEENTH);

  assert.equal(active.start, '14:00');
  assert.equal(active.orders.length, 1);
});

// THE BREAK TEST. The old rule, written out, against the same day. If this ever
// stops failing, every test above is passing for the wrong reason.
test('the forward look is what collected her, and it is gone', () => {
  const day = dayAt('09:46', FIFTEENTH);

  const withForwardLook =
    day.find((r) => r.begun && !r.complete) ||
    day.find((r) => !r.complete) ||
    day.find((r) => '09:46' >= r.start && '09:46' < r.end);

  assert.equal(withForwardLook.start, '14:00', 'the old rule no longer reproduces the bug');
  assert.notEqual(
    dispatch.activeRoute(day, { start: '09:46' }).start,
    withForwardLook.start,
    'the rule still looks forward'
  );
});

test('no fallback anywhere may pick a route that has not begun', () => {
  // The general form of the bug rather than the one day it happened on: every
  // seven minutes of a working day, against a day whose only work is late.
  for (let mins = 6 * 60; mins < 22 * 60; mins += 7) {
    const clock = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(
      mins % 60
    ).padStart(2, '0')}`;
    const active = at(clock, FIFTEENTH);

    if (active.orders.length) {
      assert.ok(
        clock >= active.start,
        `at ${clock} the round is the ${active.start} route, which has not started`
      );
    }
  }
});

// --- catching up still beats the clock --------------------------------------

test('an unfinished morning is still the round at lunchtime', () => {
  // The rule the forward look was bolted onto, and it is untouched: a route
  // with a bag still on a doorstep is somebody waiting right now.
  const active = at('12:30', { '08:00': 1, '14:00': 1 });

  assert.equal(active.start, '08:00');
});

test('the earliest unfinished route wins, not the latest', () => {
  const active = at('13:00', { '08:00': 1, '10:00': 1 });

  assert.equal(active.start, '08:00', 'the driver is sent past a door he has not been to');
});

test('with everything behind him done, it is the clock', () => {
  const active = at('12:30', { '14:00': 1 });

  assert.equal(active.start, '12:00');
});

test('an empty day lands on the clock route, not on nothing', () => {
  assert.equal(at('10:30', {}).start, '10:00');
});

test('after the last window closes it is the last route, never undefined', () => {
  const active = at('23:30', {});

  assert.equal(active.start, booking.PICKUP_WINDOWS[booking.PICKUP_WINDOWS.length - 1].start);
});

test('before the first window opens, nothing is dragged forward', () => {
  // Six in the morning is in no window at all, so this lands on the fallback.
  // What matters is that the fallback does not hand back a route with a 2pm
  // doorstep in it.
  const active = at('06:00', FIFTEENTH);

  assert.ok(active, 'no route at all');
  assert.equal(active.orders.length, 0, 'a 2pm stop is the round at six in the morning');
});

// --- asking for a route by name ---------------------------------------------

test('a hand-picked route is answered, not second-guessed', () => {
  // The routing board has a `from` picker. Answering a direct question with
  // "actually you are on this other one" would make the picker a suggestion.
  const day = dayAt('09:46', { '08:00': 1, '14:00': 1 });
  const active = dispatch.activeRoute(day, { start: '14:00', fromTime: '14:00' });

  assert.equal(active.start, '14:00');
});

test('reading the 4pm round is reading, not driving', () => {
  const day = dayAt('16:00', FIFTEENTH);

  assert.equal(dispatch.activeRoute(day, { start: '16:00', fromTime: '16:00' }).start, '16:00');
});

// --- the shape of the rule --------------------------------------------------

test('no routes at all is null rather than a crash', () => {
  assert.equal(dispatch.activeRoute([], { start: '09:00' }), null);
  assert.equal(dispatch.activeRoute(null, { start: '09:00' }), null);
});

test('the forward look cannot come back without this failing', () => {
  const src = withoutComments(SRC('core', 'dispatch.js'));
  const from = src.indexOf('function activeRoute');
  const fn = src.slice(from, src.indexOf('\nfunction ', from + 10));

  assert.ok(fn, 'activeRoute is gone');
  assert.ok(
    !/find\(\s*\(r\)\s*=>\s*!r\.complete\s*\)/.test(fn),
    'the forward look is back in activeRoute'
  );
  assert.ok(fn.includes('r.begun && !r.complete'), 'catching up is no longer the first rule');
});

test('only one thing in the whole file decides which route is active', () => {
  const src = withoutComments(SRC('core', 'dispatch.js'));

  assert.equal(
    (src.match(/const activeRound =/g) || []).length,
    1,
    'a second place works out the active route'
  );
  assert.ok(
    src.includes('activeRoute(routes, { start, fromTime })'),
    'board() no longer goes through the extracted rule'
  );
});

test('the sequenced stops are the active route and nothing else', () => {
  const src = withoutComments(SRC('core', 'dispatch.js'));

  // The one line that turns "which route" into "which doors". If this ever
  // reads from `routes`, or from all of today's pickups, the window stops being
  // a constraint however right activeRoute() is.
  assert.ok(src.includes('const pickups = activeRound.orders;'), 'the collect leg widened');
});
