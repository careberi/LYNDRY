'use strict';

const db = require('../db');
const orders = require('./orders');
const booking = require('./booking');
const subscription = require('./subscription');
const notify = require('./notify');
const dispatch = require('./dispatch');
const billing = require('./billing');

// ---------------------------------------------------------------------------
// "YOUR PICKUP IS TOMORROW - HAVE THE BAG OUT."
//
// Neil's ask. Somebody books on Saturday for Tuesday, gets a confirmation on
// Saturday, and by Monday night that confirmation is four messages up a thread
// they have not looked at. The van then arrives at a door with no bag on it,
// which costs a stop, a drive and the promise.
//
// So every pickup gets one text the evening before, saying when we are coming
// and where to leave the bag.
//
// IT IS THE EVENING BEFORE, NOT EXACTLY 24 HOURS. Neil said both, meaning the
// same thing. One pass a night is what the system can honestly do - a true
// per-order 24-hour timer needs either a job queue, which CLAUDE.md rules out,
// or a cron firing every few minutes, which is a lot of machinery for a van
// that visits a door once a day. The evening before is also when a person can
// actually act on it: nobody puts a bag out at 6am because they were reminded
// at 6am.
//
// ONE REMINDER PER ORDER, EVER. orders.reminder_sent_at is stamped as it goes,
// so the pass is safe to run twice - which matters because Railway retries a
// failed run, and a reminder arriving twice reads as a system that does not
// know what it has already said.
//
// STANDING ORDERS ARE NOT REMINDED TWICE. They already get a day-before text
// carrying the SKIP line, sent as they are booked; recurring.bookDue() stamps
// the same column, so they are simply not due one here.
// ---------------------------------------------------------------------------

// NO CARD MEANS NO REMINDER, BECAUSE NO CARD ALREADY MEANS NO PICKUP.
//
// Neil, 14 September: "reminders must use dispatch.collectable() so no-card
// orders get no night-before text and do not show PICKUP REMINDER SCHEDULED."
//
// dispatch.collectable() took an unbillable order off the driver's route on 13
// September. Nothing here read it, so the van was not coming and the customer
// was still being told to put the bag out - which is worse than saying nothing,
// because they act on it. Order #2063 was the live case: badged AWAITING CARD,
// off the route, still carrying a scheduled reminder on its own page.
//
// IT CALLS THE ROUTE'S FUNCTION RATHER THAN ASKING THE SAME QUESTION AGAIN.
// "Has this order got a card" is one rule with one owner, and a second copy
// here would disagree with the round the first time either changed. A WAIVED
// order is still reminded, because collectable() already answers true for it -
// nothing to charge is not the same as cannot charge.
//
// THREE FUNCTIONS BELOW DECIDE THIS, NOT ONE, and all three are gated: the
// sweep that sends, the badge in the thread, and the list on /ops/scheduled. A
// badge promising a text that will not be sent is the failure this rule exists
// to prevent, not a smaller version of it.
function collectable(order) {
  return dispatch.collectable(order);
}

// AND NO CARD WAS ONLY HALF OF IT. Grok's review, 14 September.
//
// There are two reasons the van is not coming, and this file knew one. A
// customer with laundry of ours and an unpaid balance has their other pickups
// parked by the sibling block, and nothing here knew it: #2061 is booked for 26
// September behind #2060, so it comes off the round that morning and would have
// been sent a text the evening before telling them to have the bag out. That is
// the same failure this file was written to fix, one rule along, and worse than
// the first because the customer has done nothing wrong.
//
// SO IT CALLS dispatch.routableCheck(), WHICH IS THE ROUTE'S OWN ANSWER TO
// BOTH. Not a second card check and not an `&&` written out again here: "can
// this pickup be driven" has one owner, and a copy in this file would disagree
// with the round the first time either moved. It is async because the sibling
// half is a query, and it takes the whole list so one query serves a pass.
//
// A WAIVED ORDER IS STILL REMINDED. Nothing to charge is not cannot charge, and
// a waived order has no balance, so neither half of this touches it.
const routableCheck = dispatch.routableCheck;

// WHAT collectable() HAS TO BE HANDED, AND WHY IT IS A CONSTANT.
//
// It reads orders.payment_status and the customer's stripe_customer_id and
// default_payment_method_id. An unselected column comes back undefined, which
// is indistinguishable from an absent card - so a select that forgets these
// does not fail loudly, it silently answers "no card" for EVERYBODY and
// cancels every reminder in the system.
//
// That has now happened five times in this codebase (BOARD_FIELDS, RUN_FIELDS,
// the order page's payment_attempts, and its ready_at / delivered_at), which is
// why the fields are one string used by all three queries rather than typed out
// three times. A test pins that each query carries them.
const CARD_FIELDS =
  'payment_status, ' +
  // THE SHOW-UP HOLD, because collectable() reads it and an unselected
  // column is undefined - which here is indistinguishable from a card that
  // never refused. So a pickup the round has already dropped would still be
  // told to put the bag out at eight in the morning. That is the exact
  // failure the reminder gate was built for, one rule along, and the
  // eleventh time an absent column has quietly decided what a screen knows.
  // authorized_cents as well, because the reminder says the amount out loud
  // and reading it off the order is what stops the sentence and the hold
  // ever naming two different numbers.
  'authorization_intent_id, authorized_cents, authorized_at, authorization_refused_at';
