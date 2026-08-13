'use strict';

const db = require('../db');
const orders = require('./orders');
const billing = require('./billing');
const bags = require('./bags');
const loadout = require('./loadout');
const recurring = require('./recurring');
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

// Kept apart from the delivery photos on purpose. A delivery photo is shown to
// the customer on a link that expires; a scale photo is internal evidence
// nobody outside the business ever sees. Two lives, two buckets.
const WEIGHT_PHOTO_BUCKET = 'weight-photos';

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

  // Named `count`, not `bags` — that is the label module now, and a shadowed
  // import is the kind of thing that works until somebody adds a line.
  const count = Number(bagCount) || order.bag_count || null;
  if (count && count !== order.bag_count) {
    await db.from('orders').update({ bag_count: count }).eq('id', order.id);
    result.order.bag_count = count;
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

// WEIGH IT BEFORE IT LEAVES YOUR HANDS.
//
// The weight is the price, and it is the only number we have that does not
// depend on somebody else's scale. Handing a bag to a laundromat unweighed
// means taking their figure for what to charge our own customer, with no way
// to check it and no record if they are wrong.
//
// The same applies to putting it on the van for delivery. An order that
// reaches the doorstep unweighed has never been priced and never been charged,
// and once the bag is back with the customer there is nothing left to weigh.
function needsWeightFirst(order) {
  if (order.weight_lb != null) return null;

  return {
    ok: false,
    reason: 'invalid',
    detail: 'Weigh it first. The weight sets the price, and it has to be ours, not the partner\'s.',
  };
}

async function dropAtPartner(order, { partnerId } = {}) {
  const unweighed = needsWeightFirst(order);
  if (unweighed) return unweighed;

  const result = await step(order, 'AT_PARTNER', null);
  if (!result.ok) return result;

  // WHICH laundromat, recorded at the moment the bag changes hands.
  //
  // Without it there is no way to answer "is one partner's scale consistently
  // heavier than ours", which is the whole reason for asking them to weigh it.
  // Optional, because a bag can be dropped somewhere we have not added yet and
  // refusing the drop over a missing dropdown would stop the round.
  if (partnerId) {
    await db.from('orders').update({ partner_id: partnerId }).eq('id', order.id);
    result.order.partner_id = partnerId;
  }

  return result;
}

async function markReady(order) {
  return step(order, 'READY', null);
}

// --- Weight, which is where the money happens -------------------------------
//
// Not a status change. Weighing is an event that can happen at any point while
// we have the bag, the same way unlocking a locker is an event rather than a
// state. What it does change is the price, from an estimate to a real number.

async function recordWeight(order, weightLb, photo) {
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

  // NO PHOTO OF THE SCALE, NO WEIGHT.
  //
  // Same rule as the delivery photo and for the same reason: this number
  // charges a card, and ten seconds of a driver's time is what makes it
  // answerable afterwards. It settles the argument in both directions - the
  // customer certain their bag was not 40 lb, and the laundromat whose invoice
  // says 44.
  //
  // Only on the FIRST weighing. A correction is a driver fixing a typo they
  // just made, usually with the bag already gone, and refusing that would
  // leave the wrong number on the order permanently - which is worse than a
  // correction with no new photo. The original photo stays.
  const firstWeighing = order.weight_lb == null;
  const havePhoto = Boolean(photo && photo.buffer && photo.buffer.length);

  if (firstWeighing && !havePhoto) {
    return {
      ok: false,
      reason: 'invalid',
      detail: 'Photograph the scale display. The weight charges the card, so it needs evidence.',
    };
  }

  // The terms stored on the order, never today's terms. Changing the price or
  // the minimum must not re-price work that was already quoted.
  const rate = order.price_per_lb_cents || config.pricing.perPoundCents;
  const byWeight = Math.round(weight * rate);

  // THE MINIMUM IS PART OF THE PRICE, not just part of the charging.
  //
  // Without this, a 10 lb order at $2.00 recorded $20.00 as its price while
  // the customer was charged the $25.00 minimum, so the order under-reported
  // its own revenue and every total built on it was short by the difference.
  //
  // Null on orders taken before the minimum existed, which were genuinely not
  // subject to one.
  const floor = order.minimum_cents != null ? order.minimum_cents : order.deposit_cents || 0;
  const priceCents = Math.max(byWeight, floor);

  // The photo goes up BEFORE the weight is written. If storage is having a bad
  // day we would rather refuse the whole step than record a charge whose
  // evidence silently failed to save.
  let photoPath = order.weight_photo_path || null;

  if (havePhoto) {
    const extension = (String(photo.mimetype || '').split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const path = `${order.id}/${Date.now()}.${extension}`;

    const { error: uploadError } = await db.storage
      .from(WEIGHT_PHOTO_BUCKET)
      .upload(path, photo.buffer, { contentType: photo.mimetype, upsert: false });

    if (uploadError) {
      return {
        ok: false,
        reason: 'invalid',
        detail: `The scale photo did not save (${uploadError.message}). Nothing has been weighed or charged - try again.`,
      };
    }

    photoPath = path;
  }

  // Weight and price are written together; the database refuses one without
  // the other, so an order can never carry a charge no weight justifies.
  const { data: updated, error } = await db
    .from('orders')
    .update({ weight_lb: weight, price_cents: priceCents, weight_photo_path: photoPath })
    .eq('id', order.id)
    .select('*')
    .single();

  if (error) throw error;

  const customer = order.customers;

  // THIS IS WHERE THE CARD IS CHARGED, and the only place it is.
  //
  // The scale is the first moment an amount exists, and by then two
  // authorisations are already on record: the consent given on the payment
  // page, and the booking confirmation naming the card. There is no third
  // "reply YES to pay" step, on purpose.
  //
  // It used to be split in two - a minimum at booking, the balance at the door
  // - which meant two charges, two idempotency keys, two things to refund and
  // a customer watching money leave before anybody had touched their laundry.
  // One charge, one moment.
  //
  // A decline does not stop anything. The bag still gets washed and delivered
  // and we chase by text; holding somebody's clothes over a card is a bad look
  // and legally murky, and the exposure is one order.
  const alreadyPaid = updated.deposit_refunded_at ? 0 : updated.deposit_cents || 0;
  const owed = Math.max(0, priceCents - alreadyPaid);
  const card = billing.describeCard(customer);

  // The one new fact: the weight, and what follows from it. No turnaround
  // repeat - that was promised at booking.
  //
  // When the minimum is what set the price, say so. "10 lb, so the total is
  // $25.00 at $2.00 a pound" is arithmetic the customer can see is wrong.
  const minimumApplied = priceCents > byWeight;

  // A SECOND WEIGHING IS A CORRECTION, and has to read like one.
  //
  // A customer told "10 lb, $25" and then "15 lb, $30" with no explanation
  // has been quoted two different prices for the same bag and told why
  // neither time. Naming the old figure alongside the new one is the whole
  // difference between a correction and an inconsistency.
  const previous = order.weight_lb != null ? Number(order.weight_lb) : null;
  const isCorrection = previous != null && previous !== weight;

  const opening = isCorrection
    ? `Correction: your laundry weighed ${weight} lb, not ${previous} lb`
    : `Your laundry weighed ${weight} lb`;

  const howPriced = minimumApplied
    ? `${opening}, which is under our ${money(floor)} minimum, so the total is ${money(priceCents)}.`
    : `${opening}, so the total is ${money(priceCents)} at ${site.pricePerLb} a pound.`;

  // Take the money. Skipped entirely when nothing is owed, which today only
  // happens on an order that paid a minimum under the old rules.
  const charge = owed > 0 ? await billing.chargeOrder(updated, customer) : { ok: true, nothingDue: true };

  // What the customer is told about the money depends on what actually
  // happened to it. A weigh text that reads like a receipt when the card was
  // declined is how an unpaid order quietly becomes a forgotten one.
  let settlement;
  if (charge.nothingDue || charge.coveredByMinimum) {
    settlement = `You've already paid that, so there's nothing more to pay.`;
  } else if (charge.ok) {
    settlement = `Charged to your ${card || 'card'}.`;
  } else if (charge.needsCard || charge.declined) {
    // Two different problems that must not share a sentence. "Your card was
    // declined" to somebody who never gave us a card is nonsense, and it sends
    // them looking for a card of theirs to fix.
    const problem = charge.needsCard
      ? `We don't have a card on file, so nothing has been taken.`
      : `Your ${card || 'card'} was declined, so nothing has been taken.`;

    // The link is already inside charge.message, but that message repeats the
    // weight and the total, which this sentence has just said. Take the link
    // and leave the rest.
    settlement = charge.setupUrl
      ? `${problem} We'll still wash and deliver it - add a card here and we'll settle up: ${charge.setupUrl}`
      : `${problem} We'll still wash and deliver it and sort the money out.`;
  } else {
    // Payments switched off. Say nothing about money rather than inventing a
    // status for it.
    settlement = '';
  }

  const message = settlement ? `${howPriced} ${settlement}` : howPriced;

  // Re-saving the same weight is not news. A driver correcting a typo back to
  // what it already was, or tapping Save twice, should not text the customer
  // the same figure again.
  //
  // The charge above is still safe to re-run: chargeOrder returns early on an
  // order already marked PAID, and its idempotency key would catch it anyway.
  const unchanged = previous != null && previous === weight;
  if (!unchanged) await sendAndLog(customer.phone, message, customer.id);

  return {
    ok: true,
    order: updated,
    message,
    weightLb: weight,
    priceCents,
    owedCents: owed,
    // Same two fields the delivery step reports, so a caller does not have to
    // learn a second vocabulary for "did the money move".
    paid: Boolean(charge.ok),
    paymentNote: charge.ok
      ? null
      : charge.needsCard
        ? 'no card on file'
        : charge.declined
          ? 'card declined'
          : 'payments are switched off',
    overMaxOrder: weight > config.pricing.maxOrderLb,
  };
}

// --- Out for delivery -------------------------------------------------------

async function outForDelivery(order) {
  // Same rule as the partner drop: a bag must never get on the van without a
  // weight on record, because the doorstep is the last place it could be
  // weighed and by then it is too late.
  const unweighed = needsWeightFirst(order);
  if (unweighed) return unweighed;

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
  // NO PHOTO, NO DELIVERY.
  //
  // The photo is the proof. It is the answer to "you never delivered it" and
  // the reason a customer trusts leaving a bag outside at all, so it cannot be
  // the optional half of the most consequential button on the screen. Enforced
  // here rather than only in the form, because the JSON API reaches this too.
  if (!file || !file.buffer || !file.buffer.length) {
    return {
      ok: false,
      reason: 'invalid',
      detail: 'A photo is required to mark an order delivered. Take one at the door.',
    };
  }

  // EVERY BAG, OR NONE.
  //
  // A three-bag order cannot be completed having handed over two. The scan at
  // the door confirms the bag in the driver's hand is the right one; this is
  // what makes sure he did it for all of them before walking away.
  //
  // An order with no labels passes. Labelling is new, and refusing to deliver a
  // bag picked up before stickers existed would strand it on the van forever.
  const scanned = await loadout.allBagsScanned(order.id);

  if (!scanned.ok) {
    return {
      ok: false,
      reason: 'invalid',
      detail:
        `${scanned.scanned} of ${scanned.total} bags scanned. Scan the rest before marking it delivered - ` +
        `the whole order goes to the door together.`,
    };
  }

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

  // NOTHING IS CHARGED HERE. The card was charged at the scale, hours ago,
  // and this is a doorstep photo and a text.
  //
  // The one money case worth a clause is an order that is still unpaid at the
  // door - a card that was declined when we weighed it. We deliver anyway and
  // chase, so the delivery text is the last chance to say so before the bag is
  // out of our hands and the customer stops reading.
  const outstanding = order.price_cents && order.payment_status !== 'PAID' && order.payment_status !== 'WAIVED';

  const result = await step(order, 'DELIVERED', () => {
    const photo = photoUrl ? ` Photo: ${photoUrl}` : '';

    // The total is NOT repeated when it was paid - the weigh text already said
    // it, and a real thread ended up quoting it four times. It IS repeated
    // when it is still owed, because that is the one thing left to do.
    const price = outstanding
      ? ` ${money(order.price_cents)} is still outstanding - the card link we sent will settle it.`
      : '';

    // The one moment worth asking about a standing order: they have just
    // seen the service work, start to finish. Asked once, only if they have
    // no schedule already, and only when the delivery went cleanly - nobody
    // wants to be sold a weekly habit in the same breath as a failed card.
    const customer = order.customers || {};
    const offer =
      !recurring.isScheduled(customer) && !outstanding
        ? ` Want us to make this a regular thing? We can come every week or every other week.`
        : '';

    return `Delivered! Your laundry is at your door.${price}${photo}${offer}`;
  });

  if (!result.ok) return result;

  result.paid = !outstanding;
  result.paymentNote = outstanding ? 'still unpaid - the card failed at the scale' : null;

  if (photoUrl) {
    await db
      .from('orders')
      .update({ delivery_photo_url: photoUrl, delivery_photo_path: photoPath })
      .eq('id', order.id);
    result.order.delivery_photo_url = photoUrl;
  }

  // The stickers come off, logically. The bag is back with its owner and the
  // labels return to being blank stock, so one fished out of a bin points at
  // nothing. This is what keeps a printed sticker from being a permanent
  // window into somebody's order, and it is why the QR carries no expiry of
  // its own - the binding IS the expiry.
  //
  // After the transition, so a failed delivery does not orphan the bags.
  await bags.releaseOrder(order.id);

  // The stop number and the loaded flag describe one afternoon, not the order.
  // Leaving them is how a driver ends up trusting yesterday's tag.
  await db.from('orders').update({ stop_number: null, loaded_at: null }).eq('id', order.id);

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

// `texts` is whether the customer hears about this step. It is not decoration:
// /ops/process draws the whole customer-facing timeline from it, so the two
// silent steps stay visibly deliberate rather than looking like an oversight
// somebody should go and fix.
const STEPS = Object.freeze([
  { to: 'IN_PROCESS', action: 'collected', label: 'Collected', hint: 'Bag is in the van', texts: true },
  { to: 'AT_PARTNER', action: 'at-partner', label: 'Dropped at partner', hint: 'Left at the laundromat', texts: false },
  { to: 'READY', action: 'ready', label: 'Ready for collection', hint: 'Partner has finished it', texts: false },
  { to: 'OUT_FOR_DELIVERY', action: 'out-for-delivery', label: 'Out for delivery', hint: 'On the van, going back', texts: true },
  { to: 'DELIVERED', action: 'delivered', label: 'Delivered', hint: 'Needs a photo', texts: true },
]);

// The steps legal from where this order is now, in the order they appear above.
function nextSteps(order) {
  const allowed = orders.ALLOWED_NEXT[order.status] || [];
  return STEPS.filter((s) => allowed.includes(s.to));
}

// ---------------------------------------------------------------------------
// How long is left on the promise
// ---------------------------------------------------------------------------
//
// We tell every customer "back within 24 hours", and the clock starts when the
// driver takes the bag. Until now nothing anywhere counted it: an order could
// sit at a laundromat for two days and no screen would say so.
//
// Returns null for anything not yet collected or already delivered, because a
// countdown only means something while we are holding somebody's clothes.
const TURNAROUND_HOURS = 24;

function turnaround(order) {
  if (!order.collected_at) return null;
  if (['DELIVERED', 'CANCELED'].includes(order.status)) return null;

  const due = new Date(order.collected_at).getTime() + TURNAROUND_HOURS * 3600 * 1000;
  const minutesLeft = Math.round((due - Date.now()) / 60000);

  const label = (mins) => {
    const h = Math.floor(Math.abs(mins) / 60);
    const m = Math.abs(mins) % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
  };

  if (minutesLeft < 0) {
    return { overdue: true, urgent: true, minutesLeft, text: `${label(minutesLeft)} overdue` };
  }

  return {
    overdue: false,
    // Under four hours is the point where somebody needs to do something about
    // it rather than just know about it.
    urgent: minutesLeft <= 240,
    minutesLeft,
    text: `${label(minutesLeft)} left`,
  };
}

module.exports = {
  collect,
  dropAtPartner,
  markReady,
  recordWeight,
  outForDelivery,
  deliver,
  nextSteps,
  turnaround,
  TURNAROUND_HOURS,
  STEPS,
  PHOTO_BUCKET,
  WEIGHT_PHOTO_BUCKET,
};
