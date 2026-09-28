'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {photoUrl,deliveryPhotos,fetchPhoto}=require('../src/providers/couriers/shipday-proof');
const {createService}=require('../src/core/partner-intake');
const {createRouter:adminRouter}=require('../src/routes/shop-admin-portal');
const {posHost}=require('../src/web/pos-host');
const URL='https://s3.us-west-2.amazonaws.com/qt.com.dashboard.order.signature/photo-123.jpg';
test('only official incoming delivery image URLs are accepted, never pickup/signature/foreign URLs',()=>{
 assert.equal(photoUrl(URL),URL);
 for(const url of ['http://localhost/image.jpg','https://s3.us-west-2.amazonaws.com.evil.com/qt.com.dashboard.order.signature/photo.jpg','https://s3.us-west-2.amazonaws.com/another-bucket/photo.jpg',URL.replace('.jpg','.svg'),'https://user:pass@s3.us-west-2.amazonaws.com/qt.com.dashboard.order.signature/photo.jpg',URL+'/nested.jpg','file:///etc/passwd'])assert.equal(photoUrl(url),null,url);
 const remote={orderStatus:{orderState:'ALREADY_DELIVERED'},proofOfPickup:{imageUrls:[URL]},proofOfDelivery:{signaturePath:URL}};
 assert.deepEqual(deliveryPhotos(remote),[]);remote.proofOfDelivery.imageUrls=[URL,URL,'https://private.example/photo.jpg'];assert.deepEqual(deliveryPhotos(remote),[URL]);
 remote.orderStatus.orderState='PICKED_UP';assert.deepEqual(deliveryPhotos(remote),[]);
});
test('photo proxy rejects redirects, nonimages and oversized bodies and forwards no credential',async()=>{
 const bytes=Buffer.from([0xff,0xd8,0xff,1]);let opts;
 const alias=await fetchPhoto(URL,{fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'image/jpg'}})});assert.equal(alias.contentType,'image/jpeg');
 const result=await fetchPhoto(URL,{fetchImpl:async(url,options)=>{opts=options;return new Response(bytes,{headers:{'content-type':'image/jpeg'}});}});
 assert.deepEqual(result.bytes,bytes);assert.equal(opts.redirect,'error');assert.equal(opts.headers,undefined);
 for(const response of [new Response('<html>',{headers:{'content-type':'image/jpeg'}}),new Response(bytes,{headers:{'content-type':'text/html'}}),new Response(bytes,{headers:{'content-type':'image/jpeg','content-length':String(11*1024*1024)}})])await assert.rejects(fetchPhoto(URL,{fetchImpl:async()=>response}),/unavailable/);
});
test('photo reads are scoped to current shop and verified incoming leg, with no arbitrary URL input',async()=>{
 let permitted=true,verified=true,reads=0;const filters=[];
 const db={from(){const q={select(){return q;},or(scope){filters.push(scope);return q;},eq(){return q;},in(){return q;},maybeSingle:async()=>({data:permitted?{id:'order'}:null})};return q;}};
 const service=createService({db,deliveryInfo:async(o,p,leg)=>{assert.equal(p,'shop');assert.equal(leg,'TO_PARTNER');return {ok:verified,deliveryPhotos:[URL]};},readDeliveryPhoto:async url=>{assert.equal(url,URL);reads++;return 'image';}});
 assert.equal(await service.deliveryPhoto('shop','9015','0'),'image');assert.ok(filters[0].includes('partner_id.eq.shop'));
 for(const i of ['20','-1','https://evil','0.5'])assert.equal(await service.deliveryPhoto('shop','9015',i),null);
 verified=false;assert.equal(await service.deliveryPhoto('shop','9015','0'),null);permitted=false;assert.equal(await service.deliveryPhoto('shop','9015','0'),null);assert.equal(reads,1);
});
test('admin photo URL stays inside shop portal and binary response retains authentication and privacy headers',async t=>{
 const shop='11111111-1111-4111-8111-111111111111';let role='ADMIN';
 const service={detail:async()=>({number:9015,stage:'INCOMING',canAccept:true,deliveryPhotoCount:1}),deliveryPhoto:async(p,n,i)=>{assert.equal(p,shop);return i==='0'?{bytes:Buffer.from([0xff,0xd8,0xff]),contentType:'image/jpeg'}:null;}};
 const app=express();app.use(posHost({host:'127.0.0.1'}));app.use((req,res,next)=>{req.opsUser={id:'admin',name:'Admin',role,status:'ACTIVE',session_token:'test'};next();});
 app.use('/ops/partners/:partnerId/portal',adminRouter({service,staffService:{},loadPartner:async id=>({id,name:'Cedar',status:'ACTIVE',type:'LAUNDROMAT'})}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port+'/partners/'+shop+'/portal/orders/9015';
 const html=await (await fetch(base)).text();assert.ok(html.includes('src="/partners/'+shop+'/portal/orders/9015/delivery-photos/0"'));assert.doesNotMatch(html,/handover_confirmed|I have the laundry and matched/);
 const response=await fetch(base+'/delivery-photos/0');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store, private');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal((await response.arrayBuffer()).byteLength,3);
 assert.equal((await fetch(base+'/delivery-photos/1')).status,404);role='DRIVER';assert.equal((await fetch(base+'/delivery-photos/0')).status,403);
});
