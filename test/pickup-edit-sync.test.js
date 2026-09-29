'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reconcile}=require('../src/core/pickup-edit-sync');
function fixture(){
 return {plan:{shipday_order_id:'123',external_reference:'LYNDRY-DEV-9017-PICKUP',leg:'TO_PARTNER',booking_dispatch:true},
 order:{order_number:9017,status:'REQUESTED',pickup_date:'2099-09-29',pickup_time:'16:00',preferences:{dropoff_spot:'Front door'}},
 customer:{name:'Demo',phone:'+12015550199',address_line1:'1 Home St',city:'Town',state:'NJ',postal_code:'07001',lat:40,lng:-74},
 partner:{name:'Laundry',status:'ACTIVE',address_line1:'2 Shop St',city:'Town',state:'NJ',postal_code:'07001',lat:40.1,lng:-74.1}};
}
test('missing Shipday reference reconciles without creating or assigning a replacement',async()=>{
 const result=await reconcile({...fixture(),provider:{findOrders:async()=>[]}});
 assert.equal(result.outcome,'MISSING');assert.equal(result.state,'CANCELED');assert.equal(result.trip,null);
});
test('provider outage, malformed response and conflicting identity are not deletion evidence',async()=>{
 for(const rows of [null,{},[{orderId:124,orderNumber:'LYNDRY-DEV-9017-PICKUP'}]])await assert.rejects(reconcile({...fixture(),provider:{findOrders:async()=>rows}}));
 await assert.rejects(reconcile({...fixture(),provider:{findOrders:async()=>{throw Error('offline');}}}),/offline/);
});
test('scheduled in-house job is edited in place with schedule and address readback',async()=>{
 let remote={orderId:123,orderNumber:'LYNDRY-DEV-9017-PICKUP',orderStatus:{orderState:'NOT_ACCEPTED'},activityLog:{},assignedCarrierId:7,assignedCarrier:{id:7,name:'LYNDRY'},customer:{},restaurant:{}};
 let writes=0;
 const provider={findOrders:async()=>[remote],editOrder:async(id,b)=>{
  assert.equal(id,'123');writes++;
  remote={...remote,restaurant:{name:b.restaurantName,address:b.restaurantAddress,phoneNumber:b.restaurantPhoneNumber,latitude:b.pickupLatitude,longitude:b.pickupLongitude},customer:{name:b.customerName,address:b.customerAddress,phoneNumber:b.customerPhoneNumber,latitude:b.deliveryLatitude,longitude:b.deliveryLongitude},deliveryInstruction:b.deliveryInstruction,activityLog:{expectedDeliveryDate:b.expectedDeliveryDate,expectedPickupTime:b.expectedPickupTime,expectedDeliveryTime:b.expectedDeliveryTime}};
 }};
 const result=await reconcile({...fixture(),provider});assert.equal(writes,1);assert.equal(result.outcome,'UPDATED');assert.equal(result.state,'ASSIGNED');assert.equal(result.assignedName,'LYNDRY');
});
test('third-party and started pickups are never blindly edited or deleted',async()=>{
 for(const patch of [{thirdPartyAssignedAnytime:true},{orderStatus:{orderState:'STARTED'}}]){
  const remote={orderId:123,orderNumber:'LYNDRY-DEV-9017-PICKUP',orderStatus:{orderState:'NOT_ASSIGNED'},...patch};
  await assert.rejects(reconcile({...fixture(),provider:{findOrders:async()=>[remote]}}));
 }
});
