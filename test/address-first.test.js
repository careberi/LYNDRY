'use strict';
// These checkout tests isolate courier coverage; Google validation has its own tests.
process.env.GOOGLE_ADDRESS_ENABLED='false';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const auth=require('../src/core/customer-auth');
const settings=require('../src/core/settings');
const booking=require('../src/core/booking');
const onboarding=require('../src/core/onboarding');
const db=require('../src/db');
const checkout=require('../src/core/dev-checkout');

test('booking starts with saved-address confirmation and removes premature plan prices',async t=>{
  const customer={id:'test-customer',name:'Test Customer',phone:'+12015550100',address_line1:'1 Test Street',city:'Lodi',postal_code:'07644',preferences:{water_temp:'cold',fabric_softener:'standard',special_instructions:'Front door'}};
  const originals={preview:checkout.previewQuote,attach:auth.attachCustomer,opens:settings.opensOn,zip:booking.zipInServiceArea,refresh:booking.refreshBookedOrders,from:db.from,preferences:booking.hasPreferences};
  checkout.previewQuote=async()=>({});
  auth.attachCustomer=async req=>{req.customer=customer;};
  settings.opensOn=async()=>null;
  booking.zipInServiceArea=async()=>true;
  booking.refreshBookedOrders=async()=>{};
  booking.hasPreferences=()=>true;
  let writes=0;
  db.from=table=>{assert.equal(table,'customers');return {update:()=>({eq:async()=>{writes++;return {error:null};}})};};
  t.after(()=>{checkout.previewQuote=originals.preview;auth.attachCustomer=originals.attach;settings.opensOn=originals.opens;booking.zipInServiceArea=originals.zip;booking.refreshBookedOrders=originals.refresh;booking.hasPreferences=originals.preferences;db.from=originals.from;});
  const app=express();app.use(express.urlencoded({extended:false}));app.use(require('../src/routes/account').router);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  let html=await(await fetch(base+'/account/book')).text();
  assert.match(html,/Where should we pick up\?/);assert.match(html,/1 Test Street/);assert.doesNotMatch(html,/One-Time Pickup.*\$2/);
  const post=async data=>fetch(base+'/account/book',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)});
  const invalid=await post({step:'address',name:'Test',postal_code:'bad'});assert.equal(invalid.status,400);assert.equal(writes,0);
  html=await(await post({step:'address',name:'Test Customer',address_line1:'1 Test Street',city:'Lodi',postal_code:'07644',spot:'Front door'})).text();
  assert.match(html,/Schedule your pickup/);assert.match(html,/name="address_confirmed" value="yes"/);assert.doesNotMatch(html,/\$2\.00|\$1\.80|Save 10%/);assert.equal(writes,1);
  html=await(await post({step:'repeat',address_confirmed:'yes',plan:'ONE_TIME'})).text();
  assert.match(html,/Schedule your pickup/);
  assert.match(html,/Pickup times depend on the laundromats/);
  assert.match(html,/<select[^>]*name="pickup_time"/);
  assert.doesNotMatch(html,/<input[^>]*name="pickup_time"[^>]*\bmax=/);

  html=await(await post({step:'repeat',back:'address',address_confirmed:'yes',plan:'ONE_TIME'})).text();assert.match(html,/Where should we pick up\?/);assert.equal(writes,1);
  // Old forms cannot skip the newly required first screen.
  html=await(await post({step:'repeat',plan:'ONE_TIME'})).text();assert.match(html,/Where should we pick up\?/);
});

test('guest address saves before wash preferences without inventing answers',async t=>{
 const originals={preview:checkout.previewQuote,attach:auth.attachCustomer,read:auth.readGuest,opens:settings.opensOn,zip:booking.zipInServiceArea,refresh:booking.refreshBookedOrders,from:db.from,start:onboarding.startConversation};
 checkout.previewQuote=async()=>({});
 auth.attachCustomer=async()=>{};auth.readGuest=()=>'+12015550100';settings.opensOn=async()=>null;
 booking.zipInServiceArea=async()=>true;booking.refreshBookedOrders=async()=>{};
 const changes=[];db.from=()=>({update:change=>({eq:async()=>{changes.push(change);return {error:null};}})});
 let started=0;onboarding.startConversation=async()=>{started++;return {ok:true,created:false,customer:{id:'test-guest',phone:'+12015550100',preferences:{}}};};
 t.after(()=>{checkout.previewQuote=originals.preview;auth.attachCustomer=originals.attach;auth.readGuest=originals.read;settings.opensOn=originals.opens;booking.zipInServiceArea=originals.zip;booking.refreshBookedOrders=originals.refresh;db.from=originals.from;onboarding.startConversation=originals.start;});
 const app=express();app.use(express.urlencoded({extended:false}));app.use(require('../src/routes/account').router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 const post=async data=>fetch(base+'/account/book',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)});
 let response=await post({step:'address',name:'Test'});assert.equal(response.status,400);assert.equal(started,0);
 response=await post({step:'address',sms_consent:'yes',name:'Test Customer',address_line1:'1 Test Street',city:'Lodi',postal_code:'07644',spot:'Front door'});
 assert.equal(response.status,200);const html=await response.text();assert.match(html,/How would you like it washed/);assert.match(html,/name="address_confirmed" value="yes"/);assert.equal(started,1);
 assert.ok(changes.every(c=>!c.preferences.water_temp&&!c.preferences.fabric_softener));
});


