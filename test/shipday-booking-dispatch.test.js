'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createBookingDispatcher,assignmentState}=require('../src/core/shipday-booking-dispatch');
const {card,label}=require('../src/web/pickup-dispatch');
const trip={externalId:'LYNDRY-DEV-9016-PICKUP',from:{line1:'1 Home St',city:'Fair Lawn',state:'NJ',postalCode:'07410'},to:{line1:'2 Shop St',city:'Paterson',state:'NJ',postalCode:'07514'},pickupReadyAt:'2026-09-28T20:00:00.000Z',dropoffDeadlineAt:'2026-09-28T21:00:00.000Z'};
const inhouse={mode:'IN_HOUSE',driverId:'77',acceptCancellationFee:true};

test('manual in-house arrival remains usable when travel estimates are unavailable',async()=>{
 const f=fixture({quoteError:true});await f.run('p',{...inhouse,arrivalLocal:'2026-09-28T16:25'});
 assert.equal(f.row().state,'ASSIGNED');assert.equal(f.calls.filter(c=>c[0]==='inhouse').length,1);
});

test('in-house arrival uses estimated travel plus loading and missing estimates require manual arrival',async()=>{
 const f=fixture({arrival:'2026-09-28T20:15:00.000Z'});await f.run('p',inhouse);
 assert.equal(f.row().trip_snapshot.dropoffDeadlineAt,'2026-09-28T20:25:00.000Z');
 const g=fixture({quoteError:true});const result=await g.run('p',inhouse);
 assert.match(result.reason,/Enter the expected laundromat arrival/);assert.equal(g.calls.length,0);
 const invalid=fixture();await invalid.run('p',{...inhouse,arrivalLocal:'2026-09-28T15:59'});assert.equal(invalid.calls.length,0);
});

test('failed manual availability checks identify the step without promising an automatic retry',async()=>{
 const f=fixture({quoteError:true});const result=await f.run('p',{mode:'THIRD_PARTY'});
 assert.match(result.reason,/Uber\/DoorDash availability check \(HTTP 503\)/);
 assert.match(result.reason,/Try Assign again/);assert.equal(f.calls.length,0);
});

