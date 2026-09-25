'use strict';

// ---------------------------------------------------------------------------
// AN ADMIN IS TOLD WHEN A PERSON PLACES AN ORDER, AND NOT WHEN A SWEEP DOES.
//
// Order #2079, 25 September. A new customer signed up on the website at 08:11,
// chose a monthly pickup, and had her first one booked at 08:12. Nobody here
// was told. She was the fourth - #2060 and #2061 on 12 September and #2072 on
// the 17th went the same way - and none of it surfaced anywhere, because a text
// that is never sent leaves no trace at all. Neil found it by opening the
// thread, which is the exact thing order-alerts.js exists to save him doing.
//
// THE CAUSE WAS ONE QUESTION STANDING IN FOR ANOTHER. The alert read
// `fromSchedule`, which answers "did this date come out of a standing
// arrangement". That is true of the overnight sweeps, which is what the skip
// was written for - and also true of the FIRST pickup of a subscription, at the
// moment somebody is sitting on the website setting one up. bookAndSchedule()
// passes `fromSchedule: repeat`, so every subscription signup was silent.
//
// SO THE CALLER SAYS WHICH IT IS. `bookedByTheSystem` is passed by the two
// sweeps in recurring.js and by nothing else. Every other door defaults to
// false, which means the text goes: a door added later is a person until it
// says otherwise, because one text too many is noticed the same evening and one
// text too few is noticed never.
//
// NOTHING HERE TOUCHES THE DATABASE OR THE CARRIER. The rule is pure and
// exported for exactly that reason - the old version was one word inside a
// function that cannot be called without reaching the team list and Telnyx, so
// no test could hold it and it was wrong for thirteen days in silence.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const orderAlerts = require('../src/core/order-alerts');

const ROOT = path.join(__dirname, '..');
const SRC = (...bits) =>
  fs.readFileSync(path.join(ROOT, 'src', ...bits), 'utf8').split('\r\n').join('\n');

// The body of one function, comments stripped, so an assertion cannot match its
// own explanation. Same helper as standing-pickup-keeps-the-plan.test.js, and
// for the same reason recorded there: assert against the thing the rule is
// about, never against a whole file one door can satisfy on another's behalf.
function bodyOf(src, signature) {
  const at = src.indexOf(signature);
  assert.notEqual(at, -1, `${signature} has moved`);
  const end = src.indexOf('\n}\n', at);
  assert.notEqual(end, -1, `could not find the end of ${signature}`);

  return src
    .slice(at, end)
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

function everyJsFile(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const here = path.join(dir, entry.name);
    if (entry.isDirectory()) everyJsFile(here, found);
    else if (entry.name.endsWith('.js')) found.push(here);
  }
  return found;
}

// Both sweeps, by name. A third one added later has to be added here too, which
// is the part that stops the next version of this bug.
const SWEEPS = ['async function bookDue(', 'async function bookNext('];

// --- the rule itself, with nothing behind it ---------------------------------

test('a sweep is silent', () => {
  assert.equal(
    orderAlerts.skipReason({ bookedByTheSystem: true }),
    'a sweep booked it, nobody placed it'
  );
});

test('EVERYBODY ELSE GETS A TEXT, INCLUDING A CALLER THAT SAYS NOTHING', () => {
  // The direction that matters. A door added later which has never heard of
  // this flag must produce a text rather than silence, because silence is the
  // failure nobody reports.
  assert.equal(orderAlerts.skipReason({ bookedByTheSystem: false }), null);
  assert.equal(orderAlerts.skipReason({ bookedByTheSystem: undefined }), null);
  assert.equal(orderAlerts.skipReason({}), null);
  assert.equal(orderAlerts.skipReason(), null);
});

test('AND A STANDING ORDER SOMEBODY SET UP BY HAND IS NOT A SWEEP', () => {
  // #2079 in one assertion: the date came off a plan, and a person was sitting
  // there when it did. The alert may only ask the second question.
  assert.equal(orderAlerts.skipReason({ fromSchedule: true, subscriptionId: 'plan-1' }), null);
});

