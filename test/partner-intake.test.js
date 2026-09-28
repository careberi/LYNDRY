'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { validIntake, complete, createService } = require('../src/core/partner-intake');
const { createRouter, token } = require('../src/routes/shop-intake-routes');
const page = require('../src/web/shop-intake-page');
const ctx = { lang:'en', shop:{id:'shop',name:'Test laundry'}, csrf:'csrf-test', orders:[] };
const incoming = {number:9015,stage:'INCOMING',reference:'LYNDRY-9015-PICKUP',courier:'Uber',driver:'Test driver',canAccept:true};
const intake = {...incoming,stage:'INCOMING',receivedAt:'2026-09-27T12:00:00Z'};
const washed = {...intake,stage:'WASH',tracking:'T-501',weight:33,washLines:[['Water','Cold']]};

test('intake requires measured full-order weight within 50 lb',()=>{
  for (const bad of ['', '0','-1','51','NaN','Infinity','1e1','1.234']) assert.equal(validIntake(bad),false,bad);
  assert.equal(validIntake('33.25'),true);
  assert.equal(validIntake('50'),true);
});
test('persisted receipt alone or partial intake never unlocks instructions',()=>{
  const saved={received_at:'now',received_verified_at:'now',tracking_number:'T-1',weight_lb:33,completed_at:'now',completed_by:'attendant'};
  assert.equal(complete(saved),true);
  for (const field of ['received_at','received_verified_at','weight_lb','completed_at','completed_by']) assert.equal(complete({...saved,[field]:null}),false,field);
});
test('incoming delivery combines weight and physical receipt without revealing instructions',()=>{
  const html=page.detail({...ctx,order:{...incoming,washLines:[['SECRET','SECRET_WASH']]}});
  assert.match(html,/Accept laundry and show wash instructions/); assert.match(html,/LYNDRY-9015-PICKUP/);
  assert.doesNotMatch(html,/SECRET_WASH|name="tracking_number"|Code for the courier|bag count/i);
});
test('incoming order requests weight only and keeps instructions absent in both languages',()=>{
  for(const lang of ['en','es']){
    const html=page.detail({...ctx,lang,order:{...intake,washLines:[['SECRET','SECRET_WASH']]}});
    assert.doesNotMatch(html,/name="tracking_number"/); assert.match(html,/name="weight_lb"/);
    assert.doesNotMatch(html,/SECRET_WASH|\/ready"/);
  }
});
test('saved intake shows structured wash instructions and readiness action',()=>{
  const html=page.detail({...ctx,order:washed});
  assert.match(html,/Cold/);assert.doesNotMatch(html,/T-501/);assert.match(html,/\/9015\/ready/);
  assert.doesNotMatch(html,/name="weight_lb"|name="tracking_number"/);
});
test('private customer fields and tracking links never enter the rendered portal',()=>{
  const privateOrder={...washed,name:'PRIVATE_NAME',phone:'PRIVATE_PHONE',email:'PRIVATE_EMAIL',address:'PRIVATE_ADDRESS',
    price_cents:'PRIVATE_PRICE',tracking_url:'https://example.com/PRIVATE_TRACKING',instructions:'PRIVATE_NOTES',bag_count:999,
    pin:'PRIVATE_PIN',customers:{name:'PRIVATE_NESTED'}};
  for(const html of [page.detail({...ctx,order:privateOrder}),page.board({...ctx,orders:[privateOrder]})]){
    assert.doesNotMatch(html,/PRIVATE_|999|tracking_url/);
  }
});
test('internal tickets and driver names are escaped, not executable markup',()=>{
  const html=page.detail({...ctx,order:{...incoming,driver:'<img onerror=alert(1)>'}});
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img onerror/);
});

