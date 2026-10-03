'use strict';
const {matches}=require('./shipday-booking-dispatch');
const collected=new Set(['PICKED_UP','READY_TO_DELIVER','ALREADY_DELIVERED']);
function progress(plan) {
 if(!plan || plan.simulation || !['ASSIGNED','COMPLETED'].includes(plan.state))return null;
 return collected.has(plan.provider_status)?'COLLECTED':null;
}
// This observer has no create, assign, cancel, payment or order-transition path.
// Compare-and-swap saves discard an observation if staff changed the plan meanwhile.
function createObserver({store,provider,now=Date.now}) {
 async function observe(id) {
  const plan=await store.get(id);
  if(!plan?.booking_dispatch || plan.simulation || plan.leg!=='TO_PARTNER' ||
    !plan.shipday_order_id || !plan.external_reference || !plan.trip_snapshot ||
    !['REVIEW','REQUESTED','ASSIGNED'].includes(plan.state))return {ok:false,reason:'Not observable'};
  let patch;
  try {
   const rows=await provider.findOrders(plan.external_reference);
   if(!Array.isArray(rows)||rows.length!==1||!matches(rows[0],plan))throw Error('Shipday pickup identity could not be verified.');
   const remote=rows[0],status=remote.orderStatus?.orderState;
   const failed=['FAILED_DELIVERY','INCOMPLETE'].includes(status)||remote.orderStatus?.incomplete||remote.activityLog?.failedDeliveryTime;
   const canceled=['CANCELED','CANCELLED'].includes(status);
   if(failed||canceled)patch={state:canceled?'CANCELED':'REVIEW',provider_status:status||'INCOMPLETE',assigned_name:null,problem:canceled?null:'Pickup failed in Shipday. Review the existing job.'};
   else {
    if(!['NOT_ASSIGNED','NOT_ACCEPTED','NOT_STARTED_YET','STARTED',...collected].includes(status))throw Error('Shipday returned an unrecognized pickup status.');
    let driver=remote.assignedCarrier?.name||null;
    if(plan.mode==='IN_HOUSE') {
     if(!remote.assignedCarrier?.id||String(remote.assignedCarrier.id)!==String(plan.driver_id))throw Error('The Shipday pickup driver does not match the saved assignment.');
    } else if(plan.mode==='THIRD_PARTY') {
     const live=await provider.status(plan.shipday_order_id);
     if(!['REQUESTED','STARTED','ASSIGNED','pickup_complete','delivered'].includes(live.status)||
       (collected.has(status)&&!['pickup_complete','delivered'].includes(live.status))||
       (status==='ALREADY_DELIVERED'&&live.status!=='delivered'))throw Error('Shipday courier progress is not yet confirmed.');
     driver=live.courier?.name||null;
    } else throw Error('Unknown pickup assignment mode.');
    if(status==='NOT_ASSIGNED')throw Error('Shipday has not confirmed a driver assignment.');
    patch={state:status==='ALREADY_DELIVERED'?'COMPLETED':driver||collected.has(status)?'ASSIGNED':'REQUESTED',provider_status:status,assigned_name:driver,problem:null};
   }
  } catch(error) {
   // A lookup failure must never turn into a retry of the courier request.
   return {ok:false,reason:error.message};
  }
  const at=new Date(now()).toISOString();
  const saved=await store.save(plan,{...patch,provider_checked_at:at,next_attempt_at:new Date(now()+30000).toISOString()},
   {event:'SHIPDAY_PICKUP_OBSERVED',status:patch.provider_status,actor:'pickup-observer',at});
  return {ok:true,state:saved.state,status:saved.provider_status};
 }
 return {observe};
}
module.exports={createObserver,progress};
