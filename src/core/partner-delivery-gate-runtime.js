'use strict';
const db=require('../db');
const {config}=require('../config');
const {verify,destination}=require('./partner-delivery-gate');
const provider=require('../providers/couriers/shipday').createClient({apiKey:config.shipday.apiKey});
const data=async q=>{const {data,error}=await q;if(error)throw error;return data;};
async function checkDelivery(order,partnerId) {
  // Do not expose remote customer details or raw provider errors to the shop.
  let result;
  try {
    const [current,shop,plan]=await Promise.all([
      data(db.from('orders').select('id,order_number,pickup_date,pickup_time,status,partner_id,intended_partner_id').eq('id',order.id).single()),
      data(db.from('partners').select('id,name,status,address_line1,address_line2,city,state,postal_code').eq('id',partnerId).single()),
      data(db.from('shipday_dispatch_plans').select('*').eq('order_id',order.id).eq('leg','TO_PARTNER').maybeSingle()),
    ]);
    if((current.partner_id||current.intended_partner_id)!==partnerId || shop.status!=='ACTIVE')return {ok:false,reason:'unavailable'};
    result=await verify({provider,order:current,shop,plan});
    await data(db.from('partner_delivery_checks').upsert({order_id:order.id,partner_id:partnerId,
      plan_id:plan?.id||null,shipday_order_id:plan?.shipday_order_id||null,
      eligible:result.ok,provider_status:result.provider_status||'UNKNOWN',checked_at:new Date().toISOString(),
      pickup_date:current.pickup_date,pickup_time:current.pickup_time,destination:destination(shop)}, {onConflict:'order_id'}));
  } catch {result={ok:false,reason:'delivery_unverified'};}
  return result;
}
module.exports={checkDelivery};
