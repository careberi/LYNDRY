'use strict';

// ---------------------------------------------------------------------------
// THE INTAKE TABLE: WHAT WE KNOW, AND WHERE EACH ANSWER CAME FROM.
//
// Neil's brief, 16 September. It replaces the "what is still missing" cards,
// and the replacement is a change of model rather than of styling:
//
//   the old question   what is missing, so I can ask for it
//   the new question   what do we know, where did it come from, and what is
//                      actually stopping the next pickup
//
// HIS CORE RULE, IN HIS WORDS: "Not explicitly supplied does not automatically
// mean missing." Three of the four states are fine, and most of this file is
// about refusing to call the fine ones a problem.
//
// Nothing here touches the database or the network. `row()` is exported for
// exactly that reason - these are the rules that decide what an operator is
// told about a customer, and none of them should need a query to check.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const intake = require('../src/core/intake');
const subscription = require('../src/core/subscription');
const { intakeTable } = require('../src/web/intake-table');

const { EXPLICIT, DEFAULT, MISSING, NA } = intake.STATES;

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(line))
    .join('\n');

// --- a customer, and the context fieldsFor() would have built ---------------

// Everything a real row has and nothing more. Building it here rather than
// stubbing the database is the point: these rules are pure.
function ctxFor({ order = null, awaiting = false, plan = null, opensOnLabel = null, paymentsOn = true } = {}) {
  return { order, awaiting, subscriptionPlan: plan, opensOnLabel, paymentsOn };
}

function tableFor(customer, options = {}) {
  const ctx = ctxFor(options);
  const seen = options.seen || new Map();

  const rows = intake.FIELDS.map((f) => intake.row(f, customer, ctx, seen));
  return new Map(rows.map((r) => [r.key, r]));
}

// Somebody who has just texted us and said nothing else.
const STRANGER = { id: 'c1', phone: '+12015550100', preferences: {} };

// Somebody fully set up, between orders. Neil's rule 22.
const SETTLED = {
  id: 'c2',
  phone: '+12015550101',
  name: 'Sarah Smith',
  address_line1: '25 Main St',
  city: 'Fair Lawn',
  state: 'NJ',
  postal_code: '07410',
  stripe_customer_id: 'cus_1',
  default_payment_method_id: 'pm_1',
  card_brand: 'visa',
  card_last4: '4242',
  preferences: {
    water_temp: 'WARM',
    fabric_softener: 'NONE',
    special_instructions: 'front porch',
  },
};

const AWAITING_ORDER = {
  id: 'o1',
  order_number: 2101,
  status: 'REQUESTED',
  pickup_date: '2026-09-17',
  pickup_time: null,
  pickup_window_start: '14:00',
  pickup_window_end: '16:00',
};

// --- 1. a completely new customer -------------------------------------------

test('a stranger is missing a name, an address and a date, and nothing else', () => {
  const t = tableFor(STRANGER);

  assert.equal(t.get('name').state, MISSING);
  assert.equal(t.get('address').state, MISSING);
  assert.equal(t.get('pickup_date').state, MISSING);
  assert.equal(t.get('card').state, MISSING);

  // AND THE OPTIONAL ONES ARE NOT MISSING. This is the whole rule: a default is
  // a valid state, not a gap with a button on it.
  for (const key of ['pickup_time', 'pickup_location', 'water_temp', 'fabric_softener', 'service_type']) {
    assert.equal(t.get(key).state, DEFAULT, `${key} reads as a problem`);
  }
});

test('the defaults are the ones Neil named, in the words a customer would use', () => {
  const t = tableFor(STRANGER);

  assert.equal(t.get('water_temp').value, 'Cold');
  assert.equal(t.get('fabric_softener').value, 'Yes');
  assert.equal(t.get('service_type').value, 'One-Time');
  assert.equal(t.get('pickup_location').value, 'Service address');
  assert.equal(t.get('pickup_time').value, 'Any time');
});

// --- 2. a returning customer -------------------------------------------------

