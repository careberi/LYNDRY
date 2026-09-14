'use strict';

// ---------------------------------------------------------------------------
// A CARD WAS SAVED. THREE DOORS REACH THIS AND NONE MAY HAVE ITS OWN COPY.
//
// The webhook, the page a texted link returns to, and the page a button
// inside the account returns to. All three mean the same event, and all three
// owe the customer the same four things: the card recorded, anything already
// owed settled, the booking it was blocking confirmed, and one text saying so.
//
// IT LIVED IN THE WEBHOOK ALONE, AND THAT WAS A REAL HOLE. The return page
// called billing.recordSavedCard(), which stamps completed_at and sends
// nothing - and the webhook then saw completed_at and did nothing either,
// because a comment said the return page had handled it. It had not. Whoever
// won that race decided whether the customer heard anything at all: browser
// first and they saved a card, were told nothing, and had no confirmation for
// a pickup that was by then genuinely booked.
//
// Stripe redirects the browser the instant the card is saved and a webhook can
// lag seconds behind, so the browser usually wins. This was not the rare case.
//
// SAFE TO CALL TWICE. claim() refuses a link that already has completed_at, so
// the loser of the race does nothing rather than sending a second
// confirmation.
// ---------------------------------------------------------------------------

const db = require('../db');
const orders = require('./orders');
const billing = require('./billing');
const booking = require('./booking');
const promotions = require('./promotions');
const bookingIntents = require('./booking-intents');
const { site } = require('../web/site');
const { sendAndLog } = require('./notify');

// The link, unless somebody has already dealt with it.
async function linkFor(match) {
  const { data, error } = await db
    .from('payment_links')
    .select('*, customers(*)')
    .match(match)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    console.warn(`A card was saved for an unknown link: ${JSON.stringify(match)}`);
    return null;
  }

  // Already handled by the return page. Not an error - the browser and the
  // webhook race every time and either one winning is fine.
  return data.completed_at ? null : data;
}

