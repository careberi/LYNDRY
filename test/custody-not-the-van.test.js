'use strict';

// ---------------------------------------------------------------------------
// THE VAN IS NOT A CUSTODY STATE. IT IS TRANSPORTATION.
//
// Neil's operating model, 16 September: confirm custody transfers, identity,
// measurements, exceptions and proof of delivery. Never ask a driver to
// confirm movement into or out of a vehicle.
//
// WHAT THE DRIVER USED TO TAP, per three-bag pickup:
//
//   collect the bags            1
//   how many bags               1
//   per bag: scan, weigh,
//     confirm clip, confirm
//     it went in the van        12
//   they are in the van         1
//                              ---
//                               15
//
// AND NOW:
//
//   per bag: scan, weigh         6
//   Finish Pickup                1
//                              ---
//                               7
//
// The two that went per bag confirmed nothing the first two had not already
// established: the clip is assigned by the weigh route itself, and "it is in
// the van" is three feet of walking no screen can verify.
//
// WHAT DID NOT MOVE IS THE MONEY. Finish Pickup is loadVan() underneath, which
// works the price out in memory, charges the card, and only then stamps
// van_confirmed_at - so a refused card still leaves the bags on the step with
// the pickup not complete.
//
// Nothing here touches the database, Stripe or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const run = require('../src/core/run');
const bags = require('../src/core/bags');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// The one call tasksForCollect makes to the database, stubbed. Restored after
// each use so nothing leaks between tests.
const realForOrder = bags.forOrder;
const withLabels = async (labels, order) => {
  bags.forOrder = async () => labels;
  try {
    return await run.tasksForCollect(order);
  } finally {
    bags.forOrder = realForOrder;
  }
};

const bag = (position, code, weight = null, clip = null) => ({
  id: `l${position}`,
  position,
  code,
  sticker_seq: null,
  weight_lb: weight,
  clip_number: clip,
  clipped_at: null,
  loaded_at: null,
});

const order = (extra = {}) => ({
  id: 'o1',
  order_number: 2081,
  status: 'IN_PROCESS',
  bag_count: null,
  collected_at: 'x',
  van_confirmed_at: null,
  customers: { preferences: { special_instructions: 'front door' } },
  ...extra,
});

// --- the taps that went ------------------------------------------------------

test('THERE IS NO "PUT IT IN THE VAN" STEP, AND NO CLIP CONFIRMATION', () => {
  const src = withoutComments(SRC('core', 'run.js'));

  assert.ok(!/key: `load_/.test(src), 'the per-bag load tap is back');
  assert.ok(!/key: `clip_/.test(src), 'the per-bag clip tap is back');
  assert.ok(!/key: 'van'/.test(src), 'the order-level van tap is back');

  // And the controls behind them went with them.
  const page = withoutComments(SRC('web', 'run-page.js'));
  assert.ok(!/task\.key === 'van'/.test(page), 'the van control is back');
  assert.ok(!/task\.key === 'clips'/.test(page), 'the clips-off control is back');
  assert.ok(!/task\.key === 'strip'/.test(page), 'the tags-off control is back');
});

test('and no "collect the bags" tap and no bag count question', () => {
  const src = withoutComments(SRC('core', 'run.js'));

  assert.ok(!/key: 'collected'/.test(src), 'the collect tap is back');
  assert.ok(!/key: 'bag_count'/.test(src), 'the bag count question is back');
});

test('A THREE-BAG PICKUP IS SEVEN TAPS, NOT FIFTEEN', async () => {
  const labels = [bag(1, 'AAA111', 13, 1), bag(2, 'BBB222', 14, 2), bag(3, 'CCC333', 11, 3)];
  const tasks = await withLabels(labels, order());

  // Two per bag plus one open slot's pair, plus Finish.
  const perBag = tasks.filter((t) => /^(tag|weigh)_/.test(t.key) && t.done);
  assert.equal(perBag.length, 6, 'a weighed bag is not two finished steps');

  assert.equal(tasks.filter((t) => t.key === 'finish').length, 1, 'there is not exactly one finish');

  // Nothing else is a step.
  const kinds = [...new Set(tasks.map((t) => t.key.replace(/_\d+$/, '_N')))].sort();
  assert.deepEqual(kinds, ['finish', 'tag_N', 'weigh_N']);
});

