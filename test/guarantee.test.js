'use strict';

// ---------------------------------------------------------------------------
// THE MONEY-BACK GUARANTEE, AND THE LINE THE AI MUST NOT CROSS.
//
// Neil's ask on 10 September, and the reason for it is in the transcripts: the
// only two customers who ever reached the card both walked, and neither was
// arguing about the price. Kellie: "I never heard of stripe checkout I'll pass
// but thank you". Trisha: "just not enough info to make me feel confident".
//
// So the AI may now tell people that a damaged or missing item means they do
// not pay for that order. What it may NEVER do is decide that a particular
// claim is one, or tell somebody their money is on the way.
//
// THIS IS PINNED HERE BECAUSE IT REGRESSES SILENTLY. Nothing crashes if the
// guard sentence is trimmed out of a long prompt during some later tidy-up.
// The AI simply starts settling claims in a text thread, and the first anybody
// hears of it is a customer quoting a refund back at us that nobody approved.
//
// Nothing here touches the database or the carrier.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { site } = require('../src/web/site');
const brain = require('../src/core/brain');

// A fixed day, so the prompt is the same every run. Anything date-shaped in
// here is incidental; these tests are about the guarantee.
const NOW = {
  date: '2026-09-10',
  time: '10:00',
  weekday: 'Thursday',
  tomorrowWeekday: 'Friday',
  tomorrow: '2026-09-11',
};

const prompt = () => brain.systemPrompt(NOW.date, NOW);

test('the guarantee is plain ASCII, because it goes out as a text message', () => {
  // One character outside the basic GSM alphabet turns a 160-character segment
  // into a 70-character one and triples what the message costs. A curly
  // apostrophe pasted in here would do it silently.
  const outside = [...site.guarantee].filter((c) => c.charCodeAt(0) > 127);
  assert.deepEqual(outside, [], `these characters are not GSM-safe: ${JSON.stringify(outside)}`);
});

test('the guarantee fits in one segment', () => {
  // It is the reassurance sentence, sent alongside whatever else is being
  // said. If it ever grows past a segment on its own, every message carrying
  // it costs double.
  assert.ok(
    site.guarantee.length <= 160,
    `the guarantee is ${site.guarantee.length} characters, over one segment`
  );
});

test('the guarantee promises MONEY BACK, never the value of their clothes', () => {
  // Neil widened this on 10 September from "damaged or missing" to anybody who
  // is not happy. What did NOT widen is what comes back: the money they paid
  // us for that pickup. A promise to replace the contents of the bag is
  // unbounded, and it must not creep in through a reword.
  const said = site.guarantee.toLowerCase();

  ['replace', 'replacement', 'value of', 'compensat'].forEach((phrase) => {
    assert.ok(
      !said.includes(phrase),
      `the guarantee says "${phrase}", which promises the item rather than the money`
    );
  });

  assert.ok(
    said.includes('refund') || said.includes("don't pay") || said.includes('do not pay'),
    'the guarantee should say plainly that they get their money back'
  );
});

test('"no questions asked" is a promise the AI is told to keep', () => {
  // The phrase is in the sentence customers read, so the behaviour behind it
  // has to be in the prompt. An AI that answers "so sorry, what went wrong?"
  // has just asked a question, and the guarantee is worth nothing the first
  // time somebody has to argue for it.
  const p = prompt();

  assert.ok(
    /NO QUESTIONS ASKED MEANS YOU DO NOT ASK/.test(p),
    'the prompt should carry the rule that stops the AI interrogating a claim'
  );
  assert.ok(
    /do not ask what went wrong/i.test(p),
    'the prompt should forbid asking what went wrong'
  );

  // If the customer-facing sentence promises it, the prompt must too. This
  // catches the two being edited apart.
  if (/no questions asked/i.test(site.guarantee)) {
    assert.ok(
      /no questions asked/i.test(p),
      'the guarantee promises "no questions asked" but the prompt never mentions it'
    );
  }
});

test('the AI is told the guarantee, word for word', () => {
  // Word for word rather than paraphrased into the prompt, so there is one
  // copy of the promise. Two copies is how a customer ends up quoting back a
  // version we stopped offering.
  assert.ok(
    prompt().includes(site.guarantee),
    'the prompt should carry site.guarantee verbatim'
  );
});

test('the AI is told that saying the guarantee is not granting one', () => {
  // THE GUARD. This is the whole reason this file exists.
  const p = prompt();

  assert.ok(
    /SAYING THE SATISFACTION GUARANTEE IS NOT GRANTING ONE/.test(p),
    'the prompt has lost the rule that stops the AI settling a claim itself'
  );

  // And the specific things it must never say. Each of these is a sentence a
  // helpful model would reach for on its own.
  ['money is coming back', 'has been refunded', 'will not be charged'].forEach((phrase) => {
    assert.ok(
      p.includes(phrase),
      `the prompt no longer forbids saying "${phrase}"`
    );
  });
});

test('damage still goes to a person, guarantee or not', () => {
  // The handoff predates the guarantee and must survive it. A promise the AI
  // has already made is exactly what would tempt it to close the loop itself.
  const p = prompt();

  assert.ok(
    /something is damaged or missing.*goes to a manager/s.test(p),
    'damage should still route to a manager'
  );
  assert.ok(
    /THE SATISFACTION GUARANTEE DOES NOT CHANGE THIS/.test(p),
    'the handoff section should say the guarantee does not override it'
  );
});

test('the AI is told not to put a value on anything of theirs', () => {
  const p = prompt();
  assert.ok(
    /[Nn]ever name a sum/.test(p) && /never put a value on anything of theirs/.test(p),
    'the prompt should forbid naming a sum or valuing a customer item'
  );
});
