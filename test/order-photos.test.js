'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createService}=require('../src/core/order-photos');
const {render}=require('../src/web/order-photos');
const {register}=require('../src/routes/order-photos');
const URL='https://s3.us-west-2.amazonaws.com/qt.com.dashboard.order.signature/';
function fixture(){
 const order={id:'o',order_number:9028,status:'DELIVERED',preferences:{}};
 const customer={address_line1:'1 Home St',city:'Town',state:'NJ',postal_code:'07001'};
 const shop={address_line1:'2 Shop St',city:'Town',state:'NJ',postal_code:'07001'};
 const plans=['TO_PARTNER','TO_CUSTOMER'].map((leg,i)=>({order_id:'o',leg,simulation:false,mode:'IN_HOUSE',shipday_order_id:String(123+i),external_reference:'LYNDRY-DEV-9028-'+(i?'RETURN':'PICKUP')}));
 const remotes=plans.map((p,i)=>({orderId:Number(p.shipday_order_id),orderNumber:p.external_reference,restaurant:{address:i?'2 Shop St, Town, NJ, 07001':'1 Home St, Town, NJ, 07001'},customer:{address:i?'1 Home St, Town, NJ, 07001':'2 Shop St, Town, NJ, 07001'},orderStatus:{orderState:'ALREADY_DELIVERED'},proofOfDelivery:{imageUrls:[URL+(i?'doorstep':'intake')+'.jpg']}}));
 let reads=0;const load=async n=>String(n)==='9028'?{order,customer,shop,plans}:null;
 const provider={findOrders:async ref=>remotes.filter(r=>r.orderNumber===ref)};
 const service=createService({load,provider,readPhoto:async url=>{reads++;return {bytes:Buffer.from([255,216,255]),contentType:'image/jpeg',source:url};}});
 return {order,customer,shop,plans,remotes,provider,service,reads:()=>reads};
}
test('completed order presents distinct intake and doorstep photos through employee URLs',async()=>{
 const f=fixture(),groups=await f.service.gallery(9028);assert.equal(groups.length,2);assert.deepEqual(groups.map(g=>g.count),[1,1]);
 const html=render(9028,groups);assert.match(html,/Laundromat drop-off/);assert.match(html,/Customer delivery/);assert.match(html,/\/ops\/orders\/9028\/photos\/TO_PARTNER\/0/);assert.match(html,/\/ops\/orders\/9028\/photos\/TO_CUSTOMER\/0/);assert.doesNotMatch(html,/amazonaws|signaturePath/);
 assert.equal((await f.service.photo(9028,'TO_PARTNER','0')).source,URL+'intake.jpg');assert.equal((await f.service.photo(9028,'TO_CUSTOMER','0')).source,URL+'doorstep.jpg');
});
test('photos require exact order, job, leg and both addresses on every image request',async()=>{
 for(const mutate of [f=>f.remotes[0].orderId=999,f=>f.plans[0].order_id='other',f=>f.remotes[0].restaurant.address='Another home',f=>f.remotes[0].customer.address='Another shop',f=>f.plans[0].external_reference='LYNDRY-DEV-9999-PICKUP',f=>f.plans[0].simulation=true,f=>f.remotes.push({...f.remotes[0]})]){
  const f=fixture();mutate(f);assert.equal(await f.service.photo(9028,'TO_PARTNER','0'),null);assert.equal(f.reads(),0);
 }
 const f=fixture();assert.equal((await f.service.gallery(9028))[0].count,1);f.remotes[0].orderId=999;assert.equal(await f.service.photo(9028,'TO_PARTNER','0'),null);
 for(const [n,leg,i] of [[9999,'TO_PARTNER','0'],[9028,'WRONG','0'],[9028,'TO_PARTNER','-1'],[9028,'TO_PARTNER','20'],[9028,'TO_PARTNER','0.5'],[9028,'TO_PARTNER','https://evil']])assert.equal(await f.service.photo(n,leg,i),null);
});
test('missing proof, signatures and customer pickup photos never masquerade as handoff proof',async()=>{
 const f=fixture();f.remotes[0].proofOfDelivery={signaturePath:URL+'signature.jpg'};f.remotes[0].proofOfPickup={imageUrls:[URL+'pickup.jpg']};
 let groups=await f.service.gallery(9028);assert.equal(groups[0].count,0);assert.match(render(9028,groups),/No photo recorded/);
 f.remotes[0].proofOfDelivery.imageUrls=['http://127.0.0.1/private'];assert.equal(await f.service.photo(9028,'TO_PARTNER','0'),null);
 f.remotes[0].proofOfDelivery.imageUrls=[URL+'intake.jpg'];f.remotes[0].orderStatus.orderState='PICKED_UP';assert.equal(await f.service.photo(9028,'TO_PARTNER','0'),null);
});
test('one unavailable provider leg does not hide the other leg or break the order page',async()=>{
 const f=fixture();f.provider.findOrders=async ref=>{if(ref.endsWith('PICKUP'))throw Error('secret');return [f.remotes[1]];};
 const groups=await f.service.gallery(9028);assert.equal(groups[0].state,'unavailable');assert.equal(groups[1].count,1);assert.doesNotMatch(render(9028,groups),/secret/);
});
test('image endpoint requires employee access and returns private image responses',async t=>{
 const f=fixture();let signedIn=true,permitted=true;
 const app=express();const checks=[];register(app,{service:f.service,guard:(req,res,next)=>signedIn?next():res.sendStatus(401),may:permission=>(req,res,next)=>{checks.push(permission);return permitted?next():res.sendStatus(403);}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port+'/ops/orders/9028/photos/TO_PARTNER/0';
 const response=await fetch(base);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store, private');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal((await response.arrayBuffer()).byteLength,3);assert.deepEqual(checks,['orders.view','customers.view']);
 assert.equal((await fetch(base.replace('/0','/20'))).status,404);permitted=false;assert.equal((await fetch(base)).status,403);signedIn=false;assert.equal((await fetch(base)).status,401);
});
