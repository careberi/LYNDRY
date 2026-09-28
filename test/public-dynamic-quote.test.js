'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const economics=require('../src/core/pricing-economics'),dynamic=require('../src/core/dynamic-order-pricing'),view=require('../src/web/quote-result');
const policy={marginBps:{ONE_TIME:2000,SUBSCRIPTION:1000,WHOLESALE:500},processingBps:290,processingFixedCents:30,operationalFeeBps:2500,referenceWeightLb:33};
function fixture(){
 let writes=0;
 const shipdayClient={quote:async()=>({ok:true,expiresAt:'2030-01-01T00:05:00.000Z',options:[
  {service:'Uber',feeCents:674},{service:'DoorDash',feeCents:750}
 ]})};
 const chain={select(){return this;},lte(){return this;},order(){return this;},limit(){return {data:[{id:'policy',policy}]};}};
 const modules={
  '../db':{from(table){if(table==='dev_pricing_policies')return chain;if(table==='dev_order_quotes')return {insert(q){writes++;return {select(){return {single(){return {data:q};}};}};}};throw Error('Unexpected table '+table);}},
  '../config':{config:{env:'development',supabase:{isProduction:false},shipday:{apiKey:'test'}}},
  '../providers/couriers/shipday':{createClient:()=>shipdayClient},
  './public-courier-availability':require('../src/core/public-courier-availability'),
  './pricing-economics':economics,'./dynamic-order-pricing':dynamic,
  './shipday-dispatch':{dispatchInstant:()=> '2030-01-01T17:00:00Z'},
  './booking':{normaliseTime:x=>x,dateProblem:()=>null,timeProblem:()=>null,checkSlot:async()=>({ok:true})},
  './booking-intents':{firstDateFor:f=>f.pickup_date},
  './geocode':{addressLine:()=> 'Current address',lookupOnce:async()=>({lat:0,lng:0}),locate:async()=>({lat:0,lng:0}),milesBetween:()=>3},
  './partners':{list:async()=>[{id:'partner',status:'ACTIVE',phone:'test',address_line1:'Test',lat:1,lng:1,wholesale_per_lb_cents:100,turnaround_minutes:60}],hoursForAll:async()=>new Map(),loadByPartner:async()=>new Map(),plannedByPartner:async()=>new Map(),isOpenAt:()=>true,canCollectOn:()=>true,capacityOf:()=>({remaining:100})}
 };
 const context={require:n=>modules[n],module:{exports:{}},structuredClone};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/core/dev-checkout.js'),'utf8'),context);
 return {service:context.module.exports,writes:()=>writes,modules,shipdayClient};
}
test('public preview shares checkout terms and creates no quote or order record',async()=>{
 const f=fixture(),customer={id:'customer',address_line1:'Test',city:'Test',postal_code:'07452'},form={pickup_date:'2030-01-01',pickup_time:'12:00',plan:'ONE_TIME'};
 const preview=await f.service.previewQuote(customer,form,{publicPreview:true});assert.equal(f.writes(),0);
 const bookedQuote=await f.service.createQuote(customer,form);assert.equal(f.writes(),1);
 for(const key of ['rateCentsPerLb','operationalFeeCents','minimumTotalCents','estimated30LbCents','estimated40LbCents'])assert.equal(preview.categories.ONE_TIME[key],bookedQuote.snapshot[key]);
 assert.ok(preview.categories.SUBSCRIPTION.rateCentsPerLb<preview.categories.ONE_TIME.rateCentsPerLb);
});
test('dynamic quote shows one fee and inclusive totals, never a separate delivery charge',()=>{
 const input={wholesaleCentsPerLb:100,pickupCents:899,returnCents:899,policy};
 const categories=Object.fromEntries(['ONE_TIME','SUBSCRIPTION'].map(category=>[category,economics.preview({...input,category})]));
 const html=view.render({quote:{ok:true,dynamic:true,categories},address:'<Test>'});
 assert.match(html,/Operational fee/);assert.match(html,/Minimum total/);assert.match(html,/30–40 lb/);assert.match(html,/\$4.50/);
 assert.doesNotMatch(html,/\$17.98|charged separately|Round trip/);assert.match(html,/&lt;Test&gt;/);
});
test('public quote does not show a schedule refinement card',()=>{
 const input={wholesaleCentsPerLb:100,pickupCents:750,returnCents:750,policy};
 const categories=Object.fromEntries(['ONE_TIME','SUBSCRIPTION'].map(category=>[category,economics.preview({...input,category})]));
 const html=view.render({quote:{ok:true,dynamic:true,categories},address:'25 Windham Pl'});
 assert.doesNotMatch(html,/Refine your estimate|name="pickup_date"|Calculate my price/);
});

test('an address with no eligible laundromat gets one service-area answer and a consented notification form',()=>{
 const args={quote:null,error:'unavailable_area',address:'14-18 Renwick Pl, Long Branch, NJ, 07740',fields:{street:'14-18 Renwick Pl',town:'Long Branch',zip:'07740'}};
 const html=view.render(args);
 assert.match(html,/not operating in your area at this time/i);
 assert.match(html,/action="\/quote\/interest"/);
 assert.match(html,/name="phone"/);
 assert.match(html,/name="sms_consent"/);
 assert.match(html,/14-18 Renwick Pl/);
 assert.doesNotMatch(html,/Refine your estimate|Calculate my price|price per pound/i);

 const tooFar=view.render({quote:{ok:false,reason:'too_far',miles:20,maxMiles:15},address:args.address,fields:args.fields});
 assert.match(tooFar,/not operating in your area at this time/i);
 assert.doesNotMatch(tooFar,/outside the round|20\.0 miles/i);

 const saved=view.render({...args,interest:'thanks'});
 assert.match(saved,/saved your number/i);
 assert.doesNotMatch(saved,/name="phone"/);
});

