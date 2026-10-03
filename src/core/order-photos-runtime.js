'use strict';
const db=require('../db'),{config}=require('../config');
const data=async query=>{const result=await query;if(result.error)throw result.error;return result.data;};
module.exports=require('./order-photos').createService({
 provider:require('../providers/couriers/shipday').createClient({apiKey:config.shipday.apiKey}),
 readPhoto:require('../providers/couriers/shipday-proof').fetchPhoto,
 async load(number) {
  if(!config.supabase.isDevelopment||!/^[1-9]\d*$/.test(String(number)))return null;
  const order=await data(db.from('orders').select('id,order_number,preferences,partner_id,intended_partner_id,customers(*)').eq('order_number',number).maybeSingle());
  if(!order)return null;
  const partner=order.partner_id||order.intended_partner_id;
  const [plans,shop]=await Promise.all([
   data(db.from('shipday_dispatch_plans').select('order_id,leg,simulation,mode,shipday_order_id,external_reference').eq('order_id',order.id)),
   partner?data(db.from('partners').select('address_line1,address_line2,city,state,postal_code').eq('id',partner).maybeSingle()):null
  ]);
  return {order,customer:order.customers,shop,plans};
 }
});
