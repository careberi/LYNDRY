'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRecovery}=require('../src/core/order-recovery');
function fixture(){
 const now=Date.now(),order={id:'o',status:'OUT_FOR_DELIVERY',payment_status:'PAID'},plan={id:'p',leg:'TO_CUSTOMER',shipday_order_id:'123',simulation:false};
 const seen={rank:3,terminal:true,remoteId:'123',observedAt:new Date(now).toISOString(),deliveryPhotos:['proof']};
 const calls=[];const recover=createRecovery({now:()=>now,load:async()=>({order,plan}),observe:async()=>seen,savePhoto:async()=>{calls.push('photo');return 'path';},complete:async x=>{calls.push(x);order.status='DELIVERED';return {ok:true};},note:async()=>calls.push('note')});
 return {recover,order,plan,seen,calls};
}
test('verified sync completes once without repeating effects',async()=>{
 const f=fixture();await f.recover(1,'sync',{},{});await f.recover(1,'sync',{},{});assert.equal(f.calls.length,2);assert.equal(f.calls[1].source,'SHIPDAY');
});
for(const state of ['REQUESTED','READY','CANCELED'])test('recovery rejects '+state,async()=>{const f=fixture();f.order.status=state;await assert.rejects(f.recover(1,'sync',{},{}));assert.equal(f.calls.length,0);});
test('unpaid delivery cannot complete',async()=>{const f=fixture();f.order.payment_status='FAILED';await assert.rejects(f.recover(1,'sync',{},{}),/payment/);assert.equal(f.calls.length,0);});
test('unverified, wrong trip, stale evidence and missing proof fail closed',async()=>{
 for(const patch of [{terminal:false},{remoteId:'999'},{observedAt:'invalid'},{observedAt:new Date(0).toISOString()},{deliveryPhotos:[]}]){const f=fixture();Object.assign(f.seen,patch);await assert.rejects(f.recover(1,'sync',{},{}));assert.equal(f.calls.length,0);}
});
test('simulation cannot impersonate real Shipday completion',async()=>{const f=fixture();f.plan.simulation=true;await assert.rejects(f.recover(1,'sync',{},{}));});
test('manual completion needs reason and attestation but no photo',async()=>{
 const good={reason:'Confirmed with customer',confirmed:'yes'};
 for(const key of ['reason','confirmed']){const f=fixture(),input={...good};delete input[key];await assert.rejects(f.recover(1,'deliver',input,{}));assert.equal(f.calls.length,0);}
 const f=fixture();await f.recover(1,'deliver',good,{});assert.equal(f.calls.length,1);assert.equal(f.calls[0].source,'MANUAL');assert.equal(f.calls[0].path,null);
});
test('notes do not complete orders and invalid commands fail',async()=>{const f=fixture();await f.recover(1,'note',{reason:'Internal note'},{});assert.equal(f.order.status,'OUT_FOR_DELIVERY');assert.deepEqual(f.calls,['note']);await assert.rejects(f.recover(1,'arbitrary-status',{},{}));});
test('admin recovery controls do not depend on legacy driver tasks',()=>{
 const {render}=require('../src/web/order-header-actions');
 const html=render({order:{order_number:1,dev_quote_id:'q',status:'OUT_FOR_DELIVERY'},can:{override:true}});
 for(const s of ['Sync with Shipday','Add internal note','Manage delivery','recovery/deliver','name="confirmed"'])assert.ok(html.includes(s));
 assert.doesNotMatch(html,/name="photo"/);
 assert.doesNotMatch(render({order:{dev_quote_id:'q'},can:{act:true}}),/recovery\//);
});
