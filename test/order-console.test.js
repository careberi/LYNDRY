'use strict';

// ---------------------------------------------------------------------------
// THE ORDER CONSOLE, PINNED AGAINST ORDER #1992.
//
// Neil, 13 September: "one header, one exception line, then tables."
//
// #1992 is the reference fixture: two door bags, a first save of 17.4 then a
// correction to 33.6, a partner total of 27.6 (6.0 light against 2.0 allowed)
// that held the price, a settle by hand at 11:48 because our scale was broken,
// 33.6 back in two return bags, delivered and paid. Forty-seven events in the
// store, ten of which are what a person means by "what happened".
//
// The rows below are shaped like the real ones - same kinds, same summaries,
// written in code in one place each - so a change to the wording that
// humanEvents() matches on fails here first, not on a screen.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const {
  humanEvents,
  chargeRows,
  bagRows,
  messagesForOrder,
  exceptionFor,
  actionsFor,
} = require('../src/web/order-console');

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const labelState = (l) => (l.released_at ? 'EXPIRED' : l.order_id ? 'IN_USE' : 'OUTSTANDING');

const T = (s) => `2026-09-07T${s}-04:00`;
const ev = (t, kind, summary, extra = {}) => ({ created_at: T(t), kind, summary, actor: 'Neil Perry', ...extra });

// The spine of #1992's history, including the duplicates the store really holds.
const EVENTS = [
  { created_at: '2026-09-06T13:18:52-04:00', kind: 'CREATED', summary: 'Booked for 2026-09-07', became: '2026-09-07', actor: 'customer' },
  ev('10:30:10', 'STATUS', 'Moved to in process', { was: 'REQUESTED', became: 'IN_PROCESS' }),
  ev('10:30:19', 'NOTE', '2 bags at the door', { was: 'not counted', became: '2' }),
  ev('10:31:13', 'LABEL', 'Label 0H7Y2S put on bag 1', { became: '0H7Y2S' }),
  ev('10:31:36', 'WEIGHT', 'Weighed 17.4 lb', { became: '17.4 lb' }),
  ev('10:31:36', 'PRICE', 'Priced $34.80 at $2.00 a pound', { became: '$34.80' }),
  ev('10:32:08', 'LABEL', 'Clip 1 on bag 1 (0H7Y2S)'),
  ev('10:32:53', 'LABEL', 'Label 6T3CTE put on bag 2', { became: '6T3CTE' }),
  ev('10:33:20', 'WEIGHT', 'Weight corrected to 33.6 lb, was 17.4 lb', { was: '17.4 lb', became: '33.6 lb', reason: 'Re-weighed after the first figure was saved' }),
  ev('10:33:20', 'PRICE', 'Priced $67.20 at $2.00 a pound', { was: '$34.80', became: '$67.20' }),
  ev('10:33:30', 'LABEL', 'Clip 2 on bag 2 (6T3CTE)'),
  ev('10:36:19', 'STATUS', '2 bags loaded into the van on clips 1, 2'),
  ev('10:51:34', 'STATUS', 'Bags taken out of the van at the laundromat'),
  ev('10:52:45', 'LABEL', '0H7Y2S handed to the laundromat, van clip 1 off'),
  ev('10:52:49', 'LABEL', '6T3CTE handed to the laundromat, van clip 2 off'),
  ev('10:52:55', 'STATUS', 'Van clips 1, 2 back in the van'),
  ev('10:52:55', 'STATUS', 'Moved to at partner', { was: 'IN_PROCESS', became: 'AT_PARTNER' }),
  ev('10:52:55', 'PARTNER', 'Dropped at Fancy K Laundry', { became: 'Fancy K Laundry' }),
  ev('10:54:47', 'PARTNER_WEIGHT', 'Laundromat weighed bag 1 at 14.6 lb (1 of 2)', { became: '14.6 lb', actor: 'partner' }),
  ev('10:55:35', 'LABEL', '0H7Y2S-1 is in use', { actor: 'partner' }),
  ev('10:56:03', 'LABEL', '0H7Y2S-1 is not being used', { actor: 'partner' }),
  ev('10:57:21', 'PARTNER_WEIGHT', 'Laundromat weighed all 2 bags at 27.6 lb, 6.0 lb lighter than ours', { was: '33.6 lb', became: '27.6 lb', actor: 'partner', reason: 'Outside the tolerance, so an issue was raised' }),
  ev('10:57:21', 'WEIGHT', 'Price held: we weighed 33.6 lb, the laundromat 27.6 lb - 6.0 lb apart and we allow 2.0', { actor: 'partner', reason: 'Outside tolerance, so nothing is charged' }),
  ev('10:57:55', 'LABEL', '6T3CTE-1 is in use', { actor: 'partner' }),
  ev('11:48:12', 'PRICE', 'Priced at $67.20 on 33.6 lb - settled by hand: Our scale was broken', { was: '33.6 lb ours, 27.6 lb theirs', became: '33.6 lb billed' }),
  ev('11:48:14', 'PAYMENT', 'Charged $67.20 at the weigh-in', { became: 'PAID' }),
  ev('14:18:12', 'STATUS', 'Moved to ready', { was: 'AT_PARTNER', became: 'READY', actor: 'partner' }),
  ev('14:49:56', 'LABEL', '2 bags collected from the laundromat: 6T3CTE-1, 0H7Y2S-1'),
  ev('14:49:57', 'LABEL', '2 bags collected from the laundromat: 6T3CTE-1, 0H7Y2S-1'),
  ev('14:49:59', 'LABEL', '2 bags collected from the laundromat: 6T3CTE-1, 0H7Y2S-1'),
  ev('14:50:42', 'WEIGHT', '6T3CTE-1 weighed back at 16.8 lb', { became: '16.8 lb across 2 bags so far' }),
  ev('14:51:32', 'LABEL', 'Van clip 2 on 0H7Y2S-1'),
  ev('14:51:33', 'LABEL', 'Van clip 2 on 0H7Y2S-1'),
  ev('14:51:49', 'STATUS', 'Moved to out for delivery', { was: 'READY', became: 'OUT_FOR_DELIVERY' }),
  ev('15:08:22', 'LABEL', '6T3CTE-1: our bag tag off'),
  ev('15:09:38', 'PAYMENT', 'Nothing left to charge', { became: 'PAID' }),
  ev('15:09:38', 'STATUS', 'Moved to delivered', { was: 'OUT_FOR_DELIVERY', became: 'DELIVERED' }),
];

