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
    await record(order, { leg: 'TO_CUSTOMER', by, refusedReason: `threw: ${err.message}` }).catch(() => {});
    return { ok: false, reason: 'courier_unreachable', detail: err.message };
  }

  if (!booked || !booked.id) {
    await record(order, { leg: 'TO_CUSTOMER', by, refusedReason: 'no delivery id' }).catch(() => {});
    return { ok: false, reason: 'courier_refused' };
  }

  const row = await record(order, { leg: 'TO_CUSTOMER', by, booked });

  await orderEvents.record(order.id, {
    kind: 'COURIER',
    summary: `Courier booked to take order ${order.order_number} back to the customer`,
    became: booked.id,
    by: { actor: by ? `${by.name} at ${partner.name}` : 'system' },
  });

  return { ok: true, delivery: row || booked, booked };
}

// --- the trip INTO the laundromat -------------------------------------------

// SEND A COURIER TO COLLECT FROM THE CUSTOMER AND TAKE IT TO THE LAUNDROMAT.
//
// The other half of the round trip, and the one that carries the PIN.
//
// A PIN HERE AND NOT ON THE RETURN, AND THAT ASYMMETRY IS THE WHOLE POINT.
// Uber generates a four-digit code, returns it to us, AND TEXTS IT TO THE
// RECIPIENT - so the laundromat holds it and the courier has to ask for it
// before the app will let them complete the drop. A courier who turns up at the
// wrong shop cannot offload there, because only the right shop's screen shows
// the right number.
//
// The return leg is left at the customer's door, where there is nobody to read a
// code out, and Uber refuses the combination outright.
//
// IT DOES NOT MOVE THE ORDER'S STATUS. Booking is not collecting - the same rule
// the return leg follows. What moves an order to AT_PARTNER is the bags actually
// being at a counter, which `arrived()` below records.
async function sendForPickup(order, { by = null, customer = null, partner = null, courier = couriers } = {}) {
  const existing = await findLeg(order.id, 'TO_PARTNER');
  if (existing && existing.delivery_id) {
    return { ok: true, already: true, delivery: existing };
  }

  if (!partner) return { ok: false, reason: 'no_partner' };
  if (!customer) return { ok: false, reason: 'no_customer' };
  if (!partner.phone) return { ok: false, reason: 'no_partner_phone' };
  if (!customer.phone) return { ok: false, reason: 'no_customer_phone' };

  // THE CARD MUST HAVE TAKEN THE HOLD FIRST. Neil's rule: a pickup is confirmed
  // by the card accepting the hold, not by a card existing. Sending a courier to
  // a door we cannot bill for is the exact trip the hold pays for.
  if (order.authorization_refused_at) {
    return { ok: false, reason: 'card_refused' };
  }

  const from = addressOf(customer, {
    name: customer.name || 'LYNDRY customer',
    phone: customer.phone,
    // WHERE THE BAG IS. The one free-text field a courier genuinely needs, and
    // the same two columns the reminder and the run read, newest first.
    notes: order.dropoff_spot || order.special_instructions || null,
  });

  const to = addressOf(partner, {
    name: partner.name,
    phone: partner.phone,
    businessName: partner.name,
    notes: `LYNDRY order ${order.order_number}. The counter has a code for you.`,
  });

  let booked = null;
  try {
    booked = await courier.book({
      from,
      to,
      externalId: `LYNDRY-${order.order_number}-IN`,

      pickupReadyAt: minutes(PICKUP_READY_MINUTES),
      pickupDeadlineAt: minutes(PICKUP_DEADLINE_MINUTES),
      dropoffReadyAt: minutes(PICKUP_READY_MINUTES),
      dropoffDeadlineAt: minutes(DROPOFF_DEADLINE_MINUTES),

      manifest: [{ name: 'Laundry', quantity: Number(order.bag_count || 1) }],

      // THE HANDOVER CODE. Uber makes it, texts it to the laundromat, and will
      // not let the courier complete without it.
      requirePin: true,

      // AND THEREFORE NOT LEFT AT A DOOR. Uber refuses the combination, and it
      // is right to: a laundromat has a counter and somebody behind it.
      leaveAtDoor: false,
    });
  } catch (err) {
    console.error(`Could not book a collection for order ${order.order_number}: ${err.message}`);
    await record(order, { leg: 'TO_PARTNER', by, refusedReason: `threw: ${err.message}` }).catch(() => {});
    return { ok: false, reason: 'courier_unreachable', detail: err.message };
  }

  if (!booked || !booked.id) {
    await record(order, { leg: 'TO_PARTNER', by, refusedReason: 'no delivery id' }).catch(() => {});
    return { ok: false, reason: 'courier_refused' };
  }

  const row = await record(order, { leg: 'TO_PARTNER', by, booked });

  // WHICH LAUNDROMAT THE BAGS ARE ACTUALLY GOING TO, written now rather than on
  // arrival. `orders.partner_id` is the record of which shop had it, and the
  // courier is on its way there - so an order whose plan changes afterwards
  // would otherwise send a driver, or a person, to the wrong counter.
  await db
    .from('orders')
    .update({ partner_id: partner.id })
    .eq('id', order.id)
    .then(({ error }) => {
      if (error) console.error(`Could not record the laundromat on ${order.id}: ${error.message}`);
    });

  await orderEvents.record(order.id, {
    kind: 'COURIER',
    summary: `Courier booked to collect order ${order.order_number} and take it to ${partner.name}`,
    became: booked.id,
    by: { actor: by && by.name ? by.name : 'system' },
  });

  return { ok: true, delivery: row || booked, booked, pin: booked.pin };
}

