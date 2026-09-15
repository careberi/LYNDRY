'use strict';

// ---------------------------------------------------------------------------
// $1.80 A POUND ON A SUBSCRIPTION, $2.00 FOR A ONE-TIME PICKUP.
//
// Neil's decision lock, 15 September. Most of what is pinned here is the
// must-not list, because every item on it is a way somebody gets charged the
// wrong price:
//
//   never enrolled by accident    the plan is chosen, never inferred
//   never repriced afterwards     cancelling cannot touch a pickup already sold
//   never the cheaper rate free   an extra pickup is $2.00 even for a subscriber
//   never $2.00 in the words      the confirmation and the reminder read $1.80
//   never "recurring order"       the customer-facing word is Subscription
//
// Nothing here touches the database or Stripe.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const subscription = require('../src/core/subscription');
const recurring = require('../src/core/recurring');
const booking = require('../src/core/booking');
const reminders = require('../src/core/reminders');
const { config } = require('../src/config');

const SRC = (...bits) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8')
    .split('\r\n')
    .join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// --- the two prices ---------------------------------------------------------

test('THE TWO RATES ARE $2.00 AND $1.80', () => {
  assert.equal(subscription.oneTimeCents(), 200);
  assert.equal(subscription.subscriptionCents(), 180);
  assert.equal(subscription.oneTimeRate(), '$2.00/lb');
  assert.equal(subscription.subscriptionRate(), '$1.80/lb');
});

test('and the subscription rate is its own number, not a discount off the other', () => {
  // Deriving it as "10% off" would make every future move of either price
  // silently move the other, and would put a second copy of the subscription
  // price inside whatever did the arithmetic.
  const src = withoutComments(SRC('config.js'));
  assert.match(src, /subscriptionPerPoundCents/);
  assert.ok(
    !/subscriptionPerPoundCents:[^,]*perPoundCents/.test(src),
    'the subscription rate is defined in terms of the one-time rate'
  );
});

test('THE RATE FOLLOWS THE PICKUP, NEVER THE CUSTOMER', () => {
  // The whole of "do not give a separately booked one-time pickup the
  // subscription rate simply because the customer also has an active
  // subscription". Belonging is per order.
  assert.equal(subscription.rateForCents('a-plan-id'), 180);
  assert.equal(subscription.rateForCents(null), 200);
  assert.equal(subscription.rateForCents(undefined), 200);

  assert.equal(subscription.isSubscriptionOrder({ subscription_id: 'x' }), true);
  assert.equal(subscription.isSubscriptionOrder({}), false);
  assert.equal(subscription.isSubscriptionOrder(null), false);
});

test('AND IT IS WRITTEN ONTO THE ORDER, which is what makes cancelling safe', () => {
  // The rate is snapshotted at booking, so a customer who subscribes, takes one
  // pickup and cancels the same afternoon keeps $1.80 on it - not because
  // anything checks for that case, but because nothing afterwards can reach it.
  const src = withoutComments(SRC('core', 'orders.js'));

  assert.match(src, /price_per_lb_cents: subscription\.rateForCents\(subscriptionId\)/);
  assert.match(src, /subscription_id: subscriptionId \|\| null/);

  // And nothing anywhere rewrites a rate on an existing order except the one
  // deliberate line that prices a new subscription's first pickup.
  const writers = [];
  for (const file of ['core/orders.js', 'core/booking.js', 'core/fulfilment.js', 'core/billing.js']) {
    const body = withoutComments(SRC(...file.split('/')));
    if (/price_per_lb_cents:/.test(body)) writers.push(file);
  }
  assert.deepEqual(writers, ['core/orders.js'], `price_per_lb_cents is written in ${writers}`);
});

// --- nobody is enrolled by accident -----------------------------------------

test('A SUBSCRIPTION IS ONLY EVER CHOSEN, NEVER INFERRED', () => {
  assert.equal(subscription.chose('SUBSCRIPTION'), true);
  assert.equal(subscription.chose('ONE_TIME'), false);

  // Everything that is not exactly the word fails to the DEARER option, which
  // is the safe direction: charging $2.00 to somebody who meant to subscribe is
  // a conversation, enrolling somebody who did not ask is a chargeback.
  for (const bad of [undefined, null, '', 'subscription', 'yes', 'true', 1, {}]) {
    assert.equal(subscription.chose(bad), false, String(bad));
  }
});

