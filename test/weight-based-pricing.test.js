'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../src/core/weight-based-pricing'),economics=require('../src/core/pricing-economics'),dynamic=require('../src/core/dynamic-order-pricing'),pricing=require('../src/core/pricing');
const policy={pricingMethod:model.METHOD,minimumTotalCents:2800,marginBps:{SUBSCRIPTION:1000,ONE_TIME:2000,WHOLESALE:500},processingBps:290,processingFixedCents:30,referenceWeightLb:33,operationalFeeBps:2500,otherCostCents:0,otherCostPerLbCents:0};
const shop={id:'private-shop',eligible:true,wholesaleCentsPerLb:70,customerBaseCentsPerLb:100,pickupCents:699,returnCents:699,source:'SIMULATION',expiresAt:'2099-01-01'};
const quote=(category='SUBSCRIPTION',p=policy,weight=20)=>dynamic.quoteCandidates([shop],{policy:p,category,estimatedWeightLb:weight});
test('all 1–50 lb tiers and fractional weights cover their targets after rounded processing',()=>{
 for(const category of economics.CATEGORIES) for(const cardHold of [undefined,{mode:'FIXED',fixedCents:2500},{mode:'MINIMUM'},{mode:'MAXIMUM'}]) for(const transport of [0,1398,9000]) {
  const s={...quote(category,{...policy,cardHold,otherCostCents:47,otherCostPerLbCents:3}),pickupCents:transport,returnCents:0};
  let previous=Infinity;
  for(const w of [.001,.5,1,...Array.from({length:49},(_,i)=>i+2),11.111,29.999,49.999]) {
   const total=model.total(s,w),costs=economics.washingCostCents(w,70)+transport+47+Math.ceil(Math.round(w*1000)*3/1000)+model.processingCents(total,s);
   assert.ok((total-costs)*10000>=total*policy.marginBps[category],category+' '+w);
   assert.ok(total>=2800);assert.equal(economics.quotedTotal({...s,weightLb:w}),total);
   if(Number.isInteger(w)){assert.ok(total/w<=previous);previous=total/w;}
  }
 }
});
test('workbook costs match, except that configured split settlement pays two fixed fees',()=>{
 assert.deepEqual([10,20,30,40,50].map(w=>model.total(quote(),w)),[2800,3247,4051,4855,5658]);
 assert.deepEqual([10,20,30,40,50].map(w=>model.total(quote('ONE_TIME'),w)),[2800,3668,4577,5484,6392]);
 const s=quote('SUBSCRIPTION',{...policy,cardHold:{mode:'FIXED',fixedCents:2500}});
 assert.equal(model.processingCents(3000,s),148); // 73 + 15 variable cents, plus 60 fixed.
 assert.ok(model.total(s,50)>5658);
});
test('actual weighing uses saved cost terms, not the estimated per-pound display or today customer base',()=>{
 const p=structuredClone(policy),s=quote('SUBSCRIPTION',p,10);p.marginBps.SUBSCRIPTION=5000;
 const order={pricing_snapshot:s,price_per_lb_cents:s.rateCentsPerLb,minimum_cents:2800};
 assert.equal(pricing.priceOn(order,50).beforeDiscount,5658);
 assert.equal(model.total({...s,rateCentsPerLb:999999,customerBaseCentsPerLb:9999},50),5658);
 assert.equal(require('../src/core/card-hold-policy').amount(s,{mode:'MAXIMUM'}),5658);
 assert.equal(dynamic.assessWeight(s,{weightLb:50,pickupCents:699,returnCents:699}).totalCents,5658);
 assert.throws(()=>pricing.priceOn(order,50.001),/50 lb/);
 for(const w of [0,-1,NaN,Infinity,1.1234])assert.throws(()=>model.total(s,w));
});
test('destination selection compares whole-order cost at the selected weight',()=>{
 const candidates=[{...shop,id:'near',wholesaleCentsPerLb:200,pickupCents:100,returnCents:100},{...shop,id:'far',wholesaleCentsPerLb:40,pickupCents:1200,returnCents:1200}];
 assert.equal(dynamic.quoteCandidates(candidates,{policy,category:'SUBSCRIPTION',estimatedWeightLb:10}).partnerId,'near');
 assert.equal(dynamic.quoteCandidates(candidates,{policy,category:'SUBSCRIPTION',estimatedWeightLb:50}).partnerId,'far');
});
test('new discounts cannot remove the saved cost target, and legacy discounts stay unchanged',()=>{
 const s=quote(),o={pricing_snapshot:s,weight_lb:30,minimum_cents:2800};
 assert.equal(pricing.allowedDiscount(o,4051,500),0);
 assert.equal(pricing.allowedDiscount(o,5658,500,50),0); // Reweighing must use the new weight, not the old 30 lb.
 assert.equal(pricing.allowedDiscount({...o,weight_lb:1},2800,500),0);
 assert.equal(pricing.allowedDiscount({minimum_cents:0},4051,500),500);
});
test('public tiers show only inclusive estimates, keep subscription first and expose no costs',()=>{
 const html=require('../src/web/weight-pricing').publicQuote({categories:{SUBSCRIPTION:quote(),ONE_TIME:quote('ONE_TIME')}},'<address>');
 assert.match(html,/type="range" min="1" max="50"/);assert.match(html,/\$28\.00 minimum total/);
 assert.match(html,/\$1\.13\/lb at 50 lb/);assert.match(html,/&lt;address&gt;/);
 assert.ok(html.indexOf('<h2>Subscription')<html.indexOf('<h2>One-time'));
 assert.doesNotMatch(html,/private-shop|wholesaleCents|marginBps|processingBps|Operational fee|Service fee/);
 const review=require('../src/web/booking-price').review({id:'quote',snapshot:quote(),pickup_date:'2030-01-01',pickup_time:'12:00'},'');
 assert.match(review,/not a fixed per-pound rate/);assert.match(review,/billing at measured weight/);
});
test('both settlement paths charge actual weight using the new formula',async t=>{
 const db=require('../src/db'),billing=require('../src/core/billing'),bags=require('../src/core/bags'),events=require('../src/core/order-events'),promotions=require('../src/core/promotions'),fulfilment=require('../src/core/fulfilment');
 const s=quote('ONE_TIME',policy,10),order={id:'test-order',status:'AT_PARTNER',pricing_snapshot:s,price_per_lb_cents:s.rateCentsPerLb,minimum_cents:2800,weight_lb:30,bag_count:1,payment_status:'UNPAID'},charges=[];
 t.mock.method(bags,'forOrder',async()=>[{weight_lb:30,loaded_at:'now'}]);t.mock.method(bags,'clipsFor',()=>[]);t.mock.method(events,'record',async()=>{});t.mock.method(promotions,'discountFor',async()=>null);
 t.mock.method(billing,'settleTotal',async(o,c,options)=>{charges.push(options?.totalCents??o.price_cents);return {ok:true};});
 t.mock.method(db,'from',()=>{let patch={};return {update(v){patch=v;return this;},eq(){return this;},is(){return this;},select(){return this;},maybeSingle:async()=>({data:{...order,...patch}}),then(resolve){resolve({error:null});}};});
 assert.equal((await fulfilment.loadVan(order)).priceCents,4577);
 assert.equal((await fulfilment.settleWeight(order,{chosenLb:30})).ok,true);assert.deepEqual(charges,[4577,4577]);
 const parts=pricing.priceOn(order,30),text=fulfilment.pricedSentence({opening:'30 lb',total:parts.beforeDiscount,surcharge:0,quotedParts:parts});
 assert.match(text,/\$45\.77/);assert.doesNotMatch(text,/plus.*delivery|At .*pound/);
});

