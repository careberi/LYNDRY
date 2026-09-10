'use strict';

// ---------------------------------------------------------------------------
// THE PAGE THAT GOES OUT WHEN SOMEBODY TEXTS A MUTED THREAD.
//
// Neil's ask: the AI pause is total and deliberate, and its whole risk is that
// a thread nobody is watching is a customer nobody is answering. Everything
// else about a muted thread is pull - a badge, a count - and this is the push.
//
// The message is written in code rather than by the AI, which is what makes it
// testable at all: the words are fixed, so the segment budget and the encoding
// are knowable before anything sends. That is the same reason the nudges and
// the lead intro are written in code.
//
// Nothing here touches the database or the carrier.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const alerts = require('../src/core/paused-alerts');

const compose = (over = {}) =>
  alerts.compose({
    phone: '+12015551234',
    customer: { name: 'Trisha' },
    said: 'are you still coming today',
    ...over,
  });

test('it says who, that nothing answered them, and where to go', () => {
  const m = compose();

  assert.ok(m.includes('Trisha'), 'should name the customer');
  assert.ok(/switched OFF/.test(m), 'should say the AI is off, in as many words');
  assert.ok(m.includes('/ops/messages/12015551234'), 'should link to the thread');
});

test('the link carries digits only, so a + never has to survive a URL', () => {
  const m = compose({ phone: '+1 (201) 555-1234' });
  assert.ok(m.includes('/ops/messages/12015551234'));
  assert.ok(!m.includes('/ops/messages/+'), 'a + in the path would not resolve');
});

test('a customer with no name still pages somebody', () => {
  // Most people who text a paused thread have never given a name - the pause
  // gets used on exactly the awkward conversations. "Somebody just texted" is
  // still worth waking up for.
  const m = compose({ customer: null });
  assert.ok(m.startsWith('Somebody just texted'), m.slice(0, 40));

  assert.ok(compose({ customer: {} }).startsWith('Somebody just texted'));
});

test('what they said is quoted, because it decides how fast to answer', () => {
  // "are you coming today" and "thanks!" want very different response times,
  // and without the quote every page costs a screen unlock to find out which.
  assert.ok(compose().includes('"are you still coming today"'));
});

test('a customer newline cannot break the message in two', () => {
  // A line break inside a quoted snippet renders oddly on a phone and, worse,
  // makes the page look like two messages. Collapsed to single spaces.
  const m = compose({ said: 'hi\n\nis anyone\nthere' });
  assert.ok(m.includes('"hi is anyone there"'), m);
  assert.ok(!m.includes('\n'), 'the page should be one line');
});

test('a very long message is trimmed rather than sent whole', () => {
  const m = compose({ said: 'x'.repeat(400) });
  assert.ok(m.length < 300, `page ran to ${m.length} characters`);
});

test('the page is plain ASCII, whatever the customer typed', () => {
  // Every outbound text is GSM-safe or it costs triple. The quote is the one
  // part of this message a stranger controls, so it is the one that will
  // eventually carry a curly quote or an emoji.
  //
  // notify.js swaps typographic characters on the way out, so this is a belt
  // to that braces: what it catches is anything with NO plain twin, which
  // notify can only warn about.
  const m = compose({ said: 'hey — are you coming? “thanks”' });
  const exotic = [...m].filter((c) => c.charCodeAt(0) > 127);

  // Em dash and curly quotes have ASCII twins and notify.js handles them, so
  // this asserts the shape rather than perfection: nothing here should be
  // emoji or anything else with no equivalent at all.
  exotic.forEach((c) => {
    assert.ok(
      '—–‘’“”…'.includes(c),
      `${JSON.stringify(c)} has no plain ASCII twin and would force UCS-2`
    );
  });
});

test('an empty message still pages, without an empty pair of quotes', () => {
  // A blank inbound is handled earlier in sms.js and never reaches here, but a
  // whitespace-only one could, and `Somebody just texted ""` reads as a bug.
  const m = compose({ said: '   ' });
  assert.ok(!m.includes('""'), m);
  assert.ok(m.includes('/ops/messages/'), 'should still carry the way in');
});

test('the quiet window is a real number of minutes', () => {
  // The one knob. If it is ever set to zero every message pages, which is the
  // failure this whole rule exists to prevent.
  assert.ok(Number.isFinite(alerts.QUIET_MINUTES));
  assert.ok(alerts.QUIET_MINUTES > 0, 'a zero window would page on every message');
});

test('it pages the people who can read a thread, not the driver', () => {
  // A driver holds neither messages.view nor messages.send and could do
  // nothing with this if they got it.
  assert.equal(alerts.PERMISSION, 'messages.view');
});
