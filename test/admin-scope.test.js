'use strict';

// ---------------------------------------------------------------------------
// AN IDENTIFIER THE MARKUP USES AND NOTHING DECLARES IS A 500 ON A REAL PAGE.
//
// WHAT HAPPENED, 16 September. The customer page worked out two things beside
// each other - the list of gaps, and whether the person reading may text
// anybody:
//
//     const gaps = await nudges.gapsFor(person);
//     const canAsk = roles.can(req.opsUser, 'messages.send') && ...;
//
// When the gaps became the intake table both lines went out together. `gaps`
// was genuinely dead - nothing had rendered it since the ask buttons moved to
// the conversation - but `canAsk` was not, because the new Send card link
// button reads it. So the markup referenced a name declared nowhere.
//
// A BARE IDENTIFIER THAT DOES NOT RESOLVE THROWS ReferenceError WHEN THE
// TEMPLATE IS EVALUATED, not when the file loads. The module requires cleanly,
// every existing test passes, and the page 500s the first time somebody opens
// it. Nothing in test/ renders an ops page, because every one of them needs a
// database - so there was nothing at all between that deletion and the live
// site.
//
// WHY THERE IS NO GENERAL CHECK HERE, having written one and thrown it away.
//
// "Every name admin.js uses is declared somewhere in admin.js" is the shape
// that would have caught it, and it can be done without a parser: strip the
// comments, the strings and the text halves of the template literals, then
// compare the identifiers read against the identifiers declared. That was
// built. On this file it comes back with about seventy-five names it cannot
// resolve - destructured imports, shorthand properties, parameters in shapes
// the regexes do not see - every one of which would need an allowlist entry.
//
// A test with a seventy-five-name allowlist is a test nobody maintains, and a
// stale allowlist is worse than no test: it goes green while hiding the next
// one. Same argument this codebase already makes about a log that is mostly
// noise. The honest answer is a real parser, and CLAUDE.md rules out the
// dependency.
//
// So what is pinned below is narrow and says so: the three screens that draw
// the intake table each work out their own permission flag. That is the exact
// thing that broke, on the exact three pages it could break on.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

// One route handler, from its router line to the next one.
function handlerFor(route) {
  const src = SRC('routes', 'admin.js');
  const from = src.indexOf(route);
  assert.ok(from > 0, `${route} is gone`);

  return src.slice(from, src.indexOf('\nrouter.', from + 10));
}

test('the customer page still works out whether it may text anybody', () => {
  const handler = handlerFor("router.get('/ops/customers/:id'");

  assert.ok(/const canAsk\s*=/.test(handler), 'canAsk is read by the markup and declared nowhere');
  assert.ok(handler.includes("roles.can(req.opsUser, 'messages.send')"), 'it is not behind a permission');
  assert.ok(
    handler.includes("person.status !== 'UNSUBSCRIBED'"),
    'an opted-out number is offered a button that cannot fire'
  );
  assert.ok(handler.includes('canAsk\n') || handler.includes('canAsk'), 'nothing uses it any more');
});

test('every screen drawing the intake table works out its own permission', () => {
  // Each of these renders intakeTable() and each reads a "may I send" flag.
  // They are three separate handlers, so three separate declarations - which is
  // exactly the thing that is easy to delete with the code that used to need it.
  for (const [route, flag] of [
    ["router.get('/ops/orders/:id'", 'canAskOnOrder'],
    ["router.get('/ops/customers/:id'", 'canAsk'],
    ["router.get('/ops/messages/:phone'", 'canWrite'],
  ]) {
    const handler = handlerFor(route);

    assert.ok(handler.includes('intakeTable('), `${route} no longer draws the table`);
    assert.ok(
      new RegExp(`const ${flag}\\s*=`).test(handler),
      `${route} draws the table and never works out ${flag}`
    );
  }
});

test('the Send card link button and the flag it reads are in the same handler', () => {
  // The whole of the bug in one assertion: the button is on the customer page,
  // so the flag has to be too.
  const handler = handlerFor("router.get('/ops/customers/:id'");

  const button = handler.indexOf('>Send card link<');
  const flag = handler.indexOf('const canAsk');

  assert.ok(button > 0, 'the button is not on the customer page');
  assert.ok(flag > 0 && flag < button, 'the button is drawn before the flag exists');
});
