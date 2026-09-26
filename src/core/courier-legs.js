'use strict';

const db = require('../db');
const couriers = require('../providers/couriers');
const orderEvents = require('./order-events');

// ---------------------------------------------------------------------------
// SENDING A COURIER FOR A FINISHED ORDER.
//
// Neil, 25 September: "in the order screen, there should be a button of the
// attendant to tell the uber driver to come get the bags."
//
// A NEW MODULE RATHER THAN A FUNCTION IN `fulfilment.js`, and the reason is that
// every step in that file is a VAN step. `outForDelivery()` refuses without
// `return_bag_count`, which a driver ticks off on his route; `loadVan()` counts
// bags against `loaded_at`; `declinedAtTheDoor()` texts somebody that we have
// left their bags where we found them. None of that is expressible when a
// stranger's car is the van, and weakening those guards would weaken them for
// the van orders still on the board.
//
// THE ORDER'S STATUS DOES NOT MOVE, AND THAT IS THE CAREFUL PART.
//
// `OUT_FOR_DELIVERY` texts the customer "Washed, folded and out for delivery
// today!". A courier having been REQUESTED is not the laundry being on its way -
// nobody has collected anything yet, and a courier can decline, time out or
// cancel. Sending that text when a button is pressed would promise a doorstep
// delivery on the strength of an API call.
//
// So this books the trip and records it. What moves the order is the courier
// actually taking the bags, which arrives as a webhook - and until that webhook
// exists, an order sits at READY with a courier on the way, which is true.
//
// WHAT THE ATTENDANT NEVER LEARNS IS WHERE THE BAGS ARE GOING. The customer's
// address is read here, handed to the courier, and never returned to the caller.
// The portal has no route that renders it and no query that selects it.
// ---------------------------------------------------------------------------

// Uber wants the pickup at least twenty minutes out, and a deadline at least ten
// minutes after the ready time. These are comfortable rather than tight: a
// counter is not a kitchen, and a courier arriving before somebody has the bags
// by the door is worse than one arriving ten minutes later.
const PICKUP_READY_MINUTES = 15;
const PICKUP_DEADLINE_MINUTES = 90;
const DROPOFF_DEADLINE_MINUTES = 240;

const minutes = (n) => new Date(Date.now() + n * 60 * 1000).toISOString();

// Everything the courier needs about one end of the trip.
function addressOf(row, { name, phone, businessName = null, notes = null }) {
  return {
    line1: row.address_line1,
    line2: row.address_line2 || null,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    name,
    phone,
    businessName,
    notes,
  };
}

// --- the one that the button calls ------------------------------------------

