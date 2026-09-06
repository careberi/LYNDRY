'use strict';

const db = require('../db');
const orders = require('./orders');
const booking = require('./booking');
const notify = require('./notify');

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
// being asked - see src/core/nudges.js for why the AI does not write these.
//
// Kept to one segment for the ordinary case. A customer whose spot is a
// sentence long can push it to two, and that is the right trade: their own
// words are worth more than a segment.
function reminderMessage(order) {
  const when = booking.arrivalWindow(order);
  const spot = spotOf(order);

  const head = when
    ? `Reminder: we're collecting your laundry tomorrow, ${when}.`
    : `Reminder: we're collecting your laundry tomorrow.`;

  // Handed over in person, so there is no bag to leave anywhere.
  const where =
    order.pickup_method === 'HAND_TO_DRIVER'
      ? `We'll knock when we arrive.`
      : spot
      ? `Please have the bag out at the ${spot}.`
      : `Please have the bag out ready for us.`;

  return `${head} ${where} Text us if anything changes.`;
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
        'customers(id, name, phone, status, preferences)'
    )
    .eq('pickup_date', target)
    .in('status', orders.AWAITING_COLLECTION)
    .is('reminder_sent_at', null);

  if (error) throw error;

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
    .select('id, order_number, pickup_date, pickup_window_start, pickup_window_end, reminder_sent_at')
    .eq('customer_id', customerId)
    .in('status', orders.AWAITING_COLLECTION)
    .is('reminder_sent_at', null)
    .gte('pickup_date', booking.today())
    .order('pickup_date', { ascending: true })
    .limit(1);

  if (error) throw error;

  const order = (data || [])[0];
  if (!order) return null;

  // The evening before. A pickup TODAY has no reminder left to send - the
  // evening before it has already gone by.
  const goesOn = booking.addDays(order.pickup_date, -1);
  if (goesOn < booking.today()) return null;

  return { order, goesOn, window: booking.arrivalWindow(order) };
}

module.exports = { sendDue, reminderMessage, pendingFor, JUST_BOOKED_HOURS };