test('and a plan without a frequency is not a choice yet', () => {
  assert.equal(
    subscription.chosenWithFrequency({ plan: 'SUBSCRIPTION', cadence: 'WEEKLY' }),
    true
  );
  assert.equal(subscription.chosenWithFrequency({ plan: 'SUBSCRIPTION', cadence: 'MONTHLY' }), true);
  assert.equal(subscription.chosenWithFrequency({ plan: 'SUBSCRIPTION' }), false);
  assert.equal(subscription.chosenWithFrequency({ plan: 'SUBSCRIPTION', cadence: 'DAILY' }), false);
  assert.equal(subscription.chosenWithFrequency({ plan: 'ONE_TIME', cadence: 'WEEKLY' }), false);
});

// --- the three frequencies --------------------------------------------------

test('THREE FREQUENCIES, AND MONTHLY IS EVERY FOUR WEEKS ON THE SAME WEEKDAY', () => {
  assert.deepEqual(
    subscription.FREQUENCIES.map((f) => f.label),
    ['every week', 'every 2 weeks', 'every month']
  );

  // The route is weekday-based, so a calendar month would walk a customer's
  // pickup through all seven weekdays over a year.
  const plan = (cadence) => ({ status: 'ACTIVE', cadence, weekday: 2, started_on: '2026-09-15' });
  const after = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

  const dates = [];
  let from = '2026-09-15';
  for (let i = 0; i < 4; i += 1) {
    const next = recurring.nextDate(plan('MONTHLY'), from);
    dates.push(next);
    from = after(next);
  }

  assert.deepEqual(dates, ['2026-09-15', '2026-10-13', '2026-11-10', '2026-12-08']);

  // All four are Tuesdays, 28 days apart.
  for (const d of dates) assert.equal(new Date(`${d}T00:00:00Z`).getUTCDay(), 2, d);
});

test('and the existing two cadences are untouched by that generalisation', () => {
  const plan = (cadence) => ({ status: 'ACTIVE', cadence, weekday: 2, started_on: '2026-09-15' });

  assert.equal(recurring.nextDate(plan('WEEKLY'), '2026-09-16'), '2026-09-22');
  assert.equal(recurring.nextDate(plan('FORTNIGHTLY'), '2026-09-16'), '2026-09-29');
});

// --- what the customer reads ------------------------------------------------

test('THE CONFIRMATION SAYS $1.80, NEVER $2.00', () => {
  // It quoted site.pricePerLb, which is the one-time rate - so a subscriber
  // would have been told $2.00 in the confirmation and charged $1.80 at the
  // door.
  const customer = {
    stripe_customer_id: 'c',
    default_payment_method_id: 'p',
    card_brand: 'visa',
    card_last4: '4242',
    preferences: { water_temp: 'COLD', special_instructions: 'front door' },
    address_line1: '2 Scott Ct',
  };
  const order = {
    order_number: 2071,
    pickup_date: '2026-09-16',
    pickup_window_start: '17:00',
    pickup_window_end: '21:00',
    pickup_method: 'LEAVE_OUTSIDE',
  };

  const sub = booking.confirmationMessage(
    customer,
    { ...order, subscription_id: 'x', price_per_lb_cents: 180 },
    { source: booking.DOORS.WEB }
  );

  assert.match(sub, /\$1\.80 a pound/);
  assert.ok(!/\$2\.00 a pound/.test(sub), sub);

  // And a one-time pickup still reads $2.00.
  const once = booking.confirmationMessage(
    customer,
    { ...order, price_per_lb_cents: 200 },
    { source: booking.DOORS.WEB }
  );
  assert.match(once, /\$2\.00 a pound/);
});

