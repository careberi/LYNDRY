'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTracking,tokenFromUrl,minutes,phone}=require('../src/providers/couriers/shipday-tracking');
const {verify}=require('../src/core/partner-delivery-gate');
const {createService}=require('../src/core/partner-intake');
const page=require('../src/web/shop-intake-page');
test('tracking adapter accepts only exact HTTPS tracking hosts and token shapes',()=>{
  for(const url of ['http://ordertracking.io/d/en/LYNDRY/YWJjZA==','https://ordertracking.io.evil.com/d/en/LYNDRY/YWJjZA==','https://ordertracking.io@localhost/d/en/LYNDRY/YWJjZA==','https://ordertracking.io:5000/d/en/LYNDRY/YWJjZA==','https://ordertracking.io/d/en/LYNDRY/../private','file:///etc/passwd'])assert.equal(tokenFromUrl(url),null,url);
  assert.equal(tokenFromUrl('https://www.ordertracking.io/d/en/LYNDRY/YWJjZA=='),'YWJjZA==');
  assert.equal(tokenFromUrl('https://www.ordertracking.io/LYNDRY/delivery/YWJjZA==&lang=en'),'YWJjZA==');
  for(const n of ['INF','',null,-1,NaN,Infinity,2000,true])assert.equal(minutes(n),null);
  assert.equal(minutes('12.5'),13);assert.equal(minutes(0),0);
  assert.equal(phone('javascript:alert(1)'),null);
});
test('tracking feed verifies order and status and returns only ETA and matching driver phone',async()=>{
  const payload={fixedData:{order:{orderNumber:'LYNDRY-9015-PICKUP'},carrier:{id:9,phoneNumber:'+12015550111'},customer:{name:'PRIVATE_CUSTOMER'}},dynamicData:{order:{status:'PICKED_UP'},estimatedTimeInMinutes:12}};
  let request;
  const read=createTracking({fetchImpl:async(url,opts)=>{request={url,opts};return {ok:true,text:async()=>JSON.stringify(payload)};}});
  const url='https://www.ordertracking.io/d/en/LYNDRY/YWJjZA==',expected={reference:'LYNDRY-9015-PICKUP',status:'PICKED_UP',driverId:9};
  assert.deepEqual(await read(url,expected),{etaMinutes:12,driverPhone:'+12015550111',pickupEtaMinutes:null});
  assert.ok(request.url.startsWith('https://report.shipday.com/eta/order/progress/'));
  assert.equal(request.opts.redirect,'error');assert.equal(request.opts.headers.Authorization,undefined);
  assert.equal((await read(url,{...expected,driverId:10})).driverPhone,null);
  assert.equal(await read(url,{...expected,reference:'OTHER'}),null);
  assert.equal(await read(url,{...expected,status:'STARTED'}),null);
  payload.fixedData.isExpired=true;assert.equal(await read(url,expected),null);
  const fail=createTracking({fetchImpl:async()=>{throw Error('PRIVATE_ERROR');}});assert.equal(await fail(url,expected),null);
});
function fixture(){
 const order={id:'order',order_number:9015,pickup_date:'2026-09-27'};
 const shop={name:'Cedar Lane',address_line1:'512 Cedar Ln',city:'Teaneck',state:'NJ',postal_code:'07666'};
 const plan={leg:'TO_PARTNER',simulation:false,shipday_order_id:'123',external_reference:'LYNDRY-9015-PICKUP'};
 const remote={orderId:123,orderNumber:plan.external_reference,customer:{name:shop.name,address:'512 Cedar Ln, Teaneck, NJ 07666'},orderStatus:{orderState:'PICKED_UP'},assignedCarrier:{id:9,name:'Driver',phoneNumber:'+12015550111'},trackingLink:'https://www.ordertracking.io/d/en/LYNDRY/YWJjZA=='};
 return {order,shop,plan,remote,provider:{findOrders:async()=>[remote]},now:()=>Date.parse('2026-09-27T20:00:00Z'),telemetry:true};
}
test('ETA is supplemental: unavailable ETA preserves verified intake; ETA never grants collection',async()=>{
 const f=fixture();let lookups=0;f.provider.trackingInfo=async()=>{lookups++;return {etaMinutes:12,driverPhone:null};};
 assert.equal((await verify(f)).etaMinutes,12);
 f.remote.orderStatus.orderState='STARTED';assert.equal((await verify(f)).ok,false);assert.equal(lookups,1);
 f.remote.orderStatus.orderState='PICKED_UP';f.provider.trackingInfo=async()=>{throw Error('timeout');};const result=await verify(f);assert.equal(result.ok,true);assert.equal(result.etaMinutes,null);
 f.remote.customer.name='Wrong destination';assert.equal((await verify(f)).ok,false);
});
test('board has three separate queues, ETA and call action without private tracking data',()=>{
 const incoming={number:9015,stage:'INCOMING',reference:'LYNDRY-9015-PICKUP',driver:'Driver',driverPhone:'+12015550111',canAccept:true,deliveryStatus:'PICKED_UP',etaMinutes:12,shipdayId:999999,customer:{name:'PRIVATE'}};
 const ctx={shop:{name:'Cedar'},lang:'en',orders:[incoming,{...incoming,number:9016,stage:'WASH',weight:33},{...incoming,number:9017,stage:'READY',weight:33}]};
 const html=page.board(ctx);
 for(const id of ['incoming','wash','ready'])assert.match(html,new RegExp('id="section-'+id+'"'));
 assert.match(html,/>12 min</);assert.match(html,/href="tel:\+12015550111"/);
 assert.match(html,/View wash instructions/);assert.match(html,/setInterval\(refresh,30000\)/);
 assert.doesNotMatch(html,/Awaiting intake|999999|PRIVATE|ordertracking\.io/);
 const locked=page.board({...ctx,orders:[{...incoming,canAccept:false,deliveryStatus:'STARTED'}]});assert.doesNotMatch(locked,/<a[^>]+data-intake-link/);assert.match(locked,/Awaiting pickup/);
 const received=page.detail({...ctx,csrf:'test',order:incoming});assert.match(received,/\/9015\/intake"/);assert.match(received,/name="weight_lb"/);assert.doesNotMatch(received,/name="handover_confirmed"/);assert.doesNotMatch(received,/\/accept"|tracking_number|Awaiting intake/);
});
test('combined intake rechecks delivery for every role, rejects retired accept, and does not settle a replay twice',async()=>{
 let rpcs=0,checks=0,settles=0;let verified=false;
 const db={from(){const q={select(){return q;},or(){return q;},eq(){return q;},in(){return q;},maybeSingle:async()=>({data:{id:'order'}})};return q;},rpc:async(name,args)=>{rpcs++;assert.equal(args.p_action,'intake');assert.equal(args.p_weight,33);return {data:{ok:true,already:true}};}};
 const service=createService({db,settleWeight:async()=>{settles++;},checkDelivery:async()=>{checks++;return {ok:verified,reason:'delivery_not_collected'};}});
 for(const isOpsAdmin of [true,false]){
  const args={partner:'shop',staff:{id:'actor',isOpsAdmin},number:'9015',action:'intake',weight:'33'};
  assert.equal((await service.act({...args,action:'accept'})).ok,false);
  assert.equal((await service.act({...args,weight:'51'})).ok,false);
  verified=false;assert.equal((await service.act(args)).ok,false);
  verified=true;assert.equal((await service.act(args)).ok,true);
 }
 assert.equal(checks,4);assert.equal(rpcs,2);assert.equal(settles,0);
});
