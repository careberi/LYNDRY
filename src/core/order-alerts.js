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
// A SWEEP BOOKING A PICKUP IS NOT SOMEBODY PLACING ONE, and that is the only
// thing skipped. The nightly pass books every due recurring pickup in one go,
// so a customer with a Tuesday arrangement would generate an identical text
// every Monday evening, and ten of them would generate ten. Neil set those up;
// the news is a NEW order, which is what he asked for in as many words.
//
// IT IS NOT "DID THE DATE COME OFF A PLAN", AND ASKING THAT WAS THE BUG. This
// read booking.js's `fromSchedule` until 25 September, and that flag answers a
// question about the DATE: the day was worked out from a standing arrangement
// rather than chosen off a calendar. True of the overnight sweeps - and equally
// true of the very FIRST pickup of a subscription, at the moment a person is
// sitting on the website setting one up.
//
// So four real orders went in silently. #2060 and #2061 on 12 September, #2072
// on the 17th, and #2079 on the 25th - a customer who signed up at 08:11, chose
// a monthly pickup and was booked at 08:12, ninety seconds later. Neil found it
// by opening the thread, which is exactly the thing this file exists to stop
// him having to do. Nothing failed anywhere: a text that is never sent leaves
// no trace at all.
//
// THE CALLER SAYS WHICH IT IS NOW, and only the two sweeps in recurring.js say
// "the system". THE DEFAULT IS TO SEND: the flag is not defaulted in here, so a
// caller that has never heard of it is undefined, which is falsy, which is a
// text. That is the right way round. One text too many is reported the same
// evening; one text too few is reported by nobody.
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
// WHO STAYS QUIET, as a rule with no database behind it.
//
// Pure and exported so it can be tested on its own, which is the whole of what
// went wrong: the old version of this decision was one word buried in the first
// line of a function that cannot be called without reaching Stripe's neighbours
// - the team list, the carrier - so nothing pinned it and it was wrong for
// thirteen days without a single test going red.
//
// Null means send. A string means stay quiet, and says why in words, because
// the caller logs it and "skipped: true" answers nothing at two in the morning.
// ---------------------------------------------------------------------------
function skipReason({ bookedByTheSystem } = {}) {
  if (bookedByTheSystem) return 'a sweep booked it, nobody placed it';
  return null;
}

// ---------------------------------------------------------------------------
// Send it.
//
// `booking` is passed in rather than required at the top: booking.js is what
// calls this, and requiring it back would be a cycle. It is only needed for one
// sentence, so taking it as an argument is cheaper than moving whenLine().
// ---------------------------------------------------------------------------
async function newOrder({ customer, order, booking, needsCard, freeOrder, bookedByTheSystem }) {
  // Deliberately not defaulted anywhere in this file: undefined is falsy, so a
  // door that has never heard of the flag gets a text rather than silence.
  const quiet = skipReason({ bookedByTheSystem });
  if (quiet) return { sent: [], skipped: quiet };

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

module.exports = { newOrder, compose, skipReason, PERMISSION };
