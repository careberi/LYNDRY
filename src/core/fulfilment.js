'use strict';

const db = require('../db');
const orders = require('./orders');
const billing = require('./billing');
// For paymentHold()/balance(). No cycle: dispatch reaches billing, orders,
// booking, partners and geocode, and none of those reach back here.
const dispatch = require('./dispatch');
const bags = require('./bags');
const booking = require('./booking');
const loadout = require('./loadout');
const events = require('./order-events');
const recurring = require('./recurring');
const partners = require('./partners');
const promotions = require('./promotions');
const settings = require('./settings');
const tags = require('./tags');
const issues = require('./issues');
// THE RATE IN A MESSAGE COMES FROM THE ORDER, and this is what says it in
// English. Every text below that names a price per pound reads the order's own
// rate through it rather than site.pricePerLb, which is the one-time rate and
// is the wrong number for a subscriber. See the note on `perPoundOf`.
const subscription = require('./subscription');
// The subscription question after a first paid delivery: when it goes, and
// the morning send for a late one. A leaf module - it requires neither this
// file nor the scheduler, so neither can close a loop through it.
const subscriptionOffer = require('./subscription-offer');
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
// WHAT THIS ORDER IS PRICED AT, IN ENGLISH, FOR THE CUSTOMER TO READ.
//
// Found by an outside audit, 16 September, and it is the fifth sentence in
// this file to name a rate that had stopped being true - CLAUDE.md already
// says "if the charge point moves again, grep for 'a pound'". This time the
// rate moved rather than the moment.
//
// EVERY ONE OF THESE MESSAGES WAS BUILT FROM site.pricePerLb, which is
// config.pricing.perPoundCents and is the ONE-TIME rate. The arithmetic beside
// it is built from order.price_per_lb_cents, which is $1.80 on a subscription.
// So a subscriber weighed at 38 lb was charged $68.40 and texted "$68.40 at
// $2.00 a pound" - a sum that does not work, on the message that tells them
// what has just left their account.
//
// THE FALLBACK IS THE ONE-TIME RATE, not a throw. An order taken before
// price_per_lb_cents existed has null there and was genuinely sold at $2.00,
// which is what config.pricing.perPoundCents still says. Same shape as the
// confirmation in booking.js, deliberately: two sentences about one order's
// price must not read it two different ways.
function perPoundOf(order) {
  return subscription.perPound(
    (order && order.price_per_lb_cents) || config.pricing.perPoundCents
  );
}

// HOW A PRICE IS EXPLAINED TO THE CUSTOMER, IN ONE PLACE.
//
// THE MINIMUM IS A FLOOR ON THE WASH, AND A PAID OPTION SITS ON TOP OF IT.
// $25 is the minimum; fragrance-free at $2 does not make the minimum $27, and
// three different sentences here said it did or nearly did.
//
// There were three copies of this and only recordWeight's was right:
//
//   recordWeight    correct - named the floor, named the surcharge separately
//   settleWeight    asked `beforeDiscount > byWeight`, so a 13 lb load at
//                   $26 plus a $2 option came to $28, 28 > 26 was true, and
//                   the customer was told their order was UNDER a minimum
//                   they were comfortably over
//   doorTotalText   asked the right question and printed the wrong number -
//                   "under our $27.00 minimum" when the minimum is $25.00
//
// So this is the one that was already correct, lifted out, with the other two
// converging on it rather than being patched where they stood. Three copies of
// a sentence about somebody's bill is three chances to be wrong about it.
//
// `verb` is the only thing that differs between callers, and it is not
// cosmetic: with a promotion still to come off, "that is" is honest and "the
// total is" is not, because a lower number follows in the next clause.
function pricedSentence({ opening, byWeight, floor, surcharge, total, perPound, verb = 'that is' }) {
  const extras = surcharge > 0 ? ` plus ${money(surcharge)} for the wash options you chose` : '';

  if (floor > byWeight) {
    return `${opening}, which is under our ${money(floor)} minimum${extras}, so ${verb} ${money(total)}.`;
  }

  // OVER THE MINIMUM AND CARRYING AN EXTRA. The pounds have to be shown on
  // their own or the sum does not work: "$28.00 at $2.00 a pound" on 13 lb is
  // arithmetic the customer can see is wrong, and that is exactly what the two
  // broken copies sent.
  if (surcharge > 0) {
    return `${opening}, so that's ${money(byWeight)} at ${perPound}${extras} - ${money(total)} in total.`;
  }

  return `${opening}, so ${verb} ${money(total)} at ${perPound}.`;
}

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

// A WAIVED ORDER IS NEVER TOLD ABOUT A TOTAL. Neil, 11 September, on order
// #1975, which is free and can never be charged: the pickup text promised "the
// weight and the total", and there is no total to send. It promises the weight
// alone, and waivedWeighInText() below is the text that keeps that promise.
// WHY IT NO LONGER SAYS "WE'VE GOT YOUR LAUNDRY".
//
// It is sent when the driver taps Collected, which is now a minute BEFORE the
// card is charged - and if that is refused the bags stay on the step. "We've
// got your laundry!" followed by "we've left the bags where we found them" is
// the system contradicting itself inside two minutes, on the one occasion the
// customer is already annoyed. See fulfilment.loadVan().
//
// The rest of it is unchanged, including the rule underneath: a waived order is
// promised the weight and never a total.
function collectedMessage(order) {
  return order && order.payment_status === 'WAIVED'
    ? `We're here for your laundry. We'll text you the weight once it's on the scale.`
    : `We're here for your laundry. We'll text you the weight and the total once it's on the scale.`;
}

// What the laundromat's weigh-in texts on a waived order: the weight, and
// nothing about money. The priced version would say "the total is $59.60" for a
// demo order nobody will ever charge, or name a promotion and a $0.00 total -
// neither of which the pickup text said was coming.
function waivedWeighInText(pounds) {
  return `Your laundry weighed ${pounds} lb.`;
}

