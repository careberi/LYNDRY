'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
function fixture(order,{approval=true,payment=true,realCourier=false}={}){
 let charged=0;const transitions=[];
 const query={select(){return this;},eq(){return this;},not(){return this;},single(){return order;}};
 const modules={
  '../db':{from:table=>table==='shipday_dispatch_plans'?{...query,single:()=>({state:'ASSIGNED',simulation:!realCourier})}:query},'./dev-checkout':{guard(){},data:async q=>q},
  './orders':{transition:async(o,status)=>{transitions.push(status);o.status=status;}},
  './spending-controls':{check:async()=>({ok:approval,reason:'Approval pending'})},
  './shipday-dispatch-runtime':{enroll:async()=>[]},'../providers/payments':{mode:'test'},
  './billing':{settleTotal:async()=>{charged++;return {ok:payment,reason:'Declined'};}},
  './order-events':{record:async()=>{}}
 };
 const context={require:n=>{if(!(n in modules))throw Error('Unexpected dependency '+n);return modules[n];},module:{exports:{}},Set};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/core/dev-journey.js'),'utf8'),context);
 return {action:command=>context.module.exports.action('fixture',command,{}, {id:'tester'}),charges:()=>charged,transitions};
}
test('repeated paid submission never charges a test card again',async()=>{
 const f=fixture({status:'AT_PARTNER',payment_status:'PAID',weight_lb:33,price_cents:6000});
 await f.action('pay');assert.equal(f.charges(),0);
});
test('retired approval does not block payment; paid status is still required for ready',async()=>{
 const f=fixture({status:'AT_PARTNER',payment_status:'UNPAID',weight_lb:10,price_cents:3000},{approval:false});
 await f.action('pay');await assert.rejects(f.action('ready'),/Settle/);
 assert.equal(f.charges(),1);assert.equal(f.transitions.length,0);
});
test('declined payment cannot advance the order to ready or delivery',async()=>{
 const f=fixture({status:'AT_PARTNER',payment_status:'UNPAID',weight_lb:33,price_cents:6000},{payment:false});
 await assert.rejects(f.action('pay'),/Declined/);await assert.rejects(f.action('ready'),/Settle/);
 await assert.rejects(f.action('deliver'),/paid return trip/);assert.equal(f.transitions.length,0);
});
test('simulator cannot collect a real assigned Shipday pickup',async()=>{
 const f=fixture({status:'REQUESTED',payment_status:'UNPAID'},{realCourier:true});
 await assert.rejects(f.action('collect'),/Real Shipday deliveries/);assert.equal(f.transitions.length,0);
});
