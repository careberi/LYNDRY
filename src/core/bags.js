'use strict';

const crypto = require('crypto');

const db = require('../db');
const { config } = require('../config');

// ---------------------------------------------------------------------------
// Bag labels.
//
// A sticker with a code on it and a QR that opens a page about the bag it is
// stuck to. One file owns everything about them: making codes, proving a
// scanned one is genuine, binding it to a bag, and letting it go again.
//
// THE SHAPE OF IT, because it is not obvious:
//
//   1. Stickers are printed BLANK, in batches, and live in the van. There is
//      no printer at a customer's door, so a label cannot be made per order.
//   2. The driver sticks one on a bag and scans it. That binds the code to
//      that order and that bag position.
//   3. When the order is finished the binding is released. A sticker fished
//      out of a bin points at nothing.
//
// So a label is a reusable pointer, not an identity. The order is the identity,
// and `orders.order_number` is still what a person says out loud.
// ---------------------------------------------------------------------------

// Crockford's base32: the digits and the letters, minus I, L, O and U.
//
// The goal is a code somebody can read off a sticker in a badly lit basement
// and say down a phone without being asked "was that an oh or a zero". The
// obvious approach is to drop BOTH characters of every confusable pair, but
// that makes a misread unrecoverable - if a code can contain neither O nor 0,
// somebody who says "oh" has given you nothing to correct.
//
// Crockford keeps one of each pair and folds the other onto it on the way in,
// so O becomes 0 and I and L become 1 and the misread simply resolves. U is
// out for a different reason: it keeps random codes from spelling things
// nobody wants printed on a sticker.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 6;

// 32^6 is about 1.07 billion. Codes are drawn at random from all of it and are
// NEVER SEQUENTIAL, so a scanned sticker tells you nothing about the next one.
function generateCode() {
  // 256 is a multiple of 32, so every byte maps onto exactly one letter and no
  // letter is more likely than another. No rejection loop needed.
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += ALPHABET[bytes[i] % 32];
  return out;
}

