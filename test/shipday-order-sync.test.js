'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {payload,synchronize,editable,matches}=require('../src/core/shipday-order-sync');
const {createClient}=require('../src/providers/couriers/shipday');
function fixture(){
 const order={order_number:9015,status:'REQUESTED',pickup_date:'2026-09-28',pickup_time:'09:00:00',preferences:{special_instructions:'Front door'}};
 const customer={name:'Customer',phone:'+12015550198',address_line1:'25 Home St',city:'Town',state:'NJ',postal_code:'07001',lat:40.1,lng:-74.1};
 const partner={name:'New Laundry',address_line1:'900 Shop St',city:'Town',state:'NJ',postal_code:'07001',status:'ACTIVE',lat:40.2,lng:-74.2};
 const plan={shipday_order_id:'123',leg:'TO_PARTNER'};
 const remote={orderId:123,orderNumber:'LYNDRY-DEV-9015-PICKUP',orderStatus:{orderState:'NOT_ASSIGNED'},activityLog:{},customer:{},restaurant:{},thirdPartyAssignedAnytime:false,assignedCarrierId:null};
 return {order,customer,partner,plan,remote};
}
function apply(remote,b){return {...remote,customer:{name:b.customerName,address:b.customerAddress,phoneNumber:b.customerPhoneNumber,latitude:b.deliveryLatitude,longitude:b.deliveryLongitude},restaurant:{name:b.restaurantName,address:b.restaurantAddress,phoneNumber:b.restaurantPhoneNumber,latitude:b.pickupLatitude,longitude:b.pickupLongitude},activityLog:{...remote.activityLog,expectedDeliveryDate:b.expectedDeliveryDate,expectedPickupTime:b.expectedPickupTime,expectedDeliveryTime:b.expectedDeliveryTime},pickupInstruction:b.pickupInstruction,deliveryInstruction:b.deliveryInstruction};}
test('same existing Shipday ID is edited and verified; repeated sync performs no write',async()=>{
 const f=fixture();let remote=f.remote,writes=0;
 const provider={findOrders:async()=>[remote],editOrder:async(id,b)=>{assert.equal(id,'123');writes++;remote=apply(remote,b);}};
 await synchronize({...f,provider});assert.equal(writes,1);assert.equal(remote.customer.name,'New Laundry');assert.equal(remote.customer.phoneNumber,'+12017712933');assert.equal(remote.activityLog.expectedPickupTime,'13:00:00');assert.equal(remote.pickupInstruction,'Front door');
 await synchronize({...f,provider});assert.equal(writes,1);
});
test('return update reverses endpoints and preserves its existing schedule',()=>{
 const f=fixture();f.plan.leg='TO_CUSTOMER';f.order.status='READY';const b=payload(f.order,f.customer,f.partner,f.plan,f.remote);
 assert.equal(b.restaurantName,'New Laundry');assert.equal(b.restaurantPhoneNumber,'+12017712933');assert.equal(b.customerName,'Customer');assert.equal(b.expectedPickupTime,undefined);
});
test('third-party and started deliveries are blocked; unchanged data can reconcile safely',async()=>{
 for(const patch of [{thirdPartyAssignedAnytime:true},{thirdPartyTrackingLink:'https://tracking.test'},{orderStatus:{orderState:'STARTED'}},{activityLog:{pickedUpTime:'2026-09-28'}}]){
  const f=fixture();Object.assign(f.remote,patch);let writes=0;
  await assert.rejects(synchronize({...f,provider:{findOrders:async()=>[f.remote],editOrder:async()=>{writes++;}}}));assert.equal(writes,0);
 }
 assert.equal(editable(fixture().remote),null);
});
test('wrong or duplicate remote identity never updates; unsuccessful readback is not success',async()=>{
 const f=fixture();let writes=0;
 for(const rows of [[{...f.remote,orderId:124}],[f.remote,f.remote],[]])await assert.rejects(synchronize({...f,provider:{findOrders:async()=>rows,editOrder:async()=>{writes++;}}}));
 assert.equal(writes,0);
 await assert.rejects(synchronize({...f,provider:{findOrders:async()=>[f.remote],editOrder:async()=>{writes++;}}}),/did not confirm/);assert.equal(writes,1);
});
test('addresses, date and notes participate in readback; missing coordinates and closed order refuse',()=>{
 const f=fixture(),b=payload(f.order,f.customer,f.partner,f.plan,f.remote),remote=apply(f.remote,b);
 assert.ok(matches(remote,b));remote.customer.address='Old destination';assert.ok(!matches(remote,b));
 assert.throws(()=>payload({...f.order,status:'CANCELED'},f.customer,f.partner,f.plan,f.remote),/closed/);
 assert.throws(()=>payload(f.order,{...f.customer,lat:null},f.partner,f.plan,f.remote),/coordinates/);
});
test('edit-only provider capability cannot create or assign and uses the documented PUT endpoint',async()=>{
 const calls=[];const client=createClient({apiKey:'test',allowEdits:true,fetchImpl:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({success:true})};}});
 await client.editOrder('123',{orderId:123,orderNo:'TEST'});assert.equal(calls[0].url,'https://api.shipday.com/order/edit/123');assert.equal(calls[0].opts.method,'PUT');
 await assert.rejects(client.unassign('123'),/disabled/);assert.equal(calls.length,1);
 const locked=createClient({apiKey:'test'});await assert.rejects(locked.editOrder('123',{orderId:123,orderNo:'TEST'}),/disabled/);
});
