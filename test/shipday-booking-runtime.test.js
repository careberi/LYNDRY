'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(options={}) {
 const date='2099-09-28';
 const order={id:'order',order_number:9016,created_at:'2026-09-28T19:30:00Z',dev_quote_id:'quote',status:'REQUESTED',pickup_date:date,pickup_time:'16:00:00',customer_id:'customer',intended_partner_id:'shop',pricing_snapshot:{source:'SHIPDAY',pickupCents:699},customers:{name:'Customer',phone:'+12015550100',default_payment_method_id:'saved',address_line1:'1 Home St',city:'Fair Lawn',state:'NJ',postal_code:'07410'},...options.order};
 const shop={id:'shop',status:'ACTIVE',name:'Laundry',address_line1:'2 Shop St',city:'Paterson',state:'NJ',postal_code:'07514'};
 const settings={enabled:true,automatic_pickups_from:'2026-09-28T19:00:00Z',...options.settings};
 const writes=[];
 const plan={id:'plan',order_id:order.id,booking_dispatch:true,state:'PLANNED',mode:'THIRD_PARTY',dispatch_at:'2099-09-28T20:00:00.000Z'};
 const db={from(table){const q={select(){return q;},eq(){return q;},not(){return q;},single(){return q;},upsert(value){writes.push(value);return q;},then(resolve){return Promise.resolve({data:table==='orders'?order:table==='shipday_dispatch_plans'?plan:[]}).then(resolve);}};return q;}};
 const modules={
  '../db':db,'../config':{config:{env:options.production?'production':'development',supabase:{projectRef:options.projectRef||'psrphpgbiifvnlrgvbdg'},shipday:{}}},
  './shipday-dispatch':require('../src/core/shipday-dispatch'),'./shipday-booking-dispatch':{createBookingDispatcher:({validate})=>({run:async()=>validate({order_id:'order'})})},
  './order-address':require('../src/core/order-address'),
  './pickup-timing':require('../src/core/pickup-timing'),
  './shipday-dispatch-runtime':{result:async q=>(await q).data,settings:async()=>settings,store:{}},
  '../providers/couriers/shipday':{createClient:()=>({})},
  './billing':{holdIsFresh:()=>options.hold!==false,holdDueNow:()=>options.holdDue!==false},
  './dispatch':{heldCustomerIds:async()=>new Set(),collectRefusal:()=>options.refused?{detail:'Payment hold'}:null},
  './partners':{find:async()=>shop,hoursForAll:async()=>new Map(),isOpenAt:(_r,_d,time)=>time<'18:00'},
  './dev-checkout':{scheduleFits:()=>options.hours!==false},
  './courier-legs':{addressOf:(row,other)=>({line1:row.address_line1,city:row.city,state:row.state,postalCode:row.postal_code,...other})},
 };
 const context={require:n=>{if(!(n in modules))throw Error('Unexpected '+n);return modules[n];},module:{exports:{}},console,Date:options.now?class extends Date {static now(){return options.now;}}:Date,Intl,Map};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/core/shipday-booking-runtime'),'utf8'),context);
 return {runtime:context.module.exports,order,settings,writes};
}
test('manual preparation can enroll only the selected eligible order without automatic enrollment',async()=>{
 const f=fixture({settings:{automatic_pickups_from:null}});
 assert.equal(await f.runtime.enqueue(f.order),null);assert.equal(f.writes.length,0);
 assert.equal((await f.runtime.enqueue(f.order,{manual:true})).id,'plan');assert.equal(f.writes.length,1);assert.equal(f.writes[0].order_id,f.order.id);
});
test('manual preparation gives the real eligibility error and creates no plan for an expired pickup or missing card',async()=>{
 for(const options of [{order:{pickup_date:'2020-01-01'}},{order:{customers:{}}}]){
  const f=fixture(options);await assert.rejects(f.runtime.enqueue(f.order,{manual:true}),/pickup time has passed|Save a payment method/);assert.equal(f.writes.length,0);
 }
});
test('manual assignment overrides an automatic pause without resuming automatic dispatch',async()=>{
 const f=fixture({settings:{enabled:false,automatic_pickups_from:null}});
 assert.equal(await f.runtime.enqueue(f.order),null);
 assert.equal((await f.runtime.enqueue(f.order,{manual:true})).id,'plan');
 assert.equal((await f.runtime.run('plan',{mode:'IN_HOUSE',driverId:'77'},'staff:admin')).ok,true);
 assert.equal((await f.runtime.run('plan',{mode:'THIRD_PARTY'},'staff:admin')).ok,true);
 assert.equal((await f.runtime.run('plan')).ok,false);
 assert.equal(f.settings.enabled,false);
});
test('manual pause override preserves card, hold, hours, schedule and environment checks',async()=>{
 for(const options of [{order:{customers:{}}},{hold:false},{hours:false},{order:{pickup_date:'2020-01-01'}},{order:{status:'CANCELED'}},{projectRef:'production-project'}]){
  const f=fixture({...options,settings:{enabled:false}});
  assert.equal((await f.runtime.run('plan',{mode:'IN_HOUSE',driverId:'77'},'staff:admin')).ok,false);
 }
});
test('hosted development permits explicit assignment but never starts an automatic worker',async()=>{
 const f=fixture({production:true});
 assert.equal(f.runtime.enabled,true);
 assert.equal((await f.runtime.enqueue(f.order,{manual:true})).id,'plan');
 assert.equal((await f.runtime.run('plan',{mode:'IN_HOUSE',driverId:'77'},'staff:admin')).ok,true);
 assert.equal((await f.runtime.run('plan',{mode:'THIRD_PARTY'},'staff:admin')).ok,true);
 const count=f.writes.length;
 assert.equal(await f.runtime.enqueue(f.order),null);
 assert.equal((await f.runtime.run('plan')).ok,false);
 await f.runtime.tick();f.runtime.start();assert.equal(f.writes.length,count);
 for(const projectRef of ['production-project','unknown']) {
  const other=fixture({production:true,projectRef});
  assert.equal(other.runtime.enabled,false);
  assert.equal(await other.runtime.enqueue(other.order,{manual:true}),null);
  assert.equal((await other.runtime.run('plan',{mode:'IN_HOUSE',driverId:'77'})).ok,false);
 }
});