const ORDER = {
  id: 'o-1992', order_number: 1992, status: 'DELIVERED', payment_status: 'PAID',
  weight_lb: '33.60', partner_weight_lb: '27.60', billable_weight_lb: '33.60', return_weight_lb: '33.60',
  price_cents: 6720, price_per_lb_cents: 200, weight_held_at: null, weight_settled_at: T('11:48:12'),
  weight_photo_path: null, delivery_photo_url: 'https://x/p', partnerName: 'Fancy K Laundry',
  created_at: '2026-09-06T13:18:52-04:00', delivered_at: T('15:09:38'),
};

const LABELS = [
  { id: 'a', code: '0H7Y2S', order_id: 'o-1992', leg: 'PICKUP', position: 1, sticker_seq: null, parent_id: null, weight_lb: '17.40', released_at: 'x' },
  { id: 'b', code: '6T3CTE', order_id: 'o-1992', leg: 'PICKUP', position: 2, sticker_seq: null, parent_id: null, weight_lb: '16.20', released_at: 'x' },
  { id: 'c', code: '6T3CTE', order_id: 'o-1992', leg: 'DELIVERY', position: 1, sticker_seq: 1, parent_id: 'b', weight_lb: '16.80', released_at: 'x' },
  { id: 'd', code: '0H7Y2S', order_id: 'o-1992', leg: 'DELIVERY', position: 2, sticker_seq: 1, parent_id: 'a', weight_lb: '16.80', released_at: 'x' },
];

// --- the log ----------------------------------------------------------------

