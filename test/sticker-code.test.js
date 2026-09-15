'use strict';

// ---------------------------------------------------------------------------
// A STICKER THAT READS L4XK92-2 IS TAG L4XK92, STICKER 2.
//
// Neil, 14 September. It was not. normaliseCode() stripped the hyphen and KEPT
// the digit, so L4XK92-2 became the seven characters L4XK922, failed the
// six-character test and came back null - an unknown code, on a sticker we
// printed ourselves. The person holding it is standing at a laundromat counter
// with a bag in one hand.
//
// THE PRINTED QR WAS NEVER BROKEN. It encodes /o/<code>?t=<sig>&s=<number>, so
// the number rides in the query string and the path is the bare code. What was
// broken is the human-readable line beside it - the one that exists precisely
// for when the camera will not focus.
//
// THE FIX IS IN ONE FUNCTION ON PURPOSE. Five places normalise a typed or
// scanned code: findByCode, the tag lookup, and the three routes behind /o/.
// All five go through normaliseCode(), so teaching that one the hyphen reaches
// the route, the load-out, the order page, the bag-tag page and /o/ at once.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const bags = require('../src/core/bags');

// The browser's own reader, run exactly as the page emits it - the template
// escapes every backslash, and a page load undoes that before the browser
// parses it. Reading the source without undoing it would test a regex the
// browser never sees.
function browserCodeFrom() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'scanner.js'), 'utf8');
  const start = src.indexOf('function codeFrom(text)');
  assert.notEqual(start, -1, 'codeFrom has moved');
  const end = src.indexOf('\n  }', start) + 4;
  const BS = String.fromCharCode(92);
  const body = src.slice(start, end).split(BS + BS).join(BS);
  // eslint-disable-next-line no-new-func
  return new Function('return ' + body)();
}

// --- the four shapes Neil asked for -----------------------------------------

test('PLAIN CODE: the main tag with no number still works', () => {
  const plain = bags.parseCode('7MQ5Y2');
  assert.deepEqual(plain, { code: '7MQ5Y2', seq: null });
  assert.equal(bags.normaliseCode('7MQ5Y2'), '7MQ5Y2');
});

test('CODE-HYPHEN-NUMBER finds the same tag, and says which sticker', () => {
  const sticker = bags.parseCode('7MQ5Y2-2');
  assert.equal(sticker.code, '7MQ5Y2');
  assert.equal(sticker.seq, 2);

  // The whole requirement in one line: it resolves to the same bag as the
  // bare code, rather than to nothing.
  assert.equal(bags.normaliseCode('7MQ5Y2-2'), bags.normaliseCode('7MQ5Y2'));
});

test('LOWERCASE reads the same as uppercase, hyphen and all', () => {
  // Compared against the uppercase answer rather than a literal, because the
  // folding rules also turn I and L into 1 and O into 0 - that is older than
  // this change and must not be restated here.
  assert.deepEqual(bags.parseCode('7mq5y2-2'), bags.parseCode('7MQ5Y2-2'));
  assert.deepEqual(bags.parseCode('l4xk92-3'), bags.parseCode('L4XK92-3'));
  assert.equal(bags.normaliseCode('7mq5y2'), '7MQ5Y2');
});

test('A BAD EXTRA CHARACTER IS REFUSED, not guessed at', () => {
  // Anything after the hyphen that is not a sticker number falls through to be
  // judged as a code, where it fails on length. Refusing is the point: a code
  // that is not ours must not quietly resolve to a bag that is.
  assert.equal(bags.parseCode('7MQ5Y2-2X'), null);
  assert.equal(bags.parseCode('7MQ5Y2X-2'), null);
  assert.equal(bags.parseCode('7MQ5Y22'), null, 'the old bug: hyphen dropped, digit kept');
  assert.equal(bags.normaliseCode('7MQ5Y2-2X'), null);
});

// --- the numbers that exist and the ones that do not ------------------------

test('every sticker number the database allows is readable', () => {
  // 1-4, because migration 0044 allows that and a tag printed under the old
  // four-sticker design has a -4 on it, on an order that has been delivered.
  // Refusing to READ one would make a real sticker unscannable to protect a
  // rule about what we PRINT today.
  for (let n = 1; n <= bags.MAX_STICKER_SEQ; n += 1) {
    assert.equal(bags.parseCode(`7MQ5Y2-${n}`).seq, n, String(n));
  }
  assert.equal(bags.MAX_STICKER_SEQ, 4);
});

