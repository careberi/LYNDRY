'use strict';

// ---------------------------------------------------------------------------
// CASH IS A RECOVERY, NOT A PAYMENT METHOD.
//
// Neil, 14 September: a customer cannot choose it, it is not on the checkout,
// it is not on the driver's route. It is an admin option in exactly one
// situation - the card was refused, we are holding the laundry, and money is
// still owed.
//
// Most of what is pinned here is the MUST NOT list, because every one of those
// is a way this feature could quietly become a second way to pay:
//
//   no CASH payment_status         a status can hold one word; an order paid
//                                  two ways needs two rows
//   not the whole order            $80 card + $15 cash is not "a cash order"
//   not WAIVED                     waived is a decision not to charge at all
//   the hold stays until $0        part payment is still an unpaid order
//   only the remaining balance     more than that is change, which we cannot give
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const payments = require('../src/core/payments');
const dispatch = require('../src/core/dispatch');
const orders = require('../src/core/orders');

// NORMALISED AT THE READ, AND THE BOUNDARY IS ASSERTED.
//
// This file passed on its branch and failed the moment it reached main, with
// identical bytes on both sides. The checkout writes CRLF, so the search for a
// bare newline-brace found nothing, returned -1, and slice(at, -1) handed back
// the whole rest of the file - which contains the word FAILED inside a function
// the failing assertion is not about.
//
// Two fixes, and the second is the one that matters: normalise the line endings
// so the search can succeed, and make a search that fails say so. A
// source-slicing test that cannot find its own boundary has to fail loudly
// rather than quietly widen to the end of the file.
const SRC = (...bits) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8')
    .split('\r\n')
    .join('\n');

function bodyOf(src, signature) {
  const at = src.indexOf(signature);
  assert.notEqual(at, -1, `${signature} has moved`);

  const end = src.indexOf('\n}\n', at);
  assert.notEqual(end, -1, `could not find the end of ${signature}`);

  return src.slice(at, end);
}