test('HUMAN IS ABOUT TEN ROWS OUT OF FORTY-SEVEN, oldest first', () => {
  const { rows, counts } = humanEvents(EVENTS, 'human');
  assert.ok(rows.length >= 9 && rows.length <= 13, `${rows.length} human rows`);
  assert.equal(rows[0].kind, 'CREATED');
  assert.equal(rows[rows.length - 1].summary, 'Moved to delivered');
  assert.ok(counts.all > counts.human, 'Everything is bigger than Human');
});

test('the same event written three times in four seconds is one row', () => {
  const { rows } = humanEvents(EVENTS, 'all');
  assert.equal(rows.filter((e) => /2 bags collected/.test(e.summary)).length, 1);
  assert.equal(rows.filter((e) => e.summary === 'Van clip 2 on 0H7Y2S-1').length, 1);
});

test('hardware stays out of Human and in Everything', () => {
  const human = humanEvents(EVENTS, 'human').rows.map((e) => e.summary);
  const all = humanEvents(EVENTS, 'all').rows.map((e) => e.summary);
  // The tag being bound, the first save a correction replaced, and the "Price
  // held" written in the same second as the partner total are each already
  // said by the line beside them. Kept in the store, kept in Everything.
  for (const noise of ['Clip 1 on bag 1 (0H7Y2S)', 'Van clips 1, 2 back in the van', '0H7Y2S-1 is in use', '6T3CTE-1: our bag tag off', 'Laundromat weighed bag 1 at 14.6 lb (1 of 2)', 'Label 0H7Y2S put on bag 1', 'Weighed 17.4 lb']) {
    assert.ok(!human.includes(noise), `human still shows: ${noise}`);
    assert.ok(all.includes(noise), `everything lost: ${noise}`);
  }
  for (const keep of ['Moved to in process', 'Weight corrected to 33.6 lb, was 17.4 lb', 'Dropped at Fancy K Laundry', 'Charged $67.20 at the weigh-in']) {
    assert.ok(human.includes(keep), `human dropped: ${keep}`);
  }
});

test('Exceptions only is the hold, the partner total, the correction and the settle', () => {
  const ex = humanEvents(EVENTS, 'exceptions').rows.map((e) => e.summary);
  assert.ok(ex.some((s) => /Price held/.test(s)));
  assert.ok(ex.some((s) => /weighed all 2 bags at 27.6/.test(s)));
  assert.ok(ex.some((s) => /corrected to 33.6/.test(s)));
  assert.ok(ex.some((s) => /settled by hand/.test(s)));
  assert.ok(!ex.some((s) => s === 'Moved to delivered'), 'a plain status move is not an exception');
});

// --- the charge ------------------------------------------------------------

test('THE LEDGER READS 17.4 -> 33.6 -> HOLD -> 67.20', () => {
  const rows = chargeRows(EVENTS, ORDER, { money });
  const whats = rows.map((r) => r.what);
  assert.deepEqual(whats, ['Weigh-in (first save)', 'Weigh-in corrected', 'Partner total', 'Settled by hand']);
  assert.equal(rows[0].lb, 17.4);
  assert.equal(rows[0].amount, '$34.80');
  assert.equal(rows[0].note, 'superseded');
  assert.equal(rows[1].lb, 33.6);
  assert.equal(rows[1].note, 'no scale photo');
  assert.equal(rows[2].amount, null, 'the partner figure never bills');
  assert.match(rows[2].note, /6\.0 light · hold/);
  assert.equal(rows[2].bad, true);
  assert.equal(rows[3].amount, '$67.20');
  assert.equal(rows[3].paid, true, 'the charge folded into the settle line');
  assert.match(rows[3].note, /scale was broken/i);
});

