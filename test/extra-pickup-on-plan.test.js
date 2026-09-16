'use strict';

// ---------------------------------------------------------------------------
// AN EXTRA PICKUP ON AN EXISTING PLAN.
//
// Neil, 16 September: a subscriber wants a stop this week their plan does not
// cover, and it should be ON the plan - $1.80 a pound, counted under it -
// rather than a one-time pickup beside it.
//
// IT READS LIKE A REVERSAL OF "AN EXTRA PICKUP IS $2.00" AND IS NOT. Migration
// 0096 wrote both cases down when subscription_id was added:
//
//   a subscriber books a pickup and says nothing   one-time rate, no plan
//   somebody deliberately adds one TO the plan     plan's rate, on the plan
//
// The difference is whether the plan was chosen FOR THAT PICKUP, which is
// "never enrolled by accident" read from the other end. A text saying "can you
// come Thursday too" chooses nothing and stays $2.00. A button with "on this
// plan" written on it is the choosing.
//
// The must-nots, each of which is a way somebody pays the wrong price:
//
//   no plan, no button       a one-time customer cannot reach $1.80 at all
//   the plan must be theirs  a posted id is not trusted
//   the plan must be live    an ENDED one prices nothing
//   cancelling is local      calling the extra stop off leaves the plan running
//
// Nothing here touches the database, Stripe or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const subscription = require('../src/core/subscription');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const ADMIN = SRC('routes', 'admin.js');

const routeBody = () => {
  const at = ADMIN.indexOf("'/ops/customers/:id/extra-pickup'");
  assert.notEqual(at, -1, 'the extra-pickup route has gone');
  return ADMIN.slice(at, ADMIN.indexOf("router.post('/ops/customers/:id/opt-out'", at));
};

const cardBody = () => {
  const at = ADMIN.indexOf('function extraPickupCard');
  assert.notEqual(at, -1, 'the extra-pickup card has gone');
  return ADMIN.slice(at, ADMIN.indexOf('function cancelCard', at));
};

// --- the price ---------------------------------------------------------------

test('THE EXTRA PICKUP IS PRICED BY THE PLAN, NOT BY THE CUSTOMER', () => {
  // Nothing in the route prices anything. It passes the plan id, and
  // orders.create() reads the rate off it - so $1.80 arrives because the id
  // did, and a bad id gives $2.00 rather than some other plan's rate.
  const body = withoutComments(routeBody());

  assert.match(body, /subscriptionId: plan\.id/, 'the route does not pass the plan');
  assert.ok(!/price_per_lb_cents/.test(body), 'the route prices the order itself');
  assert.ok(!/180|1\.80/.test(body.replace(/subscriptionRate\(\)/g, '')), 'the rate is typed in the route');

  // And the one owner still answers what it always did.
  assert.equal(subscription.rateForCents('a-plan-id'), 180);
  assert.equal(subscription.rateForCents(null), 200);
});

test('and orders.create is still the only thing that writes a rate', () => {
  const orders = withoutComments(SRC('core', 'orders.js'));
  assert.match(orders, /price_per_lb_cents: subscription\.rateForCents\(subscriptionId\)/);
  assert.match(orders, /subscription_id: subscriptionId \|\| null/);
});

test('IT IS NOT MARKED AS SOMETHING THE NIGHTLY PASS MADE', () => {
  // from_schedule says the nightly pass created it; subscription_id says which
  // plan it is priced under. A person pressed this button, so the first is
  // false and the second is set - the exact pair migration 0096 describes.
  const body = withoutComments(routeBody());
  assert.match(body, /fromSchedule: false/, 'the extra pickup claims to be automatic');
});

// --- nobody is enrolled by accident -----------------------------------------

test('A ONE-TIME CUSTOMER HAS NO BUTTON, SO NO PATH TO $1.80', () => {
  // The card draws nothing without an active plan, which is what keeps a
  // one-time customer at $2.00: there is no control to press.
  const body = withoutComments(cardBody());

  assert.match(body, /if \(!active\.length\) return '';/, 'the card draws without a plan');
  assert.match(body, /status === 'ACTIVE'/, 'it does not filter to running plans');
});

test('AND A POSTED PLAN ID IS NOT TRUSTED', () => {
  // A schedule id is a value the browser sent. Looked up against this
  // customer's own plans, or the field is a way to price one person's pickup
  // against somebody else's subscription.
  const body = withoutComments(routeBody());

  assert.match(body, /recurring\.forCustomer\(customer\.id\)/, 'it never loads their own plans');
  assert.match(
    body,
    /schedules\.find\(\(s\) => s\.id === wanted && s\.status === 'ACTIVE'\)/,
    'the posted id is not checked against them'
  );
  assert.match(body, /if \(!plan\)/, 'there is no refusal when it does not match');
});

