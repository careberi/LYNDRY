'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// WHO THE CONVERSION FEED ANSWERS, AND WITH WHAT.
//
// GET /ads/conversions.csv is the one route in this system protected by a
// password on a URL, because Google Ads' scheduled upload speaks HTTPS with
// Basic auth and nothing else. Three answers, and each is load-bearing for a
// different reason:
//
//   no password set       404. Blank switches the route off, and it must not
//                         become a challenge that invites guessing
//   no credential offered 401 with a challenge, because Google's connector
//                         fetches once unauthenticated and only sends the
//                         password after it has been asked for one
//   a wrong credential    404, so a bad password is indistinguishable from a
//                         path that was never a page
//
// THE LAST TWO PULL IN OPPOSITE DIRECTIONS, which is why this file exists. The
// route answered 404 to all three for weeks. That looked like the safest
// possible choice and silently broke the feature: Google reported "Invalid
// credentials" against a password that was correct, because it never got as far
// as sending it. The obvious repair - answer 401 whenever the credential is not
// right - would fix Google and throw away the thing the 404 was protecting, by
// confirming the file to anybody who tries a password at it.
//
// So the split is the point, and this reads the source to hold it. Nothing else
// in test/ can exercise an Express route, and what is worth protecting here is
// four lines that will look redundant to whoever tidies them.
// ---------------------------------------------------------------------------

const WEB = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'web.js'), 'utf8');

// The handler body, so nothing below can match a comment somewhere else.
function handler() {
  const at = WEB.indexOf("router.get('/ads/conversions.csv'");
  assert.notEqual(at, -1, 'the conversion feed route has moved or been deleted');
  const end = WEB.indexOf("router.get('/robots.txt'", at);
  assert.ok(end > at, 'could not find the end of the feed route');
  return WEB.slice(at, end);
}

// Comments in this file explain the rule at length, and every rule below is
// stated in one of them. Matching prose would pass on the explanation alone.
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

test('a client that waits to be asked is asked', () => {
  const body = code(handler());

  assert.match(
    body,
    /401/,
    'nothing answers 401, so a non-preemptive client never sends its password'
  );
  assert.match(
    body,
    /WWW-Authenticate/i,
    'no challenge header, so Google Ads reports "Invalid credentials" for a correct password'
  );
  assert.match(body, /Basic realm=/i, 'the challenge does not name Basic auth');
});

test('a WRONG credential still looks like a path that was never a page', () => {
  const body = code(handler());

  // The failing-credential branch must answer 404. If this ever becomes 401,
  // anybody who guesses the path can confirm the file is real by throwing one
  // password at it, which is the whole thing the 404 buys.
  const at = body.indexOf('credentialsMatch');
  assert.notEqual(at, -1, 'the credential check has gone');

  const branch = body.slice(at, at + 220);
  assert.match(branch, /404/, 'a wrong credential no longer answers 404');
  assert.ok(
    !/401/.test(branch),
    'a wrong credential answers 401, which confirms the file to anybody guessing'
  );
});

test('the challenge is only ever sent when nothing was offered', () => {
  const body = code(handler());

  // The 401 hangs off the absence of a header, never off the check failing.
  assert.match(
    body,
    /if\s*\(\s*!offered\s*\)/,
    'the challenge is not guarded by "nothing was offered"'
  );
});

test('an unset password is still no file at all, and never a challenge', () => {
  const body = code(handler());

  const blank = body.indexOf('uploadPassword');
  const challenge = body.indexOf('WWW-Authenticate');
  assert.notEqual(blank, -1, 'the route no longer checks whether a password is set');
  assert.ok(
    blank < challenge,
    'a switched-off route can answer with a challenge, inviting somebody to guess at a password that does not exist'
  );
});

test('the comparison stays constant time', () => {
  // Unchanged by any of the above, and easy to lose in a tidy-up: the password
  // is compared byte by byte in constant time, like the admin key.
  assert.match(WEB, /timingSafeEqual/, 'the credential comparison is no longer constant time');
});
