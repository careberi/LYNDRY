'use strict';
const {observe}=require('./delivery-sms');
// Photo delivery is independent of the laundromat's manual handoff confirmation.
function createPhotoWorker({store,provider,tracking,savePhoto,send,now=Date.now,onError=()=>{}}) {
 async function current(row) {
  const plan=await store.plan(row.order_id,'TO_CUSTOMER');
  if(!plan || plan.leg!=='TO_CUSTOMER' || String(plan.shipday_order_id)!==row.remote_id)return {skip:true};
  const context=await store.context(plan),order=context?.order;
  if(!order || order.status==='CANCELED' || order.customer_id==null || order.customers?.status!=='ACTIVE' ||
    !order.customers.phone || !order.customers.default_payment_method_id)return {skip:true};
  const observation=await observe({provider,tracking,order,shop:context.shop,plan,now});
  return observation?.terminal ? {order,observation} : {};
 }
 async function deliver(row) {
  if(row.leg!=='TO_CUSTOMER' || row.event_key!=='milestone-3' || !['SENT','SIMULATED'].includes(row.state))return;
  if(now()-Date.parse(row.created_at)>24*60*60000 || Date.parse(row.created_at)>now())return;
  const first=await current(row);
  if(first.skip)return store.photoUpdate(row,'WAITING','SKIPPED','Trip or customer is no longer eligible.');
  const url=first.observation?.deliveryPhotos?.[0],customerId=first.order?.customer_id;
  if(!url)return; // Proof often arrives after the status. Keep checking within the bounded window.
  const claimed=await store.photoClaim(row);
  if(!claimed)return;
  let sending=false;
  try {
   const path=await savePhoto(claimed,first.order,url);
   // Never send an earlier customer's image after a reassignment during download.
   const fresh=await current(claimed);
   if(fresh.skip || (fresh.order && fresh.order.customer_id!==customerId))return store.photoUpdate(claimed,'PREPARING','SKIPPED','Trip or recipient changed.');
   if(!fresh.observation?.deliveryPhotos?.includes(url))return store.photoUpdate(claimed,'PREPARING','WAITING','Waiting for matching delivery proof.');
   const leased=await store.photoUpdate(claimed,'PREPARING','SENDING',null,path);
   if(!leased)return;
   sending=true;
   const result=await send(fresh.order.customers.phone,'LYNDRY #'+fresh.order.order_number+': Here is your delivery photo.',fresh.order.customer_id,{mediaPath:path,noRetry:true});
   const state=result?.uncertain?'REVIEW':result?.sent?(result.simulated?'SIMULATED':'SENT'):result?.refused?'SKIPPED':'REVIEW';
   await store.photoUpdate(claimed,'SENDING',state,result?.refused || (state==='REVIEW'?'Picture message outcome uncertain. Review before resending.':null),path);
  } catch(error) {
   await store.photoUpdate(claimed,sending?'SENDING':'PREPARING',sending?'REVIEW':'WAITING',
    sending?'Picture message interrupted. Review before resending.':'Delivery photo could not be prepared. Will check again.').catch(()=>{});
   onError(error);
  }
 }
 let busy=false;
 async function tick() {
  if(busy)return;busy=true;
  try {await store.expirePhotos();for(const row of await store.pendingPhotos()){try{await deliver(row);}catch(error){onError(error);}}}
  finally{busy=false;}
 }
 return {tick,deliver};
}
module.exports={createPhotoWorker};
