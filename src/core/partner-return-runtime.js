'use strict';
const db=require('../db');
const {config}=require('../config');
const {createRequester,verifyReturn}=require('./partner-return');
const {destination}=require('./partner-delivery-gate');
const {createClient}=require('../providers/couriers/shipday');
// Railway uses NODE_ENV=production for both sites. Database identity owns this capability.
const enabled=config.supabase.isDevelopment;
const provider=createClient({apiKey:config.shipday.apiKey,allowWrites:enabled});
const data=async q=>{const {data,error}=await q;if(error)throw error;return data;};
const sharedStore=require('./shipday-dispatch-runtime').store;
async function load(orderId,partnerId){
  const order=await data(db.from('orders').select('*,customers(*)').eq('id',orderId).eq('partner_id',partnerId).maybeSingle());
  if(!order)return {};
  const [shop,intake,couriers]=await Promise.all([
    data(db.from('partners').select('*').eq('id',partnerId).single()),
    data(db.from('partner_order_intakes').select('*').eq('order_id',orderId).eq('partner_id',partnerId).maybeSingle()),
    data(db.from('courier_deliveries').select('status').eq('order_id',orderId).eq('leg','TO_CUSTOMER').not('delivery_id','is',null)),
  ]);
  const returnWeightAllowed=await data(db.rpc('partner_return_weight_allowed',{p_order:orderId}));
  const dispatch=require('./dispatch');
  const held=await dispatch.heldCustomerIds([order.customer_id]);
  const dispatchRefused=Boolean(dispatch.collectRefusal(order,held));
  return {order,customer:require('./order-address').customerFor(order,order.customers),shop,intake,returnWeightAllowed,dispatchRefused,hasCourier:couriers.some(c=>!['canceled','cancelled'].includes(String(c.status).toLowerCase()))};
}
const store={...sharedStore,async ensure(order){
  await data(db.from('shipday_dispatch_plans').upsert({order_id:order.id,leg:'TO_CUSTOMER',mode:'THIRD_PARTY',simulation:false,dispatch_at:new Date().toISOString()}, {onConflict:'order_id,leg',ignoreDuplicates:true}));
  return data(db.from('shipday_dispatch_plans').select('*').eq('order_id',order.id).eq('leg','TO_CUSTOMER').single());
}};
const request=createRequester({store,provider,load,enabled,settings:()=>require('./shipday-dispatch-runtime').settings()});
// Only already-enrolled real returns are polled. Deployment never books old simulated orders.
let busy=false,timer;
async function tick(){
  if(!enabled||!config.shipday.apiKey||busy)return;
  busy=true;
  try {
    const interrupted=await data(db.from('shipday_dispatch_plans').select('*').eq('leg','TO_CUSTOMER').eq('simulation',false).eq('state','PROCESSING').lt('updated_at',new Date(Date.now()-120000).toISOString()));
    for(const plan of interrupted)await store.save(plan,{state:'REVIEW',problem:'Return request was interrupted. Refresh its status to reconcile the existing delivery.'},
      {actor:'return-dispatch',event:'INTERRUPTED_RETURN',at:new Date().toISOString()}).catch(()=>{});
    const setting=await require('./shipday-dispatch-runtime').settings();
    const plans=await data(db.from('shipday_dispatch_plans').select('*,orders!inner(id,partner_id,status)').eq('leg','TO_CUSTOMER').eq('simulation',false)
      .in('state',['PLANNED','BLOCKED','REQUESTED','ASSIGNED','REVIEW']).in('orders.status',['READY']).order('updated_at').limit(50));
    for(const plan of plans){
      if(plan.next_attempt_at&&Date.parse(plan.next_attempt_at)>Date.now())continue;
      if(['PLANNED','BLOCKED'].includes(plan.state)&&(!setting.enabled||plan.mode!=='THIRD_PARTY'))continue;
      await request(plan.order_id,plan.orders.partner_id,'return-dispatch');
    }
  }finally{busy=false;}
}
function start(){if(!enabled||timer)return;timer=setInterval(()=>tick().catch(e=>console.error('Return dispatch:',e.message)),30000);timer.unref();tick().catch(e=>console.error('Return dispatch:',e.message));}
async function confirmCollection({order,partner,staff}){
  if(!enabled)return {ok:false,reason:'unavailable'};
  const context=await load(order.id,partner);
  if(!context.order)return {ok:false,reason:'unavailable'};
  if(context.intake?.collected_at)return {ok:true,notice:'collected',already:true};
  const plan=await data(db.from('shipday_dispatch_plans').select('*').eq('order_id',order.id).eq('leg','TO_CUSTOMER').maybeSingle());
  const checked=await verifyReturn({provider,...context,plan});
  if(!checked.ok||!checked.canCollect)return {ok:false,reason:'return_not_collected'};
  const result=await data(db.rpc('confirm_partner_return_collection',{
    p_order:order.id,p_partner:partner,p_actor:staff.id,p_is_admin:staff.isOpsAdmin===true,
    p_plan:plan.id,p_version:plan.version,p_shipday:checked.shipdayId,p_driver:checked.driverId,
    p_status:checked.provider_status,p_checked:checked.checked_at,p_shop:destination(context.shop),p_customer:destination(context.customer),
  }));
  return result.ok?{...result,notice:'collected'}:result;
}
const refresh=(order,partner,actor)=>request(order,partner,actor,null,{observeOnly:true});
module.exports={enabled,provider,request,refresh,confirmCollection,tick,start};
