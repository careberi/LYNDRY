'use strict';

// ---------------------------------------------------------------------------
// BOOK FIRST. ASK WASH AFTER.
//
// Neil, 21 September, making true in code the rule he set on 16 September.
// Until now saveDetails() answered a recap's yes with the wash question and
// booked nothing, and nothing asked the question after a booking - the tool's
// reply is what reaches the phone, and a booking had no second pass.
//
// Three things, each pinned here:
//   1. save_details books straight through; no wash gate in front of it
//   2. a text booking sends the wash question as its own message, once
//   3. an answer after booking reaches the pickup already booked, because the
//      order carries its own copy of the wash and every reader prefers it
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

function fnBody(file, signature) {
  const src = withoutComments(SRC(...file));
  const at = src.indexOf(signature);
  assert.ok(at >= 0, `${signature} is gone`);
  const next = src.slice(at + signature.length).search(/\n(async )?function /);
  return next < 0 ? src.slice(at) : src.slice(at, at + signature.length + next);
}

// --- 1. no gate --------------------------------------------------------------

test('save_details no longer answers a yes with the wash question', () => {
  const fn = fnBody(['core', 'actions.js'], 'async function saveDetails(');
  assert.ok(!fn.includes('hasPreferences(updated)'), 'the wash gate is back in front of the booking');
  assert.ok(!/return \(\s*wash\.QUESTION\s*\)/.test(fn), 'the wash question is returned in place of a booking');
  assert.ok(fn.includes('return createOrder('), 'save_details no longer books');
});

test('the only wash question left in actions.js is the invalid-answer reply', () => {
  const src = withoutComments(SRC('core', 'actions.js'));
  const uses = src.split('wash.QUESTION').length - 1;
  assert.equal(uses, 1, `${uses} places ask the wash question`);
  assert.ok(src.includes('I did not catch which option you meant. ${wash.QUESTION}'));
});

// --- 2. asked after, once ----------------------------------------------------

test('a successful booking says so, and only a successful one', () => {
  const fn = fnBody(['core', 'actions.js'], 'async function createOrder(');
  const booked = fn.indexOf('helpers.booked = result.order');
  assert.ok(booked > 0, 'createOrder never says it booked');
  // After both early returns: the card ask and the refused hold are not bookings.
  assert.ok(booked > fn.indexOf('if (result.holdRefused)'), 'a refused hold would be asked about the wash');
  assert.ok(booked > fn.indexOf('needsCard'), 'a card ask would be asked about the wash');

  const run = withoutComments(SRC('core', 'actions.js'));

  // createOrder() IS NO LONGER REACHABLE FROM run(), WHICH IS THE POINT.
  // Neil, 26 September: Lyn may answer a text but may not take an order. The
  // function itself is kept intact rather than deleted - this decision has been
  // reversed twice in one day, and what makes it safe is that nothing can call
  // it, not that it is gone.
  const brain = require('../src/core/brain');
  assert.ok(brain.CANNOT_BOOK.includes('create_order'), 'Lyn can book again');
  assert.ok(
    !brain.OFFERED_TOOLS.some((t) => t.name === 'create_order'),
    'create_order is still being offered to the model'
  );
  assert.ok(
    run.includes('if (brain.CANNOT_BOOK.includes(name)) {'),
    'run() no longer refuses order-taking, so only the prompt is stopping her'
  );
  assert.ok(run.includes("case 'save_details':\n      return saveDetails(customer, input, helpers);"));
});

test('sms.js asks the wash question after the confirmation, as its own message', () => {
  const sms = withoutComments(SRC('routes', 'sms.js'));
  const confirm = sms.lastIndexOf("await say(from, message, customer.id, { kind: 'AI' });");
  const ask = sms.indexOf('if (helpers.booked) {\n    await washAsk.askAfterBooking(customer, { send: (body, options) => say(from, body, customer.id, options) });');
  assert.ok(confirm > 0 && ask > confirm, 'the wash question is not sent after the confirmation');

  // The gate lives in one module both doors share.
  const fn = fnBody(['core', 'wash-ask.js'], 'async function askAfterBooking(');
  assert.ok(fn.includes('wash.QUESTION'), 'it is not the wash question, word for word');
  assert.ok(fn.includes("kind: 'SYSTEM'"), 'it could be chased');
  assert.ok(fn.includes("askedFor: 'water_temp'"), 'the intake table would not show it asked');
  assert.ok(fn.includes('await askedAt(customer.phone)'), 'nothing stops it being asked twice');
  assert.ok(fn.includes('await nothingChosen(customer)'), 'a half-chosen wash would be asked in full');
  // Anything chosen at all is left to Lyn, who asks only for the missing half.
  const chosen = fnBody(['core', 'wash-ask.js'], 'async function nothingChosen(');
  assert.ok(/wash\.KEYS\.some\(\(key\) => wash\.isValid\(key, prefs\[key\]\)\)/.test(chosen), chosen);
});

test('the sent-once check looks at the label and at the words', () => {
  const fn = fnBody(['core', 'wash-ask.js'], 'async function askedAt(');
  assert.ok(fn.includes(".in('asked_for', ['water_temp', 'fabric_softener'])"), fn);
  assert.ok(fn.includes("wash.QUESTION.split('\\n')[0]"), fn);
  // By phone, the way every thread is read.
  assert.ok(fn.includes(".eq('phone', phone)"), fn);
});

