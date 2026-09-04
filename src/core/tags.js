'use strict';

const db = require('../db');
const bags = require('./bags');
const partners = require('./partners');

// ---------------------------------------------------------------------------
// The order tag.
//
// ONE identifier per order, carried by every bag of it. Three bags in and four
// bags out all read the same tag, because the tag is the ORDER and the order
// did not change when the laundromat repacked it.
//
// This replaces a code per bag. That older model was solving a problem nobody
// had - the wash instructions are per order, so a per-bag code told a
// laundromat nothing extra - while making the return leg genuinely hard,
// because a bag they packed had no code and somebody had to bind one to it at
// a counter.
//
// WHAT THE TAG IS NOT: it is not proof that all the bags are here. Nothing
// scannable can be, once every bag reads the same thing. What proves a handover
// is WEIGHT, which is Neil's framing and the right one - see checkHandover()
// at the bottom of this file.
//
// The code itself is generated and signed by src/core/bags.js, so a tag and a
// sticker are the same kind of object to a scanner and there is one
// implementation of "is this code genuinely ours".
// ---------------------------------------------------------------------------

// Give an order its tag, or hand back the one it already has.
//
// Idempotent on purpose: it is reached from the driver's screen and could be
// reached twice by a double tap, and an order quietly acquiring a second tag
// would mean the stickers already stuck to its bags stop resolving.
async function claim(orderId) {
  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, tag_code')
    .eq('id', orderId)
    .single();

  if (error) throw error;
  if (order.tag_code) return { ok: true, already: true, code: order.tag_code };

  // The unique index is the real guard. A collision at 32^6 is vanishingly
  // unlikely, but "unlikely" is not a reason to hand somebody another order's
  // laundry, so a clash simply retries.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = bags.generateCode();

    const { data, error: writeError } = await db
      .from('orders')
      .update({ tag_code: code })
      .eq('id', orderId)
      .is('tag_code', null)
      .select('tag_code')
      .maybeSingle();

    if (writeError && writeError.code !== '23505') throw writeError;
    if (data) return { ok: true, already: false, code: data.tag_code };

    // Either somebody else claimed one first, or the code was taken. Re-read
    // before deciding which.
    const { data: fresh } = await db
      .from('orders').select('tag_code').eq('id', orderId).single();

    if (fresh && fresh.tag_code) return { ok: true, already: true, code: fresh.tag_code };
  }

  return { ok: false, detail: 'Could not allocate a tag. Try again.' };
}

// The order behind a scanned tag, or null.
async function findByTag(rawCode) {
  const code = bags.normaliseCode(rawCode);
  if (!code) return null;

  const { data, error } = await db
    .from('orders')
    .select('*, customers(id, name, phone, address_line1, city, preferences)')
    .eq('tag_code', code)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

// The scannable URL for a tag. Same shape and same signature as a bag sticker,
// so one scanner handles both and the QR on a sheet of stickers is built the
// same way it always was.
function tagUrl(code) {
  return bags.labelUrl(code);
}

// --- The bags under a tag ---------------------------------------------------

// The per-bag record for one leg. A bag has a position and a weight and no
// identity of its own; the order tag is the identity.
async function bagsFor(orderId, leg = 'PICKUP') {
  return bags.forOrder(orderId, leg);
}

// Record what one bag weighs, by POSITION rather than by code.
//
// The sequence comes from the driver's screen - "bag 2 of 3, on the scale" -
// which is where it always came from. The sticker never knew which bag it was
// on; it only ever said which order.
async function weighBag(order, { position, weightLb, leg = 'PICKUP', photo = null }) {
  const weight = Number(weightLb);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 200) {
    return { ok: false, detail: 'That weight does not look right. Pounds, as a number.' };
  }

  const limit = leg === 'DELIVERY' ? order.return_bag_count : order.bag_count;
  const at = Number(position);

  if (!Number.isInteger(at) || at < 1 || (limit != null && at > Number(limit))) {
    return { ok: false, detail: `This order has ${limit == null ? 'no' : limit} bags on that leg.` };
  }

  const existing = (await bags.forOrder(order.id, leg)).find((b) => b.position === at) || null;
  const row = {
    order_id: order.id,
    leg,
    position: at,
    weight_lb: weight,
    weighed_at: new Date().toISOString(),
    bound_at: existing ? existing.bound_at : new Date().toISOString(),
  };

  if (existing) {
    const { error } = await db.from('bag_labels').update(row).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await db.from('bag_labels').insert(row);
    if (error) throw error;
  }

  return { ok: true, position: at, weight };
}

