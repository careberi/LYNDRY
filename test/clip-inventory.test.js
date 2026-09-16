'use strict';

// ---------------------------------------------------------------------------
// CLIPS IN THE VAN - START OF SHIFT, AND NOWHERE ELSE.
//
// Neil, 16 September: "Clip inventory - start of shift only. Expected clips in
// the van: 1-50. Show which numbers the system thinks are free, on a bag, or
// missing. Do not add a tap on every stop. This is not part of pickup, drop,
// retrieval, or delivery."
//
// Most of what is pinned here is the MUST-NOTs, because each one is a way this
// screen turns into the thing he ruled out:
//
//   no tap             nothing on the page posts, and the run's task lists do
//                      not mention it. A control here is the per-stop tap
//                      arriving by the back door
//   one owner          "is clip 4 free" is bags.clipsInUse()'s question, and
//                      this page must not answer it differently. It filters on
//                      clip_returned_at and deliberately NOT on unclipped_at
//   his own van        scoped to the signed-in driver, with no ?driver=
//   a driver screen    no customer, no address, no money
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const clips = require('../src/core/clips');
const { clipsPage } = require('../src/web/clips-page');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

// Comments in this codebase describe the traps at length, and a source sweep
// that reads its own warning is a test that passes for the wrong reason - it
// has happened here before.
const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const onLive = (clip, n, extra) => ({
  clip_number: clip,
  code: 'AB12CD',
  sticker_seq: 1,
  unclipped_at: null,
  orders: { order_number: n, status: 'IN_PROCESS' },
  ...extra,
});

const byClip = (stock, n) => stock.clips.find((c) => c.clip === n);

// --- what a number means ---------------------------------------------------

test('a clip on a live order is out on a bag, not missing', () => {
  const stock = clips.fromRows([onLive(3, 2070)], 10);

  assert.equal(byClip(stock, 3).state, 'on_a_bag');
  assert.equal(byClip(stock, 3).orderNumber, 2070);
  assert.equal(stock.onBags, 1);
  assert.equal(stock.unaccounted, 0);
});

test('a number nothing is holding should be in the van', () => {
  const stock = clips.fromRows([onLive(3, 2070)], 10);

  assert.equal(byClip(stock, 1).state, 'in_the_van');
  assert.equal(byClip(stock, 10).state, 'in_the_van');
  assert.equal(stock.inTheVan, 9);
});

test('every number in the pool is listed exactly once', () => {
  const stock = clips.fromRows([onLive(3, 2070), onLive(7, 2071)], 50);

  assert.equal(stock.total, 50);
  const numbers = stock.clips.map((c) => c.clip);
  assert.deepEqual(numbers, Array.from({ length: 50 }, (_, i) => i + 1));
  assert.equal(stock.onBags + stock.inTheVan + stock.unaccounted, 50);
});

// THE TWO WAYS A CLIP GOES MISSING. Both end in the same bucket, because the
// driver's next move is the same, but the row has to say which - "nobody freed
// it at the counter" and "the order finished wearing it" are different faults.
test('a clip taken off a bag and never put back is unaccounted for', () => {
  const stock = clips.fromRows(
    [
      onLive(4, 2066, {
        unclipped_at: '2026-09-15T10:00:00Z',
        orders: { order_number: 2066, status: 'AT_PARTNER' },
      }),
    ],
    10
  );

  assert.equal(byClip(stock, 4).state, 'unaccounted');
  assert.equal(byClip(stock, 4).why, 'never_returned');
  assert.equal(stock.unaccounted, 1);
  assert.equal(stock.inTheVan, 9, 'it must not be counted as in the van');
});

test('a clip still on a finished order is unaccounted for', () => {
  for (const status of clips.FINISHED) {
    const stock = clips.fromRows([onLive(5, 2001, { orders: { order_number: 2001, status } })], 10);

    assert.equal(byClip(stock, 5).state, 'unaccounted', status);
    assert.equal(byClip(stock, 5).why, 'order_finished', status);
  }
});

test('a clip number above the pool is unaccounted for, never in the van', () => {
  const stock = clips.fromRows([onLive(52, 2071)], 50);

  const stray = byClip(stock, 52);
  assert.equal(stray.state, 'unaccounted');
  assert.equal(stray.why, 'outside_pool');
  assert.equal(stray.outsidePool, true);
  assert.equal(stock.inTheVan, 50, 'the pool itself is untouched by a stray number');
});

test('a row with no readable clip number is ignored rather than guessed at', () => {
  const stock = clips.fromRows(
    [{ clip_number: null, orders: {} }, { clip_number: 'x', orders: {} }, onLive(2, 2070)],
    5
  );

  assert.equal(stock.onBags, 1);
  assert.equal(stock.inTheVan, 4);
  assert.equal(stock.unaccounted, 0);
});

test('a bag with no order still leaves the number held, never silently free', () => {
  const stock = clips.fromRows([{ clip_number: 6, code: 'ZZ99ZZ', sticker_seq: null, orders: null }], 10);

  assert.notEqual(byClip(stock, 6).state, 'in_the_van');
  assert.equal(byClip(stock, 6).state, 'on_a_bag');
});

