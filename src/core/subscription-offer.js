'use strict';

const db = require('../db');
const booking = require('./booking');
const recurring = require('./recurring');
const subscription = require('./subscription');
const aiPause = require('./ai-pause');
const { sendAndLog } = require('./notify');

// ---------------------------------------------------------------------------
// THE SUBSCRIPTION QUESTION AFTER A FIRST PAID DELIVERY - WHEN IT GOES.
//
// Neil's locked wording, in subscription.postDeliveryOffer(), and his rule for
// whether it goes, in subscription.offerAfterDelivery(). This file gathers the
// facts that rule needs and sends it - straight after the delivery text, or,
// for a delivery that happened in quiet hours, first thing next morning.
//
// "DO NOT SKIP THE SUBSCRIPTION ASK AFTER 9PM." Neil, 21 September: "Send it
// with delivery or first thing next morning." Until then a late delivery
// dropped it for ever - "once" is counted off the orders, so the next paid
// delivery counts two and is refused.
//
// THE MORNING, NOT THE DELIVERY TEXT, and that choice is the law rather than a
// preference. The 8am to 9pm floor on unprompted texts is what scheduler.js
// calls "the law, not a preference", and this is the one unprompted SALES
// question in the system. Riding it on a status text at ten at night would make
// that status text a sales message sent in quiet hours. Neil offered either;
// this is the one that keeps the floor.
//
// ITS OWN FILE because it has two callers that must not know each other:
// fulfilment.deliver() for the daytime send, and scheduler.tick() for the
// morning one. fulfilment.js already requires scheduler.js, so a sweep living
// in fulfilment.js would close a loop and hand the scheduler half a module.
// This one requires neither of them.
// ---------------------------------------------------------------------------

// Quiet hours are the scheduler's to define. Required when asked, not at
// load: scheduler.js requires this file, and by the time anything here runs
// both are loaded.
function inQuietHours(when) {
  return require('./scheduler').inQuietHours(when);
}

// WAS THE VAN AT THE DOOR IN QUIET HOURS? Judged from delivered_at - the
// moment transition() stamps - by BOTH the daytime path and the morning sweep,
// so a delivery at 8:59:59pm cannot be deferred by one and missed by the other.
function deliveredInQuietHours(order) {
  const clock = booking.serviceClockOf((order && order.delivered_at) || new Date());
  return clock ? inQuietHours(clock) : false;
}

// Everything offerAfterDelivery() needs, read off the database.
//
// "FIRST PAID" IS COUNTED, NOT STORED: DELIVERED, PAID and over $0, which
// counts this order because it is already DELIVERED by the time either caller
// asks. Free and waived orders are $0 or WAIVED and never count, so a paid
// delivery after free ones counts one.
async function factsFor(order, customer, { quiet } = {}) {
  const paid = order.payment_status === 'PAID' && Number(order.price_cents) > 0;

  let paidDeliveries = 0;
  let hasPlan = false;
  if (paid) {
    // FIRST AS OF THIS DELIVERY, not as of now. A 9:30pm delivery waits for
    // the morning; if a second paid one lands at 7:45am, counting everything
    // would make the evening one second, the morning one second, and nobody
    // would ever be asked. alreadyAsked() still stops both going.
    let query = db
      .from('orders')
      .select('id')
      .eq('customer_id', customer.id)
      .eq('status', 'DELIVERED')
      .eq('payment_status', 'PAID')
      .gt('price_cents', 0);
    if (order.delivered_at) query = query.lte('delivered_at', order.delivered_at);
    const { data: rows, error } = await query;
    if (error) throw error;
    paidDeliveries = (rows || []).length;

    // Anything not ENDED is a plan, paused ones included: somebody who has
    // paused a weekly pickup has a plan and knows it.
    hasPlan = (await recurring.forCustomer(customer.id)).length > 0;
  }

  return {
    paid,
    paidDeliveries,
    hasPlan,
    planOrder: subscription.isSubscriptionOrder(order),
    quiet: quiet != null ? quiet : deliveredInQuietHours(order),
  };
}