const CUSTOMER_CARD_FIELDS = 'stripe_customer_id, default_payment_method_id';

// A pickup booked in the last few hours does not need reminding that it is
// tomorrow. They booked it this evening, the confirmation is the message above
// this one in the thread, and a second text an hour later reads as a system
// talking to itself. Two texts per order is real money and a worse complaint
// profile, which is the same reason AT_PARTNER and READY say nothing.
const JUST_BOOKED_HOURS = 3;

// What the order was booked with wins over what the customer row says now.
// Same rule the run sheet follows: this is the arrangement THIS pickup was
// made under, not whatever has been edited since.
function prefsFor(order) {
  const own = order.preferences && Object.keys(order.preferences).length ? order.preferences : null;
  return own || (order.customers && order.customers.preferences) || {};
}

// BOTH SPOT FIELDS, NEWEST FIRST, exactly as run.spotOf() reads them.
// `special_instructions` is where the AI saves the pickup spot and where every
// older customer's is; `dropoff_spot` is the optional "bring it back somewhere
// else". A spot that exists and is not said is worse than no spot, because the
// customer then wonders whether we have it.
function spotOf(order) {
  const prefs = prefsFor(order);
  return String(prefs.dropoff_spot || prefs.special_instructions || '').trim();
}

// The message. Written here, in code, like every other thing we send without
// being asked - see src/core/intake.js for why the AI does not write these.
//
// Kept to one segment for the ordinary case. A customer whose spot is a
// sentence long can push it to two, and that is the right trade: their own
// words are worth more than a segment.
function reminderMessage(order) {
  const when = booking.arrivalWindow(order);
  const spot = spotOf(order);

  // A SUBSCRIPTION PICKUP SAYS SO. Neil's rule: a subscription order is
  // identifiable everywhere a customer meets one, and the reminder is the last
  // message before a van arrives.
  //
  // It is one word in the sentence they were already getting rather than a
  // sentence of its own, because this message has a two-segment ceiling that a
  // standing order's SKIP line and the $25 hold clause already push against.
  //
  // READ OFF THE ORDER, never off the customer. Somebody who cancelled
  // yesterday still has tomorrow's pickup at the rate they were sold, and it is
  // still a Subscription pickup - which is exactly what Neil's "cancels after
  // the reminder" case asks for.
  // IT REPLACES THE OPENER RATHER THAN BEING ADDED TO IT, and that is the whole
  // reason this reads the way it does.
  //
  // The obvious version - "we're picking up your Subscription laundry" - is
  // thirteen characters longer, and the standing-order worst case this file is
  // measured against already sat at 305 of the 306 that fit in two segments.
  // Every pickup a subscription books now carries a plan, so that is not an
  // edge case, it is the ordinary one: it would have put a third segment on
  // every subscriber's reminder, every week, for ever.
  //
  // Naming the plan in place of "we're picking up" is two characters SHORTER
  // than the sentence it replaces, so it costs nothing and says more.
  const head = subscription.isSubscriptionOrder(order)
    ? when
      ? `Reminder: your Subscription pickup is tomorrow, ${when}.`
      : `Reminder: your Subscription pickup is tomorrow.`
    : when
      ? `Reminder: we're picking up your laundry tomorrow, ${when}.`
      : `Reminder: we're picking up your laundry tomorrow.`;

  // Handed over in person, so there is no bag to leave anywhere.
  const where =
    order.pickup_method === 'HAND_TO_DRIVER'
      ? `We'll knock when we arrive.`
      : spot
      ? `Please have the bag out at the ${spot}.`
      : `Please have the bag out ready for us.`;

  // THE WAY OUT RIDES WITH THE REMINDER FOR A STANDING ORDER.
  //
  // It used to be attached to the booking instead - recurring.bookDue() booked
  // tomorrow and texted "reply SKIP" in the same breath. Now that a standing
  // pickup is booked as soon as the previous one is collected, that message
  // would go out a week early saying "tomorrow", so the way out moved here,
  // onto the message that actually lands the night before. Every pickup a
  // schedule made carries it, however far ahead it was written.
  const out = order.from_schedule
    ? ` Reply SKIP if you don't need it this week and we'll cancel it, no charge.`
    : '';

  // THE HOLD IS NOT MENTIONED HERE ANY MORE, AND THAT REVERSES NEIL'S OWN ASK.
  //
  // It read ` $25.00 is on hold to confirm the pickup - we take the real total at
  // the door.` Neil, 26 September, reading a real thread: "this remainder $25.00
  // is on hold to confirm the pickup does not need to included in the remidner."
  //
  // WHAT THE SENTENCE WAS FOR, so nobody puts it back without knowing: the hold is
  // placed by the night-before pass a few minutes before this text goes out, so
  // this was the first and only message that could explain the pending charge - a
  // booking made a fortnight ago is confirmed before any hold exists, and its
  // confirmation therefore cannot name one.
  //
  // WHAT IT COSTS TO REMOVE IT, SAID PLAINLY: a customer who booked more than a
  // day ahead now sees $25 pending on their card with nothing anywhere having
  // explained it. That was the argument for adding it and it has not gone away.
  // Neil's call, made with it in front of him.
  //
  // AND HALF OF IT HAD GONE STALE ANYWAY, which is a second reason rather than the
  // reason. "We take the real total at the door" was written when `loadVan()`
  // charged at the doorstep. Under a courier nobody of ours goes to the door at
  // all - `settleWeight()` charges at the laundromat weigh-in - so the sentence
  // was describing a visit that does not happen. This is the sixth customer-facing
  // sentence found saying the wrong thing after the charge point moved; CLAUDE.md
  // says to grep for "at the door" and "a pound" when it moves again.
  //
  // WHAT IT BUYS: the reminder was within a couple of characters of the
  // two-segment ceiling on a standing order carrying the SKIP line and a long
  // dropoff spot. It is comfortably inside one now, on every reminder, for ever.

  return `${head} ${where} Text us if anything changes.${out}`;
}

