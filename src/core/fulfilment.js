'use strict';

const db = require('../db');
const orders = require('./orders');
const billing = require('./billing');
const { sendAndLog } = require('./notify');
const { config } = require('../config');
const { site } = require('../web/site');

// ---------------------------------------------------------------------------
// Moving an order through its day.
//
// There are two front doors onto these steps and they must behave identically:
//
//   1. Buttons on the ops screens, which is how the work actually gets done
//   2. The JSON API in src/routes/ops.js, which npm run driver talks to
//
// Both call the functions here. When the buttons were added, the alternative
// was to reimplement "collected" in the HTML router, and the two copies would
// have drifted the first time one of them learned something the other did not.
// Same reasoning as src/core/booking.js holding the booking rules for both the
// AI and the web form.
//
// Every function returns the same shape:
//   { ok: true,  order, message }        message is what the customer was told
//   { ok: false, reason, detail }        reason is 'illegal' or 'invalid'
//
// Nothing here decides who is allowed to do it. That is the caller's job, via
// the role check on the route.
// ---------------------------------------------------------------------------

const PHOTO_BUCKET = 'delivery-photos';

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// A state machine refusal is a normal thing that happens when a driver taps
// twice, not a crash. It becomes a 409 or a red line on the screen.
function refusal(err) {
  if (/cannot go from/i.test(err.message)) {
    return { ok: false, reason: 'illegal', detail: err.message };
  }
  throw err;
}

// Moves the order and texts the customer, in that order. If the transition is
// refused, nothing is sent — which is the whole reason the text comes second.
async function step(order, to, buildMessage) {
  let updated;
  try {
    updated = await orders.transition(order, to);
  } catch (err) {
    return refusal(err);
  }

  const customer = order.customers;
  const message = buildMessage ? buildMessage(updated, customer) : null;

  if (message && customer) await sendAndLog(customer.phone, message, customer.id);

  return { ok: true, order: updated, message };
}

// --- Collected --------------------------------------------------------------
//
// The moment the laundry becomes our responsibility, and the moment the
// customer loses the ability to cancel. Both follow from this one call.

async function collect(order, { bagCount } = {}) {
  // The one new fact: we have the bag. The turnaround was promised in the
  // confirmation; repeating it in every text is what Neil flagged.
  const result = await step(
    order,
    'IN_PROCESS',
    () => `We've got your laundry! We'll text you the weight and the total once it's on the scale.`
  );

  if (!result.ok) return result;

  const bags = Number(bagCount) || order.bag_count || null;
  if (bags && bags !== order.bag_count) {
    await db.from('orders').update({ bag_count: bags }).eq('id', order.id);
    result.order.bag_count = bags;
  }

  return result;
}

// --- Dropped at the partner, and picked back up -----------------------------
//
// Deliberately silent. Every other step texts the customer, and these two do
// not, for two reasons: "your laundry is at our partner laundromat" tells them
// something about how we run the business rather than about their order, and
// two extra texts per order is real money and a worse 10DLC complaint profile
// for information nobody asked for.
//
// They still get "we've got it", the weight and price, "out for delivery" and
// "delivered". Nothing they care about is missing.

async function dropAtPartner(order) {
  return step(order, 'AT_PARTNER', null);
}

async function markReady(order) {
  return step(order, 'READY', null);
}

// --- Weight, which is where the money happens -------------------------------
//
// Not a status change. Weighing is an event that can happen at any point while
// we have the bag, the same way unlocking a locker is an event rather than a
// state. What it does change is the price, from an estimate to a real number.

async function recordWeight(order, weightLb) {
  const weight = Number(weightLb);

  if (!Number.isFinite(weight) || weight <= 0 || weight > 200) {
    return {
      ok: false,
      reason: 'invalid',
      detail: 'Expected a weight in pounds between 0 and 200.',
    };
  }

  if (!orders.IN_FLIGHT.includes(order.status)) {
    return { ok: false, reason: 'illegal', detail: `That order is ${order.status}.` };
  }

  // The rate stored on the order, never today's rate. Changing the price must
  // not re-price work that was already quoted.
  const rate = order.price_per_lb_cents || config.pricing.perPoundCents;
  const priceCents = Math.round(weight * rate);

  // Weight and price are written together; the database refuses one without
  // the other, so an order can never carry a charge no weight justifies.
  const { data: updated, error } = await db
    .from('orders')
    .update({ weight_lb: weight, price_cents: priceCents })
    .eq('id', order.id)
    .select('*')
    .single();

  if (error) throw error;

  const customer = order.customers;

  // NOTHING IS CHARGED HERE.
  //
  // Weighing sets the price; delivery collects it. The card is touched twice
  // in an order's life and no more: the minimum when they book, and the
  // balance when the laundry is back on their doorstep. Charging at the scale
  // would take money for work that has not been finished, and would have to be
  // refunded if anything went wrong between the machine and the door.
  //
  // What this does owe the customer is the number. They were promised a
  // weight and a total, and this is the moment both exist.
  const alreadyPaid = updated.deposit_refunded_at ? 0 : updated.deposit_cents || 0;
  const owed = Math.max(0, priceCents - alreadyPaid);
  const card = billing.describeCard(customer);

  // The one new fact: the weight, and what follows from it. No turnaround
  // repeat - that was promised at booking.
  let message;
  if (owed === 0 && alreadyPaid > 0) {
    message =
      `Your laundry weighed ${weight} lb, under the ${money(alreadyPaid)} minimum you've ` +
      `already paid, so there's nothing more to pay.`;
  } else if (alreadyPaid > 0) {
    message =
      `Your laundry weighed ${weight} lb, so the total is ${money(priceCents)} at ` +
      `${site.pricePerLb} a pound. You've paid ${money(alreadyPaid)}, and the remaining ` +
      `${money(owed)} comes off ${card ? `your ${card}` : 'your card'} on delivery.`;
  } else {
    message =
      `Your laundry weighed ${weight} lb, so the total is ${money(priceCents)} at ` +
      `${site.pricePerLb} a pound, charged on delivery.`;
  }

  await sendAndLog(customer.phone, message, customer.id);

  return {
    ok: true,
    order: updated,
    message,
    weightLb: weight,
    priceCents,
    owedCents: owed,
    overMaxOrder: weight > config.pricing.maxOrderLb,
  };
}

