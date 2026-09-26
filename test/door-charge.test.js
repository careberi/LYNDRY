'use strict';

// ---------------------------------------------------------------------------
// A SUCCESSFUL DOOR CHARGE MUST NOT ALSO RUN THE DECLINE PATH.
//
// Neil's lock, 15 September, after order #2068. Elliot Stern's card paid in
// full at the door - $25.00 captured off the booking hold and $13.00 charged on
// top of it, after CLEAN50 - and the order came out the other side marked "card
// refused", with its three tags retired, and twenty-five minutes later sitting
// at a laundromat it had never been driven to.
//
// TWO FAULTS STACKED, and each is pinned below.
//
//   1. billing.js had TWO things called `payments`: the Stripe provider at the
//      top of the file, and the ledger in a require() buried inside one
//      function. Every ledger write in the file therefore called a function the
//      Stripe provider does not have, which throws a TypeError SYNCHRONOUSLY -
//      before the promise the `.catch()` beside it is attached to exists, so
//      the "best effort" catch on each of those calls never ran. The throw
//      escaped settleTotal(), and loadVan() read any failure at all as a
//      refusal.
//
//   2. orders.uncollect() nulled weight_lb and left price_cents set, which
//      violates the orders_weight_and_price_together CHECK constraint. It is
//      called near the END of the doorstep decline, so the throw took the rest
//      with it: the status never moved, the customer was never texted and the
//      office was never paged - after the tags had already been retired.
//
// Nothing here touches the database or Stripe.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const provider = require('../src/providers/payments');
const ledger = require('../src/core/payments');
const fulfilment = require('../src/core/fulfilment');

// CRLF vs LF: this repo has had a test pass on a branch and fail the moment it
// reached main over exactly this.
const SRC = (...bits) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8')
    .split('\r\n')
    .join('\n');

// A function body, with the boundary asserted rather than assumed.
function bodyOf(src, opening) {
  const at = src.indexOf(opening);
  assert.notEqual(at, -1, `${opening} has moved`);
  const end = src.indexOf('\n}\n', at);
  assert.notEqual(end, -1, `${opening} has no end`);
  return src.slice(at, end);
}

// Comments describe the bug at length, and a test that matches its own prose is
// a test that passes because somebody wrote the word down.
const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// --- 1. the ledger is not the provider ---------------------------------------

test('THE STRIPE PROVIDER HAS NO LEDGER FUNCTIONS, which is why this threw', () => {
  // The fact underneath the whole incident, asserted against the real modules
  // rather than described. If the provider ever grows a recordCard() this test
  // stops being evidence and the comment above needs rewriting.
  assert.equal(typeof provider.recordCard, 'undefined');
  assert.equal(typeof provider.recordShowUp, 'undefined');

  assert.equal(typeof ledger.recordCard, 'function');
  assert.equal(typeof ledger.recordShowUp, 'function');
});

test('AND A MISSING METHOD THROWS BEFORE ANY .catch() CAN RUN', () => {
  // Why `await payments.recordCard(...).catch(...)` did not contain it: the
  // TypeError is raised evaluating the call, so there is no promise yet and the
  // catch is never reached. This is the mechanism, not a description of it.
  assert.throws(() => provider.recordCard({}, {}).catch(() => {}), TypeError);
});

test('BILLING BINDS THE TWO MODULES TO TWO NAMES', () => {
  const src = withoutComments(SRC('core', 'billing.js'));

  assert.match(src, /const ledger = require\('\.\/payments'\)/, 'the ledger is not required');
  assert.match(src, /const payments = require\('\.\.\/providers\/payments'\)/);

  // ONE binding each. The second `const payments` - the one inside a function -
  // is what left every other line in the file pointing at Stripe.
  assert.equal((src.match(/const payments\s*=/g) || []).length, 1, 'payments is bound twice');
  assert.equal((src.match(/const ledger\s*=/g) || []).length, 1, 'ledger is bound twice');
});

