'use strict';

// ---------------------------------------------------------------------------
// LYN: THE NAME, THE DISCLOSURE, AND SAYING IT ONCE.
//
// Neil's decision lock, 16 September. Lyn is NOT a new AI - she is the
// assistant that has been answering these threads all along, now named and
// told to disclose what she is. The scope lock is explicit: no second model, no
// second prompt, no parallel conversation engine, and no change to how orders
// are taken.
//
// THE HARD RULES, each of which is a way this goes wrong:
//
//   must disclose      "LYNDRY's automated assistant", at the start of a thread
//   must not pretend   she may never present herself as a person
//   must not nag       once per conversation, never every message
//   must not chatter   turning her back on sends NOTHING; the comeback line
//                      rides on her first reply to the customer's next message
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lyn = require('../src/core/lyn');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// --- the words --------------------------------------------------------------

test('she is named Lyn and says what she is', () => {
  assert.equal(lyn.NAME, 'Lyn');
  assert.match(lyn.INTRODUCTION, /I'm Lyn/);
  assert.match(lyn.INTRODUCTION, /automated assistant/);
  assert.match(lyn.INTRODUCTION, /LYNDRY/);
});

test('the disclosure is "automated assistant", the wording Neil chose', () => {
  // He was offered "AI assistant" and "assistant" and picked this one.
  assert.ok(lyn.INTRODUCTION.includes('automated assistant'), lyn.INTRODUCTION);
  assert.ok(!/\bAI\b/.test(lyn.INTRODUCTION), 'he did not choose "AI assistant"');
});

test('the comeback names her without re-disclosing', () => {
  assert.match(lyn.COMEBACK, /Lyn/);
  // Said to somebody who already knows what she is. Repeating the disclosure
  // every time she returns is the nagging Neil ruled out.
  assert.ok(!lyn.COMEBACK.includes('automated assistant'), lyn.COMEBACK);
});

// CHOSEN AND WITHDRAWN ON THE SAME DAY. "One second, let me get a manager."
// was Neil's own wording that morning; by the evening: "Do not text the
// customer 'a manager will come back' or 'let me get a manager'. Send them
// nothing at the moment of handoff." See test/silent-handoff.test.js.
test('there is no escalation line any more', () => {
  assert.equal(lyn.ESCALATION, undefined, 'the holding line is back');
});

// NO DASHES ANYWHERE. Neil's own drafts of two of these carried one. A real em
// dash forces the whole message out of the GSM alphabet, cutting a segment from
// 160 characters to 70, and CLAUDE.md refuses even the hyphen-as-pause.
test('none of the lines contains a dash of any kind', () => {
  for (const [name, line] of Object.entries({
    INTRODUCTION: lyn.INTRODUCTION,
    COMEBACK: lyn.COMEBACK,
    ESCALATION: lyn.ESCALATION,
  })) {
    assert.ok(!/[–—]/.test(line), `${name} has an en or em dash: ${line}`);
    assert.ok(!/ - /.test(line), `${name} uses a hyphen as a pause: ${line}`);
  }
});

test('every line is plain ASCII, so none of them costs a third segment', () => {
  for (const line of [lyn.INTRODUCTION, lyn.COMEBACK]) {
    assert.ok(/^[\x20-\x7E]*$/.test(line), `not GSM-safe: ${line}`);
  }
});

// --- saying it once ---------------------------------------------------------

test('lead() puts the opener in front, once', () => {
  assert.equal(lyn.lead('Hi, I am Lyn.', 'When suits you?'), 'Hi, I am Lyn. When suits you?');
});

test('lead() never stacks a second introduction on one the model already wrote', () => {
  const body = `${lyn.INTRODUCTION} When suits you?`;
  assert.equal(lyn.lead(lyn.INTRODUCTION, body), body);
});

test('no opener means the message is untouched', () => {
  assert.equal(lyn.lead('', 'When suits you?'), 'When suits you?');
  assert.equal(lyn.lead(null, 'When suits you?'), 'When suits you?');
});

test('an opener with no message is still the opener', () => {
  assert.equal(lyn.lead(lyn.COMEBACK, ''), lyn.COMEBACK);
});

test('it joins with a space, not a newline', () => {
  // These are two sentences of one text. A blank line makes every introduction
  // a two-paragraph message.
  assert.ok(!lyn.lead(lyn.COMEBACK, 'Right.').includes('\n'));
});

// --- when she owes one ------------------------------------------------------

test('a thread with no customer is never owed an opener', async () => {
  assert.equal(await lyn.opener(null), '');
  assert.equal(await lyn.opener({}), '');
});

test('the introduction is matched on the sentence that reached their phone', () => {
  // Testing a flag would go stale the first time a thread was edited by hand;
  // testing the words cannot.
  assert.ok(lyn.INTRODUCTION.includes(lyn.SAID_IT), 'SAID_IT is not actually in the introduction');

  const src = withoutComments(SRC('core', 'lyn.js'));
  const fn = src.slice(src.indexOf('async function everIntroduced'), src.indexOf('async function recentThread'));
  assert.ok(fn.includes('SAID_IT'), fn);
  assert.ok(fn.includes("eq('direction', 'OUTBOUND')"), fn);
});

test('a long silence counts as a new conversation', () => {
  assert.ok(lyn.NEW_THREAD_DAYS >= 7, 'too short - a customer mid-booking would be re-introduced');
  // Only for somebody never introduced: somebody who has been told is never
  // told again, gap or no gap.
  assert.ok(lyn.NEW_THREAD_DAYS <= 60, 'too long - a never-introduced customer returning months later is not told');
});

// --- once, at the start, never mid-conversation ----------------------------
//
// Neil's locked rule, 21 September. This REVERSES "old threads get one": every
// customer who talked to us before Lyn had a name had never been told, so the
// next reply to them - in the middle of a booking - opened with the
// introduction. That is exactly the mid-conversation introduction he ruled out.

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const thread = (rows) => rows.map(([direction, h]) => ({ direction, created_at: hoursAgo(h) }));

test('a brand-new number saying hi is a new conversation', () => {
  assert.equal(lyn.isNewConversation(thread([['INBOUND', 0]])), true);
});

test('a burst of three from a new number is one new conversation', () => {
  assert.equal(lyn.isNewConversation(thread([['INBOUND', 0], ['INBOUND', 0.01], ['INBOUND', 0.02]])), true);
});

test('answering our website welcome is still somebody new', () => {
  // Only our own message before theirs - the welcome, a lead text, a person
  // texting them first. We spoke; they have not, until now.
  assert.equal(lyn.isNewConversation(thread([['INBOUND', 0], ['OUTBOUND', 2]])), true);
});

test('mid-conversation is never new, however the thread began', () => {
  assert.equal(lyn.isNewConversation(thread([['INBOUND', 0], ['OUTBOUND', 0.05], ['INBOUND', 0.1]])), false);
  assert.equal(lyn.isNewConversation(thread([['INBOUND', 0], ['OUTBOUND', 72], ['INBOUND', 73]])), false);
});

test('coming back after the gap is a new thread', () => {
  const back = lyn.NEW_THREAD_DAYS * 24 + 1;
  assert.equal(lyn.isNewConversation(thread([['INBOUND', 0], ['OUTBOUND', back], ['INBOUND', back + 1]])), true);
});

test('the gap is measured BEFORE what they just sent, not from it', () => {
  // The old rule measured from the newest message, which is always the inbound
  // being answered, seconds old - so it never once fired.
  const back = lyn.NEW_THREAD_DAYS * 24 + 1;
  const rows = thread([['INBOUND', 0], ['INBOUND', 0.01], ['OUTBOUND', back], ['INBOUND', back + 1]]);
  assert.equal(lyn.isNewConversation(rows), true);
});

test('what it cannot see clearly is not new - it fails to silence', () => {
  assert.equal(lyn.isNewConversation([]), false);
  assert.equal(lyn.isNewConversation(thread([['OUTBOUND', 0], ['INBOUND', 1]])), false);
  // A page of nothing but their messages, with more thread beyond it.
  assert.equal(lyn.isNewConversation(thread([['INBOUND', 0]]), { complete: false }), false);
  assert.equal(lyn.isNewConversation(thread([['INBOUND', 0], ['OUTBOUND', 1]]), { complete: false }), false);
});

test('the thread is read by phone number, so a newcomer\'s first text counts', () => {
  // A stranger's first message is logged before their customer row exists and
  // carries no customer_id. Read by customer, a brand-new "hi" found an empty
  // thread and got no introduction - and their SECOND message was introduced.
  const src = withoutComments(SRC('core', 'lyn.js'));
  const fn = src.slice(src.indexOf('async function recentThread'), src.indexOf('function isNewConversation'));
  assert.ok(fn.includes("eq('phone', customer.phone)"), fn);
});

test('only a thread she has never introduced herself on is checked at all', () => {
  const src = withoutComments(SRC('core', 'lyn.js'));
  const fn = src.slice(src.indexOf('async function opener'), src.indexOf('function lead'));
  const intro = fn.slice(fn.indexOf('everIntroduced'), fn.indexOf('COMEBACK'));
  assert.ok(intro.includes('isNewConversation'), 'she is introduced without asking whether this is the start');
  assert.ok(!/lastSpokeAt/.test(fn), 'the gap that never fired is back');
});

// --- the model's own introduction comes off ---------------------------------

test('an introduction the model wrote is taken off when none is owed', () => {
  assert.equal(lyn.lead('', `${lyn.INTRODUCTION} When suits you?`), 'When suits you?');
  assert.equal(lyn.lead('', "Hi, I’m Lyn, LYNDRY’s automated assistant. When suits you?"), 'When suits you?');
  assert.equal(lyn.lead('', 'This is Lyn from LYNDRY! What day works?'), 'What day works?');
  assert.equal(lyn.lead('', "Hi, it's Lyn again. Sure thing."), 'Sure thing.');
});

test('and replaced with ours when one is owed, never stacked', () => {
  assert.equal(lyn.lead(lyn.INTRODUCTION, "Hi, I'm Lyn from LYNDRY. When suits you?"), `${lyn.INTRODUCTION} When suits you?`);
});

test('a reply that is nothing but who she is, is kept', () => {
  // The answer to "who is this?" or "am I talking to a person?". Stripping it
  // would send nothing at all to somebody who asked a direct question.
  assert.equal(lyn.lead('', `${lyn.INTRODUCTION}`), lyn.INTRODUCTION);
});

test('an answer in the same sentence as her name is never cut', () => {
  const body = "Hi, I'm Lyn, and I can grab it tomorrow at 6.";
  assert.equal(lyn.lead('', body), body);
});

test('the opener and the model do not both say hello', () => {
  assert.equal(lyn.lead(lyn.INTRODUCTION, 'Hey! How can I help?'), `${lyn.INTRODUCTION} How can I help?`);
  assert.equal(lyn.lead(lyn.COMEBACK, 'Hi there, sure thing.'), `${lyn.COMEBACK} Sure thing.`);
  // A reply that is nothing but a greeting keeps it rather than sending the
  // opener alone.
  assert.equal(lyn.lead(lyn.INTRODUCTION, 'Hey!'), `${lyn.INTRODUCTION} Hey!`);
  // A name after the greeting is not a bare greeting.
  assert.equal(lyn.lead(lyn.INTRODUCTION, 'Hey Maria, what day works?'), `${lyn.INTRODUCTION} Hey Maria, what day works?`);
});

test('ordinary replies are untouched', () => {
  assert.equal(lyn.lead('', 'Hey! How can I help?'), 'Hey! How can I help?');
  assert.equal(lyn.lead('', "Lynn's order is fine."), "Lynn's order is fine.");
});

test('disclosure beats the comeback when both could apply', () => {
  const src = withoutComments(SRC('core', 'lyn.js'));
  const fn = src.slice(src.indexOf('async function opener'), src.indexOf('function lead'));

  const introAt = fn.indexOf('everIntroduced');
  const comebackAt = fn.indexOf('COMEBACK');

  assert.ok(introAt > 0 && comebackAt > 0, fn.slice(0, 200));
  assert.ok(introAt < comebackAt, 'somebody who does not know what she is needs telling first');
});

test('the opener fails to SILENCE, not to chatter', () => {
  const src = withoutComments(SRC('core', 'lyn.js'));
  const fn = src.slice(src.indexOf('async function opener'), src.indexOf('function lead'));

  assert.ok(/catch[\s\S]*return '';/.test(fn), 'a broken lookup would introduce her on every message');
});

test('the comeback only applies to a thread that was switched back on', () => {
  const src = withoutComments(SRC('core', 'lyn.js'));
  const fn = src.slice(src.indexOf('async function opener'), src.indexOf('function lead'));

  assert.ok(fn.includes('!state.paused'), 'a still-paused thread would be owed a comeback');
  assert.ok(fn.includes('state.resumed_at'), fn);
  assert.ok(fn.includes('aiSpokeSince'), 'she would repeat the comeback on every message');
});

// --- turning her on sends nothing -------------------------------------------

// Neil's decision lock, in his words: "turning Lyn back on must never itself
// generate an outbound message."
test('resuming sends no message', () => {
  const src = withoutComments(SRC('core', 'ai-pause.js'));
  const at = src.indexOf('async function resume');
  const fn = src.slice(at, src.indexOf('\nasync function ', at + 10));

  for (const sends of ['sendAndLog', 'notify.', 'sms.sendMessage']) {
    assert.ok(!fn.includes(sends), `resume() sends something via ${sends}`);
  }
});

test('the comeback is composed on the reply path, not on the toggle', () => {
  const sms = withoutComments(SRC('routes', 'sms.js'));

  assert.ok(sms.includes('lyn.opener(customer)'), 'nothing works out whether she owes an opener');
  assert.ok(sms.includes('lyn.lead('), 'the opener is never applied to a message');
});

// --- one choke point --------------------------------------------------------

// There are several places in the reply path that can send. Prepending at each
// is several chances to forget, so it is applied once through a wrapper.
test('every AI reply goes through the wrapper that carries the opener', () => {
  const sms = withoutComments(SRC('routes', 'sms.js'));
  const from = sms.indexOf('const openingLine = await lyn.opener');
  assert.ok(from > 0, 'the opener is not computed');

  const rest = sms.slice(from);
  assert.ok(rest.includes('const say ='), 'no wrapper');
  assert.ok(!/await reply\(/.test(rest), 'a reply below the wrapper bypasses the opener');
});

test('it is computed once per burst, not per message', () => {
  const sms = withoutComments(SRC('routes', 'sms.js'));

  assert.equal(
    (sms.match(/lyn\.opener\(/g) || []).length,
    1,
    'more than one place works out the opener'
  );
});

// --- the prompt -------------------------------------------------------------

test('the prompt names her and reverses the old never-say-you-are-an-AI rule', () => {
  const brain = SRC('core', 'brain.js');

  assert.ok(
    !/Never say you are an AI, an assistant, or a bot/.test(brain),
    'the old rule is still in the prompt, contradicting the disclosure'
  );
  assert.ok(/YOUR NAME IS \$\{lyn\.NAME\}/.test(brain), 'the prompt does not name her');
  assert.ok(/NEVER PRESENT YOURSELF AS A PERSON/.test(brain), 'the must-not is missing');
});

// Neil's locked rules, 21 September: the introduction is the CODE's, once, at
// the start of a conversation. The prompt used to let the model write it "if
// this is genuinely your first message", which is a judgement it could get
// wrong in the middle of a thread.
test('the prompt tells her never to introduce herself - the code does it', () => {
  const brain = SRC('core', 'brain.js');

  assert.ok(/YOU NEVER INTRODUCE YOURSELF/.test(brain), 'the prompt still lets her write it');
  assert.ok(/never announce that you are automated in the middle of a conversation/.test(brain), brain.slice(0, 0));
  assert.ok(!/unless this is genuinely your first message/.test(brain), 'the old permission is back');
});

test('the voice rules survive the reversal', () => {
  const brain = SRC('core', 'brain.js');

  // Only disclosure changed. Everything else about how she sounds is untouched.
  assert.ok(/no emoji/.test(brain), 'the no-emoji rule was lost');
  assert.ok(/reply 1 for/.test(brain), 'the no-menus rule was lost');
});

// --- she is not a second AI -------------------------------------------------

test('Lyn is a rename, not a new engine', () => {
  const src = withoutComments(SRC('core', 'lyn.js'));

  // The module holds words and one derived question. It must not grow a model,
  // a prompt, a tool list or a conversation of its own.
  for (const forbidden of ['anthropic', 'messages.create', 'systemPrompt', 'tools:', 'decide(']) {
    assert.ok(!src.includes(forbidden), `lyn.js contains ${forbidden} - that is a second AI`);
  }
});

test('it stores nothing and sends nothing', () => {
  const src = withoutComments(SRC('core', 'lyn.js'));

  for (const forbidden of ['.insert(', '.update(', '.upsert(', '.delete(', 'sendAndLog', 'notify']) {
    assert.ok(!src.includes(forbidden), `lyn.js does ${forbidden}`);
  }
});
