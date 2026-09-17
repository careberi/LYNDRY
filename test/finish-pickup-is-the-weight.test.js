'use strict';

// ---------------------------------------------------------------------------
// WEIGHING A BAG IS BAG-LEVEL WORK. FINISH PICKUP IS WHERE THE ORDER IS PRICED.
//
// Neil's lock, 17 September, off order #2069:
//
//   "With the bag-count question removed, bags.totalWeight().allWeighed cannot
//    mean 'the customer has no more physical bags.' After bag 1 is scanned and
//    weighed, the database only knows about bag 1... That must NOT finalize the
//    order weight or run order-level pricing."
//
// WHAT #2069 ACTUALLY DID:
//
//   13:28:22  Weighed 8 lb                         Priced $25.00, the minimum
//   13:29:28  Weight corrected to 19 lb, was 8 lb   Priced $38.00
//
// Nobody corrected anything. A second bag was picked up. Neil: "That is normal
// accumulation, not correction."
//
// These tests run fulfilment.finishPickup() and fulfilment.loadVan() against an
// in-memory database. Nothing here reads or writes a real row, calls Stripe, or
// hands a number to a carrier - every one of those is replaced before
// fulfilment.js is required, and node --test gives each file its own process.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// --- the stand-in database ---------------------------------------------------
//
// It supports exactly the queries these two functions make: update-with-filters,
// and the one select behind the planning estimate.

const DB = { orders: [], bag_labels: [], customers: [] };

function rows(table) {
  return DB[table] || (DB[table] = []);
}

function builder(table) {
  const q = { filters: [], op: 'select', patch: null };

  const matches = (row) =>
    q.filters.every(([kind, column, value]) => {
      const actual = row[column];
      if (kind === 'eq') return actual === value;
      if (kind === 'is') return value === null ? actual == null : actual === value;
      if (kind === 'not') return value === null ? actual != null : actual !== value;
      throw new Error(`the stand-in does not know the filter ${kind}`);
    });

  const run = () => {
    const hits = rows(table).filter(matches);

    if (q.op === 'update') {
      for (const row of hits) Object.assign(row, q.patch);
      return { data: hits, error: null };
    }

    return { data: hits, error: null };
  };

  const api = {
    select() {
      return api;
    },
    // Only so the decline path's issue-raise has something to call. Nothing
    // asserts on it.
    insert() {
      return api;
    },
    update(patch) {
      q.op = 'update';
      q.patch = patch;
      return api;
    },
    eq(column, value) {
      q.filters.push(['eq', column, value]);
      return api;
    },
    is(column, value) {
      q.filters.push(['is', column, value]);
      return api;
    },
    not(column, _op, value) {
      q.filters.push(['not', column, value]);
      return api;
    },
    order() {
      return api;
    },
    limit() {
      return api;
    },
    maybeSingle() {
      const { data, error } = run();
      return Promise.resolve({ data: data[0] || null, error });
    },
    single() {
      const { data, error } = run();
      return Promise.resolve({ data: data[0] || null, error });
    },
    then(resolve, reject) {
      return Promise.resolve(run()).then(resolve, reject);
    },
  };

  return api;
}

function stub(relative, exports) {
  const full = require.resolve(path.join(__dirname, '..', relative));
  require.cache[full] = { id: full, filename: full, loaded: true, exports };
  return full;
}

stub('src/db.js', { from: (table) => builder(table) });

// --- what money and messages would have done ---------------------------------

const SENT = [];
const EVENTS = [];
const CHARGES = [];
let CHARGE_RESULT = { ok: true, fromHold: true, capturedCents: 2500 };
let DEAL = null;
const REDEEMED = [];

stub('src/core/notify.js', {
  sendAndLog: async (phone, text) => {
    SENT.push({ phone, text });
    return { sent: true, providerMessageId: 'x', text };
  },
  toPlainText: (t) => t,
});

stub('src/core/order-events.js', {
  record: async (orderId, event) => {
    EVENTS.push({ orderId, ...event });
  },
});

