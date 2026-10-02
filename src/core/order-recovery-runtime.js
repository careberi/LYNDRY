 'use strict';
const db=require('../db'),{config}=require('../config');
const data=async q=>{const {data,error}=await q;if(error)throw error;return data;};
const provider=require('../providers/couriers/shipday').createClient({apiKey:config.shipday.apiKey});
const recover=require('./order-recovery').createRecovery({
 async load(number){
  require('./dev-checkout').guard();
  const order=await data(db.from('orders').select('*,customers(*)').eq('order_number',number).single());
  if(!order.dev_quote_id)throw Error('Recovery is available for development orders only.');
  const plan=await data(db.from('shipday_dispatch_plans').select('*').eq('order_id',order.id).eq('leg','TO_CUSTOMER').maybeSingle());
  const shop=order.partner_id?await data(db.from('partners').select('*').eq('id',order.partner_id).single()):null;
  order.recoveryEndpoints={customer:require('./order-address').customerFor(order,order.customers),shop};return {order,plan,shop};
 },
 observe:context=>require('./delivery-sms').observe({...context,provider,tracking:async()=>null}),
 async savePhoto(order,proof){
  const bytes=proof.file?.buffer||(await require('../providers/couriers/shipday-proof').fetchPhoto(proof.url)).bytes;
  const photo=await require('./delivery-photo').prepare(bytes);
  const path=order.id+'/recovery-'+require('node:crypto').randomUUID()+'.jpg';
  await data(db.storage.from('delivery-photos').upload(path,photo,{contentType:'image/jpeg',upsert:false}));return path;
 },
 complete:({order,plan,actor,path,source,reason,checkedAt})=>data(db.rpc('complete_dev_order_recovery',{
  p_order:order.id,p_actor:actor.id,p_source:source,p_reason:reason,p_photo:path,p_checked:checkedAt,
  p_plan:plan?.id||null,p_version:plan?.version??null,p_remote:plan?.shipday_order_id||null,
  p_expected:{partner_id:order.partner_id,preferences:order.preferences,customer_id:order.customer_id,customer:order.customers,shop:order.recoveryEndpoints.shop}
 })),
 note:(order,reason,actor)=>require('./order-events').record(order.id,{kind:'NOTE',summary:reason,by:{opsUser:actor}})
});
module.exports={recover};
