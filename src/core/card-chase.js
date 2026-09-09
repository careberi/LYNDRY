'use strict';

// ---------------------------------------------------------------------------
// THE CARD LINK WAITS HALF AN HOUR.
//
// Neil: "After you add an address, a text goes out reminding the person to put
// a card on file. This should not go out unless an order is booked and no card
// is on file for 30 minutes."
//
// It used to go the instant the order was written. On the website that is the
// worst possible moment: the card button is on the screen in front of them, and
// a text arrives telling them to do the thing they are in the middle of doing.
// Most people save a card within the minute, so most of those texts were for
// nothing, and every one is a billed segment and a line in a thread.
//
// So nothing is sent at booking. This sweep runs on the same ten-minute tick as
// the follow-up chases and asks a much simpler question than they do: is there
// an order still waiting on a card that we booked half an hour ago and have not
// chased?
//
// ONE CHASE, EVER, PER ORDER. Not a ladder. Somebody who has read the message
// and not acted does not need it again, and `card_link_sent_at` makes a second
// one impossible rather than discouraged - the same shape as the follow-up
// rules, where the count is a fact rather than a counter.
// ---------------------------------------------------------------------------

const db = require('../db');
const orders = require('./orders');
const billing = require('./billing');
const booking = require('./booking');
const { sendAndLog } = require('./notify');

// Half an hour, and it is a FLOOR rather than a schedule. The tick is every ten
// minutes, so the message actually lands somewhere between 30 and 40 minutes
// after the booking. That slack is the point: it costs nothing, and pinning it
// to the minute would need a timer per order, which is the job queue this
// codebase does not have.
const WAIT_MINUTES = Number(process.env.CARD_CHASE_MINUTES || 30);

// ---------------------------------------------------------------------------
// Which orders are still waiting on a card.
//
// The card lives on the CUSTOMER, not the order, so this is a join rather than
// a column test: an order needs chasing when its own customer has no default
// payment method. Somebody who saved a card for a different order is not
// chased about this one, which is right - one card covers everything.
// ---------------------------------------------------------------------------
async function due({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - WAIT_MINUTES * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('orders')
    .select('id, order_number, status, created_at, customers(*)')
    .is('card_link_sent_at', null)
    .lt('created_at', cutoff)
    .in('status', orders.AWAITING_COLLECTION)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) throw error;

  return (data || []).filter((order) => {
    const customer = order.customers;
    if (!customer) return false;

    // A card arrived in the meantime, which is the outcome this delay exists to
    // wait for. Nothing to say.
    if (billing.hasPaymentMethod(customer)) return false;

    // notify.sendAndLog() would refuse an opted-out number anyway - it is the
    // last gate and it fails closed - but there is no reason to build a message
    // and a Stripe session for somebody we cannot text.
    if (customer.status === 'UNSUBSCRIBED') return false;

    return true;
  });
}

// ---------------------------------------------------------------------------
// Send the ones that are due.
//
// STAMPED AFTER THE SEND. A stamp that went first would mark an order chased
// while the carrier was down and nobody would ever be told; sent-but-unstamped
// costs one duplicate, and only if the process dies between the two lines. Same
// trade orders.reminder_sent_at makes, in the same direction.
//
// One order at a time, not a burst: a run of identical messages leaving at once
// reads as spam to a carrier, and sendAndLog() writes each one as it goes, so a
// failure halfway through still leaves an accurate record of who was texted.
// ---------------------------------------------------------------------------
async function sendDue({ now = new Date() } = {}) {
  const sent = [];
  const skipped = [];

  const waiting = await due({ now });

  for (const order of waiting) {
    const customer = order.customers;

    try {
      const message = await billing.setupLinkMessage(customer);
      const result = await sendAndLog(customer.phone, message, customer.id);

      // A REFUSAL ANSWERS; A SEND SAYS NOTHING. sendAndLog() returns
      // { sent: false, refused } when it will not send - an opted-out number,
      // or one in the 555-0100 fiction range - and returns UNDEFINED when it
      // does send. So the test is for the refusal, not for a truthy result.
      //
      // Written the other way round first, and a test caught it: every
      // successful send read as a refusal, so nothing was ever stamped and the
      // same customer would have been sent the same card link every ten
      // minutes, for ever.
      if (result && result.sent === false) {
        skipped.push({
          order: order.order_number,
          reason: `the send was refused (${result.refused || 'no reason given'})`,
        });
        continue;
      }

      await stamp(order.id);
      sent.push({ order: order.order_number, phone: customer.phone });
    } catch (err) {
      // One customer's Stripe hiccup must not stop the rest of the sweep.
      console.error(`Card chase for order ${order.order_number} threw: ${err.message}`);
      skipped.push({ order: order.order_number, reason: err.message });
    }
  }

  return { sent, skipped };
}

// ---------------------------------------------------------------------------
// "We have given this order its card link."
//
// Exported because the AI calls it too. When it puts a link in its own reply
// the customer already has one, and the sweep must not send a second copy half
// an hour later - so the thing that sends stamps, wherever it is.
//
// It never throws. Failing to write this costs one duplicate message; letting
// it break the caller would cost somebody their booking confirmation.
// ---------------------------------------------------------------------------
async function stamp(orderId) {
  if (!orderId) return;

  const { error } = await db
    .from('orders')
    .update({ card_link_sent_at: new Date().toISOString() })
    .eq('id', orderId);

  if (error) console.error(`Could not stamp the card link on ${orderId}: ${error.message}`);
}

module.exports = { WAIT_MINUTES, due, sendDue, stamp };
