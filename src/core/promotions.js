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

const FIELDS =
  'id, name, blurb, kind, value, applies_to, audience, status, starts_at, ends_at, ' +
  'min_order_cents, max_discount_cents, expires_days';

// WHO A PROMOTION IS FOR. See migration 0066 - this replaced the auto_grant
// boolean, which could only ever say "new numbers" and had no way to say
// anything else. Nothing reads auto_grant any more.
const AUDIENCES = Object.freeze([
  {
    key: 'NEW_NUMBERS',
    label: 'Every new number, automatically',
    detail:
      'The moment somebody texts in for the first time they hold this, before they have booked anything. Only one promotion can do this at a time.',
    automatic: true,
  },
  {
    key: 'NEVER_ORDERED',
    label: 'Everybody who has never ordered',
    detail:
      'Anybody on the books with no delivered order. Given out in one go, when you press the button - not a standing rule.',
    automatic: false,
  },
  {
    key: 'EVERYONE',
    label: 'Every customer',
    detail: 'Everybody who has not opted out. Given out in one go, when you press the button.',
    automatic: false,
  },
  {
    key: 'SPECIFIC',
    label: 'Only people you pick',
    detail:
      'Nobody gets this automatically. You give it to one person at a time from their own profile.',
    automatic: false,
  },
]);

const audienceOf = (key) => AUDIENCES.find((a) => a.key === key) || AUDIENCES[3];

function live(promo, now = new Date()) {
  if (!promo || promo.status !== 'ACTIVE') return false;
  if (promo.starts_at && new Date(promo.starts_at) > now) return false;
  if (promo.ends_at && new Date(promo.ends_at) < now) return false;
  return true;
}

// HAS THIS PERSON'S GRANT RUN OUT. Separate from live(), which is about the
// promotion: a promotion can be perfectly alive while one holder's seven days
// are up.
function expired(grant, now = new Date()) {
  return Boolean(grant && grant.expires_at && new Date(grant.expires_at) <= now);
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
    .eq('audience', 'NEW_NUMBERS')
    .eq('status', 'ACTIVE')
    .maybeSingle();

  if (error) throw error;
  return live(data) ? data : null;
}

// Give somebody a promotion. Safe to call repeatedly - the unique index means
// a second grant is a no-op rather than a duplicate, which matters because the
// obvious place to call this is "every time an unknown number texts".
async function grant(customerId, promotionId) {
  // THE EXPIRY IS STAMPED HERE AND NEVER RECOMPUTED. "Seven days from when you
  // got it" is a different date for every holder, so it belongs on the grant -
  // and freezing it means editing the rule later cannot shorten a promise
  // somebody has already been given.
  const promo = await find(promotionId);
  const expiresAt =
    promo && promo.expires_days
      ? new Date(Date.now() + promo.expires_days * 24 * 3_600_000).toISOString()
      : null;

  const { data, error } = await db
    .from('customer_promotions')
    .insert({ customer_id: customerId, promotion_id: promotionId, expires_at: expiresAt })
    .select('*')
    .maybeSingle();

  // 23505 is "already has it", which is exactly what we want to happen.
  if (error && error.code !== '23505') throw error;
  return data || null;
}

// GIVE IT TO EVERYBODY THE AUDIENCE DESCRIBES, in one pass.
//
// Deliberately a button rather than a standing rule. A rule that keeps issuing
// in the background is a thing that texts customers while nobody is watching,
// and there is no order history yet for the interesting rules - "has not
// ordered in 30 days" matches nobody until people have ordered. When there is,
// this is where that grows.
//
// Idempotent: grant() already refuses a second copy, so pressing it twice
// reaches the same place as pressing it once.
async function issueToAudience(promotionId) {
  const promo = await find(promotionId);
  if (!promo) return { ok: false, reason: 'gone' };
  if (!live(promo)) return { ok: false, reason: 'not live' };
  if (promo.audience === 'SPECIFIC') return { ok: false, reason: 'that one is given out by hand' };
  if (promo.audience === 'NEW_NUMBERS') {
    return { ok: false, reason: 'that one is given out automatically' };
  }

  // An opted-out number is never included. STOP is a legal instruction, and a
  // promotion they cannot be told about is not a promotion.
  const { data: people, error } = await db
    .from('customers')
    .select('id')
    .neq('status', 'UNSUBSCRIBED');

  if (error) throw error;

  let eligible = people || [];

  if (promo.audience === 'NEVER_ORDERED') {
    const { data: delivered } = await db
      .from('orders')
      .select('customer_id')
      .eq('status', 'DELIVERED');

    const hasOrdered = new Set((delivered || []).map((o) => o.customer_id));
    eligible = eligible.filter((c) => !hasOrdered.has(c.id));
  }

  let given = 0;
  let already = 0;

  for (const person of eligible) {
    const row = await grant(person.id, promotionId);
    if (row) given += 1;
    else already += 1;
  }

  return { ok: true, given, already, considered: eligible.length };
}

// Everything this customer holds and has not spent.
async function heldBy(customerId) {
  if (!customerId) return [];

  const { data, error } = await db
    .from('customer_promotions')
    .select(`id, granted_at, redeemed_at, expires_at, promotions (${FIELDS})`)
    .eq('customer_id', customerId)
    .is('redeemed_at', null);

  if (error) throw error;

  return (data || [])
    .filter((row) => live(row.promotions) && !expired(row))
    .map((row) => ({
      grantId: row.id,
      grantedAt: row.granted_at,
      expiresAt: row.expires_at,
      ...row.promotions,
    }));
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

  const usable = held.filter((p) => {
    if (p.applies_to === 'FIRST_ORDER' && (delivered || 0) > 0) return false;

    // "Valid on orders over $30", checked against the price BEFORE the discount
    // comes off - otherwise a promotion could take an order under its own
    // minimum and disqualify itself. Not to be confused with the $25 order
    // minimum in config.pricing, which is the floor on what anything costs.
    if (p.min_order_cents && priceCents < p.min_order_cents) return false;

    return true;
  });
  if (!usable.length) return null;

  // The one worth the most to them. If two are somehow held, the customer gets
  // the better of the two rather than whichever was written first.
  let best = null;
  for (const promo of usable) {
    let cents =
      promo.kind === 'PERCENT_OFF'
        ? Math.round((priceCents * promo.value) / 100)
        : Math.min(promo.value, priceCents);

    // "30% off, up to $20". Only ever meaningful on a percentage, but applied
    // to both so a cap can never be quietly ignored.
    if (promo.max_discount_cents) cents = Math.min(cents, promo.max_discount_cents);

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

  const extras = [];
  if (promo.min_order_cents) extras.push(`orders over $${(promo.min_order_cents / 100).toFixed(2)}`);
  if (promo.max_discount_cents) {
    extras.push(`up to $${(promo.max_discount_cents / 100).toFixed(2)} off`);
  }
  if (promo.expires_days) {
    extras.push(`expires ${promo.expires_days} day${promo.expires_days === 1 ? '' : 's'} after it is given`);
  }

  return `${amount} ${when}${extras.length ? `, ${extras.join(', ')}` : ''}`;
}

module.exports = {
  list,
  find,
  autoGrant,
  grant,
  issueToAudience,
  heldBy,
  discountFor,
  redeem,
  describe,
  live,
  expired,
  AUDIENCES,
  audienceOf,
};