// The cumulative weight of a leg, and whether every bag of it is in.
async function total(orderId, leg = 'PICKUP', expected = null) {
  const rows = await bags.forOrder(orderId, leg);
  const weighed = rows.filter((b) => b.weight_lb != null);

  return {
    pounds: weighed.reduce((sum, b) => sum + Number(b.weight_lb), 0),
    bags: weighed.length,
    expected: expected == null ? null : Number(expected),
    allWeighed: expected != null && weighed.length === Number(expected),
  };
}

// --- Where a bag is in the process ------------------------------------------

// THE QR PAGE SHOWS A DIFFERENT THING AT EVERY STAGE, and this is what decides
// which. One code, scanned by two different people at four different moments,
// and each of them should see only the one thing they can do right now.
//
// DERIVED, NEVER STORED. It is read from the bag row and its order, both of
// which already know. A stage column would be a second copy of the same fact
// and would go stale the first time somebody used a different door - the same
// reason the driver's position in his route is derived rather than kept.
const STAGES = Object.freeze({
  BLANK:     'BLANK',      // printed, not on a bag yet
  TO_WEIGH:  'TO_WEIGH',   // on a bag at the customer's door, the driver must weigh it
  IN_VAN:    'IN_VAN',     // weighed and clipped, on its way
  TO_WEIGH_AT_PARTNER: 'TO_WEIGH_AT_PARTNER', // with the laundromat, they must weigh it
  WASHING:   'WASHING',    // they weighed it, so the instructions are theirs to read
  READY:     'READY',      // finished and waiting for the driver
  COLLECTED: 'COLLECTED',  // scanned back into the van
  DONE:      'DONE',       // delivered, and the sticker is retired
});

function stageOf(label, order) {
  if (!label || !label.order_id || !order) return STAGES.BLANK;
  if (label.released_at || order.status === 'DELIVERED') return STAGES.DONE;

  // An OUTPUT bag has a life of its own once it exists: the laundromat made it,
  // marked it ready, and the driver collects it.
  if (label.leg === 'DELIVERY') {
    if (label.loaded_at) return STAGES.COLLECTED;
    return STAGES.READY;
  }

  // An INTAKE bag. Its stage is where the order is, plus whether the weight
  // that stage needs has been given yet.
  if (label.weight_lb == null) return STAGES.TO_WEIGH;

  // HANDED OVER IS A FACT ABOUT THE BAG, NOT ABOUT THE ORDER.
  //
  // Neil, scanning a sticker seconds after handing that bag across a counter:
  // it still said "in the van". It was reading the order's status, which does
  // not move to AT_PARTNER until every bag is over and the clips are back - so
  // between those two moments a bag sitting on a laundromat shelf claimed to be
  // in a van three miles away.
  //
  // unclipped_at is stamped one bag at a time as it is handed over, so it is
  // the earliest and the most precise thing we know. The order's status still
  // answers for orders taken before the three-card drop-off existed, where
  // there was no per-bag moment to record.
  const handedOver = Boolean(label.unclipped_at) || order.status === 'AT_PARTNER';

  if (handedOver) {
    return label.partner_weight_lb == null ? STAGES.TO_WEIGH_AT_PARTNER : STAGES.WASHING;
  }

  if (order.status === 'READY') return STAGES.READY;
  return STAGES.IN_VAN;
}