// HAS THIS NUMBER ALREADY BEEN ASKED SINCE THE DELIVERY?
//
// What keeps the morning sweep to one send across ten-minute ticks. The
// question carries asked_for 'service_type' - which is what it is, a question
// about one-time against subscription - so the intake table also shows it as
// asked and awaiting a reply. The two worded checks catch the question sent
// without that label, and the older offer that used to ride on the end of the
// delivery text, so nobody delivered on the old code gets both.
async function alreadyAsked(phone, since) {
  const base = () =>
    db
      .from('messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'OUTBOUND')
      .gte('created_at', since)
      .limit(1);

  for (const query of [
    base().eq('asked_for', 'service_type'),
    base().ilike('body', '%set up a subscription%'),
    base().ilike('body', '%make this a regular thing%'),
  ]) {
    const { data, error } = await query;
    if (error) throw error;
    if ((data || []).length) return true;
  }
  return false;
}

// The send itself. SYSTEM, so it is never chased. A person working the thread
// by hand is not talked over - isPaused() fails closed, which here means no
// question. sendAndLog() refuses an opted-out number on its own.
async function send(customer, text) {
  if (await aiPause.isPaused(customer.phone)) return { sent: false, reason: 'a person has this thread' };

  const refused = await sendAndLog(customer.phone, text, customer.id, {
    kind: 'SYSTEM',
    askedFor: 'service_type',
  });
  return refused && refused.sent === false
    ? { sent: false, reason: `refused: ${refused.refused}` }
    : { sent: true, text };
}

// Called by fulfilment.deliver() once the delivery text has gone. A delivery
// in quiet hours is deferred to sendDue(), never dropped. Never throws.
async function afterDelivery(order, customer) {
  if (!order || !customer || !customer.id || !customer.phone) return { sent: false, reason: 'no customer' };

  try {
    const verdict = subscription.offerAfterDelivery(await factsFor(order, customer));
    if (verdict.defer) return { sent: false, deferred: true, reason: verdict.reason };
    if (!verdict.send) return { sent: false, reason: verdict.reason };
    return await send(customer, verdict.text);
  } catch (err) {
    console.error(`Subscription offer for order ${order.id} failed: ${err.message}`);
    return { sent: false, reason: 'error' };
  }
}

// How far back the morning sweep looks. A night's deliveries and a margin: the
// point is last night, never a delivery from last week that nobody meant to
// ask about.
const LOOKBACK_HOURS = 24;

// Is this delivery one the morning sweep should ask about? Pure, so the rule is
// testable: delivered in quiet hours, inside the lookback, and not already
// judged by anything else - the plan and first-paid rules still apply, through
// the same offerAfterDelivery() the daytime path asks.
function isDeferred(order, { now = new Date() } = {}) {
  if (!order || !order.delivered_at) return false;
  const at = new Date(order.delivered_at);
  if (Number.isNaN(at.getTime())) return false;
  if (now.getTime() - at.getTime() > LOOKBACK_HOURS * 3_600_000) return false;
  return deliveredInQuietHours(order);
}

// THE MORNING SWEEP, on the scheduler's ten-minute tick. The tick returns early
// in quiet hours, so this first runs at the first tick after 8am - "first thing
// next morning" with no clock logic of its own.
//
// Everything is asked again at send time rather than remembered from the night
// before: they may have subscribed by text overnight, had a second delivery, or
// been taken over by a person.
//
// OFF OUTSIDE PRODUCTION BECAUSE THE TICK IS. The dev server shares the
// production database; a laptop running this would send through the fake
// provider and leave a row saying they had been asked.
async function sendDue({ now = new Date() } = {}) {
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000).toISOString();

  const { data: rows, error } = await db
    .from('orders')
    .select('id, order_number, customer_id, status, payment_status, price_cents, subscription_id, delivered_at, customers(*)')
    .eq('status', 'DELIVERED')
    .eq('payment_status', 'PAID')
    .gt('price_cents', 0)
    .is('subscription_id', null)
    .gte('delivered_at', since)
    .limit(100);
  if (error) throw error;

  const sent = [];
  const skipped = [];

  for (const order of rows || []) {
    const customer = order.customers;
    if (!customer || !customer.phone) continue;
    if (!isDeferred(order, { now })) continue;

    try {
      const verdict = subscription.offerAfterDelivery(await factsFor(order, customer, { quiet: false }));
      if (!verdict.send) {
        skipped.push({ order: order.order_number, reason: verdict.reason });
        continue;
      }
      if (await alreadyAsked(customer.phone, order.delivered_at)) {
        skipped.push({ order: order.order_number, reason: 'already asked' });
        continue;
      }

      const result = await send(customer, verdict.text);
      (result.sent ? sent : skipped).push({ order: order.order_number, reason: result.reason });
    } catch (err) {
      skipped.push({ order: order.order_number, reason: err.message });
    }
  }

  return { sent, skipped };
}

module.exports = {
  afterDelivery,
  sendDue,
  factsFor,
  alreadyAsked,
  isDeferred,
  deliveredInQuietHours,
  LOOKBACK_HOURS,
};
