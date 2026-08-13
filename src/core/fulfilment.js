'use strict';

const db = require('../db');
const orders = require('./orders');
const billing = require('./billing');
const bags = require('./bags');
const booking = require('./booking');
const loadout = require('./loadout');
const events = require('./order-events');
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
async function step(order, to, buildMessage, by = {}) {
  let updated;
  const from = order.status;

  try {
    updated = await orders.transition(order, to);
  } catch (err) {
    return refusal(err);
  }

  // Logged here rather than in each step, so a step added later cannot forget.
  const words = (s) => String(s).replace(/_/g, ' ').toLowerCase();
  await events.record(order.id, {
    kind: 'STATUS',
    summary: `Moved to ${words(to)}`,
    was: from,
    became: to,
    by,
  });

  const customer = order.customers;
  const message = buildMessage ? buildMessage(updated, customer) : null;

  if (message && customer) await sendAndLog(customer.phone, message, customer.id);

  return { ok: true, order: updated, message };
}

// --- Collected --------------------------------------------------------------
//
// The moment the laundry becomes our responsibility, and the moment the
// customer loses the ability to cancel. Both follow from this one call.

async function collect(order, { bagCount, by = {} } = {}) {
  // The one new fact: we have the bag. The turnaround was promised in the
  // confirmation; repeating it in every text is what Neil flagged.
  const result = await step(
    order,
    'IN_PROCESS',
    () => `We've got your laundry! We'll text you the weight and the total once it's on the scale.`,
    by
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

async function dropAtPartner(order, { partnerId, by = {} } = {}) {
  const unweighed = needsWeightFirst(order);
  if (unweighed) return unweighed;

  const result = await step(order, 'AT_PARTNER', null, by);
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

    const { data: partner } = await db.from('partners').select('name').eq('id', partnerId).maybeSingle();
    await events.record(order.id, {
      kind: 'PARTNER',
      summary: `Dropped at ${partner ? partner.name : 'a laundromat'}`,
      became: partner ? partner.name : partnerId,
      by,
    });
  }

  return result;
}

async function markReady(order, { by = {} } = {}) {
  return step(order, 'READY', null, by);
}

// --- Weight, which is where the money happens -------------------------------
//
// Not a status change. Weighing is an event that can happen at any point while
// we have the bag, the same way unlocking a locker is an event rather than a
// state. What it does change is the price, from an estimate to a real number.

async function recordWeight(order, weightLb, photo, { by = {} } = {}) {
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
    // arrived_at goes with it: weighing is the last thing that happens at the
    // customer's door, so this is the moment the driver leaves. Left set, the
    // guided run would tell him he is still standing at a stop he drove away
    // from - and would think he had already arrived at the delivery, months
    // later, when the same order comes round again.
    .update({
      weight_lb: weight,
      price_cents: priceCents,
      weight_photo_path: photoPath,
      arrived_at: null,
    })
    .eq('id', order.id)
    .select('*')
    .single();

  if (error) throw error;

  const customer = order.customers;

  // NOTHING IS CHARGED HERE. Weighing sets the price; delivery collects it.
  //
  // The charge sat here briefly and Neil moved it, for a reason that only
  // became visible once laundromats started entering their own weight: the
  // scale is the FIRST moment an amount exists, but the bag then goes to a
  // partner who may read it differently. Charging at the scale meant the money
  // had already moved by the time a disagreement surfaced, and the only
  // remedies left were a refund or an awkward conversation.
  //
  // Charging at the door leaves the whole turnaround as a window to sort it
  // out, and the customer pays at the moment they get their laundry back.
  //
  // Still exactly ONE charge. The two-charge model - a minimum at booking and
  // the balance later - is gone and is not what this is.
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

  // What happens to the money, said as something still to come. Nothing is
  // taken here, so a sentence in the past tense would be a lie the customer
  // reads an hour before the charge actually lands.
  let settlement;
  if (owed === 0) {
    settlement = `You've already paid that, so there's nothing more to pay.`;
  } else if (card) {
    settlement = `We'll take it off your ${card} when we drop it back.`;
  } else {
    settlement = `We'll settle up when we drop it back.`;
  }

  const message = `${howPriced} ${settlement}`;

  // Re-saving the same weight is not news. A driver correcting a typo back to
  // what it already was, or tapping Save twice, should not text the customer
  // the same figure again.
  const unchanged = previous != null && previous === weight;
  if (!unchanged) await sendAndLog(customer.phone, message, customer.id);

  // A correction is the single most useful thing in this log: it is the answer
  // to "why was I charged that", and without it a re-weigh is invisible.
  if (!unchanged) {
    await events.record(order.id, {
      kind: 'WEIGHT',
      summary: isCorrection
        ? `Weight corrected to ${weight} lb, was ${previous} lb`
        : `Weighed ${weight} lb`,
      was: previous == null ? null : `${previous} lb`,
      became: `${weight} lb`,
      by,
      reason: isCorrection ? 'Re-weighed after the first figure was saved' : null,
    });

    await events.record(order.id, {
      kind: 'PRICE',
      summary: minimumApplied
        ? `Priced ${money(priceCents)}, the minimum`
        : `Priced ${money(priceCents)} at ${money(rate)} a pound`,
      was: order.price_cents == null ? null : money(order.price_cents),
      became: money(priceCents),
      by,
    });
  }

  return {
    ok: true,
    order: updated,
    message,
    weightLb: weight,
    priceCents,
    owedCents: owed,
    // No payment fields here any more. Weighing prices the order; the delivery
    // step is what reports whether money moved.
    overMaxOrder: weight > config.pricing.maxOrderLb,
  };
}

// --- Out for delivery -------------------------------------------------------

async function outForDelivery(order, { by = {} } = {}) {
  // Same rule as the partner drop: a bag must never get on the van without a
  // weight on record, because the doorstep is the last place it could be
  // weighed and by then it is too late.
  const unweighed = needsWeightFirst(order);
  if (unweighed) return unweighed;

  // The one new fact: it is on the van. They already know the price from the
  // weigh text; repeating it here is what made the thread read like a bill.
  return step(order, 'OUT_FOR_DELIVERY', () => `Washed, folded and out for delivery today!`, by);
}

// --- Delivered, with the photo ----------------------------------------------
//
// The photo is the proof. It goes into a private bucket and the customer gets
// a link on our own domain that signs on demand, because a picture of
// somebody's front door should not be publicly readable forever, and a signed
// storage URL would eventually expire and break the photo.

async function deliver(order, file, { by = {} } = {}) {
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

  // THE CARD IS CHARGED HERE, and this is the only place it is.
  //
  // The doorstep is the moment the work is finished and the customer has their
  // laundry back, and it is the far end of a window that matters: between the
  // scale and here, a laundromat may have entered a different weight and a
  // person may have had to look at it. Charging at the scale closed that window
  // before it opened.
  //
  // Done BEFORE the transition so the delivery text can say what actually
  // happened to the money rather than guessing.
  //
  // A DECLINE DOES NOT STOP THE DELIVERY. The clothes are already on the step;
  // holding somebody's laundry over a card is a bad look and legally murky, and
  // the exposure is one order. We deliver and chase by text.
  const charge =
    order.price_cents && order.payment_status !== 'PAID' && order.payment_status !== 'WAIVED'
      ? await billing.chargeOrder(order, order.customers)
      : { ok: true, nothingDue: true };

  // Loaded here rather than read off the customer row: a customer can have
  // several standing orders now, and the only question this asks is whether
  // they have any at all before offering them one.
  const schedules = order.customers ? await recurring.forCustomer(order.customers.id) : [];

  const settled = Boolean(charge.ok);

  await events.record(order.id, {
    kind: 'PAYMENT',
    summary: charge.nothingDue
      ? 'Nothing left to charge'
      : charge.ok
        ? `Charged ${money(order.price_cents)}`
        : charge.needsCard
          ? `Could not charge ${money(order.price_cents)} - no card on file`
          : `Card declined for ${money(order.price_cents)}`,
    became: charge.ok ? 'PAID' : 'unpaid',
    by,
    reason: charge.ok || charge.nothingDue ? null : 'Delivered anyway and chased by text',
  });

  const result = await step(order, 'DELIVERED', () => {
    const photo = photoUrl ? ` Photo: ${photoUrl}` : '';

    // The total was already said at the scale, so it is only repeated when
    // something went wrong with it - a real thread ended up quoting the same
    // figure four times.
    let price = '';
    if (charge.nothingDue) {
      price = '';
    } else if (charge.ok) {
      price = ` ${money(order.price_cents)} charged to your ${billing.describeCard(order.customers) || 'card'}.`;
    } else if (charge.needsCard) {
      price = ` We don't have a card on file. ${money(order.price_cents)} is outstanding. Add one here and we'll settle it: ${charge.setupUrl || ''}`;
    } else if (charge.declined) {
      price = ` Your card was declined. ${money(order.price_cents)} is still outstanding. Update it here and we'll settle it: ${charge.setupUrl || ''}`;
    }

    // The one moment worth asking about a standing order: they have just
    // seen the service work, start to finish. Asked once, only if they have
    // no schedule already, and only when the delivery went cleanly - nobody
    // wants to be sold a weekly habit in the same breath as a failed card.
    const customer = Object.assign({}, order.customers, { schedules });
    const offer =
      !recurring.isScheduled(customer) && settled
        ? ` Want us to make this a regular thing? We can come every week or every other week.`
        : '';

    return `Delivered! Your laundry is at your door.${price}${photo}${offer}`;
  }, by);

  if (!result.ok) return result;

  result.paid = settled;
  result.paymentNote = settled
    ? null
    : charge.needsCard
      ? 'no card on file'
      : charge.declined
        ? 'card declined'
        : 'payments are switched off';

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
// WE PROMISE NEXT DAY, SO THE DEADLINE IS THE END OF THE NEXT DAY.
//
// It used to be a flat 24 hours from collection, and that is a different
// promise wearing the same words. A bag collected at 9am was due back at 9am;
// one collected at 5pm was due at 5pm the next day, which is after the van has
// finished. Two customers on the same round had deadlines eight hours apart
// and neither matched what they were told.
//
// Now both are due by the end of the day after we collected - the end of the
// last window the van runs, which is where `endOfDeliveryDay()` comes from
// rather than being written down again here. So the time a bag has is exactly
// "the rest of today, plus tomorrow up to the last delivery", and a late
// pickup honestly has less of it.
//
// Returns null for anything not yet collected or already delivered, because a
// countdown only means something while we are holding somebody's clothes.

function dueAt(order) {
  if (!order.collected_at) return null;

  // Which day it was collected on, in New Jersey rather than UTC. Past 8pm
  // Eastern the two disagree, and using UTC would move a Monday evening
  // pickup's deadline forward a whole day.
  const collectedOn = new Intl.DateTimeFormat('en-CA', {
    timeZone: booking.SERVICE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(order.collected_at));

  return booking.instantAt(booking.addDays(collectedOn, 1), booking.endOfDeliveryDay());
}

function turnaround(order) {
  if (!order.collected_at) return null;
  if (['DELIVERED', 'CANCELED'].includes(order.status)) return null;

  const due = dueAt(order);
  const minutesLeft = Math.round((due - Date.now()) / 60000);

  // Days once it is more than a day out, because "31h 12m left" is a number
  // somebody has to do arithmetic on and "1d 7h left" is not.
  const label = (mins) => {
    const total = Math.abs(mins);
    const d = Math.floor(total / 1440);
    const h = Math.floor((total % 1440) / 60);
    const m = total % 60;
    if (d) return `${d}d ${h}h`;
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
  dueAt,
  STEPS,
  PHOTO_BUCKET,
  WEIGHT_PHOTO_BUCKET,
};