// #2060 as it was: collected, weighed, charged $84.00, refused.
const held = {
  id: 'o1',
  order_number: 2060,
  status: 'READY',
  payment_status: 'FAILED',
  price_cents: 8400,
  amount_paid_cents: 0,
  customer_id: 'shamar',
  customers: { stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_1' },
};

// --- the balance is money now, which is what lets cash land -----------------

test('an unpaid refusal owes the whole price', () => {
  assert.equal(dispatch.balance(held), 8400);
  assert.equal(dispatch.paymentHold(held), true);
});

test('PART CASH LEAVES PART OWED, AND THE HOLD STANDS', () => {
  // The whole point of writing balance() as money rather than as
  // payment_status === FAILED. $70 handed over, $14 still held.
  const part = { ...held, amount_paid_cents: 7000 };
  assert.equal(dispatch.balance(part), 1400);
  assert.equal(dispatch.paymentHold(part), true, 'the hold cleared on a part payment');
});

test('and the hold clears only when nothing is left', () => {
  const covered = { ...held, amount_paid_cents: 8400, payment_status: 'PAID' };
  assert.equal(dispatch.balance(covered), 0);
  assert.equal(dispatch.paymentHold(covered), false);
});

test('an overpayment never reads as a negative balance', () => {
  assert.equal(dispatch.balance({ ...held, amount_paid_cents: 9000 }), 0);
});

test('UNPAID IS STILL ZERO, which is the mid-doorstep rule and did not move', () => {
  // recordWeight() prices a bag a minute before loadVan() charges for it, so
  // IN_PROCESS + priced + UNPAID is a driver standing at a door.
  const midDoorstep = { ...held, status: 'IN_PROCESS', payment_status: 'UNPAID' };
  assert.equal(dispatch.balance(midDoorstep), 0);
  assert.equal(dispatch.paymentHold(midDoorstep), false);
});

// --- what a screen shows ----------------------------------------------------

test('THE SPLIT IS TOTAL, CARD, CASH, BALANCE - never "Paid - Cash"', () => {
  const split = payments.splitFor({ price_cents: 9500 }, [
    { method: 'CARD', amount_cents: 8000 },
    { method: 'CASH', amount_cents: 1500 },
  ]);

  assert.equal(split.total, 9500);
  assert.equal(split.card, 8000);
  assert.equal(split.cash, 1500);
  assert.equal(split.balance, 0);
  assert.equal(split.settled, true);
});

test('a part-cash order still shows what is owed', () => {
  const split = payments.splitFor({ price_cents: 8400 }, [{ method: 'CASH', amount_cents: 7000 }]);
  assert.equal(split.balance, 1400);
  assert.equal(split.settled, false);
});

test('AN ORDER WITH NO LEDGER SHOWS NO SPLIT, rather than Card $0', () => {
  // Every order taken before the payments table existed. Drawing a split over
  // one that was plainly paid by card would invent a fact.
  const split = payments.splitFor({ price_cents: 8400 }, []);
  assert.equal(split.ledger, false);
  assert.equal(payments.splitFor({ price_cents: 8400 }, [{ method: 'CASH', amount_cents: 1 }]).ledger, true);
});

test('the order page draws the split only when there is a ledger', () => {
  const console_ = require('../src/web/order-console');
  const money = (c) => `$${(c / 100).toFixed(2)}`;
  assert.equal(console_.paidTable(payments.splitFor({ price_cents: 8400 }, []), { money }), '');
  assert.match(
    console_.paidTable(payments.splitFor({ price_cents: 8400 }, [{ method: 'CASH', amount_cents: 8400 }]), { money }),
    /Cash/
  );
});

// --- the form appears in exactly one situation ------------------------------

const money = (c) => `$${(c / 100).toFixed(2)}`;
const canAll = { override: true, money: true };

test('THE CASH FORM IS ONLY ON AN ORDER WHOSE CARD WAS REFUSED', () => {
  const console_ = require('../src/web/order-console');
  const split = payments.splitFor(held, []);

  for (const payment_status of ['UNPAID', 'PAID', 'WAIVED']) {
    const html = console_.cashForm({ ...held, payment_status }, split, { money, can: canAll });
    assert.equal(html, '', payment_status);
  }

  assert.match(console_.cashForm(held, split, { money, can: canAll }), /Record cash/);
});

test('and never for somebody who cannot take money', () => {
  const console_ = require('../src/web/order-console');
  const split = payments.splitFor(held, []);
  assert.equal(console_.cashForm(held, split, { money, can: { override: false, money: true } }), '');
});

test('it offers the outstanding balance, not the total', () => {
  const console_ = require('../src/web/order-console');
  const part = { ...held, amount_paid_cents: 7000 };
  const split = payments.splitFor(part, [{ method: 'CASH', amount_cents: 7000 }]);
  const html = console_.cashForm(part, split, { money, can: canAll });
  assert.match(html, /14\.00/, 'it does not offer the remaining balance');
  assert.ok(!/84\.00/.test(html), 'it offers the whole price');
});

// --- the must-not list ------------------------------------------------------

test('THERE IS NO CASH PAYMENT STATUS, ANYWHERE', () => {
  // A status holds one word. An order settled two ways needs two rows, and a
  // CASH status would claim the whole order was cash when only the leftover
  // was. It would also sit beside WAIVED, which means the opposite thing.
  const code = [SRC('core', 'payments.js'), SRC('core', 'dispatch.js'), SRC('core', 'billing.js')]
    .join('\n')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

  assert.ok(!/payment_status:\s*'CASH'/.test(code), 'a CASH payment status crept in');
  assert.ok(!/'CASH'\s*,?\s*\]/.test(code.replace(/METHODS[\s\S]{0,80}/g, '')), 'CASH reached a status list');
});

test('and cash never writes WAIVED', () => {
  const src = SRC('core', 'payments.js');
  assert.ok(!/WAIVED/.test(src.replace(/\/\/.*$/gm, '')), 'payments.js writes or reads WAIVED');
});

