'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function recurringFixture(existing=[]) {
 let booked,inserted;
 const db={from:table=>{let payload;const chain={select(){return chain;},eq(){return chain;},order(){return chain;},insert(value){payload=value;inserted=value;return chain;},update(value){if(table==='recurring_schedules')inserted=value;return chain;},single:async()=>({data:{id:'schedule',...payload}}),then(resolve,reject){return Promise.resolve({data:existing,error:null}).then(resolve,reject);}};return chain;}};
 const modules={'../db':db,'./booking':{today:()=> '2030-01-01',normaliseTime:t=>t,serviceClockOf:()=>({time:'08:00'}),DOORS:{WEB:'WEB'},bookPickup:async(_c,args)=>{booked=args;return {ok:true,order:{id:'order',order_number:1,pricing_snapshot:{},price_per_lb_cents:200}};}},'./orders':{},'./subscription':{},'./notify':{},'./dev-checkout':{read:async()=>({pickup_date:'2030-01-18',snapshot:{category:'SUBSCRIPTION',selectionMethod:'CLOSEST_AVAILABLE_V1'}})}};
 const context={module:{exports:{}},require:id=>modules[id],console,Date};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/core/recurring'),'utf8'),context);
 return {service:context.module.exports,booked:()=>booked,inserted:()=>inserted};
}
test('scheduled subscription keeps its chosen future first date and anchors new recurrence there',async()=>{
 const f=recurringFixture();await f.service.bookAndSchedule({id:'customer'},{pickupDate:'2030-01-18',pickupTime:'13:42',cadence:'FORTNIGHTLY',weekdays:[5],devQuoteId:'quote'});
 assert.equal(f.booked().pickupDate,'2030-01-18');assert.equal(f.inserted().started_on,'2030-01-18');
});
test('scheduled subscription refuses a first date different from its accepted quote',async()=>{
 const f=recurringFixture();await assert.rejects(f.service.bookAndSchedule({id:'customer'},{pickupDate:'2030-01-11',pickupTime:'13:42',cadence:'WEEKLY',weekdays:[5],devQuoteId:'quote'}),/date changed/i);assert.equal(f.booked(),undefined);
});
test('development card intent summary preserves explicit quoted first subscription date',()=>{
 const intents=require('../src/core/booking-intents');assert.equal(intents.firstDateFor({pickup_date:'2030-01-18',pickup_time:'13:42',cadence:'FORTNIGHTLY',weekdays:'5',dev_quote_id:'quote'}),'2030-01-18');
});

test('new subscription is never due before its chosen start date',()=>{
 const f=recurringFixture();for(const cadence of ['WEEKLY','FORTNIGHTLY','MONTHLY']) assert.equal(f.service.nextDate({status:'ACTIVE',cadence,weekday:5,started_on:'2030-01-18'},'2030-01-01'),'2030-01-18');
});

test('restarting an ended fortnightly plan resets its anchor to the selected first pickup',async()=>{
 const f=recurringFixture([{id:'old',weekday:5,cadence:'FORTNIGHTLY',status:'ENDED',started_on:'2030-01-11'}]);
 await f.service.bookAndSchedule({id:'customer'},{pickupDate:'2030-01-18',pickupTime:'13:42',cadence:'FORTNIGHTLY',weekdays:[5],devQuoteId:'quote'});
 assert.equal(f.inserted().started_on,'2030-01-18');
});
