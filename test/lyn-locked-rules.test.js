'use strict';

// ---------------------------------------------------------------------------
// LYN'S LOCKED RULES, 21 SEPTEMBER.
//
// Neil's list, each line a rule a real thread had broken or could break:
//
//   - the facts: back the next day after pickup, $2.00/lb one-time, $1.80/lb on
//     a subscription, a $25 minimum, charged after the weigh-in, no membership,
//     no delivery fee
//   - one question at a time; no website welcome to somebody who says "Hi"
//   - she introduces herself once, never mid-conversation (lyn-identity.test.js)
//   - no dashes in anything a customer reads; never "same day"
//   - a wrong number or junk gets one short line or nothing, and no booking flow
//   - defaults are placeholders, never read back as the customer's answer
//
// Most of these are instructions to a model, so the only thing a test can hold
// is that the instruction is there and its old contradiction is not. Where a
// rule is enforced in code - the dash guard, NO_REPLY, the short-code guard -
// it is tested as behaviour. Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const brain = require('../src/core/brain');
const { toPlainText } = require('../src/core/notify');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// The prompt as the model actually receives it, open for business.
const PROMPT = brain.systemPrompt('2026-09-21', { date: '2026-09-21', time: '10:00' });

// --- the facts --------------------------------------------------------------

test('the locked facts are stated, all of them', () => {
  const at = PROMPT.indexOf('THE FACTS, LOCKED');
  assert.ok(at > 0, 'the locked facts block is missing');
  const block = PROMPT.slice(at, PROMPT.indexOf('\n\n', at));

  assert.ok(/next day after pickup/.test(block), 'the return promise');
  assert.ok(block.includes('$2.00/lb'), 'the one-time rate');
  assert.ok(block.includes('$1.80/lb'), 'the subscription rate');
  assert.ok(/\$25 minimum/.test(block), 'the minimum');
  assert.ok(/charged after we weigh/.test(block), 'when the card is charged');
  assert.ok(/no membership/i.test(block), 'no membership');
  assert.ok(/no delivery fee/i.test(block), 'no delivery fee');
});

test('nothing in the prompt still says we charge after delivery', () => {
  assert.ok(!/charge after the laundry is back/i.test(PROMPT));
  assert.ok(!/charged when we (deliver|drop)/i.test(PROMPT));
});

test('"same day" is only ever forbidden, never offered', () => {
  // The one legitimate use of the words in the prompt is the rule against them
  // and "more than one on the same day", which is about bookings, not returns.
  for (const m of PROMPT.matchAll(/same day[^.]*/gi)) {
    const around = PROMPT.slice(Math.max(0, m.index - 80), m.index + 60);
    assert.ok(
      /NEVER say|never promise the same day|on the same day once|same day, no extra charge/.test(around),
      `"same day" used as a promise: ...${around}...`
    );
  }
});

test('the price answer names both rates, the minimum, and no fees', () => {
  const line = PROMPT.split('\n').find((l) => l.startsWith('  RIGHT: A one-time pickup is'));
  assert.ok(line, 'the worked price answer is gone');
  for (const bit of ['$2.00/lb', '$1.80/lb', '$25 minimum', 'No membership', 'no delivery fee']) {
    assert.ok(line.includes(bit), `the price answer is missing "${bit}"`);
  }
});

// --- greetings and the welcome -----------------------------------------------

test('"Hi" gets a line, not the website welcome', () => {
  assert.ok(/A GREETING GETS A GREETING, NOT A WELCOME/.test(PROMPT));
  assert.ok(!/INTRODUCTION WORD FOR WORD/.test(PROMPT), 'the model is still told to recite the welcome');
  assert.ok(!/grab your laundry this week\?/i.test(PROMPT.replace(/"want us to grab your laundry this week\?"/i, '')),
    'the website welcome\'s ask is in the prompt as something to say');
});

test('the prompt no longer builds the welcome block at all', () => {
  const fn = withoutComments(SRC('core', 'brain.js'));
  const at = fn.indexOf('function systemPrompt(');
  const body = fn.slice(at, fn.indexOf('\nfunction ', at + 10));
  assert.ok(!body.includes('onboarding.introduction('), 'the welcome is still handed to the model');
});

