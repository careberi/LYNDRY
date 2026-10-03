 'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {quoteCandidates,assessWeight}=require('../src/core/dynamic-order-pricing');
const policy={pricingMethod:'COST_PLUS_MARGIN_15',marginBps:{ONE_TIME:2000,SUBSCRIPTION:1000,WHOLESALE:500},processingBps:290,processingFixedCents:30,operationalFeeBps:2500,referenceWeightLb:33};
const shop={id:'a',eligible:true,wholesaleCentsPerLb:70,customerBaseCentsPerLb:100,pickupCents:699,returnCents:699,source:'SHIPDAY',expiresAt:'2099-01-01'};
test('customer base drives all category rates, without replacing the actual wash cost',()=>{
 for(const [category,rate] of [['ONE_TIME',130],['SUBSCRIPTION',115],['WHOLESALE',109]]){
  const q=quoteCandidates([shop],{policy,category});assert.equal(q.rateCentsPerLb,rate);assert.equal(q.wholesaleCentsPerLb,70);assert.equal(q.customerBaseCentsPerLb,100);
  const report=require('../src/core/dev-checkout').report({pricing_snapshot:q,weight_lb:11,price_cents:assessWeight(q,{weightLb:11,pickupCents:699,returnCents:699}).totalCents,payment_status:'PAID'});
  assert.equal(report.washingCents,770);
 }
});
test('shop choice compares the customer total, not cheapest wholesale cost',()=>{
 const q=quoteCandidates([{...shop,customerBaseCentsPerLb:120},{...shop,id:'b',wholesaleCentsPerLb:90,customerBaseCentsPerLb:90}],{policy,category:'SUBSCRIPTION'});
 assert.equal(q.partnerId,'b');assert.equal(q.wholesaleCentsPerLb,90);
 assert.ok(q.comparisons[0].totalCents < q.comparisons[1].totalCents);
});
test('blank base falls back; old policies ignore the new base; saved quotes never follow later edits',()=>{
 const old={...policy};delete old.pricingMethod;
 assert.equal(quoteCandidates([shop],{policy:old,category:'ONE_TIME'}).rateCentsPerLb,137);
 assert.equal(quoteCandidates([{...shop,customerBaseCentsPerLb:null}],{policy,category:'ONE_TIME'}).rateCentsPerLb,91);
 const input={...shop};const q=quoteCandidates([input],{policy,category:'SUBSCRIPTION'});input.customerBaseCentsPerLb=200;
 assert.equal(q.customerBaseCentsPerLb,100);assert.equal(q.rateCentsPerLb,115);
});
test('admin saves three independent rates and preserves customer base when older forms omit it',async t=>{
 const db=require('../src/db'),partners=require('../src/core/partners');const before={id:'a',name:'Test Laundry',type:'LAUNDROMAT',address_line1:null,postal_code:null,customer_base_per_lb_cents:100};let saved;
 t.mock.method(db,'from',()=>{const c={select(){return this;},eq(){return this;},maybeSingle:async()=>({data:before}),update(row){saved=row;return this;},single:async()=>({data:{...before,...saved}})};return c;});
 const form={type:'LAUNDROMAT',name:'Test Laundry',wholesale_per_lb:'0.70',retail_per_lb:'1.75',customer_base_per_lb:'1.00'};
 assert.equal((await partners.update('a',form)).ok,true);
 assert.equal(saved.wholesale_per_lb_cents,70);assert.equal(saved.retail_per_lb_cents,175);assert.equal(saved.customer_base_per_lb_cents,100);
 delete form.customer_base_per_lb;await partners.update('a',form);assert.equal(Object.hasOwn(saved,'customer_base_per_lb_cents'),false);
 await partners.update('a',{...form,customer_base_per_lb:''});assert.equal(saved.customer_base_per_lb_cents,null);
});
test('invalid customer bases are rejected by admin and quote arithmetic',async()=>{
 const partners=require('../src/core/partners');
 for(const value of ['0','-1','abc','1.001','Infinity','999999999999']){
  assert.equal((await partners.create({type:'LAUNDROMAT',name:'Test',customer_base_per_lb:value})).ok,false);
 }
 for(const value of [0,-1,NaN,Infinity])assert.throws(()=>quoteCandidates([{...shop,customerBaseCentsPerLb:value}],{policy,category:'ONE_TIME'}));
});
test('laundromat admin form distinguishes cost, retail and customer base',()=>{
 const html=require('../src/web/partners-page').partnerFormBody({partner:{id:'a',name:'Test',type:'LAUNDROMAT',wholesale_per_lb_cents:70,retail_per_lb_cents:175,customer_base_per_lb_cents:100}});
 assert.match(html,/name="customer_base_per_lb"/);assert.match(html,/Customer pricing base per lb/);assert.match(html,/Supplier payments still use our cost/);
});