test('A PRICE WITH NO WEIGHT BESIDE IT reads its pounds and its promotion off the sentence', () => {
  // #2060: the old weigh-in rule priced off the laundromat's scale and took a
  // promotion off, and wrote all of it into one PRICE event with no WEIGHT a
  // second before. The first version of the ledger showed it as a blank-pound
  // "Weigh-in corrected", which is two wrong things.
  const events = [
    ev('15:20:00', 'PARTNER_WEIGHT', 'Laundromat weighed all 3 bags at 84.0 lb, 2.6 lb heavier than ours', { was: '81.38 lb', became: '84.0 lb', actor: 'partner' }),
    ev('15:20:01', 'PRICE', 'Priced at $84.00 on 84 lb - the laundromat\'s scale, the higher of the two, less $84.00 for CLEAN50 - 50% off first order', { was: '81.38 lb ours, 84 lb theirs', became: '84 lb billed' }),
    ev('15:20:02', 'PAYMENT', 'Card declined for $84.00', { became: 'unpaid', reason: 'Told them straight away' }),
  ];
  const rows = chargeRows(events, { ...ORDER, weight_photo_path: 'x' }, { money });
  const priced = rows.find((r) => r.what === 'Priced at weigh-in');
  assert.ok(priced, JSON.stringify(rows.map((r) => r.what)));
  assert.equal(priced.lb, 84);
  assert.equal(priced.amount, '$84.00');
  assert.match(priced.note, /less \$84\.00 for CLEAN50/);
  const partner = rows.find((r) => r.what === 'Partner total');
  assert.match(partner.note, /2\.6 heavy/);
  assert.equal(partner.bad, false, 'inside tolerance is not red');
  const declined = rows.find((r) => r.what === 'Card declined');
  assert.equal(declined.amount, '$84.00');
  assert.equal(declined.bad, true);
});

// --- the rail ------------------------------------------------------------------

test('THE RAIL READS THE EVENT WHEN THE COLUMN IS MISSING, and Out has no column at all', () => {
  const { stageRail } = require('../src/web/order-console');
  // No ready_at, no delivered_at on the row - the select-list trap - and there
  // is never an out_for_delivery_at. Every stamp still has to appear.
  const bare = { ...ORDER, ready_at: undefined, delivered_at: undefined };
  const html = stageRail(bare, EVENTS);
  assert.match(html, /Ready<\/div><div class="t">14:18/);
  assert.match(html, /Out<\/div><div class="t">14:51/);
  assert.match(html, /Delivered<\/div><div class="t">15:09/);
  assert.ok(!/class="t">—<\/div>/.test(html.split('Picked up')[1]), 'no blank stamp on a delivered order');
});

test('TIMESTAMPS ARE MM/DD/YYYY, AND THE CLOCK BESIDE THEM DID NOT MOVE', () => {
  // This used to pin "7 Sep 10:31" and the month name it spelled - en-GB says
  // "Sept" and the rest of ops said "Sep". Neil's decision lock, 14 September,
  // removed the month name from the question entirely: every human-facing date
  // is MM/DD/YYYY.
  //
  // THE TIME HALF IS UNCHANGED ON PURPOSE. His rule is that when a time is also
  // shown the date takes the new format and the time keeps the one it had, and
  // this rail has always read 24-hour. The rest of ops reads 10:31 PM; both
  // survive, because the lock is about dates.
  const { stamp } = require('../src/web/order-console');
  assert.equal(stamp(T('10:31:36')), '09/07/2026 · 10:31');
});

// --- the bags ----------------------------------------------------------------

test('BAGS ARE ONE TABLE with lineage, and nothing says RETIRED', () => {
  const { rows, footer } = bagRows(LABELS, ORDER, { labelState });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].doorCode, '0H7Y2S');
  assert.equal(rows[0].backCode, '0H7Y2S-1');
  assert.equal(rows[0].lineage, 'from bag 1 · they packed their own');
  assert.equal(rows[1].doorCode, '6T3CTE');
  assert.equal(rows[1].backCode, '6T3CTE-1');
  for (const r of rows) assert.equal(r.status, 'done');
  assert.equal(footer.billed, 33.6);
  assert.equal(footer.returned, 33.6);
  assert.match(footer.match, /matched/);
});

