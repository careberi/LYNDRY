'use strict';
const {normalize,address,COLLECTED}=require('./partner-delivery-gate');
const {phone}=require('../providers/couriers/shipday-tracking');
function matches(remote,plan,shop,customer) {
  return String(remote?.orderId)===String(plan.shipday_order_id) && remote.orderNumber===plan.external_reference &&
    normalize(remote.restaurant?.name)===normalize(shop.name) && normalize(remote.restaurant?.address)===normalize(address(shop)) &&
    normalize(remote.customer?.name)===normalize(customer.name) && normalize(remote.customer?.address)===normalize(address(customer));
}
async function verifyReturn({provider,order,shop,customer,plan,telemetry=false,now=Date.now}) {
  if(!plan || plan.leg!=='TO_CUSTOMER' || plan.simulation || !/^[1-9]\d*$/.test(String(plan.shipday_order_id)) || !plan.external_reference) return {ok:false,reason:'return_unassigned'};
  try {
    const rows=await provider.findOrders(plan.external_reference);
    const remote=rows?.[0];
    if(rows?.length!==1 || !matches(remote,plan,shop,customer))return {ok:false,reason:'delivery_mismatch'};
    // This portal currently requests only our own drivers. Never mistake a
    // third-party tracking contact for the in-house collection assignment.
    if(plan.mode!=='IN_HOUSE' || remote.thirdPartyAssignedAnytime || remote.thirdPartyTrackingLink || remote.dOrderState ||
      !remote.assignedCarrier?.id || String(remote.assignedCarrier.id)!==String(plan.driver_id))return {ok:false,reason:'return_unassigned'};
    const status=remote.orderStatus?.orderState;
    const info={ok:true,provider_status:status,driver:remote.assignedCarrier.name||null,driverPhone:phone(remote.assignedCarrier.phoneNumber),etaMinutes:null,
      canCollect:COLLECTED.has(status)&&!remote.orderStatus.incomplete&&!remote.activityLog?.failedDeliveryTime,
      planId:plan.id,planVersion:plan.version,shipdayId:String(remote.orderId),driverId:String(remote.assignedCarrier.id),checked_at:new Date(now()).toISOString()};
    if(telemetry && ['NOT_ACCEPTED','NOT_STARTED_YET','STARTED'].includes(status) && provider.trackingInfo) {
      const tracking=await provider.trackingInfo(remote.trackingLink,{reference:remote.orderNumber,status,driverId:remote.assignedCarrier.id}).catch(()=>null);
      info.etaMinutes=tracking?.pickupEtaMinutes??null;
      info.driverPhone=info.driverPhone||tracking?.driverPhone||null;
    }
    return info;
  }catch{return {ok:false,reason:'delivery_unverified'};}
}

