'use strict';

const db = require('../db');
const orders = require('./orders');
const billing = require('./billing');
const bags = require('./bags');
const booking = require('./booking');
const loadout = require('./loadout');
const events = require('./order-events');
const recurring = require('./recurring');
const partners = require('./partners');
const promotions = require('./promotions');
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

  // THE CLIPS COME OFF HERE, which is what makes those numbers free for the
  // next bags. Handing the bag over is the end of the van leg, and the clip's
  // whole life is the van leg.
  //
  // The number itself is kept on the row, not cleared, so the order page can
  // still say which clip a bag travelled under - the same reason a released
  // sticker keeps its order.
  // ONCE IT IS HANDED OVER, WHERE IT WENT CANNOT CHANGE.
  //
  // Until this moment the laundromat is an intention and the router is free to
  // move it - a pickup fifteen minutes later near a different partner should be
  // able to redirect a bag still in the van. Handing it across a counter is
  // what settles it, and after that orders.partner_id is a record of fact
  // rather than a plan.
  if (partnerId) {
    await db
      .from('bag_labels')
      .update({ intended_partner_id: partnerId, partner_locked: true })
      .eq('order_id', order.id);
  }

  const freed = await bags.unclipOrder(order.id);

  if (freed.length) {
    await events.record(order.id, {
      kind: 'LABEL',
      summary: `Clip${freed.length === 1 ? '' : 's'} ${freed.join(', ')} back in the van`,
      by,
    });
  }

  result.freedClips = freed;

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

// The mean of what this customer's orders have actually weighed.
//
// Deliberately a plain mean over the recent ones rather than anything cleverer:
// somebody's laundry habits are stable, and a weighted average would be harder
// to explain than it is worth.
const ESTIMATE_FROM_LAST = 6;

async function updateWeightEstimate(customerId) {
  if (!customerId) return null;

  const { data, error } = await db
    .from('orders')
    .select('weight_lb')
    .eq('customer_id', customerId)
    .not('weight_lb', 'is', null)
    .order('created_at', { ascending: false })
    .limit(ESTIMATE_FROM_LAST);

  if (error) throw error;

  const weights = (data || []).map((o) => Number(o.weight_lb)).filter((w) => w > 0);
  if (!weights.length) return null;

  const mean = weights.reduce((t, w) => t + w, 0) / weights.length;

  await db
    .from('customers')
    .update({ estimated_weight_lb: Math.round(mean * 10) / 10 })
    .eq('id', customerId);

  return mean;
}

