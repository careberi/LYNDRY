'use strict';
const db=require('../db');
const {config}=require('../config');
const enabled=config.env==='development' && config.supabase.projectRef==='psrphpgbiifvnlrgvbdg';
// Edit-only capability; creating, assigning and canceling remain disabled.
const provider=require('../providers/couriers/shipday').createClient({apiKey:config.shipday.apiKey,allowEdits:enabled});
const data=async query=>{const {data,error}=await query;if(error)throw error;return data;};

async function run(row) {
 if(!enabled)return;
 const claimed=await data(db.from('shipday_order_sync').update({state:'PROCESSING',processing_revision:row.revision,updated_at:new Date().toISOString()}).eq('plan_id',row.plan_id).eq('revision',row.revision).eq('state','PENDING').select('*').maybeSingle());
 if(!claimed)return;
 let problem=null,order;
 try {
  const plan=await data(db.from('shipday_dispatch_plans').select('*').eq('id',row.plan_id).single());
  order=await data(db.from('orders').select('*,customers(*)').eq('id',plan.order_id).single());
  const expected=`LYNDRY-DEV-${order.order_number}-${plan.leg==='TO_PARTNER'?'PICKUP':'RETURN'}`;
  if(plan.external_reference && plan.external_reference!==expected)throw Error('Development sync only updates linked LYNDRY-DEV deliveries.');
  const partnerId=order.partner_id||order.intended_partner_id;
  const partner=partnerId?await data(db.from('partners').select('*').eq('id',partnerId).single()):null;
  await require('./shipday-order-sync').synchronize({provider,order,customer:order.customers,partner,plan});
 } catch(e) {problem=e.message || 'Shipday delivery update needs review.';}
 await data(db.rpc('finish_shipday_order_sync',{p_plan:row.plan_id,p_revision:row.revision,p_problem:problem}));
 if(order)await require('./order-events').record(order.id,{kind:'NOTE',summary:problem?'Shipday delivery update needs review: '+problem:'Shipday delivery details updated and verified',by:'system'});
}
async function rows(orderId) {
 const plans=await data(db.from('shipday_dispatch_plans').select('id,leg,shipday_order_id').eq('order_id',orderId));
 if(!plans.length)return [];
 const states=await data(db.from('shipday_order_sync').select('*').in('plan_id',plans.map(p=>p.id)));
 return states.map(s=>({...s,leg:plans.find(p=>p.id===s.plan_id).leg}));
}
async function syncOrder(orderId,{retry=false}={}) {
 if(!enabled)return;
 if(retry)await data(db.rpc('queue_shipday_order_sync',{p_order:orderId}));
 for(const row of await rows(orderId))if(row.state==='PENDING')await run(row);
}
let busy=false,timer;
async function tick(){
 if(!enabled||busy||!config.shipday.apiKey)return;
 busy=true;
 try{
  // An interrupted write is reviewed, never assumed to have failed.
  await data(db.from('shipday_order_sync').update({state:'REVIEW',problem:'Update interrupted. Check Shipday and retry synchronization.',processing_revision:null}).eq('state','PROCESSING').lt('updated_at',new Date(Date.now()-120000).toISOString()));
  for(const row of await data(db.from('shipday_order_sync').select('*').eq('state','PENDING').limit(25)))await run(row);
 }finally{busy=false;}
}
function start(){if(!enabled||timer)return;timer=setInterval(()=>tick().catch(e=>console.error('Shipday detail sync:',e.message)),30000);timer.unref();tick().catch(e=>console.error('Shipday detail sync:',e.message));}
module.exports={enabled,rows,syncOrder,tick,start};
