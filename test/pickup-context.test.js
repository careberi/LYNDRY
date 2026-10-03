'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const bags = require('../src/core/bags');
const run = require('../src/core/run');
const { pickupBagBody } = require('../src/web/run-page');
const db = require('../src/db');
const { router } = require('../src/routes/admin');
const dispatch = require('../src/core/dispatch');

test('selecting a late morning pickup uses its window with afternoon ETAs', () => {
  const routes = [
    { start: '10:00', end: '12:00', begun: true, complete: false },
    { start: '14:00', end: '16:00', begun: true, complete: false },
  ];
  assert.equal(dispatch.activeRoute(routes, { start: '14:30', fromTime: '10:00' }), routes[0]);
});

function routeHandler(path, method) {
  const route = router.stack.find(layer => layer.route && layer.route.methods[method] &&
    [].concat(layer.route.path).includes(path)).route;
  return route.stack[route.stack.length - 1].handle;
}

function mockOrder(t, order) {
  t.mock.method(db, 'from', () => {
    const query = { select() { return query; }, eq() { return query; },
      async maybeSingle() { return { data: order, error: null }; } };
    return query;
  });
}

test('arriving at the second pickup preserves it through the route handler', async t => {
  const order = { id: '72f59dc0-18db-47dd-91d3-72e880b60b76', order_number: 2091,
    status: 'IN_PROCESS', driver_id: 'driver', van_confirmed_at: null };
  mockOrder(t, order);
  t.mock.method(run, 'arrive', async id => assert.equal(id, order.id));
  let destination;
  await routeHandler('/ops/run/here', 'post')(
    { body: { order_id: order.id }, opsUser: { id: 'driver', role: 'DRIVER' } },
    { redirect(code, url) { assert.equal(code, 303); destination = url; } },
    err => { throw err; });
  assert.equal(destination, '/ops/run/order/2091');
});

test('a selected pickup chooses its own window before the run is filtered', async t => {
  mockOrder(t, { order_number: 2091, status: 'REQUESTED', driver_id: 'driver',
    pickup_window_start: '10:00:00' });
  const stop = new Error('stop before rendering');
  t.mock.method(run, 'forDriver', async (driver, window, number) => {
    assert.equal(driver, 'driver'); assert.equal(window, '10:00'); assert.equal(number, '2091');
    throw stop;
  });
  let caught;
  await routeHandler('/ops/run/order/:number', 'get')(
    { params: { number: '2091' }, query: {}, opsUser: { id: 'driver', role: 'DRIVER' } },
    {}, err => { caught = err; });
  assert.equal(caught, stop);
});

test('an unavailable selected pickup never displays a different customer', async t => {
  mockOrder(t, { order_number: 2091, status: 'REQUESTED', driver_id: 'driver', pickup_window_start: '08:00' });
  t.mock.method(run, 'forDriver', async () => ({ current: { kind: 'collect', order: { order_number: 2090 } } }));
  let status, html;
  const res = { status(code) { status = code; return res; }, type() { return res; }, send(body) { html = body; } };
  await routeHandler('/ops/run/order/:number', 'get')(
    { params: { number: '2091' }, query: {}, opsUser: { id: 'driver', role: 'DRIVER' } }, res,
    err => { throw err; });
  assert.equal(status, 404);
  assert.match(html, /pickup is not available/);
  assert.doesNotMatch(html, /2090/);
});

test('a selected pickup cannot jump to another driver', async t => {
  mockOrder(t, { order_number: 2091, status: 'REQUESTED', driver_id: 'someone-else' });
  t.mock.method(run, 'forDriver', async () => assert.fail('another driver must be rejected before the run loads'));
  let status;
  const res = { status(code) { status = code; return res; }, type() { return res; }, send() {} };
  await routeHandler('/ops/run/order/:number', 'get')(
    { params: { number: '2091' }, query: {}, opsUser: { id: 'driver', role: 'DRIVER' } }, res,
    err => { throw err; });
  assert.equal(status, 404);
});

test('arrival on a later leg retains the normal route progression', async t => {
  const order = { id: '72f59dc0-18db-47dd-91d3-72e880b60b76', order_number: 2091,
    status: 'OUT_FOR_DELIVERY', driver_id: 'driver', van_confirmed_at: 'done' };
  mockOrder(t, order);
  t.mock.method(run, 'arrive', async () => {});
  let destination;
  await routeHandler('/ops/run/here', 'post')(
    { body: { order_id: order.id }, opsUser: { id: 'driver', role: 'DRIVER' } },
    { redirect(code, url) { destination = url; } }, err => { throw err; });
  assert.equal(destination, '/ops/run');
});

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
