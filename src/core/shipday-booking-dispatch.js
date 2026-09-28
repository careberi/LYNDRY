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
function createBookingDispatcher({store,provider,validate,now=Date.now}) {
  async function run(id) {
    const before = await store.get(id);
    if (!before?.booking_dispatch || before.simulation || before.leg !== 'TO_PARTNER' || before.mode !== 'THIRD_PARTY' ||
        !['PLANNED','BLOCKED','REQUESTED','ASSIGNED'].includes(before.state)) return {ok:false,reason:'Not eligible for automatic pickup dispatch.'};
    if (before.next_attempt_at && Date.parse(before.next_attempt_at) > now()) return {ok:false,reason:'Retry scheduled.'};
    let plan = await store.claim(before);
    if (!plan) return {ok:false,reason:'Another dispatch attempt is processing.'};
    let uncertain = false;
    const save = async (patch,event) => {
      plan = await store.save(plan,patch,{event,actor:'booking-dispatch',at:new Date(now()).toISOString()});
    };
    const stop = async (state,problem,event='DISPATCH_BLOCKED') => {
      await save({state,problem,next_attempt_at:state==='BLOCKED'?new Date(now()+60000).toISOString():null},event);
      return {ok:false,reason:problem};
    };
    async function remoteOrder() {
      const rows = await provider.findOrders(plan.external_reference);
      if (!Array.isArray(rows) || rows.length !== 1 || !matches(rows[0],plan)) throw Error('Shipday order details do not match the scheduled pickup.');
      return rows[0];
    }
    async function recordAssignment(result) {
      const state = assignmentState(result);
      await save({state,assigned_name:['ASSIGNED','COMPLETED'].includes(state)?result.courier?.name||null:null,
        tracking_url:result.trackingUrl||null,
        problem:state==='REVIEW'?'Shipday returned an unconfirmed delivery state. Check Shipday before retrying.':null,
        next_attempt_at:new Date(now()+30000).toISOString()},'SHIPDAY_STATUS_'+state);
      return {ok:state!=='REVIEW',state};
    }
    try {
      if (['REQUESTED','ASSIGNED'].includes(before.state) || plan.assignment_requested_at) {
        // An accepted request is only polled. It must never reach assign again.
        await remoteOrder();
        return await recordAssignment(await provider.status(plan.shipday_order_id));
      }
      let checked = await validate(plan);
      if (!checked.ok) return stop(plan.shipday_order_id?'REVIEW':'BLOCKED',checked.reason);
      if (plan.trip_snapshot && !sameTrip(plan.trip_snapshot,checked.trip)) {
        return stop('REVIEW','Pickup details changed. Review the existing Shipday job before dispatch.');
      }
      if (!plan.shipday_order_id) {
        const existing = await provider.findOrders(checked.trip.externalId);
        if (!Array.isArray(existing)) throw Error('Shipday reference lookup unavailable.');
        if (existing.length) return stop('REVIEW','This pickup reference already exists in Shipday. Reconcile it before requesting a driver.');
        const latest=await validate(plan);
        if(!latest.ok || !sameTrip(latest.trip,checked.trip))return stop('BLOCKED',latest.reason||'Booking changed before scheduling. Checking again shortly.');
        const quote=await provider.quote(checked.trip);
        const offer=quote.options?.find(row=>['uber','doordash'].includes(row.service.toLowerCase()) &&
          row.feeCents<=checked.budgetCents && !row.requiresFeeReview &&
          Date.parse(row.pickupTime)>=Date.parse(checked.trip.pickupReadyAt) &&
          Date.parse(row.pickupTime)<=Date.parse(checked.trip.pickupReadyAt)+30*60000 &&
          Date.parse(row.deliveryTime)>Date.parse(row.pickupTime) &&
          (!checked.acceptEstimate||checked.acceptEstimate(row)));
        if(!offer)return stop('BLOCKED','No confirmed Uber or DoorDash service fits the pickup time, laundromat hours and saved budget. Retrying shortly.');
        checked.trip.dropoffDeadlineAt=new Date(offer.deliveryTime).toISOString();
        if(checked.trip.dropoffDeadlineAt.slice(0,10)!==checked.trip.pickupReadyAt.slice(0,10))return stop('REVIEW','This pickup crosses the Shipday UTC scheduling boundary. Dispatch review is required.');
        await save({trip_snapshot:checked.trip,external_reference:checked.trip.externalId},'PICKUP_PREPARED');
        const beforeCreate=await validate(plan);
        if(!beforeCreate.ok||!sameTrip(beforeCreate.trip,plan.trip_snapshot))return stop('BLOCKED',beforeCreate.reason||'Booking changed before scheduling. Checking again shortly.');
        uncertain = true;
        const created = await provider.createOrder(checked.trip);
        await save({shipday_order_id:String(created.id)},'SHIPDAY_ORDER_CREATED');
        uncertain = false;
      }
      const remote = await remoteOrder();
      // Account-side automation or manual assignment may have acted first.
      if (remote.thirdPartyAssignedAnytime || remote.thirdPartyTrackingLink || remote.dOrderState) {
        await save({assignment_requested_at:new Date(now()).toISOString()},'EXISTING_COURIER_REQUEST');
        return await recordAssignment(await provider.status(plan.shipday_order_id));
      }
      if (remote.assignedCarrier?.id || !['NOT_ASSIGNED','NOT_ACCEPTED','NOT_STARTED_YET'].includes(remote.orderStatus?.orderState)) {
        return stop('REVIEW','A driver or delivery activity already exists in Shipday. Automatic assignment is paused.');
      }
      checked = await validate(plan);
      if (!checked.ok || !sameTrip(checked.trip,plan.trip_snapshot)) return stop('REVIEW',checked.reason||'Pickup details changed before assignment.');
      if (!checked.canAssign) return stop('BLOCKED',checked.reason||'Waiting for payment authorization before requesting a courier.');
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
      if (['REQUESTED','ASSIGNED'].includes(before.state) && !uncertain) {
        await save({state:before.state,problem:'Live Shipday status is temporarily unavailable. Checking again shortly.',next_attempt_at:new Date(now()+30000).toISOString()},'STATUS_UNAVAILABLE');
        return {ok:false,reason:'Status unavailable.'};
      }
      return stop(requested?'REVIEW':'BLOCKED',requested?
        'Shipday request outcome is uncertain. Check the existing reference in Shipday; automatic retries are paused.':
        'Dispatch checks could not be completed. No new courier request was sent. Retrying shortly.','DISPATCH_CHECK_FAILED');
    }
  }
  return {run};
}
module.exports={createBookingDispatcher,assignmentState,matches};
