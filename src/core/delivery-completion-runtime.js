'use strict';
const db=require('../db'),{config}=require('../config');
const enabled=config.supabase.isDevelopment;
const data=async q=>{const {data,error}=await q;if(error)throw error;return data;};
const provider=require('../providers/couriers/shipday').createClient({apiKey:config.shipday.apiKey,allowWrites:false});
const completion=require('./delivery-completion').createCompletion({
 async load(number){
  if(!enabled)return null;
  const order=await data(db.from('orders').select('*,customers(*)').eq('order_number',number).maybeSingle());
  if(!order?.dev_quote_id || !order.partner_id)return null;
  const [plan,shop]=await Promise.all([data(db.from('shipday_dispatch_plans').select('*').eq('order_id',order.id).eq('leg','TO_CUSTOMER').maybeSingle()),data(db.from('partners').select('*').eq('id',order.partner_id).maybeSingle())]);
  return {order,plan,shop};
 },
 observe:context=>require('./delivery-sms').observe({...context,provider,tracking:async()=>null}),
 async savePhoto(order,proof,plan){
  const {bytes}=await require('../providers/couriers/shipday-proof').fetchPhoto(proof.url);
  const photo=await require('./delivery-photo').prepare(bytes);
  const digest=require('node:crypto').createHash('sha256').update(photo).digest('hex');
  const path=order.id+'/recovery-shipday-'+plan.shipday_order_id+'-'+digest+'.jpg';
  const {error}=await db.storage.from('delivery-photos').upload(path,photo,{contentType:'image/jpeg',upsert:false});
  if(error && !['409','Duplicate'].includes(String(error.statusCode)) && error.error!=='Duplicate')throw error;
  return path;
 },
 complete:({order,plan,shop,path,checkedAt})=>data(db.rpc('complete_verified_dev_delivery',{
  p_order:order.id,p_plan:plan.id,p_version:plan.version,p_remote:String(plan.shipday_order_id),p_driver:String(plan.driver_id),p_photo:path,p_checked:checkedAt,
  p_expected:{partner_id:order.partner_id,preferences:order.preferences,customer_id:order.customer_id,customer:order.customers,shop,external_reference:plan.external_reference}
 }))
});
let busy=false,timer,cursor=null;
async function tick(){
 if(!enabled || busy || !config.shipday.apiKey)return;busy=true;
 try {
  let q=db.from('shipday_dispatch_plans').select('id,orders!inner(order_number,status,dev_quote_id)').eq('leg','TO_CUSTOMER').eq('mode','IN_HOUSE').eq('simulation',false).neq('state','COMPLETED').not('shipday_order_id','is',null).not('orders.dev_quote_id','is',null).in('orders.status',['OUT_FOR_DELIVERY','DELIVERED']).order('id').limit(25);
  if(cursor)q=q.gt('id',cursor);const rows=await data(q);cursor=rows.length===25?rows.at(-1).id:null;
  for(const row of rows)try{await completion.reconcile(row.orders.order_number);}catch(e){console.error('Delivery completion:',e.message);}
 }finally{busy=false;}
}
function start(){if(!enabled||timer)return;timer=setInterval(()=>tick().catch(e=>console.error('Delivery completion:',e.message)),30000);timer.unref();tick().catch(e=>console.error('Delivery completion:',e.message));}
module.exports={enabled,reconcile:completion.reconcile,tick,start};