test('a settled customer has no fake onboarding gaps', () => {
  const t = tableFor(SETTLED);

  for (const key of ['name', 'address', 'card', 'water_temp', 'fabric_softener', 'pickup_location']) {
    assert.equal(t.get(key).state, EXPLICIT, `${key} is not read back as theirs`);
  }
});

test('the only thing a settled customer needs is a date', () => {
  const t = tableFor(SETTLED);

  assert.equal(t.get('pickup_date').state, MISSING);
  assert.equal(intake.blocking([...t.values()]).length, 0, 'a settled customer looks stuck');
});

test('a missing pickup date is never counted as being stuck', () => {
  // The resting state of everybody between orders. Counting it would pull every
  // settled customer into the AI's early nudge and paint the screen red for a
  // customer who is simply not due.
  const t = tableFor(SETTLED);

  assert.equal(t.get('pickup_date').blocks, intake.NEEDED.PICKUP);
  assert.ok(!intake.blocking([...t.values()]).some((f) => f.key === 'pickup_date'));
});

test('a stranger IS stuck, and on the three things that actually stop a pickup', () => {
  const blocked = intake.blocking([...tableFor(STRANGER).values()]).map((f) => f.key);

  assert.deepEqual(blocked.sort(), ['address', 'card', 'name']);
});

// --- 3 and 4. the wash ------------------------------------------------------

test('no wash answer is a default, not a blocker', () => {
  const t = tableFor(STRANGER);

  assert.equal(t.get('water_temp').state, DEFAULT);
  assert.equal(t.get('water_temp').blocks, null);
  assert.equal(t.get('fabric_softener').blocks, null);
});

test('"warm, no softener" turns both rows explicit', () => {
  const t = tableFor({ ...STRANGER, preferences: { water_temp: 'WARM', fabric_softener: 'NONE' } });

  assert.equal(t.get('water_temp').state, EXPLICIT);
  assert.equal(t.get('water_temp').value, 'Warm');
  assert.equal(t.get('fabric_softener').state, EXPLICIT);
  assert.equal(t.get('fabric_softener').value, 'No');
});

test('a value we no longer offer is a default, not a choice', () => {
  // A softener stored as the boolean it used to be, or an old HYPOALLERGENIC
  // detergent, would satisfy a "is it set" check and then fall back at wash
  // time - somebody's clothes washed a way they did not choose, with the screen
  // saying they chose it.
  const t = tableFor({ ...STRANGER, preferences: { water_temp: 'TEPID', fabric_softener: true } });

  assert.equal(t.get('water_temp').state, DEFAULT);
  assert.equal(t.get('water_temp').value, 'Cold');
  assert.equal(t.get('fabric_softener').state, DEFAULT);
});

test('detergent is not a row and must never become one', () => {
  assert.ok(!intake.FIELDS.some((f) => /detergent/i.test(f.key + f.label)));
});

test('there is no "request return location" row', () => {
  // One spot serves both legs. Making the return its own question is the form
  // this product exists not to be.
  assert.ok(!intake.FIELDS.some((f) => /return|dropoff|drop.off/i.test(f.key)));
});

// --- 5. the spot ------------------------------------------------------------

test('no spot is the service address, not a gap', () => {
  const t = tableFor(STRANGER);

  assert.equal(t.get('pickup_location').state, DEFAULT);
  assert.equal(t.get('pickup_location').value, 'Service address');
});

test('the spot is read from both fields, newest first', () => {
  // special_instructions is where the AI saves it and where every older
  // customer's is. Checking dropoff_spot alone says "nobody has told us" for
  // almost everybody who has.
  assert.equal(
    tableFor({ ...STRANGER, preferences: { special_instructions: 'side door' } }).get('pickup_location')
      .value,
    'Side door'
  );
  assert.equal(
    tableFor({ ...STRANGER, preferences: { special_instructions: 'side door', dropoff_spot: 'with the doorman' } })
      .get('pickup_location').value,
    'With the doorman'
  );
});

// --- 6 and 7. the pickup date and time --------------------------------------

