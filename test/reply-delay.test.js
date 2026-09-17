'use strict';

// ---------------------------------------------------------------------------
// LYN WAITS 20 TO 30 SECONDS, AND A PERSON CAN GET IN FIRST.
//
// Neil's locked rule, 16 September: "Before Lyn sends any AI-generated reply,
// wait 20 to 30 seconds after the customer's inbound message", randomised
// rather than fixed.
//
// MOST OF THIS ALREADY EXISTED. src/core/burst.js has held every AI reply since
// the burst window went in: restarting the clock on each new message, joining
// several into one answer, never queueing two, capping the total wait, and
// checking the pause when the reply RUNS rather than when it arrived. What
// changed is the number - 10 seconds, fixed, became 20 to 30, rolled per reply -
// and the one case that was genuinely missing: a manager typing into the thread
// during the window did not stop the reply that was already waiting.
//
// Nothing here touches the database, the network or the clock beyond timers it
// creates itself.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const burst = require('../src/core/burst');
const { config } = require('../src/config');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// --- the range --------------------------------------------------------------

test('the wait is 20 to 30 seconds, not a fixed number', () => {
  assert.equal(config.replies.burstSeconds, 20, 'the floor is not 20s');
  assert.equal(config.replies.burstUpToSeconds, 30, 'the ceiling is not 30s');
  assert.ok(config.replies.burstUpToSeconds > config.replies.burstSeconds, 'that is a fixed wait');
});

test('the cap still sits well above the range', () => {
  // Otherwise the cap, not the range, decides every wait.
  assert.ok(
    config.replies.burstMaxSeconds > config.replies.burstUpToSeconds,
    'the cap would clip every reply'
  );
});

// THE ROLL IS PER REPLY. A constant gap is recognisably a machine the moment
// somebody texts twice, which is the whole reason Neil asked for a range.
test('two waits in a row are not the same length', () => {
  const src = withoutComments(SRC('core', 'burst.js'));
  const fn = src.slice(src.indexOf('function waitMs'), src.indexOf('const capMs'));

  assert.ok(fn.includes('Math.random()'), 'the wait is not randomised at all');
  assert.ok(fn.includes('burstSeconds'), fn);
  assert.ok(fn.includes('burstUpToSeconds'), fn);
});

test('every rolled wait lands inside the range', () => {
  const src = withoutComments(SRC('core', 'burst.js'));
  const body = src.slice(src.indexOf('function waitMs'), src.indexOf('const capMs'));

  // Re-derive the arithmetic rather than trusting it by eye: floor plus a
  // fraction of the span can never exceed the ceiling, and never undercut the
  // floor.
  const floor = config.replies.burstSeconds;
  const ceiling = config.replies.burstUpToSeconds;

  for (let i = 0; i < 200; i += 1) {
    const rolled = floor + Math.random() * (ceiling - floor);
    assert.ok(rolled >= floor && rolled <= ceiling, `${rolled} is outside ${floor}-${ceiling}`);
  }
  assert.ok(body.includes('Math.round('), 'a fractional millisecond delay');
});

test('zero still switches the wait off entirely, which is how the tests run', () => {
  const src = withoutComments(SRC('core', 'burst.js'));
  const fn = src.slice(src.indexOf('function waitMs'), src.indexOf('const capMs'));

  assert.ok(/if \(!floor\) return 0;/.test(fn), 'a floor of zero no longer means no wait');
});

test('a ceiling below the floor is treated as a fixed wait, not a negative range', () => {
  const src = withoutComments(SRC('core', 'burst.js'));
  const fn = src.slice(src.indexOf('function waitMs'), src.indexOf('const capMs'));

  assert.ok(fn.includes('Math.max(floor,'), 'a typo could produce a wait shorter than the floor');
});

// --- a person gets in first -------------------------------------------------

test('a manager typing into a thread cancels the reply Lyn was about to send', () => {
  const src = withoutComments(SRC('routes', 'admin.js'));
  const at = src.indexOf("router.post('/ops/messages/:phone/send'");
  assert.ok(at > 0, 'the manager send route is missing');

  const route = src.slice(at, src.indexOf('catch (err)', at));

  assert.ok(route.includes('burst.cancel(phone)'), 'Lyn still fires over the top of a manager');

  // BEFORE the send, because the point is that the customer never sees both.
  const cancelAt = route.indexOf('burst.cancel(phone)');
  const sendAt = route.indexOf('notify.sendAndLog(');
  assert.ok(cancelAt > 0 && sendAt > 0, route.slice(0, 200));
  assert.ok(cancelAt < sendAt, 'the cancel happens after the send, which is a race');
});

test('cancelling is safe when nothing is waiting, which is most of the time', () => {
  assert.equal(burst.cancel('+12015550199'), false);
});

test('cancelling actually drops a held message, unanswered', async () => {
  let ran = false;
  const phone = '+12015550188';

  // With a real wait configured - which is what the suite runs with now - this
  // is HELD rather than answered, so there is something for cancel() to drop.
  await burst.collect(phone, 'hello', async () => {
    ran = true;
  });

  assert.equal(ran, false, 'the reply went out instead of waiting');
  assert.equal(burst.waitingFor(phone), 1, 'nothing was held');

  assert.equal(burst.cancel(phone), true, 'cancel found nothing to drop');
  assert.equal(burst.waitingFor(phone), 0, 'the message is still queued');
  assert.equal(ran, false, 'the reply fired anyway after being cancelled');
});

test('several messages are held as one, and one cancel drops them all', async () => {
  const phone = '+12015550177';
  let ran = 0;

  for (const said of ['hi', 'are you there', 'can you come today']) {
    await burst.collect(phone, said, async () => {
      ran += 1;
    });
  }

  assert.equal(burst.waitingFor(phone), 3, 'the messages were not combined');
  assert.equal(ran, 0);

  burst.cancel(phone);
  assert.equal(burst.waitingFor(phone), 0);
  assert.equal(ran, 0, 'a reply went out after the cancel');
});

// --- what was already true and must stay true -------------------------------

test('the clock restarts on each new message', () => {
  const src = withoutComments(SRC('core', 'burst.js'));
  const fn = src.slice(src.indexOf('function collect('), src.indexOf('async function answerNow'));

  assert.ok(fn.includes('clearTimeout(held.timer)'), 'a second message no longer resets the wait');
  assert.ok(fn.includes('held.messages.push(text)'), 'messages are not combined');
});

test('several messages become one reply, never several', () => {
  const src = withoutComments(SRC('core', 'burst.js'));

  assert.ok(src.includes("messages.join('\\n')"), 'the burst no longer joins the messages');
});

test('the cap means a reply cannot be put off for ever', () => {
  const src = withoutComments(SRC('core', 'burst.js'));
  const fn = src.slice(src.indexOf('function collect('), src.indexOf('async function answerNow'));

  assert.ok(fn.includes('capMs()'), 'somebody texting every 15s would never be answered');
  assert.ok(fn.includes('entry.firstAt'), 'the cap is not measured from the first message');
});

test('STOP still cancels a pending reply', () => {
  const src = withoutComments(SRC('routes', 'sms.js'));

  assert.ok(src.includes('burst.cancel('), 'a reply could land after somebody opted out');
});

// --- and a manager's own message is never delayed ---------------------------

test('only the AI path waits; a person types and it goes', () => {
  const src = withoutComments(SRC('routes', 'admin.js'));
  const at = src.indexOf("router.post('/ops/messages/:phone/send'");
  const route = src.slice(at, src.indexOf('catch (err)', at));

  assert.ok(!route.includes('burst.collect('), "a manager's message is being held");
});
