 'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const economics = require('../src/core/pricing-economics');
const dynamic = require('../src/core/dynamic-order-pricing');
const pricing = require('../src/core/pricing');
const policy = { pricingMethod: 'COST_PLUS_MARGIN_15', marginBps: { ONE_TIME:2000,SUBSCRIPTION:1000,WHOLESALE:500 }, processingBps:290,processingFixedCents:30,operationalFeeBps:2500,referenceWeightLb:33 };
const candidate = {id:'shop',eligible:true,wholesaleCentsPerLb:70,pickupCents:699,returnCents:699,source:'SIMULATION',expiresAt:'2099-01-01'};
const quote = (category='ONE_TIME', overrides={}) => dynamic.quoteCandidates([{...candidate,...overrides}],{policy,category});
const orderFor = q => ({id:'test-order',status:'AT_PARTNER',pricing_snapshot:q,price_per_lb_cents:q.rateCentsPerLb,minimum_cents:q.minimumTotalCents,weight_lb:11,bag_count:1,payment_status:'UNPAID'});

test('new categories include processing, keep a $15 floor, and recover delivery once',()=>{
 for(const [category,rate,fee] of [['ONE_TIME',91,1748],['SUBSCRIPTION',81,1553],['WHOLESALE',77,1472]]){
  const q=quote(category);assert.equal(q.rateCentsPerLb,rate);assert.equal(q.operationalFeeCents,fee);assert.equal(q.minimumTotalCents,1500);
  assert.equal(q.estimated30LbCents,rate*30+fee);assert.equal(q.estimated40LbCents,rate*40+fee);
  assert.equal(pricing.priceOn(orderFor(q),11).beforeDiscount,rate*11+fee);
 }
});
test('reference weight and old fee allocation no longer determine either price component',()=>{
 const original=quote();const modified=economics.preview({...candidate,category:'ONE_TIME',policy:{...policy,referenceWeightLb:15,operationalFeeBps:9999}});
 for(const field of ['rateCentsPerLb','operationalFeeCents','minimumTotalCents'])assert.equal(modified[field],original[field]);
 assert.equal(quote('ONE_TIME',{pickupCents:1200}).rateCentsPerLb,original.rateCentsPerLb);
});
test('saved legacy policy still gives the old quote and minimum',()=>{
 const old={...policy};delete old.pricingMethod;
 const q=economics.preview({...candidate,policy:old,category:'ONE_TIME'});
 assert.equal(q.rateCentsPerLb,137);assert.equal(q.operationalFeeCents,350);assert.equal(q.minimumTotalCents,1943);
});
test('quotes, billing, weight assessment and holds agree at fractional weights and floor',()=>{
 for(const category of economics.CATEGORIES)for(const transport of [0,1398,4000]){
  const q=quote(category,{pickupCents:transport,returnCents:0});const order=orderFor(q);
  for(const weight of [.001,.5,1,11,16.001,30,33,40,50]){
   const expected=Math.max(1500,Math.ceil(Math.round(weight*1000)*q.rateCentsPerLb/1000)+q.operationalFeeCents);
   assert.equal(economics.quotedTotal({...q,weightLb:weight}),expected);
   assert.equal(pricing.priceOn(order,weight).beforeDiscount,expected);
   assert.equal(dynamic.assessWeight(q,{weightLb:weight,pickupCents:transport,returnCents:0}).totalCents,expected);
  }
  const holds=require('../src/core/card-hold-policy');
  assert.equal(holds.amount(q,{mode:'MINIMUM'}),1500);
  assert.equal(holds.amount(q,{mode:'MAXIMUM'}),economics.quotedTotal({...q,weightLb:50}));
 }
});
test('booking itemizes fees and preserves old fee labels',()=>{
 const q=quote();const html=require('../src/web/booking-price').review({snapshot:q},'');
 assert.match(html,/Delivery/);assert.match(html,/\$15\.00/);assert.match(html,/\$11\.12/);assert.match(html,/Operational fee/);assert.doesNotMatch(html,/Estimated total|30–40 lb/);
 assert.equal(require('../src/web/pricing-label')({}),'Operational fee');
});
test('van and laundromat settlement charge the complete new quote, not pounds alone',async t=>{
 const db=require('../src/db'),billing=require('../src/core/billing'),bags=require('../src/core/bags'),events=require('../src/core/order-events'),promotions=require('../src/core/promotions');
 const fulfilment=require('../src/core/fulfilment');const q=quote();const order=orderFor(q);const charges=[];const updates=[];
 t.mock.method(bags,'forOrder',async()=>[{weight_lb:11,loaded_at:'now'}]);
 t.mock.method(bags,'clipsFor',()=>[]);
 t.mock.method(events,'record',async()=>{});
 t.mock.method(promotions,'discountFor',async()=>null);
 t.mock.method(billing,'settleTotal',async(o,c,options)=>{charges.push(options?.totalCents??o.price_cents);return {ok:true};});
 t.mock.method(db,'from',()=>{let patch={};const chain={update(v){patch=v;updates.push(v);return this;},eq(){return this;},is(){return this;},select(){return this;},maybeSingle:async()=>({data:{...order,...patch}}),then(resolve){resolve({error:null});}};return chain;});
 const van=await fulfilment.loadVan(order);assert.equal(van.priceCents,2749);
 const settled=await fulfilment.settleWeight(order,{chosenLb:11});assert.equal(settled.ok,true);
 assert.deepEqual(charges,[2749,2749]);assert.ok(updates.every(p=>p.price_cents===2749));
});
test('settlement message explains delivery and processing instead of claiming pounds alone equal the bill',()=>{
 const q=quote();const parts=pricing.priceOn(orderFor(q),11);
 const text=require('../src/core/fulfilment').pricedSentence({opening:'Your laundry weighed 11 lb',byWeight:parts.byWeight,floor:1500,surcharge:0,total:parts.beforeDiscount,perPound:'$0.91 a pound',quotedParts:parts});
 assert.match(text,/\$17\.48 delivery and fees/);assert.match(text,/\$27\.49/);assert.match(text,/Processing is included/);
});

test('promotions cannot lower new paid orders below $15, while legacy discounts remain unchanged',()=>{
 const order=orderFor(quote());
 assert.equal(pricing.allowedDiscount(order,2749,2000),1249);
 assert.equal(pricing.allowedDiscount(order,1500,500),0);
 assert.equal(pricing.allowedDiscount({...order,pricing_snapshot:{}},2749,5000),5000);
});