test('a booked pickup shows its date and the window we promised', () => {
  const t = tableFor(SETTLED, { order: AWAITING_ORDER, awaiting: true });

  assert.equal(t.get('pickup_date').state, EXPLICIT);
  assert.match(t.get('pickup_date').value, /09\/17\/2026/);
  assert.equal(t.get('pickup_time').value, 'between 2 and 4pm');
});

test('a window nobody asked for is a default, and one they asked for is not', () => {
  const asked = { ...AWAITING_ORDER, pickup_time: '15:00' };

  assert.equal(tableFor(SETTLED, { order: AWAITING_ORDER, awaiting: true }).get('pickup_time').state, DEFAULT);
  assert.equal(tableFor(SETTLED, { order: asked, awaiting: true }).get('pickup_time').state, EXPLICIT);
});

test('"anytime is fine" is an answer and is never asked again', () => {
  // It read back as "not asked yet" once and a real customer was asked twice.
  const t = tableFor({ ...STRANGER, pending_pickup: { date: '2026-09-18', anyTime: true } });

  assert.equal(t.get('pickup_time').state, EXPLICIT);
  assert.equal(t.get('pickup_time').value, 'Any time');
});

test('a time they named before anything was booked is explicit', () => {
  const t = tableFor({ ...STRANGER, pending_pickup: { date: '2026-09-18', time: '09:00' } });

  assert.equal(t.get('pickup_time').state, EXPLICIT);
  assert.equal(t.get('pickup_time').value, '9am');
});

test('the pickup date stops being requestable once the bag is ours', () => {
  // You cannot change the day we already collected on. Neil's rule 32: the
  // table stays useful after a booking, and must not imply a field can still
  // move an order that has left the doorstep.
  const collected = { ...AWAITING_ORDER, status: 'AT_PARTNER' };
  const t = tableFor(SETTLED, { order: collected, awaiting: false });

  assert.equal(t.get('pickup_date').state, EXPLICIT);
  assert.equal(t.get('pickup_date').action, null);
  assert.equal(t.get('pickup_date').text, null);
});

test('the pickup question honours the opening date', () => {
  const t = tableFor(STRANGER, { opensOnLabel: 'Monday 21 Sep' });

  assert.match(t.get('pickup_date').text, /Monday 21 Sep/);
});

// --- 10. a completed row keeps its action -----------------------------------

test('a completed row stays on screen and offers an update', () => {
  const t = tableFor(SETTLED);

  assert.equal(t.get('name').action, 'Request Update');
  assert.equal(t.get('address').action, 'Request Update');
  assert.equal(t.get('card').action, 'Ask them to update it');
});

test('a missing row asks rather than updates', () => {
  const t = tableFor(STRANGER);

  assert.equal(t.get('name').action, 'Request Name');
  assert.equal(t.get('address').action, 'Request Address');
  // NOT "Send card link", which is the OTHER button - the one on the customer
  // page and in the conversation's send area that texts the bare /pay address
  // with no sentence around it. Two controls a thumb apart reading the same
  // words and sending different messages is what this naming avoids.
  assert.equal(t.get('card').action, 'Ask for a card');
});

