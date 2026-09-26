'use strict';

// ---------------------------------------------------------------------------
// THE UBER SCREEN.
//
// Neil, 25 September: "ad pages that help me see/mange the uber situation".
//
// THE FIRST DRAFT INVENTED FIVE CSS CLASSES. `ops-card`, `ops-quiet`, `ops-good`,
// `ops-bad` and `btn-danger` are not in any stylesheet - it read as plausible and
// would have rendered as unstyled text, which is exactly what happened to the wash
// instructions on the laundromat portal when they used `.kv`, a class that exists
// but is scoped to `.console`. Neil found that one on screen.
//
// So the load-bearing test here is the CSS one: every class this page names has to
// exist somewhere in `public/css`. It is derived from the source rather than being
// a list, so a class added tomorrow is covered without anybody remembering.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const board = require('../src/web/couriers-board');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'web', 'couriers-board.js'), 'utf8');

// Every stylesheet the ops screens actually load.
function allCss() {
  const dir = path.join(ROOT, 'public', 'css');
  const files = [];

  const walk = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const here = path.join(at, entry.name);
      if (entry.isDirectory()) walk(here);
      else if (entry.name.endsWith('.css')) files.push(fs.readFileSync(here, 'utf8'));
    }
  };

  walk(dir);
  return files.join('\n');
}

const CSS = allCss();

// A leg as `courierLegs.recent()` returns one.
const leg = (over = {}) => ({
  id: 'leg-1',
  orderId: 'o-1',
  orderNumber: 9000,
  orderStatus: 'READY',
  leg: 'TO_PARTNER',
  deliveryId: 'del_abc',
  status: 'pending',
  feeCents: 899,
  pin: '0160',
  trackingUrl: 'https://uber.example/track',
  pickupPhotoUrl: null,
  dropoffPhotoUrl: null,
  refusedReason: null,
  requestedAt: '2026-09-25T18:00:00Z',
  updatedAt: null,
  ...over,
});

const render = (over = {}) =>
  board.couriersBody({
    legs: [leg()],
    courier: { name: 'uber-test', isFake: true, configured: true },
    spendToday: 1998,
    ...over,
  });

// --- 1. every class it names is real ----------------------------------------

test('EVERY CSS CLASS ON THIS PAGE EXISTS IN A STYLESHEET', () => {
  // THE MISTAKE THIS EXISTS FOR, made writing this very file: five invented class
  // names that render as unstyled text and look fine in a diff. The same shape as
  // `.kv` on the laundromat portal, which is real but scoped to `.console`.
  const named = new Set();

  for (const m of SRC.matchAll(/class="([^"]+)"/g)) {
    for (const cls of m[1].split(/\s+/)) if (cls) named.add(cls);
  }

  assert.ok(named.size >= 5, `only found ${named.size} classes, which looks like a parse failure`);

  const missing = [...named].filter((cls) => !new RegExp(`\\.${cls}[^a-zA-Z0-9_-]`).test(CSS));

  assert.deepEqual(
    missing,
    [],
    'these classes are used on the couriers page and are in no stylesheet, so they render as ' +
      'nothing at all. Check public/css/ops.css for the real name - and remember .kv and the ' +
      'other .console-scoped rules do not travel outside the order console.'
  );
});

test('and this check can actually see an invented class', () => {
  // A GUARD NOBODY HAS WATCHED FAIL IS A GUARD NOBODY SHOULD TRUST. The five names
  // below are the ones the first draft of this page really used. They are exercised
  // against the same stylesheets rather than by writing a bad file to disk.
  const invented = ['ops-card', 'ops-quiet', 'ops-good', 'ops-bad', 'btn-danger'];

  for (const cls of invented) {
    assert.ok(
      !new RegExp(`\\.${cls}[^a-zA-Z0-9_-]`).test(CSS),
      `${cls} now exists in a stylesheet, so this test can no longer prove it catches one`
    );
  }

  // And it does not reject the real ones.
  for (const cls of ['card', 'card-xl', 'ops-table', 'ops-note', 'eyebrow', 'btn']) {
    assert.ok(
      new RegExp(`\\.${cls}[^a-zA-Z0-9_-]`).test(CSS),
      `${cls} is a real class and the check cannot find it`
    );
  }
});

