'use strict';
const {normalize,COLLECTED}=require('./partner-delivery-gate');
const {legacyNJReturn,matchesAddress}=require('./delivery-address');
const {phone}=require('../providers/couriers/shipday-tracking');
function matches(remote,plan,shop,customer) {
  return String(remote?.orderId)===String(plan.shipday_order_id) && remote.orderNumber===plan.external_reference &&
    normalize(remote.restaurant?.name)===normalize(shop.name) && matchesAddress(remote.restaurant?.address,shop,legacyNJReturn(plan)) &&
    normalize(remote.customer?.name)===normalize(customer.name) && matchesAddress(remote.customer?.address,customer,legacyNJReturn(plan));
}
async function verifyReturn({provider,order,shop,customer,plan,telemetry=false,now=Date.now}) {
  if(!plan || plan.leg!=='TO_CUSTOMER' || plan.simulation || !/^[1-9]\d*$/.test(String(plan.shipday_order_id)) || !plan.external_reference) return {ok:false,reason:'return_unassigned'};
  try {
    const rows=await provider.findOrders(plan.external_reference);
    const remote=rows?.[0];
    if(rows?.length!==1 || !matches(remote,plan,shop,customer))return {ok:false,reason:'delivery_mismatch'};
    if(plan.mode==='THIRD_PARTY') {
      const result=await thirdPartyStatus(provider,plan,remote);
      const collected=['pickup_complete','delivered'].includes(result.status);
      return {ok:true,provider_status:collected?(result.status==='delivered'?'ALREADY_DELIVERED':'PICKED_UP'):result.status==='ASSIGNED'?'NOT_ACCEPTED':result.status==='REQUESTED'?'NOT_ASSIGNED':result.status,
        driver:result.courier?.name||null,driverPhone:phone(result.courier?.phone),etaMinutes:null,
        canCollect:collected&&COLLECTED.has(remote.orderStatus?.orderState)&&!remote.orderStatus.incomplete&&!remote.activityLog?.failedDeliveryTime,
        planId:plan.id,planVersion:plan.version,shipdayId:String(remote.orderId),driverId:null,checked_at:new Date(now()).toISOString()};
    }
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

async function thirdPartyStatus(provider,plan,remote) {
  if(!plan.assignment_requested_at&&!remote.thirdPartyAssignedAnytime&&!remote.thirdPartyTrackingLink&&!remote.dOrderState)throw Error('No courier request exists');
  const result=await provider.status(plan.shipday_order_id);
  if(['INCOMPLETE','FAILED_DELIVERY','CANCELED','CANCELLED'].includes(remote.orderStatus?.orderState))return {...result,status:'FAILED'};
  return result;
}

function createRequester({store,provider,load,enabled,settings=async()=>({enabled:false}),now=Date.now}) {
  function eligibility(context) {
    const {order,shop,customer,intake,hasCourier}=context||{};
    if(!order || order.status!=='READY' || !intake?.ready_at || !intake.completed_at || !intake.received_verified_at)return 'Laundry intake and readiness must be complete.';
    if(!['PAID','WAIVED'].includes(order.payment_status))return 'Settle payment before return delivery.';
    if(!shop || shop.id!==order.partner_id || shop.status!=='ACTIVE' || shop.type!=='LAUNDROMAT')return 'The laundromat assignment changed.';
    if(context.returnWeightAllowed===false)return 'Return weight check needs LYNDRY review before dispatch.';
    if(context.dispatchRefused)return 'This return needs attention from LYNDRY before dispatch.';
    if(hasCourier)return 'A courier booking already exists. Contact LYNDRY.';
    if(!customer?.phone || !customer.address_line1 || !shop.address_line1)return 'Return delivery details are incomplete.';
    return null;
  }
  return async function request(orderId,partnerId,actor,choice=null,{observeOnly=false}={}) {
    if(!enabled)return {ok:false,reason:'Return dispatch is unavailable in this environment.'};
    if(choice&&(!['IN_HOUSE','THIRD_PARTY'].includes(choice.mode)||(choice.mode==='IN_HOUSE'&&!/^\d+$/.test(String(choice.driverId)))))return {ok:false,reason:'Choose an available driver.'};
    let current,mutation=false,writePending=false;
    async function save(patch,event){current=await store.save(current,patch,{actor,event,at:new Date(now()).toISOString()});}
    async function blocked(reason){await save({state:'BLOCKED',problem:reason,next_attempt_at:new Date(now()+60000).toISOString()},'RETURN_BLOCKED');return {ok:false,reason};}
    async function recordThirdParty(result) {
      const state=result.status==='pickup_complete'?'ASSIGNED':require('./shipday-booking-dispatch').assignmentState(result);
      const ok=['REQUESTED','ASSIGNED','COMPLETED'].includes(state);
      await save({state:ok?state:'REVIEW',assigned_name:state==='REQUESTED'?null:result.courier?.name||null,tracking_url:result.trackingUrl||null,
        assignment_requested_at:current.assignment_requested_at||(ok?new Date(now()).toISOString():null),
        provider_status:result.status==='pickup_complete'?'PICKED_UP':result.status==='delivered'?'ALREADY_DELIVERED':result.status,
        provider_checked_at:new Date(now()).toISOString(),next_attempt_at:new Date(now()+30000).toISOString(),
        problem:ok?null:'Return delivery needs review in Shipday before requesting another driver.'},'RETURN_STATUS_'+state);
      return {ok,state:current.state,reason:current.problem};
    }
    try {
      let context=await load(orderId,partnerId);
      let refusal=eligibility(context);if(refusal)return {ok:false,reason:refusal};
      const before=await store.ensure(context.order);
      if(!before || before.state==='PROCESSING')return {ok:false,reason:'Return dispatch is already being processed.'};
      const observing=!before.simulation && (['REQUESTED','ASSIGNED','REVIEW','COMPLETED'].includes(before.state)||before.assignment_requested_at);
      if(observeOnly&&!observing)return {ok:false,reason:'No active return request to refresh. Request a return driver first.'};
      if(observing&&choice&&(choice.mode!==before.mode||(choice.mode==='IN_HOUSE'&&String(choice.driverId)!==String(before.driver_id))))return {ok:false,reason:'A return request already exists. Review it before replacing the driver.'};
      current=await store.claim(before);
      if(!current)return {ok:false,reason:'Return dispatch is already being processed.'};
      if(observing) {
        // Reconcile by the original reference; refreshing never sends another assignment.
        mutation=true;
        const rows=await provider.findOrders(before.external_reference),remote=rows?.[0];
        if(rows?.length!==1||!matches(remote,{...before,shipday_order_id:before.shipday_order_id||remote.orderId},context.shop,context.customer))throw Error('Return identity is unverified');
        if(!before.shipday_order_id)await save({shipday_order_id:String(remote.orderId)},'RETURN_RECOVERED');
        if(!before.assignment_requested_at&&remote.orderStatus?.orderState==='NOT_ASSIGNED'&&!(Number(remote.assignedCarrier?.id||remote.assignedCarrierId)>0)&&!remote.thirdPartyAssignedAnytime&&!remote.thirdPartyTrackingLink&&!remote.dOrderState)
          return await blocked('The existing return delivery was recovered. Retry the driver request or select a driver.');
        if(before.mode==='THIRD_PARTY')return {...await recordThirdParty(await thirdPartyStatus(provider,current,remote)),already:true};
        const info=await verifyReturn({provider,...context,plan:current});
        if(!info.ok)throw Error('Return assignment unverified');
        await save({state:'ASSIGNED',assigned_name:info.driver,provider_status:info.provider_status,provider_checked_at:info.checked_at,problem:null},'RETURN_RECONCILED');
        return {ok:true,state:'ASSIGNED',already:true};
      }
      if(before.simulation)await save({simulation:false,state:'PLANNED',mode:'THIRD_PARTY',driver_id:null,shipday_order_id:null,external_reference:null,
        assigned_name:null,tracking_url:null,assignment_requested_at:null,trip_snapshot:null,provider_status:null,provider_checked_at:null,problem:null},'SIMULATED_RETURN_REPLACED');
      if(!choice&&!(await settings()).enabled) {
        await save({state:'PLANNED',problem:null,next_attempt_at:null},'RETURN_AWAITING_ADMIN');
        return {ok:true,state:'PLANNED',manual:true};
      }
      const mode=choice?.mode||'THIRD_PARTY';
      await save({mode,driver_id:mode==='IN_HOUSE'?String(choice.driverId):null},'RETURN_MODE_SELECTED');
      let selected;
      if(mode==='IN_HOUSE') {
        selected=(await provider.drivers()).find(d=>d.isActive&&d.isOnShift&&String(d.id)===String(choice.driverId));
        if(!selected)return blocked('Select an available in-house driver in the order’s Return delivery panel.');
      }
      const budget=context.order.pricing_snapshot?.returnCents;
      if(mode==='THIRD_PARTY'&&(!Number.isSafeInteger(budget)||budget<0))return blocked('The saved return courier estimate is unavailable. Review this order before dispatch.');
      const reference=(!before.simulation && before.external_reference) || 'LYNDRY-DEV-'+context.order.order_number+'-RETURN';
      await save({mode,driver_id:selected?String(selected.id):null,simulation:false,state:'PROCESSING',dispatch_at:new Date(now()).toISOString(),
        external_reference:reference,problem:null},'RETURN_REQUESTED');
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
        const endpoint=(row,contact,notes)=>({name:row.name,line1:row.address_line1,line2:row.address_line2,city:row.city,state:row.state,postalCode:row.postal_code,phone:contact,notes});
        mutation=true;
        // Requested delivery is a 30-minute service target; tracking ETA stays separate.
        const pickupAt=now();
        writePending=true;
        const created=await provider.createOrder({externalId:reference,
          from:endpoint(shop,'+12017712933','Collect LYNDRY #'+order.order_number+' from the attendant. Match the original bag photo.'),
          to:endpoint(customer,customer.phone,order.preferences?.dropoff_spot||customer.preferences?.dropoff_spot||''),
          pickupReadyAt:new Date(pickupAt).toISOString(),dropoffDeadlineAt:new Date(pickupAt+30*60000).toISOString(),manifest:[{name:'Development laundry return #'+order.order_number,quantity:1}]});
        await save({shipday_order_id:String(created.id)},'SHIPDAY_RETURN_CREATED');
        mutation=false;writePending=false;
      }
      context=await load(orderId,partnerId);refusal=eligibility(context);if(refusal)throw Error(refusal);
      const rows=await provider.findOrders(reference),remote=rows?.[0];
      if(rows?.length!==1 || !matches(remote,current,context.shop,context.customer)){mutation=true;throw Error('Return cannot be verified');}
      const assignedId=remote.assignedCarrier?.id||remote.assignedCarrierId;
      if(mode==='THIRD_PARTY') {
        if(assignedId&&Number(assignedId)>0){mutation=true;throw Error('Another driver is assigned');}
        if(remote.thirdPartyAssignedAnytime||remote.thirdPartyTrackingLink||remote.dOrderState)return await recordThirdParty(await thirdPartyStatus(provider,current,remote));
        if(remote.orderStatus?.orderState!=='NOT_ASSIGNED'){mutation=true;throw Error('Return activity already started');}
        const assigned=await provider.assign(current.shipday_order_id,{maxFeeCents:budget,requirePin:false,leaveAtDoor:true,
          acceptEstimate:row=>['uber','doordash'].includes(row.service.toLowerCase()),
          beforeAssign:async()=>{
            const latest=await load(orderId,partnerId),why=eligibility(latest);
            if(why||latest.order.pricing_snapshot?.returnCents!==budget||!matches(remote,current,latest.shop,latest.customer))throw Error(why||'Return details changed');
            await save({assignment_requested_at:new Date(now()).toISOString()},'RETURN_COURIER_REQUEST_STARTED');mutation=true;writePending=true;
          }});
        if(!assigned?.ok)return blocked('No third-party courier is available within the saved return estimate. Retry or select an in-house driver.');
        writePending=false;
        return await recordThirdParty(assigned);
      }
      if(remote.thirdPartyAssignedAnytime||remote.thirdPartyTrackingLink||remote.dOrderState){mutation=true;throw Error('Another courier is assigned');}
      if(assignedId && Number(assignedId)>0 && String(assignedId)!==String(selected.id)){mutation=true;throw Error('Another driver is assigned');}
      if(!['NOT_ASSIGNED','NOT_ACCEPTED','NOT_STARTED_YET'].includes(remote.orderStatus?.orderState)){mutation=true;throw Error('Return activity already started');}
      if(!assignedId || Number(assignedId)<=0){
        await save({assignment_requested_at:new Date(now()).toISOString()},'RETURN_DRIVER_REQUEST_STARTED');
        mutation=true;
        writePending=true;
        const result=await provider.assignDriver(current.shipday_order_id,selected.id);
        if(!result?.ok)throw Error('Assignment not confirmed');
        writePending=false;
      }
      const confirmed=await verifyReturn({provider,...context,plan:current});
      if(!confirmed.ok)throw Error('Assignment readback failed');
      await save({state:'ASSIGNED',assigned_name:confirmed.driver,provider_status:confirmed.provider_status,provider_checked_at:confirmed.checked_at,problem:null},'RETURN_DRIVER_ASSIGNED');
      return {ok:true,state:'ASSIGNED'};
    }catch(error){
      const confirmedWriteFailure=writePending&&error.uncertain===false;
      const uncertain=mutation&&!confirmedWriteFailure;
      if(current)await save({state:uncertain?'REVIEW':'BLOCKED',
        ...(confirmedWriteFailure?{assignment_requested_at:null}:{}),next_attempt_at:uncertain?null:new Date(now()+60000).toISOString(),
        problem:uncertain?'Return request needs review in Shipday. Refresh return status to reconcile it before requesting another driver.':'Return checks failed. Retry the request or choose a driver in the order’s Return delivery panel.'},'RETURN_REQUEST_FAILED').catch(()=>{});
      return {ok:false,reason:'Return request needs attention. Contact LYNDRY.'};
    }
  };
}
module.exports={matches,verifyReturn,createRequester};