test('asking a stranger their name does not greet them by a name we do not have', () => {
  const text = tableFor(STRANGER).get('name').text;
  assert.ok(!/Hi\s+,|,\s*,/.test(text), text);
  assert.match(tableFor(STRANGER).get('name').text, /^Hi, it's LYNDRY\./);
  assert.match(tableFor(SETTLED).get('name').text, /^Hi Sarah, it's LYNDRY\./);
});

// --- 11. asked, awaiting reply ----------------------------------------------

test('a row we have asked about says so', () => {
  const seen = new Map([['pickup_date', '2026-09-16T09:00:00Z']]);
  const t = tableFor(SETTLED, { seen });

  assert.equal(t.get('pickup_date').askedAt, '2026-09-16T09:00:00Z');
  assert.equal(t.get('name').askedAt, null);
});

test('having asked does not take the action away', () => {
  // A deliberate follow-up is a real thing to want. What this stops is the
  // screen looking as though nothing has been done.
  const seen = new Map([['pickup_date', '2026-09-16T09:00:00Z']]);

  assert.ok(tableFor(SETTLED, { seen }).get('pickup_date').action);
});

// --- 12, 13 and 14. the card ------------------------------------------------

test('a saved card is named and never shown', () => {
  assert.equal(tableFor(SETTLED).get('card').value, 'Visa ending 4242');
});

test('nothing on the card row could carry a card number', () => {
  const src = withoutComments(SRC('core', 'intake.js')) + withoutComments(SRC('web', 'intake-table.js'));

  for (const forbidden of ['card_number', 'cvc', 'cvv', 'exp_month', 'exp_year']) {
    assert.ok(!src.includes(forbidden), `intake reads ${forbidden}`);
  }
});

test('the payment link is minted on send, never on draw', () => {
  // Creating one on every page load would leave a trail of Stripe sessions
  // behind. `row()` must never touch it.
  const src = withoutComments(SRC('core', 'intake.js'));
  const from = src.indexOf('function row(');
  const fn = src.slice(from, src.indexOf('\nasync function', from));

  assert.ok(from > 0);
  assert.ok(!fn.includes('field.link('), 'row() mints a payment link');
  assert.ok(!fn.includes('createSetupLink'), 'row() mints a payment link');

  const send = src.slice(src.indexOf('async function send('));
  assert.ok(send.includes('await field.link(customer)'), 'send() does not mint one');
});

test('the card row says its words are an illustration', () => {
  assert.equal(tableFor(STRANGER).get('card').approximate, true);
  assert.equal(tableFor(STRANGER).get('name').approximate, false);
});

test('with payments switched off the card row is N/A, not a permanent blocker', () => {
  // This is how the system ran for months before the keys existed, and a red
  // row on every customer would be the screen version of emptying the round.
  const t = tableFor(SETTLED, { paymentsOn: false });

  assert.equal(t.get('card').state, NA);
  assert.equal(t.get('card').action, null);
  assert.equal(intake.blocking([...t.values()]).length, 0);
});

// --- 18 and 19. the plan ----------------------------------------------------

test('a one-time customer has no frequency to give', () => {
  const t = tableFor(SETTLED);

  assert.equal(t.get('service_type').value, 'One-Time');
  assert.equal(t.get('service_type').state, DEFAULT);
  assert.equal(t.get('frequency').state, NA);
  assert.equal(t.get('frequency').action, null);
});

test('a subscriber is explicit, and their frequency is a row that matters', () => {
  const t = tableFor(SETTLED, { plan: { status: 'ACTIVE', cadence: 'FORTNIGHTLY' } });

  assert.equal(t.get('service_type').state, EXPLICIT);
  assert.equal(t.get('service_type').value, 'Subscription');
  assert.equal(t.get('frequency').state, EXPLICIT);
  assert.equal(t.get('frequency').value, 'Every 2 weeks');
});

test('a subscription with no readable frequency is missing one', () => {
  const t = tableFor(SETTLED, { plan: { status: 'ACTIVE', cadence: null } });

  assert.equal(t.get('frequency').state, MISSING);
  assert.equal(t.get('frequency').action, 'Request Frequency');
});

test('subscription is never inferred from how often somebody orders', () => {
  const src = withoutComments(SRC('core', 'intake.js'));
  const from = src.indexOf("key: 'service_type'");
  const fn = src.slice(from, src.indexOf("key: 'frequency'"));

  // The only thing it may read is an ACTIVE standing order. Anything counting
  // orders, or reading a past plan, is the thing Neil ruled out.
  assert.ok(fn.includes('ctx.subscriptionPlan'), fn);
  assert.ok(!/order_count|history|previous|had a plan/i.test(fn), fn);
});

test('both rates come off subscription.js, never typed into a sentence', () => {
  const text = tableFor(SETTLED).get('service_type').text;

  assert.ok(text.includes(subscription.oneTimeRate()), text);
  assert.ok(text.includes(subscription.subscriptionRate()), text);

  const src = withoutComments(SRC('core', 'intake.js'));
  assert.ok(!/\$\d/.test(src), 'a price is typed into intake.js');
});

// --- the words --------------------------------------------------------------

test('every question is plain ASCII, so none of them costs a third segment', () => {
  const both = [...tableFor(STRANGER).values(), ...tableFor(SETTLED).values()];

  for (const f of both) {
    if (!f.text) continue;
    assert.ok(/^[\x20-\x7E\n]*$/.test(f.text), `not GSM-safe: ${f.key} - ${f.text}`);
    assert.ok(!/[–—]/.test(f.text), `${f.key} has a dash: ${f.text}`);
  }
});

test('every question that can name them, does', () => {
  for (const f of tableFor(SETTLED).values()) {
    if (!f.text || f.key === 'frequency') continue;
    assert.match(f.text, /Sarah/, `${f.key} does not use their name: ${f.text}`);
  }
});

test('nothing asks a customer which state they live in', () => {
  // inServiceArea() checks the ZIP against the 67 Bergen codes. Asking somebody
  // to type "NJ" reads as a form rather than as a text.
  assert.ok(!/what state|which state/i.test(tableFor(STRANGER).get('address').text));
});

test('every row that can be asked for carries the cost of asking', () => {
  for (const f of tableFor(STRANGER).values()) {
    if (!f.action) continue;
    assert.ok(f.cost && f.cost.segments >= 1, `${f.key} has no segment count`);
  }
});

// --- 20. opted out ----------------------------------------------------------

test('an opted-out customer keeps the table and loses the buttons', () => {
  const fields = [...tableFor(SETTLED).values()];
  const html = intakeTable({ fields, action: '/x', canSend: false, optedOut: true });

  assert.ok(html.includes('Visa ending 4242'), 'the data disappeared');
  assert.ok(!html.includes('<form'), 'there is still a way to text them');
  assert.ok(html.includes('opted out'), 'nothing says why the buttons are gone');
});

test('send() refuses an opted-out number before it reaches the carrier', () => {
  const src = withoutComments(SRC('core', 'intake.js'));
  const send = src.slice(src.indexOf('async function send('));
  const refusal = send.indexOf("'unsubscribed'");
  const sends = send.indexOf('sendAndLog');

  assert.ok(refusal > 0 && refusal < sends, 'the opt-out check is after the send');
});

// --- 15 and 24. the shape of the thing --------------------------------------

test('the table stores nothing about a customer', () => {
  const src = withoutComments(SRC('core', 'intake.js'));

  // Neil's rule 24 and this codebase's oldest rule: no second intake state.
  // The ONE write is the label on an outbound message, and it goes through
  // notify like every other text.
  for (const forbidden of ['.insert(', '.update(', '.upsert(', '.delete(']) {
    assert.ok(!src.includes(forbidden), `intake.js does ${forbidden}`);
  }
});

test('every value is read from the system, not from a column of its own', () => {
  const src = withoutComments(SRC('core', 'intake.js'));

  // If this file ever grows its own table, this is what notices.
  assert.ok(!/from\('intake/.test(src), src.slice(0, 0));
  assert.ok(!/intake_state|intake_stage/.test(src));
});

test('the send re-reads the truth rather than trusting the form', () => {
  const src = withoutComments(SRC('core', 'intake.js'));
  const send = src.slice(src.indexOf('async function send('));

  const reread = send.indexOf('await fieldsFor(customer');
  const sends = send.indexOf('sendAndLog');

  assert.ok(reread > 0, 'send() trusts the button');
  assert.ok(reread < sends, 'the re-read happens after the send');
  assert.ok(send.includes("reason: 'stale'"), 'a changed answer is not refused');
});

test('an admin-started question is never stamped as a colleague working the thread', () => {
  // sent_by is what puts brain.js into its handover behaviour. That is wrong
  // for a one-line question whose whole purpose is that the AI handles the
  // answer - Neil's rules 34 and 41.
  const src = withoutComments(SRC('core', 'intake.js'));
  const send = src.slice(src.indexOf('async function send('));

  assert.ok(!send.includes('sentBy'), 'the intake table stamps sent_by');
});

test('the admin may edit the words and may not edit the link', () => {
  const src = withoutComments(SRC('core', 'intake.js'));
  const send = src.slice(src.indexOf('async function send('));

  // The message is whatever came out of the composer...
  assert.ok(send.includes('message == null ? now.text : message'), send.slice(0, 400));
  // ...and the URL is appended afterwards, by us.
  assert.ok(/text = `\$\{body\} \$\{url\}`/.test(send), send.slice(0, 900));
});

// --- 23. the old cards are gone ---------------------------------------------

test('there is no second intake interface left in the tree', () => {
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'src', 'web', 'nudge-panel.js')));
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'src', 'core', 'nudges.js')));

  const admin = SRC('routes', 'admin.js');
  assert.ok(!/nudgePanel\(/.test(admin), 'the old cards are still rendered');
});

