'use strict';

// ---------------------------------------------------------------------------
// A BACKTICK INSIDE A TEMPLATE LITERAL SILENTLY DELETED HALF A PAGE.
//
// Neil, 26 September: "the book item does not work". The phone-booking form at
// /ops/customers/<id>/order rendered its heading and the top card and then simply
// STOPPED - no date, no time, no button. Every customer, on production, for as
// long as the comment had been there.
//
// THE CAUSE WAS AN HTML COMMENT INSIDE THE RETURNED TEMPLATE:
//
//   cold and softener when nothing is set, so `|| 'not set'` could never
//
// Those two backticks are inside a template literal. The first CLOSES it, the
// text between becomes real JavaScript, and the second OPENS a new one - so the
// expression parses as:
//
//   `...so ` || 'not set' || ` could never...`
//
// which is valid JavaScript, short-circuits on the first truthy string, and
// throws the rest of the page away. It is the worst shape a bug can have: the
// file parses, the server starts, no error is logged, the tests are green, and
// the page is simply half missing.
//
// WHY NOTHING CAUGHT IT. `node --test` never rendered that function, the browser
// had nothing to complain about because the HTML it received was well-formed, and
// a reviewer reads a comment as a comment. Neil found it by pressing the button.
//
// SO THE CHECK IS ON THE SOURCE, and it is narrow on purpose: a backtick inside
// the BODY of a template literal, in a file whose job is to build HTML. Escaped
// ones are fine, and so is a backtick in an ordinary // comment - it is only
// dangerous where it can close a template.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Everywhere HTML is built from template literals.
const DIRS = [
  path.join(ROOT, 'src', 'web'),
  path.join(ROOT, 'src', 'routes'),
];

function files() {
  const found = [];

  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.js')) found.push(path.join(dir, name));
    }
  }

  return found;
}

// EVERY HTML COMMENT IN THE FILE, wherever it is. An HTML comment is only ever
// written to be emitted, which means it is inside a template literal - so a
// backtick in one can always close that template. This is the exact shape of the
// bug and it is worth refusing outright rather than reasoning about nesting.
function htmlCommentsWithBackticks(src) {
  const bad = [];

  for (const m of src.matchAll(/<!--[\s\S]*?-->/g)) {
    if (!m[0].includes('`')) continue;

    bad.push({
      line: src.slice(0, m.index).split('\n').length,
      text: m[0].replace(/\s+/g, ' ').slice(0, 110),
    });
  }

  return bad;
}

test('NO HTML COMMENT CONTAINS A BACKTICK', () => {
  const guilty = [];

  for (const file of files()) {
    const src = fs.readFileSync(file, 'utf8');

    for (const hit of htmlCommentsWithBackticks(src)) {
      guilty.push(`${path.relative(ROOT, file).split('\\').join('/')}:${hit.line}  ${hit.text}`);
    }
  }

  assert.deepEqual(
    guilty,
    [],
    'an HTML comment contains a backtick. An HTML comment is always inside a template literal - ' +
      'so that backtick CLOSES the template, the words after it become JavaScript, and everything ' +
      'from there to the end of the return is silently discarded by a `||`. The file still parses ' +
      'and the page renders half. Take the backticks out of the comment, or make it a // comment.'
  );
});

test('and the check can actually see the one that shipped', () => {
  // A GUARD NOBODY HAS WATCHED FAIL IS A GUARD NOBODY SHOULD TRUST. This is the
  // comment exactly as it stood in `phoneOrderForm`, which cost the whole booking
  // form.
  const shipped = `
    <!-- CHOSEN OR DEFAULTED, SAID OUT LOUD. describeSaved() falls back to
         cold and softener when nothing is set, so \`|| 'not set'\` could never
         fire and this panel read a default back. -->`;

  assert.equal(htmlCommentsWithBackticks(shipped).length, 1, 'the check cannot see the bug that shipped');

  // And it leaves an ordinary comment alone.
  assert.equal(
    htmlCommentsWithBackticks('<!-- a perfectly ordinary note about the markup -->').length,
    0,
    'the check refuses a comment with nothing wrong with it'
  );
});

test('THE BOOKING FORM ACTUALLY CONTAINS ITS OWN FIELDS', () => {
  // The narrower half, and the one that would have failed on the day: whatever
  // ate the page, the thing that mattered is that the form was not in the output.
  // This renders nothing - it reads the source - because the truncation happened
  // inside a single template literal and is visible there.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'admin.js'), 'utf8');

  const at = src.indexOf('function phoneOrderForm');
  assert.notEqual(at, -1, 'phoneOrderForm has been renamed or removed');

  const body = src.slice(at, src.indexOf('\nrouter.', at));

  for (const needed of ['pickup_date', 'pickup_time', 'type="submit"', '/order']) {
    assert.ok(body.includes(needed), `the phone booking form has lost ${needed}`);
  }

  // AND THE ORDER OF THINGS MATTERS HERE: the fields come AFTER the summary card,
  // so anything that truncates the template takes them with it. If the summary is
  // present and the submit is not, that is this bug again.
  assert.ok(
    body.indexOf('What we already have') < body.indexOf('pickup_date'),
    'the summary card and the form have swapped over, so this test no longer proves anything'
  );
});

test('and it offers to book without texting', () => {
  // Neil, 26 September: "i should have the option to net text the customer once
  // its booked." A checkbox rather than a second button - booking is one act, and
  // whether it is announced is a property of it.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'admin.js'), 'utf8');

  const at = src.indexOf('function phoneOrderForm');
  const body = src.slice(at, src.indexOf('\nrouter.', at));

  assert.match(body, /name="silent"/, 'the phone booking form cannot skip the text');
  assert.ok(!/checked/.test(body.slice(body.indexOf('name="silent"') - 200, body.indexOf('name="silent"') + 200)),
    'not texting is the default, which it must not be');

  // And the route honours it by not sending rather than by swallowing a send.
  const route = src.slice(src.indexOf("router.post('/ops/customers/:id/order'"));
  const upToSend = route.slice(0, route.indexOf('notify.sendAndLog'));
  assert.match(upToSend, /silent/, 'the route ignores the checkbox and texts them anyway');
});