// What somebody typed or a camera read, turned into what we store. Handles the
// lowercase every phone keyboard produces and the three confusable letters.
function normaliseCode(raw) {
  const folded = String(raw || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');

  if (folded.length !== CODE_LENGTH) return null;
  return [...folded].every((ch) => ALPHABET.includes(ch)) ? folded : null;
}

// --- Proving a scanned sticker is one of ours -------------------------------
//
// The QR encodes /o/<code>?t=<signature>. The signature is not a session and
// carries no expiry: it says only "this code was printed by us".
//
// It cannot carry an expiry, because the sticker is printed weeks before it is
// stuck to anything and a printed token cannot be reissued. What limits the
// window is the BINDING, not the token - the page shows an order only while
// the label is on a live bag, and the moment the order is finished it shows
// nothing. That is a tighter window than a fixed 48 hours would have been, and
// it needs no clock.
//
// The key is derived from ADMIN_API_KEY rather than being it, and with its own
// label, so a label signature can never be replayed as a staff cookie or a
// customer session.
function signingKey() {
  return crypto.createHmac('sha256', config.adminApiKey).update('lyndry.bag.labels').digest();
}

function signCode(code) {
  // Truncated to 16 hex characters. This is a cheap gate on a URL that is also
  // protected by a billion-wide random code, not the thing standing between a
  // stranger and somebody's laundry - that is the binding check below.
  return crypto.createHmac('sha256', signingKey()).update(`label.${code}`).digest('hex').slice(0, 16);
}

function verifyCode(code, signature) {
  const expected = signCode(code);
  const given = String(signature || '');
  if (given.length !== expected.length) return false;
  // Constant time, so the signature cannot be guessed a character at a time.
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

// The full URL that goes in the QR on the sticker.
//
// `seq` is which of the four peelable stickers on the tag this one is. It is
// NOT part of the signature and does not need to be: the signature proves you
// are holding a tag we printed, and the sequence only chooses which sticker on
// that same tag the page is talking about. Somebody who can change the 1 to a
// 2 was already holding a tag with both numbers on it.
function labelUrl(code, seq) {
  const base = `${config.baseUrl}/o/${code}?t=${signCode(code)}`;
  return seq ? `${base}&s=${seq}` : base;
}

// --- Printing a batch -------------------------------------------------------

// Makes `count` blank stickers. Collisions are astronomically unlikely but the
// unique index would reject one, so a clash simply retries rather than failing
// the whole sheet.
async function mint(count) {
  const wanted = Math.max(1, Math.min(500, Number(count) || 0));
  const made = [];

  for (let attempt = 0; attempt < wanted * 3 && made.length < wanted; attempt += 1) {
    const code = generateCode();
    const { data, error } = await db.from('bag_labels').insert({ code }).select('*').maybeSingle();

    // 23505 is Postgres for "that already exists". Any other error is real.
    if (error && error.code !== '23505') throw error;
    if (data) made.push(data);
  }

  if (made.length < wanted) {
    throw new Error(`Only ${made.length} of ${wanted} labels could be created.`);
  }

  return made;
}

// --- Binding one to a bag ---------------------------------------------------

async function findByCode(code) {
  const normalised = normaliseCode(code);
  if (!normalised) return null;

  // THE INTAKE BAG, not just any row with this code.
  //
  // A bag tag id is shared by up to five rows - the bag itself and the four
  // stickers off it - so maybeSingle() on the code alone started throwing the
  // moment a laundromat marked a finished bag. sticker_seq is null on exactly
  // one of them, and that one is the bag.
  const { data, error } = await db
    .from('bag_labels')
    .select('*')
    .eq('code', normalised)
    .is('sticker_seq', null)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

// The labels on an order, optionally just one leg of the journey.
//
// LEG MATTERS AND THE DEFAULT IS DELIBERATELY "ALL". A caller asking "what is
// on this order" wants everything - the order page, the audit trail. A caller
// asking "are all the bags here" must name a leg, because the two counts have
// nothing to do with each other: the laundromat repacks a customer's two bags
// into one of its own, or one into two.
async function forOrder(orderId, leg = null) {
  let query = db.from('bag_labels').select('*').eq('order_id', orderId);
  if (leg) query = query.eq('leg', leg);

  const { data, error } = await query.order('position', { ascending: true });

  if (error) throw error;
  return data || [];
}


// EVERY LABEL FOR A SET OF ORDERS, IN ONE ROUND TRIP.
//
// forOrder() in a loop is one query per order, and the guided run walks every
// order on every stop - which was seven separate bag_labels queries on a
// three-stop round, each one a network hop to Supabase. On a phone over
// cellular that is most of the wait between tapping a bag and seeing it turn
// green.
//
// Returns a Map keyed by order id so callers index rather than filter.
async function forOrders(orderIds, leg = null) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  const byOrder = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return byOrder;

  let query = db.from('bag_labels').select('*').in('order_id', ids);
  if (leg) query = query.eq('leg', leg);

  const { data, error } = await query.order('position', { ascending: true });
  if (error) throw error;

  for (const row of data || []) {
    const list = byOrder.get(row.order_id);
    if (list) list.push(row);
  }

  return byOrder;
}

// The bags collected from the customer. These carry the weight that priced the
// order and that a laundromat's figure is checked against.
function pickupBags(orderId) {
  return forOrder(orderId, 'PICKUP');
}

// The bags coming back from the laundromat. These are what gets scanned at the
// door, and there may be more or fewer of them than were collected.
function deliveryBags(orderId) {
  return forOrder(orderId, 'DELIVERY');
}

// Which leg a sticker being put on RIGHT NOW belongs to.
//
// Worked out from where the order is rather than asked, because the person
// holding the sticker is standing at a counter with his hands full and the
// answer is never in doubt: before the laundromat has finished, a bag is one we
// collected; after, it is one they packed.
//
// AT_PARTNER stays PICKUP deliberately. The bags are on their floor, so a
// sticker going on then is a driver correcting one he missed at the door, not a
// finished bag - he is not there to collect yet.
function legForStatus(status) {
  return ['READY', 'OUT_FOR_DELIVERY'].includes(status) ? 'DELIVERY' : 'PICKUP';
}

// Sticks a label on a bag.
//
// Returns a reason rather than throwing, because every caller is a person
// standing next to a bag who needs a sentence, not a stack trace.
async function bind(code, order, opsUserId, { leg = 'PICKUP' } = {}) {
  const label = await findByCode(code);
  if (!label) return { ok: false, reason: 'unknown', detail: 'No label with that code.' };

  if (label.order_id && label.order_id !== order.id) {
    return {
      ok: false,
      reason: 'in_use',
      detail: 'That label is already on another order. Use a fresh sticker.',
    };
  }

  // Already on this order. Not an error - a driver scanning the same sticker
  // twice has done nothing wrong and should be told so calmly.
  if (label.order_id === order.id) {
    return { ok: true, label, already: true };
  }

  // COUNTED WITHIN THE LEG, NEVER ACROSS IT. A delivery sticker is not a fourth
  // pickup bag; it is delivery bag 1. Counting all the labels on the order
  // together was the bug - it made a returning bag look like a spare one.
  const existing = await forOrder(order.id, leg);

  // NO MORE STICKERS THAN BAGS. The driver counts them before he starts, so a
  // fourth sticker on a three-bag order is a mistake - a sticker peeled off by
  // accident, or somebody else's bag. Letting it through leaves the order
  // waiting on a bag that does not exist, which is exactly what happened in
  // testing: three bags weighed, and the run still asking for a fourth.
  //
  // Each leg has its OWN count, and they are unrelated: bag_count is what was
  // collected, return_bag_count is what the laundromat handed back. Only when
  // the count is known - a count nobody has entered yet is not a limit of zero.
  const limit = leg === 'DELIVERY' ? order.return_bag_count : order.bag_count;

  if (limit != null && existing.length >= Number(limit)) {
    const what = leg === 'DELIVERY' ? 'coming back' : 'collected';
    return {
      ok: false,
      reason: 'too_many',
      detail:
        `This order is down as ${limit} bag${Number(limit) === 1 ? '' : 's'} ${what} and ` +
        `${existing.length} already ${existing.length === 1 ? 'has' : 'have'} a sticker. ` +
        `Change the count on the order if there really is another one.`,
    };
  }

  const position = existing.length + 1;

  const { data, error } = await db
    .from('bag_labels')
    .update({
      order_id: order.id,
      leg,
      position,
      bound_at: new Date().toISOString(),
      bound_by: opsUserId || null,
      released_at: null,
    })
    .eq('id', label.id)
    // Only if it is still free. Two drivers scanning the same sticker at once
    // cannot both win.
    .is('order_id', null)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return { ok: false, reason: 'in_use', detail: 'That label was just taken. Use a fresh sticker.' };
  }

  return { ok: true, label: data, position, leg };
}

// Takes a label off an order, and closes the gap so the remaining bags stay
// "1 of 2" rather than "1 of 2" and "3 of 2".
async function release(labelId) {
  const { data: label, error } = await db
    .from('bag_labels')
    .update({ order_id: null, position: null, released_at: new Date().toISOString() })
    .eq('id', labelId)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!label) return null;

  return label;
}

