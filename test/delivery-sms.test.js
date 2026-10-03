'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {observe,nextMessage}=require('../src/core/delivery-sms');
const {createWorker}=require('../src/core/delivery-sms-worker');
const stamp=Date.parse('2026-09-29T18:00:00Z');
function fixture(leg='TO_PARTNER') {
 const home={name:'Home',phone:'+12015550111',status:'ACTIVE',default_payment_method_id:'pm_test',address_line1:'1 Home St',city:'Town',state:'NJ',postal_code:'07000'};
 const shop={name:'Shop',address_line1:'2 Shop St',city:'Town',state:'NJ',postal_code:'07000'};
 const order={id:'order',order_number:9019,status:'REQUESTED',customer_id:'customer',customers:home};
 const plan={order_id:'order',leg,mode:'IN_HOUSE',driver_id:'7',shipday_order_id:'99',external_reference:'REF'};
 const addresses=['1 Home St, Town, NJ, 07000','2 Shop St, Town, NJ, 07000'];
 const remote={orderId:99,orderNumber:'REF',restaurant:{address:addresses[leg==='TO_PARTNER'?0:1]},customer:{address:addresses[leg==='TO_PARTNER'?1:0]},
  orderStatus:{orderState:'STARTED'},assignedCarrier:{id:7},trackingLink:'https://ordertracking.io/d/en/lyndry/abcd'};
 const provider={findOrders:async()=>[remote],status:async()=>({status:'pickup_complete',courier:{name:'Courier'}})};
 const tracking=async()=>({pickupEtaMinutes:8,etaMinutes:40});
 return {order,shop,plan,remote,provider,tracking,now:()=>stamp};
}
test('customer pickup uses pickup ETA, not arrival at the laundromat',async()=>{
 const f=fixture();const obs=await observe(f);assert.equal(obs.rank,2);assert.equal(obs.etaMinutes,8);
 const message=nextMessage(f.order,f.plan,{rank:0},obs,stamp);
 assert.match(message.body,/2:10 PM ET/);assert.doesNotMatch(message.body,/shipday|ordertracking|Home|Shop|40|http/i);
});
test('pickup tells the customer to put the bag at the order location before its ETA',async()=>{
 const f=fixture();f.order.preferences={special_instructions:'Side gate'};
 f.order.customers.preferences={special_instructions:'Front door'};
 const message=nextMessage(f.order,f.plan,{rank:0},await observe(f),stamp);
 assert.match(message.body,/driver is on the way/i);
 assert.match(message.body,/Please put your bag at the Side gate between now and 2:10 PM ET\./);
 assert.doesNotMatch(message.body,/Front door/);
 f.tracking=async()=>({});
 const withoutEta=nextMessage(f.order,f.plan,{rank:0},await observe(f),stamp);
 assert.match(withoutEta.body,/Please put your bag at the Side gate now\./);
 assert.doesNotMatch(withoutEta.body,/between|Estimated arrival/);
});
test('pickup never substitutes destination ETA if pickup ETA unavailable',async()=>{
 const f=fixture();f.tracking=async()=>({etaMinutes:4});const obs=await observe(f);
 assert.equal(obs.rank,1);assert.equal(obs.etaMinutes,null);
 assert.doesNotMatch(nextMessage(f.order,f.plan,{rank:0},obs,stamp).body,/Estimated/);
});
test('return waits for laundry collection and uses customer destination ETA',async()=>{
 const f=fixture('TO_CUSTOMER');assert.equal((await observe(f)).rank,0);
 f.remote.orderStatus.orderState='PICKED_UP';let obs=await observe(f);assert.equal(obs.rank,1);assert.equal(obs.etaMinutes,40);
 assert.match(nextMessage(f.order,f.plan,{rank:0},obs,stamp).body,/out for delivery/);
 f.remote.orderStatus.orderState='ALREADY_DELIVERED';obs=await observe(f);assert.equal(obs.rank,3);assert.equal(obs.etaMinutes,null);
 assert.match(nextMessage(f.order,f.plan,{rank:1},obs,stamp).body,/has been delivered/);
});
test('wrong identity, endpoint, driver, cancellation and missing card reject observation',async()=>{
 for(const mutate of [
  f=>f.remote.orderId=98,f=>f.remote.orderNumber='OTHER',f=>f.remote.customer.address='Wrong address',
  f=>f.remote.assignedCarrier.id=8,f=>f.remote.orderStatus.orderState='CANCELED',
  f=>f.remote.orderStatus.incomplete=true,f=>f.order.status='CANCELED',
  f=>f.order.customers.default_payment_method_id=null,f=>f.plan.simulation=true]) {
   const f=fixture();mutate(f);assert.equal(await observe(f),null);
 }
});
test('third-party collection must agree with authoritative provider status',async()=>{
 const f=fixture();f.plan.mode='THIRD_PARTY';f.remote.orderStatus.orderState='PICKED_UP';
 f.provider.status=async()=>({status:'ASSIGNED',courier:{name:'Driver'}});
 assert.equal(await observe(f),null);
 f.provider.status=async()=>({status:'pickup_complete',courier:{name:'Driver'}});
 assert.equal((await observe(f)).rank,3);
});
test('tracking unavailable still permits verified milestone without an ETA',async()=>{
 const f=fixture();f.tracking=async()=>{throw Error('offline');};
 assert.equal((await observe(f)).etaMinutes,null);
});
test('stale, future, invalid observations and repeated milestones are suppressed',async()=>{
 const f=fixture(),obs=await observe(f);
 for(const observedAt of ['invalid',new Date(stamp+1).toISOString(),new Date(stamp-120001).toISOString()])
  assert.equal(nextMessage(f.order,f.plan,{rank:0},{...obs,observedAt},stamp),null);
 assert.equal(nextMessage(f.order,f.plan,{rank:2},obs,stamp),null);
 assert.equal(nextMessage(f.order,f.plan,{rank:3},obs,stamp),null);
});
test('material ETA delays are throttled and can follow an approaching message',()=>{
 const f=fixture(),obs={rank:1,etaMinutes:30,observedAt:new Date(stamp).toISOString()};
 const state={rank:2,last_eta_at:new Date(stamp+5*60000).toISOString(),last_message_at:new Date(stamp-16*60000).toISOString()};
 assert.match(nextMessage(f.order,f.plan,state,obs,stamp).body,/estimate has changed/);
 assert.equal(nextMessage(f.order,f.plan,{...state,last_message_at:new Date(stamp-60000).toISOString()},obs,stamp),null);
 assert.equal(nextMessage(f.order,f.plan,{...state,last_eta_at:new Date(stamp+25*60000).toISOString()},obs,stamp),null);
});
function workerFixture() {
 const f=fixture(),states=new Map(),rows=[],sent=[];
 const store={
  context:async()=>({order:f.order,shop:f.shop}),
  ensure:async(p,rank)=>{if(!states.has(p.leg))states.set(p.leg,{rank,version:0});return {...states.get(p.leg)};},
  queue:async(p,s,m,o)=>{if(states.get(p.leg).version!==s.version)return false;
   states.set(p.leg,{rank:m.rank,version:s.version+1,last_eta_at:new Date(stamp+o.etaMinutes*60000).toISOString(),last_message_at:new Date(stamp).toISOString()});
   rows.push({id:rows.length,order_id:p.order_id,leg:p.leg,event_key:m.key,rank:m.rank,remote_id:o.remoteId,created_at:new Date(stamp).toISOString(),state:'PENDING'});return true;},
  claim:async row=>{if(row.state!=='PENDING')return null;row.state='SENDING';return {...row};},
  plan:async()=>f.plan,finish:async(row,state)=>{row.state=state;},
  plans:async()=>[f.plan],pending:async()=>rows.filter(r=>r.state==='PENDING'),expireClaims:async()=>{},
 };
 const args={...f,store,send:async(to,body)=>{sent.push({to,body});return {sent:true,simulated:true};}};
 return {f,store,states,rows,sent,args,worker:createWorker(args)};
}
test('two workers queue and send one milestone, then restart without repeats',async()=>{
 const x=workerFixture(),other=createWorker(x.args);
 await Promise.all([x.worker.poll(x.f.plan),other.poll(x.f.plan)]);
 assert.equal(x.rows.length,1);
 await Promise.all([x.worker.deliver(x.rows[0]),other.deliver(x.rows[0])]);
 assert.equal(x.sent.length,1);assert.equal(x.rows[0].state,'SIMULATED');
 await other.tick();assert.equal(x.sent.length,1);
});
test('a first observation of a completed trip does not backfill old messages',async()=>{
 const x=workerFixture();x.f.remote.orderStatus.orderState='ALREADY_DELIVERED';
 await x.worker.tick();assert.equal(x.sent.length,0);assert.equal(x.rows.length,0);
});
test('canceled, opted-out, cardless or replaced trips never send queued text',async()=>{
 for(const change of [
  x=>x.f.order.delivery_notifications_suppressed=true,x=>x.f.order.status='CANCELED',x=>x.f.order.customers.status='UNSUBSCRIBED',
  x=>x.f.order.customers.default_payment_method_id=null,x=>x.f.plan.shipday_order_id='100',
  x=>x.f.remote.orderStatus.orderState='PICKED_UP']) {
   const x=workerFixture();await x.worker.poll(x.f.plan);change(x);
   await x.worker.deliver(x.rows[0]);assert.equal(x.sent.length,0);assert.equal(x.rows[0].state,'SKIPPED');
 }
});
test('a provider read failure before sending is retried once on the next tick',async()=>{
 const x=workerFixture();await x.worker.poll(x.f.plan);
 let calls=0;const original=x.f.provider.findOrders;
 x.f.provider.findOrders=async()=>{calls++;throw Error('Shipday request failed (HTTP 429).');};
 await x.worker.tick();assert.equal(x.rows[0].state,'PENDING');assert.equal(x.sent.length,0);
 // One delivery read and at most one polling read, not repeated delivery attempts.
 assert.ok(calls<=2);
 x.f.provider.findOrders=original;
 await x.worker.tick();await x.worker.tick();
 assert.equal(x.sent.length,1);assert.equal(x.sent[0].to,x.f.order.customers.phone);
 assert.equal(x.rows[0].state,'SIMULATED');
});
test('a delayed on-way milestone uses a freshly verified ETA instead of expiring unsent',async()=>{
 const x=workerFixture();await x.worker.poll(x.f.plan);
 x.rows[0].created_at=new Date(stamp-5*60000).toISOString();
 x.args.tracking=async()=>({pickupEtaMinutes:3});
 await createWorker(x.args).deliver(x.rows[0]);
 assert.equal(x.sent.length,1);assert.match(x.sent[0].body,/2:05 PM ET/);
});
test('expired ETA-only updates remain skipped',async()=>{
 const x=workerFixture();await x.worker.poll(x.f.plan);
 Object.assign(x.rows[0],{event_key:'eta-1',created_at:new Date(stamp-120001).toISOString()});
 await x.worker.deliver(x.rows[0]);assert.equal(x.sent.length,0);assert.equal(x.rows[0].state,'SKIPPED');
});
test('uncertain sends are recorded for review and not retried',async()=>{
 const x=workerFixture();let attempts=0;
 x.args.send=async()=>{attempts++;throw Error('timeout after provider acceptance');};
 const w=createWorker(x.args);await w.tick();await w.tick();
 assert.equal(attempts,1);assert.equal(x.rows[0].state,'REVIEW');
});
test('STOP refusal at final send is recorded without a retry',async()=>{
 const x=workerFixture();x.args.send=async()=>({sent:false,refused:'opted_out'});
 await createWorker(x.args).tick();assert.equal(x.rows[0].state,'SKIPPED');
});
test('contact adapter preserves both endpoint phones while clearing notification email',()=>{
 const {contactFields}=require('../src/providers/couriers/shipday-contact');
 assert.deepEqual(contactFields({restaurantPhoneNumber:'+12015550111',customerPhoneNumber:'+12015550112',customerEmail:'private@example.com'}),
 {restaurantPhoneNumber:'+12015550111',customerPhoneNumber:'+12015550112',customerEmail:''});
});

test('manual recovery suppresses later delivery texts and photo observations',async()=>{const f=fixture('TO_CUSTOMER');f.order.delivery_notifications_suppressed=true;f.provider.findOrders=async()=>{throw Error('must not contact provider');};assert.equal(await observe(f),null);});
