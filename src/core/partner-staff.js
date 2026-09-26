'use strict';

const db = require('../db');
const { normalisePhone } = require('./phone');

// ---------------------------------------------------------------------------
// WHO CAN SIGN IN TO A LAUNDROMAT'S PORTAL.
//
// Neil, 26 September: "Shouldnt the laundromat page have a spot for me to add
// the owner/admin of the laudnromat url page. also i shoudl a link to that page
// and the ability to sign into it as well."
//
// EXTRACTED BECAUSE A SECOND DOOR APPEARED, which is the rule the whole codebase
// follows. These writes lived inline in `src/routes/shop.js` and were the only
// way in besides `npm run shop:user`; putting a second copy in `admin.js` for the
// ops page is exactly how "collected" would have drifted between the buttons and
// the JSON API. The portal and the ops screen call the same three functions now.
//
// TWO LADDERS THAT DO NOT MEET, AND THIS IS WHERE THE RUNG IS.
//
// LYNDRY says who OWNS a shop; the owner says who WORKS there. So `add()` takes a
// role and `addAttendant()` is the portal's door, which cannot pass one - an owner
// minting another owner is the thing the split exists to prevent, and a hidden
// form field is the submitter's to edit. Only ops may name an OWNER, which is
// precisely what Neil asked for.
//
// NOBODY IS EVER TEXTED BY ANY OF THIS. Somebody added goes on a list and signs in
// when they choose to, from the shop's own URL. An unprompted text saying "you
// have been added to a system" is a message nobody asked for.
// ---------------------------------------------------------------------------

const ROLES = Object.freeze({ OWNER: 'OWNER', ATTENDANT: 'ATTENDANT' });

// What the ops screen and the portal both select. One list, so a column added for
// one of them cannot arrive `undefined` at the other - the trap CLAUDE.md counts
// against CARD_FIELDS, BOARD_FIELDS, RUN_FIELDS and four more.
const FIELDS = 'id, partner_id, name, phone, role, status, last_seen_at, created_at';

async function list(partnerId) {
  if (!partnerId) return [];

  const { data, error } = await db
    .from('partner_users')
    .select(FIELDS)
    .eq('partner_id', partnerId)
    // Owners first, then alphabetically: the question this list answers most
    // often is "who runs this shop".
    .order('role', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
}

// ADD SOMEBODY TO A SHOP.
//
// `role` is honoured, so this is the ops door. The portal calls
// `addAttendant()` below, which cannot reach it.
async function add({ partnerId, name, phone, role = ROLES.ATTENDANT } = {}) {
  if (!partnerId) return { ok: false, reason: 'no_shop' };

  const number = normalisePhone(phone);
  const person = String(name || '').trim().slice(0, 60);

  if (!number) return { ok: false, reason: 'bad_phone' };
  if (!person) return { ok: false, reason: 'no_name' };

  // AN UNRECOGNISED ROLE FALLS BACK TO THE LEAST PRIVILEGED ONE, the same rule
  // `ops_users` follows for staff. Promoting is deliberate.
  const wanted = role === ROLES.OWNER ? ROLES.OWNER : ROLES.ATTENDANT;

  const { data, error } = await db
    .from('partner_users')
    .insert({ partner_id: partnerId, name: person, phone: number, role: wanted })
    .select(FIELDS)
    .maybeSingle();

  if (error) {
    // THE PHONE COLUMN IS UNIQUE ACROSS EVERY LAUNDROMAT, deliberately: a number
    // that signs in has to resolve to exactly one shop, or the sign-in page has to
    // ask which - and a person who works at two is a real thing we have chosen not
    // to support rather than a case nobody thought of.
    if (String(error.message).includes('duplicate') || error.code === '23505') {
      return { ok: false, reason: 'taken' };
    }
    throw error;
  }

  return { ok: true, person: data };
}

// The portal's door. It exists so the role cannot be passed even by mistake.
async function addAttendant({ partnerId, name, phone } = {}) {
  return add({ partnerId, name, phone, role: ROLES.ATTENDANT });
}

// SWITCH SOMEBODY ON OR OFF.
//
// `notSelfId` is the caller's own row when there is one - an owner in the portal -
// because the one action that can leave a shop with no owner and no way to add one
// is removing yourself, and undoing that takes a phone call to us. Ops passes
// nothing: Neil is not in the shop's staff list in the ordinary case, and if he
// has added himself he can still take himself back out.
async function setStatus(id, status, { partnerId, notSelfId = null } = {}) {
  if (!id || !partnerId) return { ok: false, reason: 'no_shop' };
  if (notSelfId && String(id) === String(notSelfId)) return { ok: false, reason: 'self' };

  const wanted = status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED';

  const { data, error } = await db
    .from('partner_users')
    .update({
      status: wanted,
      // SWITCHING SOMEBODY OFF ENDS THEIR SESSION NOW, not in eight hours.
      // `requirePartner` re-reads the row every request, so clearing the token is
      // belt and braces - and somebody just let go is where both belts matter.
      ...(wanted === 'ACTIVE' ? {} : { session_token: null }),
    })
    // SCOPED TO THE SHOP IN THE QUERY, never filtered afterwards. Somebody typing
    // another laundromat's user id into the address bar changes nothing there.
    .eq('id', id)
    .eq('partner_id', partnerId)
    .select(FIELDS)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, reason: 'not_theirs' };

  return { ok: true, person: data, status: wanted };
}

// MAKE SOMEBODY THE OWNER, OR TAKE IT BACK. OPS ONLY.
//
// There is no portal route to this and there must not be. It is the rung between
// the two ladders: LYNDRY decides who runs a shop, and the shop decides the rest.
//
// SEVERAL OWNERS ARE ALLOWED. A laundromat with two partners is ordinary, and a
// single-owner rule would mean deciding what happens when that one person leaves -
// which is the position the shop is in today with no owner at all.
async function setRole(id, role, { partnerId } = {}) {
  if (!id || !partnerId) return { ok: false, reason: 'no_shop' };

  const wanted = role === ROLES.OWNER ? ROLES.OWNER : ROLES.ATTENDANT;

  const { data, error } = await db
    .from('partner_users')
    .update({ role: wanted })
    .eq('id', id)
    .eq('partner_id', partnerId)
    .select(FIELDS)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, reason: 'not_theirs' };

  return { ok: true, person: data, role: wanted };
}

module.exports = {
  ROLES,
  FIELDS,
  list,
  add,
  addAttendant,
  setStatus,
  setRole,
};
