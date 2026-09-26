'use strict';

const db = require('../db');
const bags = require('./bags');
const pricing = require('./pricing');
const promotions = require('./promotions');
const billing = require('./billing');
const notify = require('./notify');
const orderEvents = require('./order-events');

// ---------------------------------------------------------------------------
// ANOTHER BAG TURNED UP AFTER THE ORDER WAS PRICED.
//
// Neil, 26 September, on production order #2081: "there's actually two bags
// associated with that. Here's the other bag tag: HBSS3X. The other bag weighs 20
// pounds, but the customer was already charged $20. Um, but the total order would
// have been 40 pounds. Normally it would have been charged $80, but since it's
// 50% off, it should have been charged $40."
//
// NEITHER HALF OF THAT WAS REACHABLE FROM ANY SCREEN, and both will keep
// happening - a bag left in a van, a miscount at a counter, a customer who put
// two out and we picked up one.
//
//   adding the bag    the bag-count control only renders while the count is
//                     UNKNOWN, and `bags.bind()` refuses a sticker beyond the
//                     count. An order that already says "1 bag" can never say 2.
//   the money         `settleWeight()` returns early on anything already settled,
//                     so nothing re-prices and nothing charges. "Correct a
//                     weight" hits the same wall: it would record 40 lb and leave
//                     the price at $20.
//
// SO THIS IS ONE ACT, NAMED AFTER THE THING THAT ACTUALLY HAPPENED. Add the bag,
// re-price the WHOLE order on the new total, take the difference, and tell the
// customer. Four steps that only make sense together: doing any three leaves the
// order lying about itself.
//
// IT RE-PRICES FROM THE TOTAL, NEVER BY ADDING A SECOND CHARGE FOR ONE BAG. The
// minimum, the wash surcharge and the promotion all apply to an ORDER, not to a
// bag - a 50% offer on a second bag priced by itself would take 50% off $40 and
// come to the same number by luck, and a capped or minimum-bound order would not.
// The only honest arithmetic is "what would this order have cost if we had
// weighed it all at once", which is `pricing.priceOn()`, the same function the
// weigh-in uses.
//
// AND IT CHARGES THE DIFFERENCE, NOT THE TOTAL. They have already paid something.
// What is owed is the new price less what the ledger says has been taken, which
// is exactly `dispatch.balance()`'s question asked at a different moment.
// ---------------------------------------------------------------------------

// A bag cannot be added to an order whose laundry has already gone back: the
// weight is then a fact about a delivery that has happened, and re-pricing it
// would charge somebody after the fact for work they have already received and
// been billed for. That is a conversation, not a button.
const TOO_LATE = Object.freeze(['DELIVERED', 'CANCELED']);

