'use strict';

// ---------------------------------------------------------------------------
// SCANNING WITH THE PHONE'S OWN CAMERA.
//
// Neil, 12 September: the in-page scanner "doesn't read the code". His fix is
// the one the laundromat has always used - point the real camera at the QR,
// which opens /o/<code>, and take the code out of the URL.
//
// The whole of that lands on one function, and the half of it worth pinning is
// the refusals. /o/<code> is a page with no login at all, reachable by anybody
// who can point a camera, and a redirect it can be talked into is an open
// redirector on lyndry.com - a ready-made phishing link.
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { scanReturn, CRUMB } = require('../src/web/scanner');

test('it hands the code back to the screen the driver came from', () => {
  assert.equal(scanReturn('/ops/run', '7MQ5Y2'), '/ops/run?code=7MQ5Y2');
  assert.equal(scanReturn('/ops/loadout', 'K3F9QP'), '/ops/loadout?code=K3F9QP');
});

test('it keeps whatever else was on that screen', () => {
  // /ops/run?bag=2 is a particular bag of a particular stop. Losing it would
  // drop him back on the list he had already tapped into.
  assert.equal(scanReturn('/ops/run?bag=2', '7MQ5Y2'), '/ops/run?bag=2&code=7MQ5Y2');
});

test('last scan does not stack up on this one', () => {
  assert.equal(scanReturn('/ops/run?bag=2&code=OLD123', '7MQ5Y2'), '/ops/run?bag=2&code=7MQ5Y2');
});

// --- The refusals -----------------------------------------------------------

test('only /ops, because that is the only place a driver was', () => {
  assert.equal(scanReturn('/account', '7MQ5Y2'), null);
  assert.equal(scanReturn('/', '7MQ5Y2'), null);
  assert.equal(scanReturn('/opsy', '7MQ5Y2'), null);
  assert.equal(scanReturn('/pay/abc', '7MQ5Y2'), null);
});

test('it cannot be talked into leaving the site', () => {
  // Each of these would make a public page with no login into an open
  // redirector on our own domain.
  assert.equal(scanReturn('//evil.example/x', '7MQ5Y2'), null);
  assert.equal(scanReturn('https://evil.example/ops/run', '7MQ5Y2'), null);
  // A backslash is the one that matters: some browsers read it as a slash,
  // so /ops + backslash + host can escape the site. Built from its character
  // code because a literal backslash does not survive every editor on the way
  // into this file.
  const slash = String.fromCharCode(92);
  assert.equal(scanReturn('/ops/' + slash + slash + 'evil.example', '7MQ5Y2'), null);
  assert.equal(scanReturn('javascript:alert(1)', '7MQ5Y2'), null);
});

test('a code that is not code-shaped goes nowhere', () => {
  assert.equal(scanReturn('/ops/run', 'not a code!'), null);
  assert.equal(scanReturn('/ops/run', '../../etc/passwd'), null);
  assert.equal(scanReturn('/ops/run', ''), null);
  assert.equal(scanReturn('/ops/run', 'A'.repeat(20)), null);
});

test('no crumb, no redirect - the laundromat sees its own page', () => {
  // Everybody who is not a driver mid-scan has no crumb, and /o/<code> has to
  // go on being the page a laundromat attendant reads.
  assert.equal(scanReturn(null, '7MQ5Y2'), null);
  assert.equal(scanReturn('', '7MQ5Y2'), null);
  assert.equal(scanReturn(undefined, '7MQ5Y2'), null);
});

test('a sticker code with its sequence still works', () => {
  // Bag stickers are 7MQ5Y2-1 upwards off one tag.
  assert.equal(scanReturn('/ops/run', '7MQ5Y2-1'), '/ops/run?code=7MQ5Y2-1');
});

test('the crumb has a name and it is not a credential', () => {
  assert.equal(CRUMB, 'ly_scan');
});

// ---------------------------------------------------------------------------
// AND THE ROUTE MUST NOT FREEZE WHEN THE IN-APP SCANNER WILL NOT READ.
//
// Neil, 15 September, after order #2064. Sahrish Khan's bags came back from
// Fancy K, reached her door, and the order sat on READY - because the per-bag
// walk starts with a camera-only scan and the tag would not read, so no bag was
// ever marked aboard and the stop could not be finished.
//
// Two halves of the camera-app path were wrong as well, and both are below.
// ---------------------------------------------------------------------------

const fs = require('node:fs');
const path = require('node:path');

const SRC = (...bits) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8')
    .split('\r\n')
    .join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

test('THE STICKER NUMBER SURVIVES THE ROUND TRIP', () => {
  // A printed QR is /o/<code>?t=<sig>&s=<number>, so the number is in the
  // query and the path is the bare tag. /o/ handed back the bare code, which
  // on a tag whose three stickers are three different bags does not answer the
  // question the step is asking.
  //
  // The in-app scanner has always reassembled it, so the two paths gave two
  // different answers for one sticker.
  assert.equal(scanReturn('/ops/run', 'WZ7MZ8-1'), '/ops/run?code=WZ7MZ8-1');

  const route = withoutComments(SRC('routes', 'bag.js'));
  assert.match(route, /seqForBox/, 'the sticker number is dropped again');
  assert.match(
    route,
    /scanReturn\(\s*readCookie\(req, scanner\.CRUMB\),\s*seqForBox \? `\$\{code\}-\$\{seqForBox\}` : code/,
    'scanReturn is no longer given the sticker-qualified code'
  );
});

test('and a repeated ?s= cannot make a nonsense code', () => {
  // Express hands back an array for ?s=1&s=2, so the shape is checked rather
  // than trusted - anything that is not one or two digits falls back to the
  // bare code, which is exactly what used to happen every time.
  const route = withoutComments(SRC('routes', 'bag.js'));

  const at = route.indexOf('seqForBox =');
  assert.notEqual(at, -1, 'seqForBox has gone');

  // Asserted on the one line rather than by matching the regex literal
  // character for character, which is a test that breaks on a reformat.
  const line = route.slice(at, route.indexOf('\n', at));
  assert.match(line, /askedSeq/, 'the sticker number is not read from the query');
  assert.match(line, /\.test\(/, 'the sticker number is used without checking its shape');
  assert.match(line, /:\s*null/, 'a bad sticker number has no safe fallback');
});

test('THE CRUMB IS DROPPED ON EVERY DRIVER SCREEN, not only ones with a box', () => {
  // The walk through a bag is four screens and exactly one has a scan field.
  // A driver who reached for his phone's camera on the weigh step, the clip
  // step or the stop card left no crumb - so /o/<code> had nowhere to send him
  // and he was stranded on the laundromat's page with no way back.
  const script = withoutComments(SRC('web', 'scanner.js'));

  const crumbAt = script.indexOf("'ly_scan='");
  const guardAt = script.indexOf('if (forms.length)');

  assert.notEqual(crumbAt, -1, 'the crumb has gone');
  assert.notEqual(guardAt, -1, 'the forms guard has moved');
  assert.ok(crumbAt < guardAt, 'the crumb is still set only when a scan field exists');
});
