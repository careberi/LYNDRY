'use strict';

// ---------------------------------------------------------------------------
// EVERY NOTICE IN OPS WEARS THE TERMINAL SKIN.
//
// Neil, 16 September: an issue is raised and the strip across the top of every
// ops page is still the marketing site - cream card stock, a hard ink shadow
// and a 24px display face, on a grey terminal made of hairlines.
//
// WHY IT SURVIVED THE RESTYLE IS THE WHOLE POINT, and it is what this file
// pins. Each banner carried its own background colour in a style attribute,
// and an inline style beats every stylesheet rule - so no skin could reach the
// one piece of markup a restyle is actually about. Neil's instruction was to
// beat those exact rules or stop writing them.
//
// These tests hold the SECOND option, because it is the one that cannot rot:
// the markup names a class and says nothing about colour, so the look lives in
// ops.css and there is no per-screen copy to drift. A test that only checked
// the stylesheet would pass on the day somebody writes a colour back inline.
//
// Nothing here touches the database or renders a page.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { opsNote } = require('../src/routes/admin');

const read = (...bits) => fs.readFileSync(path.join(__dirname, '..', ...bits), 'utf8');

// The public site's vocabulary. Every one of these is cream paper, a hard
// offset shadow or a display face, and none of them belongs on a terminal.
const PUBLIC_LOOK = [
  'var(--paper-0',
  'var(--stain-500)',
  'var(--stain-100)',
  'var(--sunbeam-500)',
  'var(--sunbeam-300)',
  'var(--suds-300)',
  'var(--suds-100)',
  'var(--font-display)',
  'box-shadow:6px 6px 0',
];

// --- the component ----------------------------------------------------------

