'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { quoteCandidates, assessWeight } = require('../src/core/dynamic-order-pricing');
const policy = { marginBps: { ONE_TIME: 2000, SUBSCRIPTION: 1000, WHOLESALE: 500 },
  processingBps: 290, processingFixedCents: 30, operationalFeeBps: 2500, referenceWeightLb: 33 };
const candidate = { id: 'one', eligible: true, wholesaleCentsPerLb: 100,
  pickupCents: 899, returnCents: 899, source: 'SHIPDAY', expiresAt: '2030-01-01T00:00:00Z' };
function quote(category = 'ONE_TIME') { return quoteCandidates([candidate], { policy, category }); }
test('compares the whole customer total; cheaper washing can lose on courier costs', () => {
  const result = quoteCandidates([candidate, { ...candidate, id: 'two', wholesaleCentsPerLb: 90, pickupCents: 1500, returnCents: 1500 }], { policy, category: 'ONE_TIME' });
  assert.equal(result.partnerId, 'one'); assert.equal(result.operationalFeeCents, 450);
  assert.equal(result.comparisons.length, 2);
});
test('category targets change pricing and snapshots survive subsequent policy edits', () => {
  const one = quote(), sub = quote('SUBSCRIPTION'), wholesale = quote('WHOLESALE');
  assert.ok(one.rateCentsPerLb > sub.rateCentsPerLb); assert.ok(sub.rateCentsPerLb > wholesale.rateCentsPerLb);
  const original = policy.marginBps.ONE_TIME; policy.marginBps.ONE_TIME = 3000;
  assert.equal(one.policy.marginBps.ONE_TIME, original); policy.marginBps.ONE_TIME = original;
});
test('unpriced or expired courier costs cannot silently win or disappear from comparison', () => {
  for(const source of ['IN_HOUSE','SIMULATION',undefined])assert.throws(()=>quoteCandidates([{...candidate,source}],{policy,category:'ONE_TIME'}),/Shipday/);
  assert.throws(() => quoteCandidates([{ ...candidate, returnCents: null }], { policy, category: 'ONE_TIME' }));
  assert.throws(() => quoteCandidates([{ ...candidate, expiresAt: '2000-01-01' }], { policy, category: 'ONE_TIME' }));
});
test('actual weight uses the saved quote even when costs miss the target or an old cap is exceeded',()=>{
 const snapshot=quote();const {quotedTotal}=require('../src/core/pricing-economics');
 for(const weightLb of [0.5,1,10,33,50]){
  const result=assessWeight(snapshot,{weightLb,pickupCents:1999,returnCents:1999,approvedLimitCents:1});
  assert.equal(result.totalCents,quotedTotal({...snapshot,weightLb}));assert.equal(result.approvalRequired,undefined);
 }
 assert.equal(snapshot.pickupCents,899);
});
test('overweight and invalid orders cannot be priced by the development weight flow',()=>{
 for(const weightLb of [0,-1,50.001,100,NaN,Infinity])assert.throws(()=>assessWeight(quote(),{weightLb,pickupCents:899,returnCents:899}));
});
test('billing and approved quote agree on fractional weight and inclusive minimum',()=>{
 const q=quote();const pricing=require('../src/core/pricing'),economics=require('../src/core/pricing-economics');
 const order={price_per_lb_cents:q.rateCentsPerLb,minimum_cents:q.minimumTotalCents,pricing_snapshot:q};
 for(const weight of [0.5,1,10.123,33.001,40])assert.equal(pricing.priceOn(order,weight).beforeDiscount,economics.quotedTotal({...q,weightLb:weight}));
});
