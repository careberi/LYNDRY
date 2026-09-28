'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const auth=require('../src/core/customer-auth');
const settings=require('../src/core/settings');
const booking=require('../src/core/booking');
const onboarding=require('../src/core/onboarding');
const db=require('../src/db');

test('booking starts with saved-address confirmation and removes premature plan prices',async t=>{
  const customer={id:'test-customer',name:'Test Customer',phone:'+12015550100',address_line1:'1 Test Street',city:'Lodi',postal_code:'07644',preferences:{water_temp:'cold',fabric_softener:'standard',special_instructions:'Front door'}};
  const originals={attach:auth.attachCustomer,opens:settings.opensOn,zip:booking.zipInServiceArea,refresh:booking.refreshBookedOrders,from:db.from,preferences:booking.hasPreferences};
  auth.attachCustomer=async req=>{req.customer=customer;};
  settings.opensOn=async()=>null;
  booking.zipInServiceArea=async()=>true;
  booking.refreshBookedOrders=async()=>{};
  booking.hasPreferences=()=>true;
  let writes=0;
  db.from=table=>{assert.equal(table,'customers');return {update:()=>({eq:async()=>{writes++;return {error:null};}})};};
  t.after(()=>{auth.attachCustomer=originals.attach;settings.opensOn=originals.opens;booking.zipInServiceArea=originals.zip;booking.refreshBookedOrders=originals.refresh;booking.hasPreferences=originals.preferences;db.from=originals.from;});
  const app=express();app.use(express.urlencoded({extended:false}));app.use(require('../src/routes/account').router);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  let html=await(await fetch(base+'/account/book')).text();
  assert.match(html,/Where should we pick up\?/);assert.match(html,/1 Test Street/);assert.doesNotMatch(html,/One-Time Pickup.*\$2/);
  const post=async data=>fetch(base+'/account/book',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)});
  const invalid=await post({step:'address',name:'Test',postal_code:'bad'});assert.equal(invalid.status,400);assert.equal(writes,0);
  html=await(await post({step:'address',name:'Test Customer',address_line1:'1 Test Street',city:'Lodi',postal_code:'07644',spot:'Front door'})).text();
  assert.match(html,/One-Time or Subscription\?/);assert.match(html,/name="address_confirmed" value="yes"/);assert.doesNotMatch(html,/\$2\.00|\$1\.80|Save 10%/);assert.equal(writes,1);
  html=await(await post({step:'repeat',address_confirmed:'yes',plan:'ONE_TIME'})).text();
  assert.match(html,/Schedule your pickup/);
  html=await(await post({step:'repeat',back:'address',address_confirmed:'yes',plan:'ONE_TIME'})).text();assert.match(html,/Where should we pick up\?/);assert.equal(writes,1);
  // Old forms cannot skip the newly required first screen.
  html=await(await post({step:'repeat',plan:'ONE_TIME'})).text();assert.match(html,/Where should we pick up\?/);
});

test('guest address saves before wash preferences without inventing answers',async t=>{
 const originals={attach:auth.attachCustomer,read:auth.readGuest,opens:settings.opensOn,zip:booking.zipInServiceArea,refresh:booking.refreshBookedOrders,from:db.from,start:onboarding.startConversation};
 auth.attachCustomer=async()=>{};auth.readGuest=()=>'+12015550100';settings.opensOn=async()=>null;
 booking.zipInServiceArea=async()=>true;booking.refreshBookedOrders=async()=>{};
 const changes=[];db.from=()=>({update:change=>({eq:async()=>{changes.push(change);return {error:null};}})});
 let started=0;onboarding.startConversation=async()=>{started++;return {ok:true,created:false,customer:{id:'test-guest',phone:'+12015550100',preferences:{}}};};
 t.after(()=>{auth.attachCustomer=originals.attach;auth.readGuest=originals.read;settings.opensOn=originals.opens;booking.zipInServiceArea=originals.zip;booking.refreshBookedOrders=originals.refresh;db.from=originals.from;onboarding.startConversation=originals.start;});
 const app=express();app.use(express.urlencoded({extended:false}));app.use(require('../src/routes/account').router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 const post=async data=>fetch(base+'/account/book',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)});
 let response=await post({step:'address',name:'Test'});assert.equal(response.status,400);assert.equal(started,0);
 response=await post({step:'address',sms_consent:'yes',name:'Test Customer',address_line1:'1 Test Street',city:'Lodi',postal_code:'07644',spot:'Front door'});
 assert.equal(response.status,200);const html=await response.text();assert.match(html,/How would you like it washed/);assert.match(html,/name="address_confirmed" value="yes"/);assert.equal(started,1);
 assert.ok(changes.every(c=>!c.preferences.water_temp&&!c.preferences.fabric_softener));
});
