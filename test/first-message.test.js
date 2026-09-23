'use strict';

// ---------------------------------------------------------------------------
// ONE FIRST MESSAGE, WHATEVER THE DOOR.
//
// Neil, 21 September: "Same intro everywhere. Website, Facebook lead, door
// hanger, or they text Hi: first AI reply is 'Hi, I'm Lyn, LYNDRY's automated
// assistant.' Then the same short next line. Do not send a longer website-only
// welcome to one source and a short Hi to another. If they have 50% off, say
// that in that same first reply for every source."
//
// The message is onboarding.firstMessage() and is tested as behaviour. The
// "Hi" door lives in sms.js and needs a database, so its wiring is read.
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lyn = require('../src/core/lyn');
const onboarding = require('../src/core/onboarding');
const leads = require('../src/core/leads');
const brain = require('../src/core/brain');
const notify = require('../src/core/notify');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// The automatic promotion as it sits in the database (test/website-popup.test.js
// holds the same fixture), and the door hanger's.
const CLEAN50 = {
  name: 'CLEAN50 - 50% off first order',
  blurb: '50% off your first order',
  kind: 'PERCENT_OFF',
  value: 50,
  applies_to: 'FIRST_ORDER',
  audience: 'NEW_NUMBERS',
  status: 'ACTIVE',
  expires_days: 30,
};
const DOOR_HANGER = {
  name: 'Door hanger - $10 off',
  blurb: '$10 off your first order',
  kind: 'AMOUNT_OFF',
  value: 1000,
  applies_to: 'FIRST_ORDER',
  audience: 'CODE',
  status: 'ACTIVE',
};

// --- the message ----------------------------------------------------------

test('it opens with the introduction, word for word', () => {
  const text = onboarding.firstMessage({ promo: CLEAN50 });
  assert.ok(text.startsWith(lyn.INTRODUCTION), text);
  // "I'm Lyn," is what lyn.everIntroduced() looks for, so a code-sent first
  // message stops her introducing herself again on their first reply.
  assert.ok(text.includes(lyn.SAID_IT), text);
});

test('the 50% is in it when they hold it', () => {
  assert.equal(
    onboarding.firstMessage({ promo: CLEAN50 }),
    "Hi, I'm Lyn, LYNDRY's automated assistant. 50% off your first order is on your account, ready to use. Want us to pick up your laundry?"
  );
});

test('what they hold is what it says: a door-hanger scan says $10', () => {
  assert.ok(onboarding.firstMessage({ promo: DOOR_HANGER }).includes('$10 off your first order'));
});

test('no offer, no offer sentence - never an invented one', () => {
  assert.equal(onboarding.firstMessage({}), `${lyn.INTRODUCTION} ${onboarding.NEXT_LINE}`);
  assert.equal(onboarding.firstMessage({ promo: { ...CLEAN50, blurb: null } }), `${lyn.INTRODUCTION} ${onboarding.NEXT_LINE}`);
});

test('every code door sends exactly the same text', () => {
  const website = onboarding.welcomeMessage({ promo: CLEAN50 });
  const facebook = leads.leadMessage({ promo: CLEAN50 });
  const shared = onboarding.firstMessage({ promo: CLEAN50 });
  assert.equal(website, shared);
  assert.equal(facebook, shared);

  const withDate = { promo: CLEAN50, opensOn: '2026-09-28' };
  assert.equal(onboarding.welcomeMessage(withDate), onboarding.firstMessage(withDate));
  assert.equal(leads.leadMessage(withDate), onboarding.firstMessage(withDate));
});

test('the "Hi" door is built from the same parts', () => {
  // sms.js sends the offer and the next line through say(), which puts the
  // introduction in front - so the parts, joined, must be the whole message.
  const parts = onboarding.firstMessageParts({ promo: CLEAN50 });
  const viaSay = lyn.lead(lyn.INTRODUCTION, [parts.offer, parts.next].filter(Boolean).join(' '));
  assert.equal(viaSay, onboarding.firstMessage({ promo: CLEAN50 }));
});

test('it is short: one segment, two with an opening date or shut', () => {
  const seg = (m) => notify.describeCost(notify.toPlainText(m)).segments;
  assert.equal(seg(onboarding.firstMessage({ promo: CLEAN50 })), 1);
  assert.equal(seg(onboarding.firstMessage({})), 1);
  assert.ok(seg(onboarding.firstMessage({ promo: CLEAN50, opensOn: '2026-09-28' })) <= 2);
  assert.ok(seg(onboarding.firstMessage({ promo: CLEAN50, open: false })) <= 2);
});

test('shut, it never invites a booking, and still names the offer', () => {
  const text = onboarding.firstMessage({ promo: CLEAN50, open: false });
  assert.ok(!/pick up your laundry\?/.test(text), text);
  assert.ok(/not booking pickups just yet/.test(text), text);
  assert.ok(text.includes('50% off your first order'), text);
});

