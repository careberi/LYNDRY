'use strict';
const {isDeepStrictEqual:sameTrip}=require('node:util');

const clean = value => String(value || '').toLowerCase().replace(/\b(usa|united states)\b/g, '').replace(/[^a-z0-9]/g, '');
const address = row => [row.line1,row.line2,row.city,row.state,row.postalCode].filter(Boolean).join(', ');
function matches(remote, plan) {
  const trip = plan.trip_snapshot;
  return trip && String(remote?.orderId) === String(plan.shipday_order_id) && remote.orderNumber === plan.external_reference &&
    clean(remote.restaurant?.address) === clean(address(trip.from)) &&
    clean(remote.customer?.address) === clean(address(trip.to)) &&
    remote.activityLog?.expectedDeliveryDate === trip.dropoffDeadlineAt.slice(0,10) &&
    remote.activityLog?.expectedPickupTime === trip.pickupReadyAt.slice(11,19) &&
    remote.activityLog?.expectedDeliveryTime === trip.dropoffDeadlineAt.slice(11,19);
}
function assignmentState(result) {
  if (result.status === 'delivered') return 'COMPLETED';
  if (['canceled','CANCELLED','CANCELED'].includes(result.status)) return 'CANCELED';
  if (['REQUESTED','STARTED','ASSIGNED','pickup_complete'].includes(result.status)) {
    return result.status!=='REQUESTED' && result.courier?.name ? 'ASSIGNED' : 'REQUESTED';
  }
  return 'REVIEW';
}
function orderResult(remote) {
  const status=remote.orderStatus?.orderState;
  if(['FAILED_DELIVERY','INCOMPLETE'].includes(status))return {status:'FAILED'};
  if(['CANCELED','CANCELLED'].includes(status))return {status:'canceled'};
  if(status==='ALREADY_DELIVERED')return {status:'delivered',courier:remote.assignedCarrier};
  return null;
}
// This legacy hold happened before any Shipday write. Only an explicit staff
// retry may reopen it; ambiguous requests and other review holds stay locked.
function canRetryUtcBoundaryReview(plan) {
  return Boolean(plan && plan.booking_dispatch && !plan.simulation && plan.leg === 'TO_PARTNER' &&
    plan.state === 'REVIEW' && plan.problem === 'This pickup crosses the Shipday UTC scheduling boundary. Dispatch review is required.' &&
    !plan.shipday_order_id && !plan.assignment_requested_at && !plan.trip_snapshot);
}
function createBookingDispatcher({store,provider,validate,now=Date.now}) {
  async function run(id,override=null,actor='booking-dispatch') {
    const before = await store.get(id);
    if (!before?.booking_dispatch || before.simulation || before.leg !== 'TO_PARTNER' ||
        (before.mode==='IN_HOUSE'&&!before.assignment_requested_at&&!override) ||
        (!['PLANNED','BLOCKED','REQUESTED','ASSIGNED'].includes(before.state) && !(override && canRetryUtcBoundaryReview(before)))) return {ok:false,reason:'Not eligible for automatic pickup dispatch.'};
    if(override&&(!['THIRD_PARTY','IN_HOUSE'].includes(override.mode)||(override.mode==='IN_HOUSE'&&!/^\d+$/.test(String(override.driverId)))))return {ok:false,reason:'Choose a Shipday driver.'};
    if(override?.arrivalLocal&&override.mode!=='IN_HOUSE')return {ok:false,reason:'Manual arrival is only available for an in-house driver.'};
    if(override?.arrivalLocal&&before.shipday_order_id)return {ok:false,reason:'This Shipday job already has an arrival time. Edit its pickup details before changing that time.'};
    if (!override && before.next_attempt_at && Date.parse(before.next_attempt_at) > now()) return {ok:false,reason:'Retry scheduled.'};
    let plan = await store.claim(before);
    if (!plan) return {ok:false,reason:'Another dispatch attempt is processing.'};
    let uncertain = false;
    let step = 'order and payment checks';
    const save = async (patch,event) => {
      plan = await store.save(plan,patch,{event,actor,at:new Date(now()).toISOString()});
    };
    const stop = async (state,problem,event='DISPATCH_BLOCKED') => {
      await save({state,problem,next_attempt_at:state==='BLOCKED'?new Date(now()+60000).toISOString():null},event);
      return {ok:false,reason:problem};
    };
    async function remoteOrder() {
      step = 'Shipday order lookup';
      const rows = await provider.findOrders(plan.external_reference);
      if (!Array.isArray(rows) || rows.length !== 1 || !matches(rows[0],plan)) throw Error('Shipday order details do not match the scheduled pickup.');
      return rows[0];
    }
    async function recordAssignment(result) {
      const state = assignmentState(result);
      await save({state,assigned_name:['ASSIGNED','COMPLETED'].includes(state)?result.courier?.name||null:null,
        tracking_url:result.trackingUrl||null,
        problem:state==='REVIEW'?(result.status==='FAILED'?'Pickup failed in Shipday. Review the pickup before requesting another driver.':'Shipday returned an unconfirmed delivery state. Check Shipday before retrying.'):null,
        next_attempt_at:new Date(now()+30000).toISOString()},'SHIPDAY_STATUS_'+state);
      return {ok:state!=='REVIEW',state};
    }
    async function status(remote) {
      const terminal=orderResult(remote);
      if(terminal)return terminal;
      if(plan.mode==='IN_HOUSE')return {status:remote.assignedCarrier?.id&&String(remote.assignedCarrier.id)===String(plan.driver_id)?'ASSIGNED':'REQUESTED',courier:remote.assignedCarrier};
      return provider.status(plan.shipday_order_id);
    }
    try {
      if(override && canRetryUtcBoundaryReview(before)) await save({problem:null},'UTC_BOUNDARY_RETRY');
      if(override) {
        const checked=await validate(plan);
        if(!checked.ok||!checked.canAssign)return stop(canRetryUtcBoundaryReview(before)?'BLOCKED':before.state,checked.reason||'Payment checks must pass before assignment.');
        step = 'Shipday driver lookup';
        if(override.mode==='IN_HOUSE'&&!(await provider.drivers()).some(d=>String(d.id)===String(override.driverId)&&d.isActive&&d.isOnShift))return stop(canRetryUtcBoundaryReview(before)?'BLOCKED':before.state,'The selected Shipday driver is inactive or offline.');
        if(plan.shipday_order_id) {
          let remote=await remoteOrder();
          if(orderResult(remote))return recordAssignment(orderResult(remote));
          if(plan.mode==='IN_HOUSE'&&plan.assignment_requested_at&&!remote.assignedCarrier?.id)return stop('REVIEW','The previous Shipday driver request is not confirmed. Reconcile it before assigning again.');
          if(!['NOT_ASSIGNED','NOT_ACCEPTED','NOT_STARTED_YET','STARTED'].includes(remote.orderStatus?.orderState)||remote.activityLog?.pickedUpTime)return stop('REVIEW','Pickup may have started. Resolve it in Shipday before reassigning.');
          const thirdParty=plan.mode==='THIRD_PARTY'&&(plan.assignment_requested_at||remote.thirdPartyAssignedAnytime||remote.dOrderState);
          if(thirdParty||remote.assignedCarrier?.id) {
            if(plan.mode===override.mode&&(override.mode==='THIRD_PARTY'||String(remote.assignedCarrier?.id)===String(override.driverId)))return recordAssignment(await status(remote));
            if(!override.acceptCancellationFee)return stop(before.state,'Confirm replacement of the current driver and possible cancellation charges.');
            if(thirdParty) {
              const live=await provider.status(plan.shipday_order_id);
              if(!['REQUESTED','STARTED','ASSIGNED'].includes(live.status))return stop('REVIEW','Courier state does not allow safe replacement. Check Shipday.');
            }
            uncertain=true;
            const released=thirdParty?await provider.cancel(plan.shipday_order_id):await provider.unassign(plan.shipday_order_id);
            if(!released?.ok)throw Error('Release unconfirmed');
            if(thirdParty&&!['canceled','CANCELED','CANCELLED'].includes((await provider.status(plan.shipday_order_id)).status))throw Error('Cancellation unconfirmed');
            remote=await remoteOrder();
            if(remote.assignedCarrier?.id||!['NOT_ASSIGNED','NOT_ACCEPTED','NOT_STARTED_YET'].includes(remote.orderStatus?.orderState))throw Error('Driver release not confirmed');
            await save({assigned_name:null,assignment_requested_at:null,tracking_url:null},'DRIVER_RELEASE_CONFIRMED');
            uncertain=false;
          }
        }
        await save({mode:override.mode,driver_id:override.mode==='IN_HOUSE'?String(override.driverId):null},'ASSIGNMENT_SELECTED');
      }
      if (!override && (['REQUESTED','ASSIGNED'].includes(before.state) || plan.assignment_requested_at)) {
        // An accepted request is only polled. It must never reach assign again.
        return await recordAssignment(await status(await remoteOrder()));
      }
      let checked = await validate(plan);
      if (!checked.ok) return stop(plan.shipday_order_id?'REVIEW':'BLOCKED',checked.reason);
      if (plan.trip_snapshot && !sameTrip(plan.trip_snapshot,checked.trip)) {
        return stop('REVIEW','Pickup details changed. Review the existing Shipday job before dispatch.');
      }
      if (!plan.shipday_order_id) {
        step = 'Shipday order lookup';
        const existing = await provider.findOrders(checked.trip.externalId);
        if (!Array.isArray(existing)) throw Error('Shipday reference lookup unavailable.');
        if (existing.length) return stop('REVIEW','This pickup reference already exists in Shipday. Reconcile it before requesting a driver.');
        const latest=await validate(plan);
        if(!latest.ok || !sameTrip(latest.trip,checked.trip))return stop('BLOCKED',latest.reason||'Booking changed before scheduling. Checking again shortly.');
        // An in-house Shipday driver does not depend on an Uber/DoorDash offer.
        if(plan.mode==='THIRD_PARTY') {
        step = 'Uber/DoorDash availability check';
        const quote=await provider.quote(checked.trip);
        const offer=quote.options?.find(row=>['uber','doordash'].includes(row.service.toLowerCase()) &&
          row.feeCents<=checked.budgetCents && !row.requiresFeeReview &&
          Date.parse(row.pickupTime)>=Date.parse(checked.trip.pickupReadyAt) &&
          Date.parse(row.pickupTime)<=Date.parse(checked.trip.pickupReadyAt)+30*60000 &&
          Date.parse(row.deliveryTime)>Date.parse(row.pickupTime) &&
          (!checked.acceptEstimate||checked.acceptEstimate(row)));
        if(!offer)return stop('BLOCKED','No confirmed Uber or DoorDash service fits the pickup time, laundromat hours and saved budget. Retrying shortly.');
        checked.trip.dropoffDeadlineAt=new Date(offer.deliveryTime).toISOString();
        } else {
          const timing=require('./pickup-timing');
          let arrival;
          if(override?.arrivalLocal) {
            try {arrival=timing.manualArrival(override.arrivalLocal,checked.trip.pickupReadyAt);}
            catch(error){return stop('BLOCKED',error.message);}
          } else if(checked.inHouseArrivalAt) {
            arrival=checked.inHouseArrivalAt;
          } else {
            step='in-house travel estimate';
            try {arrival=timing.inHouseArrival(await provider.quote(checked.trip),checked.trip.pickupReadyAt,checked.loadingBufferMinutes??10);}
            catch {arrival=null;}
          }
          if(!arrival)return stop('BLOCKED','Travel time is unavailable. Enter the expected laundromat arrival in Eastern time for this in-house assignment.');
          if(checked.acceptEstimate&&!checked.acceptEstimate({deliveryTime:arrival}))return stop('BLOCKED','The estimated arrival does not fit laundromat hours, turnaround and next-day collection. Choose an earlier pickup or review the arrival time.');
          checked.trip.dropoffDeadlineAt=arrival;
        }
        // Shipday's dashboard sends the UTC delivery date and independent UTC
        // clock times. An Eastern evening trip may cross midnight UTC; keep
        // both instants intact and verify the saved schedule before assignment.
        await save({trip_snapshot:checked.trip,external_reference:checked.trip.externalId},override?.arrivalLocal?'PICKUP_PREPARED_MANUAL_ARRIVAL':'PICKUP_PREPARED');
        const beforeCreate=await validate(plan);
        if(!beforeCreate.ok||!sameTrip(beforeCreate.trip,plan.trip_snapshot))return stop('BLOCKED',beforeCreate.reason||'Booking changed before scheduling. Checking again shortly.');
        uncertain = true;
        step = 'Shipday job creation';
        const created = await provider.createOrder(checked.trip);
        await save({shipday_order_id:String(created.id)},'SHIPDAY_ORDER_CREATED');
        uncertain = false;
      }
      const remote = await remoteOrder();
      if(orderResult(remote))return recordAssignment(orderResult(remote));
      // Account-side automation or manual assignment may have acted first.
      if (!override && (remote.thirdPartyAssignedAnytime || remote.thirdPartyTrackingLink || remote.dOrderState)) {
        await save({assignment_requested_at:new Date(now()).toISOString()},'EXISTING_COURIER_REQUEST');
        return await recordAssignment(await provider.status(plan.shipday_order_id));
      }
      if (remote.assignedCarrier?.id || !['NOT_ASSIGNED','NOT_ACCEPTED','NOT_STARTED_YET'].includes(remote.orderStatus?.orderState)) {
        return stop('REVIEW','A driver or delivery activity already exists in Shipday. Automatic assignment is paused.');
      }
      checked = await validate(plan);
      if (!checked.ok || !sameTrip(checked.trip,plan.trip_snapshot)) return stop('REVIEW',checked.reason||'Pickup details changed before assignment.');
      if (!checked.canAssign) return stop('BLOCKED',checked.reason||'Waiting for payment authorization before requesting a courier.');
      if(checked.acceptEstimate&&!checked.acceptEstimate({deliveryTime:checked.trip.dropoffDeadlineAt}))return stop('BLOCKED','Laundromat hours or turnaround changed. The scheduled arrival no longer allows next-day collection.');
      if(plan.mode==='IN_HOUSE') {
        await save({assignment_requested_at:new Date(now()).toISOString()},'IN_HOUSE_REQUEST_STARTED');
        uncertain=true;
        step = 'Shipday in-house assignment';
        const assigned=await provider.assignDriver(plan.shipday_order_id,plan.driver_id);
        if(!assigned?.ok)throw Error('Assignment unconfirmed');
        const result=await recordAssignment(await status(await remoteOrder()));
        uncertain=false;
        return result;
      }
      step = 'Uber/DoorDash assignment';
      const assigned = await provider.assign(plan.shipday_order_id,{maxFeeCents:checked.budgetCents,
        pickupReadyAt:checked.trip.pickupReadyAt,trip:checked.trip,requirePin:false,leaveAtDoor:false,
        acceptEstimate:checked.acceptEstimate,
        beforeAssign:async () => {
          const latest = await validate(plan);
          if (!latest.ok || !latest.canAssign || latest.budgetCents!==checked.budgetCents || !sameTrip(latest.trip,plan.trip_snapshot)) {
            throw Error('Booking or payment changed before the courier request.');
          }
          await save({assignment_requested_at:new Date(now()).toISOString()},'COURIER_REQUEST_STARTED');
          uncertain = true;
        }});
      if (!assigned.ok) return stop('BLOCKED','No Uber or DoorDash estimate currently fits the scheduled pickup and saved courier budget. Retrying automatically.');
      const result = await recordAssignment(assigned);
      uncertain = false;
      return result;
    } catch (error) {
      // A crash after claim is also reconciled by the recovery worker, never replayed.
      const requested = uncertain || plan.assignment_requested_at;
      if (['REQUESTED','ASSIGNED'].includes(before.state) && !uncertain && !override) {
        await save({state:before.state,problem:'Live Shipday status is temporarily unavailable. Checking again shortly.',next_attempt_at:new Date(now()+30000).toISOString()},'STATUS_UNAVAILABLE');
        return {ok:false,reason:'Status unavailable.'};
      }
      return stop(requested?'REVIEW':'BLOCKED',requested?
        'Shipday request outcome is uncertain. Check the existing reference in Shipday; automatic retries are paused.':
        `Could not complete ${step}${/HTTP \d{3}/.exec(String(error.message)) ? ' ('+/HTTP \d{3}/.exec(String(error.message))[0]+')' : ''}. No new driver request was sent. ${override?'Try Assign again.':'Automatic dispatch will retry when enabled.'}`,'DISPATCH_CHECK_FAILED');
    }
  }
  return {run};
}
module.exports={createBookingDispatcher,assignmentState,matches,orderResult,canRetryUtcBoundaryReview};
