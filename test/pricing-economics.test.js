'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../src/core/pricing-economics');

// These are test examples, not production defaults or approved category targets.
const policy = { marginBps: { ONE_TIME: 1000, SUBSCRIPTION: 800, WHOLESALE: 500 }, processingBps: 290, processingFixedCents: 30, operationalFeeBps: 2500, referenceWeightLb: 33 };
const input = { policy, category: 'ONE_TIME', wholesaleCentsPerLb: 100, pickupCents: 899, returnCents: 899 };

test('approved allocation and one-pound minimum include the fee exactly once', () => {
  const q = pricing.preview(input);
  assert.equal(q.operationalFeeCents, 450);
  assert.equal(q.rateCentsPerLb, 165);
  assert.equal(q.minimumTotalCents, 2214);
  assert.equal(q.estimatedReferenceTotalCents, 5895);
  assert.equal(q.estimated30LbCents, 5400);
  assert.equal(q.estimated40LbCents, 7050);
  assert.equal(pricing.quotedTotal({ ...q, weightLb: 1 }), 2214);
  assert.equal(pricing.quotedTotal({ ...q, weightLb: 0 }), 2214);
});

test('pickup and return can cost different amounts; neither is doubled', () => {
  const q = pricing.preview({ ...input, pickupCents: 1000, returnCents: 2000 });
  assert.equal(q.courierCents, 3000);
  assert.equal(q.operationalFeeCents, 750);
});

test('reference-weight pricing is not a guarantee at lower weights', () => {
  const q = pricing.preview(input);
  assert.ok(pricing.quotedTotal({ ...q, weightLb: 10 }) < pricing.requiredTotal({ ...input, weightLb: 10 }));
});

test('all eligible candidates share weight and category; cheapest wash may lose', () => {
  const candidates = [{ id: 'cheap-wash', wholesaleCentsPerLb: 90, pickupCents: 2000, returnCents: 2000 }, { id: 'nearby', wholesaleCentsPerLb: 120, pickupCents: 500, returnCents: 500 }];
  const result = pricing.compareCandidates(candidates, { policy, category: 'SUBSCRIPTION' });
  assert.equal(result[0].id, 'nearby');
  assert.ok(result.every(q => q.category === 'SUBSCRIPTION' && q.referenceWeightLb === 33 && q.targetMarginBps === 800));
  assert.throws(() => pricing.compareCandidates([...candidates, { id: 'missing', wholesaleCentsPerLb: 100, pickupCents: 500 }], { policy, category: 'ONE_TIME' }));
});

test('invalid or missing money, category and target cannot become free prices', () => {
  for (const value of [undefined, null, -1, NaN, Infinity, '899', 8.99]) assert.throws(() => pricing.preview({ ...input, pickupCents: value }));
  assert.throws(() => pricing.preview({ ...input, category: 'OTHER' }));
  assert.throws(() => pricing.preview({ ...input, policy: { ...policy, marginBps: {} } }));
  assert.throws(() => pricing.preview({ ...input, policy: { ...policy, processingBps: 9000 } }));
  assert.throws(() => pricing.requiredTotal({ ...input, weightLb: -1 }));
});

test('required totals cover target across weights, costs and fee allocations', () => {
  for (const weightLb of [1, 1.125, 10, 30, 33, 40, 100]) {
    for (const wholesaleCentsPerLb of [72, 100, 120, 250]) {
      for (const courier of [0, 1798, 5000]) {
        const total = pricing.requiredTotal({ ...input, weightLb, wholesaleCentsPerLb, pickupCents: courier, returnCents: 0 });
        const cost = Math.ceil(weightLb * wholesaleCentsPerLb) + courier + 30;
        assert.ok(total * 0.871 >= cost - 1e-7);
      }
    }
  }
});

test('report contribution from supplied costs without substituting the target', () => {
  const result = pricing.contribution({ revenueCents: 5895, washingCents: 3300, courierCents: 1798, processingCents: 201 });
  assert.equal(result.contributionCents, 596);
  assert.ok(Math.abs(result.contributionPercent - 10.1103) < 0.001);
  assert.throws(() => pricing.contribution({ revenueCents: 5895, washingCents: 3300, courierCents: null, processingCents: 201 }));
  assert.equal(pricing.contribution({ revenueCents: 0, washingCents: 0, courierCents: 0, processingCents: 0 }).contributionPercent, null);
});