// --- 6. the composer opens, it does not send --------------------------------

test('the action opens a composer rather than sending anything', () => {
  const fields = [...tableFor(STRANGER).values()];
  const html = intakeTable({ fields, action: '/ops/customers/c1/ask', canSend: true });

  // A link to the row's own id, and the form is behind it. Nothing on the row
  // itself submits.
  assert.ok(html.includes('href="#ask-name"'), html.slice(0, 400));
  assert.ok(html.includes('id="ask-name"'));
  assert.ok(html.includes('method="post"'));
});

test('the composer opens prefilled with the standard wording', () => {
  const fields = [...tableFor(SETTLED).values()];
  const html = intakeTable({ fields, action: '/x', canSend: true });

  assert.ok(html.includes('What address should we pick your laundry up from?'), 'not prefilled');
  assert.ok(html.includes('name="message"'), 'the words cannot be edited');
});

test('what the admin was looking at rides along, so a stale send can be refused', () => {
  const fields = [...tableFor(STRANGER).values()];
  const html = intakeTable({ fields, action: '/x', canSend: true });

  assert.ok(html.includes(`name="state" value="MISSING"`), html.slice(0, 200));
});

test('there is one send workflow, not a standard one beside a custom one', () => {
  const html = intakeTable({
    fields: [...tableFor(STRANGER).values()],
    action: '/x',
    canSend: true,
  });

  assert.ok(!/Send standard|Send custom/i.test(html));

  // One Send per row that has something to ask for, and no more.
  const askable = [...tableFor(STRANGER).values()].filter((f) => f.action).length;
  assert.equal((html.match(/type="submit"/g) || []).length, askable);
});

