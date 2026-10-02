 'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../src/core/weight-based-pricing'),economics=require('../src/core/pricing-economics');
const dynamic=require('../src/core/dynamic-order-pricing'),pricing=require('../src/core/pricing');
const policy={pricingMethod:model.METHOD,laundryPricingBasis:model.CUSTOMER_BASE,minimumWeightLb:18,minimumTotalCents:0,
 referenceWeightLb:33,operationalFeeBps:2500,processingBps:290,processingFixedCents:30,
 marginBps:{SUBSCRIPTION:1000,ONE_TIME:2000,WHOLESALE:500},cardHold:{mode:'FIXED',fixedCents:2500}};
const shop={id:'fixture',eligible:true,wholesaleCentsPerLb:70,customerBaseCentsPerLb:100,retailCentsPerLb:250,
 pickupCents:699,returnCents:699,source:'SIMULATION',expiresAt:'2099-01-01'};
const quote=(over={},category='SUBSCRIPTION',p=policy)=>dynamic.quoteCandidates([{...shop,...over}],{policy:p,category,estimatedWeightLb:30});

test('new customer bases drive every tier, weight and minimum while supplier cost stays separate',()=>{
 for(const category of economics.CATEGORIES) for(const base of [40,70,100,150]) {
  const s=quote({customerBaseCentsPerLb:base},category);
  assert.equal(s.wholesaleCentsPerLb,70);assert.equal(s.customerBaseCentsPerLb,base);
  const expected={...s,laundryPricingBasis:undefined,wholesaleCentsPerLb:base};
  assert.equal(s.minimumTotalCents,model.total(expected,18,{applyMinimum:false}));
  for(const w of [.001,17.999,18.001,29.999,...Array.from({length:50},(_,i)=>i+1)]) {
   assert.equal(model.total(s,w),model.total(expected,w));
   assert.equal(pricing.priceOn({pricing_snapshot:s},w).beforeDiscount,model.total(expected,w));
  }
 }
 assert.ok(quote().estimatedTotalCents>quote({customerBaseCentsPerLb:70}).estimatedTotalCents);
 assert.equal(quote({wholesaleCentsPerLb:90,retailCentsPerLb:999}).estimatedTotalCents,quote().estimatedTotalCents);
});
test('customer price determines destination ranking rather than the lowest supplier cost',()=>{
 const candidates=[{...shop,id:'low-cost',wholesaleCentsPerLb:40,customerBaseCentsPerLb:140},
  {...shop,id:'low-price',wholesaleCentsPerLb:80,customerBaseCentsPerLb:90}];
 assert.equal(dynamic.quoteCandidates(candidates,{policy,category:'SUBSCRIPTION'}).partnerId,'low-price');
 const changed=candidates.map(s=>s.id==='low-cost'?{...s,customerBaseCentsPerLb:85}:s);
 assert.equal(dynamic.quoteCandidates(changed,{policy,category:'SUBSCRIPTION'}).partnerId,'low-cost');
});
test('blank bases explicitly fall back and invalid saved pricing terms fail closed',()=>{
 assert.equal(quote({customerBaseCentsPerLb:null}).estimatedTotalCents,quote({customerBaseCentsPerLb:70}).estimatedTotalCents);
 for(const value of [0,-1,1.5,NaN])assert.throws(()=>quote({customerBaseCentsPerLb:value}));
 assert.throws(()=>model.total({...quote(),customerBaseCentsPerLb:undefined},30));
 assert.throws(()=>model.total({...quote(),laundryPricingBasis:'unknown'},30));
});
test('old accepted snapshots keep cost pricing and new snapshots freeze both rates',()=>{
 const old=quote({},'SUBSCRIPTION',{...policy,laundryPricingBasis:undefined});
 const changed={...old,customerBaseCentsPerLb:999};
 assert.equal(model.total(old,30),model.total(changed,30));
 const saved=quote(),amount=model.total(saved,40);
 quote({wholesaleCentsPerLb:120,customerBaseCentsPerLb:200});
 assert.equal(model.total(saved,40),amount);
 assert.equal(saved.wholesaleCentsPerLb,70);assert.equal(saved.customerBaseCentsPerLb,100);
});
test('actual business cost and cost coverage still use the supplier rate',()=>{
 const s=quote(),total=model.total(s,30);
 const report=require('../src/web/order-economics').calculate({pricing_snapshot:s,weight_lb:30,price_cents:total});
 assert.equal(report.washing,2100);
 const lowBase=quote({customerBaseCentsPerLb:10});
 const assessed=dynamic.assessWeight(lowBase,{weightLb:30,pickupCents:699,returnCents:699});
 assert.equal(assessed.belowTarget,true);
 assert.equal(assessed.requiredTotalCents,model.total({...lowBase,laundryPricingBasis:undefined},30,{applyMinimum:false}));
});
test('edit and both profile versions distinguish all three rates and expose the fallback',()=>{
 const ui=require('../src/web/partners-page');
 const partner={id:'fixture',name:'Example laundry',type:'LAUNDROMAT',status:'ACTIVE',wholesale_per_lb_cents:70,retail_per_lb_cents:225,customer_base_per_lb_cents:100};
 const history={rows:[],total:0,flagged:0,meanDrift:0,heavier:0,lighter:0};
 const form=ui.partnerFormBody({partner});
 for(const courierModel of [true,false]) {
  const detail=ui.partnerDetailBody({partner,history,courierModel});
  for(const label of ['Laundromat walk-in rate','Our laundromat cost per lb','Customer pricing base per lb']) {
   assert.ok(form.includes(label));assert.ok(detail.includes(label));
  }
  for(const value of ['$0.70','$1.00','$2.25'])assert.ok(detail.includes(value));
  assert.doesNotMatch(detail,/legacy pricing only|Customer base rate/);
 }
 assert.match(form,/Blank uses our laundromat cost/);assert.doesNotMatch(form,/\(legacy\)|quotes.*use actual wholesale/);
});
