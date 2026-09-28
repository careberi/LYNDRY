'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {beforeDispatch}=require('../src/core/courier-quote-check');
const retired=require('../src/core/spending-controls');
const quote={ok:true,quoteId:'q1',feeCents:1200,expiresAt:'2099-01-01T00:00:00Z'};
test('archived spending caps cannot block a valid courier quote',async()=>{
 let calls=0;
 const result=await beforeDispatch({id:'old',price_cents:10000},{leg:'TO_PARTNER',from:'home',to:'shop',courier:{quote:async()=>{calls++;return quote;}}});
 assert.equal(result.ok,true);assert.equal(result.quoteId,'q1');assert.equal(calls,2);assert.equal(result.approvalRequired,undefined);
 assert.equal((await retired.check('old',10000)).ok,true);
 assert.throws(()=>retired.propose({}),/retired/);assert.throws(()=>retired.approve({}),/retired/);
});
test('invalid or unavailable courier quotes still stop dispatch',async()=>{
 for(const q of [{ok:false},{...quote,feeCents:null},{...quote,feeCents:-1},{...quote,quoteId:null},{...quote,expiresAt:'2000-01-01'}]) {
  assert.equal((await beforeDispatch({}, {leg:'TO_CUSTOMER',courier:{quote:async()=>q}})).ok,false);
 }
 assert.equal((await beforeDispatch({}, {leg:'TO_PARTNER',courier:{quote:async()=>{throw Error('Offline');}}})).ok,false);
});
test('a failed return quote blocks pickup but return dispatch only quotes its own leg',async()=>{
 let calls=0;
 const courier={quote:async()=>++calls===1?quote:{ok:false}};
 assert.equal((await beforeDispatch({}, {leg:'TO_PARTNER',courier})).ok,false);
 calls=0;assert.equal((await beforeDispatch({}, {leg:'TO_CUSTOMER',courier})).ok,true);assert.equal(calls,1);
});
test('retired approval URLs preserve auth and CSRF; stale forms cannot write',async t=>{
 const routes=require('../src/routes/spending-routes');
 const app=express();const auth=(req,res,next)=>req.get('x-auth')==='yes'?next():res.sendStatus(401);
 routes.registerAdmin(app,{guard:auth,may:()=>auth});routes.registerCustomer(app,{requireCustomer:auth});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 for(const [url,destination] of [['/ops/spending','/ops'],['/account/orders/old/spending','/account']]) {
  assert.equal((await fetch(base+url,{redirect:'manual'})).status,401);
  const get=await fetch(base+url,{redirect:'manual',headers:{'x-auth':'yes'}});
  assert.equal(get.status,303);assert.equal(get.headers.get('location'),destination);
  assert.equal((await fetch(base+url,{method:'POST',headers:{'x-auth':'yes',origin:'https://wrong.test'}})).status,403);
  assert.equal((await fetch(base+url,{method:'POST',headers:{'x-auth':'yes',origin:base}})).status,410);
 }
});
test('paid payment retries remain idempotent after retiring spending approval',async()=>{
 const billing=require('../src/core/billing');
 const original=retired.check;retired.check=()=>{throw Error('Must not read archived approval');};
 try {assert.equal((await billing.chargeOrder({payment_status:'PAID',price_cents:6000},{})).alreadyPaid,true);}
 finally {retired.check=original;}
});
