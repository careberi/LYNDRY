'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRequester,verifyReturn}=require('../src/core/partner-return');
const {createTracking}=require('../src/providers/couriers/shipday-tracking');
const page=require('../src/web/shop-intake-page');
function fixture(){
 const context={order:{id:'order',order_number:9015,partner_id:'shop',status:'READY',payment_status:'PAID'},shop:{id:'shop',type:'LAUNDROMAT',status:'ACTIVE',name:'Cedar',address_line1:'1 Main St',city:'Town',state:'NJ',postal_code:'07000'},customer:{name:'PRIVATE_CUSTOMER',phone:'+12015550185',address_line1:'2 Private St',city:'Town',state:'NJ',postal_code:'07000'},intake:{ready_at:'now',completed_at:'now',received_verified_at:'now'}};
 let plan={id:'plan',order_id:'order',leg:'TO_CUSTOMER',state:'ASSIGNED',mode:'THIRD_PARTY',shipday_order_id:'SIM-OLD',simulation:true,version:1};
 const calls=[];let remote=null;
 const store={ensure:async()=>structuredClone(plan),claim:async row=>{if(row.version!==plan.version||row.state!==plan.state)return null;plan={...plan,state:'PROCESSING',version:plan.version+1};return structuredClone(plan);},save:async(row,patch)=>{assert.equal(row.version,plan.version);plan={...plan,...patch,version:plan.version+1};return structuredClone(plan);}};
 const provider={drivers:async()=>[{id:'9',name:'LYNDRY',isActive:true,isOnShift:true}],findOrders:async()=>remote?[structuredClone(remote)]:[],createOrder:async trip=>{calls.push(['create',trip]);remote={orderId:123,orderNumber:trip.externalId,restaurant:{name:context.shop.name,address:'1 Main St, Town, NJ, 07000'},customer:{name:context.customer.name,address:'2 Private St, Town, NJ, 07000'},orderStatus:{orderState:'NOT_ASSIGNED'}};return {id:'123'};},assignDriver:async(id,driver)=>{calls.push(['assign',id,driver]);remote.assignedCarrier={id:driver,name:'LYNDRY',phoneNumber:'+12015550186'};remote.orderStatus.orderState='NOT_ACCEPTED';return {ok:true};}};
 const request=createRequester({store,provider,load:async()=>context,enabled:true});
 return {context,calls,store,provider,request,get plan(){return plan;},get remote(){return remote;},set remote(value){remote=value;}};
}
test('ready creates one real in-house return and repeated/concurrent requests do not book twice',async()=>{
 const f=fixture();await Promise.all([f.request('order','shop','admin'),f.request('order','shop','admin')]);
 assert.deepEqual(f.calls.map(c=>c[0]),['create','assign']);assert.equal(f.plan.state,'ASSIGNED');assert.equal(f.plan.simulation,false);assert.equal(f.plan.mode,'IN_HOUSE');
 assert.equal(Date.parse(f.calls[0][1].dropoffDeadlineAt)-Date.parse(f.calls[0][1].pickupReadyAt),30*60000);
 assert.equal(f.calls[0][1].externalId,'LYNDRY-DEV-9015-RETURN');assert.equal(f.calls[0][1].from.name,'Cedar');assert.equal(f.calls[0][1].to.name,'PRIVATE_CUSTOMER');
 assert.equal((await f.request('order','shop','admin')).already,true);assert.equal(f.calls.length,2);
});
test('not-ready, unverified, unpaid, held and existing courier orders never request a driver',async()=>{
 for(const change of [f=>f.context.order.status='AT_PARTNER',f=>f.context.order.payment_status='UNPAID',f=>f.context.intake.received_verified_at=null,f=>f.context.hasCourier=true,f=>f.context.shop.status='INACTIVE',f=>f.context.dispatchRefused=true]){
  const f=fixture();change(f);assert.equal((await f.request('order','shop','admin')).ok,false);assert.equal(f.calls.length,0);
 }
});
test('offline or ambiguous in-house drivers leave a retryable request without creating an order',async()=>{
 for(const drivers of [[],[{id:'1',isActive:true,isOnShift:true},{id:'2',isActive:true,isOnShift:true}]]){
  const f=fixture();f.provider.drivers=async()=>drivers;assert.equal((await f.request('order','shop','admin')).ok,false);assert.equal(f.calls.length,0);assert.equal(f.plan.state,'BLOCKED');
 }
});
test('uncertain assignment is preserved for review and cannot be retried into a duplicate',async()=>{
 const f=fixture();f.provider.assignDriver=async()=>{f.calls.push(['uncertain']);throw Error('timeout');};
 assert.equal((await f.request('order','shop','admin')).ok,false);assert.equal(f.plan.state,'REVIEW');assert.equal(f.plan.shipday_order_id,'123');
 assert.equal((await f.request('order','shop','admin')).ok,false);assert.deepEqual(f.calls.map(c=>c[0]),['create','uncertain']);
});
test('a matching existing reference is adopted; another driver or third-party assignment is never replaced',async()=>{
 for(const wrong of [false,'driver','third-party','destination']){
  const f=fixture();await f.provider.createOrder({externalId:'LYNDRY-DEV-9015-RETURN'});f.calls.length=0;
  if(wrong==='driver')f.remote.assignedCarrier={id:10};
  if(wrong==='third-party')f.remote.thirdPartyAssignedAnytime=true;
  if(wrong==='destination')f.remote.customer.address='Wrong';
  const result=await f.request('order','shop','admin');assert.equal(result.ok,!wrong);
  assert.deepEqual(f.calls.map(c=>c[0]),wrong?[]:['assign']);if(wrong)assert.equal(f.plan.state,'REVIEW');
 }
});
test('return confirmation checks both endpoints, remote identity, driver and actual collection status',async()=>{
 const f=fixture();await f.request('order','shop','admin');
 const check=()=>verifyReturn({provider:f.provider,...f.context,plan:f.plan});
 for(const state of ['NOT_ACCEPTED','STARTED','INCOMPLETE','CANCELLED']){f.remote.orderStatus.orderState=state;assert.equal((await check()).canCollect,false);}
 for(const state of ['PICKED_UP','READY_TO_DELIVER','ALREADY_DELIVERED']){f.remote.orderStatus.orderState=state;assert.equal((await check()).canCollect,true);}
 const good=structuredClone(f.remote);
 for(const change of [r=>r.orderId=456,r=>r.orderNumber='OTHER',r=>r.restaurant.address='OTHER',r=>r.customer.address='OTHER',r=>r.assignedCarrier.id=10,r=>r.thirdPartyAssignedAnytime=true]){
  f.remote=structuredClone(good);change(f.remote);assert.equal((await check()).ok,false);
 }
 f.remote=good;f.remote.orderStatus.incomplete=true;assert.equal((await check()).canCollect,false);
});
test('return ETA uses minutes to laundromat pickup, never customer-arrival estimate',async()=>{
 const payload={fixedData:{order:{orderNumber:'LYNDRY-DEV-9015-RETURN'},carrier:{id:9}},dynamicData:{orderStatus:{status:'STARTED'},estimatedTimeInMinutes:42,detailEta:{pickUpTime:7.2}}};
 const read=createTracking({fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify(payload)})});
 const url='https://ordertracking.io/d/en/LYNDRY/YWJjZA==',expected={reference:payload.fixedData.order.orderNumber,status:'STARTED',driverId:9};
 assert.equal((await read(url,expected)).pickupEtaMinutes,8);assert.equal((await read(url,{...expected,driverId:10})).pickupEtaMinutes,null);
 const f=fixture();await f.request('order','shop','admin');f.remote.orderStatus.orderState='STARTED';f.provider.trackingInfo=async()=>({etaMinutes:42,pickupEtaMinutes:8});
 assert.equal((await verifyReturn({provider:f.provider,...f.context,plan:f.plan,telemetry:true})).etaMinutes,8);
 delete payload.dynamicData.detailEta;assert.equal((await read(url,expected)).pickupEtaMinutes,null);
});
test('ready portal shows weight, pickup ETA, original photos and gated collection action without customer data',()=>{
 const ctx={lang:'en',csrf:'test',shop:{name:'Cedar'},order:{number:9015,stage:'READY',weight:30,driver:'LYNDRY',assigned:true,deliveryStatus:'STARTED',etaMinutes:8,deliveryPhotoCount:1,reference:'LYNDRY #9015',customer:{name:'PRIVATE_CUSTOMER'}}};
 let html=page.detail(ctx);assert.match(html,/Pickup ETA/);assert.match(html,/8 min/);assert.match(html,/delivery-photos\/0/);assert.doesNotMatch(html,/\/collect"|PRIVATE_CUSTOMER/);
 html=page.detail({...ctx,order:{...ctx.order,canCollect:true}});assert.match(html,/\/9015\/collect"/);assert.match(html,/Confirm picked up/);
 html=page.detail({...ctx,order:{...ctx.order,assigned:false,returnNeedsRequest:true}});assert.match(html,/\/request-return"/);
 html=page.board({...ctx,orders:[ctx.order]});assert.match(html,/30 lb/);assert.match(html,/Pickup ETA/);assert.match(html,/8 min/);assert.doesNotMatch(html,/PRIVATE_CUSTOMER/);
});
