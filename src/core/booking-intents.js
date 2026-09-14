'use strict';

// ---------------------------------------------------------------------------
// WHAT SOMEBODY CHOSE, BEFORE THERE IS AN ORDER.
//
// Neil's decision lock, 14 September: for online bookings, no payment method
// means no order, while the booking intent preserves everything the customer
// has already entered.
//
// THIS REVERSES CLAUDE.md, AND THE REVERSAL IS THE POINT. The old rule was
// "record the pickup first, ask for the card second", written after a real
// customer was sent away to pay before their booking existed and came back to
// nothing. Neil's reading: the problem then was not the ordering, it was that
// there was nothing to come back TO. An order got created early because an
// order was the only thing in the system that could remember anything. This is
// that missing state, so the order no longer has to stand in for it.
//
// WHAT AN INTENT IS NOT: it is not on the board, not on the route, not in the
// reminder sweep, and not a promise to anybody. Nothing here texts. It is a
// note of what somebody was in the middle of.
//
// WHAT IT DELIBERATELY DOES NOT HOLD: the wash preferences and the address.
// Those are written to the customer row at the address step of the wizard,
// because that is where a guest becomes a customer and where their consent is
// recorded - so they already survive a trip to Stripe, and copying them here
// would be a second copy of a fact the database already holds.
//
// CONVERSION RE-RUNS THE REAL RULES. bookPickup() is the same function both
// front doors use, so a pickup that has gone stale while somebody was typing
// their card is refused by exactly the rule that would have refused it at the
// time. Neil: keep the payment method saved and send them back to choose
// another time. Never create an invalid order.
//
// THERE ARE NO SLOTS AND NOTHING IS HELD. Neil, 14 September: there is no
// capacity limit on a pickup window and none is being built. Re-checking at
// conversion is about the clock and the ordinary booking rules, not about a
// reservation, because there is nothing to reserve.
//
// NOTHING HERE SENDS A TEXT. Same rule as orders.transition(): the caller
// decides what the customer hears, because the webhook, the return page and
// the account page all reach this and they owe the customer one message
// between them, not three.
// ---------------------------------------------------------------------------

const db = require('../db');
const booking = require('./booking');
const recurring = require('./recurring');

// How old an open intent has to be before ops is shown it as unfinished.
//
// Long enough that somebody still typing their card is not on the list, short
// enough that a person who gave up this morning is. It is a reading of
// created_at rather than a column, so changing it changes the past too.
const UNFINISHED_AFTER_MINUTES = 20;

const FIELDS =
  'id, customer_id, pickup_date, pickup_time, notes, cadence, weekdays, ' +
  'order_id, completed_at, blocked_reason, card_link_sent_at, created_at, updated_at';

// The customer fields the ops list needs. Named rather than a star, because an
// unselected column reads as undefined and this codebase has been bitten seven
// times by exactly that.
const WITH_CUSTOMER =
  FIELDS +
  ', customers(id, name, phone, status, address_line1, city, postal_code, ' +
  'stripe_customer_id, default_payment_method_id, card_brand, card_last4)';