// --- Out for delivery -------------------------------------------------------

async function outForDelivery(order) {
  // The one new fact: it is on the van. They already know the price from the
  // weigh text; repeating it here is what made the thread read like a bill.
  return step(order, 'OUT_FOR_DELIVERY', () => `Washed, folded and out for delivery today!`);
}

// --- Delivered, with the photo ----------------------------------------------
//
// The photo is the proof. It goes into a private bucket and the customer gets
// a link on our own domain that signs on demand, because a picture of
// somebody's front door should not be publicly readable forever, and a signed
// storage URL would eventually expire and break the photo.

async function deliver(order, file) {
  let photoPath = null;
  let photoUrl = null;

  if (file && file.buffer) {
    const extension = (String(file.mimetype || '').split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    photoPath = `${order.id}/${Date.now()}.${extension}`;

    const { error: uploadError } = await db.storage
      .from(PHOTO_BUCKET)
      .upload(photoPath, file.buffer, { contentType: file.mimetype, upsert: false });

    if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`);

    photoUrl = `${config.baseUrl}/p/${order.id}`;
  }

  // THE BALANCE IS COLLECTED HERE, not at the scale.
  //
  // The laundry is on the doorstep, the work is finished, and the amount has
  // been known since it was weighed. This is the only moment where charging
  // and delivering are the same event.
  //
  // Done BEFORE the transition so the message can say what actually happened
  // to the money. A decline does not stop the delivery: the clothes are
  // already there, and holding somebody's laundry over a card is a bad look
  // and legally murky. We deliver and chase.
  const charge = order.price_cents
    ? await billing.chargeOrder(order, order.customers)
    : { ok: false, message: null };

  const result = await step(order, 'DELIVERED', () => {
    const photo = photoUrl ? ` Photo: ${photoUrl}` : '';

    // What we say about money depends on whether we actually got it. A
    // delivery text that reads like a receipt when the card was declined is
    // how an unpaid order quietly becomes a forgotten one. The total is NOT
    // repeated here — the weigh text already said it, and a real thread ended
    // up quoting it four times.
    let price = '';
    if (!order.price_cents) {
      price = '';
    } else if (charge.coveredByMinimum) {
      price = ` All covered by the minimum you already paid, nothing more charged.`;
    } else if (charge.ok && charge.chargedCents) {
      price = ` The remaining ${money(charge.chargedCents)} went on your card and you're all settled.`;
    } else if (charge.ok) {
      price = ` You're all paid up.`;
    } else if (charge.needsCard || charge.declined) {
      price = ` ${money(order.price_cents)} is still outstanding, the card link we sent will settle it.`;
    }

    return `Delivered! Your laundry is at your door.${price}${photo}`;
  });

  if (!result.ok) return result;

  result.paid = Boolean(charge.ok);
  result.paymentNote = charge.ok ? null : charge.needsCard ? 'no card on file' : 'card declined';

  if (photoUrl) {
    await db
      .from('orders')
      .update({ delivery_photo_url: photoUrl, delivery_photo_path: photoPath })
      .eq('id', order.id);
    result.order.delivery_photo_url = photoUrl;
  }

  result.photo = Boolean(photoUrl);
  return result;
}

// ---------------------------------------------------------------------------
// What can be done to this order right now
//
// One list, used to draw the buttons and to label them. Keeping it beside the
// functions means a new step cannot be added without the screens learning
// about it.
// ---------------------------------------------------------------------------

const STEPS = Object.freeze([
  { to: 'IN_PROCESS', action: 'collected', label: 'Collected', hint: 'Bag is in the van' },
  { to: 'AT_PARTNER', action: 'at-partner', label: 'Dropped at partner', hint: 'Left at the laundromat' },
  { to: 'READY', action: 'ready', label: 'Ready for collection', hint: 'Partner has finished it' },
  { to: 'OUT_FOR_DELIVERY', action: 'out-for-delivery', label: 'Out for delivery', hint: 'On the van, going back' },
  { to: 'DELIVERED', action: 'delivered', label: 'Delivered', hint: 'Needs a photo' },
]);

// The steps legal from where this order is now, in the order they appear above.
function nextSteps(order) {
  const allowed = orders.ALLOWED_NEXT[order.status] || [];
  return STEPS.filter((s) => allowed.includes(s.to));
}

module.exports = {
  collect,
  dropAtPartner,
  markReady,
  recordWeight,
  outForDelivery,
  deliver,
  nextSteps,
  STEPS,
  PHOTO_BUCKET,
};