async function recordWeight(order, weightLb, photo, { by = {}, photoOnBags = false } = {}) {
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

  // NO PHOTO IS REQUIRED. NEIL'S CALL, and a reversal of the rule that used to
  // live here.
  //
  // It refused a first weighing without a picture of the scale display, on the
  // grounds that this number charges a card and ten seconds of a driver's time
  // is what makes it answerable afterwards. That reasoning has not stopped
  // being true - what it costs is a photo step at every bag on every doorstep,
  // and Neil has decided that price is too high for a business with one van.
  //
  // WHAT WE GIVE UP, so nobody has to rediscover it: a customer certain their
  // bag was not 40 lb, or a laundromat whose invoice says 44, now meets our
  // word rather than a picture. The per-bag weights and the audit trail are
  // still there; the photograph is not.
  //
  // A photo is still ACCEPTED and stored when one is sent - the JSON API takes
  // multipart and old orders have theirs - it is simply never demanded.
  const firstWeighing = order.weight_lb == null;
  const havePhoto = Boolean(photo && photo.buffer && photo.buffer.length);

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
      navigating_at: null,
    })
    .eq('id', order.id)
    .select('*')
    .single();

  if (error) throw error;

  const customer = order.customers;

  // WHAT THIS CUSTOMER'S LAUNDRY ACTUALLY WEIGHS, learned from the scale.
  //
  // Planning needs a number before a bag has been weighed, and the router used
  // a flat 12.5 lb - which is where a $25 minimum meets $2 a pound, a BILLING
  // break-even and not a physical floor. Somebody can hand over 7 lb and owe
  // $25, so the flat figure over-states small loads and everything built on it
  // inherits that.
  //
  // So it becomes what they have actually weighed. Best effort: a planning
  // estimate failing to update must never fail a weighing that has already
  // priced somebody's order.
  updateWeightEstimate(order.customer_id).catch((err) =>
    console.warn(`could not update the weight estimate for ${order.customer_id}:`, err.message)
  );

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

  // NOTHING IS TEXTED HERE ANY MORE, and this is the part that changed.
  //
  // This number is now provisional. The laundromat weighs the same laundry when
  // they take it in, and if their figure is higher and within tolerance THAT is
  // what the customer is billed. Texting our number here and then charging
  // theirs would mean quoting a price we do not honour - so the price message
  // moved to settleWeight(), which runs once, when the amount can no longer
  // move, and says what was actually charged.
  //
  // `message` is still built above because it is what the ops screens show back
  // to the driver as "what this weighs and what it comes to".
  const unchanged = previous != null && previous === weight;

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

  // WHAT CAME BACK IS CONFIRMED BEFORE THE CUSTOMER IS TOLD ANYTHING.
  //
  // Neil's call, and it fixes a real sequence fault: an order went out for
  // delivery, and the customer was texted, while nobody had yet recorded how
  // many bags came off the laundromat's shelf or what they weighed. The first
  // moment anybody would have noticed a missing bag was a doorstep, after the
  // promise had already been sent.
  //
  // Bags out is NOT bags in - they repack into their own - so the count cannot
  // be assumed. Only asked of an order that went to a laundromat; one we washed
  // ourselves never left the van and has nothing to reconcile.
  //
  // THE WEIGHT IS NO LONGER REQUIRED HERE, and that is a deliberate reversal.
  // It used to be, on the grounds that a WEIGHT proves nothing was left behind
  // and a count cannot - which was true when the bags coming back were
  // anonymous and a count was just a number somebody said out loud.
  //
  // They are not anonymous now. Every bag the laundromat packs carries a
  // numbered sticker off the tag it came out of, and the driver ticks each one
  // off a named list as it reaches his hands. return_bag_count is written from
  // those ticks, so it is not a typed total - it is a set of bags we can name.
  // A bag left on their shelf is an untapped button on the driver's screen.
  //
  // That is a stronger check than a total, not a weaker one: it does not only
  // say something is missing, it says which one.
  if (order.partner_id && order.return_bag_count == null) {
    return {
      ok: false,
      reason: 'unconfirmed',
      detail:
        'Collect the bags from the laundromat first - tick each one off on your ' +
        'round. The customer is told it is on the way as soon as this moves, so ' +
        'it needs to be right before that goes out.',
    };
  }

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

