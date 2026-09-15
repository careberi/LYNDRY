'use strict';

// ---------------------------------------------------------------------------
// THE SCAN IS A STILL PHOTO NOW, AND IT STILL DOES NOT BIND A BAG.
//
// Neil's locked brief, 14 September. Tapping Scan with camera opens the
// phone's own camera, the driver takes one photo, we read it, and the code goes
// in the box. That is all it does.
//
// THE HARD CONSTRAINT IS THE LAST PART, and the old scanner broke it: the live
// video loop called form.submit() the instant it decoded anything, so a code
// caught out of the corner of the lens bound a bag nobody had looked at. Half
// of what is pinned here is that nothing submits.
//
// The rest is the refusals, because every one of them is a way a driver ends up
// confirming the wrong bag:
//
//   another company's QR   refused outright, never pasted into the box
//   two tags in one photo  never guessed between
//   a bad photo            no code, and no typing offered on a camera-only step
//   cancelled              the form is exactly as he left it
//
// Nothing here touches the database or a camera.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const scanner = require('../src/web/scanner');

const SRC = fs
  .readFileSync(path.join(__dirname, '..', 'src', 'web', 'scanner.js'), 'utf8')
  .split('\r\n')
  .join('\n');

// The browser's own functions, run exactly as the page emits them - the
// template escapes every backslash and a page load undoes that before the
// browser parses it. Reading the source without undoing it would test a regex
// the browser never sees.
function sourceOf(signature) {
  const start = SRC.indexOf(signature);
  assert.notEqual(start, -1, `${signature} has moved`);
  const end = SRC.indexOf('\n  }', start) + 4;
  const BS = String.fromCharCode(92);
  return SRC.slice(start, end).split(BS + BS).join(BS);
}

// lyndryCode() calls codeFrom(), so the two come out together - pulling one on
// its own gives a function that throws the moment it meets a LYNDRY URL.
function browserFn(signature) {
  const both = `${sourceOf('function codeFrom(text)')}\n${sourceOf(signature)}`;
  const name = signature.slice('function '.length, signature.indexOf('('));
  // eslint-disable-next-line no-new-func
  return new Function(`${both}\nreturn ${name};`)();
}

const field = scanner.scanField({ action: '/ops/x', label: 'Bag code' });
const cameraOnly = scanner.scanField({ action: '/ops/x', label: 'Bag code', cameraOnly: true });
const script = scanner.scannerScript();

// --- the photo is the mechanism ---------------------------------------------

test('THE CAMERA BUTTON OPENS THE PHONE CAMERA, not a video element', () => {
  assert.match(field, /<input type="file"[^>]*capture="environment"/);
  assert.match(field, /accept="image\/\*"/);
  assert.match(field, /class="btn btn-ink btn-lg btn-full scan-open"/);
});

test('AND THE LIVE IN-PAGE VIDEO IS GONE', () => {
  // Neil: do not keep live in-page video as the main scanner. It is not a
  // fallback either - the backups are the Camera app and, where the step
  // allows it, typing.
  assert.ok(!/<video/.test(field), 'the viewfinder is still in the markup');
  assert.ok(!/scan-stage|scan-video|scan-close/.test(field));
  assert.ok(!/getUserMedia/.test(script), 'the script still asks for a camera stream');
});

test('and jsQR survives, because it is what reads the photo on an iPhone', () => {
  // Safari has never had BarcodeDetector. The decoder was never the weak part;
  // what it was being fed was.
  assert.match(script, /BarcodeDetector/);
  assert.match(script, /jsqr\.js/);
});

// --- IT DOES NOT BIND ANYTHING ----------------------------------------------

test('NOTHING IN THE SCANNER SUBMITS A FORM', () => {
  // The whole of the hard constraint. The old live loop called form.submit()
  // on the first thing it decoded.
  assert.ok(!/\.submit\(\)/.test(script), 'the scanner submits a form');
});

test('and the only thing a decode does is fill the box', () => {
  const at = script.indexOf('input.value = codes[0]');
  assert.notEqual(at, -1, 'a successful read no longer fills the box');

  // Nothing after it presses anything.
  const after = script.slice(at, at + 400);
  assert.ok(!/submit|click\(\)|requestSubmit/.test(after), 'a read triggers the form');
});

test('and nothing acts on the page simply loading', () => {
  // Returning from the Camera app, a refresh or a Back button must not confirm
  // anything - which is the same rule ?done= and ?problem= keep everywhere.
  const at = script.indexOf("came = new URLSearchParams");
  assert.notEqual(at, -1);
  const block = script.slice(at, at + 900);
  assert.match(block, /box\.value = came/, 'the returned code no longer fills the box');
  assert.ok(!/submit/.test(block), 'coming back from the camera app submits the form');
});

// --- which codes are ours ---------------------------------------------------

test('A LYNDRY URL YIELDS ITS CODE, AND KEEPS THE STICKER NUMBER', () => {
  const lyndryCode = browserFn('function lyndryCode(text)');

  assert.equal(lyndryCode('https://lyndry.com/o/7MQ5Y2?t=abc&s=2'), '7MQ5Y2-2');
  assert.equal(lyndryCode('https://lyndry.com/o/7MQ5Y2?t=abc'), '7MQ5Y2');
  assert.equal(lyndryCode('https://lyndry.com/o/L4XK92-2'), 'L4XK92-2');
});