test('THE ONLY STATUS CASH EVER WRITES IS PAID, AND ONLY WHEN COVERED', () => {
  const src = SRC('core', 'payments.js');
  // Comments stripped: the note explaining that a part-paid order STAYS
  // FAILED contains the word, and a naive search finds its own prose.
  const body = bodyOf(src, 'async function resettle')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');

  assert.match(body, /paid >= total/, 'it settles without checking the total is covered');
  assert.match(body, /patch\.payment_status = 'PAID'/);
  assert.ok(!/FAILED/.test(body), 'resettle writes a failure status');
});

test('A CUSTOMER CANNOT REACH ANY OF THIS', () => {
  // Not on the checkout, not in booking, not on the account pages.
  const customerFacing = [SRC('routes', 'account.js'), SRC('core', 'booking.js')].join('\n');
  assert.ok(!/recordCash|payments\.record/.test(customerFacing), 'a customer path can record cash');
  assert.ok(!/'CASH'/.test(customerFacing), 'cash reached a customer-facing file');
});

test('and it is not on the driver route either', () => {
  const driver = [SRC('web', 'run-page.js'), SRC('core', 'run.js')].join('\n');
  assert.ok(!/recordCash|'CASH'/.test(driver), 'cash reached the driver run');
});

// --- the refusals, which are the rules -------------------------------------

test('EVERY REFUSAL IS IN THE CORE, not only in the form', () => {
  // The route can be posted to directly. A form that merely omits a control is
  // not a guard - the rule this codebase keeps everywhere else.
  const src = SRC('core', 'payments.js');
  const body = bodyOf(src, 'async function recordCash');

  for (const reason of ['not_failed', 'not_in_our_hands', 'nothing_owed', 'bad_amount', 'more_than_owed']) {
    assert.match(body, new RegExp(reason), `recordCash does not refuse ${reason}`);
  }
  assert.match(body, /IN_OUR_HANDS/, 'it does not check we are holding the laundry');
});

test('more than is owed is refused, because the rest would be change', () => {
  const src = SRC('core', 'payments.js');
  const body = bodyOf(src, 'async function recordCash');
  assert.match(body, /amount > outstanding/);
});

test('nothing in the cash path sends a text', () => {
  const src = SRC('core', 'payments.js');
  assert.ok(!/sendAndLog|notify/.test(src), 'payments.js started texting');
});

// --- the ledger is a record, not a scratchpad -------------------------------

test('THE SUM IS RECOMPUTED FROM THE ROWS, never incremented', () => {
  // Two people recording cash at once would each write their own idea of the
  // total. The ledger is the record; the column is a cache of it.
  const src = SRC('core', 'payments.js');
  const body = bodyOf(src, 'async function resettle');
  assert.match(body, /forOrder\(order\.id\)/, 'resettle does not re-read the rows');
  assert.ok(!/amount_paid_cents\s*\+/.test(body), 'the cache is incremented rather than recomputed');
});

test('both field lists carry what balance() reads', () => {
  // Tenth time would be an unselected amount_paid_cents reading as undefined,
  // which makes a part-paid order look wholly unpaid and holds laundry that is
  // already settled.
  const src = SRC('core', 'dispatch.js');
  for (const list of ['BOARD_FIELDS', 'RUN_FIELDS']) {
    const at = src.indexOf(`const ${list} =`);
    const block = src.slice(at, src.indexOf(';', src.indexOf('customers', at)));
    assert.match(block, /amount_paid_cents/, `${list} does not select amount_paid_cents`);
  }
});

test('the migration keeps the ledger append-only in shape', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '0094_payments_ledger.sql'),
    'utf8'
  );
  assert.match(sql, /check \(method in \('CARD', 'CASH'\)\)/);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /amount_paid_cents/);
  // The migration DESCRIBES payment_status in its table comment, which is the
  // point of that comment: it says there is no CASH status. What it must not
  // do is change the column.
  const statements = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .replace(/comment on [\s\S]*?;/g, '');
  assert.ok(!/payment_status/.test(statements), 'the migration alters payment_status');
});
