'use strict';

const { config } = require('../config');

// ---------------------------------------------------------------------------
// A WHOLESALE ACCOUNT: ONE AGREED RATE, NO MINIMUM, NO PROMOTIONS.
//
// Neil, 29 September, about Bris Avrohom: "he's always charged at a dollar per
// pound". Not $2.00 one-time, not $1.80 on a plan, and not for one order - for
// every order he ever places.
//
// THE RATE IS THE ACCOUNT. `customers.wholesale_rate_cents` is nullable, and a
// number in it is what makes somebody wholesale. There is deliberately no
// `is_wholesale` boolean beside it: two fields describing one fact are two
// fields free to disagree, and the failure would be a customer flagged
// wholesale with no rate, or a rate nobody applies.
//
// THE OTHER TWO RULES FALL OUT OF IT, both Neil's calls when this was built:
//
//   the minimum   | gone. At $1.00 a pound the $25.00 floor binds everything
//                 | under 25 lb, so a 15 lb load would bill $25.00 - $1.67 a
//                 | pound - and "always a dollar a pound" would be false for
//                 | most of the loads he actually sends
//   promotions    | none. Wholesale IS the discount. CLEAN50 landing on top
//                 | would take a $1.00 rate to $0.50, below what the wash
//                 | costs us, and nobody decided that
//
// WHAT IT DOES NOT TOUCH. The $25 show-up hold stays: that is what a doorstep
// visit is worth when no wash happens, it is not a floor on the wash, and the
// van drives there whatever the rate is. And nothing here is retroactive -
// every order snapshots its own rate and minimum at booking, so setting a rate
// today changes the next pickup and leaves the last one exactly as it was sold.
//
// PURE, so every rule here is testable without a database.
// ---------------------------------------------------------------------------

// The agreed rate, or null for an ordinary customer. Anything that is not a
// positive number is null: a zero or a negative in that column would be a data
// fault, and reading it as a price would give away laundry.
function rateCentsFor(customer) {
  const cents = Number(customer && customer.wholesale_rate_cents);
  return Number.isFinite(cents) && cents > 0 ? Math.round(cents) : null;
}

function isWholesale(customer) {
  return rateCentsFor(customer) != null;
}

// WHAT A PICKUP IS BOOKED AT. The wholesale rate beats both ordinary rates,
// including the subscription one - a wholesale customer who also subscribes is
// still a wholesale customer, and $1.80 would be a price rise.
//
// Takes the already-resolved ordinary rate rather than working it out, because
// subscription.rateForCents() is the only thing allowed to choose between
// $2.00 and $1.80 and this must not become a second copy of that decision.
function rateForBooking(customer, ordinaryRateCents) {
  return rateCentsFor(customer) != null ? rateCentsFor(customer) : ordinaryRateCents;
}

// THE FLOOR ON WHAT THIS PICKUP CAN COST. Zero rather than null: null means
// "an order taken before minimums existed" to pricing.floorFor(), and this is
// a deliberate nothing, not a gap.
function minimumCentsFor(customer) {
  return isWholesale(customer) ? 0 : config.pricing.minimumCents;
}

// May anything come off the price? Asked of the CUSTOMER, because the rule is
// about who they are rather than what they booked.
function takesPromotions(customer) {
  return !isWholesale(customer);
}

// One sentence, for a screen and for the AI's notes. Nothing reads a rate off
// prose, so this is the only place the wording lives.
function describe(customer) {
  const cents = rateCentsFor(customer);
  if (cents == null) return null;
  return (
    `Wholesale account: $${(cents / 100).toFixed(2)} a pound on every order, ` +
    'no order minimum, and no promotions or discounts.'
  );
}

module.exports = {
  rateCentsFor,
  isWholesale,
  rateForBooking,
  minimumCentsFor,
  takesPromotions,
  describe,
};
