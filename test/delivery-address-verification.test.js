'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verifyReturn,createRequester}=require('../src/core/partner-return');
const {observe}=require('../src/core/delivery-sms');
function fixture(){
 const shop={id:'shop',name:'Fancy K',type:'LAUNDROMAT',status:'ACTIVE',address_line1:'143 Belmont Ave',city:'Paterson',state:null,postal_code:'07522'};
 const customer={name:'QA',phone:'+12015550199',status:'ACTIVE',default_payment_method_id:'pm_test',address_line1:'8 Home St',address_line2:'Unit 206',city:'Fair Lawn',state:'NJ',postal_code:'07410'};
 const order={id:'qa',order_number:9025,partner_id:'shop',status:'READY',payment_status:'PAID',customers:customer};
 const plan={id:'plan',order_id:'qa',leg:'TO_CUSTOMER',mode:'IN_HOUSE',simulation:false,state:'REVIEW',shipday_order_id:'123',external_reference:'LYNDRY-DEV-9025-RETURN',driver_id:'9',version:1};
 const remote={orderId:123,orderNumber:plan.external_reference,restaurant:{name:shop.name,address:'143 Belmont Ave, Paterson, NJ, 07522'},customer:{name:customer.name,address:'8 Home St, Unit 206, Fair Lawn, NJ, 07410'},assignedCarrier:{id:9,name:'LYNDRY'},orderStatus:{orderState:'READY_TO_DELIVER'}};
 const provider={findOrders:async()=>[remote]};
 const context={order,shop,customer,plan,provider,tracking:async()=>null};return {context,remote};
}
test('existing development in-house return with the historical NJ addition permits verified collection',async()=>{
 const {context}=fixture();const result=await verifyReturn(context);assert.equal(result.ok,true);assert.equal(result.canCollect,true);assert.equal(result.shipdayId,'123');
});
test('the same existing return supports the customer out-for-delivery observation',async()=>{
 const {context}=fixture();const result=await observe(context);assert.ok(result);assert.equal(result.rank,1);assert.equal(result.remoteId,'123');
});
test('legacy compatibility never ignores a different state, street, city, postal code or unit',async()=>{
 for(const change of [r=>r.restaurant.address='143 Belmont Ave, Paterson, NY, 07522',r=>r.restaurant.address='144 Belmont Ave, Paterson, NJ, 07522',r=>r.restaurant.address='143 Belmont Ave, Newark, NJ, 07522',r=>r.restaurant.address='143 Belmont Ave, Paterson, NJ, 07523',r=>r.customer.address='8 Home St, Unit 207, Fair Lawn, NJ, 07410']){
  const {context,remote}=fixture();change(remote);assert.equal((await verifyReturn(context)).ok,false);assert.equal(await observe(context),null);
 }
});
test('an explicitly saved state cannot acquire the legacy NJ exception',async()=>{
 const {context}=fixture();context.shop.state='NY';assert.equal((await verifyReturn(context)).ok,false);assert.equal(await observe(context),null);
});
test('legacy NJ compatibility is confined to the original non-simulated in-house development return',async()=>{
 for(const change of [c=>c.plan.external_reference='LIVE-RETURN',c=>c.plan.leg='TO_PARTNER',c=>c.plan.simulation=true,c=>c.plan.mode='THIRD_PARTY']){
  const {context,remote}=fixture();change(context);remote.orderNumber=context.plan.external_reference;assert.equal((await verifyReturn(context)).ok,false);assert.equal(await observe(context),null);
 }
});
test('legacy endpoint compatibility preserves remote identity, uniqueness and assigned driver checks',async()=>{
 for(const change of [f=>f.remote.orderId=124,f=>f.remote.orderNumber='OTHER',f=>f.remote.assignedCarrier.id=10,f=>f.context.provider.findOrders=async()=>[f.remote,f.remote]]){
  const f=fixture();change(f);assert.equal((await verifyReturn(f.context)).ok,false);assert.equal(await observe(f.context),null);
 }
});
test('new return creation preserves a blank state and successfully verifies the actual created address',async()=>{
 const {context}=fixture();const intake={ready_at:'now',completed_at:'now',received_verified_at:'now'};let current={...context.plan,state:'PLANNED',shipday_order_id:null};let remote=null;let creations=0;
 const store={ensure:async()=>({...current}),claim:async p=>({...p}),save:async(p,patch)=>(current={...p,...patch,version:p.version+1})};
 const provider={drivers:async()=>[{id:'9',name:'LYNDRY',isActive:true,isOnShift:true}],findOrders:async()=>remote?[remote]:[],createOrder:async trip=>{creations++;assert.equal(trip.from.state,null);remote={orderId:123,orderNumber:trip.externalId,restaurant:{name:'Fancy K',address:'143 Belmont Ave, Paterson, 07522'},customer:{name:'QA',address:'8 Home St, Unit 206, Fair Lawn, NJ, 07410'},orderStatus:{orderState:'NOT_ASSIGNED'}};return {id:'123'};},assignDriver:async()=>{remote.assignedCarrier={id:9,name:'LYNDRY'};remote.orderStatus.orderState='NOT_ACCEPTED';return {ok:true};}};
 const request=createRequester({store,provider,load:async()=>({...context,intake}),enabled:true});assert.equal((await request('qa','shop','admin')).ok,true);assert.equal(current.state,'ASSIGNED');assert.equal((await request('qa','shop','admin')).already,true);assert.equal(creations,1);
});
