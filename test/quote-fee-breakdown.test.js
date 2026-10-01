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
