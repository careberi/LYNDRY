'use strict';

// ---------------------------------------------------------------------------
// AN ADMIN IS TOLD WHEN SOMEBODY PLACES AN ORDER.
//
// Neil's ask. Until now the only way to know a pickup had come in was to open
// the board and look, which means either watching a screen all day or finding
// out about tomorrow's 8am pickup at 9am.
//
// IT HANGS OFF bookPickup(), WHICH IS THE ONE DOOR BOTH FRONT DOORS GO THROUGH.
// The AI's create_order and the website form both call it, so hooking it there
// is the only way an order can be booked without an alert going out. Putting it
// in the two routes instead would work until somebody added a third.
//
// A STANDING ORDER IS NOT SOMEBODY PLACING AN ORDER, and it is skipped. The
// nightly pass books every due recurring pickup in one go, so a customer with a
// Tuesday arrangement would generate an identical text every Monday evening,
// and ten of them would generate ten. Neil set those up; the news is a NEW
// order, which is what he asked for in as many words.
//
// IT NEVER BREAKS A BOOKING. Every failure here is swallowed and logged: the
// pickup is real whether or not anybody got a text about it, and an exception
// thrown while telling the office would otherwise lose the order it was about.
// ---------------------------------------------------------------------------

const { config } = require('../config');
const { site } = require('../web/site');
const issues = require('./issues');
const { sendAndLog } = require('./notify');

// WHO WORKS ORDERS, not who manages issues. issues.alertRecipients() takes the
// permission for exactly this reason - its own comment says "come and collect
// this goes to whoever works orders, which is a different and usually larger
// list". SUPPORT_PHONE is added by that function, so Neil is on it whether or
// not he has an ops_users row.
const PERMISSION = 'orders.view';

// The window as it will be promised to the customer, so the alert and the
// confirmation cannot describe the same pickup differently.
function whenLine(order, booking) {
  return booking.whenLine(order);
}

// ---------------------------------------------------------------------------
// The message.
//
// Written in code rather than by the AI, like every other unprompted text in
// this system: it goes out because of something WE did, the words are read by
// somebody before the button exists, and the length is knowable in advance.
//
// WHAT AN ADMIN ACTUALLY NEEDS, in the order they need it: who and where, when
// the van is due, and whether it is billable yet. The last one is the reason
// this is worth a text at all - an order with no card on it is not on anybody's
// run sheet, and that is the one that quietly does not happen.
// ---------------------------------------------------------------------------
function compose({ customer, order, needsCard, freeOrder, when }) {
  const who = customer.name || customer.phone;
  const where = customer.address_line1 || 'no address on file';

  const money = freeOrder
    ? 'Free order.'
    : needsCard
      ? 'NO CARD YET, so not confirmed.'
      : 'Card on file.';

  return (
    `New order #${order.order_number}: ${who}, ${where}. ` +
    `Pickup ${when}. ${money} ` +
    `${config.baseUrl}/ops/orders/${order.order_number}`
  );
}

// ---------------------------------------------------------------------------
// Send it.
//
// `booking` is passed in rather than required at the top: booking.js is what
// calls this, and requiring it back would be a cycle. It is only needed for one
// sentence, so taking it as an argument is cheaper than moving whenLine().
// ---------------------------------------------------------------------------
async function newOrder({ customer, order, booking, needsCard, freeOrder, fromSchedule }) {
  if (fromSchedule) return { sent: [], skipped: 'a standing order, not somebody placing one' };

  try {
    const numbers = await issues.alertRecipients(PERMISSION);

    if (!numbers.length) {
      // The same failure the handoff page had on 5 September: nobody to tell,
      // and no trace of it anywhere but a log. Worth saying loudly, but not
      // worth stopping a booking over.
      console.error(
        `Order #${order.order_number} was booked and no admin could be told: ` +
          'no active team member has a phone and SUPPORT_PHONE is unset.'
      );
      return { sent: [], skipped: 'nobody to tell' };
    }

    const body = compose({
      customer,
      order,
      needsCard,
      freeOrder,
      when: whenLine(order, booking),
    });

    // One at a time, and logged against nobody - customer_id is null because
    // this is a message to US about a customer, not a message to the customer.
    // Logging it against them would put it in their thread on the ops screens,
    // where it reads as something they were sent.
    const sent = [];
    for (const phone of numbers) {
      await sendAndLog(phone, body, null);
      sent.push(phone);
    }

    console.log(`Order #${order.order_number} booked, ${sent.length} admin(s) told.`);
    return { sent };
  } catch (err) {
    console.error(`Could not tell anybody about order ${order.order_number}: ${err.message}`);
    return { sent: [], skipped: err.message };
  }
}

module.exports = { newOrder, compose, PERMISSION };