// --- 2. what an attendant's supplier screen must not become ------------------

test('IT NAMES NO CUSTOMER, NO ADDRESS AND NO PHONE NUMBER', () => {
  // This is the one ops page about an outside company. Keeping a person off it is
  // what stops it also being a list of who lives where - and `recent()` does not
  // select those columns, so the page could not render one if it tried.
  const forbidden = ['customer_name', 'address_line1', 'postal_code', 'customers(', '.phone'];

  for (const word of forbidden) {
    assert.ok(!SRC.includes(word), `the couriers page reaches for ${word}`);
  }

  // And the query behind it does not load them either.
  const core = fs.readFileSync(path.join(ROOT, 'src', 'core', 'courier-legs.js'), 'utf8');
  const fn = /async function recent\([\s\S]*?\n}/.exec(core);

  assert.ok(fn, 'recent() has been renamed or removed');
  assert.ok(
    !/address|name|phone/i.test(fn[0].replace(/orderNumber|partner_id|customer_id|order_number/g, '')),
    'recent() selects a customer detail the screen has no use for'
  );
});

// --- 3. an unknown status is still out there --------------------------------

test('A STATUS NOBODY HAS SEEN COUNTS AS LIVE, NOT AS FINISHED', () => {
  // Written as the list of FINISHED ones for exactly this: the safe direction for
  // "is anything still outstanding" is to assume yes. A courier status we have not
  // met before must not quietly drop off the count.
  assert.equal(board.isLive(leg({ status: 'pending' })), true);
  assert.equal(board.isLive(leg({ status: 'pickup' })), true);
  assert.equal(board.isLive(leg({ status: 'something_uber_invented' })), true);

  assert.equal(board.isLive(leg({ status: 'delivered' })), false);
  assert.equal(board.isLive(leg({ status: 'canceled' })), false);
  assert.equal(board.isLive(leg({ status: 'CANCELLED' })), false, 'case is deciding it');

  // A refusal was never out there.
  assert.equal(board.isLive(leg({ deliveryId: null })), false);
  assert.equal(board.isLive(null), false);
});

// --- 4. a refusal is visible, which is the whole point ----------------------

test('A REFUSED BOOKING SAYS SO, AND SAYS WHY', () => {
  // The invisible half. `record()` writes a row with a null delivery_id and a
  // reason when Uber turns a booking down, and without this screen the order simply
  // sat there looking unbooked.
  const html = render({
    legs: [leg({ deliveryId: null, status: null, pin: null, refusedReason: 'address_undeliverable' })],
  });

  assert.match(html, /Refused/);
  assert.match(html, /address_undeliverable/);

  // And it offers no controls, because there is nothing at Uber to ask about or
  // cancel. Absent rather than disabled, the rule the driver's screens follow.
  assert.doesNotMatch(html, /couriers\/leg-1\/refresh/);
  assert.doesNotMatch(html, /couriers\/leg-1\/cancel/);
});

test('and a finished leg cannot be called off', () => {
  const html = render({ legs: [leg({ status: 'delivered' })] });

  assert.match(html, /couriers\/leg-1\/refresh/, 'a delivered leg cannot be re-read');
  assert.doesNotMatch(html, /couriers\/leg-1\/cancel/, 'a delivered leg still offers a cancel');
});

// --- 5. the PIN, and where its absence is a problem -------------------------

test('A COLLECTION WITH NO CODE IS FLAGGED; A RETURN WITH NONE IS NORMAL', () => {
  // The PIN is only ever on the leg INTO the laundromat, where somebody is standing
  // at a counter to read it. Uber refuses one on a leave-at-door delivery, so its
  // absence on the return leg is by design and a warning there would be noise on
  // every second row.
  const collectionMissing = render({ legs: [leg({ leg: 'TO_PARTNER', pin: null })] });
  assert.match(collectionMissing, /none/, 'a collection with no code is not flagged');

  const returnLeg = render({ legs: [leg({ leg: 'TO_CUSTOMER', pin: null })] });
  assert.match(returnLeg, /n\/a/, 'a return leg is being treated as missing a code');
  assert.doesNotMatch(returnLeg, />none</, 'a return leg is flagged for a code it never has');
});

