'use strict';
const db=require('../db');
const {config}=require('../config');
const {createRequester,verifyReturn}=require('./partner-return');
const {destination}=require('./partner-delivery-gate');
const {createClient}=require('../providers/couriers/shipday');
const enabled=config.env==='development'&&config.supabase.projectRef==='psrphpgbiifvnlrgvbdg';
// A narrow development capability: only the explicit ready/request-return
// action calls this provider. No scheduler or third-party dispatch activation.
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
  const dispatch=require('./dispatch');
  const held=await dispatch.heldCustomerIds([order.customer_id]);
  const dispatchRefused=Boolean(dispatch.collectRefusal(order,held));
  return {order,customer:order.customers,shop,intake,dispatchRefused,hasCourier:couriers.some(c=>!['canceled','cancelled'].includes(String(c.status).toLowerCase()))};
}
const store={...sharedStore,async ensure(order){
  await data(db.from('shipday_dispatch_plans').upsert({order_id:order.id,leg:'TO_CUSTOMER',mode:'IN_HOUSE',simulation:false,dispatch_at:new Date().toISOString()}, {onConflict:'order_id,leg',ignoreDuplicates:true}));
  return data(db.from('shipday_dispatch_plans').select('*').eq('order_id',order.id).eq('leg','TO_CUSTOMER').single());
}};
const request=createRequester({store,provider,load,enabled});
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
module.exports={request,confirmCollection};
