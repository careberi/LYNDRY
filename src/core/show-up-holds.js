'use strict';

// ---------------------------------------------------------------------------
// THE NIGHT BEFORE, EVERY PICKUP GETS A HOLD THAT WILL STILL BE THERE.
//
// Neil, 14 September, on the gap in the $25 show-up hold: a booking made a
// fortnight out reaches the doorstep with nothing held, because Stripe expires
// an uncaptured authorization on its own - usually at seven days and sometimes
// sooner. The driver weighs the bags, the capture fails, and the card has to be
// charged the whole amount cold. Which is exactly the thing holding the $25 was
// meant to have tested days earlier, on a morning when saying no cost nothing.
//
// So this runs on the nightly pass, between booking tomorrow's standing orders
// and reminding everybody: any pickup happening tomorrow whose hold has gone
// stale - or which never had one - gets a fresh one placed now.
//
// IT RUNS BEFORE THE REMINDERS AND THAT ORDERING IS THE POINT. A card that
// refuses tonight takes the stop off tomorrow's round, and a reminder telling
// somebody to put the bag out at eight in the morning for a van that is not
// coming is the precise failure the reminder gate exists to prevent. Running
// after would send that text and then quietly remove the stop behind it.
//
// IT IS THE LAST HONEST MOMENT TO FIND OUT. Everything before it is a guess
// about a card days ahead of when it matters; everything after it is a driver
// at a door. The customer still has an evening to fix it, which is the whole
// reason a reminder goes out the night before rather than at six in the
// morning.
//
// NOTHING HERE TAKES MONEY. A hold is held, not taken, and releasing a stale
// one before replacing it means a customer never has two of ours pending at
// once.
// ---------------------------------------------------------------------------

const db = require('../db');
const { config } = require('../config');
const booking = require('./booking');
const billing = require('./billing');
const orders = require('./orders');
const promotions = require('./promotions');
const events = require('./order-events');
const { sendAndLog } = require('./notify');

// Everything showUpState(), holdIsFresh() and the hold itself read. An
// unselected column reads as undefined, which here would make every hold look
// stale and re-authorize the whole board every night.
const FIELDS =
  'id, order_number, pickup_date, pickup_window_start, pickup_window_end, ' +
  'status, payment_status, placed_via, customer_id, ' +
  'authorization_intent_id, authorized_cents, authorized_at, ' +
  'authorization_refused_at, authorization_refused_reason, authorization_attempts, ' +
  'customers(id, name, phone, status, stripe_customer_id, default_payment_method_id, ' +
  'card_brand, card_last4)';

// Tomorrow's pickups that are still waiting for a van.
async function due({ date = null } = {}) {
  const target = date || booking.addDays(booking.today(), 1);

  const { data, error } = await db
    .from('orders')
    .select(FIELDS)
    .eq('pickup_date', target)
    .in('status', orders.AWAITING_COLLECTION);

  if (error) throw error;
  return data || [];
}

// WHY THIS ONE IS BEING LEFT ALONE, as a word rather than a boolean, because
// most of tomorrow's board is skipped on purpose and "we never got to it" and
// "there was nothing to do" are different answers.
//
// PURE, AND `free` IS HANDED IN. Asking the promotions table per order would be
// a round trip per pickup on a pass that has to finish inside an evening -
// refreshDue() asks once for the whole board, the same shape as
// promotions.expectedForMany(). It also means every one of these rules can be
// checked without a database, which is the standing rule for this codebase.
function skipReason(order, free = new Set()) {
  const customer = order.customers;

  if (!customer || !customer.phone) return 'no customer';

  // They asked us to stop. Nothing here texts them, but a hold on somebody who
  // has opted out is money held against a pickup we should be looking at by
  // hand anyway.
  if (customer.status === 'UNSUBSCRIBED') return 'opted out';

  // Nothing to hold against. A waived order is collected as normal - nothing to
  // charge is not the same as cannot charge - and holding $25 on somebody told
  // "nothing to pay" is the contradiction that rule exists to prevent.
  if (order.payment_status === 'WAIVED' || order.payment_status === 'PAID') {
    return 'nothing to hold';
  }

  // No card at all is the AWAITING CARD path, which has its own gate, its own
  // badge and its own chase. Asking a card that does not exist would record a
  // refusal that never happened.
  if (billing.needsCardOnFile(customer)) return 'no card on file';

  // A FREE ORDER IS ASKED FOR NOTHING, the same rule bookPickup() follows. It
  // is read off the claim rather than stored on the order, because the
  // promotion is claimed against the order and the answer can change after the
  // booking.
  if (free.has(order.id)) return 'free order';

  // The hold placed at booking is still going to be there at the door, which is
  // the ordinary case for anything booked inside the last few days.
  if (billing.holdIsFresh(order)) return 'hold is fresh';

  return null;
}

