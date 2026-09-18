'use strict';

// ---------------------------------------------------------------------------
// A REFUSED HOLD CAN BE RETRIED BY A PERSON.
//
// Neil, 18 September, on order #2073: "uncancel order 2073 and retry the hold."
// The uncancel took seconds. The retry was impossible - three things in the
// system place a $25 show-up hold (bookPickup(), card-saved.js and the nightly
// pass) and every one of them fires on its own. There was no button, no ops
// route and no endpoint, so a customer ringing up to say "try it now, I have
// moved some money across" could not be helped at all.
//
// AND THE ORDER PAGE SAID NOTHING ABOUT IT EITHER. declinedCard() is the card
// that offers a retry, and it returns early without a price_cents - which a
// pickup that has never been weighed does not have. #2073 is exactly that
// shape: hold refused, never collected, never weighed, no price. So the one
// thing keeping the van away was the one thing the page would not mention.
//
// WHAT THIS FILE PINS is the shape rather than the wording: that the lever
// exists, that it is the same function the automatic paths call, that it is
// Admin-only, that it refuses once the van has been, and that it says nothing
// to the customer.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

// A route handler, from its signature to the start of the next one. Routes end
// in `});` rather than a bare brace, so the plain function-body helper used
// elsewhere in this suite does not reach them.
function routeBody(src, signature) {
  const at = src.indexOf(signature);
  assert.notEqual(at, -1, `${signature} has moved`);
  const next = src.indexOf('\nrouter.', at + signature.length);
  assert.notEqual(next, -1, `could not find the end of ${signature}`);
  return src.slice(at, next);
}

function bodyOf(src, signature) {
  const at = src.indexOf(signature);
  assert.notEqual(at, -1, `${signature} has moved`);
  const end = src.indexOf('\n}\n', at);
  assert.notEqual(end, -1, `could not find the end of ${signature}`);
  return src
    .slice(at, end)
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

const ROUTE = "router.post('/ops/orders/:id/authorize'";
const CARD = 'function refusedHoldCard(order, mayRetry) {';

// --- the lever exists at all -------------------------------------------------

test('THERE IS A WAY FOR A PERSON TO RETRY A REFUSED HOLD', () => {
  const admin = SRC('routes', 'admin.js');
  assert.ok(admin.includes(ROUTE), 'the hold retry route is gone');
  assert.ok(admin.includes(CARD), 'the refused-hold card is gone');
});

test('and it is the same function the automatic paths call', () => {
  // Three callers placed a hold before this existed. A fourth that wrote its
  // own would be a second rule about what a hold is, free to disagree.
  const body = routeBody(SRC('routes', 'admin.js'), ROUTE);
  assert.match(body, /billing\.authorizeShowUp\(/, 'the route stopped calling authorizeShowUp');
  assert.ok(
    !/payments\.authorize\(/.test(body),
    'the route talks to the payment provider directly instead of going through billing'
  );
});

// --- who may press it --------------------------------------------------------

test('ADMIN ONLY, like the charge button beside it', () => {
  // Putting a pending charge on somebody's card is a decision about the
  // customer, not a step in the round - the line orders.override already draws.
  const body = routeBody(SRC('routes', 'admin.js'), ROUTE);
  assert.match(body, /may\('orders\.override'\)/, 'the hold retry is no longer Admin only');
});

// --- what it refuses ---------------------------------------------------------

test('THE ROUTE REFUSES PAST COLLECTION, not only the button', () => {
  // A screen that hides a control while the route behind it still fires is not
  // a guard - the rule this codebase keeps everywhere else.
  const body = routeBody(SRC('routes', 'admin.js'), ROUTE);
  assert.match(body, /AWAITING_COLLECTION/, 'the route no longer checks the van has not been');
  assert.match(body, /WAIVED/, 'the route no longer refuses a waived order');
  assert.match(body, /PAID/, 'the route no longer refuses a paid order');
});

test('and the card only draws for a hold that was actually refused', () => {
  const body = bodyOf(SRC('routes', 'admin.js'), CARD);
  assert.match(body, /AWAITING_COLLECTION/, 'the card stopped checking the van has not been');
  assert.match(body, /showUpState\(order\) !== 'REFUSED'/, 'the card no longer keys off a refusal');
});

// --- what it must never do ---------------------------------------------------

test('IT SAYS NOTHING TO THE CUSTOMER', () => {
  // Every other hold is placed while nobody is watching, so a refusal there has
  // to reach the customer. This one is pressed by a person who already knows,
  // usually with the customer on the phone - the same argument the charge retry
  // makes for going quiet.
  const body = routeBody(SRC('routes', 'admin.js'), ROUTE);
  assert.ok(!/sendAndLog\(/.test(body), 'the hold retry texts the customer');
  assert.ok(!/notify\./.test(body), 'the hold retry reaches for notify');
});

test('A THROWN ERROR IS NOT REPORTED AS THE CARD SAYING NO', () => {
  // #2068's lesson, and it bit again on #2073: a retry run against a Stripe
  // sandbox answered "No such PaymentMethod", which is our problem and not the
  // customer's card. Blaming the card there sends somebody chasing a fault that
  // does not exist.
  const body = routeBody(SRC('routes', 'admin.js'), ROUTE);
  assert.match(body, /threw/, 'the route no longer separates an exception from a refusal');

  const at = body.indexOf('threw');
  const refusedAt = body.indexOf('Refused again');
  assert.ok(at > -1 && refusedAt > -1 && at < refusedAt, 'the exception branch must come first');
});