test('preliminary address estimate shares economics without booking or needing a date',async()=>{
 const f=fixture();
 const q=await f.service.previewQuote({lat:0,lng:0},{},{publicPreview:true,addressEstimate:true});
 assert.ok(q.categories.ONE_TIME.estimated30LbCents>0);assert.equal(q.snapshot.source,'SHIPDAY');assert.equal(q.snapshot.pickupCents,750);assert.equal(f.writes(),0);
 await assert.rejects(f.service.previewQuote({}, {}, {addressEstimate:true}),/cannot be booked/);
});
test('50 lb maximum includes the fee once and respects a higher minimum',()=>{
 const view=require('../src/web/booking-price');
 const p={rateCentsPerLb:165,operationalFeeCents:450,minimumTotalCents:2214,estimated30LbCents:5400,estimated40LbCents:7050,estimatedReferenceTotalCents:5895,referenceWeightLb:33};
 const html=view.review({id:'test',snapshot:p},'');
 assert.match(html,/50 lb per order/);assert.match(html,/\$87.00/);assert.doesNotMatch(html,/name="spending_limit"|Set your spending limit|type="checkbox"/);assert.match(html,/name="price_consent" value="yes"/);
 assert.match(view.review({id:'test',snapshot:{...p,minimumTotalCents:10000}},''),/\$100.00/);
 assert.match(view.planEstimate(p),/\$54.00–\$70.50/);
});
test('overweight dev order stops before price updates or charges',async()=>{
 const f=fixture();await assert.rejects(f.service.evaluateWeight({},50.01),/limited to 50 lb/);assert.equal(f.writes(),0);
});

test('phone-free laundromats compete on whole customer total in preliminary and scheduled quotes',async()=>{
 const f=fixture();
 f.modules['./partners'].list=async()=>[
  {id:'expensive',status:'ACTIVE',phone:'test',address_line1:'Test',lat:1,lng:1,wholesale_per_lb_cents:100},
  {id:'cheaper',status:'ACTIVE',phone:null,address_line1:'Test',lat:1,lng:1,wholesale_per_lb_cents:72},
  {id:'inactive',status:'INACTIVE',phone:null,address_line1:'Test',lat:1,lng:1,wholesale_per_lb_cents:1}
 ];
 for(const addressEstimate of [true,false]) {
  const q=await f.service.previewQuote({lat:0,lng:0},{pickup_date:'2030-01-01',pickup_time:'12:00'},{publicPreview:true,addressEstimate});
  assert.equal(q.snapshot.partnerId,'cheaper');assert.equal(q.snapshot.comparisons.length,2);assert.equal(f.writes(),0);
 }
});
test('scheduled comparison excludes closed drop-off or return days, regardless of phone',async()=>{
 const f=fixture();
 f.modules['./partners'].list=async()=>['drop-closed','return-closed','open'].map((id,i)=>({id,status:'ACTIVE',phone:null,address_line1:'Test',lat:1,lng:1,wholesale_per_lb_cents:70+i*10}));
 f.modules['./partners'].hoursForAll=async()=>new Map(['drop-closed','return-closed','open'].map(id=>[id,id]));
 f.modules['./partners'].isOpenAt=(rows)=>rows!=='drop-closed';
 f.modules['./partners'].canCollectOn=(rows)=>rows!=='return-closed';
 const q=await f.service.previewQuote({lat:0,lng:0},{pickup_date:'2030-01-01',pickup_time:'12:00'},{publicPreview:true});
 assert.equal(q.snapshot.partnerId,'open');assert.equal(q.snapshot.comparisons.length,1);
});

test('next-day return keeps the cheapest shop when work finishes after closing on drop-off day',async()=>{
 const f=fixture();
 f.modules['./partners'].list=async()=>[
  {id:'fold',status:'ACTIVE',address_line1:'Test',lat:1,lng:1,wholesale_per_lb_cents:95,turnaround_minutes:840},
  {id:'other',status:'ACTIVE',address_line1:'Test',lat:1,lng:1,wholesale_per_lb_cents:100,turnaround_minutes:1440}
 ];
 f.modules['./partners'].canCollectOn=(_rows,day,ready)=>day===3 && ready<21*60;
 const form={pickup_date:'2030-01-01',pickup_time:'08:00'};
 const before=await f.service.previewQuote({lat:0,lng:0},form,{publicPreview:true,addressEstimate:true});
 const scheduled=await f.service.previewQuote({lat:0,lng:0},form,{publicPreview:true});
 assert.equal(scheduled.snapshot.partnerId,'fold');
 assert.equal(scheduled.snapshot.rateCentsPerLb,before.snapshot.rateCentsPerLb);
});
test('next-day return rejects a shop closed tomorrow even if work is ready today',async()=>{
 const f=fixture();
 f.modules['./partners'].canCollectOn=(_rows,day)=>day===2;
 await assert.rejects(f.service.previewQuote({lat:0,lng:0},{pickup_date:'2030-01-01',pickup_time:'08:00'},{publicPreview:true}),/No eligible laundromat/);
});
test('next-day return rejects laundry that is not ready before tomorrow closes',async()=>{
 const f=fixture();
 f.modules['./partners'].list=async()=>[{id:'slow',status:'ACTIVE',address_line1:'Test',lat:1,lng:1,wholesale_per_lb_cents:95,turnaround_minutes:2880}];
 f.modules['./partners'].canCollectOn=(_rows,_day,ready)=>ready<21*60;
 await assert.rejects(f.service.previewQuote({lat:0,lng:0},{pickup_date:'2030-01-01',pickup_time:'08:00'},{publicPreview:true}),/No eligible laundromat/);
});