// --- one owner for "is clip 4 free" ----------------------------------------

test('the query filters on clip_returned_at, the same test that hands clips out', () => {
  const src = withoutComments(SRC('core', 'clips.js'));
  const query = src.slice(src.indexOf("from('bag_labels')"), src.indexOf('if (error) throw error'));

  assert.ok(query.includes("is('clip_returned_at', null)"), query);
  assert.ok(
    !query.includes("is('unclipped_at', null)"),
    'a clip off a bag but not confirmed back is still OUT to bags.clipsInUse(), ' +
      'so filtering it away here would make this page disagree with the allocator'
  );

  // And the allocator itself still draws the line where this assumes it does.
  const pool = withoutComments(SRC('core', 'bags.js'));
  const inUse = pool.slice(pool.indexOf('async function clipsInUse'), pool.indexOf('return new Set('));
  assert.ok(inUse.includes("is('clip_returned_at', null)"), inUse);
  assert.ok(!inUse.includes("is('unclipped_at', null)"), inUse);
});

test('the pool size is read from config, never a typed 50', () => {
  const src = withoutComments(SRC('core', 'clips.js'));

  assert.ok(src.includes('config.routing.vanClips'), src);
  assert.ok(!/\b50\b/.test(src), 'a second copy of the pool size would drift the day Neil buys more clips');
});

// --- it is a screen, not a step --------------------------------------------

test('nothing on the page posts, submits or changes an order', () => {
  const html = clipsPage(
    clips.fromRows(
      [
        onLive(3, 2070),
        onLive(4, 2066, { unclipped_at: 'x', orders: { order_number: 2066, status: 'AT_PARTNER' } }),
      ],
      10
    )
  );

  for (const control of ['<form', '<button', '<input', 'method=', 'action=', 'onclick']) {
    assert.ok(!html.includes(control), `the page must not carry ${control}`);
  }

  // The only links it may draw are ones that go and READ an order.
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  for (const href of hrefs) {
    assert.ok(/^\/ops\/orders\/\d+$/.test(href), `unexpected link: ${href}`);
  }
});

test('the run never sends a driver here, so it is not a tap on a stop', () => {
  for (const file of [
    ['core', 'run.js'],
    ['web', 'run-page.js'],
  ]) {
    const src = withoutComments(SRC(...file));
    assert.ok(!src.includes('/ops/clips'), `${file.join('/')} must not link the inventory into the round`);
    assert.ok(!src.includes('core/clips'), `${file.join('/')} must not read the inventory`);
  }
});

test('the route is the signed-in driver, behind orders.drive, with no ?driver=', () => {
  const src = withoutComments(SRC('routes', 'admin.js'));
  const start = src.indexOf("router.get('/ops/clips'");
  assert.ok(start > 0, 'the route is missing');
  const route = src.slice(start, src.indexOf('});', src.indexOf('catch (err)', start)));

  assert.ok(route.includes("may('orders.drive')"), route);
  assert.ok(route.includes('clips.inventory(req.opsUser.id)'), route);
  assert.ok(!route.includes('req.query'), 'this is not a screen for looking at another van');
});

test('it is in the menu behind the same permission as the route', () => {
  const src = withoutComments(SRC('routes', 'admin.js'));
  const entry = src.slice(src.indexOf("href: '/ops/clips'"), src.indexOf("href: '/ops/clips'") + 120);

  assert.ok(entry.includes("permission: 'orders.drive'"), entry);
});

// --- a driver screen -------------------------------------------------------

test('nothing about the customer or the money is loaded or shown', () => {
  const src = withoutComments(SRC('core', 'clips.js'));
  for (const column of ['customer', 'price_cents', 'address', 'phone', 'weight_lb']) {
    assert.ok(!src.includes(column), `${column} has no business on a clip count`);
  }

  const html = clipsPage(clips.fromRows([onLive(3, 2070)], 10));
  assert.ok(!/\$/.test(html), 'no money on a driver screen');
});

test('a bag code out of the database is escaped before it reaches the page', () => {
  const html = clipsPage(
    clips.fromRows([{ clip_number: 3, code: '<script>x</script>', sticker_seq: null, orders: {} }], 5)
  );

  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

// --- the type is the stylesheet's, not the page's --------------------------

// `font: 700 20px/1.2 inherit` is thrown away whole by every browser, and it
// has already shipped once on the ops notes. .ops-terminal sets h1, h2 and the
// table with !important for exactly that reason, so this page writes none.
test('the page writes no inline type for the terminal skin to fight', () => {
  const markup = withoutComments(SRC('web', 'clips-page.js'));

  assert.ok(!/font:/.test(markup), 'no font shorthand, valid or otherwise');
  assert.ok(
    !/font-size|font-weight|font-family/.test(markup),
    String(markup.match(/font-[a-z]+:[^;"]*/g))
  );
});

test('it renders as a terminal page, so the skin applies at all', () => {
  const src = withoutComments(SRC('routes', 'admin.js'));
  const start = src.indexOf("router.get('/ops/clips'");
  const route = src.slice(start, src.indexOf('});', src.indexOf('catch (err)', start)));

  assert.ok(route.includes('terminal: true'), route);
});
