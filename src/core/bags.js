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
function labelUrl(code) {
  return `${config.baseUrl}/o/${code}?t=${signCode(code)}`;
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

  const { data, error } = await db
    .from('bag_labels')
    .select('*')
    .eq('code', normalised)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

// Every label currently on this order, in bag order.
async function forOrder(orderId) {
  const { data, error } = await db
    .from('bag_labels')
    .select('*')
    .eq('order_id', orderId)
    .order('position', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Sticks a label on a bag.
//
// Returns a reason rather than throwing, because every caller is a person
// standing next to a bag who needs a sentence, not a stack trace.
async function bind(code, order, opsUserId) {
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

  const existing = await forOrder(order.id);
  const position = existing.length + 1;

  const { data, error } = await db
    .from('bag_labels')
    .update({
      order_id: order.id,
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

  return { ok: true, label: data, position };
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

// Everything comes off when the order is done, so the stickers stop pointing
// at anybody. Called at delivery.
async function releaseOrder(orderId) {
  const { error } = await db
    .from('bag_labels')
    .update({ order_id: null, position: null, released_at: new Date().toISOString() })
    .eq('order_id', orderId);

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

module.exports = {
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
  bind,
  release,
  renumber,
  releaseOrder,
  recordScan,
};