// What the stage is called on the page, under the bag id. Neil asked for the
// stage to be visible, so somebody scanning a sticker can see where the bag is
// without having to work it out from what the page is offering them.
const STAGE_LABEL = Object.freeze({
  BLANK: 'Not on a bag yet',
  TO_WEIGH: 'Being collected',
  IN_VAN: 'In the van',
  TO_WEIGH_AT_PARTNER: 'Just arrived',
  WASHING: 'Being washed',
  READY: 'Ready for collection',
  COLLECTED: 'Back in the van',
  DONE: 'Delivered',
});

// --- Sub bags: one bag in, several out --------------------------------------

// Mark one of the stickers as a finished bag.
//
// THE SEQUENCE IS WHY THIS WORKS. Every sticker prints the same bag tag id,
// so without it "sub bag 2 is ready" could only be inferred from the order the
// scans happened to arrive in - and a sticker scanned twice would be
// indistinguishable from a second bag. With the sequence in the URL, each
// sticker is a fact rather than a guess.
//
// Idempotent: scanning the same sticker again says so rather than inventing
// another bag.
// THE THREE STATES A STICKER CAN BE IN, from the laundromat's point of view.
const STICKER = Object.freeze({ UNUSED: 'UNUSED', IN_USE: 'IN_USE', DONE: 'DONE' });

function stickerState(row) {
  if (!row) return STICKER.UNUSED;
  return row.finished_at ? STICKER.DONE : STICKER.IN_USE;
}

// What each of the stickers on a tag is doing right now.
async function stickersOn(parent) {
  const siblings = await bags.forOrder(parent.order_id, 'DELIVERY');
  const mine = siblings.filter((b) => b.parent_id === parent.id);

  // One entry per sticker the tag actually carries. Reads the constant so a
  // tag printed with three does not show a fourth slot nobody can peel.
  return Array.from({ length: bags.STICKERS_PER_TAG }, (_, i) => i + 1).map((seq) => {
    const row = mine.find((b) => b.sticker_seq === seq) || null;
    return { seq, row, state: stickerState(row) };
  });
}


// EVERY INTAKE BAG ON THIS ORDER THAT NOBODY HAS FINISHED YET.
//
// Neil marked one bag of a two-bag order finished and the whole order went
// READY - the second bag, RVR2E8, was never touched and was reported as done
// alongside it, and the "come and collect" alert went out. The check only ever
// looked at the stickers on the tag being scanned.
//
// An order is finished when EVERY bag we handed over has at least one finished
// bag packed against it. One intake bag can become any number of packed bags,
// so the test is "at least one", not a count - but it has to be true of all of
// them.
async function unfinishedBags(orderId) {
  const intake = await bags.forOrder(orderId, 'PICKUP');

  const outstanding = [];
  for (const bag of intake) {
    // A bag that never made it to the laundromat cannot be waiting on them.
    if (bag.released_at) continue;
    const stickers = await stickersOn(bag);
    if (!stickers.some((x) => x.state === STICKER.DONE)) outstanding.push(bag);
  }

  return outstanding;
}

