'use strict';
const {phone} = require('../providers/couriers/shipday-tracking');
const COLLECTED = new Set(['PICKED_UP','READY_TO_DELIVER','ALREADY_DELIVERED']);
const {normalize,address}=require('./delivery-address');
const destination = shop => Object.fromEntries(['name','address_line1','address_line2','city','state','postal_code'].map(k=>[k,shop[k]??null]));
async function verify({provider,order,shop,plan,now=Date.now,telemetry=false}) {
  if (!plan || plan.leg !== 'TO_PARTNER' || plan.simulation || !/^[1-9]\d*$/.test(String(plan.shipday_order_id))) return {ok:false,reason:'delivery_unverified'};
  const ref=plan.external_reference || `LYNDRY-DEV-${order.order_number}-PICKUP`;
  try {
    const rows=await provider.findOrders(ref);
    if(!Array.isArray(rows)||rows.length!==1)return {ok:false,reason:'delivery_mismatch'};
    const remote=rows[0];
    if(String(remote.orderId)!==String(plan.shipday_order_id)||remote.orderNumber!==ref||
      normalize(remote.customer?.name)!==normalize(shop.name)||normalize(remote.customer?.address)!==normalize(address(shop))) return {ok:false,reason:'delivery_mismatch'};
    const status=remote.orderStatus?.orderState;
    const evidence={shipday_order_id:String(remote.orderId),provider_status:status||'UNKNOWN',checked_at:new Date(now()).toISOString(),
      driver:remote.assignedCarrier?.name||null,driverPhone:phone(remote.assignedCarrier?.phoneNumber),etaMinutes:null,
      assignmentVerified:Boolean(remote.assignedCarrier?.id && remote.assignedCarrier?.name &&
        ['NOT_ACCEPTED','NOT_STARTED_YET','STARTED','PICKED_UP','READY_TO_DELIVER','ALREADY_DELIVERED'].includes(status))};
    const scheduledDate=remote.activityLog?.expectedDeliveryDate,scheduledTime=remote.activityLog?.expectedDeliveryTime;
    const scheduled=scheduledDate&&scheduledTime?scheduledDate+'T'+scheduledTime+'Z':null;
    evidence.scheduledArrivalAt=scheduled&&Number.isFinite(Date.parse(scheduled))?new Date(scheduled).toISOString():null;
    evidence.scheduledPickupAt=require('./shipday-dispatch').dispatchInstant(order.pickup_date,String(order.pickup_time||'').slice(0,5));
    let thirdPartyCollected=true;
    if(remote.thirdPartyAssignedAnytime || remote.thirdPartyTrackingLink || remote.dOrderState) {
      const live=await provider.status(plan.shipday_order_id);
      thirdPartyCollected=['pickup_complete','delivered'].includes(live.status);
      evidence.driver=live.courier?.name||null;
      evidence.driverPhone=phone(live.courier?.phone);
      evidence.assignmentVerified=Boolean(live.courier?.name && ['STARTED','ASSIGNED','pickup_complete','delivered'].includes(live.status));
    }
    if(remote.orderStatus?.incomplete || remote.activityLog?.failedDeliveryTime ||
      !['NOT_ASSIGNED','NOT_ACCEPTED','NOT_STARTED_YET','STARTED','PICKED_UP','READY_TO_DELIVER','ALREADY_DELIVERED'].includes(status))evidence.assignmentVerified=false;
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));
    if(!order.pickup_date || order.pickup_date>today) return {...evidence,ok:false,reason:'delivery_future'};
    if(!COLLECTED.has(status) || remote.orderStatus?.incomplete || remote.activityLog?.failedDeliveryTime || !thirdPartyCollected) return {...evidence,ok:false,reason:'delivery_not_collected'};
    // Only a collected incoming leg can present its delivery ETA as arrival here.
    // Supplemental ETA failures never replace or weaken the API receipt evidence.
    if(telemetry && status!=='ALREADY_DELIVERED') {
      if(typeof remote.etaTime==='string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(remote.etaTime)) {
        const delta=(Date.parse(remote.etaTime)-now())/60000;
        if(Number.isFinite(delta)&&delta>=0&&delta<=1440)evidence.etaMinutes=Math.ceil(delta);
      }
      if(evidence.etaMinutes===null && provider.trackingInfo) {
        const extra=await provider.trackingInfo(remote.trackingLink,{reference:ref,status,driverId:remote.assignedCarrier?.id}).catch(()=>null);
        if(extra){evidence.etaMinutes=extra.etaMinutes;evidence.driverPhone=evidence.driverPhone||extra.driverPhone;}
      }
    }
    return {...evidence,ok:true,deliveryPhotos:require('../providers/couriers/shipday-proof').deliveryPhotos(remote)};
  } catch {return {ok:false,reason:'delivery_unverified'};}
}
module.exports={verify,destination,COLLECTED,normalize,address};
