'use strict';
const db = require('../db');
const { config } = require('../config');
const { createDispatcher, dispatchInstant } = require('./shipday-dispatch');
const { createClient } = require('../providers/couriers/shipday');
const simulation = !config.supabase.isProduction;
// Live activation is intentionally not supplied by this development feature.
// The account's additional fees and automatic-assignment setting need verification.
const live = createClient({apiKey:config.shipday.apiKey,allowWrites:false});
const provider = simulation ? {
  drivers: async()=>[{id:'dev-lyndry',name:'LYNDRY test driver',isActive:true,isOnShift:true}],
  createOrder: async({externalId})=>({id:'SIM-'+externalId}),
  assign: async(id,{maxFeeCents})=>Number.isSafeInteger(maxFeeCents)&&maxFeeCents>=799?{ok:true,service:'Simulated third-party courier'}:{ok:false,reason:'Simulated courier fee of $7.99 exceeds the trip budget.'},
  assignDriver: async()=>({ok:true,courier:{name:'LYNDRY test driver'}}),
  status: async()=>({status:'ASSIGNED'}), cancel: async()=>({ok:true}),unassign:async()=>({ok:true}),
} : live;
async function result(query){const {data,error}=await query;if(error)throw error;return data;}
const store={
  get:id=>result(db.from('shipday_dispatch_plans').select('*').eq('id',id).maybeSingle()),
  claim:row=>result(db.from('shipday_dispatch_plans').update({state:'PROCESSING',version:row.version+1,updated_at:new Date().toISOString()}).eq('id',row.id).eq('version',row.version).eq('state',row.state).select('*').maybeSingle()),
  async save(row,patch,event){const saved=await result(db.from('shipday_dispatch_plans').update({...patch,version:row.version+1,updated_at:new Date().toISOString(),history:row.problem===patch.problem&&event.event==='BLOCKED'?(row.history||[]):[...(row.history||[]),event]}).eq('id',row.id).eq('version',row.version).select('*').maybeSingle());if(!saved)throw Error('Assignment changed');return saved;},
};
async function validate(plan){
  if(!simulation || !plan.simulation)return {ok:false,reason:'Live Shipday dispatch is not enabled.'};
  const order=await result(db.from('orders').select('*,customers(*)').eq('id',plan.order_id).single());
  if(plan.leg==='TO_PARTNER' && order.status!=='REQUESTED')return {ok:false,reason:'Pickup is no longer awaiting collection. Resolve any handover manually.'};
  if(plan.leg==='TO_CUSTOMER' && order.status!=='READY')return {ok:false,reason:'Laundry must be ready before return dispatch.'};
  if(plan.leg==='TO_PARTNER' && dispatchInstant(order.pickup_date,require('./booking').normaliseTime(order.pickup_time))!==new Date(plan.dispatch_at).toISOString())return {ok:false,reason:'Pickup time changed. Refresh the dispatch plan before requesting a driver.'};
  const existing=await result(db.from('courier_deliveries').select('delivery_id,status').eq('order_id',order.id).eq('leg',plan.leg).not('delivery_id','is',null));
  if(existing.some(d=>!['canceled','cancelled','CANCELED','CANCELLED'].includes(d.status)))return {ok:false,reason:'A courier booking already exists for this trip. Reconcile it before using Shipday dispatch.'};
  const dispatch=require('./dispatch'),billing=require('./billing');
  const held=await dispatch.heldCustomerIds([order.customer_id]);
  const refusal=dispatch.collectRefusal(order,held);
  if(refusal)return {ok:false,reason:refusal.detail};
  if(plan.leg==='TO_PARTNER' && order.payment_status!=='WAIVED' && !billing.holdIsFresh(order))return {ok:false,reason:'A current payment authorization is required.'};
  if(plan.leg==='TO_CUSTOMER' && !['PAID','WAIVED'].includes(order.payment_status))return {ok:false,reason:'Settle payment before return delivery.'};
  const partnerId=order.partner_id||order.intended_partner_id;
  if(!partnerId)return {ok:false,reason:'Select the laundromat before dispatch.'};
  const partner=await result(db.from('partners').select('*').eq('id',partnerId).single());
  if(partner.status!=='ACTIVE')return {ok:false,reason:'The selected laundromat is inactive.'};
  const addressOf=require('./courier-legs').addressOf;
  const customer=require('./order-address').customerFor(order,order.customers);
  if(!customer?.phone)return {ok:false,reason:'Both pickup and delivery contacts need phone numbers.'};
  const home=addressOf(customer,{name:customer.name,phone:customer.phone,notes:order.dropoff_spot});
  const shop=addressOf(partner,{name:partner.name,phone:'+12017712933',notes:'LYNDRY order #'+order.order_number+'. Match this reference with the laundromat attendant.'});
  if(!home.line1||!shop.line1)return {ok:false,reason:'Both addresses are required.'};
  // Simulation assigns at a known $7.99 fee; the saved route estimate remains an internal trip budget.
  const estimated=plan.leg==='TO_PARTNER'?order.pricing_snapshot?.pickupCents:order.pricing_snapshot?.returnCents;
  const budgetCents=Math.max(799,Number.isSafeInteger(estimated)?estimated:799);
  return {ok:true,budgetCents,trip:{from:plan.leg==='TO_PARTNER'?home:shop,to:plan.leg==='TO_PARTNER'?shop:home,
    pickupReadyAt:new Date().toISOString(),dropoffDeadlineAt:new Date(Date.now()+4*3600000).toISOString(),manifest:[{name:'LYNDRY order #'+order.order_number,quantity:1}],externalId:'LYNDRY-'+order.order_number+'-'+(plan.leg==='TO_PARTNER'?'PICKUP':'RETURN')}};
}
const dispatcher=createDispatcher({store,provider,validate});
async function settings(){return result(db.from('shipday_dispatch_settings').select('*').eq('id',true).single());}
async function enroll(order,leg='TO_PARTNER'){
  const time=require('./booking').normaliseTime(order.pickup_time);
  const at=leg==='TO_PARTNER'?dispatchInstant(order.pickup_date,time):new Date().toISOString();
  if(!at)throw Error('A valid, unambiguous customer-selected pickup time is required.');
  const existing=await result(db.from('shipday_dispatch_plans').select('*').eq('order_id',order.id).eq('leg',leg).maybeSingle());
  if(existing){
    if(existing.booking_dispatch)return [existing];
    if(leg==='TO_PARTNER' && ['PLANNED','BLOCKED'].includes(existing.state) && new Date(existing.dispatch_at).toISOString()!==at){
      await store.save(existing,{dispatch_at:at,state:'PLANNED',problem:null},{actor:'scheduler',event:'PICKUP_RESCHEDULED',at:new Date().toISOString()});
    }
    return [existing];
  }
  return result(db.from('shipday_dispatch_plans').upsert({order_id:order.id,leg,dispatch_at:at,simulation},{onConflict:'order_id,leg',ignoreDuplicates:true}).select('*'));
}
let busy=false,timer;
async function tick(){
  if(!simulation||busy)return;
  busy=true;
  try{
    const setting=await settings();if(!setting.enabled)return;
    const orders=await result(db.from('orders').select('id,pickup_date,pickup_time,status,created_at,dev_quote_id').gte('created_at',setting.starts_at).in('status',['REQUESTED','READY']));
    for(const order of orders){if(order.status==='REQUESTED'&&require('./shipday-booking-runtime').eligible(order,setting))continue;if(order.status==='REQUESTED'&&!dispatchInstant(order.pickup_date,require('./booking').normaliseTime(order.pickup_time)))continue;await enroll(order,order.status==='READY'?'TO_CUSTOMER':'TO_PARTNER');}
    const due=await result(db.from('shipday_dispatch_plans').select('id').eq('simulation',true).in('state',['PLANNED','BLOCKED']).lte('dispatch_at',new Date().toISOString()).order('dispatch_at').limit(50));
    for(const plan of due)await dispatcher.run(plan.id);
  }finally{busy=false;}
}
function start(){if(!simulation||timer)return;timer=setInterval(()=>tick().catch(e=>console.error('Shipday scheduler:',e.message)),30000);timer.unref();tick().catch(e=>console.error('Shipday scheduler:',e.message));}
async function list(){return result(db.from('shipday_dispatch_plans').select('*,orders(order_number)').order('dispatch_at',{ascending:false}).limit(100));}
async function runAtSelectedTime(id,actor){
  if(!simulation)throw Error('Only development can simulate a dispatch time.');
  const plan=await store.get(id);if(!plan)throw Error('Assignment not found.');
  if(plan.simulation===false)throw Error('This is a real Shipday delivery. Use its confirmed driver status, not the simulator.');
  return createDispatcher({store,provider,validate,now:()=>Math.max(Date.now(),Date.parse(plan.dispatch_at))}).run(id,null,'staff:'+actor);
}
module.exports={runAtSelectedTime,simulation,store,provider,settings,list,enroll,tick,start,run:dispatcher.run,result};