test('before the first van day, it names that day', () => {
  assert.ok(/First pickups are Monday 28 Sep\./.test(onboarding.firstMessage({ opensOn: '2026-09-28' })));
});

test('none of the old per-door openings or the long welcome survive', () => {
  for (const m of [
    onboarding.firstMessage({ promo: CLEAN50 }),
    leads.leadMessage({ promo: CLEAN50 }),
    onboarding.firstMessage({ promo: CLEAN50, open: false }),
  ]) {
    assert.ok(!/thanks for sending over your number|Facebook laundry form|thanks for scanning|thanks for texting in/i.test(m), m);
    assert.ok(!/this week/i.test(m), m);
    assert.ok(!/same day/i.test(m), m);
    assert.ok(!/ - |—|–/.test(m), m);
  }
});

// --- a bare greeting --------------------------------------------------------

test('a bare greeting is recognised', () => {
  for (const g of ['hi', 'Hi!', 'hello', 'hello there', 'Hey LYNDRY', 'hiya', 'yo', 'good morning', 'JOIN']) {
    assert.ok(onboarding.isJustAGreeting(g), g);
  }
});

test('anything more than a greeting goes to Lyn', () => {
  for (const g of ['hi can you come tomorrow', 'hello, how much is it?', 'thanks', 'good', 'there', 'STOP', '', 'hi\nwhat do you charge']) {
    assert.ok(!onboarding.isJustAGreeting(g), JSON.stringify(g));
  }
});

// --- the wiring -------------------------------------------------------------

test('a bare hi from somebody new gets the first message, not the model', () => {
  const sms = withoutComments(SRC('routes', 'sms.js'));
  const from = sms.indexOf('const openingLine = await lyn.opener');
  const branch = sms.indexOf('onboarding.isJustAGreeting(text)', from);
  const decide = sms.indexOf('brain.decide(', from);
  assert.ok(from > 0 && branch > from, 'no greeting branch after the opener');
  assert.ok(branch < decide, 'the model is asked before the greeting is answered');
  assert.ok(sms.includes('onboarding.firstMessagePartsFor(customer)'), 'the parts are not the shared ones');
  // Only for somebody the introduction is owed to.
  assert.ok(sms.includes('openingLine === lyn.INTRODUCTION'), 'a known customer could be sent the first message');
});

