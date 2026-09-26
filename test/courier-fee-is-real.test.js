'use strict';

// ---------------------------------------------------------------------------
// THE DELIVERY FEE COMES FROM THE COURIER, NOT FROM OUR TABLE.
//
// Neil, 25 September: "its a flat fee we need to connect to the api". Measured
// against Uber's own API the same day, the band table cannot reproduce their
// price: $7.99 at 0.9 and 2.3 miles, $9.99 at 6.0, and $10.99 at 5.7, 6.8, 7.7
// and 9.8 - two adjacent towns a dollar apart, and one town quoting two
// different prices from two of its own streets. They price their own routed
// distance and never show it to us.
//
// SO THE TABLE IS DEMOTED TO AN ESTIMATE, used for choosing which laundromats
// are worth a live quote and for the whole of development. Two things in that
// change could go wrong quietly and both are pinned here:
//
//   - a quote is ONE LEG. The fake courier returned the round trip until the
//     real API was measured, so anything doubling it would have charged twice
//   - a real leg price must beat the estimate rather than being ignored, which
//     is the difference between a price we can honour and one we cannot
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const quote = require('../src/core/quote');
const billing = require('../src/core/billing');
const fake = require('../src/providers/couriers/fake');
const { config } = require('../src/config');

const BAND_1 = config.courier.bands[0];
const BAND_LAST = config.courier.bands[config.courier.bands.length - 1];

test('A COURIER QUOTES ONE LEG, AND THE FEE DOUBLES IT', async () => {
  const asked = await fake.quote({ miles: 1 });

  assert.equal(asked.ok, true);
  assert.equal(
    asked.feeCents,
    BAND_1.legCents,
    'the fake courier stopped quoting one leg, so every price built on it is out by a factor of two'
  );

  // And the fee the customer sees is that leg, twice, grossed up for Stripe.
  const fee = quote.feeFromLegCents(asked.feeCents);
  const expected = Math.ceil((BAND_1.legCents * 2 + config.courier.stripeFixedCents) / (1 - config.courier.stripePercent));

  assert.equal(fee, expected);
  assert.ok(fee > BAND_1.legCents * 2, 'Stripe was not grossed up, so the margin is short on every order');
});

test('the fee from a distance is the fee from that distance\'s leg', () => {
  // The two doors onto one calculation. If they ever disagree, one of them is
  // a second copy of the arithmetic.
  for (const band of config.courier.bands) {
    assert.equal(
      quote.deliveryFeeCents(band.upToMiles),
      quote.feeFromLegCents(band.legCents),
      `the band at ${band.upToMiles} miles priced differently through the two doors`
    );
  }
});

test('A REAL LEG PRICE IGNORES THE TABLE ENTIRELY', () => {
  // The case that matters: past the last band our table has no answer at all,
  // and a real Park Ridge address 9.8 miles from a laundromat came out at 12.7
  // road miles and was refused - while Uber quoted that exact trip for $10.99.
  const tooFarForTheTable = BAND_LAST.upToMiles + 5;

  assert.equal(quote.deliveryFeeCents(tooFarForTheTable), null, 'the table gained an answer it should not have');

  const priced = quote.quoteFor({
    miles: tooFarForTheTable,
    legCents: 1099,
    partnerCentsPerLb: 95,
  });

  assert.equal(priced.ok, true, 'a trip the courier priced was refused because our own table stops at ten miles');
  assert.equal(priced.deliveryFeeCents, quote.feeFromLegCents(1099));
  assert.equal(priced.quoted, true);
});

test('and a price off the table says so, so the page can be honest', () => {
  const estimated = quote.quoteFor({ miles: 1, partnerCentsPerLb: 95 });

  assert.equal(estimated.ok, true);
  assert.equal(estimated.quoted, false, 'an estimate claimed to be a quote');
  assert.equal(estimated.deliveryFeeCents, quote.deliveryFeeCents(1));
});