// Everything due a reminder for `date`, sent, and stamped as it goes.
//
// Returns { date, sent, skipped } rather than throwing on one bad customer: a
// single failure must not stop the rest of the night's reminders, the same way
// one standing order that cannot be booked does not stop the others.
async function sendDue({ date = null } = {}) {
  const target = date || booking.addDays(booking.today(), 1);

  const { data, error } = await db
    .from('orders')
    .select(
      'id, order_number, pickup_date, pickup_window_start, pickup_window_end, ' +
        'pickup_method, preferences, created_at, ' +
        // WHICH PLAN, or the reminder cannot say. An unselected column reads as
        // undefined, which is indistinguishable from a one-time pickup - so
        // leaving it out would not break anything loudly, it would quietly send
        // every subscriber a reminder that does not mention their plan. That
        // trap has bitten this codebase eleven times and this is the twelfth
        // place it could have.
        'subscription_id, ' +
        `${CARD_FIELDS}, ` +
        // customer_id is what the sibling half groups on. Unselected it is
        // undefined, nobody is blocked, and this gate quietly does half its job.
        'customer_id, ' +
        `customers(id, name, phone, status, preferences, ${CUSTOMER_CARD_FIELDS})`
    )
    .eq('pickup_date', target)
    .in('status', orders.AWAITING_COLLECTION)
    .is('reminder_sent_at', null);

  if (error) throw error;

  // ONE QUERY FOR THE WHOLE PASS, before the loop. Asking per order would be a
  // round trip per reminder on a night with thirty of them.
  const routable = await routableCheck(data || []);

  const sent = [];
  const skipped = [];

  for (const order of data || []) {
    const customer = order.customers;

    if (!customer || !customer.phone) {
      skipped.push({ order, reason: 'no customer' });
      continue;
    }

    // STOP is a legal instruction. Not stamped, because they may text START
    // tomorrow morning and the column should keep meaning "we sent it".
    if (customer.status === 'UNSUBSCRIBED') {
      skipped.push({ order, reason: 'opted out' });
      continue;
    }

    // Nothing can be billed for this one, or the customer is parked behind an
    // unpaid order of their own, so the van is not coming either way. Telling
    // them to put the bag out would be the system contradicting its own round.
    // NOT STAMPED, for the same reason STOP is not: if a card arrives before
    // the pass runs again the column must still mean "we sent it".
    // THREE REASONS, AND IT COULD ONLY SAY TWO. A pickup whose card refused
    // the $25 hold is not routable and IS collectable-false, so it fell into
    // the else and was written down as "no card on file" - which is a
    // different problem with a different fix, and sends whoever reads the log
    // chasing a card that is already on the account. The gate itself was
    // right; only the sentence explaining it was wrong.
    if (!routable(order)) {
      // FOUR REASONS NOW, and the new one is about the server rather than the
      // customer: with no way to charge in production nothing is collected at
      // all, so every pickup skips for that reason and none of them is a card
      // problem. Named first, because when it is true it is true of the whole
      // board and the other three are noise.
      const reason = !billing.paymentsConfigured()
        ? 'card payments are not configured'
        : collectable(order)
          ? 'payment hold'
          : billing.showUpState(order) === 'REFUSED'
            ? 'show-up hold refused'
            : 'no card on file';

      skipped.push({ order, reason });
      continue;
    }

    const bookedHoursAgo = (Date.now() - new Date(order.created_at).getTime()) / 3_600_000;
    if (bookedHoursAgo < JUST_BOOKED_HOURS) {
      skipped.push({ order, reason: 'only just booked' });
      continue;
    }

    try {
      const body = reminderMessage(order);

      await notify.sendAndLog(customer.phone, body, customer.id);

      // STAMPED AFTER THE SEND, not before. A stamp that went first would mark
      // an order reminded when the carrier was down, and nobody would ever be
      // told. Sent-but-unstamped is the safer of the two failures: the worst it
      // costs is one duplicate, and only if the pass dies between these lines.
      const { error: stampError } = await db
        .from('orders')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', order.id);

      if (stampError) {
        console.error(
          `Reminded #${order.order_number} but could not record it: ${stampError.message}`
        );
      }

      sent.push({ order, body });
    } catch (err) {
      skipped.push({ order, reason: err.message });
      console.error(`Reminder for #${order.order_number} failed: ${err.message}`);
    }
  }

  console.log(`Reminders for ${target}: ${sent.length} sent, ${skipped.length} not.`);

  return { date: target, sent, skipped };
}