test('automatic enrollment is limited to new quoted development bookings after activation',()=>{
 const f=fixture();assert.equal(Boolean(f.runtime.eligible(f.order,f.settings)),true);
 for(const setting of [{enabled:false},{automatic_pickups_from:null},{automatic_pickups_from:'2026-09-28T20:00:00Z'}])assert.equal(Boolean(f.runtime.eligible(f.order,{...f.settings,...setting})),false);
 assert.equal(Boolean(f.runtime.eligible({...f.order,dev_quote_id:null},f.settings)),false);
 const live=fixture({production:true});assert.equal(Boolean(live.runtime.eligible(live.order,live.settings)),false);
});
test('runtime rejects missing card, stale/deferred authorization, payment holds, closed shop and canceled or past pickup',async()=>{
 for(const options of [{order:{customers:{}}},{hold:false},{hold:false,holdDue:false},{refused:true},{hours:false},{order:{status:'CANCELED'}},{order:{pickup_date:'2020-01-01'}},{settings:{enabled:false}}]){
  const f=fixture(options);assert.equal((await f.runtime.validate({order_id:'order'})).ok,false,JSON.stringify(options));
 }
});
test('real pickup uses exact Eastern schedule and saved budget, with photo-only shop instructions',async()=>{
 const f=fixture();const result=await f.runtime.validate({order_id:'order'});
 assert.equal(result.ok,true);assert.equal(result.budgetCents,699);assert.equal(result.trip.pickupReadyAt,'2099-09-28T20:00:00.000Z');
 assert.equal(result.trip.to.phone,'+12017712933');assert.match(result.trip.to.notes,/Photo proof only/);
 assert.equal(result.acceptEstimate({deliveryTime:'2099-09-28T21:00:00Z'}),true);assert.equal(result.acceptEstimate({deliveryTime:'2099-09-28T22:00:00Z'}),false);
 assert.equal(result.acceptEstimate({deliveryTime:'2099-09-29T17:00:00Z'}),false);
 const saved=await f.runtime.validate({order_id:'order',trip_snapshot:{dropoffDeadlineAt:'2099-09-28T20:17:00Z'}});assert.equal(saved.trip.dropoffDeadlineAt,'2099-09-28T20:17:00Z');
});