async function collect(order, { bagCount, by = {} } = {}) {
  // NO CARD, NO COLLECTION. Neil, 13 September: "no card means no collection,
  // she is off the route."
  //
  // The route already leaves these stops out - see dispatch.collectable() -
  // and this is the half that makes that a guard rather than a hidden button.
  // A screen that omits a control while the route behind it still fires is not
  // access control, which is the rule the reconciliation refusal already
  // follows: all the doors refuse together, or none of them do. The JSON API
  // reaches this same function.
  //
  // THREE REASONS, ONE OWNER, AND THIS DOOR ONLY KNEW ABOUT ONE OF THEM.
  //
  // It asked "have they got a card" and nothing else, while the board asked
  // that plus the refused show-up hold plus the sibling payment hold. So two
  // of the three states that take a stop off the round left the button behind
  // it working: the order page, a second phone and POST /ops/collected would
  // all have collected laundry the route had already decided we could not
  // bill for.
  //
  // dispatch.collectRefusal() is the predicate both doors read now, so they
  // cannot drift the way these two did. The sibling lookup is one query for
  // one order here - it is the same function the board runs over thirty at a
  // time, and a driver standing at a door is worth the round trip.
  //
  // IT FAILS OPEN ON THE LOOKUP ALONE. If the ledger cannot be read we collect
  // rather than strand a driver at a doorstep over a query - the same
  // direction dispatch.routableCheck() already fails, and the same reason the
  // card gate answers false where Stripe is switched off.
  const blocked = await dispatch
    .heldCustomerIds([order.customer_id])
    .catch((err) => {
      console.error(`Could not check the payment hold on #${order.order_number}: ${err.message}`);
      return new Set();
    });

  const refusal = dispatch.collectRefusal(order, blocked);

  if (refusal) {
    return { ok: false, error: refusal.reason, detail: refusal.detail };
  }

  // The one new fact: we have the bag. The turnaround was promised in the
  // confirmation; repeating it in every text is what Neil flagged.
  const result = await step(order, 'IN_PROCESS', (updated) => collectedMessage(updated), by);

  if (!result.ok) return result;

  // THE NEXT ONE IS BOOKED THE MOMENT THIS ONE IS IN THE VAN.
  //
  // Neil's ask: an upcoming order should appear as soon as the current one
  // becomes current, so somebody on a weekly pickup can always see that the
  // arrangement is still live. The nightly pass used to be the only thing that
  // booked them, one day ahead, which left the board empty six days a week.
  //
  // BEST EFFORT, AND SILENT. A driver at a door must never be stopped by the
  // booking of a pickup a week away, and recurring.bookNext() deliberately
  // sends no text - the customer hears about it in the ordinary evening
  // reminder, which carries the SKIP line for anything a schedule booked.
  if (result.order && result.order.from_schedule) {
    // The row, not just the id: bookPickup() reads the address, the preferences
    // and the schedules off it.
    const { data: customer } = order.customers
      ? { data: order.customers }
      : await db.from('customers').select('*').eq('id', order.customer_id).maybeSingle();

    if (customer) {
      await recurring
        .bookNext(customer, { after: result.order.pickup_date })
        .then((made) => {
          for (const next of made) {
            console.log(`  standing order: booked #${next.order_number} for ${next.pickup_date}`);
          }
        })
        .catch((err) => console.error(`Could not book the next standing pickup: ${err.message}`));
    }
  }

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

// NOTHING REACHES A LAUNDROMAT THAT WAS NOT LOADED AND PAID FOR AT THE DOOR.
//
// CLAUDE.md has said since the charge moved to the doorstep that "only a
// stamped order reaches the drop-off leg" - but that was true only because the
// ROUTE stopped offering the stop, and a screen that hides a control while the
// route behind it still fires is not a guard. This is the guard.
//
// `van_confirmed_at` is written by loadVan() and only after the card clears, so
// it is the one column that means "these bags were paid for and put in the
// van". An order that failed at a door has neither that stamp nor any business
// on a laundromat's floor: the bags are supposed to be on the customer's step.
//
// On #2068 the order sat IN_PROCESS after a decline path that had thrown
// halfway, and twenty-five minutes later it was dropped at Best Wash - which
// is the move this refuses.
function readyForPartner(order) {
  if (!order.van_confirmed_at) {
    return {
      ok: false,
      reason: 'invalid',
      detail:
        'These bags were never confirmed into the van, so they cannot be dropped at a laundromat. ' +
        'Load the van first.',
    };
  }

  if (order.authorization_refused_at) {
    return {
      ok: false,
      reason: 'invalid',
      detail:
        'The card was refused at the door on this order, so the bags belong with the customer, ' +
        'not at a laundromat. Ring the office.',
    };
  }

  return null;
}

async function dropAtPartner(order, { partnerId, by = {} } = {}) {
  const unweighed = needsWeightFirst(order);
  if (unweighed) return unweighed;

  const notLoaded = readyForPartner(order);
  if (notLoaded) return notLoaded;

  const result = await step(order, 'AT_PARTNER', null, by);
  if (!result.ok) return result;

  // WHICH laundromat, recorded at the moment the bag changes hands.
  //
  // Without it there is no way to answer "is one partner's scale consistently
  // heavier than ours", which is the whole reason for asking them to weigh it.
  // Optional, because a bag can be dropped somewhere we have not added yet and
  // refusing the drop over a missing dropdown would stop the route.
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

  // THE PAID OPTIONS, ON TOP OF THE MINIMUM.
  //
  // This is the path that actually prices orders today - settleWeight() has
  // always added the surcharge and has never run on a real order. So the +$2
  // options were advertised, agreed to, and then silently not charged: order
  // #1932 chose free & clear AND fragrance-free, $4.00 between them, and paid
  // exactly 35 lb at $2.00.
  //
  // AFTER the minimum, not inside it, matching settleWeight and for the same
  // reason: the minimum is what a small load of washing is worth, and an extra
  // we were asked for on top of it is separate work. Folding it in first would
  // mean a 6 lb order paid for its fragrance-free detergent out of the minimum
  // and we did that part for nothing.
  const surcharge = Math.max(0, Number(order.surcharge_cents || 0));
  const priceCents = Math.max(byWeight, floor) + surcharge;

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
    // ARRIVAL IS NOT CLEARED HERE ANY MORE, and the comment that used to sit
    // in this spot said why it once was: "weighing is the last thing that
    // happens at the customer's door". It stopped being true the day the clip
    // and the load became steps of their own. Both happen at that same door,
    // after the scale - so clearing arrival here threw the driver back to
    // "Take me there" for the house he was standing in front of, with a clip
    // in his hand.
    //
    // The moment he actually leaves is van_confirmed_at: the last bag aboard.
    // That is where the two flags are cleared now, in both places that stamp
    // it.
    .update({
      weight_lb: weight,
      price_cents: priceCents,
      weight_photo_path: photoPath,
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
  // WAS THE MINIMUM WHAT DECIDED THE PRICE. Compared against the weight alone,
  // NOT against the final total - the surcharge also makes priceCents exceed
  // byWeight, and reading that as "the minimum applied" would tell a 35 lb
  // customer their load was under our minimum.
  const minimumApplied = floor > byWeight;

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

  // NAME THE ADD-ONS, or the arithmetic does not work.
  //
  // "35 lb, so the total is $74.00 at $2.00 a pound" is a sum the customer can
  // do in their head and get $70. The same rule the discount already follows:
  // a total that does not match the obvious arithmetic reads as a mistake
  // unless the reason is in the same message.
  const howPriced = pricedSentence({
    opening,
    byWeight,
    floor,
    surcharge,
    total: priceCents,
    perPound: perPoundOf(order),
    // Nothing comes off after this one, so it really is the total.
    verb: 'the total is',
  });

  // What happens to the money, said as something still to come. Nothing is
  // taken here, so a sentence in the past tense would be a lie the customer
  // reads an hour before the charge actually lands.
  let settlement;
  if (owed === 0) {
    settlement = `You've already paid that, so there's nothing more to pay.`;
  } else if (card) {
    settlement = `We'll take it off your ${card}.`;
  } else {
    settlement = `We'll settle up with you.`;
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
  // NOT WHILE THEIR MONEY IS OUTSTANDING. Neil's lock, 14 September, reversing
  // the old deliver-and-chase rule for laundry we are already holding.
  //
  // The routing board leaves a held order off the delivery leg, and this is what
  // makes that a guard rather than a hidden button: the JSON API and the order
  // page both reach this function, and a screen that omits a control while the
  // route behind it still fires is not access control. The same shape as the
  // reconciliation refusal below.
  //
  // Retrieval off the laundromat is deliberately NOT gated - the bags come back
  // to us rather than living on somebody else's shelf. It is the doorstep this
  // stops at.
  if (dispatch.paymentHold(order)) {
    return {
      ok: false,
      reason: 'payment_hold',
      detail:
        `Order #${order.order_number} has ${money(dispatch.balance(order))} outstanding, so it does not go ` +
        `out for delivery. Take the payment, record cash against it, or waive it.`,
    };
  }

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
        'route. The customer is told it is on the way as soon as this moves, so ' +
        'it needs to be right before that goes out.',
    };
  }

  // AND THE WEIGHT HAS TO RECONCILE. A COUNT CANNOT CATCH THIS.
  //
  // Six bags and 113.5 lb came back off a laundromat against 60.0 lb collected
  // from the customer, every named sticker present and ticked. The order page
  // said plainly that laundry does not get heavier in a dryer and that somebody
  // else's bag was probably in the pile - and the driver's screen sent him
  // straight on to the delivery, because nothing was gated on the check.
  //
  // The comment above is right that named stickers beat a total at answering
  // WHICH bag is missing. It is wrong that they replace the weight: they say
  // nothing about what is inside them. All six of those bags were ours. The
  // extra 53 lb was not.
  //
  // So the run stops here. Neil's rule: the driver is told to contact an admin
  // and cannot move the order himself, and only an admin can release it - the
  // same shape as every other override in this system, because the value of a
  // check is that somebody other than the person in a hurry agreed to skip it.
  if (order.partner_id && !order.return_override_at) {
    const limits = await settings.weightLimits().catch(() => null);
    const check = tags.checkHandover(
      { wentIn: order.weight_lb, cameBack: order.return_weight_lb },
      limits
    );

    if (check && !check.ok) {
      return {
        ok: false,
        reason: 'weight_mismatch',
        check,
        detail: `${check.detail} This order cannot go out until an admin releases it.`,
      };
    }
  }

  // The one new fact: it is on the van. They already know the price from the
  // weigh text; repeating it here is what made the thread read like a bill.
  return step(order, 'OUT_FOR_DELIVERY', () => `Washed, folded and out for delivery today!`, by);
}

// --- The subscription offer, after the first paid delivery ---------------------
//
// Neil's locked rules, 21 September. After somebody's FIRST PAID delivery, if
// they have no plan, one text in his exact words asking whether they want one.
// The wording and the decision live in subscription.js; the facts, the send
// and the morning send for a late delivery live in subscription-offer.js,
// which the scheduler calls too. This is only the daytime door onto it.
//
// ITS OWN MESSAGE, NOT A LINE ON THE DELIVERY TEXT. "Here is your laundry" and
// "would you like this regularly" are two different things. A delivery in quiet
// hours is NOT dropped any more - Neil: "do not skip the subscription ask after
// 9pm" - it waits for the first tick after 8am.
//
// NEVER THROWS. The delivery has already happened and been texted.
async function offerSubscription(delivered, customer) {
  return subscriptionOffer.afterDelivery(delivered, customer);
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

  // NOT WHILE THEIR MONEY IS OUTSTANDING, AND THIS IS THE SECOND DOOR.
  //
  // Grok's review, 14 September. outForDelivery() stops a held order being put
  // in the van. This stops one that was ALREADY in the van when the charge
  // failed, and it is what makes the rule true of the JSON API and of anybody
  // who reaches the order page directly rather than through the run. A screen
  // that omits a control while the route behind it still fires is not a guard,
  // and that applies to a step just as much as to a stop.
  //
  // FIRST, BEFORE THE PHOTO. A driver who is going to be refused should not be
  // sent to take a picture on the way to being refused, and nothing belongs in
  // the bucket for a delivery that is not happening.
  //
  // It is NOT the weight hold below, which is two scales disagreeing and is
  // deliberately delivered anyway. This is money we are owed for laundry we are
  // holding, which is the one thing that does stop at the door.
  if (dispatch.paymentHold(order)) {
    return {
      ok: false,
      reason: 'payment_hold',
      detail:
        `Order #${order.order_number} has ${money(dispatch.balance(order))} outstanding, so it is not ` +
        `handed over. Take the payment, record cash against it, or waive it.`,
    };
  }
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

  const settled = Boolean(charge.ok);

  await events.record(order.id, {
    kind: 'PAYMENT',
    summary: charge.nothingDue
      ? 'Nothing left to charge'
      : charge.ok
        ? `Charged ${money(order.price_cents)}`
        : charge.needsCard
          ? `Could not charge ${money(order.price_cents)} - no card on file`
          : charge.declined
            ? `Card declined for ${money(order.price_cents)}`
            : `Not charged: ${charge.reason || 'the charge could not be attempted'}`,
    became: charge.ok ? 'PAID' : 'unpaid',
    by,
    reason: charge.ok || charge.nothingDue ? null : 'Delivered anyway and chased by text',
  });

  const result = await step(order, 'DELIVERED', () => {
    // THE DOOR AND THE PHOTO, TOGETHER, AND FIRST. Neil's locked rule, 21
    // September: the delivery text says the laundry is at the door and carries
    // the photo link. Those two are one fact - here it is, and here is where it
    // is - so they share a line and the link ends it rather than running into a
    // sentence.
    const photo = photoUrl ? ` Photo: ${photoUrl}` : '';

    // The total was already said at the scale, so it is only repeated when
    // something went wrong with it - a real thread ended up quoting the same
    // figure four times. When there is something to say it gets its own block,
    // so the photo link above it never looks like it carries on into a sentence.
    let price = '';
    if (charge.nothingDue) {
      price = '';
    } else if (charge.ok) {
      price = `${money(order.price_cents)} charged to your ${billing.describeCard(order.customers) || 'card'}.`;
    } else if (charge.needsCard) {
      price = `We don't have a card on file. ${money(order.price_cents)} is outstanding. Add one ${billing.cardDestination(order, charge.setupUrl)}`;
    } else if (charge.declined) {
      price = `Your card was declined. ${money(order.price_cents)} is still outstanding. Update it ${billing.cardDestination(order, charge.setupUrl)}`;
    }

    // NO "SAME DAY" AND NO OFFER ON THE END. Both came out on Neil's locked
    // rules, 21 September.
    //
    // "Delivered same day, no extra charge!" is wording he has ruled out
    // everywhere. What we promise is the day after pickup, and announcing the
    // times we beat it teaches people to expect it.
    //
    // The standing-order question that used to ride on the end of this message
    // is now its own text in his exact words, sent once, after the first PAID
    // delivery only - see offerSubscription() below. The old one asked on every
    // delivery to anybody without a schedule, free ones included, and offered
    // two frequencies where there are three.
    //
    // A BLANK LINE, NOT A SPACE, before anything that follows the photo link -
    // a URL running straight into a sentence reads as though the link carries
    // on. A newline is in the GSM alphabet, so it does not push the message
    // into UCS-2.
    const opener = `Delivered! Your laundry is at your door.`;

    return price ? `${opener}${photo}\n\n${price}` : `${opener}${photo}`;
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

  // After everything else, so nothing about the offer can get in the way of
  // the delivery itself. It never throws.
  result.subscriptionOffer = await offerSubscription(result.order, order.customers);

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
// finished. Two customers on the same route had deadlines eight hours apart
// and neither matched what they were told.
//
// Now both are due by the END OF THE DAY after we collected. So the time a bag
// has is exactly "the rest of today, plus the whole of tomorrow", and a late
// pickup honestly has less of it.
//
// IT WAS THE END OF THE LAST PICKUP WINDOW UNTIL 13 SEPTEMBER, which let the
// hours we offer to COLLECT in decide when a DELIVERY was late. Neil, reading
// "9h 51m left" on #2060: "we have the whole day 2 to drop it off... not until
// we are closed. we have until day 2 is over." See booking.endOfPromiseDay().
//
// Returns null for anything not yet collected or already delivered, because a
// countdown only means something while we are holding somebody's clothes.

function dueAt(order) {
  if (!order.collected_at) return null;

  // Which day it was collected on, in New Jersey rather than UTC. Past 8pm
  // Eastern the two disagree, and using UTC would move a Monday evening
  // pickup's deadline forward a whole day.
  const collectedOn = booking.serviceDateOf(order.collected_at);

  return booking.instantAt(booking.addDays(collectedOn, 1), booking.endOfPromiseDay());
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
// ---------------------------------------------------------------------------
// THE LAUNDROMAT'S SCALE, ON AN ORDER THAT IS ALREADY PAID FOR.
//
// Since the charge moved to the doorstep (see loadVan), every order that
// reaches a laundromat has already been priced and charged on our scale. Their
// figure therefore no longer decides what the CUSTOMER pays - but it still
// decides two things, and both would have been silently lost if settleWeight()
// simply returned early on an already-settled order:
//
//   what we pay them   partners.partnerBillFor(), off their own weight. It is
//                      their invoice and it was never the customer's price.
//   whether they agree  a gap past the tolerance is the whole reason their
//                      weight is mandatory. It used to HOLD the charge; there
//                      is no charge left to hold, so it raises an issue and a
//                      person looks.
//
// NOTHING HERE MOVES MONEY. It cannot re-price, cannot charge, cannot refund.
// An order that was billed $162.76 at a doorstep stays billed $162.76 even if
// the laundromat reads it 3 lb heavier, because the customer was told a total
// while the driver was standing in front of them and a figure that changes
// afterwards is not a price.
// ---------------------------------------------------------------------------
async function recordPartnerScale(order, { by = {} } = {}) {
  const ours = order.weight_lb == null ? null : Number(order.weight_lb);
  const theirs = order.partner_weight_lb == null ? null : Number(order.partner_weight_lb);

  // Nothing to compare. The laundromat leg is optional and plenty of orders
  // never have one.
  if (ours == null || theirs == null) return { ok: true, compared: false };

  // Already done. This runs on every bag the laundromat weighs, so the last one
  // must not redo what the one before it recorded.
  if (order.partner_bill_settled_at) return { ok: true, already: true };

  const limits = await settings.weightLimits();
  const check = partners.compareWeights({ weight_lb: ours, partner_weight_lb: theirs }, limits);

  const { error } = await db
    .from('orders')
    .update({
      weight_band: check.band,
      partner_bill_lb: partners.partnerBillFor(check),
      partner_bill_settled_at: new Date().toISOString(),
    })
    .eq('id', order.id);

  if (error) throw error;

  await events.record(order.id, {
    kind: 'PARTNER_WEIGHT',
    summary:
      `Laundromat read ${theirs} lb against our ${ours} lb` +
      (check.overThreshold ? ` - ${check.absolute.toFixed(1)} lb apart, past the ${check.tolerance.toFixed(1)} we allow` : ' - within tolerance'),
    was: `${ours} lb ours`,
    became: `${theirs} lb theirs`,
    by,
    reason: check.overThreshold ? 'The customer was already charged on our scale; this is for a person to look at' : null,
  });

  if (check.overThreshold) {
    await issues
      .raise({
        customer: order.customers || null,
        order,
        reason:
          `Scales disagree on #${order.order_number}: we read ${ours} lb, the laundromat ${theirs} lb, ` +
          `${check.absolute.toFixed(1)} lb apart. The customer was charged on ours at the door and nothing has changed for them.`,
      })
      .catch((err) => console.error(`Could not raise a scales issue for ${order.id}: ${err.message}`));
  }

  return { ok: true, compared: true, band: check.band, overThreshold: check.overThreshold };
}

async function settleWeight(order, { by = {}, chosenLb = null, partnerLb = null, note = null } = {}) {
  if (order.weight_settled_at) {
    // ALREADY PRICED AND ALREADY PAID, because since loadVan() that happens at
    // the customer's door. Their laundromat's figure still has two jobs though
    // - what we owe them, and whether the two scales agree - and returning flat
    // here would have quietly dropped both.
    const partnerScale = await recordPartnerScale(order, { by }).catch((err) => {
      console.error(`Could not record the laundromat scale on ${order.id}: ${err.message}`);
      return null;
    });

    return { ok: true, already: true, priceCents: order.price_cents, partnerScale };
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

  // THE CARD IS CHARGED HERE, AT THE WEIGH-IN. Neil's call, and it reverses
  // the earlier one that collected at the door.
  //
  // The reasoning that moved it: by the time both scales have spoken there is
  // nothing left to find out. The laundromat's figure is mandatory now, so the
  // amount cannot change between here and the doorstep, and the two rules
  // above already decided what happens when the scales disagree - inside the
  // tolerance we bill the higher of the two, outside it nothing is charged at
  // all until a person has looked. Waiting until the doorstep to take money
  // that was settled hours earlier only moves a decline to the worst possible
  // moment: a driver standing on a step with an armful of clean laundry and no
  // way to fix it.
  //
  // A DECLINE STILL DOES NOT STOP THE DELIVERY. It is a text, not a hold on
  // somebody's clothes. The doorstep charge stays as a backstop for the orders
  // that never reach here - the ones we wash ourselves, which have no
  // laundromat weigh-in to trigger this.
  const customer = order.customers;
  const withCustomer = { ...settled, customers: customer };

  const opening = `Your laundry weighed ${billable} lb`;
  const base = pricedSentence({
    opening,
    byWeight,
    floor,
    surcharge,
    total: beforeDiscount,
    perPound: perPoundOf(order),
  });

  // SAY WHAT CAME OFF. A total that is lower than the arithmetic the customer
  // can do themselves reads as a mistake unless the reason is in the same
  // message.
  const howPriced = deal
    ? `${base} ${money(discountCents)} off for ${deal.promotion.name}, so the total is ${money(priceCents)}.`
    : `${base.replace(/that is /, 'the total is ')}`;

  // Nothing to take is not a failure. A waived order, an order somebody has
  // already settled by hand, and a promotion that took the total to zero all
  // land here and none of them should touch a card.
  const charge =
    priceCents > 0 &&
    settled.payment_status !== 'PAID' &&
    settled.payment_status !== 'WAIVED'
      ? await billing.chargeOrder(withCustomer, customer).catch((err) => {
          // Charging must never take the weigh-in down with it. The price is
          // settled and recorded above; the money is a separate thing that can
          // be retried from the order page.
          console.error(`Could not charge ${order.id} at the weigh-in: ${err.message}`);
          return { ok: false, failed: true };
        })
      : { ok: true, nothingDue: true };

  await events.record(order.id, {
    kind: 'PAYMENT',
    // SAY WHICH FAILURE IT WAS. "Card declined" was written for every
    // unsuccessful charge, including the one where no card was ever presented
    // because payments are switched off - so an order that could not possibly
    // have been charged read as a customer's card being refused, and the
    // change log sent somebody looking at the wrong problem.
    summary: charge.nothingDue
      ? 'Nothing to charge'
      : charge.ok
        ? `Charged ${money(priceCents)} at the weigh-in`
        : charge.needsCard
          ? `Could not charge ${money(priceCents)} - no card on file`
          : charge.declined
            ? `Card declined for ${money(priceCents)}`
            : `Not charged: ${charge.reason || 'the charge could not be attempted'}`,
    became: charge.ok ? 'PAID' : 'unpaid',
    by,
    reason: charge.ok || charge.nothingDue ? null : 'Told them straight away and the delivery goes ahead',
  });

  if (customer) {
    // ONE MESSAGE, NOT TWO. The price and what happened to the card are the
    // same piece of news to the person reading it, and a decline arriving as a
    // separate text a second later reads like something broke.
    const card = billing.describeCard(customer);

    let money_ = '';
    if (charge.nothingDue) {
      money_ = '';
    } else if (charge.ok) {
      money_ = ` Charged to your ${card || 'card'}.`;
    } else if (charge.needsCard) {
      // WHERE WE SEND THEM DEPENDS ON WHERE THEY CAME IN. A customer who did
      // everything on the website is pointed back at it rather than handed a
      // token to tap in a text. See billing.cardDestination().
      money_ = ` We don't have a card on file. Add one ${billing.cardDestination(settled, charge.setupUrl)}`;
    } else if (charge.declined) {
      money_ = ` Your card was declined. Update it ${billing.cardDestination(settled, charge.setupUrl)}`;
    } else {
      // Payments switched off, or the charge threw. Say what they were always
      // told rather than inventing a problem they cannot act on.
      money_ = card
        ? ` We'll take it off your ${card}.`
        : ` We'll settle up with you.`;
    }

    // WAIVED: the weight and nothing else, the one thing the pickup text said
    // was coming. See collectedMessage().
    const text = settled.payment_status === 'WAIVED' ? waivedWeighInText(billable) : `${howPriced}${money_}`;

    await sendAndLog(customer.phone, text, customer.id);
  }

  return {
    ok: true,
    priceCents,
    billable,
    basis,
    charged: Boolean(charge && charge.ok && !charge.nothingDue),
    declined: Boolean(charge && charge.declined),
  };
}

// ---------------------------------------------------------------------------
// THE BAGS GO IN THE VAN, AND THE CARD IS CHARGED BEFORE THEY DO.
//
// Neil, 12 September, after order #2060 was refused $84.00 while three bags
// were already on a laundromat floor: "the card should be charged after I or
// the driver enters the weight... if the card is declined... we left it where
// we found it... we can pick up same time tomorrow."
//
// THIS IS THE CHARGE POINT NOW, and it is the fourth place it has been. Our own
// scale, then the doorstep at delivery, then the laundromat's weigh-in, now
// here. What moved it is the one thing the other three could not do: this is
// the last moment at which saying no costs us nothing. Past this line we are
// holding somebody's laundry, and every option after that is bad - hand it back
// from a laundromat, wash it for free, or keep it and argue.
//
// WHAT IT COSTS, SAID PLAINLY: the customer is billed on OUR scale. The
// laundromat has not seen the bags yet, so "the higher of the two scales"
// cannot be asked here, and Neil's rule that their figure is half of what bills
// is retired with his agreement. Their weight still decides what we PAY them
// and still raises an issue when the two disagree - it simply no longer moves
// the customer's price. On #2060 that is $162.76 against $168.00, in the
// customer's favour, and it is the scale they watched the driver use.
//
// CHARGED FIRST, WRITTEN SECOND. The price is worked out in memory and the card
// is tried before a single figure is saved. That ordering is the whole reason
// this is safe to unwind: a refusal leaves no settled price, no spent
// promotion, and nothing to undo but the physical pickup. Settling first and
// rolling back would mean un-redeeming a promotion, which is the one operation
// here with no honest reverse.
// ---------------------------------------------------------------------------
// FINISH PICKUP: THE ONE ORDER-LEVEL TAP AT A DOORSTEP.
//
// Neil's model, 16 September: the van is not a custody state, it is
// transportation. Confirm custody transfers, identity, measurements and
// exceptions - never movement into or out of a vehicle.
//
// WHAT THIS IS NOT: a new way to charge a card. It is loadVan() with the
// bookkeeping the driver used to do by hand done for him. Every rule underneath
// is untouched - the price is worked out in memory, the card is charged, and
// only then is van_confirmed_at written, so a refused card still leaves the
// bags on the step with the pickup not complete.
//
// WHAT IT DOES FOR HIM:
//
//   the count      bag_count is how many bags he scanned, not a number he
//                  typed before he had scanned any
//   the clips      already assigned by the weigh route; confirmed here rather
//                  than tapped per bag
//   the loading    loaded_at is stamped for every bag at once. The column
//                  survives because other things read it; the TAP does not,
//                  because "it is in the van" is three feet of walking no
//                  screen can verify
//
// IT REFUSES A HALF-WEIGHED LOAD. The price is the sum of the bags, so one
// unweighed bag is a charge short by a bag - and unlike the old flow, where
// the sequence physically hid the next step, nothing stops a driver reaching
// this button early.
async function finishPickup(order, { by = {} } = {}) {
  if (order.van_confirmed_at) return { ok: true, already: true };

  const labels = (await bags.forOrder(order.id, 'PICKUP')).filter((l) => !l.sticker_seq);

  if (!labels.length) {
    return {
      ok: false,
      reason: 'invalid',
      detail: 'Scan a bag before finishing the pickup. There is nothing to take yet.',
    };
  }

  const unweighed = labels.filter((l) => l.weight_lb == null);
  if (unweighed.length) {
    const which = unweighed.map((l) => l.code).join(', ');
    return {
      ok: false,
      reason: 'invalid',
      detail: `${unweighed.length} bag${unweighed.length === 1 ? ' has' : 's have'} no weight yet (${which}). Weigh ${unweighed.length === 1 ? 'it' : 'them'} first.`,
    };
  }

  // THE COUNT IS WHAT HE SCANNED. Written before loadVan() reads it, because
  // loadVan refuses an order whose bag_count does not match what is weighed -
  // that guard is worth keeping and this is what satisfies it honestly.
  if (Number(order.bag_count || 0) !== labels.length) {
    const { error } = await db
      .from('orders')
      .update({ bag_count: labels.length })
      .eq('id', order.id);

    if (error) throw error;
    order = { ...order, bag_count: labels.length };
  }

  // The internal columns, stamped together rather than one tap at a time. Both
  // are still read - loaded_at by the run and the load-out pass, clipped_at by
  // the clip pool - so they are kept and simply stopped being questions.
  const now = new Date().toISOString();

  for (const label of labels) {
    const patch = {};
    if (!label.clipped_at && label.clip_number != null) patch.clipped_at = now;
    if (!label.loaded_at) patch.loaded_at = now;
    if (!Object.keys(patch).length) continue;

    const { error } = await db.from('bag_labels').update(patch).eq('id', label.id);
    if (error) throw error;
  }

  return loadVan({ ...order, bag_count: labels.length }, { by });
}

async function loadVan(order, { by = {} } = {}) {
  const labels = await bags.forOrder(order.id, 'PICKUP');
  const expected = Number(order.bag_count || 0);

  const weighed = labels.filter((l) => l.weight_lb != null).length;
  if (!expected || weighed < expected) {
    return {
      ok: false,
      detail: `${weighed} of ${expected || '?'} bags are weighed. Finish those before loading.`,
    };
  }

  // AND ACTUALLY IN THE VAN. The button on the list is disabled until they are
  // all aboard; a disabled button whose route still fires is not a guard.
  const aboard = labels.filter((l) => l.loaded_at).length;
  if (aboard < expected) {
    return {
      ok: false,
      detail: `${expected - aboard} bag${expected - aboard === 1 ? ' is' : 's are'} not in the van yet.`,
    };
  }

  // Already done. A double tap is not an error and must never charge twice.
  if (order.van_confirmed_at) return { ok: true, already: true };

  const customer = order.customers || null;
  const weight = Number(order.weight_lb || 0);

  // --- What it comes to, in memory ----------------------------------------
  const rate = order.price_per_lb_cents || config.pricing.perPoundCents;
  const floor = order.minimum_cents != null ? order.minimum_cents : 0;
  const surcharge = Math.max(0, Number(order.surcharge_cents || 0));

  const byWeight = Math.round(weight * rate);
  // Paid wash options sit on top of the minimum, not inside it - the same order
  // settleWeight() has always used, because the minimum is what a small load is
  // worth and an extra we were asked for is separate work.
  const beforeDiscount = Math.max(byWeight, floor) + surcharge;

  const deal = customer
    ? await promotions.discountFor(customer, order, beforeDiscount).catch((err) => {
        console.error(`Could not work out a discount for ${order.id}: ${err.message}`);
        return null;
      })
    : null;

  const discountCents = deal ? deal.cents : 0;
  const priceCents = Math.max(0, beforeDiscount - discountCents);

  // --- The card, before anything is written --------------------------------
  //
  // THROUGH THE HOLD, WHICH IS WHERE THE $25 IS SPENT. chargeAtTheDoor() takes
  // what fits out of the authorization placed when the pickup was booked and
  // charges only the difference, so a customer sees one $25 hold turn into one
  // charge rather than a hold plus a full-price charge beside it. An order with
  // no live hold - every order taken before this existed - falls straight
  // through to the ordinary charge it has always had.
  const charge =
    order.payment_status === 'WAIVED'
      ? { ok: true, waived: true }
      : await billing.chargeAtTheDoor(order, customer, { totalCents: priceCents }).catch((err) => {
          console.error(`Could not charge ${order.id} at the door: ${err.message}`);
          return { ok: false, threw: true, reason: err.message };
        });

  // ONLY A REFUSAL LEAVES BAGS ON A DOORSTEP, AND A THROWN ERROR IS NOT ONE.
  //
  // This used to read `if (!charge.ok)`, which swept up three different things
  // and treated all of them as "the customer's card said no": a real refusal, a
  // sandbox with no Stripe key, and any exception at all - including one raised
  // AFTER the money had moved.
  //
  // That last one happened, on #2068. The card paid $25 off the hold and $13 on
  // top, and a TypeError in the bookkeeping a line later turned a fully paid
  // order into a doorstep decline: the customer's tags retired, the pickup put
  // back to tomorrow, and a text queued telling them their card was refused.
  //
  // So the decline path is now reachable only when the card genuinely said no -
  // `declined` from the issuer, or `needsCard` because there is nothing to
  // charge. Everything else keeps the bags in the van and asks a person.
  if (!charge.ok && (charge.declined || charge.needsCard)) {
    return declinedAtTheDoor(order, { by, customer, labels, weight, priceCents, charge });
  }

  if (!charge.ok) {
    return couldNotCharge(order, { by, customer, priceCents, charge });
  }

  // --- It cleared. Now it is real ------------------------------------------
  const { error } = await db
    .from('orders')
    .update({
      billable_weight_lb: weight,
      price_cents: priceCents,
      discount_cents: discountCents,
      promotion_id: deal ? deal.promotion.id : null,
      weight_settled_at: new Date().toISOString(),
      weight_held_at: null,
      van_confirmed_at: new Date().toISOString(),
      // He is leaving the door, so the arrival flags go here. Left set, the run
      // would think he had arrived at a laundromat he has not driven to yet.
      arrived_at: null,
      navigating_at: null,
    })
    .eq('id', order.id);

  if (error) throw error;

  if (deal) {
    await promotions
      .redeem(deal.grantId, order.id)
      .catch((err) => console.error(`Could not redeem a promotion on ${order.id}: ${err.message}`));
  }

  const clips = bags.clipsFor(labels);

  await events.record(order.id, {
    kind: 'STATUS',
    summary:
      `${expected} bag${expected === 1 ? '' : 's'} loaded into the van` +
      (clips.length ? ` on clip${clips.length === 1 ? '' : 's'} ${clips.join(', ')}` : ''),
    by,
  });

  await events.record(order.id, {
    kind: 'PRICE',
    summary:
      `Priced ${money(priceCents)} on ${weight} lb at the door` +
      (deal ? `, less ${money(discountCents)} for ${deal.promotion.name}` : ''),
    became: money(priceCents),
    by,
  });

  await events.record(order.id, {
    kind: 'PAYMENT',
    summary: charge.waived
      ? 'Waived, nothing charged'
      : charge.nothingToCharge
        ? 'Nothing to charge - the promotion covered it'
      : charge.alreadyPaid
        ? 'Already paid'
        : charge.fromHold && charge.capturedCents < priceCents
          ? `Charged ${money(priceCents)} at the door - ${money(charge.capturedCents)} off the hold, ` +
            `${money(priceCents - charge.capturedCents)} on the card`
          : charge.fromHold
            ? `Charged ${money(priceCents)} at the door, taken off the hold`
            : `Charged ${money(priceCents)} at the door`,
    became: charge.waived ? 'WAIVED' : charge.nothingToCharge ? 'FREE' : 'PAID',
    by,
  });

  if (customer) {
    // A WAIVED ORDER IS TOLD THE WEIGHT AND NOTHING ELSE, which is the promise
    // the pickup text made it.
    // AN ORDER THAT COMES TO NOTHING IS TOLD THE WEIGHT AND NOTHING ELSE, the
    // same as a waived one and for the same reason: they were promised
    // "nothing to pay", and a text reading "the total is $0.00. Charged to your
    // Visa." reads as a mistake against that promise.
    const text =
      charge.waived || charge.nothingToCharge
        ? waivedWeighInText(weight)
        : doorTotalText({
            weight,
            byWeight,
            floor,
            surcharge,
            beforeDiscount,
            priceCents,
            deal,
            customer,
            perPound: perPoundOf(order),
          });

    await sendAndLog(customer.phone, text, customer.id).catch((err) =>
      console.error(`Could not text the door total for ${order.id}: ${err.message}`)
    );
  }

  return {
    ok: true,
    priceCents,
    weight,
    charged: !charge.waived && !charge.alreadyPaid && !charge.nothingToCharge,
  };
}

// WHAT THEY READ WHEN IT CLEARED AT THE DOOR. The weight, what it comes to, and
// what came off. Written here rather than by the AI, like every message about
// money.
// `perPound` is passed in rather than read off an order, because this one is
// built from figures worked out in memory BEFORE anything is written - which is
// the whole design of the doorstep charge. The caller has the order and hands
// the rate over with the rest of the sums.
// `floor` and `surcharge` are passed in beside the sums for the same reason
// `perPound` is: this text is built from figures worked out in memory before
// anything is written, which is the whole design of the doorstep charge. It
// used to be handed a `minimumApplied` boolean instead, and then printed
// beforeDiscount as though that were the minimum - so a 13 lb load with a $2
// wash option read "under our $27.00 minimum" when the minimum is $25.00.
function doorTotalText({ weight, byWeight, floor, surcharge, beforeDiscount, priceCents, deal, customer, perPound }) {
  const card = billing.describeCard(customer) || 'card';
  const opening = `Your laundry weighed ${weight} lb`;

  const base = pricedSentence({
    opening,
    byWeight,
    floor,
    surcharge,
    total: beforeDiscount,
    perPound,
  });

  // SAY WHAT CAME OFF. A total lower than the arithmetic somebody can do in
  // their head reads as a mistake unless the reason is in the same message. The
  // promotion's blurb, never its internal name.
  const off = deal
    ? ` ${deal.promotion.blurb || 'Your discount'} takes ${money(deal.cents)} off, so the total is ${money(priceCents)}.`
    : '';

  return `${base}${off} Charged to your ${card}. Back with you the ${site.turnaround}.`;
}

// ---------------------------------------------------------------------------
// THE CARD WAS REFUSED AND THE BAGS STAY WHERE THEY ARE.
//
// Neil's rule, and it is the right one: we have not taken the laundry yet, so
// declining to take it is not holding anybody's property. That is the whole
// difference between this and a decline at delivery, where CLAUDE.md is
// emphatic that the clothes go back and we chase by text - there we are already
// holding them, and keeping somebody's clothes over a card is a bad look and
// legally murky. Here there is nothing to hold.
//
// It undoes the pickup rather than leaving it half done. The tags come off, the
// clips go back in the pool, and the order returns to awaiting collection so
// tomorrow is an ordinary pickup rather than a repair job. What stays is the
// payment record: an order on tomorrow's board reading FAILED is the most
// useful thing that board can say about it.
// ---------------------------------------------------------------------------
// WHAT THEY READ WHEN THE BAGS ARE LEFT. Neil's own words, 12 September:
// "we tried to pick up your laundry. It weighed this much. However, the card
// was declined. We left it where we found it. Please update the payment method,
// and we can pick up same time tomorrow."
//
// Every fact in it is one they can check on their own step: the weight the
// driver just read out, the total that follows from it, and the bags still
// sitting there. Nothing is asked of them that they cannot do from the message.
function leftAtDoorText({ weight, priceCents, needsCard, destination, keptCents = 0 }) {
  const problem = needsCard
    ? `We don't have a card on file, so we've left the bags where we found them. Add one ${destination}`
    : keptCents > 0
      ? // THE $25 IS SAID OUT LOUD, because it is the one thing in this message
        // they did not expect and the one thing their statement will show. Neil:
        // the customer paid for the trip, not for laundry we never took - so the
        // sentence says which of the two happened, and never calls it credit
        // towards the wash, because it is not.
        `Your card was declined for the balance, so we've left the bags where we found them. ` +
        `The ${money(keptCents)} held for the trip has been charged; the wash has not. ` +
        `Update your card ${destination}`
      : `Your card was declined, so nothing has been taken and we've left the bags where we found them. Update it ${destination}`;

  return (
    `We came for your laundry and it weighed ${weight} lb, which comes to ${money(priceCents)}. ` +
    `${problem} We can come back same time tomorrow.`
  );
}

// SOMETHING BROKE, AND WE DO NOT KNOW WHOSE FAULT IT IS.
//
// Not a refusal: the card never said no. An exception on our side, or payments
// switched off entirely. The money may or may not have moved, and that is the
// whole reason this is its own outcome rather than a decline.
//
// So it does the one thing that is safe under both readings: it changes nothing
// the customer can see. The bags stay in the van, the tags stay live, the
// pickup is not put back to tomorrow, and NOBODY IS TEXTED - because "your card
// was refused" is a lie if it cleared, and the customer cannot act on a bug in
// our code either way. A person is paged, and the driver is told to ring in.
async function couldNotCharge(order, { by, customer, priceCents, charge }) {
  await events.record(order.id, {
    kind: 'PAYMENT',
    summary: `Could not take ${money(priceCents)} at the door`,
    became: 'unknown',
    by,
    reason:
      `The card was not refused - the charge could not be completed. ` +
      `${charge.reason || 'No reason given.'} Check Stripe before charging again.`,
  });

  await issues
    .raise({
      customer,
      order,
      reason:
        `Door charge of ${money(priceCents)} on #${order.order_number} did not complete, and it was ` +
        `NOT a decline. ${charge.reason || ''} The bags are still in the van and the customer has not ` +
        `been told anything. Check Stripe for a payment before charging again.`.trim(),
    })
    .catch((err) => console.error(`Could not raise an issue for ${order.id}: ${err.message}`));

  return {
    ok: false,
    couldNotCharge: true,
    priceCents,
    detail:
      `${money(priceCents)} did not go through, and the card was NOT refused. ` +
      `Keep the bags in the van and ring the office - do not try again from here.`,
  };
}

async function declinedAtTheDoor(order, { by, customer, labels, weight, priceCents, charge }) {
  const clips = bags.clipsFor(labels);
  const kept = Math.max(0, Number(charge.keptCents || 0));

  // A PAID ORDER CANNOT BE DECLINED, AND THIS IS THE BACKSTOP THAT SAYS SO.
  //
  // Read back from the database rather than trusting the row we loaded before
  // the charge, because the charge is what would have changed it. On #2068 the
  // card had already paid in full by the time this function was called, and
  // nothing here asked.
  //
  // Belt and braces against the caller: loadVan() now only reaches this on a
  // real refusal, and this refuses to strand a customer whose money we hold
  // however it got here.
  const { data: fresh } = await db
    .from('orders')
    .select('payment_status, paid_at, price_cents, amount_paid_cents')
    .eq('id', order.id)
    .maybeSingle();

  if (fresh && (fresh.payment_status === 'PAID' || fresh.payment_status === 'WAIVED')) {
    console.error(
      `Refused to leave #${order.order_number} at the door: it is ${fresh.payment_status}.`
    );

    await events.record(order.id, {
      kind: 'PAYMENT',
      summary: 'A decline was refused because the order is already paid',
      became: fresh.payment_status,
      by,
      reason:
        'The doorstep decline path was reached on an order whose card had already paid. ' +
        'Nothing was changed and the customer was not texted. This is a bug - report it.',
    });

    await issues
      .raise({
        customer,
        order,
        reason:
          `#${order.order_number} reached the doorstep decline path while ${fresh.payment_status}. ` +
          `The bags stayed in the van and nobody was texted. Report this.`,
      })
      .catch((err) => console.error(`Could not raise an issue for ${order.id}: ${err.message}`));

    return { ok: true, alreadyPaid: true, priceCents };
  }

  await events.record(order.id, {
    kind: 'PAYMENT',
    summary: charge.needsCard
      ? `No card on file for ${money(priceCents)} at the door`
      : `Card refused ${money(priceCents)} at the door`,
    became: 'unpaid',
    by,
    reason: 'Bags left at the door and the pickup put back to tomorrow',
  });

  // WHAT WE KEPT, ON ITS OWN LINE, because it is a different kind of fact from
  // the refusal above it. Money did move, and the change log has to say so or
  // the first person to read this order alongside a bank statement finds $25
  // nothing here accounts for.
  if (kept > 0) {
    await events.record(order.id, {
      kind: 'PAYMENT',
      summary: `Kept ${money(kept)} for the trip`,
      became: money(kept),
      by,
      reason: 'The driver came out and weighed the bags; the wash did not happen',
    });
  }

  // THE CARD CANNOT FUND THIS PICKUP, so tomorrow's is not confirmed either.
  //
  // This is what makes the message honest. It says "update the payment method
  // and we can pick up same time tomorrow", and collectable() now holds us to
  // it: the rebooked stop stays off the round until a card accepts the hold,
  // rather than sending the same van to the same door for the same refusal.
  // Saving a card places a fresh hold and clears this, so the customer's own
  // action is what puts them back on.
  //
  // It is not hidden. board() returns these as `uncollectable` and the routing
  // screen names every one of them in red, which is the standing rule: a stop
  // that silently vanishes reads as the board losing one.
  await db
    .from('orders')
    .update({
      authorization_intent_id: null,
      authorization_refused_at: new Date().toISOString(),
      authorization_refused_reason: charge.needsCard
        ? 'No card on file at the door.'
        : 'The card was refused at the door.',
    })
    .eq('id', order.id)
    .then(({ error }) => {
      if (error) console.error(`Could not park ${order.id} after the door: ${error.message}`);
    });

  // THE CLIPS COME OFF. They are physical stock that lives in the van, and one
  // left out of the pool is one the next driver cannot use.
  await bags
    .unclipOrder(order.id)
    .catch((err) => console.error(`Could not return the clips on ${order.id}: ${err.message}`));

  // AND THE TAGS STAY ON, WHICH REVERSES WHAT THIS DID UNTIL NOW.
  //
  // It used to call bags.releaseOrder() - the same function DELIVERY calls to
  // retire a label. That is what stops /o/<code> resolving, so three stickers
  // stuck to three bags on somebody's doorstep read as dead, and on /ops/labels
  // they counted as EXPIRED, which is the word for a finished delivery.
  //
  // Neil's rule: dead is only for a finished delivery. Nothing was delivered
  // here and nothing was even collected - the bags are on the step with our
  // stickers on them, and the same van comes back for the same order tomorrow.
  // The honest state is a live tag pointing at a pickup that has not happened
  // yet, which is exactly what the order now says.

  await orders.uncollect(order, {
    by,
    reason: charge.needsCard ? 'No card on file' : 'Card was declined at the door',
  });

  // THEM FIRST. They are behind a door with their laundry still on the step,
  // and they are the only person who can fix it.
  if (customer) {
    const text = leftAtDoorText({
      weight,
      priceCents,
      needsCard: Boolean(charge.needsCard),
      destination: billing.cardDestination(order, charge.setupUrl),
      keptCents: kept,
    });

    await sendAndLog(customer.phone, text, customer.id).catch((err) =>
      console.error(`Could not text the doorstep decline for ${order.id}: ${err.message}`)
    );
  }

  // AND A PERSON HAS TO KNOW. The driver is told by what comes back from here;
  // this is what reaches the office, because a pickup that did not happen is
  // somebody's morning tomorrow.
  await issues
    .raise({
      customer,
      order,
      reason:
        `Card refused ${money(priceCents)} at the door on #${order.order_number}. ` +
        `${weight} lb left with the customer; pickup put back to tomorrow.` +
        (kept > 0 ? ` ${money(kept)} kept for the trip.` : ''),
    })
    .catch((err) => console.error(`Could not raise an issue for ${order.id}: ${err.message}`));

  return {
    ok: false,
    declined: true,
    leftAtTheDoor: true,
    priceCents,
    weight,
    clips,
    keptCents: kept,
    detail:
      `${money(priceCents)} was refused. Leave the bags where you found them` +
      (clips.length
        ? ` - take clip${clips.length === 1 ? '' : 's'} ${clips.join(', ')} off first.`
        : '.') +
      ` They have been texted and the office knows.`,
  };
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
  collectedMessage,
  waivedWeighInText,
  // Exported so a test can read the sentence a customer actually gets. The
  // first version of that test re-declared this function inside itself, which
  // meant the behavioural half was checking a copy: the predicate could be
  // broken in here and every assertion still passed. Same reason labelState
  // and readyForPartner are exported.
  pricedSentence,
  settleWeight,
  loadVan,
  finishPickup,
  recordPartnerScale,
  doorTotalText,
  leftAtDoorText,
  reconcileReturn,
  updateWeightEstimate,
  collect,
  dropAtPartner,
  // Pure, and exported so the rule can be tested without a van, a laundromat
  // or a database.
  readyForPartner,
  markReady,
  recordWeight,
  outForDelivery,
  deliver,
  offerSubscription,
  nextSteps,
  turnaround,
  dueAt,
  STEPS,
  PHOTO_BUCKET,
  WEIGHT_PHOTO_BUCKET,
};