// --- the flow itself ---------------------------------------------------------

test('SCAN, WEIGH, ANOTHER BAG - AND THE LIST GROWS AS HE GOES', async () => {
  const nothing = await withLabels([], order({ status: 'REQUESTED', collected_at: null }));
  assert.equal(nothing.find((t) => !t.done).title, 'Scan the first bag');

  const one = await withLabels([bag(1, 'AAA111')], order());
  assert.match(one.find((t) => !t.done).key, /^weigh_1$/, 'a scanned bag does not ask for a weight');

  const weighed = await withLabels([bag(1, 'AAA111', 13, 1)], order());
  assert.equal(weighed.find((t) => !t.done).title, 'Another bag? Scan its tag');
});

test('AND FINISH PICKUP IS REACHABLE FROM THE OPEN SLOT', async () => {
  // The run shows one task at a time, so an "Another bag?" step with nothing
  // beside it is a dead end - Finish sits behind it in the list and can never
  // be reached. Found by walking the flow rather than by reading it.
  const tasks = await withLabels([bag(1, 'AAA111', 13, 1)], order());
  const open = tasks.find((t) => !t.done);

  assert.equal(open.canFinish, true, 'the open slot offers no way to finish');
  assert.equal(open.bags, 1, 'it does not say how many bags that would be');

  const page = withoutComments(SRC('web', 'run-page.js'));
  assert.match(page, /task\.canFinish/, 'the tag control ignores canFinish');
});

test('but not before anything has been scanned', async () => {
  const tasks = await withLabels([], order({ status: 'REQUESTED', collected_at: null }));
  const open = tasks.find((t) => !t.done);
  assert.ok(!open.canFinish, 'an empty pickup offers to finish');
});

test('and not while a bag is unweighed', async () => {
  // The price is the sum of the bags, so one unweighed bag is a charge short
  // by a bag.
  const tasks = await withLabels([bag(1, 'AAA111', 13, 1), bag(2, 'BBB222')], order());

  const open = tasks.find((t) => !t.done);
  assert.equal(open.key, 'weigh_2', 'it moved past an unweighed bag');

  const finish = tasks.find((t) => t.key === 'finish');
  assert.equal(finish.blockedBy, 'bags', 'finish is not blocked by the unweighed bag');
});

test('once finished, the open slot is gone', async () => {
  const labels = [bag(1, 'AAA111', 13, 1), bag(2, 'BBB222', 14, 2)];
  const tasks = await withLabels(labels, order({ van_confirmed_at: 'y', bag_count: 2 }));

  assert.ok(tasks.every((t) => t.done), 'something is still open after finishing');
  assert.equal(tasks.filter((t) => /^tag_/.test(t.key)).length, 2, 'it still offers another bag');
});

// --- what Finish Pickup does to the card ------------------------------------