test('LYNDRY quotes only enroll manually in house and retain payment guards',async()=>{
 const f=fixture({order:{pricing_snapshot:{source:'IN_HOUSE',pickupCents:600,arrivalChecks:['2099-09-28T20:25:00Z']}}});
 assert.equal(await f.runtime.enqueue(f.order),null);assert.equal(f.writes.length,0);
 await f.runtime.enqueue(f.order,{manual:true});assert.equal(f.writes[0].mode,'IN_HOUSE');
 const checked=await f.runtime.validate({order_id:'order',mode:'IN_HOUSE'},{manual:true});assert.equal(checked.ok,true);assert.equal(checked.inHouseArrivalAt,'2099-09-28T20:25:00Z');
 assert.equal((await f.runtime.validate({order_id:'order',mode:'THIRD_PARTY'},{manual:true})).ok,false);
});
test('new pickup timing retains the quoted instant and blocks stale or changed dispatch',async()=>{
 const f=fixture({now:Date.parse('2099-09-28T19:45:00Z')});
 f.order.pricing_snapshot={source:'SHIPDAY',pickupCents:699,timingPolicyVersion:'PICKUP_TIME_V1',pickupReadyAt:'2099-09-28T20:00:00.000Z'};
 let checked=await f.runtime.validate({order_id:'order'});assert.equal(checked.ok,true);assert.equal(checked.trip.pickupReadyAt,f.order.pricing_snapshot.pickupReadyAt);
 f.order.pickup_time='16:15:00';checked=await f.runtime.validate({order_id:'order'});assert.equal(checked.ok,false);assert.match(checked.reason,/changed/);
 const stale=fixture({now:Date.parse('2099-09-28T19:56:00Z')});stale.order.pricing_snapshot=f.order.pricing_snapshot;
 checked=await stale.runtime.validate({order_id:'order'});assert.equal(checked.ok,false);assert.match(checked.reason,/too close/);assert.equal(stale.writes.length,0);
});

test('Shipday pricing does not automatically book a third-party driver for an in-house pickup',async()=>{
 const f=fixture({order:{pricing_snapshot:{source:'SHIPDAY',transportMode:'IN_HOUSE',pickupCents:674,arrivalChecks:['2099-09-28T20:25:00Z']}}});
 assert.equal(await f.runtime.enqueue(f.order),null);assert.equal(f.writes.length,0);
 await f.runtime.enqueue(f.order,{manual:true});assert.equal(f.writes[0].mode,'IN_HOUSE');
});

test('manual in-house pickup accepts checkout grace and advances arrival once',async()=>{
 for(const [minute,ok] of [[10,true],[11,false]]){
 const f=fixture({now:Date.parse('2099-09-28T20:'+minute+':59Z'),order:{pricing_snapshot:{source:'IN_HOUSE',pickupCents:600,inHouseArrivalMinutes:15,arrivalChecks:['2099-09-28T20:20:00Z']}}});
 const result=await f.runtime.validate({order_id:'order',mode:'IN_HOUSE'},{manual:true});assert.equal(result.ok,ok);if(ok)assert.equal(result.inHouseArrivalAt,'2099-09-28T20:25:00.000Z');
 }
});