// THE BAGS ARE ON THE COUNTER.
//
// What actually moves an order to AT_PARTNER under a courier. There is no van to
// confirm and no driver to tap, so the signal is the laundromat saying the bags
// are here - which is the only person who knows.
//
// TWO HOPS, BECAUSE THE STATE MACHINE HAS NO SHORTCUT. REQUESTED -> AT_PARTNER
// is not a legal move and is not being added: IN_PROCESS means the laundry is
// ours and in transit, which under a courier is exactly true from the moment it
// leaves the doorstep. Both hops go through `orders.transition()`, which is the
// only thing allowed to move a status.
//
// IT DOES NOT GO THROUGH `fulfilment.dropAtPartner()`, DELIBERATELY. That one
// calls `readyForPartner()`, which refuses without `van_confirmed_at` - a column
// only `loadVan()` writes. Under a courier there is no van to confirm, so that
// guard can never be satisfied and its refusal ("Load the van first") is
// nonsense to an attendant. The guards that DO apply are asked here instead.
async function arrived(order, { by = null, partner = null } = {}) {
  const leg = await findLeg(order.id, 'TO_PARTNER');

  // NO COURIER WAS EVER SENT FOR THIS. Somebody is confirming bags that nothing
  // dispatched - which is worth refusing rather than quietly accepting, because
  // the likeliest cause is the wrong order number on a busy counter.
  if (!leg) return { ok: false, reason: 'nothing_coming' };

  if (order.status === 'AT_PARTNER') return { ok: true, already: true };

  const orders = require('./orders');

  // ALREADY PAST THE LAUNDROMAT. Confirming arrival on an order that has been
  // washed and sent back is the same mistake one step later.
  if (!['REQUESTED', 'IN_PROCESS'].includes(order.status)) {
    return { ok: false, reason: 'too_late', detail: order.status };
  }

  // `transition()` TAKES TWO ARGUMENTS, RETURNS THE ORDER ROW, AND THROWS.
  //
  // The first version passed a third argument, checked `step.ok` on the row that
  // came back, and treated the missing property as a refusal - so the REQUESTED
  // to IN_PROCESS hop SUCCEEDED and the function then reported failure and
  // stopped, leaving a real order stranded half way with the attendant told to
  // ring us. Caught by pressing the button.
  //
  // IT IS SAFE TO PRESS AGAIN, which is what makes that recoverable: the status
  // is read fresh every time, so a second press does whichever hops are left.
  let moving = order;

  try {
    if (moving.status === 'REQUESTED') {
      moving = (await orders.transition(moving, 'IN_PROCESS')) || { ...moving, status: 'IN_PROCESS' };
    }

    await orders.transition(moving, 'AT_PARTNER');
  } catch (err) {
    console.error(`Could not move order ${order.order_number} to the laundromat: ${err.message}`);
    return { ok: false, reason: 'refused', detail: err.message };
  }

  if (partner && !order.partner_id) {
    await db
      .from('orders')
      .update({ partner_id: partner.id })
      .eq('id', order.id)
      .then(({ error }) => {
        if (error) console.error(`Could not record the laundromat on ${order.id}: ${error.message}`);
      });
  }

  await orderEvents.record(order.id, {
    kind: 'COURIER',
    summary: `Bags arrived at ${partner ? partner.name : 'the laundromat'}`,
    was: order.status,
    became: 'AT_PARTNER',
    by: { actor: by && by.name ? by.name : 'the laundromat' },
  });

  return { ok: true, delivery: leg };
}

