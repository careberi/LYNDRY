'use strict';

// ---------------------------------------------------------------------------
// WHAT AN ADDRESS COSTS.
//
// Neil, 25 September: a public page where somebody types their address and is
// told their price, one-time and on a subscription. Under the courier model a
// price is not one number any more - it depends on how far the laundry has to
// travel and which laundromat does the washing - so the question "what do you
// charge" cannot be answered on a page of static copy.
//
// THREE PIECES, AND ONLY ONE OF THEM EARNS ANYTHING:
//
//   per pound    the laundromat's own rate, grossed up so that Neil keeps his
//                margin after Stripe. This is the only place there is a margin
//   delivery     two Uber legs at their published band price, grossed up for
//                Stripe and NOTHING else. Passed through at cost, so somebody
//                further away pays more for the driving, never more for the wash
//   the minimum  a flat $30, whatever the distance and whatever the category
//
// THE RULES ARE PURE AND THE LOOKUPS ARE NOT. Everything that decides a price
// is a function of numbers here, so it can be tested without a database, a
// geocoder or an Uber account - which matters because this is the file that
// decides what a stranger is told they will be charged.
// ---------------------------------------------------------------------------

const { config } = require('../config');

const C = () => config.courier;

// --- the rules --------------------------------------------------------------

// ALWAYS UP, NEVER TO NEAREST. A half-cent rounded down is a half-cent of
// margin gone on every pound of every order, and it can only ever round the
// wrong way for us.
const upCents = (n) => Math.ceil(n - 1e-9);

// WHICH BAND A DISTANCE FALLS IN, or null past the last one.
//
// The bands are Uber's and the boundaries are theirs: "0-5" and "5-6" means a
// trip of exactly 5.0 miles is in the first. Anything past the last band has no
// published price, so it has no answer rather than a guessed one.
function bandFor(miles) {
  const distance = Number(miles);
  if (!Number.isFinite(distance) || distance < 0) return null;
  return C().bands.find((b) => distance <= b.upToMiles) || null;
}

// WHAT THE CUSTOMER PAYS FOR THE DRIVING, GIVEN WHAT ONE LEG ACTUALLY COSTS.
//
// THE ONLY FUNCTION THAT TURNS A COURIER'S PRICE INTO A CUSTOMER'S, and the one
// everything else goes through. Two legs, plus Stripe's whole cut on the fee
// itself - the percentage and the fixed thirty cents - because a fee that only
// grossed up the percentage would come up short by 30c on every single order,
// which is most of the margin on a small one.
function feeFromLegCents(legCents) {
  const leg = Number(legCents);
  if (!Number.isFinite(leg) || leg <= 0) return null;
  return upCents((leg * 2 + C().stripeFixedCents) / (1 - C().stripePercent));
}

// THE SAME ANSWER FROM A DISTANCE INSTEAD, WHICH IS AN ESTIMATE AND SAYS SO.
//
// UBER'S REAL FEE DOES NOT TRACK THIS, MEASURED ON 25 SEPTEMBER against their
// test API: $7.99 at 0.9 and 2.3 miles, $9.99 at 6.0, and $10.99 at 5.7, 6.8,
// 7.7 and 9.8 - two adjacent towns a dollar apart, and one town quoting two
// different prices from two of its own streets. They price their own routed
// distance and never show it to us, so no arithmetic on a straight line can
// reproduce it.
//
// WHICH IS WHY ANYTHING A CUSTOMER IS CHARGED ASKS THE COURIER. This is for the
// two cases with nobody to ask: choosing which laundromats are worth a live
// quote at all, and the whole of development, where the courier is a pretend
// one reading this same table.
function deliveryFeeCents(miles) {
  const band = bandFor(miles);
  return band ? feeFromLegCents(band.legCents) : null;
}

// WHAT WE PAY UBER, which is not what we charge for it. An estimate for the same
// reason and with the same caveat.
function courierCostCents(miles) {
  const band = bandFor(miles);
  return band ? band.legCents * 2 : null;
}

