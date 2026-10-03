'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const bags = require('../src/core/bags');
const run = require('../src/core/run');
const { pickupBagBody } = require('../src/web/run-page');

test('a scanned bag with no pre-entered count can be weighed on its own order', async (t) => {
  t.mock.method(bags, 'forOrder', async () => [{ code: '1KFS7C', position: 1, weight_lb: null }]);
  const order = { id: 'second', order_number: 2091, bag_count: null };
  const tasks = await run.tasksForCollect(order);
  assert.equal(run.validPickupPosition(tasks, 1), true);
  assert.equal(run.validPickupPosition(tasks, 99), false);
  assert.equal(run.validPickupPosition(tasks, 1.5), false);
  const html = pickupBagBody({ order, position: 1, tasks });
  assert.match(html, /Order #2091/);
  assert.match(html, /What does bag 1KFS7C weigh/);
  assert.match(html, /\/ops\/orders\/2091\/bag-weight/);
});

test('an optional next bag does not add a required weight task', async (t) => {
  t.mock.method(bags, 'forOrder', async () => [{ code: 'EZWZ64', position: 1, weight_lb: 25 }]);
  const tasks = await run.tasksForCollect({ id: 'first', order_number: 2090 });
  assert.equal(tasks.some(t => t.key === 'weigh_2'), false);
  assert.equal(tasks.find(t => t.key === 'tag_2').canFinish, true);
});

test('returning from an action stays on that unfinished pickup', () => {
  const stops = [2090, 2091].map(order_number => ({ kind: 'collect', done: false, order: { order_number } }));
  assert.equal(run.currentStop(stops, 2091), stops[1]);
  assert.equal(run.currentStop(stops), stops[0]);
  stops[1].done = true;
  assert.equal(run.currentStop(stops, 2091), stops[0]);
});

test('a weighed bag is not described as in the van before pickup completion', () => {
  const html = pickupBagBody({ order: { order_number: 2090 }, position: 1, tasks: [
    { position: 1, key: 'tag_1', done: true }, { position: 1, key: 'weigh_1', done: true },
  ] });
  assert.doesNotMatch(html, /Bag #1 is in the van/);
  assert.match(html, /\/ops\/run\/order\/2090/);
});
