'use strict';
const db=require('../db'),{config}=require('../config');
const enabled=config.supabase.isDevelopment;
const data=async q=>{const r=await q;if(r.error)throw r.error;return r.data;};
const provider=require('../providers/couriers/shipday').createClient({apiKey:config.shipday.apiKey,allowWrites:enabled});
async function reconcile(orderId){
 if(!enabled)return;
 const runtime=require('./shipday-dispatch-runtime');
 const plans=await data(db.from('shipday_dispatch_plans').select('*').eq('order_id',orderId).neq('state','CANCELED'));
 for(const p of plans){
  if(p.state==='PROCESSING'){
   if(Date.parse(p.updated_at)<Date.now()-180000)await runtime.store.save(p,{state:'REVIEW',problem:'Interrupted cancellation or dispatch; reconciliation pending.',next_attempt_at:null},{event:'CANCELLATION_RECOVERY',actor:'system',at:new Date().toISOString()});
   continue;
  }
  if(p.next_attempt_at&&Date.parse(p.next_attempt_at)>Date.now())continue;
  const claimed=await runtime.store.claim(p);if(!claimed)continue;
  try {
   await require('./shipday-cancellation').cancelLinked({provider,plan:claimed,assertCanceled:async()=>{
    const o=await data(db.from('orders').select('status,dev_quote_id').eq('id',orderId).single());
    if(o.status!=='CANCELED'||!o.dev_quote_id)throw Error('Order is no longer a canceled development order');
   }});
   await runtime.store.save(claimed,{state:'CANCELED',assigned_name:null,problem:null,next_attempt_at:null},{event:'SHIPDAY_CANCELLATION_VERIFIED',actor:'system',at:new Date().toISOString()});
  }catch(error){await runtime.store.save(claimed,{state:'REVIEW',problem:'Order canceled locally; Shipday cancellation needs attention: '+error.message,next_attempt_at:new Date(Date.now()+300000).toISOString()},{event:'SHIPDAY_CANCELLATION_REVIEW',actor:'system',at:new Date().toISOString()});}
 }
}
let busy=false,timer;
async function tick(){if(!enabled||busy)return;busy=true;try{
 const plans=await data(db.from('shipday_dispatch_plans').select('order_id,orders!inner(status,dev_quote_id)').eq('orders.status','CANCELED').not('orders.dev_quote_id','is',null).neq('state','CANCELED').order('updated_at').limit(50));
 for(const id of new Set(plans.map(p=>p.order_id)))await reconcile(id);
}finally{busy=false;}}
function start(){if(!enabled||timer)return;timer=setInterval(()=>tick().catch(e=>console.error('Cancellation reconciliation:',e.message)),30000);timer.unref();tick().catch(e=>console.error('Cancellation reconciliation:',e.message));}
module.exports={reconcile,tick,start};