function createRequester({store,provider,load,enabled,now=Date.now}) {
  function eligibility(context) {
    const {order,shop,customer,intake,hasCourier}=context||{};
    if(!order || order.status!=='READY' || !intake?.ready_at || !intake.completed_at || !intake.received_verified_at)return 'Laundry intake and readiness must be complete.';
    if(!['PAID','WAIVED'].includes(order.payment_status))return 'Settle payment before return delivery.';
    if(!shop || shop.id!==order.partner_id || shop.status!=='ACTIVE' || shop.type!=='LAUNDROMAT')return 'The laundromat assignment changed.';
    if(context.dispatchRefused)return 'This return needs attention from LYNDRY before dispatch.';
    if(hasCourier)return 'A courier booking already exists. Contact LYNDRY.';
    if(!customer?.phone || !customer.address_line1 || !shop.address_line1)return 'Return delivery details are incomplete.';
    return null;
  }
  return async function request(orderId,partnerId,actor) {
    if(!enabled)return {ok:false,reason:'Development in-house dispatch is unavailable.'};
    let current,mutation=false;
    async function save(patch,event){current=await store.save(current,patch,{actor,event,at:new Date(now()).toISOString()});}
    try {
      let context=await load(orderId,partnerId);
      let refusal=eligibility(context);if(refusal)return {ok:false,reason:refusal};
      const before=await store.ensure(context.order);
      if(!before || ['PROCESSING','REVIEW'].includes(before.state))return {ok:false,reason:'Return assignment needs review. Contact LYNDRY.'};
      if(!before.simulation && before.state==='ASSIGNED') {
        const info=await verifyReturn({provider,...context,plan:before});
        return info.ok?{ok:true,already:true}:{ok:false,reason:'Return assignment could not be verified. Contact LYNDRY.'};
      }
      current=await store.claim(before);
      if(!current)return {ok:false,reason:'Return dispatch is already being processed.'};
      const drivers=(await provider.drivers()).filter(d=>d.isActive&&d.isOnShift);
      const selected=drivers.find(d=>!before.simulation&&String(d.id)===String(before.driver_id)) || (drivers.length===1?drivers[0]:null);
      if(!selected){await save({state:'BLOCKED',problem:'Select one available in-house driver in Shipday.'},'RETURN_DRIVER_UNAVAILABLE');return {ok:false,reason:'No single available in-house driver. Contact LYNDRY.'};}
      const reference=(!before.simulation && before.external_reference) || 'LYNDRY-DEV-'+context.order.order_number+'-RETURN';
      await save({mode:'IN_HOUSE',driver_id:String(selected.id),simulation:false,state:'PROCESSING',dispatch_at:new Date(now()).toISOString(),
        external_reference:reference,...(before.simulation?{shipday_order_id:null,assigned_name:null,tracking_url:null}:{}),problem:null},'RETURN_REQUESTED');
      const existing=await provider.findOrders(reference);
      if(!Array.isArray(existing)||existing.length>1)throw Error('Ambiguous remote reference');
      if(existing.length===1) {
        const remote=existing[0];
        if(!matches(remote,{...current,shipday_order_id:current.shipday_order_id||remote.orderId},context.shop,context.customer)) {mutation=true;throw Error('Remote mismatch');}
        await save({shipday_order_id:String(remote.orderId)},'EXISTING_RETURN_LINKED');
      } else if(current.shipday_order_id){mutation=true;throw Error('Linked return missing');}
      else {
        context=await load(orderId,partnerId);refusal=eligibility(context);if(refusal)throw Error(refusal);
        const {order,shop,customer}=context;
        const endpoint=(row,contact,notes)=>({name:row.name,line1:row.address_line1,line2:row.address_line2,city:row.city,state:row.state||'NJ',postalCode:row.postal_code,phone:contact,notes});
        mutation=true;
        const created=await provider.createOrder({externalId:reference,
          from:endpoint(shop,'+12017712933','Collect LYNDRY #'+order.order_number+' from the attendant. Match the original bag photo.'),
          to:endpoint(customer,customer.phone,order.preferences?.dropoff_spot||customer.preferences?.dropoff_spot||''),
          pickupReadyAt:new Date(now()).toISOString(),dropoffDeadlineAt:new Date(now()+4*3600000).toISOString(),manifest:[{name:'Development laundry return #'+order.order_number,quantity:1}]});
        await save({shipday_order_id:String(created.id)},'SHIPDAY_RETURN_CREATED');
      }
      context=await load(orderId,partnerId);refusal=eligibility(context);if(refusal)throw Error(refusal);
      const rows=await provider.findOrders(reference),remote=rows?.[0];
      if(rows?.length!==1 || !matches(remote,current,context.shop,context.customer) || remote.thirdPartyAssignedAnytime || remote.thirdPartyTrackingLink || remote.dOrderState){mutation=true;throw Error('Return cannot be verified');}
      const assignedId=remote.assignedCarrier?.id||remote.assignedCarrierId;
      if(assignedId && Number(assignedId)>0 && String(assignedId)!==String(selected.id)){mutation=true;throw Error('Another driver is assigned');}
      if(!['NOT_ASSIGNED','NOT_ACCEPTED','NOT_STARTED_YET'].includes(remote.orderStatus?.orderState)){mutation=true;throw Error('Return activity already started');}
      if(!assignedId || Number(assignedId)<=0){
        mutation=true;
        const result=await provider.assignDriver(current.shipday_order_id,selected.id);
        if(!result?.ok)throw Error('Assignment not confirmed');
      }
      const confirmed=await verifyReturn({provider,...context,plan:current});
      if(!confirmed.ok)throw Error('Assignment readback failed');
      await save({state:'ASSIGNED',assigned_name:confirmed.driver,problem:null},'RETURN_DRIVER_ASSIGNED');
      return {ok:true};
    }catch{
      if(current)await save({state:mutation?'REVIEW':'BLOCKED',problem:mutation?'Return request needs review in Shipday. Do not request another driver.':'Return checks failed. Contact LYNDRY.'},'RETURN_REQUEST_FAILED').catch(()=>{});
      return {ok:false,reason:'Return request needs attention. Contact LYNDRY.'};
    }
  };
}
module.exports={matches,verifyReturn,createRequester};