// --- the screen -------------------------------------------------------------

test('the table needs no JavaScript', () => {
  const src = SRC('web', 'intake-table.js');

  for (const forbidden of ['<script', 'onclick', 'onsubmit', 'addEventListener']) {
    assert.ok(!src.includes(forbidden), `the table uses ${forbidden}`);
  }
});

test('nothing a customer typed reaches the page unescaped', () => {
  const fields = [...tableFor({ ...SETTLED, name: '<script>alert(1)</script>' }).values()];
  const html = intakeTable({ fields, action: '/x', canSend: true });

  assert.ok(!html.includes('<script>'), 'a name is injected into the page');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('every row is drawn, including the finished ones', () => {
  const fields = [...tableFor(SETTLED).values()];
  const html = intakeTable({ fields, action: '/x', canSend: true });

  for (const f of intake.FIELDS) {
    assert.ok(html.includes(`>${f.label}<`), `${f.label} is not on the table`);
  }
});

test('a default is not dressed as a warning', () => {
  const fields = [...tableFor(STRANGER).values()];
  const html = intakeTable({ fields, action: '/x', canSend: true });

  // Cold water and softener are perfectly valid states. Only the three things
  // genuinely in the way get the loud treatment.
  assert.equal((html.match(/intake-state--bad/g) || []).length, 3);
});

test('the summary says the one thing an operator needs to know', () => {
  const settled = intakeTable({ fields: [...tableFor(SETTLED).values()], action: '/x' });
  const stranger = intakeTable({ fields: [...tableFor(STRANGER).values()], action: '/x' });

  assert.ok(settled.includes('They just need a date'), settled.slice(0, 600));
  assert.ok(/Waiting on .*name/.test(stranger), stranger.slice(0, 600));
});