// Renumbers whatever is left on an order, so positions are always 1..n.
async function renumber(orderId) {
  const labels = await forOrder(orderId);

  for (let i = 0; i < labels.length; i += 1) {
    const wanted = i + 1;
    if (labels[i].position === wanted) continue;
    // Cleared first, because the unique index would refuse a straight swap.
    await db.from('bag_labels').update({ position: null }).eq('id', labels[i].id);
    await db.from('bag_labels').update({ position: wanted }).eq('id', labels[i].id);
  }

  return forOrder(orderId);
}

// Retire the stickers when the order is done.
//
// `released_at` is what stops /o/<code> resolving - a sticker out of a bin must
// point at nothing. But the LINK is what dies, not the record: order_id and
// position stay, so the order page can still show which codes were on which
// bag long after delivery.
//
// The first version cleared order_id here as well, and a delivered order then
// showed "no labels yet" - the history was destroyed to achieve the security
// property, when only the lookup needed to stop working.
//
// This does mean a label is a consumable: one sticker, one order, for good.
// Which is what it physically is - it goes back to the customer stuck to their
// bag. `release()` above is the other thing, an error correction, and that one
// genuinely does hand the sticker back to the blank pile.
async function releaseOrder(orderId) {
  const { error } = await db
    .from('bag_labels')
    .update({ released_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .is('released_at', null);

  if (error) console.error(`Could not release bag labels for order ${orderId}: ${error.message}`);
}

// --- The record of who looked ----------------------------------------------
//
// /o/<code> has no login, so this is the only trace of who reached it. Written
// for every outcome including the refusals, because "a stranger saw that page"
// is a question that can only be answered from the failures as well.
async function recordScan({ code, orderId, outcome, ip, userAgent }) {
  const { error } = await db.from('bag_label_scans').insert({
    code: String(code || '').slice(0, 32),
    order_id: orderId || null,
    outcome,
    ip: ip ? String(ip).slice(0, 64) : null,
    user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
  });

  // Never let logging break the page a driver is standing in front of.
  if (error) console.error(`Could not record a label scan: ${error.message}`);
}

// --- Weighing, one bag at a time --------------------------------------------
//
// A driver stands at a door holding ONE bag. He sticks a label on it, puts it
// on the scale, photographs the display, and picks up the next one. Asking for
// a single number at the end asks him to add up in his head while his hands are
// full, and loses which bag was the heavy one.
//
// THE ORDER'S WEIGHT IS THE SUM OF ITS BAGS, recomputed here every time one is
// weighed. `orders.weight_lb` stays the authoritative figure - it is what
// prices the order and what the laundromat's number is checked against - it is
// simply added up rather than typed once.
const WEIGHT_PHOTO_BUCKET = 'weight-photos';

async function recordBagWeight(code, weightLb, photo, { order } = {}) {
  const label = await findByCode(code);
  if (!label) return { ok: false, detail: 'No label with that code.' };

  if (order && label.order_id !== order.id) {
    return { ok: false, detail: `${label.code} is not on this order.` };
  }

  const weight = Number(weightLb);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 200) {
    return { ok: false, detail: 'That weight does not look right. Pounds, as a number.' };
  }

  // The photo goes up BEFORE the weight is written, the same way the
  // order-level weighing does it: we would rather refuse the step than record a
  // number whose evidence silently failed to save.
  let photoPath = label.weight_photo_path || null;

  if (photo && photo.buffer) {
    const extension = (String(photo.mimetype || '').split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const path = `${label.order_id}/bag-${label.code}-${Date.now()}.${extension}`;

    const { error: uploadError } = await db.storage
      .from(WEIGHT_PHOTO_BUCKET)
      .upload(path, photo.buffer, { contentType: photo.mimetype, upsert: false });

    if (uploadError) {
      return {
        ok: false,
        detail: `The scale photo did not save (${uploadError.message}). Nothing has been weighed - try again.`,
      };
    }

    photoPath = path;
  }

  const { error } = await db
    .from('bag_labels')
    .update({ weight_lb: weight, weighed_at: new Date().toISOString(), weight_photo_path: photoPath })
    .eq('id', label.id);

  if (error) throw error;

  return { ok: true, label: { ...label, weight_lb: weight } };
}

// Add the bags up and put the total on the order.
//
// Returns null when nothing is weighed yet, so a caller can tell "no bags on
// the scale" apart from "the bags weighed nothing".
// The weight of one leg's bags, added up.
//
// DEFAULTS TO PICKUP, AND THAT DEFAULT IS LOAD-BEARING. This figure is what
// prices the order. Summing every label on the order would, the moment a
// returning bag was weighed at a laundromat counter, quietly add the clean
// weight to the dirty one and DOUBLE what the customer is charged.
async function totalWeight(orderId, leg = 'PICKUP') {
  const labels = await forOrder(orderId, leg);
  const weighed = labels.filter((l) => l.weight_lb != null);
  if (!weighed.length) return null;

  return {
    pounds: weighed.reduce((t, l) => t + Number(l.weight_lb), 0),
    bags: weighed.length,
    total: labels.length,
    allWeighed: weighed.length === labels.length && labels.length > 0,
  };
}

// --- The numbered clip that rides with a bag --------------------------------
//
// A sticker code identifies a bag perfectly and is useless shouted across a
// laundromat counter. The clip is the short handle: "four, six and ten."
//
// CLIPS ARE STOCK, NOT NUMBERS WE MAKE UP. There is a real bag of them in the
// van, so the pool is finite and the lowest free one is handed out. Running out
// on a heavy day is a real thing, and saying so is better than inventing clip
// 51 that nobody owns.
//
// Scoped to the DRIVER, because each van has its own set - Dan's clip 4 and
// somebody else's clip 4 are two different clips.

// Which numbers are on a bag right now, for this driver.
async function clipsInUse(driverId) {
  const { data, error } = await db
    .from('bag_labels')
    .select('clip_number, orders!inner(driver_id)')
    .not('clip_number', 'is', null)
    .is('unclipped_at', null)
    .eq('orders.driver_id', driverId);

  if (error) throw error;
  return new Set((data || []).map((l) => Number(l.clip_number)));
}

// Put the lowest free clip on this bag.
//
// Lowest rather than next-in-sequence so the numbers stay small and reusable -
// a driver would rather clip 3 than clip 47 when both are in his hand.
async function assignClip(label, driverId) {
  if (label.clip_number != null && label.unclipped_at == null) {
    return { ok: true, clip: Number(label.clip_number), already: true };
  }

  const taken = await clipsInUse(driverId);
  const total = config.routing.vanClips;

  let clip = null;
  for (let n = 1; n <= total; n += 1) {
    if (!taken.has(n)) {
      clip = n;
      break;
    }
  }

  if (clip == null) {
    return {
      ok: false,
      detail:
        `Every one of your ${total} clips is on a bag. Drop a load at a laundromat ` +
        `to free some up, or put more clips in the van.`,
    };
  }

  const { error } = await db
    .from('bag_labels')
    // clipped_at is NOT set here. Assigning a clip is the system RESERVING a
    // number; clipped_at means a driver has physically put that clip on that
    // bag and said so. They were the same moment, which meant nobody was ever
    // asked to do it - Neil weighed a bag and was never told a clip existed.
    //
    // clip_number is what makes the number taken, so reserving still keeps it
    // out of anybody else's pool.
    .update({ clip_number: clip, clipped_at: null, unclipped_at: null })
    .eq('id', label.id);

  if (error) throw error;

  return { ok: true, clip };
}

// The clips come off when the bags are handed over, which is what makes those
// numbers free again. Never clears clip_number itself: the order page can then
// still say which clip a bag travelled under, the same way a released sticker
// keeps its order.
async function unclipOrder(orderId) {
  const { data, error } = await db
    .from('bag_labels')
    .update({ unclipped_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .is('unclipped_at', null)
    .not('clip_number', 'is', null)
    .select('clip_number');

  if (error) throw error;
  return (data || []).map((l) => Number(l.clip_number)).sort((a, b) => a - b);
}

// What is on the van right now, as clip numbers, grouped by order. What the
// laundromat stop reads off.

// THE DRIVER SAYS THE CLIP IS ON. One bag, one confirmation - the step Neil
// asked for and the one that was missing.
async function confirmClip(label) {
  if (!label || label.clip_number == null) {
    return { ok: false, detail: 'That bag has no clip number yet.' };
  }
  if (label.clipped_at) return { ok: true, clip: Number(label.clip_number), already: true };

  const { error } = await db
    .from('bag_labels')
    .update({ clipped_at: new Date().toISOString() })
    .eq('id', label.id);

  if (error) throw error;
  return { ok: true, clip: Number(label.clip_number) };
}


// ONE BAG GOES IN THE VAN. Per bag, because a driver deals with one bag
// completely and then picks up the next - and because a bag left on a porch
// while its neighbour is weighed is invisible to a single tap at the end.
async function loadBag(label) {
  if (!label) return { ok: false, detail: 'No such bag.' };
  if (!label.clipped_at) {
    return { ok: false, detail: 'Put the clip on it first - that is how it gets found again.' };
  }
  if (label.loaded_at) return { ok: true, already: true };

  const { error } = await db
    .from('bag_labels')
    .update({ loaded_at: new Date().toISOString() })
    .eq('id', label.id);

  if (error) throw error;
  return { ok: true };
}

function clipsFor(labels) {
  return (labels || [])
    .filter((l) => l.clip_number != null && l.unclipped_at == null)
    .map((l) => Number(l.clip_number))
    .sort((a, b) => a - b);
}

module.exports = {
  clipsInUse,
  confirmClip,
  loadBag,
  assignClip,
  unclipOrder,
  clipsFor,
  recordBagWeight,
  totalWeight,
  ALPHABET,
  CODE_LENGTH,
  generateCode,
  normaliseCode,
  signCode,
  verifyCode,
  labelUrl,
  mint,
  findByCode,
  forOrder,
  forOrders,
  pickupBags,
  deliveryBags,
  legForStatus,
  bind,
  release,
  renumber,
  releaseOrder,
  recordScan,
};