test('AND EVERY LEDGER WRITE GOES THROUGH IT', () => {
  const src = withoutComments(SRC('core', 'billing.js'));

  // WHITESPACE IS NOT THE RULE. This required a literal newline between the name
  // and the method, because that is how the calls happened to be wrapped the day
  // it was written - so moving one onto a single line failed a test about which
  // MODULE is being called. `\s*` covers a line break and a space equally, which
  // is the only formatting this should have an opinion about: none.
  assert.ok(
    !/\bpayments\s*\.record(Card|ShowUp)\(/.test(src),
    'a ledger write still goes to the Stripe provider'
  );
  assert.ok(/\bledger\s*\.recordCard\(/.test(src), 'recordCard no longer uses the ledger');
  assert.ok(/\bledger\s*\.recordShowUp\(/.test(src), 'recordShowUp no longer uses the ledger');
});

// --- 2. only a refusal leaves bags behind -------------------------------------

test('ONLY AN ACTUAL REFUSAL REACHES THE DOORSTEP DECLINE', () => {
  const body = bodyOf(SRC('core', 'fulfilment.js'), 'async function loadVan(');
  const code = withoutComments(body);

  // `if (!charge.ok)` swept up a decline, a sandbox with no Stripe key, and any
  // exception at all - including one raised after the money had moved.
  assert.match(
    code,
    /if \(!charge\.ok && \(charge\.declined \|\| charge\.needsCard\)\)/,
    'the decline path is reachable by something that is not a refusal'
  );

  // And the other failures land somewhere that changes nothing.
  assert.match(code, /couldNotCharge\(/, 'a failure that is not a refusal has nowhere to go');
});

test('A THROWN ERROR IS NOT A REFUSAL', () => {
  const body = bodyOf(SRC('core', 'fulfilment.js'), 'async function loadVan(');

  // The catch used to answer `{ ok: false, failed: true }`, which met the old
  // `!charge.ok` test and became a decline. Whatever it answers now must not
  // claim the card said no.
  const caught = body.slice(body.indexOf('.catch((err)'), body.indexOf('.catch((err)') + 240);
  assert.ok(!/declined/.test(caught), 'a thrown error reports itself as a decline');
  assert.ok(!/needsCard/.test(caught), 'a thrown error reports itself as a missing card');
});

test('AND THE UNKNOWN PATH TOUCHES NOTHING THE CUSTOMER CAN SEE', () => {
  const body = withoutComments(
    bodyOf(SRC('core', 'fulfilment.js'), 'async function couldNotCharge(')
  );

  // The money may or may not have moved, so the only safe move is to change
  // nothing and page a person.
  assert.ok(!/sendAndLog/.test(body), 'it texts the customer about a bug in our code');
  assert.ok(!/uncollect/.test(body), 'it puts the pickup back over an unknown failure');
  assert.ok(!/releaseOrder|unclipOrder/.test(body), 'it strips the bags over an unknown failure');
  assert.match(body, /issues\s*\n?\s*\.raise/, 'nobody is told');
});

// --- 3. a paid order can never be declined ------------------------------------

test('A PAID ORDER IS REFUSED THE DECLINE PATH, however it got there', () => {
  const body = withoutComments(
    bodyOf(SRC('core', 'fulfilment.js'), 'async function declinedAtTheDoor(')
  );

  // Read back from the database, because the charge is the thing that would
  // have changed it - the row loaded before the charge cannot answer this.
  assert.match(body, /alreadyPaid/, 'a paid order still falls through to the decline');

  // Order is the whole of it: the question has to be asked before anything is
  // written, not alongside it.
  const asks = body.indexOf('payment_status');
  const refuses = body.indexOf('Card refused');

  assert.ok(asks > -1, 'the decline never checks whether the order is paid');
  assert.ok(refuses > -1, 'the refusal event has moved');
  assert.ok(asks < refuses, 'the order is declined before anybody asks whether it is paid');
});

// --- 4. leaving bags at a door is not a delivery -------------------------------

test('THE DOORSTEP DOES NOT RETIRE THE TAGS', () => {
  // Comments stripped first: the note left in its place explains what
  // releaseOrder() used to do here, and a test that matches its own prose
  // passes because somebody wrote the word down.
  const body = withoutComments(
    bodyOf(SRC('core', 'fulfilment.js'), 'async function declinedAtTheDoor(')
  );

  // releaseOrder() is what DELIVERY calls. Dead is only for a finished
  // delivery; these bags are on a step with our stickers still on them.
  assert.ok(!/releaseOrder/.test(body), 'the doorstep retires the tags like a delivery');

  // The clips are the opposite case and must still come back: physical stock
  // that lives in the van.
  assert.match(body, /unclipOrder/, 'the clips stay out of the pool');
});

test('AND THE TAG PAGE ASKS THE ORDER, NOT THE FLAG', () => {
  const src = withoutComments(SRC('routes', 'bag.js'));

  // `released_at` is a column somebody writes; the order's status is a fact
  // about where the bag is. Neil: if it is on the van, the tag is live.
  assert.ok(
    !/if \(!label\.order_id \|\| label\.released_at\)/.test(src),
    'the tag page still kills a live bag on released_at'
  );
  assert.match(src, /if \(!label\.order_id\)/, 'blank stock still has to be refused');
  assert.match(
    src,
    /\['DELIVERED', 'CANCELED'\]\.includes\(order\.status\)/,
    'a finished order no longer retires its stickers'
  );
});

// --- 5. nothing reaches a laundromat that was not loaded and paid for ----------

test('AN ORDER THAT FAILED AT THE DOOR CANNOT BE DROPPED AT A LAUNDROMAT', () => {
  const { readyForPartner } = fulfilment;

  // The happy case: loaded, paid, no refusal on it.
  assert.equal(readyForPartner({ van_confirmed_at: '2026-09-15T16:29:18Z' }), null);

  // Never loaded. #2068 sat IN_PROCESS after a decline path that threw halfway,
  // and was dropped at Best Wash twenty-five minutes later.
  const notLoaded = readyForPartner({ van_confirmed_at: null });
  assert.equal(notLoaded.ok, false);
  assert.match(notLoaded.detail, /never confirmed into the van/);

  // Loaded once, then refused at a door: the bags belong with the customer.
  const refused = readyForPartner({
    van_confirmed_at: '2026-09-15T16:29:18Z',
    authorization_refused_at: '2026-09-15T16:28:53Z',
  });
  assert.equal(refused.ok, false);
  assert.match(refused.detail, /refused at the door/);
});

test('AND THE STEP ITSELF CHECKS IT, not only the screen that offers it', () => {
  // A screen that hides a control while the route behind it still fires is not
  // a guard - the JSON API reaches the same function.
  const body = withoutComments(bodyOf(SRC('core', 'fulfilment.js'), 'async function dropAtPartner('));

  const guard = body.indexOf('readyForPartner');
  const move = body.indexOf("step(order, 'AT_PARTNER'");

  assert.notEqual(guard, -1, 'dropAtPartner stopped checking the van');
  assert.ok(guard < move, 'the status moves before the van is checked');
});

// --- 6. uncollect must satisfy the weight/price constraint ---------------------

test('PUTTING A PICKUP BACK CLEARS THE PRICE WITH THE WEIGHT', () => {
  const body = withoutComments(bodyOf(SRC('core', 'orders.js'), 'async function uncollect('));

  // orders_weight_and_price_together is a CHECK constraint:
  //   (weight_lb is null) = (price_cents is null)
  // Every bag weighed at a door re-prices the order, so nulling the weight
  // alone failed the constraint on every real doorstep decline there could
  // ever be - and took the rest of the decline path down with it.
  assert.match(body, /weight_lb: null/, 'the weight survives a pickup that did not happen');
  assert.match(body, /price_cents: null/, 'the price is left behind and the update is refused');

  // Both in the same update, or the row is invalid between the two writes.
  // The end is searched for FROM the update: the function's own signature ends
  // `= {})`, so a bare indexOf finds that and slices backwards to nothing.
  const from = body.indexOf('.update({');
  assert.notEqual(from, -1, 'uncollect stopped updating the order');
  const patch = body.slice(from, body.indexOf('})', from));
  assert.match(patch, /weight_lb: null/);
  assert.match(patch, /price_cents: null/);
});
