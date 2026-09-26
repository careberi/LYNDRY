'use strict';

// ---------------------------------------------------------------------------
// THE CARD PAGE.
//
// Neil, 21 September: "Update the card page. Charge after we weigh at the door.
// Subscription is $1.80/lb. Do not say there is no subscription."
//
// billing.consentText() is what the customer agrees to on Stripe's page and is
// tested as behaviour. The other card screens are read.
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const billing = require('../src/core/billing');
const subscription = require('../src/core/subscription');

const READ = (...bits) => fs.readFileSync(path.join(__dirname, '..', ...bits), 'utf8');

test('the card page says when the card is charged: after we weigh it at the door', () => {
  const text = billing.consentText();
  assert.ok(/weigh your laundry at your door and charge the total then/.test(text), text);
  assert.ok(!/when we deliver/i.test(text), 'it still says we charge at delivery');
});

test('it names both rates, read off subscription.js', () => {
  const text = billing.consentText();
  assert.ok(text.includes(subscription.oneTimeRate()), text);
  assert.ok(text.includes(subscription.subscriptionRate()), text);
});

test('it never says there is no subscription', () => {
  assert.ok(!/no subscription/i.test(billing.consentText()));
  // Code only: the comment recording that the phrase came off says it.
  const code = READ('src', 'core', 'billing.js')
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  assert.ok(!/Nothing recurring/i.test(code), 'the card-link text still says nothing recurring');
});

test('it authorises the $25 hold it actually places', () => {
  const text = billing.consentText();
  const hold = billing.money(billing.showUpCents());
  assert.ok(text.includes(`hold ${hold}`), text);
  assert.ok(/keep the \$25\.00 for the trip/.test(text), 'the kept trip charge is not authorised');
});

test('it describes the statement: the hold first, the rest as a second charge', () => {
  const text = billing.consentText();
  // settleTotal() makes two payments when the total is over the hold.
  assert.ok(!/\bonce\b/i.test(text), 'it says the card is charged once');
  assert.ok(!/becomes part of that charge/.test(text), 'it says the hold and the rest are one charge');
  assert.ok(/hold is taken first and anything over it is charged to the same card/.test(text), text);
  // A same-day pickup is charged the same day, at the door.
  assert.ok(!/charged today/i.test(text), 'nothing is charged today is false for a same-day pickup');
  assert.ok(/Saving this card charges nothing/.test(text), text);
});

test('it fits Stripe\'s 1200-character limit, or every card link would fail', () => {
  assert.ok(billing.consentText().length <= 1200, `${billing.consentText().length} characters`);
});

test('every card screen says the door', () => {
  const account = READ('src', 'routes', 'account.js');
  assert.ok(/charge it after we weigh your laundry at your door/.test(account), 'the wizard card step');
  assert.ok(!/charge it once/.test(account), 'the wizard says once, and a total over the hold is two charges');
  assert.ok(/weighed your laundry at your door/.test(account), 'the unfinished-checkout card');

  const setup = READ('src', 'web', 'account-setup.js');
  assert.ok(/You are charged after we weigh your\s+laundry at your door/.test(setup), 'the card settings form');

  const web = READ('src', 'routes', 'web.js');
  assert.ok(/We weigh\s+your laundry at your door, and that is the moment your card is charged/.test(web), 'the signup card block');

  const pay = READ('src', 'routes', 'payments.js');
  assert.ok(/after we weigh your laundry at your door/.test(pay), 'the texted link\'s done page');
  assert.ok(!/never before, and never without telling you the figure/.test(pay), 'the old line is back');
  assert.ok(!/charge it once/.test(pay), 'the done page says once');
});

test('the card screens name the subscription rate beside the one-time one', () => {
  const account = READ('src', 'routes', 'account.js');
  assert.ok((account.match(/\{\{SUBSCRIPTION_PRICE_PER_LB\}\}/g) || []).length >= 2, 'the card step and the resume card');

  const web = READ('src', 'routes', 'web.js');
  const block = web.slice(web.indexOf('function signupCardBlock'), web.indexOf('function signupCardBlock') + 1400);
  // Real values, not tokens: this block is itself a token's value, and the
  // page fills tokens once, so a token inside it would reach the page raw.
  assert.ok(block.includes('${site.subscriptionPricePerLb}'), block);
  assert.ok(!block.includes('{{SUBSCRIPTION_PRICE_PER_LB}}'), 'a token that would render as {{...}}');
});

test('the pricing page no longer says charged after the wash', () => {
  assert.ok(!/charged after the wash/.test(READ('public', 'pages', 'pricing.html')));
  // The text is sent after the card is tried, never before it.
  assert.ok(!/before the charge goes through/.test(READ('public', 'pages', 'pricing.html')));
});

test('the texted card link names both rates', () => {
  const fn = READ('src', 'core', 'billing.js').split(/\r?\n/).join('\n');
  const body = fn.slice(fn.indexOf('async function setupLinkMessage('), fn.indexOf('async function setupLinkMessage(') + 900);
  assert.ok(body.includes('${subscription.oneTimeRate()} one-time, or ${subscription.subscriptionRate()} on a subscription'), body);
});

test('the card-saved page does not tell somebody with a pickup booked to text us to book one', () => {
  const pay = READ('src', 'routes', 'payments.js');
  const at = pay.indexOf("heading: \"Card saved.\"");
  const before = pay.slice(Math.max(0, at - 2500), at);
  assert.ok(before.includes('orders.findAllAwaitingCollection(customer.id)'), 'the page does not look for the pickup it booked');
  assert.ok(/!soonest\s*\?\s*`<p>Text us whenever you want a pickup/.test(before), 'the invitation to book is not kept for when nothing is waiting');
});

test('the signup card block does not point at a link that was never sent', () => {
  assert.ok(!/from the text we just sent/.test(READ('src', 'routes', 'web.js')));
});