// The weekdays the wizard carries as "1,3,5".
//
// EMPTY SEGMENTS ARE DROPPED BEFORE Number(), and that is not tidiness. ''
// split on a comma is [''], and Number('') is 0, which is a valid weekday - so
// a repeat whose weekday list arrived empty would read as SUNDAY and book
// somebody a standing order every Sunday for ever. It would not throw and
// nothing downstream could tell it from a real choice. Caught by a test.
function weekdaysOf(intent) {
  return String((intent && intent.weekdays) || '')
    .split(',')
    .map((n) => String(n).trim())
    .filter((n) => n !== '')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

function isRepeat(intent) {
  const cadence = intent && intent.cadence;
  return Boolean(cadence && recurring.CADENCES[cadence] && weekdaysOf(intent).length);
}

// WHICH DAY THIS WOULD LAND ON, WITHOUT CREATING ANYTHING.
//
// A one-off is the day they picked. A repeat has no day of its own - the
// schedule decides it - and the schedule must not exist until the order does,
// so this works the date out from a schedule held in memory. recurring.nextDate()
// is pure and reads only the fields set here, which is what makes that safe.
//
// It is used to VALIDATE at checkout, never to book. convert() uses the real
// rows once they exist, because started_on is what anchors a fortnightly
// cadence and an imagined row cannot know it.
function firstDateFor(intent) {
  if (!intent) return '';
  if (!isRepeat(intent)) return intent.pickup_date || '';

  const from = booking.today();

  const dates = weekdaysOf(intent)
    .map((weekday) =>
      recurring.nextDate(
        { status: 'ACTIVE', cadence: intent.cadence, weekday, started_on: from },
        from
      )
    )
    .filter(Boolean)
    .sort();

  return dates[0] || '';
}

// The one still being worked on, if there is one.
async function openFor(customerId) {
  if (!customerId) return null;

  const { data, error } = await db
    .from('booking_intents')
    .select(FIELDS)
    .eq('customer_id', customerId)
    .is('completed_at', null)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

// Write down what they have chosen.
//
// ONE OPEN INTENT PER CUSTOMER, so going back and choosing a different day
// replaces the first rather than leaving a trail of half-finished ones. The
// unique index enforces it; this reads first so the row keeps its created_at,
// which is what "unfinished since" is measured from.
//
// blocked_reason is cleared on every save: they are answering the very
// question it was asking.
async function save(customer, { pickupDate, pickupTime, notes, cadence, weekdays } = {}) {
  if (!customer || !customer.id) return null;

  const row = {
    customer_id: customer.id,
    pickup_date: pickupDate || null,
    pickup_time: pickupTime || null,
    notes: notes || null,
    cadence: cadence || null,
    weekdays: weekdays || null,
    blocked_reason: null,
    updated_at: new Date().toISOString(),
  };

  const existing = await openFor(customer.id);

  if (existing) {
    const { data, error } = await db
      .from('booking_intents')
      .update(row)
      .eq('id', existing.id)
      .select(FIELDS)
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await db
    .from('booking_intents')
    .insert(row)
    .select(FIELDS)
    .single();
  if (error) throw error;
  return data;
}

// Stamped when it became an order.
async function complete(intent, order) {
  if (!intent) return null;

  const { data, error } = await db
    .from('booking_intents')
    .update({
      order_id: order ? order.id : null,
      completed_at: new Date().toISOString(),
      blocked_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', intent.id)
    // Only if nobody else finished it first. The webhook and the return page
    // race every time, exactly as they do over payment_links.
    .is('completed_at', null)
    .select(FIELDS)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// The card is saved and the pickup they chose is no longer bookable. The
// intent stays OPEN on purpose - they still want a pickup, and the next thing
// they do is pick another time, which is a save() away.
async function blocked(intent, reason) {
  if (!intent) return null;

  const { error } = await db
    .from('booking_intents')
    .update({
      blocked_reason: String(reason || '').slice(0, 300),
      updated_at: new Date().toISOString(),
    })
    .eq('id', intent.id)
    .is('completed_at', null);

  if (error) console.error('Could not record why an intent is blocked: ' + error.message);
  return null;
}

// TURN IT INTO A REAL ORDER, IF THE RULES STILL ALLOW IT.
//
// The whole of the decision lock lives here. It re-runs bookPickup(), which is
// the same function the text thread and the card-on-file path call, so there is
// no second copy of "is this still possible" to drift.
//
// THE STANDING ORDER IS CREATED HERE, NOT AT CHECKOUT, and is undone if the
// pickup is then refused - the same shape the wizard already used, moved to
// the moment the order actually gets made. Somebody who never finished paying
// must not be left with a weekly arrangement.
//
// It returns bookPickup()'s own result, so a caller can say exactly what the
// customer would have been told at the time.
async function convert(customer, intent) {
  if (!customer || !intent) return { ok: false, reason: 'no_intent' };

  let firstDate = null;
  const madeSchedules = [];

  if (isRepeat(intent)) {
    try {
      for (const weekday of weekdaysOf(intent)) {
        madeSchedules.push(
          await recurring.addSchedule(customer, {
            cadence: intent.cadence,
            weekday,
            timeOfDay: intent.pickup_time || null,
            // The wizard is the web door and the schedule remembers it, so
            // every pickup this arrangement books is known to be a web
            // customer's. See recurring.addSchedule() and cardDestination().
            placedVia: booking.DOORS.WEB,
          })
        );
      }
      const dates = madeSchedules.map((s) => recurring.nextDate(s)).filter(Boolean).sort();
      firstDate = dates[0] || null;
    } catch (err) {
      console.error('Could not set up a standing order from an intent: ' + err.message);
      await recurring.stop(customer).catch(() => {});
      return { ok: false, reason: 'schedule_failed' };
    }
  }

  const result = await booking.bookPickup(customer, {
    pickupDate: firstDate || intent.pickup_date || '',
    pickupTime: intent.pickup_time || '',
    fromSchedule: Boolean(firstDate),
    notes: intent.notes || null,
  });

  if (!result.ok) {
    // The repeat goes with it. It was created a moment ago only so the first
    // pickup's date could be worked out, and leaving it behind would give
    // somebody a standing order for a pickup that was refused.
    if (madeSchedules.length) {
      await recurring
        .stop(customer)
        .catch((err) => console.error('Could not undo a standing order: ' + err.message));
    }
    await blocked(intent, result.detail || result.say || result.reason);
    return result;
  }

  await complete(intent, result.order);
  return result;
}

// UNFINISHED CHECKOUTS, FOR OPS.
//
// Neil's ask, 14 September: unfinished online customers must not disappear
// simply because they are no longer represented as orders. Before booking
// intents they sat on the board as an order badged AWAITING CARD, which is how
// anybody knew to ring them.
//
// Old enough to mean something, newest first. It is a query rather than a
// stored "abandoned" flag, so nothing has to sweep and nothing can go stale.
async function unfinished({ olderThanMinutes = UNFINISHED_AFTER_MINUTES, limit = 100 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60000).toISOString();

  const { data, error } = await db
    .from('booking_intents')
    .select(WITH_CUSTOMER)
    .is('completed_at', null)
    .lte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// How many, for the card on the dashboard.
async function unfinishedCount({ olderThanMinutes = UNFINISHED_AFTER_MINUTES } = {}) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60000).toISOString();

  const { count, error } = await db
    .from('booking_intents')
    .select('id', { count: 'exact', head: true })
    .is('completed_at', null)
    .lte('created_at', cutoff);

  if (error) throw error;
  return count || 0;
}


// ---------------------------------------------------------------------------
// THE ABANDONED CHECKOUT CHASE.
//
// Neil's weird case: the customer closes Stripe, the intent stays incomplete,
// no order exists, and they get the normal abandoned-payment follow-up later.
//
// This is the same half-hour wait card-chase.js already applies to orders, and
// it had to move here with the state it reads. Before booking intents there was
// an order to hang it off; now the thing waiting on a card is the intent.
//
// ONE CHASE, EVER. card_link_sent_at makes a second impossible rather than
// discouraged, exactly as it does on an order.
// ---------------------------------------------------------------------------
async function dueForCardChase({ olderThanMinutes = 30, limit = 50 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60000).toISOString();

  const { data, error } = await db
    .from('booking_intents')
    .select(WITH_CUSTOMER)
    .is('completed_at', null)
    .is('card_link_sent_at', null)
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// "We have given this checkout its card link."
//
// Never throws. Failing to write it costs one duplicate message; letting it
// break the caller would cost the sweep.
async function stampCardLink(intentId) {
  if (!intentId) return;

  const { error } = await db
    .from('booking_intents')
    .update({ card_link_sent_at: new Date().toISOString() })
    .eq('id', intentId);

  if (error) console.error('Could not stamp the card link on an intent: ' + error.message);
}

module.exports = {
  UNFINISHED_AFTER_MINUTES,
  FIELDS,
  WITH_CUSTOMER,
  openFor,
  save,
  complete,
  blocked,
  convert,
  unfinished,
  unfinishedCount,
  dueForCardChase,
  stampCardLink,
  weekdaysOf,
  isRepeat,
  firstDateFor,
};
