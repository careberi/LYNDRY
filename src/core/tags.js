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

function checkHandover({ wentIn, cameBack }) {
  const before = wentIn == null ? null : Number(wentIn);
  const after = cameBack == null ? null : Number(cameBack);
  if (before == null || after == null || before <= 0) return null;

  const difference = after - before;          // negative is lighter
  const allowedLoss = before * DRY_LOSS_PCT;

  if (difference > GAIN_LB) {
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
async function collectFromPartner(order, { bagCount, weightLb, driverId = null } = {}) {
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
  if (check && !check.ok) {
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
    count,
    weight,
    clips: clips.sort((a, b) => a - b),
    ranOut,
  };
}

module.exports = {
  claim,
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