test('ANOTHER COMPANY QR IS REFUSED, not handed to the server to judge', () => {
  // The browser does not decide whether a code is VALID - bags.parseCode() owns
  // that and a second copy here would be a second rule. It decides whether the
  // thing in the photo is ours at all, which is a different question: a driver
  // photographing a wall of stickers can easily catch somebody else's QR, and
  // pasting a competitor's web address into the box is not a decision to defer.
  const lyndryCode = browserFn('function lyndryCode(text)');

  assert.equal(lyndryCode('https://someotherlaundry.example/bag/99'), null);
  assert.equal(lyndryCode('http://wifi.example/login'), null);
  assert.equal(lyndryCode(''), null);
});

test('and a bare code is passed through for the server to judge', () => {
  const lyndryCode = browserFn('function lyndryCode(text)');

  assert.equal(lyndryCode('7MQ5Y2'), '7MQ5Y2');
  assert.equal(lyndryCode('7mq5y2-2'), '7mq5y2-2');
  // Including a malformed one. bags.parseCode() refuses L4XK92-2X on the
  // server, and that refusal is the one that counts.
  assert.equal(lyndryCode('L4XK92-2X'), 'L4XK92-2X');
});

test('THE EXISTING HYPHEN PARSING IS UNTOUCHED', () => {
  // codeFrom() is the one the sticker-code tests already pin, and it stays
  // exactly as it was: the sticker number rides in the query string of a
  // printed QR and comes back on the end of the code.
  const codeFrom = browserFn('function codeFrom(text)');

  assert.equal(codeFrom('https://lyndry.com/o/7MQ5Y2?t=abc&s=2'), '7MQ5Y2-2');
  assert.equal(codeFrom('7MQ5Y2-2'), '7MQ5Y2-2');
  assert.equal(codeFrom('not a code at all'), 'not a code at all');
});

// --- two tags, and none ------------------------------------------------------

test('TWO TAGS IN ONE PHOTO ARE NEVER GUESSED BETWEEN', () => {
  assert.match(script, /codes\.length > 1/);
  assert.match(script, /More than one tag in that photo/);

  // And the refusal comes before anything fills the box.
  const many = script.indexOf('codes.length > 1');
  const fills = script.indexOf('input.value = codes[0]');
  assert.ok(many < fills, 'the box is filled before the count is checked');
});

test('and duplicates of the SAME tag are one tag, not two', () => {
  // The two decode passes - whole frame, then the middle of it - can both find
  // the same code. That is one tag photographed once.
  assert.match(script, /codes\.indexOf\(code\) === -1/);
});

test('A BAD PHOTO FILLS NOTHING AND OFFERS A RETAKE', () => {
  assert.match(script, /Could not read a tag/);
  assert.match(script, /open the QR with your phone camera/);
});

// --- the backups that stay ---------------------------------------------------

test('THE CAMERA APP IS STILL OFFERED, on every scan field', () => {
  assert.match(field, /point your phone's camera at the QR and open the link/);
  assert.match(cameraOnly, /point your phone's camera at the QR and open the link/);
  assert.match(script, /ly_scan=/, 'the crumb that brings a camera-app scan back is gone');
});

test('TYPING STAYS HIDDEN ON A CAMERA-ONLY STEP', () => {
  // Neil: typing must not become available there merely because the photo
  // scanner exists. Hidden, not deleted - the box is what a real scan fills.
  assert.match(cameraOnly, /class="scan-typed" style="display:none/);
  assert.match(field, /class="scan-typed" style="display:flex/);
});

test('AND A BAD PHOTO DOES NOT HAND IT BACK', () => {
  // A blurry photo is a reason to take another one, not a reason to let
  // somebody type past a step that exists to prove the bag is in their hand.
  const at = script.indexOf('function letHimType');
  assert.notEqual(at, -1);

  // The only CALLER is the browser that cannot capture at all. The definition
  // reads the same as a call, so it is excluded rather than counted.
  const calls = script.split('letHimType();').length - 1;
  assert.equal(calls, 1, 'letHimType is called from more than the no-capture path');

  const before = script.slice(Math.max(0, script.indexOf('letHimType();') - 300), script.indexOf('letHimType();'));
  assert.match(before, /canCapture/, 'typing comes back for something other than no camera at all');
});

test('and a browser that cannot take a photo at all still gets the box', () => {
  // A driver at a counter with nothing to scan with has to have a way through.
  assert.match(script, /'capture' in document\.createElement\('input'\)/);
});

// --- cancelling --------------------------------------------------------------

test('CANCELLING THE CAMERA CHANGES NOTHING AND SAYS NOTHING', () => {
  const at = script.indexOf("shot.addEventListener('change'");
  assert.notEqual(at, -1);

  const body = script.slice(at, at + 700);
  assert.match(body, /if \(!file\) return;/, 'a cancelled camera is not handled');

  // Nothing is said, nothing is cleared, nothing is filled.
  const upToReturn = body.slice(0, body.indexOf('if (!file) return;'));
  assert.ok(!/input\.value|say\(/.test(upToReturn), 'cancelling touches the form');
});
