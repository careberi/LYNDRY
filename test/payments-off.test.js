'use strict';

// ---------------------------------------------------------------------------
// NO WAY TO CHARGE, NO PICKUP - IN PRODUCTION ONLY.
//
// Audit finding #7. Neil, 16 September: if Stripe is missing in production,
// refuse the pickup. Do not take bags and hope.
//
// needsCardOnFile() answers FALSE when payments are switched off. That is
// deliberate and it stays: a laptop with no Stripe key must not empty the
// round, and CLAUDE.md records it as the reason the gate fails open. But "no
// key" is a different event on a live server: every pickup that day would be
// collected, washed and delivered with nothing charged and no record that
// anything was owed - and it is silent, because an order with no card looks
// exactly like an order that does not need one.
//
// SO THE ENVIRONMENT DECIDES WHICH WAY IT FAILS. Open outside production, as
// before. Closed in production.
//
// WHY IT IS ON collectRefusal() AND NOT ON needsCardOnFile(): that function is
// asked by the booking path and by the card-ask paths as well, and making it
// answer true with no provider would send customers to mint setup links
// against a provider that cannot make them. The refusal belongs at the door
// that takes the bags.
//
// Nothing here touches the database, Stripe or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

const SRC = (...bits) =>
  fs.readFileSync(path.join(ROOT, 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// Ask a child process, because config is frozen at startup and the whole point
// is what a DIFFERENT environment does. Pure function calls: nothing in here
// writes, sends or charges.
const refusalUnder = (env) => {
  const script = `
    const d = require('./src/core/dispatch.js');
    const order = {
      order_number: 1,
      customer_id: 'A',
      customers: { stripe_customer_id: 'c', default_payment_method_id: 'p' },
      payment_status: 'UNPAID',
    };
    const r = d.collectRefusal(order, new Set());
    process.stdout.write(JSON.stringify(r ? r.reason : null));
  `;

  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  return JSON.parse(out);
};

test('IN PRODUCTION, NO STRIPE KEY MEANS NO PICKUP', () => {
  assert.equal(
    refusalUnder({ NODE_ENV: 'production', STRIPE_SECRET_KEY: '' }),
    'payments_off',
    'production would still send the van out with no way to charge'
  );
});

test('AND OUTSIDE PRODUCTION IT STILL FAILS OPEN', () => {
  // The rule this must not break. A sandbox with no key has always collected
  // as normal, and reading a missing key as a refusal there would empty the
  // round on every developer machine and every test run.
  assert.equal(
    refusalUnder({ NODE_ENV: 'development', STRIPE_SECRET_KEY: '' }),
    null,
    'a sandbox with no Stripe key stopped collecting'
  );
});

test('and a working production server is unaffected', () => {
  assert.equal(refusalUnder({ NODE_ENV: 'production' }), null);
});

// --- the shape of it --------------------------------------------------------

test('THE REFUSAL DOES NOT BLAME THE CUSTOMER', () => {
  // `no_card_on_file` would send somebody to ask a customer for a card, which
  // does not help: the customer is fine and the server is not.
  const code = withoutComments(SRC('core', 'dispatch.js'));
  const at = code.indexOf('function collectRefusal');
  const body = code.slice(at, code.indexOf('\n}', at));

  assert.match(body, /payments_off/, 'there is no distinct reason for this');

  // It is asked before anything about the order, because when it is true it is
  // true of every order on the board.
  assert.ok(
    body.indexOf('payments_off') < body.indexOf('no_card_on_file'),
    'the server condition is asked after the card condition'
  );
});

test('needsCardOnFile() IS UNCHANGED, and that is deliberate', () => {
  // The audit's instinct was to make this one refuse. It is asked by the
  // booking path and by every card-ask path, so answering true with no
  // provider would send customers off to mint setup links against a provider
  // that cannot make them.
  const code = withoutComments(SRC('core', 'billing.js'));
  const at = code.indexOf('function needsCardOnFile');
  const body = code.slice(at, code.indexOf('\n}', at));

  assert.match(body, /if \(!payments\.isConfigured\) return false;/);
});

test('and the server condition has its own name', () => {
  const code = withoutComments(SRC('core', 'billing.js'));
  assert.match(code, /function paymentsConfigured\(\)/);

  // Nothing outside src/providers/payments knows what Stripe IS - which is
  // about importing the vendor, not about the word. `stripe_customer_id` is a
  // column on our own customers table and dispatch has always selected it;
  // refusing the string outright would fail on that and prove nothing.
  const dispatch = withoutComments(SRC('core', 'dispatch.js'));

  assert.ok(!/require\('stripe'\)/.test(dispatch), 'dispatch.js imports the Stripe package');
  assert.ok(
    !/require\('\.\.\/providers\/payments'\)/.test(dispatch),
    'dispatch.js reaches past billing.js to the payment provider'
  );
  assert.match(dispatch, /billing\.paymentsConfigured\(\)/, 'it does not ask through billing');
});

test('THE BOOT WARNING NO LONGER PROMISES DELIVERIES', () => {
  // It read "Orders can still be booked and delivered; nothing will be
  // charged", which described exactly the behaviour this change removes.
  const provider = fs.readFileSync(
    path.join(ROOT, 'src', 'providers', 'payments', 'index.js'),
    'utf8'
  );

  assert.ok(
    !/Orders can still be\s+'?\s*\+?\s*'?booked and delivered/.test(provider.split('\n').join(' ')),
    'the boot warning still says deliveries carry on'
  );
  assert.match(provider, /NO PICKUP WILL BE/, 'the boot warning does not say what now happens');
});

test('and the reminder skip log names it as a server problem', () => {
  // With no way to charge, every pickup skips for that reason and none of them
  // is a card problem - so the log must not send somebody chasing customers.
  const code = withoutComments(SRC('core', 'reminders.js'));
  const at = code.indexOf('if (!routable(order))');
  const body = code.slice(at, code.indexOf('continue;', at));

  assert.match(body, /card payments are not configured/);
  assert.match(body, /paymentsConfigured/);
});