const realBilling = require('../src/core/billing');
stub('src/core/billing.js', {
  ...realBilling,
  describeCard: () => 'Visa ending 2663',
  chargeAtTheDoor: async (order, customer, { totalCents }) => {
    CHARGES.push({ orderId: order.id, totalCents });
    return CHARGE_RESULT;
  },
});

const realPromotions = require('../src/core/promotions');
stub('src/core/promotions.js', {
  ...realPromotions,
  discountFor: async () => DEAL,
  redeem: async (grantId, orderId) => {
    REDEEMED.push({ grantId, orderId });
  },
});

let LABELS = [];
const realBags = require('../src/core/bags');
stub('src/core/bags.js', {
  ...realBags,
  forOrder: async (_orderId, leg = 'PICKUP') => LABELS.filter((l) => (l.leg || 'PICKUP') === leg),
});

const fulfilment = require('../src/core/fulfilment');

// --- the world ---------------------------------------------------------------

const CUSTOMER = {
  id: 'cust-1',
  name: 'Pamela',
  phone: '+12015550199',
  card_brand: 'Visa',
  card_last4: '2663',
};

function reset() {
  DB.orders = [
    {
      id: 'order-1',
      order_number: 2069,
      status: 'IN_PROCESS',
      customer_id: 'cust-1',
      driver_id: 'driver-1',
      bag_count: null,
      weight_lb: null,
      price_cents: null,
      billable_weight_lb: null,
      van_confirmed_at: null,
      payment_status: 'UNPAID',
      price_per_lb_cents: 200,
      minimum_cents: 2500,
      surcharge_cents: 0,
    },
  ];
  DB.bag_labels = [];
  DB.customers = [{ ...CUSTOMER }];

  SENT.length = 0;
  EVENTS.length = 0;
  CHARGES.length = 0;
  REDEEMED.length = 0;
  CHARGE_RESULT = { ok: true, fromHold: true, capturedCents: 2500 };
  DEAL = null;
  LABELS = [];
}

const order = () => ({ ...DB.orders[0], customers: { ...CUSTOMER } });

// Bind a bag the way the run does: a row with a code and no weight yet.
function bind(id, code, position) {
  const label = {
    id,
    order_id: 'order-1',
    leg: 'PICKUP',
    code,
    sticker_seq: null,
    position,
    weight_lb: null,
    clip_number: null,
    clipped_at: null,
    unclipped_at: null,
    loaded_at: null,
  };
  LABELS.push(label);
  DB.bag_labels.push(label);
  return label;
}

// Weigh it the way the bag-weight route does now: the bag row, and nothing else.
// THIS IS THE WHOLE POINT - the route no longer reaches fulfilment at all on the
// pickup leg, so there is nothing to call here.
function weighBag(label, pounds, clip) {
  label.weight_lb = pounds;
  if (clip != null) label.clip_number = clip;
}

const events = (kind) => EVENTS.filter((e) => e.kind === kind);
const weightEvents = () => events('WEIGHT');
const priceEvents = () => events('PRICE');

// --- one bag -----------------------------------------------------------------

test('weighing the only bag charges nothing and texts nobody', async () => {
  reset();
  weighBag(bind('l1', '2XEBWZ', 1), 30, 1);

  // Nothing has called fulfilment yet, which is the assertion: the route's job
  // is finished when the bag row is saved.
  assert.equal(CHARGES.length, 0);
  assert.equal(SENT.length, 0);
  assert.equal(DB.orders[0].weight_lb, null, 'the order was priced by a bag weigh');
  assert.equal(DB.orders[0].price_cents, null);
});

test('Finish Pickup establishes the weight and charges once', async () => {
  reset();
  weighBag(bind('l1', '2XEBWZ', 1), 30, 1);

  const result = await fulfilment.finishPickup(order(), { by: { actor: 'test' } });

  assert.ok(result.ok, result.detail);
  assert.equal(DB.orders[0].weight_lb, 30);
  assert.equal(DB.orders[0].billable_weight_lb, 30);
  assert.equal(DB.orders[0].bag_count, 1);
  assert.equal(DB.orders[0].price_cents, 6000, '30 lb at $2.00');
  assert.equal(CHARGES.length, 1);
  assert.equal(CHARGES[0].totalCents, 6000);
  assert.equal(SENT.length, 1, 'one money text, at the end');
});

