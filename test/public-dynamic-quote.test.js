'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const economics=require('../src/core/pricing-economics'),dynamic=require('../src/core/dynamic-order-pricing'),view=require('../src/web/quote-result');
const policy={marginBps:{ONE_TIME:2000,SUBSCRIPTION:1000,WHOLESALE:500},processingBps:290,processingFixedCents:30,operationalFeeBps:2500,referenceWeightLb:33};
function fixture(now=null){
 let writes=0;
 const shipdayClient={quote:async({pickupReadyAt='2030-01-01T17:00:00Z'}={})=>({ok:true,expiresAt:'2030-01-01T00:05:00.000Z',options:[
  {service:'Uber',feeCents:674,pickupTime:pickupReadyAt,deliveryTime:new Date(Date.parse(pickupReadyAt)+15*60000).toISOString()},{service:'DoorDash',feeCents:750,pickupTime:pickupReadyAt,deliveryTime:new Date(Date.parse(pickupReadyAt)+15*60000).toISOString()}
 ]})};
 const chain={select(){return this;},lte(){return this;},order(){return this;},limit(){return {data:[{id:'policy',policy}]};}};
 const modules={
  '../db':{from(table){if(table==='dev_pricing_policies')return chain;if(table==='dev_order_quotes')return {insert(q){writes++;return {select(){return {single(){return {data:q};}};}};}};throw Error('Unexpected table '+table);}},
  '../config':{config:{env:'development',supabase:{isProduction:false,isDevelopment:true},shipday:{apiKey:'test'},routing:{wagePerHour:20,gasPerGallon:3.4,milesPerGallon:22,wearPerMile:0.18,milesPerHour:24,roadFactor:1.3,minutesPerPickup:4,minutesPerDelivery:4,minutesPerPartnerVisit:10}}},
  '../providers/couriers/shipday':{createClient:()=>shipdayClient},
  './public-courier-availability':require('../src/core/public-courier-availability'),
  './in-house-quote':require('../src/core/in-house-quote'),
  './weight-based-pricing':require('../src/core/weight-based-pricing'),
  './pricing-economics':economics,'./dynamic-order-pricing':dynamic,
  './shipday-dispatch':require('../src/core/shipday-dispatch'),
  './pickup-timing':require('../src/core/pickup-timing'),
  './booking':{normaliseTime:x=>x,dateProblem:()=>null,timeProblem:()=>null,checkSlot:async()=>({ok:true})},
  './booking-intents':{firstDateFor:f=>f.pickup_date},
  './geocode':{addressLine:()=> 'Current address',lookupOnce:async()=>({lat:0,lng:0}),locate:async()=>({lat:0,lng:0}),milesBetween:()=>3},
  './partners':{list:async()=>[{id:'partner',status:'ACTIVE',phone:'test',address_line1:'Test',lat:1,lng:1,wholesale_per_lb_cents:100,turnaround_minutes:60}],hoursForAll:async()=>new Map(),loadByPartner:async()=>new Map(),plannedByPartner:async()=>new Map(),isOpenAt:()=>true,canCollectOn:()=>true,capacityOf:()=>({remaining:100})}
 };
 const context={require:n=>modules[n],module:{exports:{}},structuredClone,...(now?{Date:class extends Date {static now(){return now;}}}:{})};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/core/dev-checkout.js'),'utf8'),context);
 return {service:context.module.exports,writes:()=>writes,modules,shipdayClient};
}
test('wholesale customer receives wholesale quote for either booking plan',async()=>{
 const f=fixture(),customer={id:'customer',pricing_category:'WHOLESALE',address_line1:'Test',city:'Test',postal_code:'07452'};
 for(const plan of ['ONE_TIME','SUBSCRIPTION']) {
  const quote=await f.service.createQuote(customer,{pickup_date:'2030-01-01',pickup_time:'12:00',plan});
  assert.equal(quote.snapshot.category,'WHOLESALE');
  assert.equal(quote.snapshot.policy.marginBps.WHOLESALE,500);
 }
 const standard=await f.service.createQuote({...customer,pricing_category:'ONE_TIME'},{pickup_date:'2030-01-01',pickup_time:'12:00',plan:'SUBSCRIPTION'});
 assert.equal(standard.snapshot.category,'SUBSCRIPTION');
});