test('CHOOSING BETWEEN LAUNDROMATS USES THE REAL PRICE WHERE THERE IS ONE', () => {
  // The near one is dearer per pound; the far one is cheap but the courier
  // actually charges more to reach it. Only the live fee can settle it, and the
  // table would have said the far one cost nothing extra.
  const chosen = quote.chooseFor([
    { name: 'near and dear', perLbCents: 130, miles: 2, legCents: 799 },
    { name: 'far and cheap', perLbCents: 95, miles: 9, legCents: 1099 },
  ]);

  // At twenty pounds the cheaper wash wins even paying $6 more for the driving.
  assert.equal(chosen.name, 'far and cheap');

  // Make the driving dear enough and it does not.
  const flipped = quote.chooseFor([
    { name: 'near and dear', perLbCents: 130, miles: 2, legCents: 799 },
    { name: 'far and cheap', perLbCents: 95, miles: 9, legCents: 3500 },
  ]);

  assert.equal(flipped.name, 'near and dear', 'a live courier price was ignored in favour of the band estimate');
});

test('WHAT IS LEFT OVER IS COUNTED ON WHAT UBER ACTUALLY CHARGED', () => {
  // The one figure where guessing costs Neil money rather than costing a
  // customer accuracy. Estimated at $7.99 a leg and actually $10.99, the
  // difference is $6 an order - which is most of the margin on a small one.
  const priced = quote.quoteFor({ miles: 4, legCents: 1099, partnerCentsPerLb: 95 });
  const rate = priced.categories.ONE_TIME.perLbCents;
  const { total } = quote.orderTotalCents({ pounds: 20, ratePerLbCents: rate, feeCents: priced.deliveryFeeCents });

  const real = quote.netCents({ total, pounds: 20, partnerCentsPerLb: 95, miles: 4, legCents: 1099 });
  const guessed = quote.netCents({ total, pounds: 20, partnerCentsPerLb: 95, miles: 4 });

  assert.equal(real.courier, 2198, 'the real courier cost was not two legs of what they quoted');
  assert.ok(real.net < guessed.net, 'the estimate flattered the margin and nothing noticed');
});

test('a courier that says nothing leaves the net unanswerable rather than wrong', () => {
  // Past the last band with no live price there is no honest figure, so there
  // is none - a guessed courier cost in a margin is worse than a gap.
  const nothing = quote.netCents({
    total: 5000,
    pounds: 20,
    partnerCentsPerLb: 95,
    miles: BAND_LAST.upToMiles + 5,
  });

  assert.equal(nothing, null);
});

// --- what the card is asked to hold at booking ------------------------------

test('THE HOLD IS AT LEAST THE DELIVERY, AND IT IS DERIVED, NOT PASSED IN', () => {
  // Neil, 25 September: "hold gets placed on order (the hold shouls be at least
  // the amount of the delivery). Then once the luandromat weights the order,
  // the card should be charged."
  //
  // IT TOOK A PER-ORDER FEE AND NOTHING COULD EVER HAVE SUPPLIED ONE. The first
  // version read `orders.delivery_fee_cents`, a column nothing wrote - so it
  // answered the floor on every booking and the rule was inert. And no per-order
  // figure exists at the moment a hold is placed: the pickup is booked today and no
  // courier has been quoted for it, because a quote lasts fifteen minutes.
  //
  // So the rule reads the BAND TABLE. The dearest pair of legs it allows is what
  // the hold must cover, whatever that becomes.
  const floor = config.pricing.authorizationCents;
  const dearest = Math.max(...config.courier.bands.map((b) => b.legCents));

  assert.equal(quote.holdCents(), Math.max(floor, dearest * 2));
  assert.ok(quote.holdCents() >= floor, 'the hold dropped below the floor');
  assert.ok(quote.holdCents() >= dearest * 2, 'the hold no longer covers the dearest pair of legs');

  // AND IT TAKES NOTHING, so nobody can quietly re-introduce a caller-supplied
  // amount that reads undefined and holds too little.
  assert.equal(quote.holdCents.length, 0, 'holdCents takes an argument again');
});

