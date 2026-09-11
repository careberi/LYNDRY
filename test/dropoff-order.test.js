'use strict';

// ---------------------------------------------------------------------------
// THE ORDER THE LAUNDROMATS ARE DRIVEN IN.
//
// Neil, 11 September: drop #2059 at Best Wash before #1975 at Fancy K, though
// the other way round is shorter. A rank a person set must beat the distance;
// no ranks must leave the route exactly as it was.
//
// Nothing here touches the database or a map.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { orderDropStops } = require('../src/core/dispatch');

const stop = (name, orders, at = { lat: 0, lng: 0 }) => ({ kind: 'dropoff', partner: { name }, orders, at });
const names = (stops) => stops.map((s) => s.partner.name);

// Stands in for the shortest-route solver: reverses, so its use is visible.
const reverse = (stops) => [...stops].reverse();

test('a ranked stop goes first, whatever the shortest order says', () => {
  const fancyK = stop('Fancy K', [{ order_number: 1975, dropoff_rank: 2 }]);
  const bestWash = stop('Best Wash', [{ order_number: 2059, dropoff_rank: 1 }]);
  const ordered = orderDropStops([fancyK, bestWash], { from: null, onward: null, sequence: reverse });
  assert.deepEqual(names(ordered), ['Best Wash', 'Fancy K']);
  assert.ok(ordered.every((s) => s.orderedByHand));
});

test('no ranks anywhere: the shortest order decides, as before', () => {
  const a = stop('A', [{ order_number: 1 }]);
  const b = stop('B', [{ order_number: 2 }]);
  assert.deepEqual(names(orderDropStops([a, b], { from: null, onward: null, sequence: reverse })), ['B', 'A']);
});

test('ranked stops come before the rest, and the rest are still sequenced', () => {
  const first = stop('Ranked', [{ order_number: 1, dropoff_rank: 1 }]);
  const x = stop('X', [{ order_number: 2 }]);
  const y = stop('Y', [{ order_number: 3 }]);
  const ordered = orderDropStops([x, y, first], { from: null, onward: null, sequence: reverse });
  assert.deepEqual(names(ordered), ['Ranked', 'Y', 'X']);
});

test('one stop is just one stop', () => {
  const only = stop('Only', [{ order_number: 1 }]);
  let called = false;
  const ordered = orderDropStops([only], {
    from: null,
    onward: null,
    sequence: () => {
      called = true;
      return [];
    },
  });
  assert.deepEqual(names(ordered), ['Only']);
  assert.equal(called, false);
});