// --- 6. it says whether a car is real --------------------------------------

test('IT SAYS WHEN NOTHING BOOKED HERE REACHES A DRIVER', () => {
  // The first question, and nothing anywhere answered it. A development environment
  // books couriers that dispatch nobody, and the way you find out is that no car
  // ever arrives.
  const fake = render({ courier: { name: 'uber-test', isFake: true, configured: true } });
  assert.match(fake, /Nothing booked here reaches a driver/);
  assert.match(fake, /uber-test/, 'the driver is not named, so test and live look alike');

  const real = render({ courier: { name: 'uber', isFake: false, configured: true } });
  assert.doesNotMatch(real, /Nothing booked here reaches a driver/);
});

// --- 7. the controls never move an order -----------------------------------

test('REFRESHING FROM UBER MOVES NO ORDER AND TEXTS NOBODY', () => {
  // THE CAREFUL PART, and the same rule the portal's courier button already keeps:
  // OUT_FOR_DELIVERY texts the customer "out for delivery today", so deciding what
  // a courier status MEANS to an order is a different act from recording it. When
  // the webhook lands it will do the deciding; this only ever updates the row.
  const core = fs.readFileSync(path.join(ROOT, 'src', 'core', 'courier-legs.js'), 'utf8');
  const fn = /async function refresh\([\s\S]*?\n}/.exec(core);

  assert.ok(fn, 'refresh() has been renamed or removed');

  for (const forbidden of ['transition(', 'sendAndLog', 'notify', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    assert.ok(
      !fn[0].includes(forbidden),
      `refresh() reaches for ${forbidden} - reading where a courier is must not move an order`
    );
  }
});

test('and a courier we cannot reach leaves the row alone', () => {
  // A stale status is at least a fact about something Uber once told us.
  // Overwriting it with a guess is worse than leaving it.
  const core = fs.readFileSync(path.join(ROOT, 'src', 'core', 'courier-legs.js'), 'utf8');
  const fn = /async function refresh\([\s\S]*?\n}/.exec(core)[0];

  // THE WHOLE CATCH BLOCK, not a fixed number of characters from it. The first
  // version took 220 characters and caught only the comment explaining the rule,
  // which is the same prose-not-code mistake this repo has now made three times.
  const open = fn.indexOf('catch (err) {');
  assert.notEqual(open, -1, 'refresh() no longer catches an unreachable courier');

  const caught = fn.slice(open, fn.indexOf('\n  }', open));
  assert.match(caught, /return \{ ok: false/, 'an unreachable courier falls through to a write');
  assert.ok(!/\.update\(/.test(caught), 'an unreachable courier writes to the row anyway');
});

// --- 8. the nav entry and the route agree -----------------------------------

test('THE MENU CANNOT OFFER A SCREEN ITS OWNER WOULD BE REFUSED AT', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'admin.js'), 'utf8');

  const entry = /\{ href: '\/ops\/couriers', label: '[^']+', permission: '([^']+)' \}/.exec(admin);
  assert.ok(entry, 'the Couriers menu entry has been removed or renamed');

  const route = /router\.get\('\/ops\/couriers',[^)]*may\('([^']+)'\)/.exec(admin);
  assert.ok(route, 'the /ops/couriers route has no may() guard');

  assert.equal(
    entry[1],
    route[1],
    'the menu lists Couriers under a different permission from the one the route enforces'
  );
});

test('and calling a courier off is a decision about the order, not about money', () => {
  // The line the charge and hold retries already draw: reading what a vendor cost
  // is one thing, cancelling a car that may be at a door is another.
  const admin = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'admin.js'), 'utf8');

  const cancel = /router\.post\('\/ops\/couriers\/:id\/cancel',[^)]*may\('([^']+)'\)/.exec(admin);
  assert.ok(cancel, 'the cancel route has no may() guard');
  assert.equal(cancel[1], 'orders.override', 'cancelling a courier is no longer Admin only');
});
