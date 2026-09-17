'use strict';

// ---------------------------------------------------------------------------
// ONE TEXT AT THE DOOR, TEN CLIPS IN THE VAN, AND NO SECOND CHARGE.
//
// Neil, 17 September, three rules and a repair:
//
//   "On the driver's first stop, scanning the pickup location is its own
//    screen. After that scan, or after I tap I'm here after directions, send
//    the customer the 'we're here for your laundry' text. One text. Not on
//    every bag."
//
//   "Only clips 1 through 10 are in the van pool. Do not hand out 11-50."
//
//   "the code so a paid order that is rolled back cannot be charged twice."
//
// Nothing here touches the database, Stripe or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { config } = require('../src/config');
const billing = require('../src/core/billing');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const fn = (file, name, ends) => {
  const src = withoutComments(SRC(...file));
  const from = src.indexOf(name);
  assert.ok(from > 0, `${name} is gone`);
  return src.slice(from, ends ? src.indexOf(ends, from + 10) : undefined);
};

// --- the clips ---------------------------------------------------------------

test('the van holds ten clips, not fifty', () => {
  assert.equal(config.routing.vanClips, 10);
});

test('nothing can hand out a clip nobody owns', () => {
  // assignClip() counts 1 to the pool and stops. A number it hands out that the
  // driver cannot physically find is worse than running out: he is sent looking
  // for clip 23 and there is no clip 23.
  const assign = fn(['core', 'bags.js'], 'async function assignClip', '\nasync function');

  assert.ok(assign.includes('config.routing.vanClips'), 'the pool is not read from config');
  assert.ok(/for \(let n = 1; n <= total; n \+= 1\)/.test(assign), assign.slice(0, 400));
  assert.ok(!/[^_]\b50\b/.test(assign), 'fifty is typed into the allocator');
});

test('clips already issued above ten are left alone', () => {
  // Sixteen is the highest on record. A bag that travelled under clip 16
  // travelled under clip 16, and a record edited to fit today's rules is not a
  // record. Nothing renumbers, and nothing sweeps.
  const bags = withoutComments(SRC('core', 'bags.js'));

  assert.ok(!/clip_number: *null[\s\S]{0,200}vanClips/.test(bags), 'something renumbers old clips');
  assert.ok(!/clip_number.*>.*vanClips/.test(bags), 'something hunts for clips above the pool');
});

// --- the arrival text --------------------------------------------------------