// ONE TAP MOVES A STICKER ON: unused -> in use -> done -> unused.
//
// A cycle rather than three separate controls, because this is a phone held in
// one hand at a counter and three buttons per sticker is twelve buttons. The
// colour says which state it is in, so the tap is "advance this", not "guess".
//
// AND IT COMES BACK ROUTE TO UNUSED ON PURPOSE. A mis-tap is the most likely
// thing to happen on this page and there is nobody to undo it for them - going
// route again is the escape. Deleting the row is safe: it carries nothing but
// its own existence and its sequence, both of which are printed on the tag.
async function cycleSticker(parent, seq) {
  const n = Number(seq);
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    return { ok: false, detail: `That is not one of the ${bags.STICKERS_PER_TAG} stickers on the tag.` };
  }

  const siblings = await bags.forOrder(parent.order_id, 'DELIVERY');
  const existing = siblings.find((b) => b.parent_id === parent.id && b.sticker_seq === n) || null;

  // Not used yet -> in use.
  if (!existing) {
    const made = await markSubBagReady(parent, n);
    return made.ok ? { ok: true, state: STICKER.IN_USE } : made;
  }

  // In use -> done.
  if (!existing.finished_at) {
    const { error } = await db
      .from('bag_labels')
      .update({ finished_at: new Date().toISOString() })
      .eq('id', existing.id);

    if (error) throw error;
    return { ok: true, state: STICKER.DONE };
  }

  // Done -> unused. The way back from a mis-tap.
  const { error } = await db.from('bag_labels').delete().eq('id', existing.id);
  if (error) throw error;

  return { ok: true, state: STICKER.UNUSED };
}

// THE DRIVER TICKS A FINISHED BAG OFF AS HE PICKS IT UP.
//
// A toggle, like the attendant's sticker taps: not collected, then collected,
// then back if he set one down again. Same reasoning - a mis-tap at a counter
// has nobody to undo it, so tapping again is the escape.
//
// Per BAG rather than per order, because that is how they come across a
// counter. He is not sorting them into orders as he goes and should not have
// to; the sticker already says which order each one is.
async function toggleCollected(labelId) {
  const { data: row, error: findError } = await db
    .from('bag_labels')
    .select('id, collected_at, finished_at')
    .eq('id', labelId)
    .maybeSingle();

  if (findError) throw findError;
  if (!row) return { ok: false, detail: 'No bag with that id.' };

  // NOTHING THE LAUNDROMAT HAS NOT FINISHED. A bag they are still folding is
  // not on the counter to be picked up, and ticking it would put it in the van
  // in the system while it is still in a machine.
  if (!row.finished_at) {
    return { ok: false, detail: 'The laundromat has not marked that one finished yet.' };
  }

  const collected = !row.collected_at;

  const { error } = await db
    .from('bag_labels')
    .update({ collected_at: collected ? new Date().toISOString() : null })
    .eq('id', labelId);

  if (error) throw error;
  return { ok: true, collected };
}

async function markSubBagReady(parent, seq, { weightLb = null } = {}) {
  const n = Number(seq);
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    return { ok: false, detail: `That is not one of the ${bags.STICKERS_PER_TAG} stickers on the tag.` };
  }

  const siblings = await bags.forOrder(parent.order_id, 'DELIVERY');
  const already = siblings.find((b) => b.parent_id === parent.id && b.sticker_seq === n);

  if (already) {
    return { ok: true, already: true, bag: already, count: siblings.length };
  }

  const row = {
    order_id: parent.order_id,
    parent_id: parent.id,
    leg: 'DELIVERY',
    sticker_seq: n,
    // Position within the order's outgoing bags, so "bag 2 of 3" still works
    // across an order whose bags came from several intake bags.
    //
    // THE HIGHEST SO FAR PLUS ONE, NOT THE COUNT PLUS ONE. Counting assumes
    // the positions are contiguous, and they stop being contiguous the moment
    // a sticker is cycled back to unused and its row is deleted: one row left
    // sitting at position 2 makes "count + 1" produce 2 again, and the unique
    // index on (order_id, leg, position) rejects it with a 500 in the
    // laundromat's face. Found by tapping a sticker off and back on.
    position: siblings.reduce((max, b) => Math.max(max, Number(b.position) || 0), 0) + 1,
    code: parent.code,
    bound_at: new Date().toISOString(),
    weight_lb: weightLb == null ? null : Number(weightLb),
  };

  const { data, error } = await db.from('bag_labels').insert(row).select('*').single();
  if (error) throw error;

  return { ok: true, already: false, bag: data, count: siblings.length + 1 };
}