// THE PER POUND RATE. The laundromat's own price, grossed up so that after
// Stripe takes its percentage the margin left is the one that was asked for.
//
// DERIVED FROM THE PARTNER, NEVER TYPED. Two laundromats charging 72c and 130c
// a pound produce two different customer prices, which is the whole point of
// the model: the customer pays for the wash they are actually getting.
function perPoundCents(partnerCentsPerLb, category = 'ONE_TIME') {
  const cost = Number(partnerCentsPerLb);
  const margin = C().margins[category];

  if (!Number.isFinite(cost) || cost <= 0) return null;
  if (typeof margin !== 'number') return null;

  const keep = 1 - margin - C().stripePercent;
  if (keep <= 0) return null;

  return upCents(cost / keep);
}

// WHAT AN ORDER OF THIS WEIGHT COSTS, floored at the minimum.
//
// The floor is on the WHOLE bill rather than on the laundry, because the fee is
// most of a small order: flooring only the laundry would leave a two pound load
// paying $30 for the wash and $16.77 on top of it.
function orderTotalCents({ pounds, ratePerLbCents, feeCents }) {
  const laundry = upCents(Number(pounds) * Number(ratePerLbCents));
  const total = laundry + Number(feeCents);
  const floored = Math.max(total, C().minimumCents);

  return { laundry, delivery: Number(feeCents), total: floored, atMinimum: floored > total };
}

// WHAT IS LEFT AFTERWARDS. Not shown to a customer; this is the line that says
// whether a price is worth taking, and it is the reason the rules live in one
// testable place rather than in a page template.
function netCents({ total, pounds, partnerCentsPerLb, miles, legCents = null }) {
  const partner = upCents(Number(pounds) * Number(partnerCentsPerLb));

  // A REAL LEG PRICE BEATS THE ESTIMATE. What is left over is the one figure
  // where guessing costs Neil money rather than costing a customer accuracy, so
  // wherever the courier has actually said a number, that is the number.
  const courier = legCents != null ? Number(legCents) * 2 : courierCostCents(miles);
  const stripe = upCents(total * C().stripePercent + C().stripeFixedCents);

  if (courier == null || !Number.isFinite(courier)) return null;
  return { partner, courier, stripe, net: total - partner - courier - stripe };
}

// --- what to hold at booking ------------------------------------------------

// WHAT THE CARD IS ASKED TO HOLD WHEN A PICKUP IS BOOKED.
//
// Neil, 25 September: "hold gets placed on order (the hold shouls be at least
// the amount of the delivery). Then once the luandromat weights the order, the
// card should be charged."
//
// AT LEAST THE DELIVERY, AND NEVER LESS THAN THE FLOOR. Two different things are
// being protected and the larger of them wins:
//
//   the floor    `config.pricing.authorizationCents`, $25 - what a wasted trip
//                is worth. It was the whole hold under the van
//   the delivery what we will have paid a courier before anybody weighs
//                anything. If the card fails at the weigh-in we are already out
//                of pocket for the trip that collected the bags
//
// UNDER THE VAN THE FLOOR ALWAYS WON, because there was no delivery fee at all.
// Under a courier the fee runs from $16.77 to $22.95 - still under the floor -
// until New York, where their $5-a-trip surcharge is $10 on a two-leg order and
// takes the fee to $32.95. So this is not arithmetic for its own sake: it is the
// one case where a flat $25 would be less than what we had already spent.
//
// IT DOES NOT COVER THE WASH, and cannot. The wash is unknown until a scale says
// so, which is the entire reason the charge waits for the weigh-in. What this
// covers is the part we commit to before anybody knows the weight.
function holdCents({ deliveryFeeCents = 0 } = {}) {
  const fee = Number(deliveryFeeCents);

  // FROM `config.pricing`, NOT `config.courier`. The floor is what a wasted trip
  // is worth and predates the courier entirely; `C()` here is the courier block
  // and would have returned undefined, which Math.max turns into NaN - a hold of
  // NaN cents, refused by Stripe, on every booking.
  const floor = config.pricing.authorizationCents;

  if (!Number.isFinite(fee) || fee <= 0) return floor;
  return Math.max(floor, Math.ceil(fee));
}

// --- choosing a laundromat --------------------------------------------------