// Everything a laundromat should be expecting: booked, not yet on the counter.
//
// SCOPED TO ONE SHOP IN THE QUERY. A laundromat must never see an order heading
// somewhere else, and filtering afterwards is not access control.
async function expectedAt(partnerId) {
  if (!partnerId) return [];

  const { data, error } = await db
    .from('courier_deliveries')
    .select('delivery_id, pin, status, requested_at, orders!inner(id, order_number, status, bag_count, partner_id)')
    .eq('leg', 'TO_PARTNER')
    .not('delivery_id', 'is', null)
    .eq('orders.partner_id', partnerId)
    .in('orders.status', ['REQUESTED', 'IN_PROCESS'])
    .order('requested_at', { ascending: true });

  if (error) {
    console.error(`Could not read what ${partnerId} is expecting: ${error.message}`);
    return [];
  }

  return (data || []).map((row) => ({
    orderId: row.orders.id,
    orderNumber: row.orders.order_number,
    bagCount: row.orders.bag_count,
    // THE CODE THE COURIER WILL ASK FOR. Shown so an attendant can read it out;
    // Uber texts it to the shop as well, and this is what saves her when that
    // text has not arrived or the phone is in somebody's pocket.
    pin: row.pin,
    status: row.status,
    requestedAt: row.requested_at,
  }));
}

// --- the ledger -------------------------------------------------------------

async function record(order, { leg = 'TO_CUSTOMER', by = null, booked = null, refusedReason = null }) {
  const { data, error } = await db
    .from('courier_deliveries')
    .insert({
      order_id: order.id,
      leg,
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

// ---------------------------------------------------------------------------
// WHAT THE COURIERS ARE DOING, FOR A PERSON TO LOOK AT.
//
// Neil, 25 September: "ad pages that help me see/mange the uber situation".
//
// EVERY LEG EVER BOOKED OR REFUSED, newest first. Refusals are in it on purpose:
// `record()` writes a row with a null `delivery_id` and a reason when a booking is
// turned down, and "we asked and they said no" is the half of this you cannot see
// anywhere else - an order simply sits there looking unbooked.
//
// The order is joined rather than looked up per row: thirty legs must not be
// thirty round trips, the same rule the board and the partner load already follow.
async function recent({ limit = 100 } = {}) {
  const { data, error } = await db
    .from('courier_deliveries')
    .select(
      'id, order_id, leg, delivery_id, status, fee_cents, pin, tracking_url, ' +
        'pickup_photo_url, dropoff_photo_url, refused_reason, requested_at, updated_at, ' +
        'orders(order_number, status, partner_id, customer_id)'
    )
    .order('requested_at', { ascending: false })
    .limit(Math.min(Math.max(1, Number(limit) || 100), 500));

  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    orderId: row.order_id,
    orderNumber: row.orders ? row.orders.order_number : null,
    orderStatus: row.orders ? row.orders.status : null,
    leg: row.leg,
    deliveryId: row.delivery_id,
    status: row.status,
    feeCents: row.fee_cents,
    pin: row.pin,
    trackingUrl: row.tracking_url,
    // AN EMPTY STRING IS NOT A PHOTO. The adapter already turns one into null, and
    // a row written before it did can still carry the empty string, which renders
    // as a broken image.
    pickupPhotoUrl: row.pickup_photo_url || null,
    dropoffPhotoUrl: row.dropoff_photo_url || null,
    refusedReason: row.refused_reason,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
  }));
}

// WHAT THE COURIERS HAVE COST US, from the rows rather than from a column.
//
// `orders.courier_cost_cents` was added for this and is a second copy of it:
// `fee_cents` on each leg IS what Uber charged, so the cost of an order is the sum
// of its legs and the cost of a day is the sum of a day's. Same rule as the
// laundromat load - a running total in a column is a second version of a fact that
// disagrees the first time anything goes wrong.
async function spendSince(iso) {
  const { data, error } = await db
    .from('courier_deliveries')
    .select('fee_cents')
    .not('fee_cents', 'is', null)
    .gte('requested_at', iso);

  if (error) throw error;

  return (data || []).reduce((sum, row) => sum + (Number(row.fee_cents) || 0), 0);
}

