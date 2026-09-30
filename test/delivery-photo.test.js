'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const sharp=require('sharp');
const {prepare,validPath}=require('../src/core/delivery-photo');
const {createPhotoWorker}=require('../src/core/delivery-photo-worker');
const {attachment}=require('../src/web/message-attachment');
const stamp=Date.parse('2026-09-30T02:00:00Z');
const customerId='11111111-1111-4111-8111-111111111111',messageId='22222222-2222-4222-8222-222222222222';
const path='delivery-sms/'+customerId+'/'+messageId+'.jpg';
const source='https://s3.us-west-2.amazonaws.com/qt.com.dashboard.order.signature/proof.jpg';
function fixture() {
 const order={id:'order',order_number:9019,status:'READY',customer_id:customerId,customers:{name:'Customer',status:'ACTIVE',phone:'+12015550111',default_payment_method_id:'pm_test',address_line1:'1 Home St',city:'Town',state:'NJ',postal_code:'07000'}};
 const shop={name:'Laundry',address_line1:'2 Shop St',city:'Town',state:'NJ',postal_code:'07000'};
 const plan={leg:'TO_CUSTOMER',shipday_order_id:'99',external_reference:'RETURN',mode:'IN_HOUSE',driver_id:'7'};
 const remote={orderId:99,orderNumber:'RETURN',restaurant:{address:'2 Shop St, Town, NJ, 07000'},customer:{address:'1 Home St, Town, NJ, 07000'},assignedCarrier:{id:7},orderStatus:{orderState:'ALREADY_DELIVERED'},proofOfDelivery:{imageUrls:[source]}};
 const row={id:messageId,order_id:'order',leg:'TO_CUSTOMER',event_key:'milestone-3',remote_id:'99',state:'SENT',photo_state:'WAITING',photo_version:0,created_at:new Date(stamp).toISOString()};
 const sent=[],saved=[];
 const store={plan:async()=>plan,context:async()=>({order,shop}),pendingPhotos:async()=>row.photo_state==='WAITING'?[{...row}]:[],expirePhotos:async()=>{},
  photoClaim:async()=>{if(row.photo_state!=='WAITING')return null;row.photo_state='PREPARING';row.photo_version++;return {...row};},
  photoUpdate:async(r,expected,state,problem,p)=>{if(row.photo_state!==expected || row.photo_version!==r.photo_version)return null;Object.assign(row,{photo_state:state,photo_problem:problem,...(p?{photo_path:p}:{})});return {id:row.id};}};
 const args={store,provider:{findOrders:async()=>[remote]},tracking:async()=>null,now:()=>stamp,
  savePhoto:async(r,o,url)=>{saved.push(url);return path;},send:async(to,body,id,options)=>{sent.push({to,body,id,options});return {sent:true,simulated:true};}};
 return {order,shop,plan,remote,row,store,args,sent,saved,worker:createPhotoWorker(args)};
}
test('photo paths are customer scoped and cannot be external URLs or arbitrary storage keys',()=>{
 assert.equal(validPath(path,customerId),true);
 for(const p of ['https://example.com/x.jpg','delivery-sms/../secret.jpg',path.replace('.jpg','Xjpg'),path.replace(customerId,messageId)])assert.equal(validPath(p,customerId),false);
 assert.match(attachment({id:messageId,customer_id:customerId,media_path:path}),/ops\/message-photos/);
 assert.equal(attachment({id:messageId,customer_id:messageId,media_path:path}),'');
});
test('MMS preparation strips metadata, keeps the full image, and stays within 290 KB',async()=>{
 const bytes=await sharp({create:{width:2000,height:1000,channels:3,background:'#bbccdd'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const image=await prepare(bytes),metadata=await sharp(image).metadata();
 assert.equal(metadata.format,'jpeg');assert.ok(image.length<=290000);assert.ok(Math.max(metadata.width,metadata.height)<=1600);
 assert.equal(metadata.exif,undefined);assert.equal(metadata.orientation,undefined);
});
test('late proof is sent once in the existing conversation after the delivered text',async()=>{
 const f=fixture();f.remote.proofOfDelivery.imageUrls=[];await f.worker.tick();assert.equal(f.sent.length,0);assert.equal(f.row.photo_state,'WAITING');
 f.remote.proofOfDelivery.imageUrls=[source];await f.worker.tick();await createPhotoWorker(f.args).tick();
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].id,customerId);assert.equal(f.sent[0].options.mediaPath,path);assert.equal(f.sent[0].options.noRetry,true);
 assert.doesNotMatch(f.sent[0].body,/http|shipday|Laundry|Shop St/);assert.equal(f.row.photo_state,'SIMULATED');
});
test('two workers cannot send the same customer photo twice',async()=>{
 const f=fixture();await Promise.all([f.worker.tick(),createPhotoWorker(f.args).tick()]);assert.equal(f.sent.length,1);
});
test('wrong leg, identity, driver, endpoints, opt-out, missing card and uncompleted trips send no photo',async()=>{
 for(const mutate of [f=>f.row.leg='TO_PARTNER',f=>f.row.state='REVIEW',f=>f.plan.leg='TO_PARTNER',f=>f.plan.shipday_order_id='100',
  f=>f.remote.orderId=100,f=>f.remote.orderNumber='OTHER',f=>f.remote.restaurant.address='OTHER',f=>f.remote.customer.address='OTHER',
  f=>f.remote.assignedCarrier.id=8,f=>f.remote.orderStatus.orderState='PICKED_UP',f=>f.remote.orderStatus.incomplete=true,
  f=>f.order.customers.status='UNSUBSCRIBED',f=>f.order.customers.default_payment_method_id=null,f=>f.order.status='CANCELED',
  f=>{delete f.remote.proofOfDelivery;f.remote.proofOfPickup={imageUrls:[source]};},f=>f.remote.proofOfDelivery.imageUrls=['http://127.0.0.1/private']]) {
  const f=fixture();mutate(f);await f.worker.tick();assert.equal(f.sent.length,0);
 }
});
test('completed historical trips are not photo candidates without a new delivered notification',async()=>{
 const f=fixture();f.row.photo_state=null;await f.worker.tick();assert.equal(f.sent.length,0);
 f.row.photo_state='WAITING';f.row.created_at=new Date(stamp-25*60*60000).toISOString();await f.worker.tick();assert.equal(f.sent.length,0);
});
test('uncertain photo send is reviewed without retry or duplicate',async()=>{
 const f=fixture();let attempts=0;f.args.send=async()=>{attempts++;throw Error('carrier timeout');};const w=createPhotoWorker(f.args);
 await w.tick();await w.tick();assert.equal(attempts,1);assert.equal(f.row.photo_state,'REVIEW');
});
test('preparation errors may retry but lost leases and changed proof never send stale photos',async()=>{
 const f=fixture();f.args.savePhoto=async()=>{throw Error('unavailable');};let w=createPhotoWorker(f.args);await w.tick();assert.equal(f.row.photo_state,'WAITING');
 for(const mutate of [()=>f.row.photo_version++,()=>f.remote.proofOfDelivery.imageUrls=[],()=>f.order.customer_id=messageId]) {
  f.row.photo_state='WAITING';f.remote.proofOfDelivery.imageUrls=[source];f.order.customer_id=customerId;
  f.args.savePhoto=async()=>{mutate();return path;};w=createPhotoWorker(f.args);await w.tick();assert.equal(f.sent.length,0);
 }
});
test('last-second STOP refusal prevents photo send and is not retried',async()=>{
 const f=fixture();f.args.send=async()=>({sent:false,refused:'opted_out'});await createPhotoWorker(f.args).tick();assert.equal(f.row.photo_state,'SKIPPED');
});

test('conversation photos require employee permission and a matching customer-owned path',async t=>{
 const express=require('express'),{register}=require('../src/routes/message-photos');
 const image=await sharp({create:{width:10,height:10,channels:3,background:'#fff'}}).jpeg().toBuffer();
 let wrong=false,downloads=0;
 const db={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{customer_id:wrong?messageId:customerId,media_path:path}})}),
  storage:{from:()=>({download:async()=>{downloads++;return {data:{arrayBuffer:async()=>image}};}})}};
 const app=express();register(app,{db,guard:(req,res,next)=>req.headers.authorization==='test'?next():res.sendStatus(401),may:()=>((req,res,next)=>req.headers['x-role']==='employee'?next():res.sendStatus(403))});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const url='http://127.0.0.1:'+server.address().port+'/ops/message-photos/'+messageId;
 assert.equal((await fetch(url)).status,401);
 assert.equal((await fetch(url,{headers:{authorization:'test'}})).status,403);
 const headers={authorization:'test','x-role':'employee'};
 const result=await fetch(url,{headers});assert.equal(result.status,200);assert.match(result.headers.get('content-type'),/image\/jpeg/);assert.match(result.headers.get('cache-control'),/private/);
 wrong=true;assert.equal((await fetch(url,{headers})).status,404);assert.equal(downloads,1);
});