async function deliver(orderIn, file, { by = {} } = {}) {
  // Reassigned as settlement updates it below, so it cannot be a const.
  let order = orderIn;
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
  // NO SCAN AT THE DOOR ANY MORE. Neil's call, and the reasoning holds: by the
  // time he is standing there the CLIP has already said which bags these are,
  // and he takes the bag tag off before handing them over - so scanning a tag
  // seconds before binning it proves nothing the clip did not.
  //
  // What replaced it is not nothing. The clips are how he finds the right bags
  // in the van, taking them off is a step he confirms, and stripping the tags
  // is another - so a bag that was never in the van cannot reach a door, and
  // one that reaches a door cannot arrive still wearing somebody's tracking.
  //
  // The photo above is still required and is still the proof of the doorstep
  // itself.

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

  // SETTLE ANYTHING STILL OPEN, FIRST. This is the backstop that stops an order
  // being delivered and never billed: a laundromat entering its weight is
  // voluntary and usually never happens, so most orders arrive here with the
  // price still provisional. Settling on our own scale is what used to happen
  // at this exact point anyway.
  //
  // A HELD ORDER IS NOT CHARGED AND IS STILL DELIVERED. Two scales disagreeing
  // is our problem, not a reason to stand on somebody's step holding their
  // clothes - the same rule a declined card already follows.
  const settlement = await settleWeight(order, { by }).catch((err) => {
    console.error(`Could not settle order ${order.id}: ${err.message}`);
    return { ok: false };
  });

  if (settlement && settlement.held) {
    order = { ...order, weight_held_at: new Date().toISOString() };
  } else if (settlement && settlement.priceCents) {
    order = { ...order, price_cents: settlement.priceCents, payment_status: settlement.charged ? 'PAID' : order.payment_status };
  }

  // THE CARD IS CHARGED HERE when settlement did not already do it - a price
  // settled earlier at a laundromat, or one whose card declined then.
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
    // A BLANK LINE, NOT A SPACE. Neil's call, and the reason is visible in the
    // message he sent back: the photo URL ran straight into "Want us to make
    // this a regular thing", so the link looked like it continued into the
    // sentence and the offer looked like part of the delivery notice.
    //
    // Two different things are being said - here is your laundry, and would you
    // like this regularly - so they get their own block.
    //
    // A newline is in the GSM alphabet, so this costs two characters and does
    // NOT push the message into UCS-2. Anything added here still has to be
    // counted.
    const offer =
      !recurring.isScheduled(customer) && settled
        ? `

Want us to make this a regular thing? We can come every week or every other week.`
        : '';

    // SAME DAY IS WORTH SAYING OUT LOUD, and this is the only moment it can be
    // said honestly. What we promise is next day, so a bag collected and
    // returned between breakfast and teatime beat the promise - and a customer
    // who is not told simply never notices they got something extra.
    //
    // Neil's wording: it is free, and saying so is the point. A turnaround that
    // fast reads like something that will appear on the bill unless we say it
    // will not.
    //
    // IT REPLACES THE OPENER RATHER THAN BEING ADDED TO IT, and the wording is
    // as short as it is for a reason that is not style. This message already
    // carries a price and a photo link and comes to 131 characters; a segment
    // is 160 and carriers bill per segment. The obvious phrasing - "Delivered!
    // Same day, at no extra charge - your laundry is at your door." - came to
    // 162 and doubled the cost of every same-day delivery to say two words.
    //
    // So it leads with the news and keeps the sentence that was already there,
    // at 157. Anything added here has to be counted, not eyeballed.
    const sameDay =
      order.collected_at && booking.serviceDateOf(order.collected_at) === booking.today();

    const opener = sameDay
      ? `Delivered same day, no extra charge! Your laundry is at your door.`
      : `Delivered! Your laundry is at your door.`;

    return `${opener}${price}${photo}${offer}`;
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

  // The clips come off at the door, which is what puts those numbers back in
  // the van for the next load. A bag on a doorstep is not wearing one of ours.
  await bags.unclipOrder(order.id);

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
  const collectedOn = booking.serviceDateOf(order.collected_at);

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

// --- What the customer is actually billed ----------------------------------

// Settles the price, and is the ONLY thing allowed to.
//
// NEIL'S RULE. Two scales weigh the same laundry - our driver's at the door and
// the laundromat's when they take it in:
//
//   within tolerance   bill the HIGHER of the two, charge the card, text the
//                      customer what it came to.
//   outside tolerance  hold it. No charge, no text, and it goes on the issues
//                      screen until he settles it himself.
//
// The tolerance is what makes reading a partner's figure into the price safe at
// all. It used to be banned outright, because a scale reading 400 instead of 40
// would be a $1,000 charge with nobody of ours in between. It is now capped
// instead of banned: a partner can move a bill by less than the tolerance on
// their own, and by nothing at all past it.
//
// IDEMPOTENT, AND THAT IS LOAD-BEARING. It is reached from the laundromat's
// page, from delivery and from Neil settling a hold by hand, and it charges a
// card. An order that is already settled returns and does nothing, so a
// double-tap, a retry or two doors racing cannot charge twice.
async function settleWeight(order, { by = {}, chosenLb = null, partnerLb = null, note = null } = {}) {
  if (order.weight_settled_at) {
    return { ok: true, already: true, priceCents: order.price_cents };
  }

  const ours = order.weight_lb == null ? null : Number(order.weight_lb);
  const theirs = order.partner_weight_lb == null ? null : Number(order.partner_weight_lb);

  let billable = null;
  let basis = null;

  // Which band the two scales fell into, and what the laundromat is invoiced
  // for. Both recorded on the order rather than recomputed later: the
  // thresholds can move, and an invoice that changes after it has gone out is
  // worse than one that is wrong.
  let band = null;
  let partnerBill = null;

  if (chosenLb != null) {
    // A person has looked at both and decided. This is the only way out of a
    // hold, and it wins over any arithmetic.
    billable = Number(chosenLb);
    basis = note || 'settled by hand';

    // AND THE LAUNDROMAT'S SIDE IS THEIRS TO SET TOO. An exception holds both
    // numbers, so settling one and leaving the other would put the order back
    // on the board tomorrow with half of it decided. `partnerLb` defaults to
    // the same figure - if a person has looked at two scales and picked one,
    // that is usually what both sides are worth - but it can be given
    // separately, because "charge the customer 50 and pay them 45" is a real
    // decision somebody might make.
    partnerBill = partnerLb != null ? Number(partnerLb) : Number(chosenLb);
    band = partners.BANDS.EXCEPTION;
  } else if (ours != null && theirs != null) {
    // The admin's thresholds, not constants. One set for every laundromat.
    const limits = await settings.weightLimits();
    const check = partners.compareWeights({ weight_lb: ours, partner_weight_lb: theirs }, limits);

    band = check.band;

    // WHAT WE PAY THEM, which is a separate question from what we charge the
    // customer and is answered by THEIR scale. Null past the exception line -
    // that is not "nothing", it is "a person has to decide", and the hold
    // below is what makes somebody do it.
    partnerBill = partners.partnerBillFor(check);

    if (check.overThreshold) {
      // HELD. Nothing is charged and nothing is texted - a customer told a
      // price we are still arguing about internally has been told the wrong
      // thing, and taking the money first makes it a refund rather than a
      // decision.
      await db
        .from('orders')
        .update({ weight_held_at: new Date().toISOString() })
        .eq('id', order.id);

      await events.record(order.id, {
        kind: 'WEIGHT',
        summary:
          `Price held: we weighed ${ours} lb, the laundromat ${theirs} lb - ` +
          `${check.absolute.toFixed(1)} lb apart and we allow ${check.tolerance.toFixed(1)}`,
        by,
        reason: 'Outside tolerance, so nothing is charged and nothing is texted until it is settled',
      });

      return { ok: false, held: true, check, ours, theirs };
    }

    // THE HIGHER OF THE TWO. Neil's call. Within the tolerance the two scales
    // are describing the same laundry, and the difference is smaller than the
    // amount either could be out by.
    billable = Math.max(ours, theirs);
    basis = billable === theirs && theirs !== ours ? "the laundromat's scale, the higher of the two" : 'our scale, the higher of the two';
  } else if (ours != null) {
    // THE BACKSTOP. The laundromat's figure is voluntary and usually never
    // arrives. Waiting for it for ever would mean delivering laundry and never
    // billing for it, which is the worst outcome available here.
    billable = ours;
    basis = 'our scale; the laundromat did not enter one';
  } else {
    return { ok: false, reason: 'no_weight', detail: 'Nothing has been weighed yet.' };
  }

  // The terms stored on the order, never today's. Same rule as everywhere else:
  // changing the price must not re-price work already quoted.
  const rate = order.price_per_lb_cents || config.pricing.perPoundCents;
  const floor = order.minimum_cents != null ? order.minimum_cents : order.deposit_cents || 0;
  const byWeight = Math.round(billable * rate);

  // PAID WASH OPTIONS SIT ON TOP OF THE MINIMUM, NOT INSIDE IT.
  //
  // Free & clear detergent and fragrance-free softener each add a fixed amount,
  // frozen onto the order when it was taken. They are added AFTER the minimum
  // has done its work, because the minimum is what a small load of washing is
  // worth and an extra we were asked for on top of it is a separate thing we
  // did. Folding the surcharge in first would mean a 6 lb order paid for its
  // fragrance-free detergent out of the minimum and we did that work for free.
  const surcharge = Math.max(0, Number(order.surcharge_cents || 0));
  const beforeDiscount = Math.max(byWeight, floor) + surcharge;

  // THE DISCOUNT COMES OFF AFTER THE MINIMUM, not before it.
  //
  // Taking 20% off an 8 lb load's $16 and then flooring at $25 would charge
  // the full minimum and hand the customer nothing, while the order still
  // claimed a promotion had been used. The minimum is what the work is worth;
  // the promotion is what we chose to give away against it.
  const deal = await promotions
    .discountFor(order.customers, order, beforeDiscount)
    .catch((err) => {
      console.error(`Could not work out a discount for ${order.id}: ${err.message}`);
      return null;
    });

  const discountCents = deal ? deal.cents : 0;
  const priceCents = Math.max(0, beforeDiscount - discountCents);

  const { data: settled, error } = await db
    .from('orders')
    .update({
      billable_weight_lb: billable,
      price_cents: priceCents,
      discount_cents: discountCents,
      promotion_id: deal ? deal.promotion.id : null,
      weight_settled_at: new Date().toISOString(),
      weight_held_at: null,

      // WHAT THE LAUNDROMAT IS INVOICED, and how far apart the two scales
      // were. Recorded rather than recomputed, because the thresholds can move
      // and an invoice that changes after it has gone out is worse than one
      // that is wrong. Both null when only our own scale ever spoke, which is
      // the ordinary case for an order that never went to a partner.
      weight_band: band,
      partner_bill_lb: partnerBill,
      partner_bill_settled_at: partnerBill == null ? null : new Date().toISOString(),
    })
    .eq('id', order.id)
    // Only if nobody has settled it in the meantime. This is the race that
    // would otherwise charge a card twice.
    .is('weight_settled_at', null)
    .select('*')
    // maybeSingle, NOT single. When the guard above matches nothing - which is
    // precisely the race this exists to catch - single() throws rather than
    // returning null, so the losing caller would 500 instead of quietly doing
    // nothing. Found by settling the same order twice on purpose.
    .maybeSingle();

  if (error) throw error;
  if (!settled) return { ok: true, already: true, priceCents: order.price_cents };

  // Spent at the moment the price is settled, and only once - settleWeight is
  // idempotent, so a second call finds the order already settled and never
  // reaches here.
  if (deal) {
    await promotions.redeem(deal.grantId, order.id).catch((err) =>
      console.error(`Could not redeem a promotion on ${order.id}: ${err.message}`)
    );
  }

  await events.record(order.id, {
    kind: 'PRICE',
    summary:
      `Priced at ${money(priceCents)} on ${billable} lb - ${basis}` +
      (deal ? `, less ${money(discountCents)} for ${deal.promotion.name}` : ''),
    was: ours == null ? null : `${ours} lb ours` + (theirs == null ? '' : `, ${theirs} lb theirs`),
    became: `${billable} lb billed`,
    by,
  });

  const customer = order.customers;
  const withCustomer = { ...settled, customers: customer };

  // NOTHING IS CHARGED HERE. Settling decides the amount; the doorstep collects
  // it.
  //
  // Neil's call, and it went back and forth for a reason worth recording. The
  // charge sat here briefly because settling against two scales closes the
  // window in which a weight could be disputed, which made charging early look
  // safe. It moved back because safe is not the only question: the customer
  // pays at the moment they have their laundry in their hands, which is what
  // they were told would happen and the thing that makes a decline recoverable
  // rather than a refund.
  //
  // So this function's job ends at deciding the amount and telling them.
  const charge = { ok: false, notYet: true };

  if (customer) {
    const minimumApplied = beforeDiscount > byWeight;

    const opening = `Your laundry weighed ${billable} lb`;
    const base = minimumApplied
      ? `${opening}, which is under our ${money(floor)} minimum, so that is ${money(beforeDiscount)}.`
      : `${opening}, so that is ${money(beforeDiscount)} at ${site.pricePerLb} a pound.`;

    // SAY WHAT CAME OFF. A total that is lower than the arithmetic the
    // customer can do themselves reads as a mistake unless the reason is in
    // the same message.
    const howPriced = deal
      ? `${base} ${money(discountCents)} off for ${deal.promotion.name}, so the total is ${money(priceCents)}.`
      : `${base.replace(/that is /, 'the total is ')}`;

    // Said as something still to come, because it is. Money moves at the door.
    const card = billing.describeCard(customer);
    const paid = card
      ? `We'll take it off your ${card} when we drop it back.`
      : `We'll settle up when we drop it back.`;

    await sendAndLog(customer.phone, `${howPriced} ${paid}`, customer.id);
  }

  return { ok: true, priceCents, billable, basis, charged: Boolean(charge && charge.ok) };
}

// --- Did it all come back? --------------------------------------------------

// Compares what went out with what came back, under one order number.
//
// THE COUNT PROVES NOTHING AND THE WEIGHT PROVES EVERYTHING. A customer's
// laundry arrives in whatever they own and the laundromat repacks it into their
// own bags, so two bags in can be one bag out or four. Comparing the two counts
// would flag every single order. Comparing the two weights is the real check:
// 25 lb collected and 25 lb returned means it is all there, however it was
// carried.
//
// IT NEVER RE-PRICES. price_cents was set by the pickup scale, texted to the
// customer and agreed to. A clean weight that reads differently is a question
// for a person, not an authority to move money - exactly the rule that keeps a
// laundromat's own figure out of the pricing code.
//
// Clean laundry is legitimately a little lighter than dirty: water and grit
// come out of it. So this uses the same tolerance as the partner cross-check
// rather than demanding the numbers match.
async function reconcileReturn(order, returned, { by = {} } = {}) {
  const ours = order.weight_lb == null ? null : Number(order.weight_lb);
  const back = Number(returned.pounds);

  await db
    .from('orders')
    .update({ return_weight_lb: back.toFixed(2) })
    .eq('id', order.id);

  const check = partners.compareWeights({ weight_lb: ours, partner_weight_lb: back });

  const bagsPhrase =
    `${returned.bags} bag${returned.bags === 1 ? '' : 's'} back ` +
    `(we collected ${order.bag_count == null ? 'an unrecorded number of' : order.bag_count})`;

  await events.record(order.id, {
    kind: 'WEIGHT',
    summary: check
      ? `${bagsPhrase}, ${back.toFixed(1)} lb - ` +
        `${check.absolute.toFixed(1)} lb ${check.heavier ? 'heavier' : 'lighter'} than we collected`
      : `${bagsPhrase}, ${back.toFixed(1)} lb`,
    was: ours == null ? null : `${ours} lb collected`,
    became: `${back.toFixed(1)} lb returned`,
    by,
    reason: check && check.overThreshold ? 'Outside the tolerance, so an issue was raised' : null,
  });

  if (check && check.overThreshold) {
    const issues = require('./issues');

    await issues
      .raise({
        customer: order.customers || null,
        order,
        reason:
          `Weight back does not match weight out: ${ours} lb collected, ` +
          `${back.toFixed(1)} lb returned - ${check.absolute.toFixed(1)} lb apart, ` +
          `and we allow ${check.tolerance.toFixed(1)}. ` +
          `${check.heavier ? 'More came back than went out.' : 'Something may still be at the laundromat.'} ` +
          `The customer was charged on the ${ours} lb we collected and that has not changed.`,
      })
      .catch((err) => console.error(`Could not raise a return mismatch: ${err.message}`));

    return {
      overThreshold: true,
      check,
      detail:
        `${back.toFixed(1)} lb came back against ${ours} lb collected - ` +
        `${check.absolute.toFixed(1)} lb out. Raised for someone to look at. ` +
        `Nothing about the price has changed.`,
    };
  }

  return {
    overThreshold: false,
    check,
    detail: `All ${returned.bags} bags weighed - ${back.toFixed(1)} lb back against ${ours} lb collected.`,
  };
}

module.exports = {
  settleWeight,
  reconcileReturn,
  updateWeightEstimate,
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