test('Fair Lawn signup uses the full address and handles coverage separately from lookup failure',async t=>{
 const originals={attach:auth.attachCustomer,opens:settings.opensOn,zip:booking.zipInServiceArea,refresh:booking.refreshBookedOrders,from:db.from,preview:checkout.previewQuote};
 const customer={id:'test-customer',phone:'+12015550100',lat:1,lng:2,preferences:{water_temp:'cold',fabric_softener:'standard'}};
 auth.attachCustomer=async req=>{req.customer=customer;}; settings.opensOn=async()=>null;
 booking.refreshBookedOrders=async()=>{};
 let legacyCalls=0,writes=0,checked=[];
 booking.zipInServiceArea=async()=>{legacyCalls++;return false;};
 checkout.previewQuote=async(address,form,options)=>{checked.push({address,options});return {};};
 db.from=table=>{assert.equal(table,'customers');return {update:()=>({eq:async()=>{writes++;return {error:null};}})};};
 t.after(()=>{auth.attachCustomer=originals.attach;settings.opensOn=originals.opens;booking.zipInServiceArea=originals.zip;booking.refreshBookedOrders=originals.refresh;db.from=originals.from;checkout.previewQuote=originals.preview;});
 const app=express();app.use(express.urlencoded({extended:false}));app.use(require('../src/routes/account').router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const form={step:'address',name:'Test Customer',address_line1:'16-50 Chandler Dr.',address_line2:'Unit 2',city:'Fair Lawn',postal_code:'07410',spot:'Front door'};
 const post=extra=>fetch('http://127.0.0.1:'+server.address().port+'/account/book',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...form,...extra})});
 let response=await post({});assert.equal(response.status,200);assert.match(await response.text(),/Schedule your pickup/);
 assert.equal(legacyCalls,0);assert.equal(writes,1);
 assert.deepEqual(checked[0],{address:{address_line1:'16-50 Chandler Dr.',address_line2:'Unit 2',city:'Fair Lawn',state:'NJ',postal_code:'07410'},options:{publicPreview:true,addressEstimate:true}});
 response=await post({postal_code:'10036'});assert.equal(response.status,400);assert.match(await response.text(),/serve New Jersey/);assert.equal(checked.length,1);
 for(const [failure,expected] of [
  ['No eligible laundromat is available for this pickup.',/not operating at this address/],
  ['Shipday is unavailable.',/could not verify pickup availability/],
  ['The pickup address could not be located.',/could not find that address/]
 ]) {
  checkout.previewQuote=async()=>{throw Error(failure);};
  response=await post({});assert.equal(response.status,400);
  const html=await response.text();assert.match(html,expected);assert.doesNotMatch(html,/cannot pick up from 07410|only cover New Jersey/);
  assert.equal(writes,1);
 }
});


test('development booking asks schedule before plans and prices the submitted schedule',async t=>{
 const customer={id:'test-customer',name:'Test',address_line1:'1 Test Street',city:'Lodi',postal_code:'07644',preferences:{water_temp:'cold',fabric_softener:'standard',special_instructions:'Front door'}};
 const originals={preview:checkout.previewQuote,attach:auth.attachCustomer,opens:settings.opensOn,refresh:booking.refreshBookedOrders};
 const previews=[];
 checkout.previewQuote=async(_customer,form,options)=>{previews.push({form:{...form},options});return {categories:{ONE_TIME:{},SUBSCRIPTION:{}},snapshot:{}};};
 auth.attachCustomer=async req=>{req.customer=customer;};settings.opensOn=async()=>null;booking.refreshBookedOrders=async()=>{};
 t.after(()=>{checkout.previewQuote=originals.preview;auth.attachCustomer=originals.attach;settings.opensOn=originals.opens;booking.refreshBookedOrders=originals.refresh;});
 const app=express();app.use(express.urlencoded({extended:false}));app.use(require('../src/routes/account').router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 const post=extra=>fetch(base+'/account/book',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({address_confirmed:'yes',...extra})});
 let response=await post({step:'entry'});let html=await response.text();assert.match(html,/Schedule your pickup/);assert.match(html,/Earliest available pickup/);assert.match(html,/>Pick up now</);assert.match(html,/>Schedule</);assert.match(html,/value="13:00"/);assert.doesNotMatch(html,/value="13:30"|value="13:15"|Allow at least/);assert.match(html,/check-box check-box-round/);assert.doesNotMatch(html,/Choose your option/);
 response=await post({step:'when',pickup_date:'2030-01-01',pickup_time:'13:42'});html=await response.text();
 assert.match(html,/Choose your pricing method/);assert.doesNotMatch(html,/value="MONTHLY"|every month/i);assert.match(html,/booking-pricing-content/);assert.equal(previews.at(-1).form.pickup_date,'2030-01-01');assert.equal(previews.at(-1).form.pickup_time,'13:42');
 assert.equal(previews.at(-1).options.addressEstimate,undefined);assert.match(html,/name="pickup_date" value="2030-01-01"/);
 response=await post({step:'repeat',back:'when',plan:'SUBSCRIPTION',cadence:'WEEKLY',pickup_date:'2030-01-01',pickup_time:'13:42'});
 html=await response.text();assert.match(html,/type="date"/);assert.doesNotMatch(html,/name="weekday"/);
});