// The finished bags that came out of one intake bag.
async function subBagsOf(parentId) {
  const { data, error } = await db
    .from('bag_labels')
    .select('*')
    .eq('parent_id', parentId)
    .order('sticker_seq', { ascending: true });

  if (error) throw error;
  return data || [];
}

// --- Does what I am holding match what I should be holding? -----------------

// THE COMPARISON THAT IS NOT SYMMETRIC.
//
// Every other weight check in this system compares two scales weighing the SAME
// thing, so a gap either way just means one scale is off and Math.abs is right.
//
// This one compares DIRTY IN against CLEAN OUT, and those are not the same
// thing in a way that matters:
//
//   a bit lighter    normal. Water and grit came out of it. Every order.
//   a lot lighter    a bag has been left behind. The failure worth catching.
//   heavier, at all  somebody else's clothes are in the pile. Laundry does not
//                    gain weight in a dryer.
//
// A symmetric tolerance treats "2 lb lighter" and "2 lb heavier" identically
// and they mean opposite things, so the two directions get their own limits.
//
// HOW MUCH LIGHTER IS NORMAL IS NOT KNOWN YET and is deliberately generous
// until there is real data. Damp towels hold real water and a load of dry
// shirts holds none, so the honest thing is to record the drift on every order
// and tighten this once the spread is visible rather than invent a number now.
const DRY_LOSS_PCT = 0.08;   // 8% lighter is unremarkable
const GAIN_LB = 0.5;         // anything heavier than a rounding error is not

// `limits` comes from the settings row, so the two allowances are the admin's
// rather than constants. Falls back to the defaults when nothing is passed,
// which keeps every existing caller working unchanged.
function checkHandover({ wentIn, cameBack }, limits = null) {
  const before = wentIn == null ? null : Number(wentIn);
  const after = cameBack == null ? null : Number(cameBack);
  if (before == null || after == null || before <= 0) return null;

  const difference = after - before;          // negative is lighter

  // The admin's numbers when they are handed over, the constants otherwise so
  // every existing caller keeps working. DRY_LOSS_PCT is a fraction here and a
  // percentage in the settings row, which is why it is divided.
  const lossPct = limits && limits.dryLossPct != null ? Number(limits.dryLossPct) / 100 : DRY_LOSS_PCT;
  const gain = limits && limits.gainLb != null ? Number(limits.gainLb) : GAIN_LB;

  const allowedLoss = before * lossPct;

  if (difference > gain) {
    return {
      ok: false,
      direction: 'HEAVIER',
      difference,
      detail:
        `${after.toFixed(1)} lb came back against ${before.toFixed(1)} lb collected. ` +
        `Laundry does not get heavier in a dryer - check whether somebody else's ` +
        `bag is in this pile.`,
    };
  }

  if (-difference > allowedLoss) {
    return {
      ok: false,
      direction: 'LIGHTER',
      difference,
      detail:
        `${after.toFixed(1)} lb came back against ${before.toFixed(1)} lb collected, ` +
        `${Math.abs(difference).toFixed(1)} lb short. A bag may still be at the ` +
        `laundromat - do not leave without checking.`,
    };
  }

  return { ok: true, direction: 'OK', difference };
}

// --- Collecting the finished work off a laundromat --------------------------