test('manual arrival cannot bypass shop hours and third-party cannot use the override',async()=>{
 const f=fixture({acceptEstimate:()=>false});
 const denied=await f.run('p',{...inhouse,arrivalLocal:'2026-09-28T16:25'});
 assert.match(denied.reason,/turnaround and next-day/);assert.equal(f.calls.length,0);
 const g=fixture();await g.run('p',{mode:'THIRD_PARTY',arrivalLocal:'2026-09-28T16:25'});assert.equal(g.calls.length,0);
 const h=fixture({quoteError:true});await h.run('p',{...inhouse,arrivalLocal:'2026-09-28T16:25'});
 assert.ok(h.row().history.some(e=>e.event==='PICKUP_PREPARED_MANUAL_ARRIVAL'));
});
test('manual in-house selection creates once and only confirms the driver after Shipday readback',async()=>{
 const f=fixture();await f.run('p',inhouse,'staff:admin');assert.equal(f.row().state,'ASSIGNED');assert.equal(f.row().assigned_name,'LYNDRY');
 await f.run('p',inhouse);f.advance();await f.run('p');assert.equal(f.calls.filter(c=>c[0]==='inhouse').length,1);assert.equal(f.calls.filter(c=>c[0]==='assign').length,0);
 assert.ok(f.row().history.some(h=>h.actor==='staff:admin'));
});
test('pending in-house confirmation cannot dispatch a second driver',async()=>{
 const f=fixture({unconfirmed:true});await f.run('p',inhouse);assert.equal(f.row().state,'REQUESTED');assert.equal(f.row().assigned_name,null);
 await f.run('p',inhouse);assert.equal(f.row().state,'REVIEW');assert.equal(f.calls.filter(c=>c[0]==='inhouse').length,1);
});
test('third-party replacement requires consent and confirmed cancellation before in-house assignment',async()=>{
 const f=fixture();await f.run('p');await f.run('p',{...inhouse,acceptCancellationFee:false});assert.equal(f.calls.filter(c=>c[0]==='cancel').length,0);
 await f.run('p',inhouse);assert.equal(f.row().state,'ASSIGNED');assert.equal(f.row().assigned_name,'LYNDRY');
 assert.ok(f.calls.findIndex(c=>c[0]==='cancel')<f.calls.findIndex(c=>c[0]==='inhouse'));
});
test('uncertain cancellation or assignment pauses further attempts',async()=>{
 const f=fixture({cancelTimeout:true});await f.run('p');await f.run('p',inhouse);assert.equal(f.row().state,'REVIEW');assert.equal(f.calls.filter(c=>c[0]==='inhouse').length,0);
 const g=fixture({inhouseTimeout:true});await g.run('p',inhouse);await g.run('p',inhouse);assert.equal(g.row().state,'REVIEW');assert.equal(g.calls.filter(c=>c[0]==='inhouse').length,1);
});
test('offline drivers, missing payment, foreign IDs and picked-up orders cannot be manually assigned',async()=>{
 for(const options of [{offline:true},{block:true}]){const f=fixture(options);await f.run('p',inhouse);assert.equal(f.calls.length,0);}
 const invalid=fixture();await invalid.run('p',{...inhouse,driverId:'pos-user-uuid'});assert.equal(invalid.calls.length,0);
 const f=fixture();await f.run('p');f.options.remote={orderStatus:{orderState:'PICKED_UP'}};await f.run('p',inhouse);assert.equal(f.row().state,'REVIEW');assert.equal(f.calls.filter(c=>c[0]==='cancel').length,0);
});
test('authoritative failure overrides stale courier details and clears the old driver',async()=>{
 const f=fixture();await f.run('p');f.advance();await f.run('p');f.options.remote={orderStatus:{orderState:'FAILED_DELIVERY'},assignedCarrier:null};f.options.statusError=true;f.advance();await f.run('p');
 assert.equal(f.row().state,'REVIEW');assert.equal(f.row().assigned_name,null);assert.match(f.row().problem,/Pickup failed/);assert.equal(f.calls.filter(c=>c[0]==='assign').length,1);
});
test('pickup controls use Shipday drivers, preserve permissions and disclose real requests',()=>{
 const plan={booking_dispatch:true,state:'PLANNED',mode:'THIRD_PARTY'};
 const options={order:{order_number:9017},drivers:[{id:'77',name:'LYNDRY',isActive:true,isOnShift:true}],canAssign:true,enabled:true};
 const html=card(plan,options);assert.match(html,/dispatch-pickup/);assert.match(html,/LYNDRY/);assert.match(html,/Automatic third-party assignment/);assert.match(html,/real driver/);
 assert.doesNotMatch(card(plan,{...options,canAssign:false}),/<form/);assert.match(card(plan,{...options,enabled:false}),/disabled>Assign/);
 const missing=card(null,options);assert.match(missing,/Awaiting dispatch/);assert.match(missing,/LYNDRY/);assert.match(missing,/dispatch-pickup/);assert.doesNotMatch(missing,/disabled>Assign|Status unavailable|View Shipday assignment/);
});
function fixture(options={}) {
  let time=Date.parse('2026-09-28T19:00:00Z'),row={id:'p',order_id:'o',booking_dispatch:true,simulation:false,leg:'TO_PARTNER',mode:'THIRD_PARTY',state:'PLANNED',version:0,history:[],dispatch_at:trip.pickupReadyAt,...options.row},checks=0;
  const calls=[];
  let remote=null;
  const store={get:async()=>structuredClone(row),claim:async old=>{if(old.version!==row.version||old.state!==row.state)return null;row={...row,state:'PROCESSING',version:row.version+1};return structuredClone(row);},save:async(old,patch,event)=>{if(old.version!==row.version)throw Error('Conflict');row={...row,...patch,version:row.version+1,history:[...row.history,event]};return structuredClone(row);}};
  const provider={findOrders:async()=>options.existing?[{}]:remote?[{...remote,...options.remote}]:[],
    drivers:async()=>[{id:'77',name:'LYNDRY',isActive:true,isOnShift:!options.offline}],
    assignDriver:async()=>{calls.push(['inhouse']);if(options.inhouseTimeout)throw Error('timeout');if(!options.unconfirmed)remote.assignedCarrier={id:77,name:'LYNDRY'};return {ok:true};},
    cancel:async()=>{calls.push(['cancel']);if(options.cancelTimeout)throw Error('timeout');options.status={status:'canceled'};remote.assignedCarrier=null;return {ok:true};},
    unassign:async()=>{calls.push(['unassign']);remote.assignedCarrier=null;return {ok:true};},
    quote:async()=>{if(options.quoteError)throw Error('Shipday request failed (HTTP 503).');return {ok:true,options:options.noOffer?[]:[{service:'DoorDash',feeCents:750,pickupTime:trip.pickupReadyAt,deliveryTime:options.arrival||trip.dropoffDeadlineAt}]};},
    createOrder:async received=>{calls.push(['create',received]);remote={orderId:123,orderNumber:trip.externalId,restaurant:{address:'1 Home St, Fair Lawn, NJ, 07410'},customer:{address:'2 Shop St, Paterson, NJ, 07514'},activityLog:{expectedDeliveryDate:received.dropoffDeadlineAt.slice(0,10),expectedPickupTime:'20:00:00',expectedDeliveryTime:received.dropoffDeadlineAt.slice(11,19)},orderStatus:{orderState:'NOT_ASSIGNED'}};if(options.autoAssigned)remote.thirdPartyAssignedAnytime=true;if(options.createTimeout)throw Error('timeout');return {id:'123'};},
    assign:async(id,args)=>{calls.push(['estimate',id]);if(options.priceRefused)return {ok:false};if(options.estimateError)throw Error('quote unavailable');await args.beforeAssign();calls.push(['assign',id,args]);if(options.assignTimeout)throw Error('timeout');return {ok:true,status:'REQUESTED'};},
    status:async()=>{calls.push(['status']);if(options.statusError)throw Error('unavailable');return options.status||{status:'STARTED',courier:{name:'Alex'},trackingUrl:'https://example.com/track'};}};
  const validate=async plan=>{checks++;return options.block || (options.changedAt&&checks>=options.changedAt)?{ok:false,reason:'Card or order no longer eligible'}:{ok:true,canAssign:options.canAssign!==false,trip:{...structuredClone(trip),dropoffDeadlineAt:plan.trip_snapshot?.dropoffDeadlineAt||trip.dropoffDeadlineAt},budgetCents:750,inHouseArrivalAt:options.inHouseArrivalAt,acceptEstimate:options.acceptEstimate};};
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

test('configured LYNDRY arrival does not depend on third party quotes',async()=>{
 const f=fixture({quoteError:true,inHouseArrivalAt:'2026-09-28T20:25:00Z'});await f.run('p',inhouse);assert.equal(f.row().state,'ASSIGNED');assert.equal(f.row().trip_snapshot.dropoffDeadlineAt,'2026-09-28T20:25:00Z');assert.equal(f.calls.filter(call=>call[0]==='assign').length,0);
});