// THE CHEAPEST ANSWER FOR THE CUSTOMER, which is not the nearest laundromat.
//
// Neil's stated goal is "the lowest total cost for the customer while
// maintaining my net margins", and those two are only compatible because the
// margin is a PERCENTAGE: a cheaper laundromat makes the customer's price lower
// and Neil's cut smaller in absolute terms, and neither is ever below target.
//
// IT IS COMPARED AT ONE WEIGHT BECAUSE THE ANSWER DEPENDS ON WEIGHT. A cheap
// laundromat eight miles away beats an expensive one down the road on a big
// load and loses on a small one, since the extra driving is a flat sum and the
// cheaper wash compounds per pound. Quoting a different laundromat for every
// possible load would be honest and useless - a customer wants one price.
// AND IT COSTS NEIL MONEY, WHICH IS THE POINT AND IS WORTH SAYING OUT LOUD.
// The margin is a percentage, so routing to the cheaper laundromat lowers the
// customer's bill AND Neil's absolute earnings on that order - 20% of a smaller
// number. The percentage is what is being held, never the dollars. That is his
// instruction in as many words: cheapest all in for the customer, margins
// maintained. Anything that quietly routed to the dearer laundromat to earn
// more would be the opposite of what was asked for.
function chooseFor(partners, { compareAtLb = C().compareAtLb } = {}) {
  const options = [];

  for (const partner of partners || []) {
    // A LIVE LEG PRICE IF THE CALLER HAS ONE, the band estimate otherwise. The
    // comparison has to be like for like, which it is: whichever of the two it
    // uses, it uses for every laundromat in the list.
    const fee = partner.legCents != null ? feeFromLegCents(partner.legCents) : deliveryFeeCents(partner.miles);
    if (fee == null) continue; // past the last band: no published price

    const rate = perPoundCents(partner.perLbCents, 'ONE_TIME');
    if (rate == null) continue; // no agreed rate: cannot be priced

    const { total } = orderTotalCents({ pounds: compareAtLb, ratePerLbCents: rate, feeCents: fee });
    options.push({ partner, total, feeCents: fee });
  }

  if (!options.length) return null;

  // Cheapest for the customer; the nearer one wins a tie, because a shorter
  // trip is the one less likely to be re-priced into a higher band on the day.
  options.sort((a, b) => a.total - b.total || a.partner.miles - b.partner.miles);
  return options[0].partner;
}

// --- the answer a page renders ---------------------------------------------

// EVERY CATEGORY AT ONCE, so the page can show what a subscription saves
// without asking twice.
function quoteFor({ miles, partnerCentsPerLb, partnerName = null, legCents = null }) {
  // A REAL LEG PRICE MAKES THE DISTANCE IRRELEVANT, which is how somebody at
  // 9.8 miles gets a price at all: the band table stops at 10 road miles and
  // our road miles are a straight line multiplied by 1.3, so a real Park Ridge
  // address came out at 12.7 and was refused - while Uber quoted it happily for
  // $10.99. The table's ceiling is a fact about the table, not about the county.
  const fee = legCents != null ? feeFromLegCents(legCents) : deliveryFeeCents(miles);
  if (fee == null) {
    return { ok: false, reason: 'too_far', maxMiles: C().maxMiles, miles };
  }

  const categories = {};
  for (const name of Object.keys(C().margins)) {
    const rate = perPoundCents(partnerCentsPerLb, name);
    if (rate == null) return { ok: false, reason: 'no_rate' };

    // What a typical load actually comes to, so the page can show a number a
    // person can picture rather than only a rate.
    const typical = orderTotalCents({ pounds: 20, ratePerLbCents: rate, feeCents: fee });
    categories[name] = { perLbCents: rate, typical20lbCents: typical.total };
  }

  return {
    ok: true,
    miles,
    partnerName,
    deliveryFeeCents: fee,
    minimumCents: C().minimumCents,
    categories,

    // WHETHER THE COURIER WAS ACTUALLY ASKED. The page says so, because a price
    // that came off our own table can move when the delivery is booked and a
    // price Uber quoted cannot - and the difference is worth one word on screen
    // rather than a footnote nobody writes later.
    quoted: legCents != null,
  };
}

module.exports = {
  bandFor,
  holdCents,
  feeFromLegCents,
  deliveryFeeCents,
  courierCostCents,
  perPoundCents,
  orderTotalCents,
  netCents,
  chooseFor,
  quoteFor,
};