test('booking retains the entered weight through plan selection, back navigation and quote review',async t=>{
 const express=require('express'),auth=require('../src/core/customer-auth'),checkout=require('../src/core/dev-checkout'),booking=require('../src/core/booking'),settings=require('../src/core/settings');
 const customer={id:'fixture',name:'Test',phone:'+12015550100',address_line1:'1 Test Street',city:'Lodi',postal_code:'07644',preferences:{water_temp:'cold',fabric_softener:'standard',special_instructions:'Front door'}};
 t.mock.method(auth,'attachCustomer',async req=>{req.customer=customer;});t.mock.method(settings,'opensOn',async()=>null);t.mock.method(booking,'hasPreferences',()=>true);
 t.mock.method(checkout,'estimateAddress',async(c,w)=>{const categories={SUBSCRIPTION:quote('SUBSCRIPTION',policy,Number(w)),ONE_TIME:quote('ONE_TIME',policy,Number(w))};return {snapshot:categories.ONE_TIME,categories};});
 const app=express();app.use(express.urlencoded({extended:false}));app.use(require('../src/routes/account').router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 let html=await(await fetch(base+'/account/book?address_confirmed=yes&estimated_weight_lb=37')).text();
 assert.match(html,/data-weight-pricing/);assert.match(html,/name="estimated_weight_lb"[^>]*value="37"/);
 assert.match(html,/Average price at 37 lb/);assert.ok(html.indexOf('value="SUBSCRIPTION"')<html.indexOf('value="ONE_TIME"'));
 assert.equal((html.match(/name="estimated_weight_lb"/g)||[]).length,1);
 html=await(await fetch(base+'/account/book',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({step:'repeat',address_confirmed:'yes',estimated_weight_lb:'37',plan:'ONE_TIME'})})).text();
 assert.match(html,/name="estimated_weight_lb" value="37"/);assert.match(html,/Schedule your pickup/);
});
test('admin model settings validate the minimum and other cost allowances',()=>{
 const settings=require('../src/routes/pricing-settings'),form={SUBSCRIPTION:'10',ONE_TIME:'20',WHOLESALE:'5',hold_mode:'FIXED',hold_fixed:'25',minimum_total:'28',other_cost:'1.20',other_cost_per_lb:'0.05'};
 const next=settings.updatedPolicy(policy,form,'test');assert.equal(next.minimumTotalCents,2800);assert.equal(next.otherCostCents,120);assert.equal(next.otherCostPerLbCents,5);
 assert.throws(()=>settings.updatedPolicy(policy,{...form,minimum_total:'-2'},'test'));
 assert.throws(()=>settings.updatedPolicy(policy,{...form,other_cost:'1.234'},'test'));
});