test('and an admin is the only one who can press it', () => {
  // The line cancelling a pickup and retrying a card already draw: booking
  // somebody a stop they will be charged for is a decision about the customer,
  // not a step in the round.
  assert.match(routeBody().slice(0, 300), /may\('orders\.override'\)/);

  const card = withoutComments(cardBody());
  assert.match(card, /if \(!customer \|\| !mayBook\) return '';/, 'the card ignores permission');
});

// --- every booking rule still applies ---------------------------------------

test('IT GOES THROUGH bookPickup, SO NOTHING IS SKIPPED', () => {
  // The closed sign, the opening date, the service area, the wash preferences,
  // one pickup per day, the promotion slot and the show-up hold are all
  // bookPickup()'s. An admin pressing a button does not get past any of them.
  const body = withoutComments(routeBody());

  assert.match(body, /await booking\.bookPickup\(customer, \{/, 'it does not use the one door');
  assert.ok(!/from\('orders'\)\s*\.insert/.test(body), 'it writes an order itself');
  assert.match(body, /if \(!result\.ok\)/, 'a refusal is not handled');
});

test('and the customer is told, from the same function the other doors use', () => {
  // A booked pickup nobody was told about is a van arriving at a door with no
  // bag out - the mirror of the cancel rule.
  const body = withoutComments(routeBody());

  assert.match(body, /booking\.confirmationMessage\(customer, result\.order/);
  assert.match(body, /notify\s*\n?\s*\.sendAndLog/, 'nothing texts the confirmation');

  // And the screen says when that failed, rather than claiming they were told.
  assert.match(body, /did NOT send/, 'a failed confirmation is reported as success');
});

// --- cancelling the extra stop leaves the plan alone -------------------------

test('CANCELLING THE EXTRA PICKUP CANNOT CANCEL THE PLAN', () => {
  // Structural rather than checked: orders.js is the only thing that may move a
  // status, and it has no idea recurring_schedules exists. There is nothing to
  // remember not to do.
  const orders = withoutComments(SRC('core', 'orders.js'));

  assert.ok(!/recurring_schedules/.test(orders), 'orders.js now touches the plans table');
  assert.ok(!/require\('\.\/recurring'\)/.test(orders), 'orders.js imports recurring');
});

test('and the rate on the extra pickup survives the plan ending', () => {
  // price_per_lb_cents is snapshotted at booking, so nothing afterwards can
  // reprice it - the same reason a customer who subscribes, takes one pickup
  // and cancels the same afternoon keeps $1.80 on it.
  const writers = [];
  for (const file of ['core/orders.js', 'core/booking.js', 'core/fulfilment.js', 'core/billing.js']) {
    const body = withoutComments(SRC(...file.split('/')));
    if (/price_per_lb_cents:/.test(body)) writers.push(file);
  }
  assert.deepEqual(writers, ['core/orders.js'], `price_per_lb_cents is written in ${writers}`);
});

// --- what the screens say ----------------------------------------------------

test('THE CARD NAMES THE PLAN RATE, READ FROM THE ONE OWNER', () => {
  const card = cardBody();

  assert.match(card, /subscription\.subscriptionRate\(\)/, 'the card types a rate of its own');
  assert.ok(!/\$1\.80/.test(card), 'the rate is typed into the markup');
  assert.equal(subscription.subscriptionRate(), '$1.80/lb');
});

test('and it says the plan is not changed by this', () => {
  // Neil: cancelling the extra stop does not cancel the plan. The screen says
  // so before anybody presses it, rather than being a surprise afterwards.
  const card = cardBody();
  assert.match(card, /does\s*\n?\s*not change the plan/, 'the card does not say the plan is untouched');
});

test('ONE CARD, DRAWN ON BOTH SCREENS', () => {
  // A second copy would be a second set of rules about who may book what.
  const calls = (ADMIN.match(/extraPickupCard\(/g) || []).length;
  assert.equal(calls, 3, `expected one definition and two callers, found ${calls}`);

  // The order page sends people back to the order rather than the profile.
  assert.match(ADMIN, /back: `\?order=\$\{encodeURIComponent\(order\.order_number\)\}`/);
});

test('and the customer-facing word is never "recurring order"', () => {
  const card = cardBody();
  assert.ok(!/recurring order|standing order/i.test(card), 'the card uses the internal word');
  assert.equal(subscription.CUSTOMER_WORD, 'Subscription');
});