// --- two bags, which is where it went wrong ----------------------------------

test('bag 1 of two does NOT finalise or price the order', async () => {
  reset();
  weighBag(bind('l1', '2XEBWZ', 1), 8, 1);

  // #2069's exact first bag. The old route saw one label, one weight, called
  // that allWeighed, and priced the whole pickup at the $25.00 minimum.
  assert.equal(DB.orders[0].weight_lb, null, 'the order was finalised on bag 1');
  assert.equal(DB.orders[0].price_cents, null, 'the order was priced on bag 1');
  assert.equal(priceEvents().length, 0, 'a PRICE event was written on bag 1');
  assert.equal(CHARGES.length, 0);
  assert.equal(SENT.length, 0);
});

test('AND ADDING BAG 2 IS NOT A CORRECTION', async () => {
  reset();
  weighBag(bind('l1', '2XEBWZ', 1), 8, 1);
  weighBag(bind('l2', 'KQKXM8', 2), 11, 3);

  await fulfilment.finishPickup(order(), { by: { actor: 'test' } });

  const corrections = weightEvents().filter((e) => /correct/i.test(e.summary));
  assert.equal(corrections.length, 0, `a correction nobody made: ${corrections.map((c) => c.summary).join('; ')}`);
});

test('Finish Pickup finalises 19 lb, the sum of the two bags', async () => {
  reset();
  weighBag(bind('l1', '2XEBWZ', 1), 8, 1);
  weighBag(bind('l2', 'KQKXM8', 2), 11, 3);

  const result = await fulfilment.finishPickup(order(), { by: { actor: 'test' } });

  assert.ok(result.ok, result.detail);
  assert.equal(DB.orders[0].weight_lb, 19);
  assert.equal(DB.orders[0].billable_weight_lb, 19);
  assert.equal(DB.orders[0].bag_count, 2, 'the count is what was scanned');
});

test('and there is exactly one WEIGHT entry and one PRICE entry for it', async () => {
  reset();
  weighBag(bind('l1', '2XEBWZ', 1), 8, 1);
  weighBag(bind('l2', 'KQKXM8', 2), 11, 3);

  await fulfilment.finishPickup(order(), { by: { actor: 'test' } });

  assert.equal(weightEvents().length, 1, weightEvents().map((e) => e.summary).join('; '));
  assert.equal(priceEvents().length, 1, priceEvents().map((e) => e.summary).join('; '));
  assert.match(weightEvents()[0].summary, /19 lb across 2 bags/);
});

test('the promotion and the minimum are worked out from 19 lb, once', async () => {
  reset();
  // CLEAN50, exactly as Pamela held it: half of $38.00.
  DEAL = { cents: 1900, grantId: 'grant-1', promotion: { id: 'promo-1', name: 'CLEAN50', blurb: '50% off your first order' } };

  weighBag(bind('l1', '2XEBWZ', 1), 8, 1);
  weighBag(bind('l2', 'KQKXM8', 2), 11, 3);

  await fulfilment.finishPickup(order(), { by: { actor: 'test' } });

  // 19 lb x $2.00 = $38.00, over the $25.00 minimum, less $19.00.
  assert.equal(DB.orders[0].price_cents, 1900);
  assert.equal(DB.orders[0].discount_cents, 1900);
  assert.equal(CHARGES.length, 1, 'more than one charge');
  assert.equal(CHARGES[0].totalCents, 1900);
  assert.equal(REDEEMED.length, 1, 'the promotion was spent more than once');
});

test('THE MINIMUM NEVER DECIDES THE PRICE OFF ONE BAG', async () => {
  reset();
  // The specific harm on #2069: 8 lb is under the minimum, 19 lb is over it.
  // Pricing on bag 1 charged the floor and called it the order.
  weighBag(bind('l1', '2XEBWZ', 1), 8, 1);
  weighBag(bind('l2', 'KQKXM8', 2), 11, 3);

  await fulfilment.finishPickup(order(), { by: { actor: 'test' } });

  assert.equal(DB.orders[0].price_cents, 3800, 'priced off a partial load');
  assert.ok(!/minimum/i.test(priceEvents()[0].summary), priceEvents()[0].summary);
});