test('FINISH PICKUP IS loadVan UNDERNEATH, SO THE MONEY RULES DO NOT MOVE', () => {
  const src = withoutComments(SRC('core', 'fulfilment.js'));
  const at = src.indexOf('async function finishPickup');
  assert.notEqual(at, -1, 'finishPickup has gone');

  const body = src.slice(at, src.indexOf('async function loadVan', at));

  assert.match(body, /return loadVan\(/, 'finishPickup does not go through loadVan');

  // It charges nothing itself, and knows nothing about money.
  assert.ok(!/chargeAtTheDoor|billing\./.test(body), 'finishPickup touches billing directly');
  assert.ok(!/van_confirmed_at: /.test(body), 'finishPickup stamps the charge flag itself');
});

test('it refuses a half-weighed load, naming the bags', async () => {
  const fulfilment = require('../src/core/fulfilment');

  bags.forOrder = async () => [bag(1, 'AAA111', 13, 1), bag(2, 'BBB222')];
  try {
    const out = await fulfilment.finishPickup(order());
    assert.equal(out.ok, false);
    assert.match(out.detail, /BBB222/, 'it does not say which bag');
    assert.match(out.detail, /no weight/);
  } finally {
    bags.forOrder = realForOrder;
  }
});

test('and refuses an empty one rather than charging for nothing', async () => {
  const fulfilment = require('../src/core/fulfilment');

  bags.forOrder = async () => [];
  try {
    const out = await fulfilment.finishPickup(order());
    assert.equal(out.ok, false);
    assert.match(out.detail, /Scan a bag/);
  } finally {
    bags.forOrder = realForOrder;
  }
});

test('an already-finished pickup is a no-op, never a second charge', async () => {
  const fulfilment = require('../src/core/fulfilment');
  const out = await fulfilment.finishPickup(order({ van_confirmed_at: 'y' }));
  assert.deepEqual(out, { ok: true, already: true });
});

// --- custody starts at the first scan ---------------------------------------

test('SCANNING THE FIRST BAG IS TAKING CUSTODY OF IT', () => {
  // The "collect the bags" tap announced an intention - the bag was still on
  // the step. The scan is the event, so the bind route moves the order on.
  const admin = withoutComments(SRC('routes', 'admin.js'));

  assert.match(admin, /leg !== 'DELIVERY' && !order\.collected_at && order\.status === 'REQUESTED'/);
  assert.match(admin, /fulfilment\s*\n?\s*\.collect\(order/, 'the scan does not collect');
});

test('and the card gate rides with it, so an uncollectable order still refuses', () => {
  // collect() carries dispatch.collectRefusal(). The refusal arrives on the
  // scan rather than on a button that no longer exists.
  const fulfilment = withoutComments(SRC('core', 'fulfilment.js'));
  const at = fulfilment.indexOf('async function collect(');
  const body = fulfilment.slice(at, fulfilment.indexOf('async function', at + 30));

  assert.match(body, /collectRefusal/, 'collect() lost the card gate');
});

// --- delivery is one screen --------------------------------------------------

test('DELIVERY IS THE PHOTO, AND THE PHOTO FREES THE TAGS AND CLIPS', () => {
  // Both taps confirmed work deliver() does anyway - releaseOrder() retires
  // every tag and unclipOrder() returns every number - and neither could
  // verify anything, because no screen sees a clip come off a bag.
  const fulfilment = withoutComments(SRC('core', 'fulfilment.js'));
  // To the end of the function, not a guessed window: deliver() is long, and a
  // slice that stops short fails on code that is present.
  const at = fulfilment.indexOf('async function deliver(');
  const body = fulfilment.slice(at, fulfilment.indexOf('\nfunction ', at));

  assert.match(body, /bags\.releaseOrder\(order\.id\)/, 'delivery stopped retiring the tags');
  assert.match(body, /bags\.unclipOrder\(order\.id\)/, 'delivery stopped freeing the clips');
});

test('and the instruction survives as a reminder on the one card', () => {
  // Nothing from LYNDRY goes into a customer's house. What went is the
  // confirmation, not the rule.
  const src = SRC('core', 'run.js');
  assert.match(src, /remove: clips\.length/, 'the reminder has gone');
  assert.match(src, /Take our tags and clips off before you leave/);

  const page = SRC('web', 'run-page.js');
  assert.match(page, /task\.remove/, 'the page does not draw the reminder');
});

// --- the columns stay, the taps do not --------------------------------------

test('THE INTERNAL COLUMNS SURVIVE, BECAUSE OTHER THINGS READ THEM', () => {
  // Neil: keep loaded_at, unloaded_at and clip_returned_at internally if you
  // must - just stop asking the driver to tap them. finishPickup() stamps
  // loaded_at for the whole order at once.
  const fulfilment = withoutComments(SRC('core', 'fulfilment.js'));
  const at = fulfilment.indexOf('async function finishPickup');
  const body = fulfilment.slice(at, fulfilment.indexOf('async function loadVan', at));

  assert.match(body, /loaded_at/, 'finishPickup stopped stamping loaded_at');
  assert.match(body, /clipped_at/, 'finishPickup stopped stamping clipped_at');

  // And the load-out pass still reads loaded_at, which is why it is kept.
  const dispatch = SRC('core', 'dispatch.js');
  assert.match(dispatch, /loaded_at/, 'nothing reads loaded_at any more');
});

test('and the bag count is what was scanned, not what was typed', () => {
  const fulfilment = withoutComments(SRC('core', 'fulfilment.js'));
  const at = fulfilment.indexOf('async function finishPickup');
  const body = fulfilment.slice(at, fulfilment.indexOf('async function loadVan', at));

  assert.match(body, /bag_count: labels\.length/, 'the count is not taken from the scans');
});

// --- the laundromat drop ------------------------------------------------------

test('THE DROP IS ONE CARD: HANDED OFF, PER CLIP', () => {
  // Three cards used to sit here - take the bags out of the van, hand each one
  // over, confirm the clips are back in the van - and two of them recorded the
  // bag moving rather than changing hands.
  const src = withoutComments(SRC('core', 'run.js'));

  assert.match(src, /stop\.dropStage = dropBags\.length \? 'handoff' : 'done'/, 'the drop still has stages');
  assert.ok(!/'unload'/.test(src), 'the unload stage is back');

  const page = withoutComments(SRC('web', 'run-page.js'));
  assert.ok(!/dropStage === 'unload'/.test(page), 'the unload card is back');
  assert.ok(!/run\/unloaded/.test(page), 'the unload form is back');
  assert.ok(!/run\/clips-back/.test(page), 'the clips-back card is back');
  assert.match(page, /dropStage === 'handoff'/, 'the handover card has gone');
});

test('AND HANDING A BAG OVER FREES ITS CLIP IN THE SAME TAP', () => {
  const src = withoutComments(SRC('core', 'bags.js'));
  const at = src.indexOf('async function handOffBag');
  const body = src.slice(at, src.indexOf('\n}', at));

  assert.match(body, /unclipped_at: now/, 'the laundromat does not take custody');
  assert.match(body, /clip_returned_at: now/, 'the clip is not freed');
  assert.match(body, /unloaded_at: label\.unloaded_at \|\| now/, 'unloaded_at stopped being written');

  // And it no longer refuses a bag that was never "unloaded".
  assert.ok(
    !/Take the bags out of the van first/.test(body),
    'handing off still demands the unload tap'
  );
});

// --- the retrieval ------------------------------------------------------------

test('RETRIEVAL IS SCAN, WEIGH, DONE', () => {
  const page = withoutComments(SRC('web', 'run-page.js'));
  const at = page.indexOf('function returnBagStep');
  const body = page.slice(at, page.indexOf('\n}', at));

  assert.match(body, /if \(!scanned\) return 'scan';/);
  assert.match(body, /weight_lb == null\) return 'weigh';/);
  assert.ok(!/'clip'/.test(body), 'the clip confirmation is back');
  assert.ok(!/'van'/.test(body), 'the put-it-in-the-van step is back');
});

test('and the clip is stamped with the weight, not confirmed after it', () => {
  const admin = withoutComments(SRC('routes', 'admin.js'));
  assert.match(admin, /clipped_at: label\.clipped_at \|\| new Date\(\)\.toISOString\(\)/);

  // The load-out pass stamps it too, so the other retrieval surface agrees.
  const loadout = withoutComments(SRC('core', 'loadout.js'));
  assert.match(loadout, /loaded_at: label\.loaded_at \|\| now/, 'the load-out pass lost the stamp');

  const page = withoutComments(SRC('web', 'loadout-page.js'));
  assert.ok(!/It is in the van/.test(page), 'the load-out van tap is back');
});

test('PAYMENT HOLD DOES NOT BLOCK RETRIEVAL', () => {
  // Neil's lock, and it predates this change: refusing to collect finished work
  // would leave our bags on somebody else's shelf at their cost. Hold keeps
  // laundry off a customer's doorstep, not off a laundromat's floor.
  const dispatch = SRC('core', 'dispatch.js');
  const at = dispatch.indexOf("kind: 'pickup_partner'");
  assert.notEqual(at, -1, 'the retrieval stop has moved');

  const block = dispatch.slice(at - 900, at + 200);
  assert.ok(!/paymentHold/.test(block), 'retrieval got gated on payment hold');
});

test('but it still blocks a delivery', () => {
  const dispatch = SRC('core', 'dispatch.js');
  const at = dispatch.indexOf('const deliverStops');
  const block = dispatch.slice(at, at + 400);
  assert.match(block, /!paymentHold\(o\)/, 'the delivery leg lost its gate');
});

// --- the columns stay -----------------------------------------------------

test('loaded_at, unloaded_at AND clip_returned_at ARE ALL STILL WRITTEN', () => {
  // Neil: keep them if something reads them, just stop asking the driver to
  // tap them. All three are stamped by the step that makes them true.
  const bagsSrc = withoutComments(SRC('core', 'bags.js'));
  const loadoutSrc = withoutComments(SRC('core', 'loadout.js'));
  const fulfilmentSrc = withoutComments(SRC('core', 'fulfilment.js'));

  const all = bagsSrc + loadoutSrc + fulfilmentSrc;
  for (const column of ['loaded_at', 'unloaded_at', 'clip_returned_at']) {
    assert.match(all, new RegExp(column), `${column} is no longer written anywhere`);
  }

  // And something still reads loaded_at, which is why it is kept.
  assert.match(SRC('core', 'dispatch.js'), /loaded_at/);
});

// --- the drop actually completes ---------------------------------------------

test('THE LAST BAG HANDED OVER MOVES THE ORDER TO THE LAUNDROMAT', () => {
  // A REGRESSION THIS PINS. dropAtPartner() used to be called by the "clips are
  // back in the van" card, which went when the van stopped being a custody
  // state - so bags were handed over one at a time and the order stayed
  // IN_PROCESS for ever. A stop that cannot be completed stops the route dead.
  const admin = withoutComments(SRC('routes', 'admin.js'));
  const at = admin.indexOf("router.post('/ops/run/handed-off'");
  assert.notEqual(at, -1, 'the handoff route has moved');

  const body = admin.slice(at, admin.indexOf('\nrouter.', at + 10));

  assert.match(body, /fulfilment\s*\n?\s*\.dropAtPartner\(order/, 'the handoff never drops the order');

  // Derived from the bags, so it is true however he got there - one at a time,
  // a reload, or a second phone.
  assert.match(body, /bags\.forOrder\(label\.order_id, 'PICKUP'\)/);
  assert.match(body, /if \(!remaining\.length\)/, 'it does not wait for the last bag');
});

test('and it records the laundromat he is standing in, not the plan', () => {
  // dropAtPartner() falls back to the booking-time plan when given nothing, and
  // that plan goes stale - a real order was navigated to one laundromat and
  // would have been recorded against another.
  const admin = withoutComments(SRC('routes', 'admin.js'));
  const at = admin.indexOf("router.post('/ops/run/handed-off'");
  const body = admin.slice(at, admin.indexOf('\nrouter.', at + 10));

  assert.match(body, /partner_id/, 'the handoff ignores which laundromat this is');
  assert.match(body, /UUID\.test/, 'the posted partner id is trusted unchecked');

  // And the form sends it.
  // To the form's own close, not a guessed window - the comment inside it is
  // long enough that a fixed slice stops before the input it is looking for.
  const page = withoutComments(SRC('web', 'run-page.js'));
  const from = page.indexOf('run/handed-off');
  const form = page.slice(from, page.indexOf('</form>', from));

  assert.match(form, /name="partner_id"/, 'the handoff form does not carry the laundromat');
});

test('a partly handed-over order is not dropped early', () => {
  const admin = withoutComments(SRC('routes', 'admin.js'));
  const at = admin.indexOf("router.post('/ops/run/handed-off'");
  const body = admin.slice(at, admin.indexOf('\nrouter.', at + 10));

  // The remaining set is bags still wearing a clip on the pickup leg, which is
  // exactly what the drop card lists.
  assert.match(body, /clip_number != null && l\.unclipped_at == null/);
  assert.match(body, /!l\.sticker_seq/, 'it counts laundromat stickers as ours');
});

test('and it only moves an order that is still in our hands', () => {
  // A second tap, a refresh, or a bag handed over after the order already
  // moved must not try to drop it again.
  const admin = withoutComments(SRC('routes', 'admin.js'));
  const at = admin.indexOf("router.post('/ops/run/handed-off'");
  const body = admin.slice(at, admin.indexOf('\nrouter.', at + 10));

  assert.match(body, /order\.status === 'IN_PROCESS'/, 'it drops an order in any state');
});
