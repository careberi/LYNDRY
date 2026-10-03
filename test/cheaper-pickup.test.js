
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const realDispatch=require('../src/core/shipday-dispatch').dispatchInstant;
function fixture(){
 const shops=[{id:'cheap'},{id:'mid'}],calls=[];
 const categories=price=>({SUBSCRIPTION:{estimatedTotalCents:price},ONE_TIME:{estimatedTotalCents:price+500}});
 const context={shops,current:{},home:{},hours:new Map(),loads:new Map(),planned:new Map()};
 const current={categories:categories(6000),searchContext:context};
 const modules={
 './dev-checkout':{scheduleFits:(shop,rows,date,time)=>shop.id==='cheap'?date==='2030-01-02'&&time>='10:00'&&time<'18:00':time>='12:00'&&time<'18:00',previewQuote:async(customer,form,options)=>{calls.push({form,options});const id=options.partnerId||form.alternative_partner_id;return {pickup_date:form.pickup_date,pickup_time:form.pickup_time,categories:categories(id==='cheap'?4000:5000)};}},
 './shipday-dispatch':{dispatchInstant:realDispatch},'./in-house-quote':{estimate:()=>({arrivalChecks:[]})},
 '../config':{config:{routing:{}}},'./partners':{plannedByPartner:async()=>new Map()},'./geocode':{milesBetween:()=>2},
 './pickup-timing':require('../src/core/pickup-timing')};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../src/core/cheaper-pickup'),'utf8'),{module,require:id=>modules[id],Date,Map});
 return {service:module.exports,current,calls};
}
test('cheaper alternative finds the earliest eligible minute for the cheapest shop',async()=>{
 const f=fixture(),offer=await f.service.find({}, {pickup_date:'2030-01-01',pickup_time:'13:42'},f.current);
 assert.equal(offer.alternative_partner_id,'cheap');assert.equal(offer.pickup_date,'2030-01-02');assert.equal(offer.pickup_time,'10:00');
 assert.equal(offer.categories.SUBSCRIPTION.estimatedTotalCents,4000);assert.equal(offer.categories.ONE_TIME.estimatedTotalCents,4500);
 assert.ok(f.calls.some(row=>row.form.alternative_partner_id==='cheap'));
});
test('an alternative must never increase either pricing method estimate',()=>{
 const {cheaper}=require('../src/core/cheaper-pickup');const quote=(sub,one)=>({categories:{SUBSCRIPTION:{estimatedTotalCents:sub},ONE_TIME:{estimatedTotalCents:one}}});
 assert.equal(cheaper(quote(200,400),quote(300,350)),false);assert.equal(cheaper(quote(200,300),quote(300,350)),true);assert.equal(cheaper(quote(300,350),quote(300,350)),false);
});
test('alternative choice names date, both methods, and keeps the chosen shop through rechecking',()=>{
 const html=require('../src/web/cheaper-pickup').render({pickup_date:'2030-01-02',pickup_time:'10:00',alternative_partner_id:'cheap',categories:{SUBSCRIPTION:{estimatedTotalCents:4000},ONE_TIME:{estimatedTotalCents:4500}}},{estimated_weight_lb:30});
 assert.match(html,/Subscription:.*\$1.33/);assert.match(html,/One-time pickup:.*\$1.50/);assert.match(html,/alternative_partner_id=cheap/);assert.match(html,/address_confirmed=yes/);assert.match(html,/pickup_updated=yes/);assert.match(html,/Availability is checked again/);
});
