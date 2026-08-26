'use strict';

const db = require('../db');

// ---------------------------------------------------------------------------
// Promotions.
//
// THE RULE THIS FILE EXISTS TO KEEP: the AI never invents money. It is handed
// the promotion's `blurb` - a sentence a person wrote - and may say it. It
// cannot create a promotion, cannot decide who qualifies, and cannot work out
// what anything costs. Code grants, code redeems, code discounts.
//
// Same shape as open_locker() taking no arguments, and for the same reason: no
// amount of clever texting should be able to move money.
//
// A GRANT IS A PROMISE TO A PERSON, and lives in customer_promotions rather
// than being recomputed from the promotion's rules. So ending a promotion
// stops new people getting it and never withdraws it from somebody who has
// already been told they have it - which would be the worse failure by far.
// ---------------------------------------------------------------------------

const FIELDS = 'id, name, blurb, kind, value, applies_to, auto_grant, status, starts_at, ends_at';

function live(promo, now = new Date()) {
  if (!promo || promo.status !== 'ACTIVE') return false;
  if (promo.starts_at && new Date(promo.starts_at) > now) return false;
  if (promo.ends_at && new Date(promo.ends_at) < now) return false;
  return true;
}

async function list({ includeEnded = false } = {}) {
  let q = db.from('promotions').select(FIELDS).order('created_at', { ascending: false });
  if (!includeEnded) q = q.eq('status', 'ACTIVE');

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function find(id) {
  const { data, error } = await db.from('promotions').select(FIELDS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

// The one promotion new numbers are given automatically, if there is one.
async function autoGrant() {
  const { data, error } = await db
    .from('promotions')
    .select(FIELDS)
    .eq('auto_grant', true)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  if (error) throw error;
  return live(data) ? data : null;
}

// Give somebody a promotion. Safe to call repeatedly - the unique index means
// a second grant is a no-op rather than a duplicate, which matters because the
// obvious place to call this is "every time an unknown number texts".
async function grant(customerId, promotionId) {
  const { data, error } = await db
    .from('customer_promotions')
    .insert({ customer_id: customerId, promotion_id: promotionId })
    .select('*')
    .maybeSingle();

  // 23505 is "already has it", which is exactly what we want to happen.
  if (error && error.code !== '23505') throw error;
  return data || null;
}

// Everything this customer holds and has not spent.
async function heldBy(customerId) {
  if (!customerId) return [];

  const { data, error } = await db
    .from('customer_promotions')
    .select(`id, granted_at, redeemed_at, promotions (${FIELDS})`)
    .eq('customer_id', customerId)
    .is('redeemed_at', null);

  if (error) throw error;

  return (data || [])
    .filter((row) => live(row.promotions))
    .map((row) => ({ grantId: row.id, grantedAt: row.granted_at, ...row.promotions }));
}

// What comes off an order, in cents, and which promotion did it.
//
// Returns { cents, promotion, grantId } or null. Never applies more than one:
// stacking discounts is a business decision nobody has made, and quietly
// applying two would be making it.
async function discountFor(customer, order, priceCents) {
  if (!customer || !priceCents) return null;

  const held = await heldBy(customer.id);
  if (!held.length) return null;

  // FIRST_ORDER means their first DELIVERED order. Counting every order would
  // let somebody book three, have them all discounted, and cancel two.
  const { count: delivered } = await db
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customer.id)
    .eq('status', 'DELIVERED')
    .neq('id', order.id);

  const usable = held.filter((p) => p.applies_to !== 'FIRST_ORDER' || (delivered || 0) === 0);
  if (!usable.length) return null;

  // The one worth the most to them. If two are somehow held, the customer gets
  // the better of the two rather than whichever was written first.
  let best = null;
  for (const promo of usable) {
    const cents =
      promo.kind === 'PERCENT_OFF'
        ? Math.round((priceCents * promo.value) / 100)
        : Math.min(promo.value, priceCents);

    if (!best || cents > best.cents) best = { cents, promotion: promo, grantId: promo.grantId };
  }

  // Never more than the price. A discount cannot hand money back.
  if (best) best.cents = Math.max(0, Math.min(best.cents, priceCents));
  return best && best.cents > 0 ? best : null;
}

// Spend it. Written at the moment the order is priced, so a promotion is used
// exactly once even if the price is settled twice.
async function redeem(grantId, orderId) {
  const { error } = await db
    .from('customer_promotions')
    .update({ redeemed_at: new Date().toISOString(), order_id: orderId })
    .eq('id', grantId)
    .is('redeemed_at', null);

  if (error) throw error;
}

// How a promotion reads to a person. Used on the ops screens and nowhere near
// the AI, which gets the blurb instead.
function describe(promo) {
  if (!promo) return '';
  const amount =
    promo.kind === 'PERCENT_OFF' ? `${promo.value}% off` : `$${(promo.value / 100).toFixed(2)} off`;
  const when = promo.applies_to === 'FIRST_ORDER' ? 'their first order' : 'every order';
  return `${amount} ${when}`;
}

module.exports = { list, find, autoGrant, grant, heldBy, discountFor, redeem, describe, live };
