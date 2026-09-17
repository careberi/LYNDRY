'use strict';

// ---------------------------------------------------------------------------
// WHICH PROMOTION IS COMING OFF, ON AN ORDER NOTHING HAS COME OFF YET.
//
// Neil, 17 September: "order 2069 should also have the clean50 promotion
// applied to it."
//
// IT ALREADY WAS. Pamela holds a live CLEAN50 grant and discountFor() takes 50%
// off the moment the bag is weighed - run against the real row it answers
// $16.50 off a $33.00 load. What was wrong is that nothing on the screen said
// so, because the order page reads promotion_id, and promotion_id is written by
// loadVan() at the doorstep. Before that moment every order looks as though it
// has no promotion at all, which is the opposite of the truth for anybody
// holding one.
//
// THE BOARD SENT THE QUESTION HERE. Neil's table lock, 14 September, took the
// forecast off the board because a column headed Promotion must mean APPLIED -
// and the note left behind named this page: "the order or the customer page,
// where there is room to say 'expected' and have it read as a forecast rather
// than as a fact." It was never built. This is it.
//
// THE TWO MUST NEVER BE DRAWN TOGETHER. One is what came off and one is a
// guess about a price nobody has weighed.
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { orderConsoleBody } = require('../src/web/order-console');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(line))
    .join('\n');

// The console body, rendered. Everything it needs and nothing it does not.
function render(extra = {}) {
  return orderConsoleBody({
    order: {
      id: 'o-1',
      order_number: 2069,
      status: 'REQUESTED',
      payment_status: 'UNPAID',
      price_cents: null,
      discount_cents: 0,
      weight_lb: null,
      bag_count: null,
      created_at: '2026-09-17T00:49:32.000Z',
      pickup_date: '2026-09-17',
      pickup_window_start: '08:00',
      pickup_window_end: '10:00',
      customers: { id: 'c-1', name: 'Pamela Picano', phone: '+15513380327', preferences: {} },
      promotionName: null,
      expectedPromotion: null,
      ...extra,
    },
    customer: { id: 'c-1', name: 'Pamela Picano', phone: '+15513380327', preferences: {} },
    can: { act: true, override: true, customers: true, messages: true, money: true, audit: true, text: true },
    tasks: [],
    events: [],
    messages: [],
    labels: [],
    team: [],
    sideExtras: '',
    banner: '',
    view: 'human',
    laundromats: [],
    limits: {},
    paymentRows: [],
    // The console is handed its formatters rather than importing them, so the
    // ops screens and the public site cannot drift on how a date reads.
    money: (cents) => (cents == null ? '-' : '$' + (cents / 100).toFixed(2)),
    shortDate: (iso) => String(iso || '').slice(0, 10),
    labelState: () => 'IN USE',
  });
}

test('an unpriced order says which promotion is coming, and calls it expected', () => {
  const html = render({ expectedPromotion: { id: 'p-1', name: 'CLEAN50 - 50% off first order', code: 'CLEAN50' } });

  assert.match(html, /Promotion/, 'there is no promotion row at all');
  assert.match(html, /expected:/, 'it does not say the word');
  assert.match(html, /CLEAN50/, 'it does not name the promotion');
  assert.match(html, /comes off when it is weighed/, 'it does not say when it applies');
});

test('it names the code a person would say out loud, not the long name', () => {
  const html = render({ expectedPromotion: { id: 'p-1', name: 'CLEAN50 - 50% off first order', code: 'CLEAN50' } });

  assert.ok(!html.includes('50% off first order'), 'the whole marketing name is on the row');
});

test('and falls back to the name when a promotion has no code', () => {
  const html = render({ expectedPromotion: { id: 'p-1', name: 'Pre-launch 20%', code: null } });
  assert.match(html, /Pre-launch 20%/);
});

test('NO FIGURE, because the price does not exist yet', () => {
  // The discount is a percentage of a weight nobody has put on a scale. Any
  // number here would be invented, and a pound figure on a screen becomes the
  // figure somebody quotes back.
  const html = render({ expectedPromotion: { id: 'p-1', name: 'CLEAN50', code: 'CLEAN50' } });

  const row = html.slice(html.indexOf('expected:'), html.indexOf('expected:') + 220);
  assert.ok(!/\$\d/.test(row), `a money figure is on the forecast: ${row}`);
});

test('THE FACT AND THE FORECAST ARE NEVER BOTH DRAWN', () => {
  // A priced order carries what actually came off. Showing a guess beside it
  // would be two answers to one question.
  const html = render({
    promotionName: 'CLEAN50',
    discount_cents: 1650,
    price_cents: 1650,
    weight_lb: 16.5,
    expectedPromotion: { id: 'p-1', name: 'SOMETHING ELSE', code: 'SOMETHING ELSE' },
  });

  assert.ok(!html.includes('expected:'), 'a priced order is showing a forecast as well');
  assert.ok(!html.includes('SOMETHING ELSE'), 'the forecast leaked onto a priced order');
  assert.match(html, /-\$16\.50/, 'what actually came off is not shown');
});

test('an order with nothing coming shows no promotion row', () => {
  const html = render();
  assert.ok(!html.includes('expected:'), 'it invented a forecast');
});

// --- where the answer comes from ---------------------------------------------

test('the forecast is worked out by promotions.js, not by the page', () => {
  // A second implementation of "what would come off" is how a screen and a
  // charge end up disagreeing.
  const admin = withoutComments(SRC('routes', 'admin.js'));
  const at = admin.indexOf("router.get('/ops/orders/:id'");
  const route = admin.slice(at, admin.indexOf('\nrouter.', at + 10));

  assert.ok(route.includes('promotions.expectedForMany([order])'), 'the page works it out itself');

  const page = withoutComments(SRC('web', 'order-console.js'));
  for (const forbidden of ['PERCENT_OFF', 'discountFor', 'usableOn', 'percent']) {
    assert.ok(!page.includes(forbidden), `order-console decides promotions itself via ${forbidden}`);
  }
});

test('it costs nothing on an order that is already priced', () => {
  // expectedForMany() skips anything carrying a promotion_id, so a finished
  // order makes no query.
  const promotions = withoutComments(SRC('core', 'promotions.js'));
  const fn = promotions.slice(promotions.indexOf('async function expectedForMany'));

  assert.ok(fn.includes('!o.promotion_id'), 'it recomputes a promotion that already applied');
  assert.ok(fn.includes('if (!pending.length) return {};'), 'it queries with nothing to forecast');
});

test('and it is behind money.view, like every other figure on that page', () => {
  // A driver does not see what an order is worth, and must not see what is
  // about to come off it either.
  const admin = withoutComments(SRC('routes', 'admin.js'));
  const at = admin.indexOf("router.get('/ops/orders/:id'");
  const route = admin.slice(at, admin.indexOf('\nrouter.', at + 10));

  assert.ok(
    /const expected = can\.money/.test(route),
    'the forecast is worked out for somebody who cannot see money'
  );
});

test('a broken lookup draws no row rather than breaking the page', () => {
  const admin = withoutComments(SRC('routes', 'admin.js'));
  const at = admin.indexOf("router.get('/ops/orders/:id'");
  const route = admin.slice(at, admin.indexOf('\nrouter.', at + 10));

  const call = route.slice(route.indexOf('expectedForMany'), route.indexOf('expectedForMany') + 320);
  assert.ok(/\.catch\(/.test(call), 'the order page 500s if the promotion ledger is down');
  assert.ok(/return \{\};/.test(call), 'a failed lookup does not fall back to nothing');
});
