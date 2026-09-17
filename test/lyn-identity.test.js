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

test('the introduction is matched on the sentence, so old threads get one', () => {
  // Neil's hardest edge case: a thread that predates all of this has no
  // introduction in it, so the next AI message must carry one. Testing a flag
  // would miss that; testing the words cannot.
  assert.ok(lyn.INTRODUCTION.includes(lyn.SAID_IT), 'SAID_IT is not actually in the introduction');

  const src = withoutComments(SRC('core', 'lyn.js'));
  const fn = src.slice(src.indexOf('async function everIntroduced'), src.indexOf('async function lastSpokeAt'));
  assert.ok(fn.includes('SAID_IT'), fn);
  assert.ok(fn.includes("eq('direction', 'OUTBOUND')"), fn);
});

test('a long silence counts as a new conversation', () => {
  assert.ok(lyn.NEW_THREAD_DAYS >= 7, 'too short - a customer mid-booking would be re-introduced');
  assert.ok(lyn.NEW_THREAD_DAYS <= 60, 'too long - somebody returning months later gets no disclosure');
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

test('the prompt tells her to say it once, not every message', () => {
  const brain = SRC('core', 'brain.js');

  assert.ok(/SAY IT ONCE PER CONVERSATION/.test(brain), brain.slice(0, 0));
  assert.ok(/never announce that you are automated again/.test(brain), brain.slice(0, 0));
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