// Replace one order's hold. Releases whatever is there first, so a customer
// never carries two of ours pending at once.
async function refresh(order) {
  const customer = order.customers;
  const wasRefused = billing.showUpState(order) === 'REFUSED';

  // A STALE HOLD IS LET GO BEFORE A NEW ONE IS PLACED. releaseShowUp() clears
  // the id whether or not Stripe accepted the cancel, because a hold Stripe has
  // already expired must not sit on the order looking capturable - the door
  // would try to take money that is not held.
  if (billing.showUpHold(order)) {
    await billing.releaseShowUp(order).catch((err) => {
      console.error(`Could not release the stale hold on ${order.id}: ${err.message}`);
    });

    order.authorization_intent_id = null;
  }

  const placed = await billing.authorizeShowUp(order, customer);

  if (placed.held) {
    await events
      .record(order.id, {
        kind: 'PAYMENT',
        summary: `Held ${billing.money(placed.amountCents)} again for tomorrow's pickup`,
        became: billing.money(placed.amountCents),
        by: { actor: 'system' },
        reason: wasRefused
          ? 'The card had refused before and has now accepted'
          : 'The hold placed at booking would have expired before the door',
      })
      .catch(() => null);

    return { ok: true, held: true, order };
  }

  if (!placed.refused) return { ok: false, reason: placed.skipped || 'not placed' };

  await events
    .record(order.id, {
      kind: 'PAYMENT',
      summary: 'The card refused the hold for tomorrow',
      became: 'refused',
      by: { actor: 'system' },
      reason: placed.reason || null,
    })
    .catch(() => null);

  // THEY ARE TOLD, AND ONLY IF THIS IS NEWS. An order already refused at
  // booking has had this message; sending it again the night before every
  // pickup would be the system repeating itself at somebody who already knows
  // and has chosen not to act.
  //
  // When it IS news it is the most useful text of the night: the van was coming
  // in the morning and now it is not, and they have an evening to fix it.
  if (!wasRefused && customer && customer.status !== 'UNSUBSCRIBED') {
    const url = billing.wantsPaymentLink(order)
      ? await billing
          .createSetupLink(customer)
          .then((r) => r.url)
          .catch(() => null)
      : null;

    await sendAndLog(
      customer.phone,
      booking.holdRefusedMessage(customer, order, { setupUrl: url }),
      customer.id
    ).catch((err) => console.error(`Could not text the refused hold: ${err.message}`));
  }

  return { ok: false, refused: true, told: !wasRefused, order };
}

// THE SWEEP. Safe to run twice: a hold placed a minute ago reads as fresh, so a
// second pass finds nothing to do.
async function refreshDue({ date = null } = {}) {
  const held = [];
  const refused = [];
  const skipped = [];

  // Off where Stripe is not configured at all, rather than one refusal per
  // order. Same fail-open rule the card gate keeps: a sandbox with no key must
  // never quietly empty a day's round.
  if (!config.stripe.secretKey) {
    return { held, refused, skipped, reason: 'payments not configured' };
  }

  const pickups = await due({ date });

  // ONE QUERY FOR THE WHOLE PASS, before the loop - the same rule the reminder
  // sweep follows. It fails CLOSED here rather than open: an unreadable
  // promotion ledger means we cannot tell which pickups are free, and placing
  // $25 on somebody who was told "nothing to pay" is worse than replacing no
  // holds tonight.
  const free = await promotions.freeOrderIds(pickups.map((o) => o.id));

  for (const order of pickups) {
    try {
      const reason = skipReason(order, free);
      if (reason) {
        skipped.push({ order, reason });
        continue;
      }

      const result = await refresh(order);

      if (result.held) held.push(order);
      else if (result.refused) refused.push(order);
      else skipped.push({ order, reason: result.reason });
    } catch (err) {
      // ONE ORDER MUST NOT END THE PASS. The reminders run after this, and a
      // throw here would take the whole evening's texts with it.
      console.error(`Could not refresh the hold on ${order.id}: ${err.message}`);
      skipped.push({ order, reason: err.message });
    }
  }

  return { held, refused, skipped };
}

module.exports = { refreshDue, due, skipReason, refresh, FIELDS };
