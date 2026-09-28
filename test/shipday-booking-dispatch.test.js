'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createBookingDispatcher,assignmentState}=require('../src/core/shipday-booking-dispatch');
const {card,label}=require('../src/web/pickup-dispatch');
const trip={externalId:'LYNDRY-DEV-9016-PICKUP',from:{line1:'1 Home St',city:'Fair Lawn',state:'NJ',postalCode:'07410'},to:{line1:'2 Shop St',city:'Paterson',state:'NJ',postalCode:'07514'},pickupReadyAt:'2026-09-28T20:00:00.000Z',dropoffDeadlineAt:'2026-09-28T21:00:00.000Z'};
function fixture(options={}) {
  let time=Date.parse('2026-09-28T19:00:00Z'),row={id:'p',order_id:'o',booking_dispatch:true,simulation:false,leg:'TO_PARTNER',mode:'THIRD_PARTY',state:'PLANNED',version:0,history:[],dispatch_at:trip.pickupReadyAt,...options.row},checks=0;
  const calls=[];
  let remote=null;
  const store={get:async()=>structuredClone(row),claim:async old=>{if(old.version!==row.version||old.state!==row.state)return null;row={...row,state:'PROCESSING',version:row.version+1};return structuredClone(row);},save:async(old,patch,event)=>{if(old.version!==row.version)throw Error('Conflict');row={...row,...patch,version:row.version+1,history:[...row.history,event]};return structuredClone(row);}};
  const provider={findOrders:async()=>options.existing?[{}]:remote?[remote]:[],
    quote:async()=>({ok:true,options:options.noOffer?[]:[{service:'DoorDash',feeCents:750,pickupTime:trip.pickupReadyAt,deliveryTime:options.arrival||trip.dropoffDeadlineAt}]}),
    createOrder:async received=>{calls.push(['create',received]);remote={orderId:123,orderNumber:trip.externalId,restaurant:{address:'1 Home St, Fair Lawn, NJ, 07410'},customer:{address:'2 Shop St, Paterson, NJ, 07514'},activityLog:{expectedDeliveryDate:received.dropoffDeadlineAt.slice(0,10),expectedPickupTime:'20:00:00',expectedDeliveryTime:received.dropoffDeadlineAt.slice(11,19)},orderStatus:{orderState:'NOT_ASSIGNED'}};if(options.autoAssigned)remote.thirdPartyAssignedAnytime=true;if(options.createTimeout)throw Error('timeout');return {id:'123'};},
    assign:async(id,args)=>{calls.push(['estimate',id]);if(options.priceRefused)return {ok:false};if(options.estimateError)throw Error('quote unavailable');await args.beforeAssign();calls.push(['assign',id,args]);if(options.assignTimeout)throw Error('timeout');return {ok:true,status:'REQUESTED'};},
    status:async()=>{calls.push(['status']);if(options.statusError)throw Error('unavailable');return options.status||{status:'STARTED',courier:{name:'Alex'},trackingUrl:'https://example.com/track'};}};
  const validate=async plan=>{checks++;return options.block || (options.changedAt&&checks>=options.changedAt)?{ok:false,reason:'Card or order no longer eligible'}:{ok:true,canAssign:options.canAssign!==false,trip:{...structuredClone(trip),dropoffDeadlineAt:plan.trip_snapshot?.dropoffDeadlineAt||trip.dropoffDeadlineAt},budgetCents:750};};
  const dispatcher=createBookingDispatcher({store,provider,validate,now:()=>time});
  return {...dispatcher,row:()=>row,calls,advance:()=>{time+=61000;},patch:patch=>{row={...row,...patch};},options};
}
test('booking requests the scheduled job an hour before pickup; request is not an assigned driver',async()=>{
 const f=fixture();assert.equal((await f.run('p')).state,'REQUESTED');
 assert.equal(f.calls[0][1].pickupReadyAt,trip.pickupReadyAt);assert.equal(f.row().shipday_order_id,'123');assert.equal(f.row().assigned_name,null);
 const request=f.calls.find(c=>c[0]==='assign')[2];assert.equal(request.requirePin,false);assert.equal(request.maxFeeCents,750);
});
test('concurrent booking/recovery ticks create and request only once, then poll for driver assignment',async()=>{
 const f=fixture();await Promise.all([f.run('p'),f.run('p')]);f.advance();await f.run('p');f.advance();await f.run('p');
 assert.equal(f.calls.filter(c=>c[0]==='create').length,1);assert.equal(f.calls.filter(c=>c[0]==='assign').length,1);assert.equal(f.row().state,'ASSIGNED');assert.equal(f.row().assigned_name,'Alex');
});
test('scheduled arrival comes from the confirmed courier estimate; no offer creates no job',async()=>{
 const arrival='2026-09-28T20:17:00.000Z';const f=fixture({arrival});await f.run('p');assert.equal(f.calls[0][1].dropoffDeadlineAt,arrival);assert.equal(f.row().state,'REQUESTED');
 const unavailable=fixture({noOffer:true});await unavailable.run('p');assert.equal(unavailable.calls.length,0);assert.equal(unavailable.row().state,'BLOCKED');
});
test('missing/refused card stops both creation and assignment; changes are rechecked immediately before writes',async()=>{
 for(const changedAt of [1,2,3,4]){const f=fixture({changedAt});await f.run('p');assert.equal(f.calls.filter(c=>c[0]==='assign').length,0);if(changedAt<=2)assert.equal(f.calls.length,0);}
});
test('far-out booking can schedule the job but waits for existing payment authorization timing',async()=>{
 const f=fixture({canAssign:false});await f.run('p');assert.equal(f.row().state,'BLOCKED');assert.equal(f.calls.length,1);
 f.options.canAssign=true;f.advance();await f.run('p');assert.equal(f.calls.filter(c=>c[0]==='create').length,1);assert.equal(f.row().state,'REQUESTED');
});
test('confirmed budget refusal retries the same remote ID, never creates another job',async()=>{
 const f=fixture({priceRefused:true});await f.run('p');f.options.priceRefused=false;f.advance();await f.run('p');
 assert.equal(f.calls.filter(c=>c[0]==='create').length,1);assert.equal(f.row().state,'REQUESTED');
});
test('database JSON key order does not change trip identity on retry',async()=>{
 const f=fixture({priceRefused:true});await f.run('p');
 f.patch({trip_snapshot:Object.fromEntries(Object.entries(f.row().trip_snapshot).reverse())});f.options.priceRefused=false;f.advance();await f.run('p');
 assert.equal(f.row().state,'REQUESTED');assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
});
test('creation and assignment timeouts require review and are never replayed',async()=>{
 for(const setting of ['createTimeout','assignTimeout']){const f=fixture({[setting]:true});await f.run('p');const count=f.calls.length;f.advance();await f.run('p');assert.equal(f.row().state,'REVIEW');assert.equal(f.calls.length,count);}
});
test('existing reference or account-side courier assignment never triggers a second request',async()=>{
 const duplicate=fixture({existing:true});await duplicate.run('p');assert.equal(duplicate.row().state,'REVIEW');assert.equal(duplicate.calls.length,0);
 const auto=fixture({autoAssigned:true});await auto.run('p');assert.equal(auto.row().state,'ASSIGNED');assert.equal(auto.calls.filter(c=>c[0]==='assign').length,0);
});
test('status outage retains accepted request and does not retry assignment',async()=>{
 const f=fixture({statusError:true});await f.run('p');f.advance();await f.run('p');assert.equal(f.row().state,'REQUESTED');assert.match(f.row().problem,/unavailable/);assert.equal(f.calls.filter(c=>c[0]==='assign').length,1);
});
test('simulation, other legs, manual overrides and interrupted attempts cannot request real couriers',async()=>{
 for(const row of [{simulation:true},{booking_dispatch:false},{leg:'TO_CUSTOMER'},{mode:'IN_HOUSE'},{state:'PROCESSING'},{state:'REVIEW'}]){const f=fixture({row});await f.run('p');assert.equal(f.calls.length,0);}
});
test('unknown/failed status requires review; accepted request is not assignment even with a provisional name',()=>{
 assert.equal(assignmentState({status:'FAILED'}),'REVIEW');assert.equal(assignmentState({status:'REQUESTED',courier:{name:'Provisional'}}),'REQUESTED');
 assert.equal(assignmentState({status:'STARTED'}),'REQUESTED');assert.equal(assignmentState({status:'STARTED',courier:{name:'Alex'}}),'ASSIGNED');
 assert.equal(assignmentState({status:'delivered'}),'COMPLETED');assert.equal(assignmentState({status:'canceled'}),'CANCELED');
});
test('POS exposes awaiting/assigned/blocked statuses without falsely naming the courier as a driver',()=>{
 assert.equal(label({state:'REQUESTED'}),'Awaiting driver');assert.equal(label({state:'ASSIGNED'}),'Driver assigned');
 const html=card({state:'BLOCKED',dispatch_at:trip.pickupReadyAt,problem:'Card <required>'});assert.match(html,/4:00 PM/);assert.match(html,/Card &lt;required&gt;/);
});