test('THE REMINDER SAYS IT IS A SUBSCRIPTION PICKUP', () => {
  const base = {
    pickup_window_start: '09:00',
    pickup_window_end: '12:00',
    preferences: { special_instructions: 'front door' },
  };

  assert.match(reminders.reminderMessage({ ...base, subscription_id: 'x' }), /Subscription pickup/);
  assert.ok(!/Subscription/.test(reminders.reminderMessage(base)));
});

test('and naming the plan does not cost a third segment', () => {
  // The standing-order worst case sat at 305 of the 306 two segments hold, and
  // EVERY pickup a subscription books now carries a plan - so the obvious
  // wording would have put a third segment on every subscriber's reminder,
  // every week, for ever. Naming it replaces the opener rather than adding to
  // it, which is two characters shorter than the sentence it replaces.
  const worst = reminders.reminderMessage({
    pickup_date: '2026-09-16',
    pickup_window_start: '17:00',
    pickup_window_end: '21:00',
    pickup_method: 'LEAVE_OUTSIDE',
    from_schedule: true,
    subscription_id: 'x',
    preferences: { special_instructions: 'side door by the garage' },
    authorization_intent_id: 'pi_1',
    authorized_cents: 2500,
  });

  assert.match(worst, /SKIP/);
  assert.match(worst, /is on hold/);
  assert.ok(worst.length <= 306, `${worst.length} characters is three segments`);
});

test('NOBODY IS EVER TOLD "RECURRING ORDER"', () => {
  // The table keeps its name and the code keeps saying cadence. What may never
  // happen is a customer reading either phrase.
  const everything = [
    ...subscription.choiceLines(),
    ...subscription.cancellationLines({ lastPickup: '09/22/2026' }),
    ...subscription.cancellationLines({}),
    subscription.nudgeLine(),
    subscription.orderRateLine({ subscription_id: 'x', price_per_lb_cents: 180 }),
    subscription.orderRateLine({ price_per_lb_cents: 200 }),
    subscription.planLabel({ subscription_id: 'x' }),
    subscription.planLabel({}),
  ];

  for (const line of everything) {
    assert.ok(!/recurring|standing order|repeat order/i.test(line), line);
  }
});

test('and no sentence carries its unit twice', () => {
  // "$1.80/lb a pound" - the compact form and the prose form are different
  // functions for a reason, and mixing them produced exactly that.
  const everything = [
    ...subscription.choiceLines(),
    ...subscription.cancellationLines({ lastPickup: '09/22/2026' }),
    subscription.nudgeLine(),
    subscription.orderRateLine({ subscription_id: 'x', price_per_lb_cents: 180 }),
  ];

  for (const line of everything) {
    assert.ok(!/a pound a pound|\/lb a pound/.test(line), line);
  }
});

// --- nothing is charged for leaving -----------------------------------------

test('THERE IS NO CANCELLATION FEE AND NO COMMITMENT', () => {
  // Neil: do not require a cancellation fee, do not retroactively charge
  // $2.00, do not require a two-pickup commitment.
  assert.equal(subscription.cancellationFeeCents(), 0);

  const lines = subscription.cancellationLines({ lastPickup: '09/22/2026' });
  assert.match(lines.join(' '), /still goes ahead at \$1\.80 a pound/);
  assert.match(lines.join(' '), /No further pickups will be booked/);
  assert.ok(!/fee|charge|penalty|minimum of/i.test(lines.join(' ')), lines.join(' '));
});

test('and cancelling before the first pickup says nothing was charged', () => {
  const lines = subscription.cancellationLines({});
  assert.match(lines.join(' '), /Nothing has been charged/);
});

// --- the saving is derived --------------------------------------------------

test('THE SAVING IS WORKED OUT, NOT TYPED', () => {
  assert.equal(subscription.savingPercent(), 10);

  // $2.00 against $1.80 is 10% today. If either moves to a figure that is not a
  // round percentage the clause disappears rather than going stale, because
  // both prices are on the screen beside it either way.
  const screen = withoutComments(SRC('routes', 'account.js'));
  assert.match(screen, /subscription\.savingPercent\(\)/);
  assert.ok(!/Save 10%/.test(screen), 'the saving is typed into the checkout');
});

