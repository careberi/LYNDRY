'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/core/weight-based-pricing');
const view = require('../src/web/weight-pricing');
const billing = require('../src/core/pricing');
const policy = {pricingMethod:model.METHOD, processingBps:290, processingFixedCents:30,
 marginBps:{SUBSCRIPTION:1000, ONE_TIME:2000, WHOLESALE:500}, cardHold:{mode:'FIXED',fixedCents:2500}};
const snapshot = (category='SUBSCRIPTION', extra={}) => ({pricingMethod:model.METHOD, category, policy,
 wholesaleCentsPerLb:70, pickupCents:699, returnCents:699, minimumTotalCents:2800, estimatedWeightLb:1, ...extra});

test('the configured minimum covers 14 subscription pounds or 10 one-time pounds', () => {
 const sub=snapshot(), one=snapshot('ONE_TIME');
 assert.equal(model.minimumIncludedWeight(sub),14);
 assert.equal(model.minimumIncludedWeight(one),10);
 assert.equal(model.total(sub,14),2800);
 assert.ok(model.total(sub,14.01)>2800);
 assert.equal(model.total(one,10),2800);
 assert.ok(model.total(one,10.01)>2800);
});

test('a minimum-order rate stays flat for every smaller bag without changing its bill', () => {
 for (const [category,coverage,rate] of [['SUBSCRIPTION',14,'2.00'],['ONE_TIME',10,'2.80']]) {
  for(let weight=1;weight<=coverage;weight++) {
   const s=snapshot(category,{estimatedWeightLb:weight}), before=JSON.stringify(s), html=view.estimate(s);
   assert.ok(html.includes('data-quote-rate>$'+rate+'</strong>'));
   assert.ok(html.includes('Minimum-order rate · up to '+coverage+' lb'));
   assert.ok(html.includes('Includes up to '+coverage+' lb'));
   assert.ok(html.includes('data-quote-total>$28.00</dd>'));
   assert.equal(billing.priceOn({pricing_snapshot:s},weight).beforeDiscount,2800);
   assert.equal(JSON.stringify(s),before);
  }
  const s=snapshot(category,{estimatedWeightLb:coverage+1}), html=view.estimate(s);
  assert.ok(html.includes('Average price at '+(coverage+1)+' lb'));
  assert.ok(html.includes('data-quote-rate>$'+(model.total(s,coverage+1)/100/(coverage+1)).toFixed(2)));
 }
});

test('allowance never overstates the weight bought by changed costs, margins or minima', () => {
 for(const category of Object.keys(policy.marginBps)) for(const minimum of [0,1500,2800,10000]) for(const cost of [40,70,213]) {
  const s=snapshot(category,{minimumTotalCents:minimum,wholesaleCentsPerLb:cost});
  const included=model.minimumIncludedWeight(s);
  assert.ok(included>=0&&included<=50);
  if(included===0) {assert.ok(model.total(s,1)>minimum);continue;}
  assert.ok(model.total(s,included)<=minimum);
  if(included<50) assert.ok(model.total(s,Math.round((included+.01)*100)/100)>minimum);
 }
});

test('insufficient minima invent no allowance, and a minimum covering everything stops at 50 lb', () => {
 const costly=snapshot('SUBSCRIPTION',{pickupCents:10000}), html=view.estimate(costly);
 assert.equal(model.minimumIncludedWeight(costly),0);
 assert.doesNotMatch(html,/Minimum-order rate|Includes up to/);
 assert.match(html,/Average price at 1 lb/);
 const large=snapshot('SUBSCRIPTION',{minimumTotalCents:10000});
 assert.equal(model.minimumIncludedWeight(large),50);
 assert.match(view.estimate(large),/data-quote-rate>\$2.00<\/strong>/);
});

test('final quote review uses its saved destination, not a preliminary comparison allowance', () => {
 const s=snapshot('SUBSCRIPTION',{pickupCents:999, minimumIncludedWeightLb:14});
 s.weightTotalsCents=Array(50).fill(2800);
 const frozen=model.minimumIncludedWeight(s);
 assert.ok(frozen<14);
 assert.match(view.estimate(s),/Includes up to 14 lb/);
 const html=require('../src/web/booking-price').review({id:'fixture',snapshot:s,pickup_date:'2030-01-01',pickup_time:'12:00'},'');
 assert.ok(html.includes('Includes up to '+frozen+' lb'));
 assert.doesNotMatch(html,/Includes up to 14 lb/);
 assert.match(html,/billing at measured weight/);
});