// Weigh first, then clip. NEIL'S SEQUENCE, and the order of the two is the
// whole point.
//
// The driver is at a counter with some number of finished bags that carry
// nothing. Before any of them goes in the van he weighs the lot and it is
// checked against what he collected from the customer. Only if that passes do
// the clips go on.
//
// SO A CLIPPED BAG IS A VERIFIED BAG. That is the invariant this buys: the
// clips in the van are not just a way of telling orders apart, they are the
// record that this load was weighed and matched before it moved. Clipping
// first and checking later would leave a van full of bags whose status nobody
// knows.
//
// The clips are also what makes the return leg possible at all without putting
// a sticker on anything. A clip attaches to a bag ROW, not to a code - so the
// driver says how many bags there are, and each gets a row and a number,
// with nothing stuck to it. The laundromat is not asked to do anything.
//
// Nothing is created when the weight fails. A refusal that had already written
// four bag rows and taken four clips out of the pool would be a refusal that
// changed things, and the driver would have to undo it before he could retry.
async function collectFromPartner(
  order,
  { bagCount, weightLb, driverId = null, override = null } = {}
) {
  const count = Number(bagCount);
  const weight = Number(weightLb);

  if (!Number.isInteger(count) || count < 1 || count > 40) {
    return { ok: false, reason: 'count', detail: 'How many bags are you taking? A whole number.' };
  }
  if (!Number.isFinite(weight) || weight <= 0 || weight > 400) {
    return { ok: false, reason: 'weight', detail: 'What do they weigh altogether? Pounds, as a number.' };
  }

  const check = checkHandover({ wentIn: order.weight_lb, cameBack: weight });

  // THE GATE. Short means a bag is probably still on their shelf, and the one
  // place to find out is standing at the counter - not at somebody's door two
  // hours later.
  //
  // THE ESCAPE HATCH. The threshold is a guess and says so, and a laundromat
  // closing in five minutes does not care. So an admin can push past it with a
  // reason - never a driver, because the value of the check is that somebody
  // other than the person in a hurry agreed it was fine.
  //
  // It is an override, not a bypass: the check still runs, the result still
  // travels back on `overrode`, the caller still raises an issue, and the
  // reason goes in the change log with a name on it. A refusal that can be
  // waved away silently is not a check.
  const overrode = Boolean(check && !check.ok && override && override.reason);

  if (check && !check.ok && !overrode) {
    return { ok: false, reason: 'mismatch', check, detail: check.detail };
  }

  // Bag rows with no code on them. The bags are physical objects to carry and
  // clip; the ORDER is what they belong to, and the order already has its tag.
  const existing = await bags.forOrder(order.id, 'DELIVERY');
  const now = new Date().toISOString();

  const rows = [];
  for (let position = 1; position <= count; position += 1) {
    const already = existing.find((b) => b.position === position);
    if (already) { rows.push(already); continue; }

    const { data, error } = await db
      .from('bag_labels')
      .insert({ order_id: order.id, leg: 'DELIVERY', position, bound_at: now })
      .select('*')
      .single();

    if (error) throw error;
    rows.push(data);
  }

  // A clip per bag, lowest free first, scoped to whoever is driving.
  const clips = [];
  let ranOut = null;

  for (const row of rows) {
    const clipped = await bags.assignClip(row, driverId || order.driver_id);
    if (clipped.ok) clips.push(clipped.clip);
    else ranOut = clipped.detail;
  }

  const { error } = await db
    .from('orders')
    .update({ return_bag_count: count, return_weight_lb: weight.toFixed(2) })
    .eq('id', order.id);

  if (error) throw error;

  return {
    ok: true,
    check,
    // Truthy only when the check FAILED and somebody chose to go anyway. The
    // caller has to say so in the audit trail and out loud on the page - a
    // successful-looking result that quietly skipped a check is the thing this
    // whole file exists to prevent.
    overrode,
    overrideReason: overrode ? String(override.reason).slice(0, 300) : null,
    count,
    weight,
    clips: clips.sort((a, b) => a - b),
    ranOut,
  };
}

module.exports = {
  claim,
  STAGES,
  STAGE_LABEL,
  stageOf,
  markSubBagReady,
  cycleSticker,
  toggleCollected,
  stickersOn,
  unfinishedBags,
  stickerState,
  STICKER,
  subBagsOf,
  collectFromPartner,
  findByTag,
  tagUrl,
  bagsFor,
  weighBag,
  total,
  checkHandover,
  DRY_LOSS_PCT,
  GAIN_LB,
};
