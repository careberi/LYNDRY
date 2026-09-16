'use strict';

// ---------------------------------------------------------------------------
// GET THEM BOOKED, THEN ASK THE REST.
//
// Neil's rules, 16 September, all four off Manpreet Singh's thread:
//
//   2. If they already said a day or "now" / "come now", book a one-time
//      pickup at the one-time rate. Do not ask one-time vs subscription more
//      than once. "Ok" is not a plan. Default one-time.
//   3. Ask one question at a time, in order: name, address, when, door spot.
//      Wash prefs after the pickup is booked, not before.
//   4. The same outbound text inside 30 seconds is a duplicate. Send one.
//   5. Find what sent "Welcome back. Say when you'd like a pickup..." with no
//      inbound. Kill that path.
//
// WHAT HE WAS ASKED, IN ORDER, BEFORE HE GAVE UP: name, address, zip, zip
// again, when, plan, plan, plan, plan, when, water temperature, when, softener,
// when, door spot, door spot. He said "now" or "come now" five times and was
// never booked.
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const booking = require('../src/core/booking');
const notify = require('../src/core/notify');
const onboarding = require('../src/core/onboarding');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const prompt = () => SRC('core', 'brain.js');

// --- 3. wash preferences no longer block a booking --------------------------

test('booking no longer refuses for missing wash preferences', () => {
  const src = withoutComments(SRC('core', 'booking.js'));

  assert.ok(
    !src.includes("reason: 'no_preferences'"),
    'the wash gate is back - a customer asking for a van today is refused over a water temperature'
  );
});

test('but nothing invents a preference either', () => {
  // The gate is gone; the rule that there are no defaults is NOT.
  const src = withoutComments(SRC('core', 'booking.js'));

  assert.ok(typeof booking.hasPreferences === 'function', 'the screens and the nudge still read this');
  assert.ok(!/preferences\s*=\s*\{[^}]*water_temp/.test(src), 'a default wash crept in');
});

test('a booking still refuses for the things that really stop a van', () => {
  const src = withoutComments(SRC('core', 'booking.js'));

  for (const reason of ['no_name', 'out_of_area', 'bad_date']) {
    assert.ok(src.includes(`reason: '${reason}'`), `${reason} was lost with the wash gate`);
  }
});

test('the prompt puts the wash question after the booking, not before', () => {
  const src = prompt();
  const order = src.indexOf('THE SETUP BEATS, IN ORDER');
  assert.ok(order > 0, 'the beat order is not stated');

  const block = src.slice(order, order + 700);
  const at = (needle) => block.indexOf(needle);

  assert.ok(at('name') < at('street address'), block);
  assert.ok(at('street address') < at('when they want collecting'), block);
  assert.ok(at('when they want collecting') < at('where the driver should look'), block);
  assert.ok(at('where the driver should look') < at('BOOK IT'), block);
  assert.ok(at('BOOK IT') < at('how they want it washed'), 'the wash is still asked before booking');
});

test('the prompt says the wash question comes after booking in as many words', () => {
  const src = prompt();

  assert.ok(
    /ASKED AFTER THE PICKUP IS BOOKED, NEVER BEFORE IT/.test(src),
    'nothing tells the model when to ask'
  );
});

// --- 2. the plan question --------------------------------------------------

test('the plan question is asked at most once', () => {
  const src = prompt();

  assert.ok(/ASKED AT MOST ONCE/.test(src), 'nothing limits how often it is asked');
  assert.ok(/AFTER THAT ONE ASK, YOU NEVER ASK AGAIN/.test(src), src.slice(0, 0));
});

test('"Ok" is explicitly not a plan', () => {
  const src = prompt();

  assert.ok(/"OK" IS NOT A PLAN/.test(src), 'the exact failure is not named');
  // And the fall-through is stated, not left to judgement.
  assert.ok(/ANYTHING ELSE, INCLUDING "Ok"\s+-> the plan is ONE_TIME/.test(src), 'no default is given');
});

test('somebody who already said a day or "now" is not asked at all', () => {
  const src = prompt();

  assert.ok(
    /ALREADY SAID A DAY, OR "now", OR "come now", DO NOT ASK THE PLAN QUESTION AT ALL/.test(src),
    'a customer asking for a van today still gets a pricing menu'
  );
});

test('the old rule that the plan gates the pickup date is gone', () => {
  const src = prompt();

  assert.ok(
    !/Never ask "when would you like us to pick up\?" of somebody placing their first order until they have chosen/.test(
      src
    ),
    'the plan still blocks asking when they want collecting'
  );
});

test('a subscription is still never inferred', () => {
  const src = prompt();

  // Defaulting to one-time must not have loosened the other direction.
  assert.ok(/NEVER DECIDE FOR THEM/.test(src), src.slice(0, 0));
  assert.ok(/plan is SUBSCRIPTION only when they asked for it in words/.test(src), src.slice(0, 0));
});

