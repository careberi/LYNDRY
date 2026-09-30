'use strict';
const {observe,nextMessage} = require('./delivery-sms');

// The store provides cross-process claims; no timer or provider writes here.
function createWorker({store,provider,tracking,send,now=Date.now,onError=()=>{}}) {
  async function snapshot(plan) {
    const context=await store.context(plan);
    if(!context?.order || !context.shop) return null;
    const {order,shop}=context;
    if(order.status==='CANCELED' || order.customers?.status!=='ACTIVE' ||
       !order.customers?.phone || !order.customers?.default_payment_method_id) return null;
    const observation=await observe({provider,tracking,plan,order,shop,now});
    return observation?{order,observation}:null;
  }
  async function poll(plan) {
    if(store.state && (await store.state(plan))?.rank===3)return;
    const current=await snapshot(plan);
    if(!current)return;
    const {order,observation}=current;
    // First sight of a finished trip must not text historical milestones.
    const state=await store.ensure(plan,observation.terminal?3:0);
    const message=nextMessage(order,plan,state,observation,now());
    if(message)await store.queue(plan,state,message,observation);
  }
  async function deliver(row) {
    const claimed=await store.claim(row);
    if(!claimed)return;
    try {
      const plan=await store.plan(row.order_id,row.leg);
      if(!plan || String(plan.shipday_order_id)!==row.remote_id ||
         now()-Date.parse(row.created_at)>120000) {
        return await store.finish(row,'SKIPPED','Trip changed or update expired.');
      }
      const current=await snapshot(plan);
      if(!current || (current.observation.rank!==row.rank && !(row.event_key.startsWith('eta-') && row.rank===2 && current.observation.rank===1))) {
        return await store.finish(row,'SKIPPED','Current trip no longer supports this update.');
      }
      // Refresh ETA immediately before sending; stored ETA is never replayed.
      const previous=row.event_key.startsWith('milestone-')?row.rank-1:row.rank;
      const state={rank:previous,last_eta_at:'1970-01-01',last_message_at:'1970-01-01'};
      const message=nextMessage(current.order,plan,state,current.observation,now());
      if(!message)return await store.finish(row,'SKIPPED','No reliable current update.');
      const result=await send(current.order.customers.phone,message.body,current.order.customer_id);
      const status=result?.uncertain?'REVIEW':result?.sent?(result.simulated?'SIMULATED':'SENT')
        :result?.refused?'SKIPPED':'REVIEW';
      await store.finish(row,status,result?.refused || (status==='REVIEW'?'SMS outcome uncertain; review before resending.':null));
    } catch(error) {
      // A timeout after the provider accepted a message must never cause a retry.
      await store.finish(row,'REVIEW','Update interrupted; review before resending.').catch(()=>{});
      onError(error);
    }
  }
  let busy=false;
  async function tick() {
    if(busy)return;
    busy=true;
    try {
      await store.expireClaims();
      for(const row of await store.pending())await deliver(row);
      for(const plan of await store.plans()) {
        try {await poll(plan);} catch(error) {onError(error);}
        // Send while the observation is fresh, even if later providers stall.
        for(const row of await store.pending())await deliver(row);
      }
    } finally {busy=false;}
  }
  return {poll,deliver,tick};
}
module.exports={createWorker};
