'use strict';

const { config } = require('../config');

// ---------------------------------------------------------------------------
// TWO WAYS TO BUY LAUNDRY, AND THE PRICE IS THE DIFFERENCE BETWEEN THEM.
//
// Neil's decision lock, 15 September:
//
//   One-time pickup   $2.00 a pound
//   Subscription      $1.80 a pound, every week, every 2 weeks or every month
//
// This file is the ONE owner of which rate applies and of the words a customer
// reads about it. Everything else - the AI, the website, the ops screens, the
// confirmation text, the reminder - asks here. A second copy of "subscribers
// pay $1.80" is a second rule, and the one that disagreed would be the one
// nobody noticed until a card was charged.
//
// A SUBSCRIPTION IS A STANDING ORDER, NOT A NEW OBJECT. `recurring_schedules`
// already holds one row per arrangement, with ACTIVE / PAUSED / ENDED and a
// cadence counted from an anchor. Subscribing creates one; cancelling ends it;
// pausing pauses it. There is no `subscriptions` table and there must not be.
//
// WHAT MAKES EVERY ONE OF NEIL'S EDGE CASES FALL OUT, and it is one sentence:
// the rate is SNAPSHOTTED ONTO THE ORDER at booking, in
// orders.price_per_lb_cents, which has worked that way since the beginning so
// that changing a price cannot re-price work already done.
//
//   subscribes, one pickup, cancels     the $1.80 is on that order already
//   cancels before the first pickup     no order, nothing to price
//   cancels mid-wash                    the order keeps its own rate
//   cancels on the morning              ordinary cancellation rules, same rate
//   card fails                          the order is untouched, so is its rate
//   changes weekly to fortnightly       same row, same plan, same rate
//
// None of those needed a rule. They needed the rate to be a fact about the
// ORDER rather than a fact about the customer, and it already was.
// ---------------------------------------------------------------------------

// What the customer chose. Written out rather than inferred, because "did they
// mean to subscribe" is the one question that must never be answered by
// accident - see MUST_BE_CHOSEN below.
const PLANS = Object.freeze({
  ONE_TIME: 'ONE_TIME',
  SUBSCRIPTION: 'SUBSCRIPTION',
});

// THE THREE FREQUENCIES, AND THE WORDS FOR THEM.
//
// `cadence` is what recurring_schedules stores and has always stored. `label`
// is what a customer reads and is the only wording anybody may show them.
//
// MONTHLY IS EVERY FOUR WEEKS ON THE SAME WEEKDAY, not the same date each
// month: the route is weekday-based, and a date-based month walks a pickup
// through all seven weekdays over a year. That is 13 pickups a year, not 12.
const FREQUENCIES = Object.freeze([
  Object.freeze({ cadence: 'WEEKLY', label: 'every week' }),
  Object.freeze({ cadence: 'FORTNIGHTLY', label: 'every 2 weeks' }),
  Object.freeze({ cadence: 'MONTHLY', label: 'every month' }),
]);

const CADENCES = Object.freeze(FREQUENCIES.map((f) => f.cadence));

function frequency(cadence) {
  return FREQUENCIES.find((f) => f.cadence === cadence) || null;
}

function frequencyLabel(cadence) {
  const found = frequency(cadence);
  return found ? found.label : null;
}

function isFrequency(cadence) {
  return CADENCES.includes(cadence);
}

// --- what it costs ----------------------------------------------------------

function oneTimeCents() {
  return config.pricing.perPoundCents;
}

function subscriptionCents() {
  return config.pricing.subscriptionPerPoundCents;
}

// THE RATE A PICKUP IS BOOKED AT, and the only function allowed to decide it.
//
// Takes the subscription this pickup belongs to rather than the customer,
// which is the whole of Neil's "do not give a separately booked one-time pickup
// the subscription rate simply because the customer also has an active
// subscription". Belonging is per ORDER. A subscriber booking an extra pickup
// passes nothing here and pays $2.00, exactly as a stranger would.
function rateForCents(subscriptionId) {
  return subscriptionId ? subscriptionCents() : oneTimeCents();
}

// Is this order a subscription order? Read off the order itself, never off the
// customer: the customer's plan today says nothing about what this pickup was
// sold as, and the gap between those two is every edge case Neil listed.
function isSubscriptionOrder(order) {
  return Boolean(order && order.subscription_id);
}

// --- the words --------------------------------------------------------------

function money(cents) {
  return `$${(Math.round(Number(cents) || 0) / 100).toFixed(2)}`;
}

// TWO SHAPES FOR ONE NUMBER, because a screen and a text message do not read
// the same way. "$1.80/lb" is a label beside a heading; "$1.80 a pound" is
// English in the middle of a sentence, which is what every outbound text is.
// Mixing them produced "$1.80/lb a pound" the first time this was written.
function rate(cents) {
  return `${money(cents)}/lb`;
}