test('public preview shares checkout terms and creates no quote or order record',async()=>{
 const f=fixture(),customer={id:'customer',address_line1:'Test',city:'Test',postal_code:'07452'},form={pickup_date:'2030-01-01',pickup_time:'12:00',plan:'ONE_TIME'};
 const preview=await f.service.previewQuote(customer,form,{publicPreview:true});assert.equal(f.writes(),0);
 const bookedQuote=await f.service.createQuote(customer,form);assert.equal(f.writes(),1);
 for(const key of ['rateCentsPerLb','operationalFeeCents','minimumTotalCents','estimated30LbCents','estimated40LbCents'])assert.equal(preview.categories.ONE_TIME[key],bookedQuote.snapshot[key]);
 assert.ok(preview.categories.SUBSCRIPTION.rateCentsPerLb<preview.categories.ONE_TIME.rateCentsPerLb);
});
test('legacy dynamic quote shows fees and minimum without weight estimates',()=>{
 const input={wholesaleCentsPerLb:100,pickupCents:899,returnCents:899,policy};
 const categories=Object.fromEntries(['ONE_TIME','SUBSCRIPTION'].map(category=>[category,economics.preview({...input,category})]));
 const html=view.render({quote:{ok:true,dynamic:true,categories},address:'<Test>'});
 assert.match(html,/Operational fee/);assert.match(html,/Minimum total/);assert.doesNotMatch(html,/Estimated total|30–40 lb/);assert.match(html,/\$4.50/);
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
 assert.ok(q.categories.ONE_TIME.estimated30LbCents>0);assert.equal(q.snapshot.source,'SHIPDAY');assert.ok(q.snapshot.pickupCents>0);assert.equal(f.writes(),0);
 await assert.rejects(f.service.previewQuote({}, {}, {addressEstimate:true}),/cannot be booked/);
});
test('price review shows the minimum and weight limit without a maximum charge',()=>{
 const view=require('../src/web/booking-price');
 const p={rateCentsPerLb:165,operationalFeeCents:450,minimumTotalCents:2214,estimated30LbCents:5400,estimated40LbCents:7050,estimatedReferenceTotalCents:5895,referenceWeightLb:33};
 const html=view.review({id:'test',snapshot:p},'');
 assert.match(html,/50 lb per order/);assert.doesNotMatch(html,/Maximum at|maximum charge|booking-maximum|\$87.00/);assert.doesNotMatch(html,/name="spending_limit"|Set your spending limit|type="checkbox"/);assert.match(html,/name="price_consent" value="yes"/);
 assert.match(view.review({id:'test',snapshot:{...p,minimumTotalCents:10000}},''),/\$100.00/);
 assert.doesNotMatch(view.planEstimate(p),/Estimated total|30–40 lb|\$54.00|\$70.50/);
 assert.match(view.planEstimate(p),/Minimum total: \$22.14/);
});
test('overweight dev order stops before price updates or charges',async()=>{
 const f=fixture();await assert.rejects(f.service.evaluateWeight({},50.01),/limited to 50 lb/);assert.equal(f.writes(),0);
});