test('the model is told the introduction is added for it', () => {
  assert.ok(/YOUR INTRODUCTION IS ADDED FOR YOU/.test(PROMPT));
  assert.ok(/YOU NEVER INTRODUCE YOURSELF/.test(PROMPT));
});

// --- one question at a time ---------------------------------------------------

test('a pickup request asks for the name alone, not the name and address together', () => {
  assert.ok(!/ask for the name and street address\. That is ONE question/.test(PROMPT), 'the two-in-one question is back');
  assert.ok(/ask for their name\. ONE question/.test(PROMPT));
});

test('the stale five-beat list with the wash before booking is gone', () => {
  assert.ok(!/the setup is five short beats/.test(PROMPT));
  assert.ok(!/There are NO default wash settings/.test(PROMPT), 'a claim that contradicts the placeholder rule');
});

// --- name, address and "24 hours" ---------------------------------------------

test('name, address and "24 hours" gets the address, the next day, and the soonest window', () => {
  const at = PROMPT.indexOf('NAME, ADDRESS AND "24 HOURS" IN ONE MESSAGE');
  assert.ok(at > 0, 'the scenario is not covered');
  const rule = PROMPT.slice(at, PROMPT.indexOf('\n', at));
  assert.ok(/read the address back/.test(rule));
  assert.ok(/next day after pickup/.test(rule));
  assert.ok(/soonest window/.test(rule));
  assert.ok(/check_slot/.test(rule), 'the window has to come from check_slot, never arithmetic');
  // check_slot refuses a customer with no name or address saved, so the save
  // has to come first. The first version said the opposite.
  assert.ok(rule.indexOf('save_details') < rule.indexOf('check_slot'), 'the check would be refused for no address');
});