// ASK THE COURIER WHERE THIS ONE ACTUALLY IS.
//
// THE ONLY HONEST WAY TO KNOW TODAY, because there is no webhook yet: `status` is
// whatever Uber said at the moment the leg was booked, which is `pending` for ever
// however far the courier has driven. A button that re-asks is what makes the
// screen true rather than a record of one API call.
//
// IT WRITES WHAT IT LEARNS AND MOVES NO ORDER. Recording where a courier is and
// deciding what that means to an order are two different things, and the second
// one texts customers - see the note at the top of this file about
// OUT_FOR_DELIVERY. When the webhook lands it will do the deciding; this only ever
// updates the row.
async function refresh(id, { courier = couriers } = {}) {
  const leg = await byId(id);
  if (!leg) return { ok: false, reason: 'no_leg' };
  if (!leg.delivery_id) return { ok: false, reason: 'never_booked' };

  let live = null;
  try {
    live = await courier.status(leg.delivery_id);
  } catch (err) {
    // A COURIER WE CANNOT REACH IS NOT A COURIER THAT SAID ANYTHING. Leaving the
    // row alone is right: the stale status is at least a fact about something Uber
    // once told us, and overwriting it with a guess would be worse.
    return { ok: false, reason: 'unreachable', detail: err.message };
  }

  if (!live || !live.id) return { ok: false, reason: 'unknown_delivery' };

  const patch = {
    status: live.status || leg.status,
    fee_cents: live.feeCents != null ? live.feeCents : leg.fee_cents,
    pickup_photo_url: live.pickupPhotoUrl || null,
    dropoff_photo_url: live.dropoffPhotoUrl || null,
    tracking_url: live.trackingUrl || leg.tracking_url,
    updated_at: new Date().toISOString(),
  };

  const { error } = await db.from('courier_deliveries').update(patch).eq('id', leg.id);
  if (error) throw error;

  return {
    ok: true,
    was: leg.status,
    now: patch.status,
    changed: patch.status !== leg.status,
    live,
  };
}

// CALL A COURIER OFF.
//
// Behind `orders.override` on the screen, because it spends and unspends money at
// a vendor and because a courier already at a door is not somebody to cancel by
// accident.
//
// IT CANCELS AT UBER FIRST AND WRITES SECOND. A row marked cancelled while a car
// is still coming is the worse failure: the screen would say nobody is on the way
// and somebody would book a second one.
async function cancelLeg(id, { by = null, courier = couriers } = {}) {
  const leg = await byId(id);
  if (!leg) return { ok: false, reason: 'no_leg' };
  if (!leg.delivery_id) return { ok: false, reason: 'never_booked' };

  let said = null;
  try {
    said = await courier.cancel(leg.delivery_id);
  } catch (err) {
    return { ok: false, reason: 'unreachable', detail: err.message };
  }

  if (!said || said.ok === false) {
    return { ok: false, reason: said ? said.reason || 'refused' : 'refused', detail: said && said.detail };
  }

  const { error } = await db
    .from('courier_deliveries')
    .update({ status: said.status || 'canceled', updated_at: new Date().toISOString() })
    .eq('id', leg.id);

  if (error) throw error;

  await orderEvents.record(leg.order_id, {
    kind: 'COURIER',
    summary: `Courier ${leg.leg === 'TO_PARTNER' ? 'collection' : 'return'} cancelled`,
    was: leg.status,
    became: said.status || 'canceled',
    by: { actor: by && by.name ? by.name : 'ops' },
  });

  return { ok: true, status: said.status || 'canceled' };
}

// One leg by its own id, raw. Used by the two controls above.
async function byId(id) {
  const { data, error } = await db
    .from('courier_deliveries')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

module.exports = {
  PICKUP_READY_MINUTES,
  sendForPickup,
  sendForReturn,
  arrived,
  expectedAt,
  findLeg,
  bookedFor,
  addressOf,

  // The ops screen.
  recent,
  spendSince,
  refresh,
  cancelLeg,
  byId,
};
