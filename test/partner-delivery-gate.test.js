'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verify}=require('../src/core/partner-delivery-gate');
const {createService}=require('../src/core/partner-intake');
const page=require('../src/web/shop-intake-page');
function fixture(){
 const order={id:'order',order_number:9015,pickup_date:'2026-09-27'};
 const shop={name:'Cedar Lane',address_line1:'512 Cedar Ln',city:'Teaneck',state:'NJ',postal_code:'07666'};
 const plan={id:'plan',leg:'TO_PARTNER',simulation:false,shipday_order_id:'123',external_reference:'LYNDRY-DEV-9015-PICKUP'};
 const remote={orderId:123,orderNumber:plan.external_reference,customer:{name:shop.name,address:'512 Cedar Ln, Teaneck, NJ 07666, USA'},orderStatus:{orderState:'PICKED_UP'},assignedCarrier:{name:'Test driver'}};
 return {order,shop,plan,remote,provider:{findOrders:async()=>[remote]},now:()=>Date.parse('2026-09-27T20:00:00Z')};
}
test('Shipday collection states permit receipt, assignment/start/failure/unknown do not',async()=>{
 for(const status of ['PICKED_UP','READY_TO_DELIVER','ALREADY_DELIVERED','NOT_ASSIGNED','NOT_ACCEPTED','NOT_STARTED_YET','STARTED','INCOMPLETE','FAILED_DELIVERY','CANCELLED','UNKNOWN']){
  const f=fixture();f.remote.orderStatus.orderState=status;
  assert.equal((await verify(f)).ok,['PICKED_UP','READY_TO_DELIVER','ALREADY_DELIVERED'].includes(status),status);
 }
});
test('wrong order ID, reference, destination, future date, simulated leg and outage fail closed',async()=>{
 const changes=[f=>f.remote.orderId=124,f=>f.remote.orderNumber='another',f=>f.remote.customer.address='Other shop',f=>f.remote.customer.name='Other shop',f=>f.order.pickup_date='2026-09-29',f=>f.plan.leg='TO_CUSTOMER',f=>f.plan.simulation=true,f=>f.provider.findOrders=async()=>{throw Error('secret upstream error');}];
 for(const change of changes){const f=fixture();change(f);const result=await verify(f);assert.equal(result.ok,false);assert.ok(!JSON.stringify(result).includes('secret'));}
});
test('Uber/DoorDash trip requires their Shipday on-demand collection confirmation too',async()=>{
 for(const status of ['pickup_complete','delivered','STARTED','REQUESTED','canceled']){
  const f=fixture();f.remote.thirdPartyAssignedAnytime=true;f.provider.status=async()=>({status,courier:{name:'Courier driver'}});
  const result=await verify(f);assert.equal(result.ok,['pickup_complete','delivered'].includes(status));
 }
});
test('forged or stale acceptance POST repeats the provider check and cannot reach receipt RPC',async()=>{
 let checks=0,rpcs=0,ok=false;
 const db={from(){const q={select(){return q;},or(){return q;},eq(){return q;},in(){return q;},maybeSingle(){return q;},then(resolve){return Promise.resolve({data:{id:'order'},error:null}).then(resolve);}};return q;},rpc:async()=>{rpcs++;return {data:{ok:true,already:true}};}};
 const service=createService({db,checkDelivery:async()=>{checks++;return {ok,reason:'delivery_not_collected'};}});
 const args={partner:'shop',staff:{id:'admin',isOpsAdmin:true},number:'9015',action:'intake',weight:'33'};
 assert.equal((await service.act(args)).ok,false);assert.equal(rpcs,0);
 ok=true;assert.equal((await service.act(args)).ok,true);assert.equal(checks,2);assert.equal(rpcs,1);
});
test('locked portal does not render an accept form or spoofed success notice; verified intake is weight-only',()=>{
 const ctx={shop:{name:'Test'},lang:'en',csrf:'test',notice:'accept',order:{number:9015,stage:'INCOMING',canAccept:false,deliveryReason:'delivery_not_collected',reference:'LYNDRY #9015'}};
 const html=page.detail(ctx);assert.doesNotMatch(html,/Delivery accepted\.|action="[^\"]+\/accept"|name="weight_lb"|Shipday/);assert.match(html,/Waiting for pickup confirmation/);
 const intake=page.detail({...ctx,order:{...ctx.order,stage:'INCOMING',receivedVerified:true,canAccept:true}});
 assert.match(intake,/name="weight_lb"/);assert.doesNotMatch(intake,/tracking_number|internal ticket|Ticket &amp; weight/);
});