async function addAndReprice(order, { code, weightLb, by = null, reason = null } = {}) {
  if (!order) return { ok: false, reason: 'no_order' };

  if (TOO_LATE.includes(order.status)) {
    return { ok: false, reason: 'too_late', detail: `That order is ${order.status.toLowerCase()}.` };
  }

  const parsed = bags.parseCode(String(code || ''));
  if (!parsed || !parsed.code) {
    return { ok: false, reason: 'bad_code', detail: 'That is not one of our tag codes.' };
  }

  const weight = Number(weightLb);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 200) {
    return { ok: false, reason: 'bad_weight', detail: 'That weight does not look right. Pounds, as a number.' };
  }

  // --- 1. room for it ------------------------------------------------------
  //
  // THE COUNT GOES UP FIRST, because `bind()` refuses a sticker beyond it. The
  // count is what the driver said at the door; this is us finding out he was
  // wrong, so the count has to learn before the sticker can.
  const was = Number(order.bag_count || 0);
  const now = was + 1;

  const { error: countError } = await db
    .from('orders')
    .update({ bag_count: now })
    .eq('id', order.id);

  if (countError) throw countError;

  // --- 2. the bag ----------------------------------------------------------
  //
  // THE ORDER HANDED TO `bind()` CARRIES THE NEW COUNT, and the first version did
  // not - which is the whole bug, found by running this against a real order
  // rather than by reading it. `bind()` reads `order.bag_count` off the OBJECT to
  // decide whether there is room, so passing the row as it was loaded a moment
  // earlier meant it still said 2 bags, refused with `too_many`, and the rollback
  // below put everything back. From the outside that is a button that does
  // nothing at all: the count is restored, no bag is added, and the only sign is a
  // banner saying the order is down as fewer bags than it now is.
  const bound = await bags.bind(parsed.code, { ...order, bag_count: now }, by && !by.isMachine ? by.id : null, {
    leg: 'PICKUP',
    position: now,
  });

  if (!bound.ok) {
    // PUT THE COUNT BACK. A refused sticker must not leave the order claiming a
    // bag that does not exist - the run would then wait for ever on a bag nobody
    // can scan, which is the failure `bind()`'s own limit exists to prevent.
    await db.from('orders').update({ bag_count: was }).eq('id', order.id);
    return { ok: false, reason: bound.reason || 'bind_failed', detail: bound.detail };
  }

  const weighed = await bags.recordBagWeight(parsed.code, weight, null, { order });
  if (!weighed.ok) {
    return { ok: false, reason: 'weigh_failed', detail: weighed.detail };
  }

  // --- 2b. the order's own total -------------------------------------------
  //
  // `recordBagWeight()` WRITES THE BAG AND NOT THE ORDER, which the first version
  // assumed the other way round - so the bag bound, the count went to 3, and the
  // order still said 22.5 lb at $45.00. Found by running it against a real order;
  // reading the code, "record a bag weight" sounds like it does this.
  //
  // `orders.weight_lb` is the SUM of the pickup bags and is recomputed from them
  // rather than added to, so a bag corrected later cannot drift the total. Same
  // call the driver's own weigh step makes.
  const totals = await bags.totalWeight(order.id, 'PICKUP');

  if (!totals || totals.pounds == null) {
    return { ok: false, reason: 'no_weight', detail: 'Nothing on this order has a weight.' };
  }

  const { error: totalError } = await db
    .from('orders')
    .update({ weight_lb: totals.pounds })
    .eq('id', order.id);

  if (totalError) throw totalError;

  // --- 3. what the order comes to now --------------------------------------
  //
  // READ BACK FROM THE BAGS rather than added to the old total. `orders.weight_lb`
  // is the SUM of `bag_labels.weight_lb` and is recomputed as each one is weighed,
  // so the total is a fact to be read, not arithmetic to be repeated.
  const { data: fresh, error: freshError } = await db
    .from('orders')
    .select('*, customers(*)')
    .eq('id', order.id)
    .maybeSingle();

  if (freshError) throw freshError;

  const billable = Number(fresh.weight_lb);
  const parts = pricing.priceOn(fresh, billable);

  if (!parts) return { ok: false, reason: 'no_weight' };

  // THE PROMOTION IS ASKED AGAIN AT THE NEW TOTAL, because that is what it
  // applies to: 50% of $80 is not 50% of $40 plus something. A capped offer is
  // the case that proves it - `max_discount_cents` bites on the bigger number.
  const deal = await promotions
    .discountFor(fresh.customers, fresh, parts.beforeDiscount)
    .catch((err) => {
      console.error(`Could not re-apply a promotion on ${fresh.id}: ${err.message}`);
      return null;
    });

  const discountCents = deal ? deal.cents : 0;
  const priceCents = Math.max(0, parts.beforeDiscount - discountCents);

  const wasPrice = Number(fresh.price_cents || 0);

  const { error: priceError } = await db
    .from('orders')
    .update({
      billable_weight_lb: billable,
      price_cents: priceCents,
      discount_cents: discountCents,
      promotion_id: deal ? deal.promotion.id : fresh.promotion_id,
    })
    .eq('id', fresh.id);

  if (priceError) throw priceError;

  await orderEvents
    .record(fresh.id, {
      kind: 'WEIGHT',
      summary:
        `Another bag: ${parsed.code} at ${weight} lb, so ${billable} lb in ${now} bags` +
        (was === now - 1 ? ` rather than ${was}` : ''),
      was: `${was} bag${was === 1 ? '' : 's'}`,
      became: `${now} bags, ${billable} lb`,
      by: { actor: by && by.name ? by.name : 'ops' },
      reason,
    })
    .catch(() => {});

  await orderEvents
    .record(fresh.id, {
      kind: 'PRICE',
      summary:
        `Re-priced at ${money(priceCents)} on ${billable} lb` +
        (deal ? `, less ${money(discountCents)} for ${deal.promotion.name}` : ''),
      was: money(wasPrice),
      became: money(priceCents),
      by: { actor: by && by.name ? by.name : 'ops' },
    })
    .catch(() => {});

  return {
    ok: true,
    order: { ...fresh, price_cents: priceCents, discount_cents: discountCents },
    code: parsed.code,
    bags: now,
    billable,
    wasPrice,
    priceCents,
    discountCents,
    promotion: deal ? deal.promotion : null,
    owed: Math.max(0, priceCents - Number(fresh.amount_paid_cents || 0)),
  };
}

function money(cents) {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

// WHAT THE CUSTOMER IS TOLD. Neil: "we also need to text the customer and let him
// know the total was updated."
//
// IT SAYS WHAT CHANGED AND WHY, because a second charge on a card with no
// explanation is a chargeback. The bag count is the reason and it is the part
// that makes the new number make sense - "your laundry weighed more" would read
// as our scale having been wrong.
//
// AND IT NAMES WHAT CAME OFF. A total lower than the arithmetic the customer can
// do themselves reads as a mistake unless the promotion is in the same message -
// the rule the weigh-in text already keeps.
function updatedTotalMessage({ bags: count, billable, priceCents, discountCents, promotion, extraCents }) {
  const lines = [
    `We found another bag with your order, so that is ${count} bags and ${billable} lb in total.`,
  ];

  lines.push(
    discountCents > 0 && promotion
      ? `The total is ${money(priceCents)} after ${money(discountCents)} off for ${promotion.name}.`
      : `The total is ${money(priceCents)}.`
  );

  if (extraCents > 0) {
    lines.push(`We have taken the extra ${money(extraCents)} off the same card.`);
  }

  return lines.join(' ');
}

module.exports = { addAndReprice, updatedTotalMessage, money, TOO_LATE };