test('a question from somebody new gets the introduction and the offer in front', () => {
  const sms = withoutComments(SRC('routes', 'sms.js'));
  assert.ok(sms.includes('opening = `${openingLine} ${firstParts.offer}`'), 'the offer is not in the first reply');
  // And the model is told what will be in front of its words.
  assert.ok(/brain\.decide\(\{[^}]*opening/.test(sms), 'decide() is not told the opener');
  const brain = withoutComments(SRC('core', 'brain.js'));
  assert.ok(brain.includes('THE SYSTEM WILL PUT THIS IN FRONT OF YOUR REPLY'), 'the model is never told');
});

test('the opener goes on one message a turn, never two', () => {
  const sms = withoutComments(SRC('routes', 'sms.js'));
  const at = sms.indexOf('const say =');
  const say = sms.slice(at, sms.indexOf('\n  };\n', at));
  assert.ok(say.includes("opening = '';"), 'a second message in the same turn would be introduced again');
});

// --- review, 21 September ------------------------------------------------------

test('only somebody we have never texted, with nothing booked, gets the canned first message', () => {
  // A customer booked on the website or by phone has only our confirmation in
  // their thread, and texting "hello?" while waiting for the van got "Want us
  // to pick up your laundry?". A laundromat owner replying "Hi" to Neil's pitch
  // link got the consumer offer. Both have history, and history means null.
  const src = withoutComments(SRC('core', 'onboarding.js'));
  const at = src.indexOf('async function firstMessagePartsFor(');
  const fn = src.slice(at, src.indexOf('\n}\n', at));
  assert.ok(/^\s*if \(await weHaveHistoryWith\(customer\)\) return null;/m.test(fn), fn);

  const hist = src.slice(src.indexOf('async function weHaveHistoryWith('), src.indexOf('async function firstMessagePartsFor('));
  assert.ok(hist.includes(".eq('direction', 'OUTBOUND')"), 'it does not look at what we sent');
  assert.ok(hist.includes(".eq('phone', customer.phone)"), 'a stranger\'s thread has no customer id, so it must be read by phone');
  assert.ok(hist.includes(".from('orders')"), 'a booked customer is not recognised');
  assert.ok(/catch \(err\) \{[\s\S]*return true;/.test(hist), 'a failed lookup must fail to "yes, we know them"');
});

test('a promotion with no blurb is silent in the first message, even a free one', () => {
  // #1975's shape: a one-order 100% waiver Neil put on by hand, no blurb.
  const handGiven = { name: 'Waiver', blurb: null, kind: 'PERCENT_OFF', value: 100, applies_to: 'NEXT_ORDERS', audience: 'SPECIFIC', max_orders: 1, status: 'ACTIVE' };
  const text = onboarding.firstMessage({ promo: handGiven });
  assert.ok(!/free|promotion|off/i.test(text), text);
  assert.equal(text, `${lyn.INTRODUCTION} ${onboarding.NEXT_LINE}`);

  const src = withoutComments(SRC('core', 'onboarding.js'));
  assert.ok(src.includes("const promo = held.find((h) => String(h.blurb || '').trim()) || null;"), 'the Lyn door picks a silent promotion');
});

test('a stretched greeting or a wave is a greeting; a word that folds into one is not', () => {
  for (const g of ['Heyyyy', 'Hellooo', 'hiiii', 'Helloo', 'Sup', 'yooo', '\u{1F44B}', 'hey hey']) {
    assert.ok(onboarding.isJustAGreeting(g), g);
  }
  for (const t of ['good', 'god', 'thanks', 'hiiii can you come today', '\u{1F44B} how much']) {
    assert.ok(!onboarding.isJustAGreeting(t), t);
  }
});

test('the Facebook lead is told we are shut when we are shut, like every other door', () => {
  const shut = leads.leadMessage({ promo: CLEAN50, open: false });
  assert.equal(shut, onboarding.firstMessage({ promo: CLEAN50, open: false }));
  assert.ok(!/pick up your laundry\?/.test(shut), shut);

  const src = withoutComments(SRC('core', 'leads.js'));
  assert.ok(src.includes('leadMessage({ promo, opensOn, open })'), 'the sweep does not pass the closed sign');
  assert.ok(src.includes("held.find((h) => String(h.blurb || '').trim())"), 'the lead picks a silent promotion');
});

test('a wrong number gets its one line with nothing in front of it', () => {
  assert.equal(brain.wrongNumberLine('WRONG_NUMBER No problem, sorry to bother you.'), 'No problem, sorry to bother you.');
  assert.equal(brain.wrongNumberLine('**WRONG_NUMBER**: No problem.'), 'No problem.');
  assert.equal(brain.wrongNumberLine('WRONG_NUMBER'), '', 'the word alone must be silence, never sent');
  assert.equal(brain.wrongNumberLine('Wrong number? No worries.'), null);
  assert.equal(brain.wrongNumberLine('How much is it?'), null);

  const prompt = brain.systemPrompt('2026-09-21', { date: '2026-09-21', time: '10:00' });
  assert.ok(prompt.includes(`"${brain.WRONG_NUMBER} No problem, sorry to bother you."`), 'the prompt does not teach the marker');

  const sms = withoutComments(SRC('routes', 'sms.js'));
  const at = sms.indexOf('const say =');
  const say = sms.slice(at, sms.indexOf('\n  };\n', at));
  assert.ok(say.includes("lyn.lead('', said)"), 'a wrong number is still given the opener');

  const followups = withoutComments(SRC('core', 'followups.js'));
  assert.ok(followups.includes('brain.wrongNumberLine(clean) !== null'), 'a chase could send the marker');
});

test('"who is this?" answered with only the introduction is not doubled, or silenced', () => {
  const opener = `${lyn.INTRODUCTION} 50% off your first order is on your account, ready to use.`;
  assert.equal(lyn.lead(opener, lyn.INTRODUCTION), opener);
  assert.equal(lyn.lead(opener, "Hi, I'm Lyn, LYNDRY's automated assistant."), opener);
  // say() goes quiet on an EMPTY body, not on a body that comes out as the opener.
  const sms = withoutComments(SRC('routes', 'sms.js'));
  const at = sms.indexOf('const say =');
  const say = sms.slice(at, sms.indexOf('\n  };\n', at));
  assert.ok(!say.includes('out.trim() === opening'), 'an answer that is the opener is sent nowhere');
});

test('the door-hanger canned reply no longer has an opening of its own', () => {
  const sms = withoutComments(SRC('routes', 'sms.js'));
  assert.ok(!/Hey, thanks for scanning/.test(sms));
  assert.ok(!/Hey, thanks for texting in/.test(sms));
});

test('the first message has one copy of the introduction', () => {
  const onboardingSrc = withoutComments(SRC('core', 'onboarding.js'));
  assert.ok(onboardingSrc.includes('lyn.INTRODUCTION'));
  assert.ok(!/I'm Lyn/.test(onboardingSrc), 'the introduction is retyped in onboarding.js');
});