test('a text booking that needed a card is asked too, once the card confirms it', () => {
  // Every new customer who books by text while Stripe is live: the card link
  // goes where the confirmation would, so sms.js asks nothing, and the
  // confirmation arrives from card-saved.js when the card is saved.
  const fn = fnBody(['core', 'card-saved.js'], 'async function cardWasSaved(');
  const confirm = fn.indexOf("opener: 'Card saved',\n            freeOrder: free.freeOrder,");
  const ask = fn.indexOf("if (!refused && pending.placed_via !== 'WEB') await washAsk.askAfterBooking(customer);");
  assert.ok(confirm > 0 && ask > confirm, 'no wash question after the card-saved confirmation');
  // Exactly one ask: the website checkout branch chose the wash as a form step.
  assert.equal(fn.split('washAsk.askAfterBooking(').length - 1, 1);
});

test('the model is told whether the question has been asked, from the whole thread', () => {
  const sms = withoutComments(SRC('routes', 'sms.js'));
  assert.ok(sms.includes('customer.washAskedAt = await washAsk.askedAt(customer.phone)'), 'the fact is not handed over');
  const decide = sms.indexOf('decision = await brain.decide(');
  assert.ok(sms.indexOf('customer.washAskedAt =') < decide, 'it is read after the model has already answered');

  const brain = require('../src/core/brain');
  const asked = brain.customerContext({ id: 'c', name: 'Pat', preferences: {}, washAskedAt: '2026-09-10T15:00:00Z' }, null, [], [], null);
  assert.ok(/already asked on 09\/10\/2026: do NOT ask it again/.test(asked), asked);
  const never = brain.customerContext({ id: 'c', name: 'Pat', preferences: {} }, null, [], [], null);
  assert.ok(/has never been asked/.test(never), never);

  const prompt = brain.systemPrompt('2026-09-21', { date: '2026-09-21', time: '10:00' });
  assert.ok(/You ask it ONLY when all three are true: they already have a pickup booked/.test(prompt), 'the prompt lets Lyn ask before a booking');
});

test('the prompt says the system sends it, and not to ask it twice', () => {
  const brain = require('../src/core/brain');
  const prompt = brain.systemPrompt('2026-09-21', { date: '2026-09-21', time: '10:00' });
  assert.ok(/the SYSTEM sends the wash question as its own message/.test(prompt));
  assert.ok(/If it is already in the thread, do not ask it again/.test(prompt));
});

// --- 3. the answer reaches the order -----------------------------------------

test('an answer after booking is copied onto the booked orders: the wash while waiting, the spot until delivery', () => {
  const fn = fnBody(['core', 'booking.js'], 'async function refreshBookedOrders(');
  assert.ok(fn.includes(".in('status', ['REQUESTED', ...orders.IN_OUR_HANDS])"), 'a new spot does not reach a bag we hold');
  assert.ok(fn.includes("const waiting = order.status === 'REQUESTED';"), fn);
  assert.ok(fn.includes('if (waiting) merged[key] = prefs[key];'), 'the wash could rewrite a bag we already hold');
  assert.ok(fn.includes('done.washHeldBack.push(order.order_number)'), 'the reply cannot say the bag we hold keeps its wash');
  assert.ok(fn.includes('for (const key of SPOT_KEYS)'), 'a new spot never reaches the order');
  assert.ok(fn.includes('if (!was || !Object.keys(was).length) continue;'), 'an empty snapshot would hide the customer\'s own spot');
  assert.ok(fn.includes('if (waiting) update.surcharge_cents = wash.surchargeFor(merged);'), 'the surcharge would not follow the wash');
  assert.ok(fn.includes(".eq('status', order.status)"), 'an order that moved underneath could be rewritten');
  assert.ok(fn.includes("kind: 'NOTE'"), 'the change is not on the order\'s record');
  assert.ok(/try \{[\s\S]*\} catch \(err\) \{/.test(fn), 'a failure here could break the reply');

  const actions = withoutComments(SRC('core', 'actions.js'));
  assert.ok(actions.includes('await booking.refreshBookedOrders(customer.id, updated.preferences)'), 'save_details does not copy it');
  assert.ok(actions.includes('const done = await booking.refreshBookedOrders(customer.id, preferences);'), 'update_profile does not copy it');

  // The account page's own wash and address forms reach the order too.
  const account = withoutComments(SRC('routes', 'account.js'));
  const saveWash = account.slice(account.indexOf('async function saveWash('), account.indexOf('async function saveWash(') + 1500);
  assert.ok(saveWash.includes('await booking.refreshBookedOrders(customer.id, preferences)'), '/account/wash never reaches the waiting pickup');
  assert.equal(account.split('booking.refreshBookedOrders(').length - 1, 2, 'the address form (the spot) or the wash form does not copy');
});

test('an answer to our own wash question is never refused because a bag is with us', () => {
  // It used to be, and the answer was thrown away for good: nothing saved, and
  // the question never asked again because it had been asked.
  const fn = fnBody(['core', 'actions.js'], 'async function lockedWhileWithUs(');
  assert.ok(!fn.includes('WASH_FIELDS'), 'a wash answer is still refused');
  assert.ok(!/can't change how this one is done/.test(fn), fn);
  assert.ok(fn.includes('ADDRESS_FIELDS'), 'the address lock went too');

  const held = fnBody(['core', 'actions.js'], 'function heldBackLine(');
  assert.ok(/goes through as booked/.test(held), 'the reply does not say the bag we hold keeps its wash');
});

test('a wash we cannot change is never called their usual settings', () => {
  const src = withoutComments(SRC('core', 'actions.js'));
  assert.ok(!/your usual settings/.test(src), 'a default read back as their choice');
});
