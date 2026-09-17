'use strict';

// ---------------------------------------------------------------------------
// THE DELIVERY TEXT GOES WHEN THE DRIVER SETS OFF FOR THAT DOOR, NOT WHEN THE
// VAN IS LOADED.
//
// Neil's lock, 17 September, steps 26 to 28:
//
//   Step 26 - All bags are on the van. NO CUSTOMER TEXT. "Moving the order to
//   OUT_FOR_DELIVERY is an internal operational transition... The customer's
//   laundry may be in the van while several other stops happen."
//
//   Step 27 - Take me there for THAT CUSTOMER'S delivery. THIS sends the
//   delivery-on-the-way SMS. "Do not message Customers B, C, etc. just because
//   their laundry is also in the van. Directions again must not send another
//   text."
//
//   Step 28 - I'm here at delivery. NO CUSTOMER TEXT.
//
// The whole round, for reference, and every line of it is asserted somewhere:
//
//   PICKUP     Take me there -> on the way | I'm here -> we are outside |
//              tag, weight -> silent | Finish Pickup -> weight, price, payment
//   PARTNER    drop-off, their weight, ready -> silent to the customer
//   DELIVERY   loaded -> silent | Take me there -> on the way |
//              I'm here -> silent | Delivered + photo -> delivered
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

// --- the stand-in database ---------------------------------------------------

const DB = { orders: [] };

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
    const hits = (DB[table] || []).filter(matches);
    if (q.op === 'update') for (const row of hits) Object.assign(row, q.patch);
    return { data: hits, error: null };
  };

  const api = {
    select: () => api,
    insert: () => api,
    update(patch) {
      q.op = 'update';
      q.patch = patch;
      return api;
    },
    eq(c, v) {
      q.filters.push(['eq', c, v]);
      return api;
    },
    is(c, v) {
      q.filters.push(['is', c, v]);
      return api;
    },
    not(c, _o, v) {
      q.filters.push(['not', c, v]);
      return api;
    },
    order: () => api,
    limit: () => api,
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
}

stub('src/db.js', { from: (table) => builder(table) });

const SENT = [];
stub('src/core/notify.js', {
  sendAndLog: async (phone, text, customerId) => {
    SENT.push({ phone, text, customerId });
    return { sent: true, providerMessageId: 'x', text };
  },
  toPlainText: (t) => t,
});

stub('src/core/order-events.js', { record: async () => {} });

const runCore = require('../src/core/run');
const fulfilment = require('../src/core/fulfilment');

// --- the world ---------------------------------------------------------------

const ALICE = { id: 'cust-a', name: 'Alice', phone: '+12015550101', status: 'ACTIVE' };
const BOB = { id: 'cust-b', name: 'Bob', phone: '+12015550102', status: 'ACTIVE' };

function makeOrder(id, number, customer, over = {}) {
  return {
    id,
    order_number: number,
    customer_id: customer.id,
    customers: customer,
    status: 'OUT_FOR_DELIVERY',
    partner_id: null,
    collected_at: '2026-09-17T13:30:00.000Z',
    navigating_at: null,
    arrived_at: null,
    here_texted_at: '2026-09-17T13:28:00.000Z',
    weight_lb: 19,
    billable_weight_lb: 19,
    price_cents: 3800,
    amount_paid_cents: 3800,
    payment_status: 'PAID',
    preferences: null,
    ...over,
  };
}

function reset(...orders) {
  DB.orders = orders;
  SENT.length = 0;
}

// --- STEP 26: the van is loaded, and nobody is told --------------------------

test('STEP 26: outForDelivery() sends no customer SMS', async () => {
  const order = makeOrder('o-a', 3001, ALICE, { status: 'READY' });
  reset(order);

  const result = await fulfilment.outForDelivery({ ...order }, { by: { actor: 'test' } });

  assert.ok(result.ok, result.detail);
  assert.equal(DB.orders[0].status, 'OUT_FOR_DELIVERY');
  assert.equal(SENT.length, 0, `it texted: ${SENT.map((m) => m.text).join(' | ')}`);
});

test('and it does not build a message at all, rather than building a silent one', () => {
  // A buildMessage that returns an empty string would be a sentence one edit
  // away from going out. step() is handed null.
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'fulfilment.js'), 'utf8');
  const at = SRC.indexOf('async function outForDelivery');
  assert.ok(at > 0, 'outForDelivery has moved');

  const fn = SRC.slice(at, SRC.indexOf('\nasync function', at + 10));
  const code = fn
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

  assert.match(code, /step\(order, 'OUT_FOR_DELIVERY', null, by\)/);
  assert.ok(!/out for delivery today/i.test(code), 'the old loaded-the-van text is back');
});