// IS A PICKUP REMINDER COMING FOR THIS PERSON, and when.
//
// Neil's ask, and the same reasoning as the follow-up: a text that goes out on
// its own should be visible before it lands, not discovered afterwards in the
// thread. Shown on the conversation screen.
//
// Derived, never stored - it reads the same order the sweep will read. The
// reminder goes out the evening BEFORE the pickup, so the date is the pickup
// minus a day, and it is only pending if it has not already been sent.
async function pendingFor(customerId) {
  if (!customerId) return null;

  const { data, error } = await db
    .from('orders')
    // The customer rides along ONLY so collectable() can be asked. This query
    // wanted nothing off them before, which is exactly how the badge came to
    // promise a text for an order that was off the route.
    .select(
      'id, order_number, pickup_date, pickup_window_start, pickup_window_end, reminder_sent_at, ' +
        `${CARD_FIELDS}, customer_id, customers(${CUSTOMER_CARD_FIELDS})`
    )
    .eq('customer_id', customerId)
    .in('status', orders.AWAITING_COLLECTION)
    .is('reminder_sent_at', null)
    .gte('pickup_date', booking.today())
    .order('pickup_date', { ascending: true })
    .limit(1);

  if (error) throw error;

  // THE SOONEST, AND ONLY THE SOONEST. If that one cannot be collected there is
  // no reminder to promise - falling through to a later pickup would badge the
  // wrong order, which is a quieter version of the bug being fixed.
  const order = (data || [])[0];
  if (!order) return null;

  const routable = await routableCheck([order]);
  if (!routable(order)) return null;

  // The evening before. A pickup TODAY has no reminder left to send - the
  // evening before it has already gone by.
  const goesOn = booking.addDays(order.pickup_date, -1);
  if (goesOn < booking.today()) return null;

  return { order, goesOn, window: booking.arrivalWindow(order) };
}

// EVERY PICKUP REMINDER STILL TO GO, for the screen that lists them.
//
// Reads the same orders the sweep reads. A reminder goes the evening BEFORE the
// pickup, so anything whose evening has already passed is not pending - it
// either went, or it was missed and saying "pending" would be a lie.
async function allPending() {
  const today = booking.today();

  const { data, error } = await db
    .from('orders')
    .select(
      'id, order_number, pickup_date, pickup_window_start, pickup_window_end, ' +
        `${CARD_FIELDS}, customer_id, ` +
        `customers (id, name, phone, status, ${CUSTOMER_CARD_FIELDS})`
    )
    .in('status', orders.AWAITING_COLLECTION)
    .is('reminder_sent_at', null)
    .gte('pickup_date', today)
    .order('pickup_date', { ascending: true });

  if (error) throw error;

  const routable = await routableCheck(data || []);

  return (data || [])
    .map((order) => ({
      order,
      customer: order.customers || null,
      phone: order.customers ? order.customers.phone : null,
      goesOn: booking.addDays(order.pickup_date, -1),
      window: booking.arrivalWindow(order),
    }))
    .filter((row) => row.phone && row.goesOn >= today && routable(row.order));
}

module.exports = {
  sendDue,
  reminderMessage,
  pendingFor,
  allPending,
  collectable,
  routableCheck,
  CARD_FIELDS,
  CUSTOMER_CARD_FIELDS,
  JUST_BOOKED_HOURS,
};
