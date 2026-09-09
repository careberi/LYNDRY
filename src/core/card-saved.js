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

async function cardWasSaved(link) {
  const customer = await billing.recordSavedCard(link);
  if (!customer) return null;

  const card = billing.describeCard(customer);

  // Anything they already owe gets settled now, without them having to
  // do anything else.
  const settled = await billing.retryOutstanding(customer);

  if (settled.length > 0) {
    await sendAndLog(
      customer.phone,
      `Card saved: ${card}. We've settled the ${billing.money(
        settled.reduce((sum, s) => sum + s.order.price_cents, 0)
      )} outstanding. Thanks.`,
      customer.id
    );
    return customer;
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
    return customer;
  }

  await sendAndLog(
    customer.phone,
    `Card saved: ${card}. Text us whenever you want a pickup.`,
    customer.id
  );
  return customer;
}

module.exports = { claim: linkFor, cardWasSaved };
