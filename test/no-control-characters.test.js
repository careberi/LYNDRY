'use strict';

// ---------------------------------------------------------------------------
// NO LITERAL CONTROL CHARACTERS IN THE SOURCE.
//
// TWO TESTS WERE SILENTLY DISARMED BY ONE, and neither showed any sign of it.
//
// A regex written as `/\bcard\b/i` is a word-boundary match. Written into a file
// through a shell heredoc or a non-raw Python string, the backslash can collapse
// and leave a literal BACKSPACE byte, 0x08 - so the regex becomes "backspace,
// then card, then backspace", which matches nothing, ever. The test goes green
// and stays green, and what it was written to refuse is no longer refused.
//
// It is invisible in every way that matters. A terminal renders 0x08 by moving
// the cursor back, so `sed -n '188p'` printed `/customer_id/` - the correct-
// looking thing. Only `od -c` showed it.
//
// WHAT IT COST: `test/update-card-text.test.js` has been asserting that the
// update-card message never says the word "card" - CLAUDE.md records that as
// "a test refuses the word outright" - and it was refusing nothing. The rule
// happened to hold anyway, which is luck rather than the test working.
//
// SO THE CHECK IS ON THE BYTES, not on any individual test. Tab, newline and
// carriage return are the only control characters a source file has any business
// containing.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Everything except tab (09), newline (0A) and carriage return (0D).
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const NAMES = Object.freeze({
  8: 'BACKSPACE (a collapsed \\b)',
  0: 'NUL',
  7: 'BELL',
  12: 'FORM FEED',
  27: 'ESCAPE',
  127: 'DELETE',
});

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

    const here = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(here, found);
      continue;
    }
    if (!/\.(js|sql|css|html|md)$/.test(entry.name)) continue;

    const text = fs.readFileSync(here, 'utf8');
    const at = text.search(FORBIDDEN);
    if (at === -1) continue;

    const code = text.charCodeAt(at);
    const line = text.slice(0, at).split('\n').length;

    found.push(
      `${path.relative(ROOT, here).split('\\').join('/')}:${line} contains ` +
        `${NAMES[code] || `control character 0x${code.toString(16)}`}`
    );
  }

  return found;
}

test('NO SOURCE FILE CONTAINS A LITERAL CONTROL CHARACTER', () => {
  const guilty = [
    ...walk(path.join(ROOT, 'src')),
    ...walk(path.join(ROOT, 'test')),
    ...walk(path.join(ROOT, 'scripts')),
    ...walk(path.join(ROOT, 'supabase')),
  ];

  assert.deepEqual(
    guilty,
    [],
    'a literal control character is in the source. If it is 0x08 it is almost certainly a ' +
      'word-boundary escape that collapsed while the file was being written, which turns the ' +
      'regex around it into one that can never match - and the test containing it into one that ' +
      'passes for free. Check with `od -c`; a terminal will not show it.'
  );
});

test('and this test can actually see one', () => {
  // A guard nobody has watched fail is a guard nobody should trust. The pattern
  // is exercised directly rather than by writing a bad file to disk.
  assert.match('/\u0008card\u0008/i', FORBIDDEN, 'the check cannot see a backspace');
  assert.match('a\u0000b', FORBIDDEN, 'the check cannot see a NUL');
  assert.match('a\u001bb', FORBIDDEN, 'the check cannot see an escape');

  // And leaves the three that belong in a file alone.
  assert.doesNotMatch('a\tb\nc\r\nd', FORBIDDEN, 'the check refuses ordinary whitespace');

  // The thing it must NOT catch: a correctly-escaped word boundary, which is two
  // ordinary characters.
  assert.doesNotMatch('/\\bcard\\b/i', FORBIDDEN, 'the check refuses a properly written regex');
});
