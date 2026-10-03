'use strict';

const sync = require('./shipday-order-sync');
const { dispatchInstant } = require('./shipday-dispatch');

// A successful empty lookup is evidence of absence. An exception, malformed
// response or conflicting identity is never treated as a deleted delivery.
async function reconcile({ provider, plan, order, customer, partner }) {
  const reference = plan.external_reference;
  if (reference !== `LYNDRY-DEV-${order.order_number}-PICKUP`) throw Error('The linked Shipday reference needs review before editing.');
  const rows = await provider.findOrders(reference);
  if (!Array.isArray(rows)) throw Error('Shipday could not confirm whether this pickup still exists. Try again shortly.');
  if (!rows.length) return { outcome: 'MISSING', trip: null, state: 'CANCELED', assignedName: null };
  if (rows.length !== 1 || String(rows[0].orderId) !== String(plan.shipday_order_id) || rows[0].orderNumber !== reference) {
    throw Error('Shipday returned a conflicting pickup reference. No delivery was changed.');
  }
  const remote = rows[0];
  const blocked = sync.editable(remote);
  if (blocked) throw Error(blocked);
  const at = dispatchInstant(order.pickup_date, String(order.pickup_time).slice(0,5));
  const previousDuration = Date.parse(plan.trip_snapshot?.dropoffDeadlineAt) - Date.parse(plan.trip_snapshot?.pickupReadyAt);
  const duration = Number.isFinite(previousDuration) && previousDuration > 0 ? previousDuration : 3600000;
  const arrival = new Date(Date.parse(at) + duration).toISOString();
  // Keep both instants intact when an evening trip crosses midnight UTC.
  const addressOf = require('./courier-legs').addressOf;
  const trip = { ...(plan.trip_snapshot || {}), externalId: reference,
    from: addressOf(customer,{name:customer.name,phone:customer.phone,notes:order.preferences.dropoff_spot}),
    to: addressOf(partner,{name:partner.name,phone:'+12017712933',notes:'Deliver laundry to the attendant. Match LYNDRY order #'+order.order_number+'. Photo proof only; no signature.'}),
    pickupReadyAt:at,dropoffDeadlineAt:arrival,
    manifest:[{name:'LYNDRY laundry pickup #'+order.order_number,quantity:1}] };
  await sync.synchronize({provider,order,customer,partner,plan:{...plan,trip_snapshot:trip}});
  return {outcome:'UPDATED',trip,state:remote.assignedCarrier?.id?'ASSIGNED':'BLOCKED',assignedName:remote.assignedCarrier?.name||null};
}

async function saveWithSync({ order, change, quote, actor, expected, customer }) {
  const { config } = require('../config');
  const db = require('../db'), runtime = require('./shipday-dispatch-runtime');
  const data = runtime.result;
  const args = {p_order:order.id,p_admin:actor.id,p_expected:expected,p_date:change.pickup_date,p_time:change.pickup_time,p_preferences:change.preferences,p_snapshot:quote.snapshot};
  const plan = await data(db.from('shipday_dispatch_plans').select('*').eq('order_id',order.id).eq('leg','TO_PARTNER').maybeSingle());
  if (!plan?.shipday_order_id) return data(db.rpc('edit_dev_pickup_details',args));
  if (config.env !== 'development' || !config.supabase.isDevelopment) throw Error('Shipday pickup edits are not enabled in this environment.');
  if (plan.state === 'PROCESSING') throw Error('A Shipday action is processing. Try the edit again shortly.');
  const claimed = await runtime.store.claim(plan);
  if (!claimed) throw Error('The assignment changed. Refresh the order and try again.');
  try {
    const provider = require('../providers/couriers/shipday').createClient({apiKey:config.shipday.apiKey,allowEdits:true});
    const partner = await require('./partners').find(quote.snapshot.partnerId);
    const point = await require('./geocode').locate(customer);
    const result = await reconcile({provider,plan:claimed,order:{...order,...change},customer:{...customer,...point},partner});
    await data(db.rpc('edit_dev_pickup_details_reconciled',{...args,p_plan:claimed.id,p_version:claimed.version,p_remote:claimed.shipday_order_id,
      p_outcome:result.outcome,p_trip:result.trip,p_state:result.state,p_assigned:result.assignedName}));
    return result;
  } catch (error) {
    await runtime.store.save(claimed,{state:'REVIEW',problem:'Pickup edit needs review: '+error.message,next_attempt_at:null},
      {event:'PICKUP_EDIT_REVIEW',actor:actor.id,at:new Date().toISOString()}).catch(()=>{});
    throw error;
  }
}

module.exports = { reconcile, saveWithSync };