function perPound(cents) {
  return `${money(cents)} a pound`;
}

function oneTimeRate() {
  return rate(oneTimeCents());
}

function subscriptionRate() {
  return rate(subscriptionCents());
}

// What a pickup is called wherever one is shown to anybody - a customer, a
// driver, Neil. Two words, used identically everywhere, so an order reads the
// same on a text, in an account and on the board.
function planLabel(order) {
  return isSubscriptionOrder(order) ? 'Subscription' : 'One-time pickup';
}

// NEVER "RECURRING ORDER", AND NEVER "STANDING ORDER".
//
// Neil's rule, and it is about the customer's side only. `recurring_schedules`
// keeps its name, the code keeps saying cadence, and `npm run cron:recurring`
// is untouched - renaming a table to match a marketing word is how a schema
// ends up describing last quarter's positioning. What may never happen is a
// customer reading either phrase.
//
// A test holds every customer-facing string in this file to that.
const CUSTOMER_WORD = 'Subscription';

// The sentence that has to come BEFORE anybody is asked when they want
// collecting. Neil: otherwise the subscription discount is effectively hidden.
//
// Written here rather than in the prompt so the AI, the website and a person on
// the phone all quote the same two rates. The AI is told to use these words;
// the website renders them.
function choiceLines() {
  return [
    `One-Time Pickup, ${oneTimeRate()}`,
    `${CUSTOMER_WORD}, ${subscriptionRate()} with automatic pickup ${FREQUENCIES.map(
      (f) => f.label
    ).join(', ')}`,
  ];
}

// HOW MUCH CHEAPER, AS A PERCENTAGE, DERIVED RATHER THAN TYPED.
//
// "Save 10%" is Neil's copy and it is true of $2.00 against $1.80 - but it is
// true because of those two numbers, and writing it out would make it a third
// copy of a price that silently goes wrong the day either rate moves. A page
// promising 10% while charging 8% is worse than a page promising nothing.
//
// IT ANSWERS NULL RATHER THAN A FRACTION when the saving is not a whole
// number. "Save 11.11%" is not a sentence anybody wants on a checkout screen,
// so the caller drops the clause instead - which is the safe direction: the two
// rates are still shown in full beside it, so nothing is hidden by its absence.
function savingPercent() {
  const full = oneTimeCents();
  const ours = subscriptionCents();

  if (!full || ours >= full) return null;

  const pct = ((full - ours) / full) * 100;
  return Number.isInteger(pct) ? pct : null;
}

// The one-line nudge for a returning one-time customer. Offered ONCE - the
// caller decides that, because only it knows the thread.
function nudgeLine() {
  return `You can also subscribe for ${subscriptionRate()} instead of ${oneTimeRate()}.`;
}

// ---------------------------------------------------------------------------
// THE QUESTION ASKED AFTER A FIRST PAID DELIVERY. Neil's locked wording, 21
// September, sent exactly:
//
//   "Would you like to set up a subscription for every week, every 2 weeks, or
//    once a month? Subscription orders are $1.80/lb instead of $2.00/lb."
//
// THE RATES ARE BUILT, THE FREQUENCIES ARE NOT, and the split is deliberate.
// A rate is a figure that moves with config, and a text quoting a price the
// code no longer charges is the one mistake a subscription offer must never
// make - so the two figures come from the functions that price the order.
// The frequency phrase is Neil's own sentence: he wrote "once a month" where
// FREQUENCIES says "every month", and building it from the labels would send a
// sentence he did not write. Changing the label to match would reach the
// website's radio buttons, its summary and the intake question, which is a
// decision about all of those rather than about this one message.
//
// test/post-delivery-offer.test.js holds the exact string at today's prices.
// ---------------------------------------------------------------------------
function postDeliveryOffer() {
  return (
    'Would you like to set up a subscription for every week, every 2 weeks, or once a month? ' +
    `Subscription orders are ${subscriptionRate()} instead of ${oneTimeRate()}.`
  );
}

