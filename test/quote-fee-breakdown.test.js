 'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const split=require('../src/web/quote-fee-breakdown');
test('itemization preserves subscription and one time totals without adding the service fee again',()=>{
 const base={pricingMethod:'COST_PLUS_MARGIN_15',courierCents:1398,policy:{operationalFeeBps:2500}};
 assert.deepEqual(split({...base,operationalFeeCents:1640}),[['Delivery',1090],['Operational fee',350],['Service fee',200]]);
 assert.deepEqual(split({...base,operationalFeeCents:1853}),[['Delivery',1303],['Operational fee',350],['Service fee',200]]);
 for(const total of [0,35,199,200,250,1640]){
  const rows=split({...base,operationalFeeCents:total});
  assert.equal(rows.reduce((sum,row)=>sum+row[1],0),total);assert.ok(rows.every(row=>row[1]>=0));
 }
 assert.deepEqual(split({operationalFeeCents:350}),[['Operational fee',350]]);
});

 test('revised transport fees match approved examples and preserve saved older quotes',()=>{
 const economics=require('../src/core/pricing-economics');
 const policy={pricingMethod:'COST_PLUS_MARGIN_15',marginBps:{SUBSCRIPTION:1000,ONE_TIME:2000,WHOLESALE:500},processingBps:290,processingFixedCents:30,operationalFeeBps:2500,referenceWeightLb:33};
 for(const [category,total,delivery,operations] of [['SUBSCRIPTION',1553,966,388],['ONE_TIME',1748,1112,437],['WHOLESALE',1472,905,368]]) {
 const q=economics.preview({policy,category,wholesaleCentsPerLb:70,customerBaseCentsPerLb:100,pickupCents:699,returnCents:699});
 assert.equal(q.operationalFeeCents,total);
 assert.deepEqual(split({...q,policy}),[['Delivery',delivery],['Operational fee',operations],['Service fee',199]]);
 assert.equal(economics.quotedTotal({...q,weightLb:11}),Math.max(1500,q.rateCentsPerLb*11+total));
 }
 const saved={pricingMethod:'COST_PLUS_MARGIN_15',courierCents:1398,operationalFeeCents:1640,rateCentsPerLb:115,minimumTotalCents:1500};
 assert.equal(economics.quotedTotal({...saved,weightLb:11}),2905);
 assert.deepEqual(split(saved),[['Delivery',1090],['Operational fee',350],['Service fee',200]]);
 for(const total of [0,1,198,199,200]) {
 const rows=split({pricingMethod:'COST_PLUS_MARGIN_15',feeCalculation:'TRANSPORT_MARGIN_V2',operationalFeeCents:total});
 assert.equal(rows.reduce((sum,r)=>sum+r[1],0),total);assert.ok(rows.every(r=>r[1]>=0));
 }
 });