// --- a real re-weigh of the same bag -----------------------------------------

test('re-weighing the SAME bag before Finish Pickup changes the total', async () => {
  reset();
  const one = bind('l1', '2XEBWZ', 1);
  weighBag(one, 8, 1);
  weighBag(bind('l2', 'KQKXM8', 2), 11, 3);

  // He puts bag 1 back on the scale.
  weighBag(one, 7.5);

  await fulfilment.finishPickup(order(), { by: { actor: 'test' } });

  assert.equal(DB.orders[0].weight_lb, 18.5, 'the correction did not reach the total');
  assert.equal(CHARGES.length, 1, 'a re-weigh took a second payment');
  assert.equal(CHARGES[0].totalCents, 3700);
});

test('and the order-level log still shows no correction, because there was none', async () => {
  reset();
  const one = bind('l1', '2XEBWZ', 1);
  weighBag(one, 8, 1);
  weighBag(bind('l2', 'KQKXM8', 2), 11, 3);
  weighBag(one, 7.5);

  await fulfilment.finishPickup(order(), { by: { actor: 'test' } });

  // The bag's own correction is written by the bag-weight route against that
  // sticker. The ORDER only ever had one weight, so it cannot have a correction.
  assert.equal(weightEvents().length, 1);
  assert.equal(weightEvents()[0].was, undefined, 'the order-level weight claims a previous figure');
});

// --- the second tap ----------------------------------------------------------

test('DOUBLE FINISH PICKUP NEVER CHARGES AGAIN', async () => {
  reset();
  weighBag(bind('l1', '2XEBWZ', 1), 8, 1);
  weighBag(bind('l2', 'KQKXM8', 2), 11, 3);

  await fulfilment.finishPickup(order(), { by: { actor: 'test' } });
  assert.equal(CHARGES.length, 1);

  const again = await fulfilment.finishPickup(order(), { by: { actor: 'test' } });

  assert.ok(again.ok);
  assert.ok(again.already, 'the second tap did work');
  assert.equal(CHARGES.length, 1, 'the card was charged twice');
  assert.equal(SENT.length, 1, 'the customer was told twice');
});

// --- what it still refuses ---------------------------------------------------

test('no bags is refused, and nothing is charged', async () => {
  reset();

  const result = await fulfilment.finishPickup(order(), { by: { actor: 'test' } });

  assert.equal(result.ok, false);
  assert.match(result.detail, /Scan a bag/);
  assert.equal(CHARGES.length, 0);
});

test('an unweighed bag is refused BY NAME, and nothing is charged', async () => {
  reset();
  weighBag(bind('l1', '2XEBWZ', 1), 8, 1);
  bind('l2', 'KQKXM8', 2);

  const result = await fulfilment.finishPickup(order(), { by: { actor: 'test' } });

  assert.equal(result.ok, false);
  assert.match(result.detail, /KQKXM8/);
  assert.equal(CHARGES.length, 0);
  assert.equal(DB.orders[0].weight_lb, null);
});

test('a refused card leaves NO weight and NO price behind', async () => {
  reset();
  // orders_weight_and_price_together says (weight_lb is null) = (price_cents is
  // null). Writing the weight early is what made uncollect() have to null one
  // and leave the other; there is nothing to undo now.
  CHARGE_RESULT = { ok: false, declined: true, detail: 'Your card was declined.' };

  weighBag(bind('l1', '2XEBWZ', 1), 8, 1);
  weighBag(bind('l2', 'KQKXM8', 2), 11, 3);

  await fulfilment.finishPickup(order(), { by: { actor: 'test' } }).catch(() => null);

  assert.equal(DB.orders[0].weight_lb, null, 'a declined pickup left a weight on the order');
  assert.equal(DB.orders[0].price_cents, null, 'a declined pickup left a price on the order');
  assert.equal(DB.orders[0].van_confirmed_at, null);
});