test('COLLECT NO LONGER TEXTS THEM, because scanning a tag is not arriving', () => {
  // It rode on the move to IN_PROCESS, and the thing that causes that move is
  // binding the FIRST BAG TAG - so "we're here for your laundry" arrived after
  // the driver had walked up, found the bags and scanned one.
  const collect = fn(['core', 'fulfilment.js'], 'async function collect', '\nasync function');

  assert.ok(
    !/step\(order, 'IN_PROCESS', \(updated\) => collectedMessage/.test(collect),
    'the arrival text is back on the status change'
  );
  assert.ok(collect.includes("step(order, 'IN_PROCESS', null"), 'the transition still carries a message');
});

test('it still tells them, as a backstop, for the doors that are not the run', () => {
  // The order page and POST /ops/collected reach collect() directly. A customer
  // whose driver used one of those must still be told.
  const collect = fn(['core', 'fulfilment.js'], 'async function collect', '\nasync function');
  assert.ok(collect.includes('announceArrival('), 'a collection outside the run says nothing at all');
});

test('ONE TEXT, AND THE STAMP IS WHAT ENFORCES IT', () => {
  const announce = fn(['core', 'fulfilment.js'], 'async function announceArrival', '\nfunction collectedMessage');

  // Read back, not trusted: the caller is holding an order it loaded before the
  // driver tapped anything.
  assert.ok(announce.includes("from('orders')"), 'it does not re-read the order');
  assert.ok(announce.includes('if (fresh.here_texted_at) return'), 'it can send a second time');

  // And the write is the lock, so two taps a second apart cannot both send.
  assert.ok(announce.includes("here_texted_at: new Date().toISOString()"), 'nothing is stamped');
  assert.ok(announce.includes(".is('here_texted_at', null)"), 'the stamp is not conditional, so it is a race');
});

test('the stamp goes on after the send, not instead of it', () => {
  const announce = fn(['core', 'fulfilment.js'], 'async function announceArrival', '\nfunction collectedMessage');

  const sends = announce.indexOf('sendAndLog');
  const stamps = announce.indexOf('here_texted_at: new Date');

  assert.ok(sends > 0 && stamps > sends, 'it stamps before it has tried to send');
});

test('BOTH OF NEIL\'S TRIGGERS ARE ONE CODE PATH', () => {
  // "After that scan, or after I tap I'm here after directions." The location
  // step's button and the travel card's button post to the same route, so there
  // is one arrival and one text whichever he pressed.
  const page = withoutComments(SRC('web', 'run-page.js'));
  const here = page.slice(page.indexOf("task.key === 'here'"), page.indexOf("task.key === 'bag_count'"));

  assert.ok(here.includes('action="/ops/run/here"'), 'the location step posts somewhere of its own');

  const arrive = fn(['core', 'run.js'], 'async function arrive', '\n// Cleared whenever');
  assert.ok(arrive.includes('announceArrival('), "I'm here does not tell the customer");
});

test('and only on a pickup, never at a laundromat or a doorstep delivery', () => {
  // The same button is pressed at all three. Only one of them is somebody
  // waiting for a van outside their house.
  const arrive = fn(['core', 'run.js'], 'async function arrive', '\n// Cleared whenever');

  assert.ok(arrive.includes("order.status !== 'REQUESTED'"), 'it announces an arrival at any stop');
});

test('a failed text never blocks the driver', () => {
  // He is standing at a door. The arrival flag is written first and the
  // announcement is caught, so a refused send or a broken lookup still gets him
  // his next screen.
  const arrive = fn(['core', 'run.js'], 'async function arrive', '\n// Cleared whenever');

  const flag = arrive.indexOf('arrived_at: new Date');
  const tell = arrive.indexOf('announceArrival');

  assert.ok(flag > 0 && flag < tell, 'it texts before it records that he is there');
  assert.ok(/announceArrival\(order\)[\s\S]{0,120}\.catch\(/.test(arrive), 'a failed text throws at him');
});

test('THE DOOR IS DONE BY here_texted_at, NEVER BY arrived_at', () => {
  // arrived_at is a flag, not history: recording a weight clears it, so the
  // location screen would reappear under him half way through the bags.
  const tasks = fn(['core', 'run.js'], 'const tasks = [];', 'for (let position = 1');

  assert.ok(tasks.includes("key: 'here'"), 'there is no location step');
  assert.ok(tasks.includes('done: Boolean(order.here_texted_at)'), 'the step is done by the wrong column');
  assert.ok(!/done: Boolean\(order\.arrived_at\)/.test(tasks), 'it is done by arrived_at');
});

// --- a paid order is never charged twice -------------------------------------

test('THE DOOR REFUSES AN ORDER THAT IS ALREADY PAID', () => {
  const door = fn(['core', 'billing.js'], 'async function chargeAtTheDoor', '\nasync function');

  assert.ok(
    /if \(order\.payment_status === 'PAID'\) return \{ ok: true, alreadyPaid: true \};/.test(door),
    door.slice(0, 500)
  );
});

test('the guard is at the door, not one layer down where the hold path misses it', () => {
  // chargeOrder() has refused a PAID order since the beginning, and the
  // ordinary path calls it - but the HOLD path captures the authorization and
  // charges the balance itself, and chargeOrder() never sees the order. That is
  // the path #2070 took: $25.00 off the hold and $8.00 on the card.
  const door = fn(['core', 'billing.js'], 'async function chargeAtTheDoor', '\nasync function');

  const guard = door.indexOf("payment_status === 'PAID'");
  const hold = door.indexOf('showUpHold(order)');

  assert.ok(guard > 0 && guard < hold, 'the hold is read before the order is checked');
});

test('A SPENT AUTHORIZATION IS NOT A HOLD', () => {
  // captured_at is stamped when the $25 is taken and the intent id stays on the
  // order afterwards, so a rolled-back order still LOOKS held - and the door
  // would try to capture the same authorization again.
  assert.equal(billing.showUpHold({ authorization_intent_id: 'pi_1', authorized_cents: 2500 }).cents, 2500);
  assert.equal(
    billing.showUpHold({ authorization_intent_id: 'pi_1', authorized_cents: 2500, captured_at: 'x' }),
    null
  );
});

test('and a rolled-back order says nothing about money it has already been charged', () => {
  // The customer was told the weight and the total when the van first came, and
  // both are unchanged. The only thing a second text could do is repeat them -
  // and the door's text names the card and says it has been charged, which on
  // this path would be a charge that did not happen.
  const load = fn(['core', 'fulfilment.js'], 'async function loadVan', '\nasync function');

  assert.ok(load.includes('if (customer && !charge.alreadyPaid)'), 'it texts a total it did not charge');
});

test('a double tap on Finish Pickup is still refused before any of this', () => {
  const load = fn(['core', 'fulfilment.js'], 'async function loadVan', '\nasync function');
  assert.ok(load.includes('if (order.van_confirmed_at) return { ok: true, already: true };'));
});

// --- and nothing about the money moved ---------------------------------------

test('the price is still worked out in memory and charged before anything is written', () => {
  const load = fn(['core', 'fulfilment.js'], 'async function loadVan', '\nasync function');

  const charge = load.indexOf('chargeAtTheDoor');
  const write = load.indexOf('van_confirmed_at: new Date');

  assert.ok(charge > 0 && charge < write, 'it stamps the van before the card has cleared');
});
