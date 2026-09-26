'use strict';

const { config } = require('../config');

// ---------------------------------------------------------------------------
// WHAT AN ORDER COSTS AT A GIVEN WEIGHT, BEFORE ANY DISCOUNT.
//
// EXTRACTED BECAUSE THERE WERE ALREADY TWO COPIES AND A THIRD WAS ABOUT TO BE
// WRITTEN. `recordWeight()` and `settleWeight()` each worked the same four lines
// out for themselves, and re-pricing an order when a late bag turns up needs the
// same arithmetic a third time. Three copies of how an order is priced is three
// chances for one of them to disagree - and the one that disagrees is the one
// that charges somebody the wrong amount.
//
// THE TERMS COME OFF THE ORDER, NEVER FROM TODAY'S CONFIG. `price_per_lb_cents`
// and `minimum_cents` are snapshotted when the pickup is booked, so changing the
// price must not re-price work already quoted. The config values are the fallback
// for rows written before those columns existed.
//
// THE MINIMUM IS PART OF THE PRICE, not just part of the charging. Without that,
// a 10 lb order at $2.00 recorded $20.00 as its price while the customer was
// charged the $25.00 minimum, so the order under-reported its own revenue and
// every total built on it was short by the difference.
//
// PAID WASH OPTIONS SIT ON TOP OF THE MINIMUM, NOT INSIDE IT. Free & clear
// detergent and fragrance-free softener each add a fixed amount, frozen onto the
// order when it was taken. Folding the surcharge in first would mean a 6 lb order
// paid for its fragrance-free detergent out of the minimum and we did that work
// for nothing.
//
// THE DISCOUNT IS NOT HERE, and that is deliberate. It needs the promotions
// ledger and a customer, which makes it a query rather than arithmetic - so this
// stays pure and testable, and every caller takes the discount off what it
// returns. Taking a percentage off BEFORE the minimum would charge the full
// minimum and hand the customer nothing while the order claimed a promotion had
// been used.
// ---------------------------------------------------------------------------

function rateFor(order) {
  return (order && order.price_per_lb_cents) || config.pricing.perPoundCents;
}

// Null on orders taken before the minimum existed, which were genuinely not
// subject to one. `deposit_cents` is the older column two real orders still
// carry.
function floorFor(order) {
  const o = order || {};
  return o.minimum_cents != null ? o.minimum_cents : o.deposit_cents || 0;
}

function surchargeFor(order) {
  return Math.max(0, Number((order && order.surcharge_cents) || 0));
}

// WHAT THE WORK COMES TO, with the minimum applied and the options on top.
//
// Returns the parts as well as the total, because every caller writes a sentence
// about them: "35 lb at $2.00 a pound" and "plus $2.00 for the wash options" are
// built from these and must not be worked out a second time.
function priceOn(order, weightLb) {
  const weight = Number(weightLb);

  if (!Number.isFinite(weight) || weight < 0) return null;

  const rate = rateFor(order);
  const floor = floorFor(order);
  const surcharge = surchargeFor(order);

  const byWeight = Math.round(weight * rate);
  const beforeDiscount = Math.max(byWeight, floor) + surcharge;

  return {
    weightLb: weight,
    rate,
    floor,
    surcharge,
    byWeight,
    atMinimum: byWeight < floor,
    beforeDiscount,
  };
}

module.exports = { rateFor, floorFor, surchargeFor, priceOn };