test('the default is the dearer rate, which is the safe one to default to', () => {
  const src = prompt();

  assert.ok(/ONE-TIME IS THE DEFAULT AND IT IS THE SAFE ONE/.test(src), src.slice(0, 0));
  // A standing commitment must never be what somebody gets by saying nothing.
  assert.ok(!/default(s|ing)? to SUBSCRIPTION/i.test(src), src.slice(0, 0));
});

// --- 4. the same text twice ------------------------------------------------

test('notify refuses an identical message inside the window', () => {
  const src = withoutComments(SRC('core', 'notify.js'));

  assert.ok(src.includes('alreadySaid('), 'nothing checks for a duplicate');
  assert.ok(src.includes("refused: 'duplicate'"), src.slice(0, 0));
  assert.ok(typeof notify.sendAndLog === 'function');
});

test('the window is thirty seconds, per Neil', () => {
  const src = withoutComments(SRC('core', 'notify.js'));
  const match = src.match(/const DUPLICATE_SECONDS = (\d+);/);

  assert.ok(match, 'no window is defined');
  assert.equal(Number(match[1]), 30);
});

test('it compares the phone, the direction and the exact body', () => {
  const src = withoutComments(SRC('core', 'notify.js'));
  const fn = src.slice(src.indexOf('async function alreadySaid'), src.indexOf('async function sendAndLog'));

  assert.ok(fn.includes("eq('phone', to)"), fn);
  assert.ok(fn.includes("eq('direction', 'OUTBOUND')"), fn);
  assert.ok(fn.includes("eq('body', text)"), 'anything less than the whole message would swallow a real one');
  assert.ok(fn.includes("gt('created_at', since)"), fn);
});

test('a refused duplicate writes nothing to the message log', () => {
  const src = withoutComments(SRC('core', 'notify.js'));
  const at = src.indexOf("refused: 'duplicate'");
  const before = src.slice(src.indexOf('if (await alreadySaid'), at);

  assert.ok(!before.includes('.insert('), 'a refused send was recorded as though it had gone');
});

test('it fails open - a broken lookup still sends', () => {
  const src = withoutComments(SRC('core', 'notify.js'));
  const fn = src.slice(src.indexOf('async function alreadySaid'), src.indexOf('async function sendAndLog'));

  assert.ok(/catch[\s\S]*return false;/.test(fn), 'a failed check would silence a real message');
});

test('the duplicate check runs after the opted-out gate, never before it', () => {
  const src = withoutComments(SRC('core', 'notify.js'));
  const fn = src.slice(src.indexOf('async function sendAndLog'));

  const optedOut = fn.indexOf('hasOptedOut');
  const duplicate = fn.indexOf('alreadySaid');

  assert.ok(optedOut > 0 && duplicate > 0, fn.slice(0, 200));
  assert.ok(optedOut < duplicate, 'STOP must be the first thing checked, always');
});

// --- 5. the welcome back that nobody asked for -----------------------------

test('a greeting is never sent into a live conversation', () => {
  const src = withoutComments(SRC('core', 'onboarding.js'));

  assert.ok(src.includes('threadIsLive('), 'nothing guards the welcome back');
  assert.ok(typeof onboarding.threadIsLive === 'function');
});

test('the three ways a thread counts as live', () => {
  const src = withoutComments(SRC('core', 'onboarding.js'));
  const fn = src.slice(src.indexOf('async function threadIsLive'), src.indexOf('function welcomeBackMessage'));

  assert.ok(fn.includes('issues.holdFor'), 'a handed-over thread is not guarded');
  assert.ok(fn.includes('aiPause.isPaused'), 'a thread a person is working is not guarded');
  assert.ok(fn.includes("from('messages')"), 'recent traffic is not checked');
});

test('the guard fails SILENT, so a broken check cannot produce the bug', () => {
  const src = withoutComments(SRC('core', 'onboarding.js'));
  const at = src.indexOf('threadIsLive(existing)');
  const line = src.slice(at, at + 140);

  assert.ok(/catch\(\(\) => true\)/.test(line), `must default to busy: ${line}`);
});

test('the window is long enough to cover a real conversation', () => {
  assert.ok(onboarding.THREAD_LIVE_MINUTES >= 30, 'too short to cover a pause mid-thread');
  assert.ok(onboarding.THREAD_LIVE_MINUTES <= 24 * 60, 'a returning customer is never greeted');
});

test('the greeting itself is unchanged for somebody genuinely returning', () => {
  const greeting = onboarding.welcomeBackMessage(
    { name: 'Test', address_line1: '1 Road', city: 'Hackensack', state: 'NJ', postal_code: '07601' },
    { open: true }
  );

  assert.ok(greeting.startsWith('Welcome back'), greeting);
});