test('a live order shows the label state, not "done"', () => {
  const live = { ...ORDER, status: 'AT_PARTNER', return_weight_lb: null };
  const open = LABELS.map((l) => ({ ...l, released_at: null }));
  const { rows } = bagRows(open, live, { labelState });
  assert.ok(rows.every((r) => r.status === 'in use'), JSON.stringify(rows.map((r) => r.status)));
});

// --- the thread ------------------------------------------------------------

test('TEXTS FOR THIS ORDER stop at the delivery; the next order is counted, not shown', () => {
  const msgs = [
    { created_at: '2026-09-06T13:24:00-04:00', direction: 'OUTBOUND', body: 'Card saved! Order #1992 is booked' },
    { created_at: T('15:09:40'), direction: 'OUTBOUND', body: 'Delivered same day' },
    { created_at: '2026-09-08T21:37:00-04:00', direction: 'OUTBOUND', body: 'Order #2032 is booked' },
    { created_at: '2026-09-11T15:39:00-04:00', direction: 'OUTBOUND', body: "We're on our way" },
  ];
  const { rows, later } = messagesForOrder(msgs, ORDER);
  assert.equal(rows.length, 2);
  assert.ok(!rows.some((m) => /#2032/.test(m.body)));
  assert.equal(later, 2);
});

test('an open order runs to now', () => {
  const open = { ...ORDER, status: 'AT_PARTNER', delivered_at: null };
  const msgs = [{ created_at: new Date().toISOString(), direction: 'INBOUND', body: 'where is it' }];
  assert.equal(messagesForOrder(msgs, open).rows.length, 1);
});

// --- the exception strip ------------------------------------------------------

test('THE STRIP HAS 33.6 / 27.6 / 33.6 BACK, and is settled', () => {
  const x = exceptionFor(ORDER, EVENTS);
  assert.ok(x, 'there is an exception');
  assert.equal(x.open, false);
  assert.match(x.headline, /settled/);
  const text = x.parts.join(' ');
  assert.match(text, /We 33\.6 lb/);
  assert.match(text, /first save was 17\.4 lb/);
  assert.match(text, /no scale photo/);
  assert.match(text, /27\.6 lb · Δ 6\.0, tolerance 2\.0/);
  assert.match(text, /Return 33\.6 back of 33\.6 billed, matched/);
  assert.match(x.how, /scale was broken/i);
});

test('no exception means no strip', () => {
  const clean = { ...ORDER, partner_weight_lb: '33.60', weight_settled_at: null };
  const plain = EVENTS.filter((e) => !/corrected|held|settled|weighed all/.test(e.summary));
  assert.equal(exceptionFor(clean, plain), null);
});

test('a held price is an OPEN exception', () => {
  const held = { ...ORDER, status: 'AT_PARTNER', weight_held_at: T('10:57:21'), weight_settled_at: null, payment_status: 'UNPAID', return_weight_lb: null };
  const x = exceptionFor(held, EVENTS.filter((e) => !/settled|Charged/.test(e.summary)));
  assert.equal(x.open, true);
  assert.match(x.headline, /price held/);
});

// --- the toolbar -------------------------------------------------------------

const can = { act: true, override: true, customers: true, money: true, text: true, audit: true, messages: true };

test('DELIVERED + PAID + SETTLED: make it regular, no cancel, no booking ask', () => {
  const x = exceptionFor(ORDER, EVENTS);
  const a = actionsFor(ORDER, { tasks: [{ key: 'delivered', done: true }], can, exception: x, labels: LABELS });
  const keys = [...a.primary, ...a.also].map((b) => b.key);
  assert.ok(keys.includes('regular'));
  assert.ok(keys.includes('photo'));
  assert.ok(keys.includes('tags'));
  assert.ok(!keys.includes('cancel'));
  assert.ok(!keys.includes('task'), 'no step button on a finished order');
});

test('REQUESTED: cancel is available and make-it-regular is not', () => {
  const req = { ...ORDER, status: 'REQUESTED', payment_status: 'UNPAID', delivered_at: null, return_weight_lb: null, partner_weight_lb: null, weight_settled_at: null, weight_lb: null, billable_weight_lb: null };
  const a = actionsFor(req, { tasks: [{ key: 'collected', done: false, title: 'Collect 2 bags' }], can, exception: null, labels: [] });
  const keys = [...a.primary, ...a.also].map((b) => b.key);
  assert.ok(keys.includes('cancel'));
  assert.ok(keys.includes('task'));
  assert.ok(!keys.includes('regular'));
  assert.equal(a.primary[0].task.key, 'collected');
});

test('AT_PARTNER WITH AN OPEN HOLD: settle is primary, nothing about booking', () => {
  const held = { ...ORDER, status: 'AT_PARTNER', weight_held_at: T('10:57:21'), weight_settled_at: null, payment_status: 'UNPAID', delivered_at: null, return_weight_lb: null };
  const x = exceptionFor(held, EVENTS.filter((e) => !/settled|Charged/.test(e.summary)));
  const a = actionsFor(held, { tasks: [{ key: 'ready', done: false }], can, exception: x, labels: LABELS });
  assert.equal(a.primary[0].key, 'settle');
  assert.ok(!a.also.some((b) => b.key === 'cancel'));
});

test('A DRIVER IS SHOWN THE STOP, NOT THE CUSTOMER - on the rendered page, not only the toolbar', () => {
  // The guarantee CLAUDE.md makes: no name in the heading, no phone, no thread,
  // no money, no change log. The spec said "title with the customer name";
  // that means "for somebody allowed to see it". Pinned on the HTML itself,
  // because a gate that only lives in actionsFor() would still leak the <h1>.
  const { orderConsoleBody } = require('../src/web/order-console');
  const driver = { act: true, override: false, customers: false, money: false, text: false, audit: false, messages: false };
  const customer = { id: 'c1', name: 'DEMO CUSTOMER', phone: '+14437452665', card_brand: 'visa', card_last4: '8663', address_line1: '1650 Chandler Dr', city: 'Fair Lawn', postal_code: '07410', preferences: {} };
  const html = orderConsoleBody({
    order: { ...ORDER, pickup_date: '2026-09-07', pickup_window_start: '10:00:00', pickup_window_end: '12:00:00', customers: customer },
    customer, events: EVENTS, labels: LABELS, messages: [{ created_at: T('11:48:00'), direction: 'OUTBOUND', body: 'Charged to your Visa ending 8663.' }],
    tasks: [{ key: 'delivered', done: true }], team: [], laundromats: [], limits: null,
    can: driver, view: 'human', banner: '', money, shortDate: (d) => String(d), labelState, sideExtras: '',
  });
  assert.ok(!/DEMO CUSTOMER/.test(html), 'name leaked');
  assert.ok(!/4437452665/.test(html), 'phone leaked');
  assert.ok(!/8663/.test(html), 'card leaked');
  assert.ok(!/\$\d/.test(html), 'money leaked');
  assert.ok(!/id="log"/.test(html), 'change log leaked');
  assert.ok(!/Texts for #/.test(html), 'thread leaked');
  assert.ok(/1650 Chandler Dr/.test(html), 'the address is the one detail a stop needs');
  assert.ok(/<table class="data">/.test(html), 'the bags table is still theirs');
});

test('a driver gets the step and nothing that is not theirs to press', () => {
  const driver = { act: true, override: false, customers: false, money: false, text: false, audit: false, messages: false };
  // A REQUESTED order has no delivery photo yet; the fixture inherits one
  // from ORDER, and a driver may rightly see that link when it exists.
  const req = { ...ORDER, status: 'REQUESTED', payment_status: 'UNPAID', delivered_at: null, weight_settled_at: null, partner_weight_lb: null, return_weight_lb: null, delivery_photo_url: null, weight_photo_path: null };
  const a = actionsFor(req, { tasks: [{ key: 'collected', done: false }], can: driver, exception: null, labels: [] });
  const keys = [...a.primary, ...a.also].map((b) => b.key);
  assert.deepEqual(keys, ['task']);
});