test('missing older photos do not starve newer completed deliveries',async()=>{
 const db=require('../src/db'),{store}=require('../src/core/delivery-sms-runtime');
 const original=db.from,filters=[];let page=0;
 db.from=()=>{const q={select(){return q;},eq(){return q;},in(){return q;},order(){return q;},limit(){return q;},gt(k,v){filters.push(v);return q;},then(resolve){return Promise.resolve({data:page++===0?Array.from({length:25},(_,i)=>({id:String(i)})):[{id:'newer'}],error:null}).then(resolve);}};return q;};
 try{await store.pendingPhotos();await store.pendingPhotos();await store.pendingPhotos();assert.deepEqual(filters,['24']);}
 finally{db.from=original;}
});


test('employee conversation renders delivery attachments alongside escaped message text',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const file=require.resolve('../src/routes/admin');
 const source=fs.readFileSync(file,'utf8');
 const start=source.indexOf('function bubble(m) {');
 const end=source.indexOf("router.get('/ops/messages/:phone'",start);
 const context={require:require('node:module').createRequire(file),escapeHtml:require('../src/web/layout').escapeHtml,dateTime:()=>'',deliveryNote:()=>''};
 vm.runInNewContext(source.slice(start,end),context);
 const message={id:messageId,customer_id:customerId,media_path:path,direction:'OUTBOUND',body:'Your delivery <photo>'};
 const html=context.bubble(message);
 assert.match(html,/Your delivery &lt;photo&gt;/);
 assert.match(html,new RegExp('/ops/message-photos/'+messageId));
 assert.doesNotMatch(html,/shipday|https:/i);
 assert.doesNotMatch(context.bubble({...message,media_path:null}),/<img/);
});