// WHETHER THAT QUESTION GOES, and a pure function so every rule can be tested
// without a database. The caller does the lookups and hands in the answers.
//
//   paid           this order was actually charged: PAID and over $0. A waived
//                  order is WAIVED, and a free one is never charged at all -
//                  billing.chargeAtTheDoor() writes nothing for a $0 total, so
//                  it stays UNPAID. Neither is "paid", with no special case
//   paidDeliveries this customer's delivered, paid, over-$0 orders, COUNTING
//                  THIS ONE. Exactly 1 is the first. Earlier free orders do not
//                  count, which is Neil's edge case: a first paid delivery
//                  after promo orders still earns the question, once
//   hasPlan        an ACTIVE standing order. A paused one still counts - pausing
//                  leaves status ACTIVE - and nobody is sold what they have
//   planOrder      this pickup was sold on a plan. Somebody who subscribed and
//                  cancelled before it came back has no schedule left but is
//                  not somebody to pitch a subscription to minutes later
//   quiet          New Jersey quiet hours. The delivered text is a status and
//                  goes whenever the van arrives; this is a sales question
//                  nobody asked, which is what the 8am to 9pm floor exists for
//
// Returns the reason it did not go, because "why did she not get the offer" is
// exactly the question somebody will ask of a log line.
function offerAfterDelivery({ paid, paidDeliveries, hasPlan, planOrder, quiet } = {}) {
  if (!paid) return { send: false, reason: 'not a paid delivery' };
  if (hasPlan) return { send: false, reason: 'already has a plan' };
  if (planOrder) return { send: false, reason: 'this pickup was on a plan' };
  if (paidDeliveries !== 1) return { send: false, reason: `not the first paid delivery (${paidDeliveries})` };
  if (quiet) return { send: false, reason: 'quiet hours' };
  return { send: true, text: postDeliveryOffer() };
}

// What a subscriber is told their pickup costs, on a confirmation or a
// reminder. Names the plan, because Neil's rule is that a subscription order is
// identifiable everywhere - and because a customer seeing $1.80 should be able
// to tell why.
function orderRateLine(order) {
  // OFF THE ORDER, NOT OFF TODAY'S CONFIG. What this pickup was sold at is
  // written on it, and that is the figure the customer was quoted - which is
  // the whole reason cancelling cannot change what they pay.
  return isSubscriptionOrder(order)
    ? `${CUSTOMER_WORD} pickup at ${perPound(order.price_per_lb_cents || subscriptionCents())}.`
    : `${perPound(order.price_per_lb_cents || oneTimeCents())}.`;
}

// --- cancelling -------------------------------------------------------------

// WHAT CANCELLING ACTUALLY DOES, in the words the screen has to show.
//
// Neil: cancelling must clearly show the last active pickup and that no further
// automatic pickups will be created. It must NOT reprice that pickup and must
// NOT cancel it.
//
// `lastPickup` is the date of the pickup already booked, or null when nothing
// is outstanding - which is the "cancels before the first pickup" case, and it
// says something different because there is nothing to reassure them about.
function cancellationLines({ lastPickup = null, rateCents = null } = {}) {
  const kept = perPound(rateCents || subscriptionCents());

  if (!lastPickup) {
    return [
      `Your ${CUSTOMER_WORD.toLowerCase()} is cancelled and no further pickups will be booked.`,
      'Nothing has been charged.',
    ];
  }

  return [
    `Your pickup on ${lastPickup} still goes ahead at ${kept}.`,
    'No further pickups will be booked after that.',
    `You can subscribe again any time at ${subscriptionRate()}.`,
  ];
}

// NOTHING IS OWED FOR ENROLLING, and this is the guard rather than a sentence.
//
// Neil: do not require a cancellation fee, do not retroactively charge $2.00,
// do not require a two-pickup commitment. There is no code anywhere that could
// do any of those - and that is the point of this function existing with
// nothing in it but a constant. Anything that ever wants to charge for leaving
// has to come through here and be argued with.
function cancellationFeeCents() {
  return 0;
}

// --- choosing it deliberately ------------------------------------------------

// A CUSTOMER IS NEVER ENROLLED BY ACCIDENT.
//
// Neil: they must intentionally choose Subscription, and a one-time customer
// must never be enrolled automatically. So the plan is only ever read from an
// explicit value, and anything that is not exactly SUBSCRIPTION is a one-time
// pickup - an unreadable answer, a missing field, a typo, a caller that forgot.
//
// It fails towards the HIGHER price, which is the safe direction: charging
// $2.00 to somebody who meant to subscribe is a conversation, and quietly
// enrolling somebody who did not ask is a chargeback.
function chose(plan) {
  return plan === PLANS.SUBSCRIPTION;
}

// And a subscription needs a frequency. Choosing the plan without one is not a
// choice yet, so it is not a subscription yet.
function chosenWithFrequency({ plan, cadence } = {}) {
  return chose(plan) && isFrequency(cadence);
}

module.exports = {
  PLANS,
  FREQUENCIES,
  CADENCES,
  frequency,
  frequencyLabel,
  isFrequency,
  oneTimeCents,
  subscriptionCents,
  rateForCents,
  isSubscriptionOrder,
  rate,
  perPound,
  money,
  oneTimeRate,
  subscriptionRate,
  planLabel,
  CUSTOMER_WORD,
  choiceLines,
  savingPercent,
  nudgeLine,
  postDeliveryOffer,
  offerAfterDelivery,
  orderRateLine,
  cancellationLines,
  cancellationFeeCents,
  chose,
  chosenWithFrequency,
};
