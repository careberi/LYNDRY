'use strict';
const db=require('../db');
const {config}=require('../config');
const {createWorker}=require('./delivery-sms-worker');
const {createClient}=require('../providers/couriers/shipday');
const {createTracking}=require('../providers/couriers/shipday-tracking');
const {sendAndLog}=require('./notify');
// Development rollout only. Existing SMS adapter still simulates every send.
// Polling manual jobs does not depend on the automatic-dispatch pause switch.
const enabled=config.supabase.isDevelopment && Boolean(config.shipday.apiKey);
const data=async q=>{const {data,error}=await q;if(error)throw error;return data;};
const iso=()=>new Date().toISOString();
let cursor=null,photoCursor=null;
const store={
  async plans() {
    let q=db.from('shipday_dispatch_plans').select('*,orders!inner(status,created_at,dev_quote_id)')
      .eq('simulation',false).not('shipday_order_id','is',null)
      .not('orders.dev_quote_id','is',null).neq('orders.status','CANCELED')
      .order('id').limit(25);
    if(cursor)q=q.gt('id',cursor);
    const rows=await data(q);
    cursor=rows.length===25?rows.at(-1).id:null;
    return rows;
  },
  plan:(order,leg)=>data(db.from('shipday_dispatch_plans').select('*').eq('order_id',order).eq('leg',leg).maybeSingle()),
  async context(plan) {
    const order=await data(db.from('orders').select('*,customers(*)').eq('id',plan.order_id).maybeSingle());
    if(!order?.dev_quote_id)return null;
    const partner=order.partner_id||order.intended_partner_id;
    if(!partner)return null;
    const shop=await data(db.from('partners').select('*').eq('id',partner).maybeSingle());
    return {order,shop};
  },
  state:plan=>data(db.from('delivery_sms_state').select('rank').eq('order_id',plan.order_id).eq('leg',plan.leg).maybeSingle()),
  async ensure(plan,rank) {
    await data(db.from('delivery_sms_state').upsert({order_id:plan.order_id,leg:plan.leg,rank},
      {onConflict:'order_id,leg',ignoreDuplicates:true}));
    return data(db.from('delivery_sms_state').select('*').eq('order_id',plan.order_id).eq('leg',plan.leg).single());
  },
  queue:(plan,state,message,observation)=>data(db.rpc('queue_delivery_sms',{
    p_order:plan.order_id,p_leg:plan.leg,p_version:state.version,p_rank:message.rank,p_key:message.key,
    p_body:message.body,p_remote:observation.remoteId,
    p_eta:observation.etaMinutes===null?null:new Date(Date.parse(observation.observedAt)+observation.etaMinutes*60000).toISOString()
  })),
  pending:()=>data(db.from('delivery_sms_outbox').select('*').eq('state','PENDING').order('created_at').limit(50)),
  claim:row=>data(db.from('delivery_sms_outbox').update({state:'SENDING',updated_at:iso()})
    .eq('id',row.id).eq('state','PENDING').select('*').maybeSingle()),
  async finish(row,state,problem) {
    const changed=await data(db.from('delivery_sms_outbox').update({state,problem,updated_at:iso()})
      .eq('id',row.id).eq('state','SENDING').select('id').maybeSingle());
    if(changed && state==='REVIEW')await data(db.from('order_events').insert({order_id:row.order_id,kind:'NOTE',actor:'delivery texts',summary:'Delivery text needs review. Check the customer conversation before resending.',reason:problem}));
  },
  async pendingPhotos() {
    // Missing proof on older orders must not starve newer completed deliveries.
    let q=db.from('delivery_sms_outbox').select('*').eq('photo_state','WAITING')
      .in('state',['SENT','SIMULATED']).eq('leg','TO_CUSTOMER').eq('event_key','milestone-3').order('id').limit(25);
    if(photoCursor)q=q.gt('id',photoCursor);
    const rows=await data(q);photoCursor=rows.length===25?rows.at(-1).id:null;return rows;
  },
  photoClaim:row=>data(db.rpc('claim_delivery_photo',{p_id:row.id})),
  async photoUpdate(row,expected,state,problem,path) {
    const changed=await data(db.from('delivery_sms_outbox').update({photo_state:state,photo_problem:problem,photo_updated_at:iso(),...(path?{photo_path:path}:{})})
      .eq('id',row.id).eq('photo_version',row.photo_version).eq('photo_state',expected).select('id').maybeSingle());
    if(changed && state==='REVIEW')await data(db.from('order_events').insert({order_id:row.order_id,kind:'NOTE',actor:'delivery photos',summary:'Customer delivery photo needs review. Check the customer conversation before resending.',reason:problem}));
    return changed;
  },
  async expirePhotos() {
    const stale=new Date(Date.now()-10*60000).toISOString();
    // A preparing lease cannot send after expiry: changing the state defeats its compare-and-set.
    await data(db.from('delivery_sms_outbox').update({photo_state:'REVIEW',photo_problem:'Preparation interrupted. Review before retrying.',photo_updated_at:iso()})
      .eq('photo_state','PREPARING').lt('photo_updated_at',stale));
    const uncertain=await data(db.from('delivery_sms_outbox').select('*').eq('photo_state','SENDING').lt('photo_updated_at',stale));
    for(const row of uncertain)await store.photoUpdate(row,'SENDING','REVIEW','Picture message interrupted. Review before resending.');
    const expired=await data(db.from('delivery_sms_outbox').select('*').eq('photo_state','WAITING').lt('created_at',new Date(Date.now()-24*60*60000).toISOString()));
    for(const row of expired)await store.photoUpdate(row,'WAITING','REVIEW','No verified delivery photo was sent within 24 hours.');
  },
  expireClaims:()=>data(db.from('delivery_sms_outbox').update({state:'REVIEW',
    problem:'Send interrupted. Review messages before resending.',updated_at:iso()})
    .eq('state','SENDING').lt('updated_at',new Date(Date.now()-10*60000).toISOString())),
};
const worker=createWorker({store,provider:createClient({apiKey:config.shipday.apiKey}),
  tracking:createTracking(),send:sendAndLog,onError:e=>console.error('Delivery text:',e.message)});
const photoWorker=require('./delivery-photo-worker').createPhotoWorker({store,
  provider:createClient({apiKey:config.shipday.apiKey}),tracking:createTracking(),
  savePhoto:require('./delivery-photo').createMedia(db.storage),send:sendAndLog,
  onError:e=>console.error('Delivery photo:',e.message)});
let timer;
function start() {
  if(!enabled||timer)return;
  const run=async()=>{try{await worker.tick();await photoWorker.tick();}catch(e){console.error('Delivery texts:',e.message);}};
  timer=setInterval(run,30000);timer.unref();run();
}
module.exports={enabled,start,store};
