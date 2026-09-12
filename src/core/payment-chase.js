'use strict';

// ---------------------------------------------------------------------------
// A DECLINED CARD GETS CHASED ONCE, THE DAY AFTER THE LAUNDRY GOES BACK.
//
// Order #2060, 12 September: the laundromat weighed it, the bank refused
// $84.00, the customer was texted the total and a link, and then nothing else
// in the system ever asked about that order again. If they did not act on that
// one message, the money was gone unless Neil happened to remember it.
//
// The link itself usually works: saving a card runs billing.retryOutstanding()
// and the balance settles with nothing else asked of anybody. This is for the
// person who read the text on a doorstep, meant to sort it out, and did not.
//
// IT IS A MESSAGE, NOT A RETRY. Charging the same refused method again on a
// timer is dunning, and dunning is a thing you decide to build rather than a
// thing that appears as a side effect of a reminder. The button on the order
// page is how a person retries, at the moment they have a reason to.
//
// AFTER DELIVERY, NEVER BEFORE. This is the rule worth defending here. A
// declined card never holds up a delivery - that is a deliberate business
// decision recorded in CLAUDE.md - and a payment chase that lands while the
// customer is still waiting for their laundry reads as exactly the opposite:
// pay up and then you get your clothes. So the sweep waits for DELIVERED, and
// then waits a day on top.
//
// ONE CHASE, EVER, PER ORDER. `orders.payment_chase_sent_at` (migration 0091)
// is what makes a second one impossible rather than merely discouraged, the
// same shape as card_link_sent_at and reminder_sent_at. Somebody who has read
// it and not acted does not need it twice; past that it is a phone call from a
// person, not another text from a machine.
// ---------------------------------------------------------------------------

const db = require('../db');
const billing = require('./billing');
const { sendAndLog } = require('./notify');

// A day after the laundry landed. Long enough that it is not arriving on top
// of the delivery text, short enough that the order is still something the
// customer remembers.
const WAIT_HOURS = Number(process.env.PAYMENT_CHASE_HOURS || 24);

// ---------------------------------------------------------------------------
// Which orders are owed money and have not been asked twice.
// ---------------------------------------------------------------------------
async function due({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - WAIT_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('orders')
    .select('id, order_number, price_cents, payment_status, delivered_at, customers(*)')
    .eq('payment_status', 'FAILED')
    .eq('status', 'DELIVERED')
    .is('payment_chase_sent_at', null)
    .not('price_cents', 'is', null)
    .not('delivered_at', 'is', null)
    .lt('delivered_at', cutoff)
    .order('delivered_at', { ascending: true })
    .limit(50);

  if (error) throw error;

  return (data || []).filter((order) => {
    const customer = order.customers;
    if (!customer) return false;

    // Nothing owed is nothing to chase. A promotion that took the total to
    // nothing, or a price corrected down to zero, would otherwise be chased
    // for $0.00.
    if (!order.price_cents || order.price_cents <= 0) return false;

    // sendAndLog() refuses an opted-out number anyway - it is the last gate and
    // it fails closed - but there is no reason to mint a Stripe session for
    // somebody we are not allowed to text.
    if (customer.status === 'UNSUBSCRIBED') return false;

    return true;
  });
}

// ---------------------------------------------------------------------------
// WHAT THEY READ, WRITTEN IN CODE.
//
// Same rule as the nudges and the lead message: these words go to somebody who
// has not just texted us, so they are words a person has read, and the segment
// count is knowable before anything is sent. The AI never writes an unprompted
// message about money.
//
// It does not repeat the weight or the arithmetic. All of that was in the text
// they got at the weigh-in; the one new fact is that it is still outstanding.
// ---------------------------------------------------------------------------
function chaseMessage(order, url) {
  return (
    `Quick one about order #${order.order_number}: the ${billing.money(order.price_cents)} ` +
    `payment did not go through, so nothing has been taken yet. ` +
    `You can settle it here: ${url}`
  );
}

// ---------------------------------------------------------------------------
// Send the ones that are due.
//
// STAMPED AFTER THE SEND, never before. A stamp that went first would mark an
// order chased while the carrier was down and nobody would ever be told;
// sent-but-unstamped costs one duplicate and only if the process dies between
// the two lines. Same trade reminder_sent_at makes, in the same direction.
//
// One at a time rather than a burst: a run of identical messages leaving at
// once reads as spam to a carrier, and sendAndLog() writes each as it goes, so
// a failure halfway through still leaves an accurate record of who was texted.
// ---------------------------------------------------------------------------
async function sendDue({ now = new Date() } = {}) {
  const sent = [];
  const skipped = [];

  const waiting = await due({ now });

  for (const order of waiting) {
    const customer = order.customers;

    try {
      // A FRESH LINK EVERY TIME. The one they were given at the weigh-in is a
      // Stripe session and those expire after a day, which is exactly how long
      // this sweep has been waiting - so reusing it would send somebody to a
      // dead page.
      const { url } = await billing.createSetupLink(customer);

      const message = chaseMessage(order, url);
      // SYSTEM, because a person pressed no button and the AI wrote no word:
      // it goes out because of something WE did. Only 'AI' earns a follow-up
      // chase, so labelling it keeps the chase sweep from treating a payment
      // reminder as a question somebody failed to answer.
      const result = await sendAndLog(customer.phone, message, customer.id, { kind: 'SYSTEM' });

      if (result && result.refused) {
        skipped.push({ order: order.order_number, reason: result.reason || 'refused' });
        continue;
      }

      await stamp(order.id);
      sent.push({ order: order.order_number, cents: order.price_cents });
    } catch (err) {
      console.error(`Could not chase the payment on #${order.order_number}: ${err.message}`);
      skipped.push({ order: order.order_number, reason: err.message });
    }
  }

  return { sent, skipped };
}

async function stamp(orderId) {
  const { error } = await db
    .from('orders')
    .update({ payment_chase_sent_at: new Date().toISOString() })
    .eq('id', orderId);

  if (error) console.error('Could not stamp a payment chase:', error.message);
}

module.exports = { WAIT_HOURS, due, chaseMessage, sendDue, stamp };
