'use strict';

// Whole-order contribution after washing, courier and processing costs.
// Other operating expenses are excluded; this is not net profit.
const CATEGORIES = Object.freeze(['ONE_TIME', 'SUBSCRIPTION', 'WHOLESALE']);
const SCALE = 10000n;
const weightPricing = require('./weight-based-pricing');

function integer(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(name + ' is outside its allowed range');
  }
  return value;
}

function cents(value) {
  const result = Number(value);
  return integer(result, 'calculated cents');
}

const ceiling = (numerator, denominator) => (numerator + denominator - 1n) / denominator;

function weightUnits(weightLb) {
  if (typeof weightLb !== 'number' || !Number.isFinite(weightLb) || weightLb < 0) {
    throw new RangeError('Weight must be a nonnegative number');
  }
  const units = Math.round(weightLb * 1000);
  if (!Number.isSafeInteger(units) || Math.abs(units / 1000 - weightLb) > 1e-9) {
    throw new RangeError('Weight must have at most three decimal places');
  }
  return BigInt(units);
}

function validatePolicy(policy, category) {
  if (!CATEGORIES.includes(category)) throw new RangeError('Unknown customer category');
  const marginBps = integer(policy?.marginBps?.[category], 'Category contribution target', 0, 9999);
  const processingBps = integer(policy.processingBps, 'Processing percentage', 0, 9999);
  integer(policy.processingFixedCents, 'Processing fixed cost');
  integer(policy.operationalFeeBps, 'Operational fee percentage', 0, 10000);
  if (marginBps + processingBps >= 10000) throw new RangeError('Target plus processing must be below 100%');
  if (weightUnits(policy.referenceWeightLb) < 1000n) throw new RangeError('Reference weight must be at least one pound');
  if(policy.pricingMethod===weightPricing.METHOD && policy.minimumWeightLb!=null) integer(policy.minimumWeightLb,'Minimum weight',1,50);
  return { marginBps, keepBps: 10000 - marginBps - processingBps };
}

function washingCostCents(weightLb, wholesaleCentsPerLb) {
  integer(wholesaleCentsPerLb, 'Wholesale rate', 1);
  return cents(ceiling(weightUnits(weightLb) * BigInt(wholesaleCentsPerLb), 1000n));
}

function requiredTotal({ weightLb, wholesaleCentsPerLb, pickupCents, returnCents, policy, category }) {
  const { keepBps } = validatePolicy(policy, category);
  integer(pickupCents, 'Pickup cost');
  integer(returnCents, 'Return cost');
  const washing = washingCostCents(weightLb, wholesaleCentsPerLb);
  const costs = BigInt(washing) + BigInt(pickupCents) + BigInt(returnCents) + BigInt(policy.processingFixedCents);
  return cents(ceiling(costs * SCALE, BigInt(keepBps)));
}

function quotedTotal(input) {
  if (weightPricing.isSnapshot(input)) return weightPricing.total(input,input.weightLb);
  const { weightLb, rateCentsPerLb, operationalFeeCents, minimumTotalCents } = input;
  integer(rateCentsPerLb, 'Customer rate', 1);
  integer(operationalFeeCents, 'Operational fee');
  integer(minimumTotalCents, 'Minimum total');
  const laundry = cents(ceiling(weightUnits(weightLb) * BigInt(rateCentsPerLb), 1000n));
  const total = cents(BigInt(laundry) + BigInt(operationalFeeCents));
  // The fee is already inside the minimum, including for a multiple-bag order.
  return Math.max(minimumTotalCents, total);
}