// --- and the wiring, so the rule is actually the one being asked -------------

test('THE ALERT ASKS WHO BOOKED IT, NOT WHERE THE DATE CAME FROM', () => {
  // The whole bug in one line. If this file reads fromSchedule again, the first
  // pickup of every new subscription goes quiet with nothing failing anywhere.
  const src = SRC('core', 'order-alerts.js');

  for (const fn of ['function skipReason(', 'async function newOrder(']) {
    const body = bodyOf(src, fn);
    assert.ok(!/fromSchedule/.test(body), `${fn} is back to asking about the date`);
  }

  assert.match(bodyOf(src, 'async function newOrder('), /skipReason/, 'newOrder stopped asking');
});

test('THE DEFAULT IS TO SEND', () => {
  // Nothing in order-alerts.js may give the flag a value of its own: undefined
  // has to stay falsy all the way through, or a silent door becomes possible
  // again without anybody writing the word true.
  const src = SRC('core', 'order-alerts.js');
  assert.ok(
    !/bookedByTheSystem\s*=[^=]/.test(src),
    'order-alerts.js defaults the flag, so a caller that says nothing could be silenced'
  );

  assert.match(
    bodyOf(SRC('core', 'booking.js'), 'async function bookPickup('),
    /bookedByTheSystem = false/,
    'bookPickup no longer defaults the flag to false'
  );
});

test('BOOKING HANDS THE ALERT THE RIGHT ONE OF THE TWO', () => {
  const call = bodyOf(SRC('core', 'booking.js'), 'async function bookPickup(');
  const at = call.indexOf('.newOrder({');
  assert.notEqual(at, -1, 'bookPickup stopped telling anybody about new orders');

  const args = call.slice(at, call.indexOf('})', at));
  assert.match(args, /bookedByTheSystem/, 'the alert is no longer told who booked it');
  assert.ok(!/fromSchedule/.test(args), 'the alert is being handed the date question again');
});

test('BOTH SWEEPS SAY SO, IN THEIR OWN BODIES', () => {
  const src = SRC('core', 'recurring.js');

  for (const sweep of SWEEPS) {
    assert.match(
      bodyOf(src, sweep),
      /bookedByTheSystem: true/,
      `${sweep} texts an admin for every pickup it books on its own`
    );
  }
});

test('THE SUBSCRIPTION SIGNUP DOOR IS NOT A SWEEP', () => {
  // bookAndSchedule() is what the wizard, the booking intent and the AI all
  // call, and it is where #2079 went quiet. It passes fromSchedule for the
  // DATE, which is correct and must stay, and must never pass the other one.
  const body = bodyOf(SRC('core', 'recurring.js'), 'async function bookAndSchedule(');

  assert.match(body, /fromSchedule: repeat/, 'the first pickup stopped belonging to the plan');
  assert.ok(!/bookedByTheSystem/.test(body), 'the website subscription door silenced itself again');
});

test('AND NOTHING ELSE IN THE SYSTEM SILENCES ITSELF', () => {
  // The list of doors allowed to be quiet is two, and both are in recurring.js.
  //
  // IT REFUSES A VARIABLE, NOT JUST THE WORD true, which is the point. The bug
  // being fixed was `fromSchedule: repeat` - a variable that happened to be
  // true - so a guard that only caught a literal would have been blind to the
  // exact shape of its own cause. An explicit `: false` is allowed, because
  // saying so out loud is how admin.js already documents a person-made booking.
  const guilty = everyJsFile(path.join(ROOT, 'src'))
    .filter((file) => path.basename(file) !== 'recurring.js')
    .filter((file) => /bookedByTheSystem:\s*(?!false\b)/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file).split('\\').join('/'));

  assert.deepEqual(guilty, [], 'something outside the two sweeps silenced its own alert');
});