test('board filters search only anonymous order identifiers',()=>{
  const orders=[{...incoming,customers:{name:'SECRET_CUSTOMER'}}, {...washed,number:9016,tracking:'SHOP-62'}];
  const matched=page.board({...ctx,orders,query:'9016',stage:'WASH'});
  assert.match(matched,/href="\/shop\/orders\/9016\?lang=en"/);
  assert.doesNotMatch(matched,/href="\/shop\/orders\/9015\?lang=en"/);
  const blocked=page.board({...ctx,orders,query:'SECRET_CUSTOMER'});
  assert.match(blocked,/No orders in this section/);
  assert.doesNotMatch(blocked,/href="\/shop\/orders\//);
  assert.match(page.board({...ctx,orders,stage:'READY'}),/No orders in this section/);
});
test('courier delivered status cannot turn an incoming delivery into an accepted order',()=>{
  const html=page.detail({...ctx,order:{...incoming,status:'DELIVERED',washLines:[['SECRET','SECRET_WASH']]}});
  assert.match(html,/Accept laundry and show wash instructions/);assert.doesNotMatch(html,/SECRET_WASH/);
});

test('order detail only fetches preferences after durable intake and keeps shop scope',async()=>{
  let saved=false; const queries=[];
  const db={from(table){let selected;const filters=[];
    const q={select(v){selected=v;return q;},or(v){filters.push(v);return q;},eq(k,v){filters.push([k,v]);return q;},in(){return q;},order(){return q;},maybeSingle(){return q;},
      then(resolve){queries.push({table,selected,filters});
        let data;
        if(table==='orders'&&selected.includes('preferences'))data={preferences:{water_temp:'cold'}};
        else if(table==='orders')data=[{id:'one',order_number:9015,status:'AT_PARTNER'}];
        else if(table==='partner_order_intakes')data=saved?[{order_id:'one',received_at:'now',received_verified_at:'now',completed_at:'now',completed_by:'staff',tracking_number:'T-1',weight_lb:33}]:[];
        else data=[];
        return Promise.resolve({data,error:null}).then(resolve);
      }};return q;}};
  const service=createService({db});
  assert.equal((await service.detail('shop','9015')).stage,'INCOMING');
  assert.ok(!queries.some(q=>q.selected.includes('preferences')));
  assert.ok(queries[0].filters[0].includes('partner_id.eq.shop'));
  saved=true;
  assert.ok((await service.detail('shop','9015')).washLines.length>0);
  assert.deepEqual(queries.at(-1).filters.find(f=>f[0]==='partner_id'),['partner_id','shop']);
});

test('HTTP intake rejects CSRF and missing orders; valid mutations use signed-in shop and staff',async t=>{
  const calls=[];const user={id:'staff',role:'ATTENDANT',name:'Test',session_token:'secret-test-session'};
  const service={list:async()=>[incoming],detail:async(p,n)=>n==='9015'?intake:null,act:async args=>{calls.push(args);return {ok:true,notice:'intake'};}};
  const app=express();app.use(express.urlencoded({extended:false}));app.use((req,res,next)=>{req.partner=ctx.shop;req.partnerUser=user;next();});app.use(createRouter(service));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const post=body=>fetch(base+'/shop/orders/9015/intake',{method:'POST',redirect:'manual',body:new URLSearchParams(body)});
  assert.equal((await post({weight_lb:'33'})).status,403);assert.equal(calls.length,0);
  assert.equal((await post({csrf:'é'.repeat(64),weight_lb:'33'})).status,403);assert.equal(calls.length,0);
  assert.equal((await fetch(base+'/shop/orders/9999')).status,404);
  const response=await post({csrf:token(user),tracking_number:'T-1',weight_lb:'33',partner:'another-shop',staff:'somebody-else'});
  assert.equal(response.status,303);assert.equal(calls[0].partner,'shop');assert.equal(calls[0].staff.id,'staff');
  assert.equal(response.headers.get('cache-control'),'no-store');
});

test('a ready notice never hides an unresolved office review or implies a driver is assigned',()=>{
  const html=page.detail({...ctx,notice:'ready',order:{...washed,stage:'READY',officeReview:true,assigned:false}});
  assert.match(html,/Contact LYNDRY before releasing this order/);
  assert.match(html,/No return driver is assigned yet/);
  assert.doesNotMatch(html,/Marked ready\. LYNDRY will/);
});

test('new Shipday pickup assignments request no PIN and retain the anonymous reference',async()=>{
  const {createDispatcher}=require('../src/core/shipday-dispatch');
  let row={id:'plan',order_id:'one',leg:'TO_PARTNER',state:'PLANNED',mode:'THIRD_PARTY',version:0,dispatch_at:'2026-09-01T00:00:00Z'};
  let params,created;
  const store={get:async()=>({...row}),claim:async()=>({...row}),save:async(r,p)=>row={...row,...p}};
  const provider={createOrder:async p=>{created=p;return{id:'12'};},assign:async(id,p)=>{params=p;return{ok:true,service:'Uber'};}};
  const run=createDispatcher({store,provider,validate:async()=>({ok:true,budgetCents:1000,trip:{externalId:'LYNDRY-9015-PICKUP'}})}).run;
  assert.equal((await run('plan')).ok,true);assert.equal(params.requirePin,false);assert.equal(params.leaveAtDoor,false);
  assert.equal(created.externalId,'LYNDRY-9015-PICKUP');assert.equal(row.external_reference,created.externalId);
});

test('ready intake requests the return for every order and preserves readiness when dispatch fails',async()=>{
  const order={id:'one',order_number:9015,partner_id:'shop',dev_quote_id:'quote',status:'READY'};
  const holds=[];const enrollments=[];let fail=false;
  const db={rpc:async()=>({data:{ok:true},error:null}),from(table){const q={select(){return q;},or(){return q;},eq(){return q;},in(){return q;},maybeSingle(){return q;},single(){return q;},update(value){holds.push(value);return q;},then(resolve){return Promise.resolve({data:table==='orders'?order:null,error:null}).then(resolve);}};return q;}};
  const service=createService({db,enrollReturn:async o=>{enrollments.push(o.id);if(fail)throw Error('temporarily unavailable');return {ok:true};}});
  const args={partner:'shop',staff:{id:'staff',name:'Attendant'},number:'9015',action:'ready'};
  assert.equal((await service.act(args)).notice,'return_requested');
  assert.deepEqual(enrollments,['one']);assert.equal(holds.length,0);
  fail=true;
  assert.equal((await service.act(args)).notice,'return_pending');
  assert.deepEqual(holds,[]);
});