test('A NOTICE WRITES NO COLOUR INTO ITS OWN MARKUP', () => {
  // The whole fix in one assertion. If a colour ever appears here again, the
  // stylesheet has stopped being able to decide what a notice looks like.
  for (const tone of ['bad', 'warn', 'good', 'info']) {
    const html = opsNote({
      tone,
      label: 'Needs a person',
      title: '3 unresolved issues',
      body: 'Open them.',
    });

    assert.ok(!/style="/.test(html), `the ${tone} notice writes a style attribute`);
    for (const bad of PUBLIC_LOOK) {
      assert.ok(!html.includes(bad), `the ${tone} notice names ${bad}`);
    }
  }
});

test('and the tone is a class, so red and amber mean something', () => {
  assert.match(opsNote({ tone: 'bad' }), /ops-note--bad/);
  assert.match(opsNote({ tone: 'warn' }), /ops-note--warn/);
  assert.match(opsNote({ tone: 'good' }), /ops-note--good/);

  // Info is the absence of a tone rather than a fourth colour: a notice that
  // is neither a problem nor a success should not compete for attention.
  const info = opsNote({ tone: 'info' });
  assert.ok(!/ops-note--/.test(info), 'info picked up a tone class');
  assert.match(info, /class="ops-note"/);

  // An unknown tone falls back to no colour rather than putting a class name
  // nothing styles into the markup.
  assert.match(opsNote({ tone: 'banana' }), /class="ops-note"/);
});

test('a notice that is a link is the whole panel', () => {
  const html = opsNote({
    tone: 'bad',
    title: '3 unresolved issues',
    go: 'Open them',
    href: '/ops/issues',
  });

  assert.match(html, /^<a href="\/ops\/issues"/);
  assert.match(html, /ops-note__go/);
});

test('and everything a caller passes as text is escaped', () => {
  // A notice carries a customer's name, a laundromat's note and whatever an
  // issuer wrote about a declined card, all of which are untrusted.
  const html = opsNote({
    label: '<script>x</script>',
    go: '"><script>y</script>',
    href: '/ops/x"onload="z',
  });

  assert.ok(!html.includes('<script>'), 'a label or a link went in unescaped');
  assert.ok(!html.includes('onload="z'), 'the href broke out of its attribute');
});

// --- the screens ------------------------------------------------------------

test('THE TWO BANNERS ON EVERY OPS PAGE ARE DRAWN BY IT', () => {
  // These two render in adminPage's shared shell, so they are on all of the
  // ops screens rather than only the ones that opt into .ops-terminal. They
  // were the worst of it, and they are the reason .ops-note is not scoped to
  // that class.
  const src = read('src', 'routes', 'admin.js');
  const shell = src.slice(src.indexOf('function adminPage'), src.indexOf('function table('));

  assert.ok(shell.includes('opsNote({'), 'the shell stopped using the component');

  for (const bad of PUBLIC_LOOK) {
    assert.ok(!shell.includes(bad), `adminPage's shell still writes ${bad}`);
  }
});

test('AND NO OPS SCREEN PAINTS A NOTICE BY HAND ANY MORE', () => {
  // Read across every file that renders an ops page. What is refused is the
  // public palette inside a notice - a status chip or a progress bar may still
  // carry a brand colour, and neither of those is a notice.
  const files = [
    ['src', 'routes', 'admin.js'],
    ['src', 'web', 'prelaunch-page.js'],
    ['src', 'web', 'partners-page.js'],
    ['src', 'web', 'routing-board.js'],
    ['src', 'web', 'run-page.js'],
    ['src', 'web', 'loadout-page.js'],
    ['src', 'web', 'scheduled-page.js'],
    ['src', 'web', 'reports-page.js'],
    ['src', 'web', 'team-page.js'],
  ];

  for (const bits of files) {
    const body = read(...bits);
    const where = bits.join('/');

    // A notice is a thing with a role. None of them may sit next to a
    // public-site colour.
    for (const line of body.split('\n')) {
      if (!/role="(alert|status)"/.test(line)) continue;
      for (const bad of PUBLIC_LOOK) {
        assert.ok(
          !line.includes(bad),
          `${where}: an alert still names ${bad}\n  ${line.trim().slice(0, 100)}`
        );
      }
    }
  }
});

// --- the stylesheet ---------------------------------------------------------

test('THE LOOK IS IN ops.css AND IS NOT SCOPED TO .ops-terminal', () => {
  // .ops-terminal is opt-in per page. A notice styled under it would be right
  // on some screens and look like the marketing site on the rest - and the
  // issues banner in particular renders on every one of them.
  const css = read('public', 'css', 'ops.css');

  const at = css.indexOf('.ops-note {');
  assert.notEqual(at, -1, '.ops-note has gone');

  const block = css.slice(at, css.indexOf('}', at));
  assert.match(block, /background:\s*var\(--c-row/, 'the panel is not the terminal row colour');
  assert.match(block, /box-shadow:\s*none/, 'the hard shadow can come back');

  assert.ok(
    !/\.ops-terminal\s+\.ops-note\s*\{/.test(css),
    '.ops-note was scoped to .ops-terminal, so half the screens lose it'
  );
});

test('and the console flash is the same object, not a second one', () => {
  // It predates the component and drew a filled red or green panel. The one
  // screen with the most notices on it must not be the one screen where they
  // look different.
  const css = read('public', 'css', 'ops.css');

  const at = css.indexOf('.console .flash {');
  assert.notEqual(at, -1, 'the console flash has gone');

  const block = css.slice(at, css.indexOf('}', at));
  assert.match(block, /background:\s*var\(--c-row\)/, 'the flash is still a filled panel');
});

test('THE TITLE IS NOT WRITTEN AS A FONT SHORTHAND', () => {
  // A font shorthand ending in `inherit` reads fine and is invalid: a CSS-wide
  // keyword is not a family name, so the browser drops the whole declaration
  // and the title renders at body weight. It was written that way first and
  // caught by looking at the page rather than at the rule.
  const css = read('public', 'css', 'ops.css');

  const at = css.indexOf('.ops-note__title {');
  assert.notEqual(at, -1, '.ops-note__title has gone');

  // COMMENTS COME OUT FIRST. The rule explains the bug directly above itself,
  // so a naive search finds the broken shorthand written in the prose warning
  // against it - which is the test failing on its own documentation, and has
  // happened in this repo before.
  const block = css.slice(at, css.indexOf('}', at)).replace(/\/\*[\s\S]*?\*\//g, '');

  assert.ok(!/font:\s*[^;]*inherit/.test(block), 'the title is back on an invalid font shorthand');
  assert.match(block, /font-weight:\s*700/);
});

test('AND THE PUBLIC SITE WAS NOT TOUCHED', () => {
  // Neil's line. ops.css is never loaded on a public page, so the component
  // cannot reach the marketing site - but the thing to actually check is that
  // this pass did not reach into lyndry.css to get its way.
  const lyndry = read('public', 'css', 'lyndry.css');
  assert.ok(!lyndry.includes('ops-note'), 'the ops notice leaked into the public stylesheet');
});
