'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../src/core/weight-based-pricing'),economics=require('../src/core/pricing-economics');
const policy={pricingMethod:model.METHOD,minimumWeightLb:18,minimumTotalCents:0,referenceWeightLb:33,
 operationalFeeBps:2500,processingBps:290,processingFixedCents:30,marginBps:{SUBSCRIPTION:1000,ONE_TIME:2000,WHOLESALE:500}};
const quote=(extra={},category='SUBSCRIPTION',weight)=>economics.preview({policy:{...policy,...extra},category,
 wholesaleCentsPerLb:70,pickupCents:699,returnCents:699,estimatedWeightLb:weight});

test('18 lb minimum stays flat for smaller bags and preserves target at every measured weight',()=>{
 for(const category of economics.CATEGORIES) for(const cardHold of [undefined,{mode:'FIXED',fixedCents:2500},{mode:'MINIMUM'},{mode:'MAXIMUM'}]) {
  const s=quote({cardHold},category),floor=model.total(s,18,{applyMinimum:false});
  assert.equal(s.minimumTotalCents,floor);
  assert.equal(model.minimumIncludedWeight(s),18);
  for(const weight of [.001,.5,1,10,17.999,18,18.001,19,20,30,40,50]) {
   const total=model.total(s,weight),cost=economics.washingCostCents(weight,70)+1398+model.processingCents(total,s);
   if(weight<=18) assert.equal(total,floor);
   else assert.equal(total,model.total(s,weight,{applyMinimum:false}));
   assert.ok((total-cost)*10000>=total*policy.marginBps[category]);
   assert.equal(require('../src/core/pricing').priceOn({pricing_snapshot:s},weight).beforeDiscount,total);
  }
 }
});

test('new estimates start at 30 lb but explicitly selected weights and old minimum snapshots survive',()=>{
 assert.equal(quote().estimatedWeightLb,30);assert.equal(model.estimatedWeight(),30);
 assert.equal(quote({},'ONE_TIME',1).estimatedWeightLb,1);
 const old=quote({minimumWeightLb:undefined,minimumTotalCents:2800,cardHold:{mode:'FIXED',fixedCents:2500}},'SUBSCRIPTION',1);
 assert.equal(model.total(old,1),2800);assert.equal(model.minimumIncludedWeight(old),14);
 const changed=quote({minimumWeightLb:22});assert.notEqual(changed.minimumTotalCents,quote().minimumTotalCents);
 assert.equal(model.total(old,1),2800);
});

test('tier prices and slider endpoints disclose the 18 lb bundle and 50 lb rates',()=>{
 const view=require('../src/web/weight-pricing'),categories={};
 for(const key of ['SUBSCRIPTION','ONE_TIME'])categories[key]=quote({cardHold:{mode:'FIXED',fixedCents:2500}},key,1);
 const html=view.publicQuote({categories},'Example address');
 assert.match(html,/1–18 lb/);assert.match(html,/50 lb/);
 for(const s of Object.values(categories)) {
  const money=n=>'$'+(n/100).toFixed(2);
  assert.ok(html.includes(money(s.minimumTotalCents/18)+'/lb'));
  assert.ok(html.includes(money(model.total(s,50)/50)+'/lb'));
  assert.ok(html.includes(money(s.minimumTotalCents)+' minimum total'));
 }
 assert.match(html,/Minimum-order rate · up to 18 lb/);
 assert.match(html,/Includes up to 18 lb/);
});

test('minimum settings use weight, validate bounds and cannot silently restore the old dollar floor',()=>{
 const settings=require('../src/routes/pricing-settings');
 const form={ONE_TIME:'20',SUBSCRIPTION:'10',WHOLESALE:'5',hold_mode:'FIXED',hold_fixed:'25',minimum_weight_lb:'18',minimum_total:'28'};
 const updated=settings.updatedPolicy(policy,form,'fixture');
 assert.equal(updated.minimumWeightLb,18);assert.equal(updated.minimumTotalCents,0);
 assert.match(settings.settingsBody(updated),/Minimum billable weight/);
 for(const value of ['0','51','18.5','abc',''])assert.throws(()=>settings.updatedPolicy(policy,{...form,minimum_weight_lb:value},'fixture'));
 for(const minimumWeightLb of [0,51,NaN,18.5])assert.throws(()=>quote({minimumWeightLb}));
});

test('preliminary minimum follows the cheapest 18 lb candidate while saved billing keeps its destination',()=>{
 const dynamic=require('../src/core/dynamic-order-pricing'),view=require('../src/web/weight-pricing');
 const candidates=[{id:'near',wholesaleCentsPerLb:100,pickupCents:100,returnCents:100},
  {id:'far',wholesaleCentsPerLb:40,pickupCents:800,returnCents:800}].map(c=>({...c,eligible:true,source:'SHIPDAY',expiresAt:'2099-01-01'}));
 const at=weight=>dynamic.quoteCandidates(candidates,{policy,category:'SUBSCRIPTION',estimatedWeightLb:weight});
 const s=at(50),savedMinimum=s.minimumTotalCents;
 assert.equal(s.partnerId,'far');assert.equal(at(18).partnerId,'near');
 s.weightTotalsCents=Array.from({length:50},(_,i)=>at(i+1).estimatedTotalCents);
 const publicMinimum=at(18).minimumTotalCents;
 assert.ok(publicMinimum<savedMinimum);
 assert.ok(view.estimate({...s,estimatedWeightLb:1}).includes('data-minimum-total="'+publicMinimum+'"'));
 assert.ok(view.estimate({...s,weightTotalsCents:null}).includes('data-minimum-total="'+savedMinimum+'"'));
 assert.equal(model.total(s,1),savedMinimum);
});

test('wholesale booking range uses its own tier without exposing it in public comparisons',()=>{
 const view=require('../src/web/weight-pricing');
 const categories=Object.fromEntries(economics.CATEGORIES.map(key=>[key,quote({},key)]));
 const privateRange=view.slider(30,{WHOLESALE:categories.WHOLESALE});
 assert.match(privateRange,/>Wholesale</);assert.doesNotMatch(privateRange,/>Subscription<|>One-time</);
 assert.doesNotMatch(view.publicQuote({categories},'Example address'),/>Wholesale</);
});