test('the engine lets one lookup follow a save, then writes one reply', () => {
  const sms = withoutComments(SRC('routes', 'sms.js'));
  const at = sms.indexOf("isLookup && SETUP_ACTIONS.includes(decision.name)");
  assert.ok(at > 0, 'a check_slot after save_details is still thrown away');
  const branch = sms.slice(at, sms.indexOf('} else if (LOOKUP_ACTIONS.includes(decision.name))', at));
  assert.ok(branch.includes('actions.run(followOn.name'), 'the lookup never runs');
  assert.ok(/brain\.decide\([\s\S]*lookup: true/.test(branch), 'its facts are never turned into words');
  assert.ok(branch.includes('brain.isNoReply(written)'), 'the word NO_REPLY could be sent');
  // Bounded: the last pass's text is used, and a tool from it is not run.
  assert.ok(!/actions\.run\(words/.test(branch), 'a third action could run');

  // And the model is told it may.
  const decide = withoutComments(SRC('core', 'brain.js'));
  assert.ok(/call check_slot for today with no time, and you will/.test(decide), 'the save follow-up never offers the lookup');
});

// --- defaults are placeholders -------------------------------------------------

test('defaults are named as placeholders, never answers', () => {
  assert.ok(/A DEFAULT IS A PLACEHOLDER, NEVER THEIR ANSWER/.test(PROMPT));
});

test('the recap example carries no wash nobody chose', () => {
  const at = PROMPT.indexOf('CONFIRM BEFORE BOOKING');
  const example = PROMPT.slice(at, PROMPT.indexOf('ALWAYS name the day', at));
  assert.ok(!/washed cold with softener/.test(example), 'the recap example reads our default back');
});

test('the customer notes tell a chosen wash from our placeholder', () => {
  const customer = { id: 'c', name: 'Pat', address_line1: '1 Main St', city: 'Fair Lawn', state: 'NJ', postal_code: '07410', preferences: {} };
  const notes = brain.customerContext(customer, null, [], [], null);
  assert.ok(/Wash: NOT CHOSEN/.test(notes), notes);
  assert.ok(/placeholder, not their answer/.test(notes), notes);
});

test('a wash chosen in part says which part, and asks only for the rest', () => {
  const customer = { id: 'c', name: 'Pat', preferences: { water_temp: 'COLD' } };
  const notes = brain.customerContext(customer, null, [], [], null);
  assert.ok(/Wash, PARTLY CHOSEN: they chose water temperature cold/.test(notes), notes);
  assert.ok(/Not chosen: fabric softener/.test(notes), notes);
});

test('a separate drop-off spot is never named as the pickup spot', () => {
  const both = { id: 'c', name: 'Pat', preferences: { special_instructions: 'behind the side gate', dropoff_spot: 'with the doorman' } };
  const notes = brain.customerContext(both, null, [], [], null);
  assert.ok(/Pickup spot: behind the side gate \(they told us\)/.test(notes), notes);
  assert.ok(/Drop-off spot, for the clean laundry: with the doorman/.test(notes), notes);
  assert.ok(!/pickup and drop-off \(they told us\): with the doorman/.test(notes), 'the drop-off read as where to collect');
});

test('the wash question is in the prompt word for word', () => {
  // It lived only in the stale five-beat list, which went; the line that
  // points at it has to carry it now.
  const wash = require('../src/core/wash');
  assert.ok(PROMPT.includes(`WORD FOR WORD: "${wash.QUESTION}"`), 'the model would paraphrase the wash question');
});

test('the answer to "am I talking to a person" starts with No', () => {
  assert.ok(/"No, I'm Lyn, LYNDRY's automated assistant/.test(PROMPT));
});

test('a pending $25 hold is explained, never called a payment', () => {
  assert.ok(/hold on the card to confirm it, which shows as pending; it is not a charge/.test(PROMPT));
});

test('the spot is read from where it is saved, not from the default column', () => {
  const told = { id: 'c', name: 'Pat', preferences: { special_instructions: 'behind the side gate', default_pickup_method: 'LEAVE_OUTSIDE' } };
  assert.ok(/they told us\): behind the side gate/.test(brain.customerContext(told, null, [], [], null)));

  const untold = { id: 'c', name: 'Pat', preferences: { default_pickup_method: 'LEAVE_OUTSIDE' } };
  const notes = brain.customerContext(untold, null, [], [], null);
  assert.ok(/Where the bag goes: NOT GIVEN/.test(notes), 'a defaulted column read as their answer');
  assert.ok(!/leaves the bag outside/.test(notes));
});

test('a requested time is passed to the tool, but the recap names the window', () => {
  const customer = { id: 'c', name: 'Pat', preferences: {}, pending_pickup: { date: '2026-09-22', time: '10:30', window: '10am to 12pm' } };
  const notes = brain.customerContext(customer, null, [], [], null);
  assert.ok(/name the WINDOW that holds that time, never the time itself/.test(notes), notes);
  assert.ok(!/Use this day and time in the recap/.test(notes), 'the read-back of the raw time is back');
});

// --- subscriptions --------------------------------------------------------------

test('the prompt never pitches a subscription after a delivery - the system does', () => {
  assert.ok(/YOU NEVER PITCH IT AFTER A DELIVERY/.test(PROMPT));
  assert.ok(!/It is offered ONCE, after a delivery/.test(PROMPT), 'the old instruction to offer it is back');
  assert.ok(!/It is not a subscription and must never be called one/.test(PROMPT), 'a contradiction of "the word is Subscription"');
  assert.ok(!/Offer one only after a delivery/.test(brain.customerContext({ id: 'c', preferences: {} }, null, [], [], null)));
});

test('set_pickup_schedule can make every frequency the offer names', () => {
  const tool = brain.TOOLS.find((t) => t.name === 'set_pickup_schedule');
  const cadences = tool.input_schema.properties.cadence.enum;
  for (const c of ['WEEKLY', 'FORTNIGHTLY', 'MONTHLY']) assert.ok(cadences.includes(c), `${c} is missing`);
});

// --- junk and NO_REPLY ------------------------------------------------------------

test('the prompt tells the model how to say nothing, and when', () => {
  assert.ok(/A WRONG NUMBER OR JUNK IS NOT A CUSTOMER/.test(PROMPT));
  assert.ok(PROMPT.includes(`Write exactly ${brain.NO_REPLY} and nothing else`));
});

test('NO_REPLY is recognised however the model dresses it', () => {
  for (const said of [
    'NO_REPLY', 'no_reply', 'NO_REPLY.', '"NO_REPLY"', ' no reply ', 'No-Reply',
    'NO_REPLY (wrong number)', '**NO_REPLY**', 'NO_REPLY.\n\nThis looks like spam.',
  ]) {
    assert.ok(brain.isNoReply(said), JSON.stringify(said));
  }
  for (const said of ['', 'No problem, sorry to bother you.', 'no reply needed, thanks', 'Reply STOP to opt out']) {
    assert.ok(!brain.isNoReply(said), said);
  }
});

test('every sender checks for NO_REPLY before anything reaches a phone', () => {
  const sms = withoutComments(SRC('routes', 'sms.js'));
  const say = sms.slice(sms.indexOf('const say ='), sms.indexOf('const say =') + 400);
  assert.ok(say.includes('brain.isNoReply(body)'), 'the wrapper every AI reply goes through does not check');

  const followups = withoutComments(SRC('core', 'followups.js'));
  assert.ok(followups.includes('brain.isNoReply(clean)'), 'a chase could send the word itself');
});

test('a sender that is not a US mobile is logged and never answered', () => {
  const sms = withoutComments(SRC('routes', 'sms.js'));
  const guard = sms.indexOf("/^\\+1\\d{10}$/.test(String(from || ''))");
  assert.ok(guard > 0, 'the short-code guard is missing');
  // After the message is logged, and before anything that could create a
  // customer, grant a promotion or reply.
  assert.ok(guard > sms.indexOf('recordInbound('), 'the message would not be logged');
  for (const later of ['compliance.classify(', 'onboarding.startConversation(', 'replyToBlank(']) {
    assert.ok(guard < sms.indexOf(later), `${later} runs before the guard`);
  }
});

// --- no dashes -------------------------------------------------------------------

test('the send-time guard takes a dash out in any spacing', () => {
  const cases = [
    ['Hi—we got it', 'Hi, we got it'],
    ['Hi — we got it', 'Hi, we got it'],
    ['Hi – we got it', 'Hi, we got it'],
    ['Hi - we got it', 'Hi, we got it'],
    ['Hi -we got it', 'Hi, we got it'],
    ['Hi- we got it', 'Hi, we got it'],
    ['Hi–we got it', 'Hi, we got it'],
  ];
  for (const [given, sent] of cases) assert.equal(toPlainText(given), sent, JSON.stringify(given));
});

test('a spaced dash between numbers is a range, and reads as "to"', () => {
  assert.equal(toPlainText('between 2 – 4pm'), 'between 2 to 4pm');
  assert.equal(toPlainText('8 - 10am works'), '8 to 10am works');
});

test('a dash opening a line goes, and never drags the line above into it', () => {
  assert.equal(toPlainText('Thanks.\n\n— Lyn'), 'Thanks.\n\nLyn');
});

test('a negative number is not a pause', () => {
  assert.equal(toPlainText('It was -5 out'), 'It was -5 out');
});

test('hyphens that are part of a thing are left alone', () => {
  for (const kept of [
    'wash-and-fold',
    '16-50 Chandler Dr',
    '(201) 554-1877',
    'https://lyndry.com/p/1b2c-3d4e',
    'between 8-10am',
    'Tag WZ7MZ8-1',
  ]) {
    assert.equal(toPlainText(kept), kept, kept);
  }
});

test('the example replies in the prompt carry no dashes for the model to copy', () => {
  const examples = PROMPT.split('\n').filter((l) => /^\s*(RIGHT:|You:)/.test(l));
  assert.ok(examples.length > 5, 'the examples moved; point this test at them');
  for (const line of examples) {
    assert.ok(!/ - |—|–/.test(line), `a dash in an example reply: ${line.trim()}`);
  }
});

test('the example windows are real windows', () => {
  // "between 2 and 5pm" sat in the house-voice examples; there is no such window.
  assert.ok(!/between 2 and 5pm/.test(PROMPT));
  assert.ok(!/between 5:30 and 7/.test(PROMPT));
});

test('the example about comforters agrees with the rule about comforters', () => {
  assert.ok(!/do you do comforters\?[^\n]*\n\s*You:\s*We do/.test(PROMPT), 'the example says yes where the rule says no');
});