test('public and booking prices match when the eligible shops and courier fees match',async()=>{
 const f=fixture();
 f.modules['./partners'].list=async()=>[
  {id:'expensive',status:'ACTIVE',phone:'test',address_line1:'Test',lat:1,lng:1,wholesale_per_lb_cents:100},
  {id:'cheaper',status:'ACTIVE',phone:null,address_line1:'Test',lat:2,lng:1,wholesale_per_lb_cents:72},
  {id:'inactive',status:'INACTIVE',phone:null,address_line1:'Test',lat:1,lng:1,wholesale_per_lb_cents:1}
 ];
 f.modules['./geocode'].milesBetween=(_home,shop)=>shop.lat;
 let publicQuote;
 for(const addressEstimate of [true,false]) {
  const q=await f.service.previewQuote({lat:0,lng:0},{pickup_date:'2030-01-01',pickup_time:'12:00'},{publicPreview:true,addressEstimate});
  assert.equal(q.snapshot.partnerId,'cheaper');assert.equal(q.snapshot.comparisons.length,2);assert.equal(f.writes(),0);
  assert.equal(q.snapshot.selectionMethod,'LOWEST_ESTIMATED_TOTAL_V1');
  if(addressEstimate)publicQuote=q;
  else for(const category of ['ONE_TIME','SUBSCRIPTION','WHOLESALE']){
   assert.equal(q.categories[category].partnerId,publicQuote.categories[category].partnerId);
   assert.equal(q.categories[category].estimatedReferenceTotalCents,publicQuote.categories[category].estimatedReferenceTotalCents);
   assert.equal(q.categories[category].minimumTotalCents,publicQuote.categories[category].minimumTotalCents);
  }
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


test('scheduled quotes use actual partner hours, including breaks, closing and next-day closure',async()=>{
 const f=fixture(), real=require('../src/core/partners');
 f.modules['./partners'].isOpenAt=real.isOpenAt;
 f.modules['./partners'].canCollectOn=real.canCollectOn;
 const row=(weekday,opens_at,closes_at)=>({weekday,opens_at,closes_at});
 let hours=[row(2,'09:00','12:00'),row(2,'13:00','19:00'),row(3,'09:00','19:00')];
 f.modules['./partners'].hoursForAll=async()=>new Map([['partner',hours]]);
 const preview=time=>f.service.previewQuote({lat:0,lng:0},{pickup_date:'2030-01-01',pickup_time:time},{publicPreview:true});
 assert.equal((await preview('18:00')).snapshot.partnerId,'partner');
 for(const time of ['08:59','12:00','12:30','19:00','19:01']) await assert.rejects(preview(time),/No eligible laundromat/);
 hours=[row(2,'09:00','18:00'),row(3,'09:00','19:00')];
 await assert.rejects(preview('19:00'),/No eligible laundromat/);
 hours=[row(2,'09:00','19:00')];
 await assert.rejects(preview('18:00'),/No eligible laundromat/);
 hours=[row(2,'09:00','19:00'),row(3,null,'19:00')];
 await assert.rejects(preview('18:00'),/No eligible laundromat/);
});

test('final booking rechecks the quoted shop after its hours change',async()=>{
 const f=fixture(),real=require('../src/core/partners');
 f.modules['./partners'].isOpenAt=real.isOpenAt;
 f.modules['./partners'].canCollectOn=real.canCollectOn;
 const shop={id:'partner',status:'ACTIVE',type:'LAUNDROMAT',turnaround_minutes:60};
 f.modules['./partners'].find=async()=>shop;
 let rows=[{weekday:2,opens_at:'09:00',closes_at:'19:00'},{weekday:3,opens_at:'09:00',closes_at:'19:00'}];
 f.modules['./partners'].hoursForAll=async()=>new Map([['partner',rows]]);
 const quote={approved_at:'2029-12-31',expires_at:'2030-01-01T00:05:00Z',pickup_date:'2030-01-01',pickup_time:'18:00',address:{address_line1:null,address_line2:null,city:null,postal_code:null},snapshot:{source:'SHIPDAY',pickupCents:674,returnCents:674,partnerId:'partner'}};
 f.modules['../db'].from=()=>{const q={select(){return q;},eq(){return q;},single:async()=>({data:quote})};return q;};
 const validate=()=>f.service.validateQuote('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',{id:'customer'},'2030-01-01','18:00');
 assert.equal(await validate(),quote);
 rows=rows.filter(r=>r.weekday===2);
 await assert.rejects(validate(),/no longer available/);
 rows=[{weekday:2,opens_at:'09:00',closes_at:'18:00'},{weekday:3,opens_at:'09:00',closes_at:'19:00'}];
 await assert.rejects(validate(),/no longer available/);
 assert.equal(f.writes(),0);
});

function availableShops(f) {
 f.modules['./partners'].list=async()=>[
  {id:'near',status:'ACTIVE',address_line1:'Near',lat:1,lng:1,wholesale_per_lb_cents:150,turnaround_minutes:1440},
  {id:'far',status:'ACTIVE',address_line1:'Far',lat:2,lng:1,wholesale_per_lb_cents:70,turnaround_minutes:720}
 ];
 f.modules['./geocode'].milesBetween=(_home,shop)=>shop.lat;
 f.modules['./partners'].hoursForAll=async()=>new Map([['near','near'],['far','far']]);
}
const scheduledForm={pickup_date:'2030-01-01',pickup_time:'13:42'};
test('continuing a resolved pickup preserves its timestamp after preparation time starts',async()=>{
 const f=fixture(Date.parse('2026-10-02T18:00:01Z'));
 const q=await f.service.previewQuote({}, {pickup_mode:'EARLIEST',pickup_date:'2026-10-02',pickup_time:'14:15'}, {publicPreview:true,resolvedPickup:true});
 assert.equal(q.snapshot.pickupReadyAt,'2026-10-02T18:15:00.000Z');
});
test('an unavailable pickup time does not claim the address is outside coverage',()=>{
 const html=view.render({quote:null,error:'unavailable_time',address:'Test address'});
 assert.match(html,/Pickup time unavailable/);
 assert.doesNotMatch(html,/Not in your area|not operating in your area|quote\/interest/);
});
test('scheduled quote independently selects the available shop after the cheapest preliminary estimate',async()=>{
 const f=fixture();availableShops(f);
 f.modules['./partners'].isOpenAt=rows=>rows!=='near';
 const before=await f.service.previewQuote({}, {}, {publicPreview:true,addressEstimate:true});
 const after=await f.service.previewQuote({},scheduledForm,{publicPreview:true});
 assert.equal(before.snapshot.partnerId,'far');assert.equal(after.snapshot.partnerId,'far');
 assert.equal(before.snapshot.rateCentsPerLb,after.snapshot.rateCentsPerLb);assert.equal(f.writes(),0);
});
test('customer pricing fails closed when third-party quotes are unavailable',async()=>{
 const f=fixture();availableShops(f);let calls=0;
 f.shipdayClient.quote=async()=>{calls++;throw Error('No courier');};
 await assert.rejects(f.service.previewQuote({},scheduledForm,{publicPreview:true}),/delivery.*unavailable/i);assert.ok(calls>0);
});

test('every customer tier uses separate API pickup and return fees even with an in-house driver',async()=>{
 const f=fixture();let calls=0;const original=f.shipdayClient.quote;
 f.shipdayClient.quote=async args=>{const q=await original(args);const fee=++calls%2?649:825;return {...q,options:q.options.map(o=>({...o,feeCents:fee}))};};
 const q=await f.service.previewQuote({},scheduledForm,{publicPreview:true});
 assert.equal(calls,2);
 for(const s of Object.values(q.categories)){assert.equal(s.source,'SHIPDAY');assert.equal(s.pickupCents,649);assert.equal(s.returnCents,825);assert.equal(s.transportMode,'IN_HOUSE');assert.equal(s.costBasis,'THIRD_PARTY_API_ESTIMATE');}
});
test('hours-valid arrival failure is reported accurately and other shops still compete',async()=>{
 const f=fixture();availableShops(f);
 f.modules['./partners'].isOpenAt=(rows,_day,time)=>rows!=='near'||time<'13:50';
 const q=await f.service.previewQuote({},scheduledForm,{publicPreview:true});assert.equal(q.snapshot.partnerId,'far');
 f.modules['./partners'].isOpenAt=(_rows,_day,time)=>time<'13:50';
 await assert.rejects(f.service.previewQuote({},scheduledForm,{publicPreview:true}),/arrival.*opening hours/i);
});

test('Friday 1342 pickup passes actual shop hours despite a closed competing shop',async()=>{
 const f=fixture(Date.parse('2026-10-02T12:00:00Z'));availableShops(f);const real=require('../src/core/partners');
 f.modules['./partners'].isOpenAt=real.isOpenAt;f.modules['./partners'].canCollectOn=real.canCollectOn;
 f.modules['./partners'].hoursForAll=async()=>new Map([['near',[{weekday:5,opens_at:'07:30',closes_at:'19:00'},{weekday:6,opens_at:'07:30',closes_at:'19:00'}]],['far',[]]]);
 const q=await f.service.previewQuote({}, {pickup_date:'2026-10-02',pickup_time:'13:42'}, {publicPreview:true});assert.equal(q.snapshot.partnerId,'near');
});
test('a nearest shop without valid pricing does not block a farther usable shop',async()=>{
 const f=fixture();availableShops(f);const list=f.modules['./partners'].list;
 f.modules['./partners'].list=async()=> (await list()).map(s=>s.id==='near'?{...s,wholesale_per_lb_cents:null}:s);
 const q=await f.service.previewQuote({},scheduledForm,{publicPreview:true});assert.equal(q.snapshot.partnerId,'far');
});

test('preliminary cheapest rate ignores current capacity until a pickup is scheduled',async()=>{
 const f=fixture();availableShops(f);f.modules['./partners'].capacityOf=()=>({remaining:0});
 const q=await f.service.previewQuote({}, {}, {publicPreview:true,addressEstimate:true});assert.equal(q.snapshot.partnerId,'far');
 await assert.rejects(f.service.previewQuote({},scheduledForm,{publicPreview:true}),/No eligible laundromat/);
});

test('earliest pickup resolves forward and an unsafe scheduled time is refused',async()=>{
 const f=fixture(Date.parse('2026-10-02T18:05:59Z'));
 const q=await f.service.previewQuote({}, {pickup_mode:'EARLIEST'}, {publicPreview:true});
 assert.equal(q.pickup_time,'14:30');assert.equal(q.snapshot.pickupReadyAt,'2026-10-02T18:30:00.000Z');
 await assert.rejects(f.service.previewQuote({}, {pickup_date:'2026-10-02',pickup_time:'14:05'}, {publicPreview:true}),/later|ahead/);
});

test('final confirmation preserves saved timing and refuses a pickup too close to now',async()=>{
 for(const [now,allowed] of [['2026-10-02T17:55:00Z',true],['2026-10-02T17:59:59Z',true],['2026-10-02T18:00:01Z',false]]){
 const f=fixture(Date.parse(now));const quote={approved_at:now,expires_at:'2026-10-02T19:10:00Z',pickup_date:'2026-10-02',pickup_time:'14:05',address:{address_line1:null,address_line2:null,city:null,postal_code:null},snapshot:{source:'SHIPDAY',pickupCents:674,returnCents:674,partnerId:'partner'}};
 f.modules['../db'].from=()=>{const q={select(){return q;},eq(){return q;},single:async()=>({data:quote})};return q;};
 f.modules['./partners'].find=async()=>({id:'partner',status:'ACTIVE',type:'LAUNDROMAT'});
 const confirm=()=>f.service.validateQuote('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',{id:'customer'},'2026-10-02','14:05');
 if(allowed)assert.equal(await confirm(),quote);else await assert.rejects(confirm(),/too close/);
 }
});

test('confirmation does not count elapsed checkout time twice near a shop cutoff',async()=>{
 const now='2026-10-02T18:00:00Z',f=fixture(Date.parse(now));
 const quote={approved_at:now,expires_at:'2026-10-02T18:05:00Z',created_at:'2026-10-02T18:05:00Z',pickup_date:'2026-10-02',pickup_time:'14:15',address:{address_line1:null,address_line2:null,city:null,postal_code:null},snapshot:{source:'SHIPDAY',pickupCents:674,returnCents:674,partnerId:'partner',inHouseArrivalMinutes:15,arrivalChecks:['2026-10-02T18:30:00Z']}};
 f.modules['../db'].from=()=>{const q={select(){return q;},eq(){return q;},single:async()=>({data:quote})};return q;};
 f.modules['./partners'].find=async()=>({id:'partner',status:'ACTIVE',type:'LAUNDROMAT'});
 f.modules['./partners'].isOpenAt=(_rows,_day,time)=>time<'14:35';
 assert.equal(await f.service.validateQuote('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',{id:'customer'},'2026-10-02','14:15'),quote);
});

test('booking rechecks API fees, rejects stale in-house quotes, and detects changed addresses',async()=>{
 const f=fixture(Date.parse('2026-10-02T18:00:00Z'));
 const q={approved_at:'2026-10-02T18:00:00Z',expires_at:'2026-10-02T18:05:00Z',pickup_date:'2026-10-02',pickup_time:'14:30',address:{address_line1:'1 Test St',address_line2:null,city:null,postal_code:null},snapshot:{source:'SHIPDAY',partnerId:'partner',pickupCents:674,returnCents:674}};
 f.modules['../db'].from=()=>{const chain={select(){return chain},eq(){return chain},single:async()=>({data:q})};return chain;};
 f.modules['./partners'].find=async()=>({id:'partner',status:'ACTIVE',type:'LAUNDROMAT',address_line1:'2 Shop St'});
 const original=f.shipdayClient.quote,calls=[];
 f.shipdayClient.quote=async args=>{calls.push(args);return original(args);};
 const customer={id:'customer',address_line1:'1 Test St'};
 const validate=()=>f.service.validateQuote('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',customer,'2026-10-02','14:30');
 await validate();assert.equal(calls.length,2);assert.equal(calls[0].from,'1 Test St');assert.equal(calls[0].to,'2 Shop St');assert.equal(calls[1].from,'2 Shop St');
 q.snapshot.pickupCents=935;await assert.rejects(validate(),/prices changed/i);
 q.snapshot.source='IN_HOUSE';await assert.rejects(validate(),/Refresh the delivery quote/);
 q.snapshot.source='SHIPDAY';customer.address_line1='3 New St';await assert.rejects(validate(),/Address changed/);
 customer.address_line1='1 Test St';f.shipdayClient.quote=async()=>{throw Error('offline')};await assert.rejects(validate(),/unavailable/);
});
