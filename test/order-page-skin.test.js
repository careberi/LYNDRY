'use strict';

// ---------------------------------------------------------------------------
// THE ORDER PAGE WEARS THE TERMINAL SKIN.
//
// Neil, 16 September: "Ops look is still split. Conversations matches the
// terminal. The order page does not."
//
// IT WAS ONE MISSING WORD, and the body was never the problem.
// orderConsoleBody() renders a `.console`, which IS the terminal skin - the
// same --c- tokens, the same 13px system type, the same hairline tables and
// tabular numbers as .ops-terminal. What .console deliberately does NOT have is
// a ground: the note on it in ops.css says so, because painting one drew a grey
// box with a cream seam down both sides.
//
// The chrome paints that ground, and only when a page asks. terminal:true is
// the opt-in - most adminPage calls have it - and the order page was one of the
// ones that did not, so a terminal-styled body sat on a cream page inside
// display-font chrome.
//
// AND TWO HEADINGS HAD NEVER WORKED AT ALL. `.console h1` and `.console h2`
// were written as `font: 700 20px/1.2 inherit`, which is invalid - a CSS-wide
// keyword is not a <family-name> - so browsers threw the whole declaration
// away. The h1 had been rendering at the UA default, 2em of 13px, for as long
// as the console has existed. This file's own warning block describes that trap
// and these two rules sat above it doing it.
//
// Nothing about bags, clips or booking was touched. Skin only.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const CSS = () =>
  fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'ops.css'), 'utf8');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// Comments in ops.css warn about the invalid shorthand at length, so a sweep
// that reads its own warning passes for the wrong reason. It has happened.
const cssWithoutComments = () => CSS().replace(/\/\*[\s\S]*?\*\//g, '');

// --- the opt-in -------------------------------------------------------------

test('the order page asks for the terminal skin', () => {
  const src = withoutComments(SRC('routes', 'admin.js'));
  const at = src.indexOf("router.get('/ops/orders/:id'");
  assert.ok(at > 0, 'the order page route is missing');

  // To the end of THIS route, not a guessed window: the next router.get is a
  // real boundary and other pages below it are already terminal:true.
  const route = src.slice(at, src.indexOf('router.get(', at + 20));

  assert.ok(route.includes('terminal: true'), 'the order page is still on the cream chrome');
});

// --- the two headings that never rendered -----------------------------------

test('no invalid font shorthand survives anywhere in ops.css', () => {
  const css = cssWithoutComments();

  // `font: <weight> <size>/<height> inherit` is thrown away whole. Longhands
  // only, in this file, for ever.
  const offenders = css.match(/font:\s*\d[^;]*\binherit\b[^;]*;/g) || [];
  assert.deepEqual(offenders, [], `invalid font shorthand: ${offenders.join(' | ')}`);
});

test('the console keeps its own heading scale under the terminal skin', () => {
  const css = cssWithoutComments();

  // .ops-terminal h1/h2 carry !important to beat fifty inline display headings
  // elsewhere in ops. The console never had those and has a deliberate two-step
  // scale - a 20px title and an 11px uppercase section label - so it needs to
  // win back.
  assert.ok(/\.ops-terminal \.console h1 \{/.test(css), 'the console h1 is stomped by the terminal h1');
  assert.ok(/\.ops-terminal \.console h2 \{/.test(css), 'the console h2 is stomped by the terminal h2');

  const h2 = css.slice(css.indexOf('.ops-terminal .console h2 {'));
  assert.ok(/font-size: 11px !important/.test(h2.slice(0, 260)), h2.slice(0, 260));
  assert.ok(/text-transform: uppercase/.test(h2.slice(0, 260)), 'the section labels lost their case');
});

test('the console rules that win are written as longhands', () => {
  const css = cssWithoutComments();

  for (const sel of ['.console h1 {', '.console h2 {']) {
    const at = css.indexOf(sel);
    assert.ok(at > 0, `${sel} is missing`);
    const rule = css.slice(at, css.indexOf('}', at));
    assert.ok(/font-size:/.test(rule), `${sel} has no font-size`);
    assert.ok(!/\bfont:\s/.test(rule), `${sel} is back to the shorthand`);
  }
});

// --- the body was already clean, and must stay that way ---------------------

test('nothing in the order page body reaches for the marketing look', () => {
  for (const file of ['order-console.js', 'scanner.js']) {
    const src = SRC('web', file);

    for (const marketing of ['--font-display', 'display-1', 'display-2', 'display-3', '--paper-0', 'shadow-']) {
      assert.ok(!src.includes(marketing), `${file} uses ${marketing}`);
    }
  }
});

test('the big driver button is shrunk at a desk rather than removed', () => {
  const css = cssWithoutComments();

  // scanField() is shared with the driver's run page, where a 52px target is
  // right. The order page is read at a desk, so the skin sizes it down rather
  // than the markup changing - which would alter the run page too.
  assert.ok(/\.ops-terminal:not\(\.ops-touch\) \.btn-lg \{/.test(css), 'the desk-sized button rule is gone');
  assert.ok(/\.ops-terminal\.ops-touch \.btn-lg,/.test(css), 'the driver-sized button rule is gone');

  const desk = css.slice(css.indexOf('.ops-terminal:not(.ops-touch) .btn-lg {'));
  assert.ok(/font-size: 13px/.test(desk.slice(0, 200)), desk.slice(0, 200));
});

test('the order page is not marked as a touch screen', () => {
  const src = withoutComments(SRC('routes', 'admin.js'));
  const at = src.indexOf("router.get('/ops/orders/:id'");
  const route = src.slice(at, src.indexOf('router.get(', at + 20));

  // touch:true would give it 52px driver buttons, which is the run page's job.
  assert.ok(!route.includes('touch: true'), 'the order page is wearing the driver sizing');
});

// --- skin only --------------------------------------------------------------

test('no behaviour was changed, only the look', () => {
  const src = SRC('web', 'order-console.js');

  // The forms still post to the same routes. If these moved, this stopped
  // being a skin change.
  for (const action of ['/collected', '/bag-count', '/label', '/bag-weight', '/bag-clip']) {
    assert.ok(src.includes(action), `the ${action} form was lost`);
  }
});
