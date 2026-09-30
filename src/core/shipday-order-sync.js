'use strict';

// Editing delivery details must never create, assign, cancel or replace a trip.
const { dispatchInstant } = require('./shipday-dispatch');
const phone = require('../providers/couriers/shipday-contact').BUSINESS_PHONE;
const clean = value => String(value || '').replace(/[^a-zA-Z0-9 .'-]/g, ' ').replace(/\s+/g, ' ').trim();
const comparable = value => String(value || '').toLowerCase().replace(/\b(usa|united states)\b/g, '').replace(/[^a-z0-9]/g, '');
const address = row => [row.address_line1, row.address_line2, row.city, row.state, row.postal_code].filter(Boolean).join(', ');

function payload(order, customer, partner, plan, remote) {
  if (!['TO_PARTNER', 'TO_CUSTOMER'].includes(plan.leg)) throw Error('Unknown delivery leg.');
  if (!partner || partner.status !== 'ACTIVE') throw Error('Select an active destination laundromat.');
  if (['CANCELED','DELIVERED'].includes(order.status)) throw Error('This order is closed. Review its Shipday delivery manually.');
  const pickup = plan.leg === 'TO_PARTNER';
  if (pickup && !['REQUESTED','IN_PROCESS'].includes(order.status)) throw Error('Laundry collection has started. Review the destination with dispatch.');
  const from = pickup ? customer : partner, to = pickup ? partner : customer;
  if (!from?.address_line1 || !to?.address_line1 || !customer.phone) throw Error('Both delivery addresses and the customer phone are required.');
  const prefs = order.preferences || {};
  const location = prefs.dropoff_spot || prefs.special_instructions || customer.preferences?.dropoff_spot || customer.preferences?.special_instructions || '';
  // Shipday's edit API saves deliveryInstruction but ignores pickupInstruction.
  // Include both ends in the documented driver-visible instruction field.
  const notes = 'LYNDRY order #' + order.order_number + '. ' + (pickup ? 'Pickup: '+(location || 'Follow pickup instructions')+'. Drop-off: laundry to the laundromat attendant; match this order reference.' : 'Pickup: collect laundry from the attendant; match this order reference. Return: '+location);
  const body = {
    orderId: Number(plan.shipday_order_id), orderNo: remote.orderNumber,
    restaurantName: clean(from.name), restaurantAddress: address(from), restaurantPhoneNumber: pickup ? customer.phone : phone,
    customerName: clean(to.name), customerAddress: address(to), customerPhoneNumber: pickup ? phone : customer.phone,
    customerEmail: '',
    pickupInstruction: pickup ? location : 'Collect LYNDRY order #' + order.order_number + '. Match the reference with the attendant.',
    deliveryInstruction: notes,
  };
  // Preserve the return schedule; pickup edits use the customer's selected Eastern time.
  if (pickup) {
    const at = dispatchInstant(order.pickup_date, String(order.pickup_time || '').slice(0,5));
    if (!at) throw Error('A valid customer-selected pickup date and time are required.');
    const delivery = plan.booking_dispatch && plan.trip_snapshot?.dropoffDeadlineAt
      ? plan.trip_snapshot.dropoffDeadlineAt : new Date(Date.parse(at) + 60 * 60 * 1000).toISOString();
    body.expectedDeliveryDate = delivery.slice(0,10);
    body.expectedPickupTime = at.slice(11,19);
    body.expectedDeliveryTime = delivery.slice(11,19);
  }
  // Never leave coordinates from the previous destination attached to the new address.
  for (const [prefix, row] of [['pickup', from], ['delivery', to]]) {
    if (row.lat == null || row.lng == null || !Number.isFinite(Number(row.lat)) || !Number.isFinite(Number(row.lng))) throw Error('Both addresses need verified map coordinates before syncing.');
    body[prefix+'Latitude'] = Number(row.lat); body[prefix+'Longitude'] = Number(row.lng);
  }
  return body;
}

function matches(remote, body) {
  const pairs = [
    [remote.restaurant?.name, body.restaurantName], [remote.restaurant?.address, body.restaurantAddress],
    [remote.restaurant?.phoneNumber, body.restaurantPhoneNumber], [remote.customer?.name, body.customerName],
    [remote.customer?.address, body.customerAddress], [remote.customer?.phoneNumber, body.customerPhoneNumber],
    [remote.deliveryInstruction, body.deliveryInstruction],
  ];
  if (body.expectedDeliveryDate) pairs.push([remote.activityLog?.expectedDeliveryDate,body.expectedDeliveryDate], [remote.activityLog?.expectedPickupTime,body.expectedPickupTime], [remote.activityLog?.expectedDeliveryTime,body.expectedDeliveryTime]);
  // Shipday geocodes edited addresses itself; its coordinates can legitimately
  // differ from our estimate. Confirm addresses and usable returned map points.
  return pairs.every(([a,b])=>comparable(a)===comparable(b)) &&
    ['restaurant','customer'].every(key=>['latitude','longitude'].every(axis=>remote[key]?.[axis]!=null && Number.isFinite(Number(remote[key][axis]))));
}

function editable(remote) {
  if (remote.thirdPartyAssignedAnytime || remote.thirdPartyTrackingLink || remote.dOrderState) return 'A third-party courier is linked. Review the change in Shipday; do not assume it reaches Uber or DoorDash.';
  if (!['NOT_ASSIGNED','NOT_ACCEPTED','NOT_STARTED_YET'].includes(remote.orderStatus?.orderState)) return 'The driver may have started. Confirm the delivery change with dispatch.';
  if (remote.activityLog?.startTime || remote.activityLog?.pickedUpTime || remote.activityLog?.deliveryTime) return 'Delivery activity has started. Dispatch review is required.';
  return null;
}

async function synchronize({provider, order, customer, partner, plan}) {
  if (!/^[1-9]\d*$/.test(String(plan.shipday_order_id))) throw Error('Only an existing Shipday delivery can be updated.');
  const reference = plan.external_reference || `LYNDRY-DEV-${order.order_number}-${plan.leg==='TO_PARTNER'?'PICKUP':'RETURN'}`;
  const get = async () => {
    const rows = await provider.findOrders(reference);
    if (!Array.isArray(rows) || rows.length !== 1 || String(rows[0].orderId) !== String(plan.shipday_order_id) || rows[0].orderNumber !== reference) throw Error('Shipday order identity could not be confirmed.');
    return rows[0];
  };
  const remote = await get();
  const body = payload(order,customer,partner,plan,remote);
  if (matches(remote,body)) return {ok:true,already:true,reference};
  const blocked = editable(remote); if (blocked) throw Error(blocked);
  await provider.editOrder(plan.shipday_order_id,body);
  const updated = await get();
  if (!matches(updated,body)) throw Error('Shipday did not confirm all updated delivery details. Review before dispatch.');
  if (String(updated.assignedCarrierId || '') !== String(remote.assignedCarrierId || '') || updated.thirdPartyAssignedAnytime !== remote.thirdPartyAssignedAnytime) throw Error('Shipday assignment changed during the update. Review dispatch.');
  return {ok:true,reference};
}
module.exports={payload,matches,editable,synchronize};
