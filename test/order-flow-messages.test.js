'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const booking=require('../src/core/booking');
const customer={id:'c',stripe_customer_id:'cus_test',default_payment_method_id:'pm_test',card_brand:'visa',card_last4:'4242',address_line1:'Test road',preferences:{}};
const snapshot={pricingMethod:'WEIGHT_BASED_MARGIN_V1',category:'ONE_TIME',estimatedWeightLb:30,wholesaleCentsPerLb:70,customerBaseCentsPerLb:100,pickupCents:699,returnCents:699,minimumTotalCents:2800,policy:{pricingMethod:'WEIGHT_BASED_MARGIN_V1',marginBps:{ONE_TIME:2000},processingBps:290,processingFixedCents:30,otherCostCents:0,otherCostPerLbCents:0}};
const order={order_number:9025,pickup_date:'2026-10-03',pickup_time:'10:00',pricing_snapshot:snapshot,authorization_intent_id:'pi_test',authorized_cents:2500};
test('saved quote confirmation explains its hold, measured settlement and conditional return',()=>{
 const text=booking.confirmationMessage(customer,order,{source:booking.DOORS.WEB});
 assert.match(text,/Estimated total/);assert.doesNotMatch(text,/\$2\.00 a pound|\$45\.00|at your door/);
 assert.match(text,/hold \$25\.00/);assert.match(text,/Visa ending 4242/);assert.match(text,/laundromat weighs/);assert.match(text,/next day when available/);
 assert.equal(booking.confirmationMessage(customer,order).replace('Of course! ',''),text);
});
test('legacy accepted price remains while future confirmation uses conditional turnaround',()=>{
 const text=booking.confirmationMessage(customer,{...order,pricing_snapshot:null,price_per_lb_cents:180});
 assert.match(text,/\$1\.80/);assert.match(text,/next day when available/);
});
for(const file of ['orders','booking-intents'])test(file+' refuses a missing development quote before storage',async()=>{
 const source=fs.readFileSync(require.resolve('../src/core/'+file),'utf8').replace(/\r\n/g,'\n');const start=source.indexOf(file==='orders'?'async function create(':'async function save(');
 const end=source.indexOf('\n}\n',start)+2;let writes=0;
 const context={openFor:async()=>null,config:{supabase:{isDevelopment:true}},require:()=>({enabled:true}),db:{from(){writes++;throw Error('storage reached');}}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 await assert.rejects(file==='orders'?context.create({customerId:'c'}):context.save(customer,{}),/quote/i);assert.equal(writes,0);
});
test('pickup movement and collection explain the next customer action without promising a date',()=>{
 const {nextMessage}=require('../src/core/delivery-sms');const now=Date.now();const plan={leg:'TO_PARTNER'};const seen={rank:1,observedAt:new Date(now).toISOString(),etaMinutes:null};
 assert.match(nextMessage({...order,customers:customer},plan,{rank:0},seen,now).body,/have your bag ready/i);
 assert.match(nextMessage({...order,customers:customer},plan,{rank:1},{...seen,rank:3},now).body,/next day when available.*let you know/i);
 assert.equal(nextMessage({...order,customers:{}},plan,{rank:0},seen,now),null);
});
test('message receipt labels distinguish simulation, delivery and failure including historical fake IDs',()=>{
 let note;try{note=require('../src/web/message-delivery-note');}catch{note=()=>'';}
 for(const row of [{delivery_status:'simulated'},{provider_message_id:'fake-out-123'},{provider_message_id:'grounded-out-123'}])assert.match(note({direction:'OUTBOUND',...row}),/Simulated/);
 assert.match(note({direction:'OUTBOUND',delivery_status:'delivered'}),/Delivered/);
 assert.match(note({direction:'OUTBOUND',delivery_error:'<unsafe>'}),/Not delivered.*&lt;unsafe&gt;/s);
 assert.equal(note({direction:'INBOUND'}),'');
});
test('fake sends are persisted as simulated instead of claiming a carrier receipt',async()=>{
 const db=require('../src/db'),sms=require('../src/providers/sms'),notify=require('../src/core/notify');const old=db.from;let logged;
 db.from=()=>({select(){return this;},eq(){return this;},gt(){return this;},maybeSingle:async()=>({data:{status:'ACTIVE'}}),limit:async()=>({data:[]}),insert:async row=>{logged=row;return {error:null};}});
 try {const result=await notify.sendAndLog('+12015550198','QA receipt',customer.id);assert.equal(result.simulated,true);assert.equal(logged.delivery_status,'simulated');} finally {db.from=old;}
});

test('historical fictional sends and both actual conversation query surfaces identify simulation',()=>{const note=require('../src/web/message-delivery-note');assert.match(note({direction:'OUTBOUND',phone:'+12015550199'}),/Simulated/);const admin=fs.readFileSync(require.resolve('../src/routes/admin'),'utf8');assert.match(admin,/select\('phone, direction, body, created_at, delivery_status, provider_message_id/);assert.match(admin,/media_path, provider_message_id/);assert.ok(admin.includes('deliveryNote(t.last)'));});
