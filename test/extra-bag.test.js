'use strict';

// ---------------------------------------------------------------------------
// ADDING A BAG TO AN ORDER THAT HAS ALREADY BEEN PRICED.
//
// Neil, 26 September, on production #2081: a second bag, 20 lb, on an order
// weighed at 20 lb and charged $20 after CLEAN50. Neither adding it nor
// collecting for it was reachable from any screen.
//
// BOTH BUGS BELOW WERE FOUND BY RUNNING IT AGAINST A REAL ORDER, not by reading
// it, and both produced the same symptom from the outside: a button that appeared
// to do nothing. Neil pressed it on #2081 and told me so before I had tested it,
// which is the actual lesson here.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const extraBag = require('../src/core/extra-bag');
const pricing = require('../src/core/pricing');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'extra-bag.js'), 'utf8');

const fn = (() => {
  const at = SRC.indexOf('async function addAndReprice(');
  assert.notEqual(at, -1, 'addAndReprice() has been renamed or removed');
  return SRC.slice(at, SRC.indexOf('\nfunction money(', at));
})();

// --- the two that actually bit ----------------------------------------------

test('BIND IS HANDED THE NEW BAG COUNT, NOT THE ROW AS IT WAS LOADED', () => {
  // BUG ONE. `bind()` reads `order.bag_count` off the OBJECT to decide whether
  // there is room for another sticker. The count was raised in the database and
  // then the stale row was passed in, so bind refused with `too_many` - "this
  // order is down as 2 bags collected and 2 already have a sticker" - and the
  // rollback put the count back. From the outside: a button that did nothing.
  assert.match(
    fn,
    /bags\.bind\(\s*parsed\.code,\s*\{\s*\.\.\.order,\s*bag_count:\s*now\s*\}/,
    'bind() is being passed the order as loaded, so it still sees the old bag count'
  );
});

test('AND THE ORDER TOTAL IS RECOMPUTED, BECAUSE recordBagWeight DOES NOT', () => {
  // BUG TWO, found the moment the first was fixed. `bags.recordBagWeight()`
  // writes the BAG's weight and nothing else - the order's own `weight_lb` is a
  // SUM that its callers recompute. So the bag bound, the count went to 3, and
  // the order still read 22.5 lb at $45.00.
  assert.match(fn, /bags\.totalWeight\(/, 'the order total is never recomputed from the bags');
  assert.match(
    fn,
    /weight_lb:\s*totals\.pounds/,
    'the summed weight is not written back to the order'
  );

  // RECOMPUTED, NEVER ADDED TO. A bag corrected later must not drift the total.
  assert.ok(
    !/weight_lb:\s*[^t]*\+/.test(fn),
    'the new weight is being added to the old total rather than summed from the bags'
  );
});

test('and a refused sticker leaves the order exactly as it was', () => {
  // The rollback is what made bug one silent rather than destructive, and it is
  // still right: an order claiming a bag nobody can scan would leave the run
  // waiting for ever on something that does not exist.
  assert.match(fn, /bag_count:\s*was/, 'a refused bind no longer puts the count back');
});

// --- the arithmetic ---------------------------------------------------------

test('IT RE-PRICES THE WHOLE ORDER, NOT THE NEW BAG', () => {
  // The minimum, the surcharge and the promotion apply to an ORDER. On #2081 a
  // 50% offer on a second bag priced alone reaches the same number by luck; a
  // capped or minimum-bound order would not.
  const order = { price_per_lb_cents: 200, minimum_cents: 2500, surcharge_cents: 0 };

  // #2081's real numbers: 20 lb + 20 lb.
  assert.equal(pricing.priceOn(order, 20).beforeDiscount, 4000);
  assert.equal(pricing.priceOn(order, 40).beforeDiscount, 8000);

  // Which is NOT twice the one-bag price once a minimum is involved.
  const small = { ...order, minimum_cents: 4500 };
  assert.equal(pricing.priceOn(small, 10).beforeDiscount, 4500, 'the minimum is not applied');
  assert.notEqual(
    pricing.priceOn(small, 20).beforeDiscount,
    pricing.priceOn(small, 10).beforeDiscount * 2,
    'pricing two bags separately happens to equal pricing them together, so this proves nothing'
  );

  assert.match(fn, /pricing\.priceOn\(/, 'it no longer uses the shared pricing arithmetic');
  assert.match(fn, /discountFor\(/, 'the promotion is not re-applied at the new total');
});

test('the terms come off the order, never from today config', () => {
  // Changing the price must not re-price work already quoted.
  const old = { price_per_lb_cents: 180, minimum_cents: 2000, surcharge_cents: 200 };
  const parts = pricing.priceOn(old, 30);

  assert.equal(parts.rate, 180);
  assert.equal(parts.floor, 2000);
  assert.equal(parts.byWeight, 5400);
  assert.equal(parts.beforeDiscount, 5600, 'the surcharge is not on top of the minimum');
});

test('and the surcharge sits ON TOP of the minimum, never inside it', () => {
  // A 6 lb order paying for its fragrance-free detergent out of the minimum is
  // work we did for nothing.
  const order = { price_per_lb_cents: 200, minimum_cents: 4500, surcharge_cents: 200 };
  const parts = pricing.priceOn(order, 6);

  assert.equal(parts.atMinimum, true);
  assert.equal(parts.beforeDiscount, 4700);
});

// --- what it refuses --------------------------------------------------------

test('IT REFUSES AN ORDER THAT HAS ALREADY GONE BACK', () => {
  // Past delivery the weight is a fact about something the customer has received
  // and been billed for. Charging them afterwards is a conversation, not a button.
  assert.deepEqual([...extraBag.TOO_LATE].sort(), ['CANCELED', 'DELIVERED']);
});

test('and it validates the code and the weight before touching anything', () => {
  const order = { id: 'x', status: 'IN_PROCESS', bag_count: 1 };

  return Promise.all([
    extraBag.addAndReprice(order, { code: 'nonsense!', weightLb: 20 }),
    extraBag.addAndReprice(order, { code: 'HBSS3X', weightLb: 0 }),
    extraBag.addAndReprice(order, { code: 'HBSS3X', weightLb: 9999 }),
    extraBag.addAndReprice({ ...order, status: 'DELIVERED' }, { code: 'HBSS3X', weightLb: 20 }),
  ]).then(([badCode, noWeight, silly, late]) => {
    assert.equal(badCode.ok, false);
    assert.equal(badCode.reason, 'bad_code');
    assert.equal(noWeight.reason, 'bad_weight');
    assert.equal(silly.reason, 'bad_weight', '9999 lb of laundry was accepted');
    assert.equal(late.reason, 'too_late');
  });
});

// --- what the customer reads ------------------------------------------------

test('THE TEXT SAYS WHAT CHANGED AND WHY', () => {
  // Neil: "we also need to text the customer and let him know the total was
  // updated." The bag count is what makes the new number make sense - "your
  // laundry weighed more" reads as our scale having been wrong.
  const said = extraBag.updatedTotalMessage({
    bags: 2,
    billable: 40,
    priceCents: 4000,
    discountCents: 4000,
    promotion: { name: 'CLEAN50' },
    extraCents: 2000,
  });

  assert.match(said, /another bag/i, 'it does not say why the total moved');
  assert.match(said, /2 bags/);
  assert.match(said, /40 lb/);
  assert.match(said, /\$40\.00/);
  assert.match(said, /CLEAN50/, 'a total lower than the obvious arithmetic reads as a mistake');
  assert.match(said, /\$20\.00/, 'it does not say what was taken');
});

test('and it mentions a charge only when one was taken', () => {
  // Untick the box and nothing touches the card, so the message must not claim
  // otherwise - that is the sentence the customer would ring about.
  const said = extraBag.updatedTotalMessage({
    bags: 2,
    billable: 40,
    priceCents: 4000,
    discountCents: 0,
    promotion: null,
    extraCents: 0,
  });

  assert.ok(!/taken|card/i.test(said), `it claims a charge that was not made: ${said}`);
  assert.match(said, /\$40\.00/);
});

test('every figure in it is money-formatted, never raw cents', () => {
  const said = extraBag.updatedTotalMessage({
    bags: 3,
    billable: 61.5,
    priceCents: 12300,
    discountCents: 0,
    promotion: null,
    extraCents: 0,
  });

  assert.match(said, /\$123\.00/);
  assert.ok(!/12300/.test(said), 'raw cents reached a customer');
});
