'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createObserver,progress}=require('../src/core/pickup-observation');
function fixture(options={}) {
 let row={id:'p',booking_dispatch:true,simulation:false,leg:'TO_PARTNER',mode:'IN_HOUSE',driver_id:'77',state:'REVIEW',problem:'Uncertain request',shipday_order_id:'123',external_reference:'PICKUP',trip_snapshot:{from:{line1:'1 A St'},to:{line1:'2 B St'},pickupReadyAt:'2026-10-03T00:11:00Z',dropoffDeadlineAt:'2026-10-03T00:46:00Z'},...options.plan};
 let remote={orderId:123,orderNumber:'PICKUP',restaurant:{address:'1 A St'},customer:{address:'2 B St'},assignedCarrier:{id:77,name:'LYNDRY'},orderStatus:{orderState:options.status||'PICKED_UP'},activityLog:{expectedDeliveryDate:'2026-10-03',expectedPickupTime:'00:11:00',expectedDeliveryTime:'00:46:00'},...options.remote};
 const writes=[];const observer=createObserver({store:{get:async()=>row,save:async(old,patch)=>{if(options.conflict)throw Error('Assignment changed');writes.push(patch);row={...row,...patch};return row;}},provider:{findOrders:async()=>{if(options.error)throw Error('HTTP 503');return options.duplicate?[remote,remote]:[remote];},status:async()=>options.courier||{status:'pickup_complete',courier:{name:'Courier'}}}});
 return {...observer,row:()=>row,writes};
}
test('review pickup becomes verified picked up using reads only',async()=>{const f=fixture();assert.equal((await f.observe('p')).status,'PICKED_UP');assert.equal(f.row().problem,null);assert.equal(progress(f.row()),'COLLECTED');assert.equal(f.row().shipday_order_id,'123');});
test('progress distinguishes started, picked up and delivered to laundromat',async()=>{for(const status of ['STARTED','PICKED_UP','READY_TO_DELIVER','ALREADY_DELIVERED']){const f=fixture({status});assert.equal((await f.observe('p')).ok,true);assert.equal(f.row().state,status==='ALREADY_DELIVERED'?'COMPLETED':'ASSIGNED');assert.equal(progress(f.row()),status==='STARTED'?null:'COLLECTED');}});
test('mismatch, duplicate, unknown and failed reads never clear review',async()=>{for(const options of [{remote:{orderId:999}},{remote:{restaurant:{address:'Wrong'}}},{remote:{assignedCarrier:{id:88}}},{duplicate:true},{status:'NEW_UNKNOWN'},{error:true}]){const f=fixture(options);assert.equal((await f.observe('p')).ok,false);assert.equal(f.writes.length,0);assert.equal(f.row().state,'REVIEW');}});
test('failure and cancellation override stale picked up driver data',async()=>{for(const status of ['FAILED_DELIVERY','INCOMPLETE','CANCELED']){const f=fixture({status});await f.observe('p');assert.equal(f.row().assigned_name,null);assert.equal(progress(f.row()),null);}});
test('third party collection needs matching courier evidence',async()=>{const f=fixture({plan:{mode:'THIRD_PARTY'},courier:{status:'ASSIGNED'}});assert.equal((await f.observe('p')).ok,false);assert.equal(f.writes.length,0);const g=fixture({plan:{mode:'THIRD_PARTY'}});assert.equal((await g.observe('p')).status,'PICKED_UP');});
test('simulated, processing, unlinked and return jobs cannot be observed',async()=>{for(const plan of [{simulation:true},{state:'PROCESSING'},{shipday_order_id:null},{leg:'TO_CUSTOMER'}]){const f=fixture({plan});assert.equal((await f.observe('p')).ok,false);assert.equal(f.writes.length,0);}});
test('concurrent assignment changes prevent stale observations',async()=>{const f=fixture({conflict:true});await assert.rejects(f.observe('p'),/Assignment changed/);assert.equal(f.writes.length,0);});
test('POS renders picked up and disables reassignment after collection',()=>{const ui=require('../src/web/pickup-dispatch');const p={state:'ASSIGNED',provider_status:'PICKED_UP',shipday_order_id:'123',booking_dispatch:true};assert.equal(ui.label(p),'Picked up · on the way to laundromat');assert.match(ui.card(p,{order:{order_number:1},canAssign:true,enabled:true}),/disabled>Assign/);});

test('paused automatic dispatch still observes linked review jobs without dispatching',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');const observations=[],dispatches=[],queries=[];
 const db={from(table){const q={table,filters:[],select(){return q;},eq(k,v){q.filters.push([k,v]);return q;},not(k,op,v){q.filters.push(['not',k,op,v]);return q;},in(k,v){q.filters.push([k,v]);return q;},lt(){return q;},order(){return q;},limit(){return q;},then(resolve){queries.push(q);return Promise.resolve({data:q.filters.some(f=>f[0]==='state'&&Array.isArray(f[1])&&f[1].includes('REVIEW'))?[{id:'review-job'}]:[]}).then(resolve);}};return q;}};
 const modules={'../db':db,'../config':{config:{env:'development',supabase:{projectRef:'psrphpgbiifvnlrgvbdg'},shipday:{apiKey:'test'}}},'./shipday-dispatch':{dispatchInstant:()=>null},'./shipday-booking-dispatch':{createBookingDispatcher:()=>({run:async id=>dispatches.push(id)})},'./shipday-dispatch-runtime':{result:async q=>(await q).data,settings:async()=>({enabled:false}),store:{}},'../providers/couriers/shipday':{createClient:options=>options},'./pickup-observation':{createObserver:({provider})=>({observe:async id=>{assert.equal(provider.allowWrites,false);observations.push(id);}})}};
 const context={require:n=>{if(!(n in modules))throw Error('Unexpected '+n);return modules[n];},module:{exports:{}},console,Date};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/core/shipday-booking-runtime'),'utf8'),context);
 await context.module.exports.tick();assert.deepEqual(observations,['review-job']);assert.deepEqual(dispatches,[]);
 assert.ok(queries.some(q=>q.filters.some(f=>f[0]==='not'&&f[1]==='shipday_order_id')));
});

test('completed pickup shows receipt instead of awaiting intake after confirmed handoff',()=>{
 const ui=require('../src/web/pickup-dispatch');const plan={state:'COMPLETED',provider_status:'ALREADY_DELIVERED'};
 for(const status of ['AT_PARTNER','READY','OUT_FOR_DELIVERY','DELIVERED']){
  const order={order_number:1,status,at_partner_at:'2026-10-03T00:00:00Z'};
  assert.equal(ui.label(plan,order),'Received by laundromat');
  assert.doesNotMatch(ui.summary(plan,order),/awaiting intake/);
  assert.match(ui.card(plan,{order}),/Received by laundromat/);
 }
 assert.equal(ui.label(plan,{status:'REQUESTED',at_partner_at:null}),'Delivered to laundromat · awaiting intake');
 assert.equal(ui.label(plan),'Delivered to laundromat');
});