function preview(input) {
  const { policy, category, pickupCents, returnCents } = input;
  const { marginBps, keepBps } = validatePolicy(policy, category);
  integer(pickupCents, 'Pickup cost');
  integer(returnCents, 'Return cost');
  const courierCents = cents(BigInt(pickupCents) + BigInt(returnCents));
  if (policy.pricingMethod === weightPricing.METHOD) {
    const estimatedWeightLb=weightPricing.estimatedWeight(input.estimatedWeightLb??30);
    const prices={pricingMethod:policy.pricingMethod,policy,category,wholesaleCentsPerLb:input.wholesaleCentsPerLb,
      pickupCents,returnCents,minimumTotalCents:policy.minimumTotalCents,operationalFeeCents:0,estimatedWeightLb};
    if (policy.laundryPricingBasis != null) {
      if (policy.laundryPricingBasis !== weightPricing.CUSTOMER_BASE) throw new RangeError('Unknown laundry pricing basis');
      prices.laundryPricingBasis = weightPricing.CUSTOMER_BASE;
      prices.customerBaseCentsPerLb = integer(input.customerBaseCentsPerLb ?? input.wholesaleCentsPerLb, 'Customer pricing base', 1);
    }
    if(policy.minimumWeightLb != null) {
      prices.minimumWeightLb=policy.minimumWeightLb;
      // Freeze the dollar price of the minimum weight for database billing and
      // accepted quotes. Changing today's minimum never rewrites old orders.
      prices.minimumTotalCents=0;
      prices.minimumTotalCents=weightPricing.total(prices,prices.minimumWeightLb,{applyMinimum:false});
    }
    const estimatedTotalCents=weightPricing.total(prices,estimatedWeightLb);
    return {...prices,rateCentsPerLb:Math.ceil(estimatedTotalCents/estimatedWeightLb),targetMarginBps:marginBps,
      referenceWeightLb:estimatedWeightLb,courierCents,estimatedTotalCents,
      requiredReferenceTotalCents:weightPricing.total(prices,estimatedWeightLb,{applyMinimum:false}),
      estimatedReferenceTotalCents:estimatedTotalCents,
      estimated30LbCents:weightPricing.total(prices,30),estimated40LbCents:weightPricing.total(prices,40)};
  }
  if (policy.pricingMethod === 'COST_PLUS_MARGIN_15') {
    integer(input.wholesaleCentsPerLb, 'Wholesale rate', 1);
    const customerBaseCentsPerLb = integer(input.customerBaseCentsPerLb ?? input.wholesaleCentsPerLb, 'Customer pricing base rate', 1);
    // Keep the saved fee field for compatibility with atomic database billing.
    // In this version it represents the complete delivery and fees amount.
    // Laundry includes processing; transport fees use only the category margin.
    // Processing remains a business cost and is never surcharged at payment.
    const prices = {
      pricingMethod: policy.pricingMethod,
      customerBaseCentsPerLb,
      feeCalculation: 'TRANSPORT_MARGIN_V2',
      rateCentsPerLb: cents(ceiling(BigInt(customerBaseCentsPerLb) * SCALE, BigInt(keepBps))),
      operationalFeeCents: cents((BigInt(courierCents) * SCALE + BigInt(10000 - marginBps) / 2n) / BigInt(10000 - marginBps)),
      minimumTotalCents: 1500,
    };
    return { ...prices, category, targetMarginBps: marginBps, referenceWeightLb: policy.referenceWeightLb,
      courierCents, requiredReferenceTotalCents: requiredTotal({ ...input, weightLb: policy.referenceWeightLb }),
      estimatedReferenceTotalCents: quotedTotal({ ...prices, weightLb: policy.referenceWeightLb }),
      estimated30LbCents: quotedTotal({ ...prices, weightLb: 30 }),
      estimated40LbCents: quotedTotal({ ...prices, weightLb: 40 }) };
  }
  // Nearest cent, half up. Unlike the fee allocation, the rate rounds upward.
  const operationalFeeCents = cents((BigInt(courierCents) * BigInt(policy.operationalFeeBps) + 5000n) / SCALE);
  const requiredReferenceTotalCents = requiredTotal({ ...input, weightLb: policy.referenceWeightLb });
  const minimumTotalCents = requiredTotal({ ...input, weightLb: 1 });
  const rateCentsPerLb = cents(ceiling(BigInt(requiredReferenceTotalCents - operationalFeeCents) * 1000n, weightUnits(policy.referenceWeightLb)));
  const prices = { rateCentsPerLb, operationalFeeCents, minimumTotalCents };
  return {
    ...prices, category, targetMarginBps: marginBps, referenceWeightLb: policy.referenceWeightLb,
    courierCents, requiredReferenceTotalCents,
    estimatedReferenceTotalCents: quotedTotal({ ...prices, weightLb: policy.referenceWeightLb }),
    estimated30LbCents: quotedTotal({ ...prices, weightLb: 30 }),
    estimated40LbCents: quotedTotal({ ...prices, weightLb: 40 }),
  };
}

// Cost values must come from completed-order records. Missing costs are not zero.
function contribution({ revenueCents, washingCents, courierCents, processingCents, otherCostCents = 0 }) {
  for (const [name, value] of Object.entries({ revenueCents, washingCents, courierCents, processingCents, otherCostCents })) integer(value, name);
  const contributionCents = revenueCents - washingCents - courierCents - processingCents - otherCostCents;
  if (!Number.isSafeInteger(contributionCents)) throw new RangeError('Contribution exceeds safe range');
  return { contributionCents, contributionPercent: revenueCents === 0 ? null : contributionCents / revenueCents * 100 };
}

// Eligibility is evaluated by the caller for the requested date. This function
// deliberately receives one shared policy/category, never candidate-specific weights.
function compareCandidates(candidates, { policy, category, estimatedWeightLb }) {
  validatePolicy(policy, category);
  const seen = new Set();
  const priced = candidates.map(candidate => {
    if (!candidate.id || seen.has(candidate.id)) throw new RangeError('Candidate IDs must be unique');
    seen.add(candidate.id);
    return { id: candidate.id, ...preview({ ...candidate, policy, category, estimatedWeightLb }) };
  });
  // Reject incomplete prices instead of claiming a cheapest result from partial data.
  return priced.sort((a, b) => a.estimatedReferenceTotalCents - b.estimatedReferenceTotalCents || String(a.id).localeCompare(String(b.id)));
}

module.exports = { washingCostCents, CATEGORIES, validatePolicy, requiredTotal, quotedTotal, preview, contribution, compareCandidates };
