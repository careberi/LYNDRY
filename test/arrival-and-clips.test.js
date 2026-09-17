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

// THIS REVERSES WHAT THIS FILE ASSERTED YESTERDAY, and Neil's lock is why:
//
//   "No customer text is allowed to originate from this action... If somebody
//    uses an admin/order-page collection action without first recording
//    arrival, that does NOT give collect() permission to manufacture an
//    arrival message. Keep those concepts separate."
//
// The backstop existed so a driver collecting from the order page or the JSON
// API would not leave the customer told nothing. That gap is real and it is
// not this function's to fill: a collection recorded at a desk is not evidence
// that anybody is standing outside anybody's house.
test('STEP 6 CANNOT SEND A CUSTOMER TEXT, CATEGORICALLY', () => {
  const collect = fn(['core', 'fulfilment.js'], 'async function collect', '\nasync function');

  assert.ok(!collect.includes('announceArrival('), 'the backstop is back');
  assert.ok(!collect.includes('sendAndLog'), 'collect() texts somebody directly');
  assert.ok(!collect.includes('collectedMessage'), 'collect() builds the arrival message');
  assert.ok(collect.includes("step(order, 'IN_PROCESS', null"), 'the transition carries a message again');
});

// THE CLAIM COMES FIRST. THIS TEST USED TO ASSERT THE OPPOSITE.
//
// It required the send to happen before the stamp, on the reasoning that a
// failed send should not mark the customer as told. Neil, 17 September:
//
//   "Two taps can both finish steps 1-3 before either reaches step 4.
//    .is('here_texted_at', null) on the UPDATE does not protect an SMS that
//    was already sent. The existing regression test is therefore asserting the
//    wrong thing when it requires the send to happen before the stamp."
//
// He is right. The conditional update made the STAMP once-only and the SMS sat
// in front of it, so the column was protected and the thing that mattered was
// not.
test('ONE TEXT, AND THE CLAIM IS TAKEN BEFORE ANYTHING IS SENT', () => {
  const announce = fn(['core', 'fulfilment.js'], 'async function announceArrival', '\nfunction collectedMessage');

  const claims = announce.indexOf("here_texted_at: new Date().toISOString()");
  const sends = announce.indexOf('sendAndLog');

  assert.ok(claims > 0, 'nothing is claimed');
  assert.ok(sends > 0, 'nothing is sent');
  assert.ok(claims < sends, 'it sends before it has claimed the right to send');

  // One statement: stamp where it is still null and ask for the row back.
  assert.ok(announce.includes(".is('here_texted_at', null)"), 'the claim is unconditional');
  assert.ok(/\.select\('id, order_number/.test(announce), 'the claim does not ask for the row back');
  assert.ok(announce.includes('if (!claimed) return'), 'a lost claim still sends');

  // And the old shape is gone.
  assert.ok(!announce.includes('if (fresh.here_texted_at) return'), 'the read-then-send is back');
});

test('THE AUDIT LINE SAYS WHAT HAPPENED, NOT WHAT WAS INTENDED', () => {
  // "Told them we are here" against a number that had opted out is a record of
  // something that did not occur, and the change log is what anybody reads
  // afterwards to find out whether the customer knew.
  const announce = fn(['core', 'fulfilment.js'], 'async function announceArrival', '\nfunction collectedMessage');

  assert.ok(announce.includes('result.refused'), 'a refusal is not noticed');
  assert.ok(announce.includes('providerMessageId'), 'a carrier that would not take it reads as sent');
  assert.ok(announce.includes('the text was refused'), 'there is no wording for a refusal');
});

test('and notify says which of the two happened', () => {
  const notify = fn(['core', 'notify.js'], 'async function sendAndLog', '\nmodule.exports');

  assert.ok(notify.includes('return { sent: true, providerMessageId, text };'), notify.slice(-400));
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

// --- step 15: the laundromat's scale is an accounting event ------------------

test('STEP 15 CANNOT SEND A CUSTOMER TEXT, CATEGORICALLY', () => {
  // Neil's lock: "Make Step 15 structurally incapable of sending a customer
  // SMS. Use the internal partner-scale/accounting path instead of a customer
  // settlement path where appropriate."
  const bag = withoutComments(SRC('routes', 'bag.js'));

  // The weight route no longer reaches the function that prices, charges and
  // texts. That is the whole of it: settleWeight() is the customer settlement
  // path and nothing on a page with no sign-in may call it.
  assert.ok(!bag.includes('.settleWeight('), 'the weigh-in still settles the customer price');
  assert.ok(bag.includes('.recordPartnerScale('), 'it no longer records what we owe the laundromat');
});

test('and the only text bag.js sends is the internal ready-for-collection one', () => {
  // Neil: "The READY action may continue sending its INTERNAL
  // ready-for-collection notification to LYNDRY staff."
  const bag = withoutComments(SRC('routes', 'bag.js'));

  const sends = [...bag.matchAll(/sendAndLog\(([^)]*)\)/g)].map((m) => m[1]);
  assert.equal(sends.length, 1, `bag.js sends ${sends.length} different messages`);

  // To a staff number, with a null customer - not to the customer on the order.
  assert.match(sends[0], /^to, body, null$/, sends[0]);
});

test('nothing on the weight path can move the customer price or the card', () => {
  const bag = withoutComments(SRC('routes', 'bag.js'));

  for (const forbidden of ['chargeOrder', 'chargeAtTheDoor', 'price_cents', 'payment_status', 'amount_paid_cents']) {
    assert.ok(!bag.includes(forbidden), `bag.js touches ${forbidden}`);
  }
});

test('recordPartnerScale is the accounting path, and it cannot text or charge', () => {
  const scale = fn(['core', 'fulfilment.js'], 'async function recordPartnerScale', '\nasync function');

  // What it may do.
  assert.ok(scale.includes('partner_bill_lb'), 'it does not work out what we owe them');
  assert.ok(scale.includes('weight_band'), 'it does not record which band they fell in');
  assert.ok(scale.includes('issues'), 'a disagreement raises nothing');
  assert.ok(scale.includes('events.record'), 'it writes no event');

  // What it may not.
  for (const forbidden of ['sendAndLog', 'chargeOrder', 'chargeAtTheDoor', 'price_cents']) {
    assert.ok(!scale.includes(forbidden), `recordPartnerScale reaches ${forbidden}`);
  }
});

test('one issue for one pair of scales, raised by the function that compares them', () => {
  // Both halves of the route used to raise their own beside it, with wording
  // that said NOTHING HAS BEEN CHARGED - true when this step was the charge
  // point, false since 12 September.
  const bag = withoutComments(SRC('routes', 'bag.js'));

  assert.ok(!/NOTHING HAS BEEN CHARGED/.test(bag), 'the stale wording is still on the page');

  const scale = fn(['core', 'fulfilment.js'], 'async function recordPartnerScale', '\nasync function');
  assert.ok(scale.includes('Scales disagree'), 'nothing raises the disagreement');
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