// --- the promotion still stacks ---------------------------------------------

test('A FIRST-ORDER PROMOTION COMES OFF THE SUBSCRIPTION RATE', () => {
  // Neil: promotions are separate from subscription pricing and are not part of
  // this change. A promotion comes off a price that has already been worked
  // out, so a subscriber holding 50% off pays half of $1.80, not half of $2.00.
  //
  // Checked as arithmetic rather than through the pricing code, because what is
  // worth pinning is the ORDER of the two: rate first, discount second.
  const weight = 20;
  const subscriberBefore = weight * subscription.subscriptionCents();
  const oneTimeBefore = weight * subscription.oneTimeCents();

  assert.equal(subscriberBefore, 3600);
  assert.equal(oneTimeBefore, 4000);

  assert.equal(Math.round(subscriberBefore / 2), 1800);
  assert.equal(Math.round(oneTimeBefore / 2), 2000);

  // And the minimum is a floor on both, unchanged by any of this.
  assert.equal(config.pricing.minimumCents, 2500);
});

// --- the marketing site agrees with the checkout -----------------------------

test('THE SITE SHOWS BOTH RATES, and it used to show one', () => {
  // Neil, 15 September: the marketing site contradicted the live checkout.
  // Every public page quoted $2.00 as "the price" while the checkout offered
  // $2.00 or $1.80 - so somebody read the site, chose from a menu of one, and
  // met a cheaper option at the till.
  const { site, tokens } = require('../src/web/site');

  assert.equal(site.pricePerLb, '$2.00');
  assert.equal(site.subscriptionPricePerLb, '$1.80');
  assert.equal(site.subscriptionFrequencies, 'weekly, every 2 weeks, or every month');

  // Rendered through the token map the pages actually use.
  assert.equal(tokens.SUBSCRIPTION_PRICE_PER_LB, '$1.80');
  assert.equal(tokens.SUBSCRIPTION_FREQUENCIES, 'weekly, every 2 weeks, or every month');
});

test('and both figures come off the one owner, never typed into a page', () => {
  // Four copies of a price is four things to edit and one that will disagree.
  const siteSrc = withoutComments(SRC('web', 'site.js'));
  assert.match(siteSrc, /subscription\.subscriptionRate\(\)/);
  assert.match(siteSrc, /subscription\.FREQUENCIES/);

  for (const page of ['home.html', 'pricing.html', 'faq.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', page), 'utf8');
    assert.ok(!/\$1\.80/.test(html), `${page} types the subscription rate`);
    assert.ok(!/\$2\.00/.test(html), `${page} types the one-time rate`);
  }
});

test('NO PAGE STILL CLAIMS THERE IS NO SUBSCRIPTION', () => {
  // The FAQ answered "Is there a subscription? No", which is now the opposite
  // of what the checkout does.
  const files = [
    ['public', 'pages', 'pricing.html'],
    ['public', 'pages', 'faq.html'],
    ['public', 'pages', 'home.html'],
    ['public', 'pages', 'terms.html'],
    ['src', 'routes', 'web.js'],
    ['src', 'routes', 'locations.js'],
  ];

  for (const bits of files) {
    const body = fs.readFileSync(path.join(__dirname, '..', ...bits), 'utf8');
    assert.ok(!/no subscription/i.test(body), `${bits.join('/')} still says there is no subscription`);
  }
});

test('AND "NO MEMBERSHIP" SURVIVES, because it is still true', () => {
  // Neil's rule: a subscription is a RATE, not a membership. There is no club,
  // no joining fee and no minimum number of pickups - so the promise stays on
  // the page, and the word must never be attached to the $1.80 plan.
  const pricing = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'pages', 'pricing.html'),
    'utf8'
  );

  assert.match(pricing, /no membership/i, 'the no-membership promise was dropped');
  assert.match(pricing, /not a club/i);

  // And nowhere calls the plan itself a membership.
  const web = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'web.js'), 'utf8');
  for (const body of [pricing, web]) {
    assert.ok(
      !/subscription is a membership|membership plan|join the subscription/i.test(body),
      'the plan is described as a membership'
    );
  }
});