// `order` must already carry the partner and the customer. `by` is the
// `partner_users` row when an attendant pressed it, or null.
//
// Returns { ok: true, delivery } or { ok: false, reason, detail }.
async function sendForReturn(order, { by = null, customer = null, partner = null, courier = couriers } = {}) {
  // ALREADY GONE. Pressing twice must not book two couriers to one counter -
  // which is the obvious thing to happen on a tablet with a slow connection.
  const existing = await findLeg(order.id, 'TO_CUSTOMER');
  if (existing && existing.delivery_id) {
    return { ok: true, already: true, delivery: existing };
  }

  if (!partner) return { ok: false, reason: 'no_partner' };
  if (!customer) return { ok: false, reason: 'no_customer' };

  // THE WEIGHT IS WHAT BILLS, so it has to exist before the bags move. Under the
  // courier model the laundromat's scale is the only one there is.
  if (order.partner_weight_lb == null) {
    return { ok: false, reason: 'not_weighed' };
  }

  // A LAUNDROMAT WITH NO PHONE CANNOT BE COLLECTED FROM. `partners.phone` is
  // nullable and a hand-added shop may have none; Uber needs somebody to ring
  // when the courier cannot find the door.
  if (!partner.phone) return { ok: false, reason: 'no_partner_phone' };
  if (!customer.phone) return { ok: false, reason: 'no_customer_phone' };

  const from = addressOf(partner, {
    name: partner.name,
    phone: partner.phone,
    businessName: partner.name,
    notes: `Collect the LYNDRY bags for order ${order.order_number}.`,
  });

  const to = addressOf(customer, {
    // THE COURIER IS TOLD THE CUSTOMER'S NAME AND THE ATTENDANT IS NOT. They are
    // different people with different jobs: one is driving to a door, the other
    // is washing a bag.
    name: customer.name || 'LYNDRY customer',
    phone: customer.phone,
    notes: order.dropoff_spot || order.special_instructions || null,
  });

  let booked = null;
  try {
    booked = await courier.book({
      from,
      to,
      // OUR ORDER NUMBER, WHICH IS ALL THE COURIER EVER LEARNS ABOUT US.
      externalId: `LYNDRY-${order.order_number}`,

      pickupReadyAt: minutes(PICKUP_READY_MINUTES),
      pickupDeadlineAt: minutes(PICKUP_DEADLINE_MINUTES),
      dropoffReadyAt: minutes(PICKUP_READY_MINUTES),
      dropoffDeadlineAt: minutes(DROPOFF_DEADLINE_MINUTES),

      manifest: [{ name: 'Clean laundry', quantity: Number(order.return_bag_count || order.bag_count || 1) }],

      // LEFT AT THE DOOR, WHICH IS WHAT THE WHOLE SERVICE PROMISES. The customer
      // is not asked to be in, and the photo Uber takes automatically for a
      // leave-at-door delivery is the proof.
      //
      // WHICH IS ALSO WHY THERE IS NO PIN ON THIS LEG. Uber refuses the
      // combination outright, and it is right to: a PIN needs somebody there to
      // read it out. The PIN belongs on the trip INTO the laundromat, where an
      // attendant is standing at a counter.
      leaveAtDoor: true,
      requirePin: false,
    });
  } catch (err) {
    // A THROW IS NOT A REFUSAL, which is the lesson #2068 taught one vendor
    // along. A courier that could not be reached has not said no, so nothing is
    // recorded as refused and the attendant is told to try again.
    console.error(`Could not book a courier for order ${order.order_number}: ${err.message}`);
    await record(order, { by, refusedReason: `threw: ${err.message}` }).catch(() => {});
    return { ok: false, reason: 'courier_unreachable', detail: err.message };
  }

  if (!booked || !booked.id) {
    await record(order, { by, refusedReason: 'no delivery id' }).catch(() => {});
    return { ok: false, reason: 'courier_refused' };
  }

  const row = await record(order, { by, booked });

  await orderEvents.record(order.id, {
    kind: 'COURIER',
    summary: `Courier booked to take order ${order.order_number} back to the customer`,
    became: booked.id,
    by: { actor: by ? `${by.name} at ${partner.name}` : 'system' },
  });

  return { ok: true, delivery: row || booked, booked };
}

// --- the ledger -------------------------------------------------------------

async function record(order, { by = null, booked = null, refusedReason = null }) {
  const { data, error } = await db
    .from('courier_deliveries')
    .insert({
      order_id: order.id,
      leg: 'TO_CUSTOMER',
      delivery_id: booked ? booked.id : null,
      status: booked ? booked.status : null,
      fee_cents: booked && booked.feeCents != null ? booked.feeCents : null,
      pin: booked ? booked.pin : null,
      tracking_url: booked ? booked.trackingUrl : null,
      requested_by: by ? by.id : null,
      refused_reason: refusedReason,
    })
    .select('*')
    .maybeSingle();

  if (error) {
    // THE COURIER IS ALREADY COMING. Losing the row is a reporting problem and
    // must not be reported to the attendant as a failure, or she will press the
    // button again and a second car will arrive.
    console.error(`Could not record a courier leg for order ${order.id}: ${error.message}`);
    return null;
  }

  return data;
}

// The courier leg of one kind for one order, or null.
async function findLeg(orderId, leg) {
  const { data, error } = await db
    .from('courier_deliveries')
    .select('*')
    .eq('order_id', orderId)
    .eq('leg', leg)
    .not('delivery_id', 'is', null)
    .order('requested_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error(`Could not read the courier legs for ${orderId}: ${error.message}`);
    return null;
  }

  return (data || [])[0] || null;
}

// Which orders already have a courier coming, in one query rather than one per
// row - the same shape as `promotions.expectedForMany()`.
async function bookedFor(orderIds) {
  const ids = (orderIds || []).filter(Boolean);
  if (!ids.length) return new Set();

  const { data, error } = await db
    .from('courier_deliveries')
    .select('order_id')
    .eq('leg', 'TO_CUSTOMER')
    .not('delivery_id', 'is', null)
    .in('order_id', ids);

  if (error) {
    console.error(`Could not read courier legs: ${error.message}`);
    return new Set();
  }

  return new Set((data || []).map((r) => r.order_id));
}

module.exports = {
  PICKUP_READY_MINUTES,
  sendForReturn,
  findLeg,
  bookedFor,
  addressOf,
};
