'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verify}=require('../src/core/partner-delivery-gate');
const {createService}=require('../src/core/partner-intake');
const {board}=require('../src/web/shop-intake-page');
function fixture(){
 const plan={leg:'TO_PARTNER',simulation:false,shipday_order_id:'123',external_reference:'LYNDRY-DEV-9016-PICKUP'};
 const remote={orderId:123,orderNumber:plan.external_reference,customer:{name:'Shop',address:'2 Shop St, Paterson, NJ, 07514'},orderStatus:{orderState:'NOT_ACCEPTED'},assignedCarrier:{id:4,name:'Alex'},activityLog:{expectedDeliveryDate:'2026-09-29',expectedDeliveryTime:'21:00:00'}};
 const order={id:'o',order_number:9016,pickup_date:'2026-09-29',pickup_time:'16:00:00'};
 return {plan,remote,order,shop:{name:'Shop',address_line1:'2 Shop St',city:'Paterson',state:'NJ',postal_code:'07514'},provider:{findOrders:async()=>[remote]},now:()=>Date.parse('2026-09-28T19:00:00Z')};
}
test('future assigned delivery has scheduled arrival but remains locked for intake',async()=>{
 const result=await verify(fixture());assert.equal(result.assignmentVerified,true);assert.equal(result.ok,false);assert.equal(result.reason,'delivery_future');assert.equal(result.scheduledArrivalAt,'2026-09-29T21:00:00.000Z');
});
test('no driver, cancellation, failure, unconfirmed third-party request and wrong shop never establish assignment',async()=>{
 for(const change of [f=>f.remote.assignedCarrier=null,f=>f.remote.orderStatus.orderState='CANCELED',f=>f.remote.orderStatus.incomplete=true,f=>f.remote.customer.address='Other',f=>{f.remote.thirdPartyAssignedAnytime=true;f.provider.status=async()=>({status:'REQUESTED',courier:{name:'Provisional'}});}]){
  const f=fixture();change(f);assert.notEqual((await verify(f)).assignmentVerified,true);
 }
 const f=fixture();f.remote.thirdPartyAssignedAnytime=true;f.provider.status=async()=>({status:'STARTED',courier:{name:'Alex'}});assert.equal((await verify(f)).assignmentVerified,true);
 f.remote.orderStatus.orderState='CANCELED';assert.equal((await verify(f)).assignmentVerified,false);
});
test('incoming list, counts, search and detail omit unverified orders; completed intake remains visible',async()=>{
 const orders=[1,2,3].map(n=>({id:String(n),order_number:9015+n,status:'REQUESTED'}));
 const intake={order_id:'3',received_at:'now',received_verified_at:'now',completed_at:'now',completed_by:'staff',weight_lb:33};
 const db={from(table){const q={select(){return q;},or(){return q;},eq(){return q;},in(){return q;},order(){return q;},then(resolve){return Promise.resolve({data:table==='orders'?orders:table==='partner_order_intakes'?[intake]:[]}).then(resolve);}};return q;}};
 const service=createService({db,deliveryInfo:async o=>o.id==='2'?{assignmentVerified:true,driver:'Alex',scheduledArrivalAt:'2026-09-29T21:00:00Z'}:{assignmentVerified:false}});
 const views=await service.list('shop');assert.deepEqual(views.map(o=>o.number),[9017,9018]);assert.equal(views[1].stage,'WASH');assert.equal(await service.detail('shop','9016'),null);
 const html=board({shop:{name:'Shop'},lang:'en',orders:views});assert.doesNotMatch(html,/#9016/);assert.match(html,/Scheduled arrival/);assert.match(html,/Sep 29, 2026/);assert.match(html,/5:00 PM/);assert.match(html,/Live ETA/);
});
