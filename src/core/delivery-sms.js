'use strict';

// Only verified milestones and customer-side ETAs leave this module. Never
// copy vendor names, links, locations, driver instructions or arbitrary text.
const collected = new Set(['PICKED_UP','READY_TO_DELIVER','ALREADY_DELIVERED']);
const failed = new Set(['CANCELED','CANCELLED','INCOMPLETE','FAILED_DELIVERY']);
const clean = x => String(x || '').toLowerCase().replace(/\b(usa|united states)\b/g,'').replace(/[^a-z0-9]/g,'');
const address = x => [x.address_line1,x.address_line2,x.city,x.state,x.postal_code].filter(Boolean).join(', ');

async function observe({provider,tracking,order,shop,plan,now=Date.now}) {
  if (!order.customers?.default_payment_method_id || order.status === 'CANCELED' ||
      !plan || plan.simulation || !plan.shipday_order_id || !plan.external_reference ||
      !['TO_PARTNER','TO_CUSTOMER'].includes(plan.leg)) return null;
  const pickup = plan.leg === 'TO_PARTNER';
  const customer = require('./order-address').customerFor(order, order.customers);
  const from = pickup ? customer : shop, to = pickup ? shop : customer;
  const rows = await provider.findOrders(plan.external_reference);
  const remote = rows?.[0];
  if(rows?.length !== 1 || String(remote.orderId) !== String(plan.shipday_order_id) ||
      remote.orderNumber !== plan.external_reference || clean(remote.restaurant?.address) !== clean(address(from)) ||
      clean(remote.customer?.address) !== clean(address(to))) return null;
  const status = remote.orderStatus?.orderState;
  if(failed.has(status) || remote.orderStatus?.incomplete || remote.activityLog?.failedDeliveryTime) return null;
  if(!['NOT_ASSIGNED','NOT_ACCEPTED','NOT_STARTED_YET','STARTED',...collected].includes(status)) return null;
  if(plan.mode === 'IN_HOUSE' && (!remote.assignedCarrier?.id || String(remote.assignedCarrier.id) !== String(plan.driver_id))) return null;
  if(plan.mode === 'THIRD_PARTY' || remote.thirdPartyAssignedAnytime || remote.thirdPartyTrackingLink || remote.dOrderState) {
    const live = await provider.status(plan.shipday_order_id);
    if(!live?.courier?.name || !['STARTED','ASSIGNED','pickup_complete','delivered'].includes(live.status)) return null;
    if(collected.has(status) && !['pickup_complete','delivered'].includes(live.status)) return null;
    if(status === 'ALREADY_DELIVERED' && live.status !== 'delivered') return null;
  }
  let rank = pickup ? (collected.has(status) ? 3 : status === 'STARTED' ? 1 : 0)
    : status === 'ALREADY_DELIVERED' ? 3 : collected.has(status) ? 1 : 0;
  let etaMinutes = null;
  if(rank === 1) {
    const extra = await tracking(remote.trackingLink,{reference:remote.orderNumber,status,driverId:remote.assignedCarrier?.id}).catch(()=>null);
    // The generic tracking ETA is arrival at the destination (the laundromat
    // on the outbound leg). Pickup must exclusively use pickup ETA.
    const candidate = pickup ? extra?.pickupEtaMinutes : extra?.etaMinutes;
    if(Number.isFinite(candidate) && candidate >= 0 && candidate <= 180) etaMinutes = candidate;
    if(etaMinutes !== null && etaMinutes <= 10) rank = 2;
  }
  return {rank,etaMinutes,observedAt:new Date(now()).toISOString(),remoteId:String(remote.orderId),
    terminal:status === 'ALREADY_DELIVERED',
    deliveryPhotos:!pickup ? require('../providers/couriers/shipday-proof').deliveryPhotos(remote) : []};
}

function estimate(observation,now) {
  if(observation.etaMinutes === null || now-Date.parse(observation.observedAt)>120000 || now<Date.parse(observation.observedAt)) return '';
  const arrival = Math.ceil((Date.parse(observation.observedAt)+observation.etaMinutes*60000)/300000)*300000;
  const time = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date(arrival));
  return ` Estimated arrival around ${time} ET. Timing may change.`;
}

function nextMessage(order,plan,state,observation,now=Date.now()) {
  if(!observation || !Number.isFinite(Date.parse(observation.observedAt)) || now<Date.parse(observation.observedAt) || now-Date.parse(observation.observedAt)>120000 || observation.rank===0 || (state.rank===3 && observation.rank<3)) return null;
  const pickup=plan.leg==='TO_PARTNER',rank=Math.max(state.rank,observation.rank);
  const prefix=`LYNDRY #${order.order_number}: `;
  if(rank>state.rank) {
    const text=pickup ? {1:'Your driver is on the way to pick up your laundry.',2:'Your pickup driver should arrive soon.',3:'Your laundry has been collected.'}[rank]
      : {1:'Your clean laundry is out for delivery.',2:'Your clean laundry is out for delivery. Your driver should arrive soon.',3:'Your laundry has been delivered.'}[rank];
    return {key:`milestone-${rank}`,rank,body:prefix+text+(rank<3?estimate(observation,now):'')};
  }
  if(rank>=3 || observation.etaMinutes===null || !state.last_message_at || now-Date.parse(state.last_message_at)<15*60000) return null;
  const arrival=Date.parse(observation.observedAt)+observation.etaMinutes*60000;
  if(state.last_eta_at && Math.abs(arrival-Date.parse(state.last_eta_at))<10*60000) return null;
  return {key:`eta-${Math.floor(now/(15*60000))}`,rank,body:prefix+(pickup?'Your pickup arrival estimate has changed.':'Your delivery arrival estimate has changed.')+estimate(observation,now)};
}

module.exports={observe,nextMessage};