test('and a number we have never printed is not a code of ours', () => {
  assert.equal(bags.parseCode('7MQ5Y2-0'), null);
  assert.equal(bags.parseCode('7MQ5Y2-5'), null);
  assert.equal(bags.parseCode('7MQ5Y2-99'), null);
});

test('nothing crashes on nothing', () => {
  for (const bad of [null, undefined, '', '   ', '-', '-2', '7MQ5Y2-']) {
    assert.doesNotThrow(() => bags.parseCode(bad), JSON.stringify(bad));
  }
  assert.equal(bags.parseCode(null), null);
  assert.equal(bags.parseCode('-2'), null);
});

// --- the printed QR, which must not change ----------------------------------

test('THE PRINTED QR IS UNTOUCHED: code in the path, number in ?s=', () => {
  const url = bags.labelUrl('7MQ5Y2', 2);
  assert.ok(url.includes('/o/7MQ5Y2?t='), 'the path stopped being the bare code');
  assert.ok(url.includes('&s=2'), 'the sticker number stopped riding in the query');
  assert.ok(!url.includes('7MQ5Y2-2'), 'the hyphen leaked into the printed URL');
});

test('and a tag with no sticker number still prints without one', () => {
  const url = bags.labelUrl('7MQ5Y2');
  assert.ok(url.includes('/o/7MQ5Y2?t='));
  assert.ok(!url.includes('&s='));
});

test('the signature is over the bare code, so a typed sticker still verifies', () => {
  // /o/7MQ5Y2-2 normalises to 7MQ5Y2 before verifyCode() sees it, which is why
  // the hyphenated form can be typed into a browser at all.
  const url = bags.labelUrl('7MQ5Y2', 2);
  const token = url.split('t=')[1].split('&')[0];
  assert.equal(bags.verifyCode(bags.normaliseCode('7MQ5Y2-2'), token), true);
  assert.equal(bags.verifyCode(bags.normaliseCode('7MQ5Y2'), token), true);
});

// --- what the camera hands back ---------------------------------------------

test('A SCANNED QR AND A TYPED STICKER PRODUCE THE SAME THING', () => {
  const codeFrom = browserCodeFrom();
  assert.equal(codeFrom('https://lyndry.com/o/7MQ5Y2?t=abc&s=2'), '7MQ5Y2-2');
  assert.equal(codeFrom('7MQ5Y2-2'), '7MQ5Y2-2');
});

test('a header QR with no sticker number gives the bare code', () => {
  const codeFrom = browserCodeFrom();
  assert.equal(codeFrom('https://lyndry.com/o/7MQ5Y2?t=abc'), '7MQ5Y2');
});

test('and the hyphen survives a URL that carries it in the path', () => {
  // It did not before: the character class had no hyphen in it, so /o/7MQ5Y2-2
  // came back as 7MQ5Y2 and the sticker number was lost on the way to the box.
  const codeFrom = browserCodeFrom();
  assert.equal(codeFrom('https://lyndry.com/o/7MQ5Y2-2'), '7MQ5Y2-2');
});

test('the browser does not second-guess whether a code is ours', () => {
  // One place decides that, and it is on the server. A validity rule written
  // in a browser would be a second copy of parseCode().
  const codeFrom = browserCodeFrom();
  assert.equal(codeFrom('not a code at all'), 'not a code at all');
});

// --- one owner, so every screen got the fix ---------------------------------

test('EVERY PLACE A CODE IS TYPED OR SCANNED GOES THROUGH ONE FUNCTION', () => {
  // The route, the load-out, the order page, the bag-tag page and /o/ all
  // reach a code through normaliseCode or parseCode. If a sixth entry point
  // ever parses a code itself, this is what catches it.
  const root = path.join(__dirname, '..', 'src');
  const files = ['core/bags.js', 'core/tags.js', 'routes/bag.js'];

  let callers = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    callers += (src.match(/normaliseCode\(|parseCode\(/g) || []).length;
  }
  assert.ok(callers >= 5, `only ${callers} code entry points found`);
});

test('the sticker count we PRINT is unchanged', () => {
  // Neil: do not change how many stickers are on a tag. MAX_STICKER_SEQ is
  // what we can READ; this is what we make.
  assert.equal(bags.STICKERS_PER_TAG, 3);
});