test('THE FLOOR COVERS THE DEAREST PAIR OF LEGS TODAY, AND SAYS SO IF IT STOPS', () => {
  // This is the assertion that replaces a per-order column. Every band doubled
  // runs $15.98 to $21.98 - all inside the $25 floor - so Neil's rule holds
  // structurally in Bergen County rather than by arithmetic on each order.
  //
  // THE DAY A BAND RISES PAST HALF THE FLOOR, `holdCents()` RISES WITH IT rather
  // than this failing, which is the point of deriving it. What this pins is that
  // the relationship is still the one described above, so the reasoning in the
  // code stays true or somebody reads this message.
  const floor = config.pricing.authorizationCents;

  for (const band of config.courier.bands) {
    const pair = band.legCents * 2;
    assert.ok(
      pair <= floor,
      `a ${band.upToMiles}-mile pair of legs now costs ${pair} against a ${floor} floor - ` +
        'the floor is no longer what covers the delivery, and holdCents() is carrying it instead'
    );
  }

  // NEW YORK IS THE CASE THE MAX EXISTS FOR, and it is outside the service area.
  // Their $5-a-trip surcharge is $10 on a two-leg order, which would take the
  // dearest pair to $31.98 - well over the floor. `inNewJersey()` is what keeps it
  // out, and that is a rule somebody could relax.
  const nyPair = (config.courier.bands[0].legCents + config.courier.nycSurchargeCents) * 2;
  assert.ok(nyPair > floor, 'the New York surcharge no longer takes a pair of legs past the floor');
});

test('A HOLD IS NEVER NaN, WHICH IS WHAT READING THE WRONG CONFIG BLOCK GAVE', () => {
  // `authorizationCents` lives in config.pricing and the first version read it
  // from config.courier, which is undefined - and Math.max(undefined, n) is NaN.
  // A hold of NaN cents is refused by Stripe on every booking, and the symptom
  // would have read as every card in the business failing at once.
  const held = quote.holdCents();
  assert.ok(Number.isFinite(held), `holdCents() produced ${held}`);
  assert.ok(held > 0, 'a hold of nothing is not a hold');
  assert.equal(held, Math.round(held), 'a hold of a fraction of a cent');

  // And the same through billing, which is what the four hold-placing doors call.
  for (const order of [null, undefined, {}, { delivery_fee_cents: 999999 }]) {
    assert.equal(
      billing.holdFor(order),
      held,
      `holdFor(${JSON.stringify(order)}) disagreed with holdCents() - something is reading the order again`
    );
  }
});

test('THE HOLD RULE NEVER READS THE ORDER MINIMUM', () => {
  // THEY ARE THE SAME NUMBER UNDER THE VAN, so this cannot compare values - and the
  // first version did, which is why it passed in development and failed under the
  // model production runs. `authorizationCents` is $25 and the van minimum is $25;
  // config.js says outright that this "is a coincidence of arithmetic, not a
  // relationship. Do not collapse them into one constant."
  //
  // What is testable is that the hold rule does not REACH for the minimum. The
  // minimum is the floor on what a wash costs; the authorization is what a wasted
  // trip is worth. `test/show-up-hold.test.js` already refuses one being DEFINED as
  // the other in config; this refuses `holdCents()` reading it.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'quote.js'), 'utf8');
  const fn = /function holdCents\([\s\S]*?\n}/.exec(src);

  assert.ok(fn, 'holdCents() has been renamed or removed');
  assert.match(fn[0], /authorizationCents/, 'the hold no longer starts from the trip floor');
  assert.ok(
    !/minimumCents/.test(fn[0]),
    'the hold rule is reading the order minimum, which is what a WASH costs rather than what a ' +
      'wasted trip is worth - they happen to be equal under the van and would silently diverge'
  );
});