// --- STEP 27: Take me there, for one customer --------------------------------

test('STEP 27: the delivery Take me there sends exactly one text', async () => {
  const order = makeOrder('o-a', 3001, ALICE);
  reset(order);

  await runCore.setOff('o-a');

  assert.equal(SENT.length, 1);
  assert.equal(SENT[0].phone, ALICE.phone);
  assert.match(SENT[0].text, /on our way to deliver your laundry/i);
});

test('AND DIRECTIONS AGAIN DOES NOT RESEND IT', async () => {
  const order = makeOrder('o-a', 3001, ALICE);
  reset(order);

  await runCore.setOff('o-a');
  await runCore.setOff('o-a');
  await runCore.setOff('o-a');

  assert.equal(SENT.length, 1, 'the claim on navigating_at did not hold');
});

test('AND IT GOES ONLY TO THAT ORDER\'S CUSTOMER', async () => {
  // Both loads are in the same van. Bob is not on this doorstep.
  const alice = makeOrder('o-a', 3001, ALICE);
  const bob = makeOrder('o-b', 3002, BOB);
  reset(alice, bob);

  await runCore.setOff('o-a');

  assert.equal(SENT.length, 1);
  assert.equal(SENT[0].customerId, ALICE.id);
  assert.ok(!SENT.some((m) => m.phone === BOB.phone), 'Bob was told his laundry was arriving');
  assert.equal(DB.orders[1].navigating_at, null, "Bob's order was claimed too");
});

test('an opted-out number is still refused here', async () => {
  const order = makeOrder('o-a', 3001, { ...ALICE, status: 'UNSUBSCRIBED' });
  reset(order);

  await runCore.setOff('o-a');

  assert.equal(SENT.length, 0);
});

// --- the other two legs of the same button -----------------------------------

test('the PICKUP Take me there still sends the pickup text', async () => {
  const order = makeOrder('o-a', 3001, ALICE, {
    status: 'REQUESTED',
    collected_at: null,
    here_texted_at: null,
  });
  reset(order);

  await runCore.setOff('o-a');

  assert.equal(SENT.length, 1);
  assert.match(SENT[0].text, /on our way to pick up your laundry/i);
});

test('THE LAUNDROMAT LEGS SAY NOTHING, which is what they always did', async () => {
  // Driving the dirty bags to a laundromat, and going back for the clean ones.
  for (const status of ['IN_PROCESS', 'READY']) {
    const order = makeOrder('o-a', 3001, ALICE, { status });
    reset(order);

    await runCore.setOff('o-a');

    assert.equal(SENT.length, 0, `${status} texted the customer about a laundromat`);
  }
});

// --- STEP 28: standing at the door -------------------------------------------

test('STEP 28: I am here on a delivery sends nothing', async () => {
  const order = makeOrder('o-a', 3001, ALICE, { navigating_at: '2026-09-17T18:00:00.000Z' });
  reset(order);

  await runCore.arrive('o-a');

  assert.ok(DB.orders[0].arrived_at, 'the arrival was not recorded');
  assert.equal(SENT.length, 0, `it texted: ${SENT.map((m) => m.text).join(' | ')}`);
});

test('but I am here on a PICKUP still says we are outside', async () => {
  const order = makeOrder('o-a', 3001, ALICE, {
    status: 'REQUESTED',
    collected_at: null,
    here_texted_at: null,
  });
  reset(order);

  await runCore.arrive('o-a');

  assert.equal(SENT.length, 1);
  assert.match(SENT[0].text, /here for your laundry/i);
});

// --- and the one at the end of it all ----------------------------------------

test('the delivered message survives, because that one is the point', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'fulfilment.js'), 'utf8');
  const at = SRC.indexOf('async function deliver(');
  assert.ok(at > 0, 'deliver() has moved');

  const fn = SRC.slice(at, SRC.indexOf('\nasync function', at + 10));
  // It goes through step(), which is what sends and logs every status text.
  assert.match(fn, /step\(order, 'DELIVERED', \(\) =>/, 'the delivered text is gone');
  assert.match(fn, /Your laundry is at your door/, 'the delivered wording is gone');
});

// --- the wording -------------------------------------------------------------

test('the delivery sentence is one plain-ASCII segment and promises the photo text', () => {
  const text = runCore.deliveryOnTheWayMessage();

  assert.ok(text.length <= 160, `${text.length} characters is two segments`);
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[^\x00-\x7F]/.test(text), 'a character outside GSM halves the segment');
  assert.match(text, /let you know once it/i);
});
