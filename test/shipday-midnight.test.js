'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createBookingDispatcher}=require('../src/core/shipday-booking-dispatch');
const {createClient}=require('../src/providers/couriers/shipday');
const {reconcile}=require('../src/core/pickup-edit-sync');
const {card}=require('../src/web/pickup-dispatch');
const legacyProblem='This pickup crosses the Shipday UTC scheduling boundary. Dispatch review is required.';
const endpoint={name:'Demo',phone:'+12015550199',line1:'1 Test St',city:'Town',state:'NJ',postalCode:'07001'};
function fixture({pickup='2026-10-02T23:30:00.000Z',arrival='2026-10-03T00:15:00.000Z',patch={},blocked=false,existing=false,badDate=false,offline=false}={}) {
 const trip={externalId:'LYNDRY-DEV-9028-PICKUP',from:endpoint,to:endpoint,pickupReadyAt:pickup,dropoffDeadlineAt:arrival};
 let row={id:'p',state:'PLANNED',version:0,booking_dispatch:true,simulation:false,leg:'TO_PARTNER',mode:'IN_HOUSE',history:[],...patch},remote=null;
 const calls=[];
 const store={get:async()=>structuredClone(row),claim:async old=>{if(old.version!==row.version)return null;row={...row,state:'PROCESSING',version:row.version+1};return structuredClone(row);},save:async(old,change,event)=>{assert.equal(old.version,row.version);row={...row,...change,version:row.version+1,history:[...row.history,event]};return structuredClone(row);}};
 const client=createClient({apiKey:'test',allowWrites:true,fetchImpl:async(url,request)=>{
  const body=request.body&&JSON.parse(request.body);calls.push({url,method:request.method,body});
  let result;
  if(request.method==='POST'&&url.endsWith('/orders')) {
   remote={orderId:123,orderNumber:body.orderNumber,restaurant:{address:body.restaurantAddress},customer:{address:body.customerAddress},activityLog:{expectedDeliveryDate:badDate?'2026-10-04':body.expectedDeliveryDate,expectedPickupTime:body.expectedPickupTime,expectedDeliveryTime:body.expectedDeliveryTime},orderStatus:{orderState:'NOT_ASSIGNED'}};
   result={success:true,orderId:123};
  } else if(url.endsWith('/carriers'))result=[{id:77,name:'LYNDRY',isActive:true,isOnShift:!offline}];
  else if(url.includes('/orders/assign/')){remote.assignedCarrier={id:77,name:'LYNDRY'};result={success:true};}
  else if(request.method==='GET'&&url.includes('/orders/'))result=existing?[{orderId:999}]:remote?[remote]:[];
  else throw Error('Unexpected provider call: '+request.method+' '+url);
  return {ok:true,status:200,json:async()=>result};
 }});
 const provider={...client,quote:async()=>({options:[{service:'Uber',feeCents:500,pickupTime:pickup,deliveryTime:arrival}]}),assign:async()=>{calls.push({method:'ASSIGN_THIRD_PARTY'});return {ok:true,status:'REQUESTED'};}};
 const dispatcher=createBookingDispatcher({store,provider,validate:async()=>blocked?{ok:false,reason:'Card required'}:{ok:true,canAssign:true,trip:structuredClone(trip),inHouseArrivalAt:arrival,budgetCents:500,acceptEstimate:()=>true}});
 return {...dispatcher,calls,row:()=>row};
}
const override={mode:'IN_HOUSE',driverId:'77'};
for(const [name,pickup,arrival] of [
 ['summer','2026-10-02T23:30:00.000Z','2026-10-03T00:15:00.000Z'],
 ['winter','2026-12-02T23:30:00.000Z','2026-12-03T00:15:00.000Z'],
 ['year rollover','2026-12-31T23:30:00.000Z','2027-01-01T00:15:00.000Z'],
 ['exact UTC midnight','2026-10-02T23:30:00.000Z','2026-10-03T00:00:00.000Z']
])test(name+' evening pickup keeps UTC delivery date and both times through create and assignment',async()=>{
 const f=fixture({pickup,arrival});const result=await f.run('p',override);
 assert.equal(result.state,'ASSIGNED');
 const payload=f.calls.find(c=>c.method==='POST').body;
 assert.equal(payload.expectedDeliveryDate,arrival.slice(0,10));assert.equal(payload.expectedPickupTime,'23:30:00');assert.equal(payload.expectedDeliveryTime,arrival.slice(11,19));
 await f.run('p',override);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
});
test('third-party scheduled pickup may cross midnight UTC',async()=>{
 const f=fixture({patch:{mode:'THIRD_PARTY'}});assert.equal((await f.run('p')).state,'REQUESTED');assert.equal(f.calls.filter(c=>c.method==='ASSIGN_THIRD_PARTY').length,1);
});
test('legacy midnight hold can be retried manually with fresh checks, never automatically',async()=>{
 const patch={state:'REVIEW',problem:legacyProblem};const f=fixture({patch});
 assert.equal((await f.run('p')).ok,false);assert.equal(f.calls.length,0);
 assert.equal((await f.run('p',override)).state,'ASSIGNED');
 const g=fixture({patch,blocked:true});assert.equal((await g.run('p',override)).ok,false);assert.equal(g.calls.length,0);
 const h=fixture({patch,existing:true});assert.equal((await h.run('p',override)).ok,false);assert.equal(h.calls.filter(c=>c.method==='POST'||c.method==='PUT').length,0);
});
test('uncertain jobs and unrelated review holds remain locked',async()=>{
 for(const extra of [{shipday_order_id:'123'},{assignment_requested_at:'2026-10-02T22:00:00Z'},{trip_snapshot:{}},{problem:'Dispatch was interrupted.'}]){
  const f=fixture({patch:{state:'REVIEW',problem:legacyProblem,...extra}});assert.equal((await f.run('p',override)).ok,false);assert.equal(f.calls.length,0);
 }
 const wrong=fixture({badDate:true});assert.equal((await wrong.run('p',override)).ok,false);assert.equal(wrong.calls.filter(c=>c.method==='PUT').length,0);
});
test('POS enables only the untouched legacy midnight hold for manual retry',()=>{
 const plan={state:'REVIEW',problem:legacyProblem,booking_dispatch:true,simulation:false,leg:'TO_PARTNER'};
 const opts={order:{order_number:9028},canAssign:true,enabled:true};
 assert.doesNotMatch(card(plan,opts),/disabled>Assign/);
 for(const extra of [{shipday_order_id:'123'},{assignment_requested_at:'now'},{trip_snapshot:{}},{problem:'Other review hold'}])assert.match(card({...plan,...extra},opts),/disabled>Assign/);
});
test('editing an unstarted pickup across midnight UTC preserves its ID and arrival duration',async()=>{
 const plan={shipday_order_id:'123',external_reference:'LYNDRY-DEV-9028-PICKUP',leg:'TO_PARTNER',booking_dispatch:true};
 const order={order_number:9028,status:'REQUESTED',pickup_date:'2026-10-02',pickup_time:'19:30',preferences:{}};
 const customer={name:'Demo',phone:'+12015550199',address_line1:'1 Test St',city:'Town',state:'NJ',postal_code:'07001',lat:40,lng:-74};
 const partner={...customer,status:'ACTIVE'};
 let remote={orderId:123,orderNumber:plan.external_reference,orderStatus:{orderState:'NOT_ASSIGNED'},activityLog:{}};let writes=0;
 const provider={findOrders:async()=>[remote],editOrder:async(id,b)=>{
  assert.equal(id,'123');writes++;assert.equal(b.expectedDeliveryDate,'2026-10-03');assert.equal(b.expectedPickupTime,'23:30:00');assert.equal(b.expectedDeliveryTime,'00:30:00');
  remote={...remote,restaurant:{name:b.restaurantName,address:b.restaurantAddress,phoneNumber:b.restaurantPhoneNumber,latitude:b.pickupLatitude,longitude:b.pickupLongitude},customer:{name:b.customerName,address:b.customerAddress,phoneNumber:b.customerPhoneNumber,latitude:b.deliveryLatitude,longitude:b.deliveryLongitude},deliveryInstruction:b.deliveryInstruction,activityLog:{expectedDeliveryDate:b.expectedDeliveryDate,expectedPickupTime:b.expectedPickupTime,expectedDeliveryTime:b.expectedDeliveryTime}};
 }};
 const result=await reconcile({plan,order,customer,partner,provider});assert.equal(result.outcome,'UPDATED');assert.equal(writes,1);assert.equal(result.trip.pickupReadyAt,'2026-10-02T23:30:00.000Z');assert.equal(result.trip.dropoffDeadlineAt,'2026-10-03T00:30:00.000Z');
});

test('offline driver during a legacy hold retry leaves a retryable blocked pickup',async()=>{
 const f=fixture({patch:{state:'REVIEW',problem:legacyProblem},offline:true});
 assert.equal((await f.run('p',override)).ok,false);assert.equal(f.row().state,'BLOCKED');
 assert.equal(f.calls.filter(c=>c.method==='POST'||c.method==='PUT').length,0);
});
