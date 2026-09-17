'use strict';

// ---------------------------------------------------------------------------
// A HANDOFF TEXTS THE CUSTOMER NOTHING.
//
// Neil's rule, 16 September, and it withdraws a line he chose the same morning:
//
//   "When Lyn is stuck and raises an issue: page me / open the issue as today,
//    pause Lyn on that thread, do not text the customer 'a manager will come
//    back' or 'let me get a manager'. Send them nothing at the moment of
//    handoff. I talk to them when I am ready."
//
// WHY SILENCE BEATS THE HOLDING LINE. "They'll come back to you shortly" is a
// promise with a clock on it. It starts somebody waiting, and if the reply
// comes an hour later the sentence is what turned a delay into a broken
// promise. Nothing said is nothing owed.
//
// WHAT IS UNCHANGED, and these are the half that makes the silence safe rather
// than negligent:
//
//   the issue      still raised, still open until a person closes it
//   the page       every admin still texted, immediately
//   the pause      the thread still goes quiet and only a person lifts it
//   their words    their inbound is still logged and still shows in ops
//
// FOUR PATHS, not one. Lyn is "stuck" in four ways and every one of them used
// to apologise: the handoff she chooses, a chase on an issue already open, the
// AI being unreachable, and an action failing. The repeat detector was already
// silent and is the shape the other three now follow.
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

const handoffFn = () => {
  const src = withoutComments(SRC('core', 'actions.js'));
  const at = src.indexOf('async function handoffToHuman');
  assert.ok(at > 0, 'handoffToHuman is missing');
  return src.slice(at, src.indexOf('\nasync function ', at + 10));
};

// --- nothing is said --------------------------------------------------------

test('the handoff returns nothing to send', () => {
  const fn = handoffFn();

  assert.ok(/return null;/.test(fn), 'the handoff still produces a sentence');
});

test('neither branch speaks - not the new escalation, not the chase', () => {
  const fn = handoffFn();

  // A customer chasing something already with a manager is the second branch,
  // and telling them it has been "passed on as well" is the same promise in a
  // politer voice.
  for (const phrase of [
    'let me get a manager',
    'come back to you',
    'passed it to a manager',
    'passed that straight on',
    'pick this up shortly',
  ]) {
    assert.ok(!fn.toLowerCase().includes(phrase.toLowerCase()), `the handoff still says "${phrase}"`);
  }
});

test('the holding line is gone from the codebase entirely', () => {
  assert.equal(lyn.ESCALATION, undefined, 'lyn.ESCALATION is back');

  for (const bits of [['core', 'lyn.js'], ['core', 'actions.js'], ['routes', 'sms.js']]) {
    const src = withoutComments(SRC(...bits));
    assert.ok(
      !/let me get a manager/i.test(src),
      `${bits.join('/')} can still send the holding line`
    );
  }
});

test('an action with nothing to say sends nothing, rather than an empty text', () => {
  const src = withoutComments(SRC('routes', 'sms.js'));
  const at = src.lastIndexOf('await say(from, message, customer.id');
  assert.ok(at > 0, 'the action reply is missing');

  const before = src.slice(Math.max(0, at - 400), at);
  assert.ok(/if \(!message \|\| !String\(message\)\.trim\(\)\)/.test(before), before);
  assert.ok(/return;/.test(before), 'it falls through to sending an empty message');
});

test('an unreachable AI says nothing', () => {
  const src = withoutComments(SRC('routes', 'sms.js'));
  const at = src.indexOf('Claude call failed');
  assert.ok(at > 0, 'the outage path is missing');

  // TO THE END OF THE BLOCK, not a guessed number of characters. A wide window
  // swallows the next say() further down the file and passes for the wrong
  // reason - which is exactly what the first version of this did.
  const block = src.slice(at, src.indexOf('return;', at) + 7);
  assert.ok(block.includes('aiHold: true'), 'the outage no longer pauses the thread');
  assert.ok(!/having trouble on my end/.test(block), 'it still apologises to the customer');
  assert.ok(!/await say\(/.test(block), 'it still sends something');
});

test('a failed action says nothing', () => {
  const src = withoutComments(SRC('routes', 'sms.js'));
  const at = src.indexOf('Action ${decision.name} failed');
  assert.ok(at > 0, 'the failed-action path is missing');
  const block = src.slice(at, src.indexOf('return;', at) + 7);

  assert.ok(!/couldn't do that just now/.test(block), 'it still apologises to the customer');
  assert.ok(!/await say\(/.test(block), 'it still sends something');
});

test('the repeat detector is still silent, which is the shape the rest copied', () => {
  const src = withoutComments(SRC('routes', 'sms.js'));
  const at = src.indexOf('about to repeat the last reply');
  assert.ok(at > 0, 'the repeat detector is missing');

  const block = src.slice(at, src.indexOf('return;', at) + 7);
  assert.ok(block.includes('aiHold: true'), block.slice(0, 200));
  assert.ok(!/await say\(/.test(block), 'the repeat detector started talking');
});

// --- but everything else still happens --------------------------------------

test('the issue is still raised and the office still paged', () => {
  const fn = handoffFn();

  assert.ok(fn.includes('issues.raise('), 'a handoff no longer opens an issue');
  assert.ok(fn.includes('aiHold: true'), 'a handoff no longer pauses the thread');
  // raise() is what pages every admin; it is not optional and not caught here.
  assert.ok(!/\.catch\(/.test(fn.slice(fn.indexOf('issues.raise('), fn.indexOf('issues.raise(') + 200)),
    'a failed escalation would be swallowed, and then nobody is told at all');
});

test('the thread is still paused, so she does not answer their next message', () => {
  const src = withoutComments(SRC('core', 'issues.js'));
  const fn = src.slice(src.indexOf('async function raise('), src.indexOf('async function ensurePaymentHold'));

  assert.ok(fn.includes('if (aiHold && customer && customer.phone) {'), 'the pause is gone');
  assert.ok(fn.includes('.pause('), fn);
});

test('their inbound is still logged, so it shows in ops', () => {
  // The caller writes every inbound to `messages` before the reply path runs.
  // Silence must never mean the message vanishes.
  const src = withoutComments(SRC('routes', 'sms.js'));

  assert.ok(
    /direction: 'INBOUND'/.test(src) || src.includes('logInbound') || src.includes('recordInbound'),
    'nothing records what the customer said'
  );
});

// --- the scope lock ---------------------------------------------------------

test('Lyn still has her name and her introduction', () => {
  // Neil: "Do not change booking, cards, or Lyn's name."
  assert.equal(lyn.NAME, 'Lyn');
  assert.match(lyn.INTRODUCTION, /I'm Lyn, LYNDRY's automated assistant/);
  assert.match(lyn.COMEBACK, /it's Lyn again/);
});

test('booking and cards were not touched', () => {
  const actions = withoutComments(SRC('core', 'actions.js'));

  // The handoff is the only thing that changed. These are the neighbours it
  // must not have disturbed.
  assert.ok(actions.includes('booking.bookPickup('), 'booking was changed');
  assert.ok(actions.includes('needsCard'), 'the card flow was changed');
});