// IT RETURNS { customer, order } NOW, NOT A CUSTOMER.
//
// The order is the one a booking intent became, when this card save is what
// completed an online checkout. Callers need it: the page they land on thanks
// that order by number and counts the completed-order conversion against its
// id, and neither is knowable from the customer alone.
//
// Null order is the ordinary case - a card added from the settings page, a
// texted link, a customer who had no checkout open.
async function cardWasSaved(link) {
  const customer = await billing.recordSavedCard(link);
  if (!customer) return { customer: null, order: null };

  const card = billing.describeCard(customer);

  // Anything they already owe gets settled now, without them having to
  // do anything else.
  const settled = await billing.retryOutstanding(customer);

  const settledLine = settled.length
    ? ` We've settled the ${billing.money(
        settled.reduce((sum, s) => sum + s.order.price_cents, 0)
      )} outstanding.`
    : '';

  // ---------------------------------------------------------------------
  // THE CHECKOUT THEY WERE IN THE MIDDLE OF BECOMES A REAL ORDER, HERE.
  //
  // Neil's decision lock, 14 September: no payment method, no order. So the
  // card being saved is the event that creates one, and this is the only place
  // all three doors pass through - the webhook, the texted link's return page
  // and the account's own return page. Putting it in a route would mean the
  // customer who closes the browser on Stripe's page never gets their pickup,
  // which is the exact case Neil called out.
  //
  // THE RULES ARE RE-RUN, NOT REMEMBERED. convert() calls bookPickup(), so a
  // pickup that has gone stale while they typed their card is refused by the
  // rule that would have refused it at the time. Neil: keep the payment method
  // saved and send them back to choose another time. Never create an invalid
  // order.
  //
  // IT IS TRIED BEFORE THE SETTLED-MONEY BRANCH, so somebody who both owed us
  // something and had a checkout open gets their pickup booked rather than one
  // fact quietly beating the other. They still get ONE text.
  // ---------------------------------------------------------------------
  const intent = await bookingIntents.openFor(customer.id).catch((err) => {
    console.error(`Could not look for a booking intent: ${err.message}`);
    return null;
  });

  if (intent) {
    const booked = await bookingIntents.convert(customer, intent).catch((err) => {
      console.error(`Could not turn a booking intent into an order: ${err.message}`);
      return { ok: false, reason: 'threw' };
    });

    if (booked.ok) {
      const free = await promotions
        .claimedFreeOrder(booked.order.id)
        .catch(() => ({ freeOrder: false, freeUpToLb: null }));

      await sendAndLog(
        customer.phone,
        booking.confirmationMessage(customer, booked.order, {
          // The confirmation names the card itself, so the opener must not
          // name it again - a real customer got the card number twice in one
          // text.
          opener: 'Card saved',
          source: booking.DOORS.WEB,
          rolled: booked.rolled,
          freeOrder: free.freeOrder,
          freeUpToLb: free.freeUpToLb,
        }) + settledLine,
        customer.id
      );

      return { customer, order: booked.order };
    }

    // SOMEBODY ELSE IS ALREADY DOING THIS ONE, SO SAY NOTHING AT ALL.
    //
    // The webhook and the return page race on every card save, and the winner
    // books the pickup and sends the confirmation. The loser must not text
    // anything: "we could not hold that pickup" would arrive beside a
    // confirmation for the pickup we just held, from the same card save,
    // seconds apart.
    //
    // It is not an error and nothing is wrong. It is the lock working.
    if (booked.reason === 'already_claimed') return { customer, order: null };

    // THE CARD IS KEPT AND THE PICKUP IS NOT BOOKED. Neil's rule for exactly
    // this: the time has passed or another booking rule now refuses it, so we
    // hold onto the payment method and ask them to choose another time. The
    // intent stays open, which is what lets them do that without starting over.
    //
    // It says WHICH pickup it could not make, because "pick another time" with
    // no day in it reads as a system that has lost track of them.
    const asked = booking.readableDate(intent.pickup_date);
    await sendAndLog(
      customer.phone,
      `Card saved: ${card}.${settledLine} We could not hold ${
        asked ? asked : 'that pickup'
      } though - ${
        booked.say || booked.detail || 'that time has gone'
      } Pick another time at ${site.domain}/account and we will get you booked.`,
      customer.id
    );

    return { customer, order: null };
  }

  if (settled.length > 0) {
    await sendAndLog(
      customer.phone,
      `Card saved: ${card}.${settledLine} Thanks.`,
      customer.id
    );
    return { customer, order: null };
  }

  // Finish the booking they were in the middle of.
  //
  // Somebody adding a card is almost always partway through arranging a
  // pickup. Before this, they got "card saved" and nothing else, and the
  // pickup they had just asked for was left unconfirmed with no sign that
  // anything was missing. That happened to a real customer.
  // Every booking they are waiting on, not just the soonest. A customer
  // can have several now, and one card covers all of them - confirming one
  // and quietly leaving the rest unconfirmed would keep them off the
  // driver's run sheet with nothing to say why.
  const allPending = await orders.findAllAwaitingCollection(customer.id);
  const pending = allPending[0] || null;

  // Nothing is charged here. The card being on file is the whole of what
  // was missing, so saving it confirms the booking outright and the money
  // waits for the scale like every other order.
  if (pending) {
    // The confirmation names the card itself, so the opener must not name
    // it again - a real customer got the card number twice in one text.
    //
    // The others go in the SAME message rather than one text each. A card
    // covers all of them, and three texts arriving at once for one action
    // is both a bill and a complaint waiting to happen.
    const rest = allPending.slice(1);
    const alsoLine = rest.length
      ? ' Your other pickup' +
        (rest.length === 1 ? ' is' : 's are') +
        ' booked too: ' +
        rest.map((o) => booking.readableDate(o.pickup_date)).join(', ') +
        '.'
      : '';

    // WAS THIS ONE FREE. Looked up rather than passed in, because this
    // confirmation is sent by the webhook long after bookPickup() returned
    // - the order was written first and the card saved afterwards, which is
    // the whole shape of this path. Getting it wrong here would quote a
    // price for an order that took one of the free slots.
    const free = await promotions
      .claimedFreeOrder(pending.id)
      .catch(() => ({ freeOrder: false, freeUpToLb: null }));

    await sendAndLog(
      customer.phone,
      booking.confirmationMessage(customer, pending, {
        opener: 'Card saved',
        freeOrder: free.freeOrder,
        freeUpToLb: free.freeUpToLb,
      }) + alsoLine,
      customer.id
    );
    return { customer, order: pending };
  }

  await sendAndLog(
    customer.phone,
    `Card saved: ${card}. Text us whenever you want a pickup.`,
    customer.id
  );
  return { customer, order: null };
}

module.exports = { claim: linkFor, cardWasSaved };
