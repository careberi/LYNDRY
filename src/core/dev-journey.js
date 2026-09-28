'use strict';
const db=require('../db');
const checkout=require('./dev-checkout');
const orders=require('./orders');
const runtime=require('./shipday-dispatch-runtime');
const inProgress=new Set();
async function find(id){return checkout.data(db.from('orders').select('*,customers(*)').eq('id',id).not('dev_quote_id','is',null).single());}
async function event(order,summary,actor){await require('./order-events').record(order.id,{kind:'COURIER',summary:'Development simulation: '+summary,by:{opsUser:actor}});}
async function plan(order,leg){await runtime.enroll(order,leg);return checkout.data(db.from('shipday_dispatch_plans').select('*').eq('order_id',order.id).eq('leg',leg).single());}
async function requireAssigned(order,leg){const p=await plan(order,leg);if(p.state!=='ASSIGNED')throw Error('Assign the driver before simulating collection.');}
async function action(id,command,input,actor){
 checkout.guard();
 if(require('../providers/payments').mode!=='test')throw Error('This flow requires test-mode payments.');
 if(inProgress.has(id))throw Error('An action is already processing for this order.');
 inProgress.add(id);
 try{
  let order=await find(id);
  if(command==='dispatch'){
   if(!['REQUESTED','READY'].includes(order.status))throw Error('This order is not awaiting dispatch.');
   if(order.status==='REQUESTED'&&!require('./billing').holdIsFresh(order)){
    const held=await require('./billing').authorizeShowUp(order,order.customers);
    if(!held.ok)throw Error('The test card refused authorization.');
    order=await find(id);
   }
   const p=await plan(order,order.status==='REQUESTED'?'TO_PARTNER':'TO_CUSTOMER');
   const result=await runtime.runAtSelectedTime(p.id,actor.id);
   if(!result.ok)throw Error(result.reason);
  }else if(command==='collect'){
   if(order.status!=='REQUESTED')throw Error('Pickup has already progressed.');
   await requireAssigned(order,'TO_PARTNER');
   await orders.transition(order,'IN_PROCESS');
  }else if(command==='arrive'){
   if(order.status!=='IN_PROCESS')throw Error('Collect the laundry first.');
   await checkout.data(db.from('orders').update({partner_id:order.intended_partner_id}).eq('id',id).eq('status','IN_PROCESS'));
   await orders.transition(order,'AT_PARTNER');
  }else if(command==='weigh'){
   if(order.status!=='AT_PARTNER'||order.payment_status==='PAID')throw Error('Only unpaid laundry at the laundromat can be weighed.');
   const result=await checkout.evaluateWeight(order,Number(input.weight));
   if(!result.ok)throw Error(result.reason||'Weight could not be recorded.');
  }else if(command==='pay'){
   if(order.payment_status==='PAID')return {notice:'Test payment is already settled.'};
   if(order.status!=='AT_PARTNER'||!order.weight_lb||!order.price_cents)throw Error('Record the final weight and price first.');
   const result=await require('./billing').settleTotal(order,order.customers,{totalCents:order.price_cents});
   if(!result.ok)throw Error(result.reason||'Test payment failed. Return delivery remains paused.');
  }else if(command==='ready'){
   if(order.payment_status!=='PAID'||order.status!=='AT_PARTNER')throw Error('Settle the test payment before marking the laundry ready.');
   await orders.transition(order,'READY');
  }else if(command==='return'){
   if(order.status!=='READY'||order.payment_status!=='PAID')throw Error('Laundry must be ready and paid.');
   await requireAssigned(order,'TO_CUSTOMER');await orders.transition(order,'OUT_FOR_DELIVERY');
  }else if(command==='deliver'){
   if(order.status!=='OUT_FOR_DELIVERY'||order.payment_status!=='PAID')throw Error('A paid return trip must be in progress.');
   await orders.transition(order,'DELIVERED');
  }else throw Error('Unknown simulation action.');
  await event(order,command,actor);
  return {notice:'Development step completed: '+command+'.'};
 }finally{inProgress.delete(id);}
}
module.exports={find,action};
