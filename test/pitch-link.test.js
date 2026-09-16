'use strict';

// ---------------------------------------------------------------------------
// THE LAUNDROMAT PITCH OPENS ONLY WITH A LINK WE TEXTED, AND NOT FOR LONG.
//
// Neil, 14 September, in three instructions: the page should not be public, a
// guessed URL should not show the pitch, and the link can only be texted and
// should only work for about five minutes after it goes out.
//
// What is pinned here is mostly the refusals, because every one of them is a
// way the page could quietly become public again:
//
//   no bare path        /for-laundromats renders nothing
//   nothing links it    not in PAGES, not in the sitemap, not in the ops menu
//   unguessable         the token is signed, and checked in constant time
//   short-lived         five minutes from minting, and the clock is signed too
//   distinct per send   two people do not hold the same URL
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const pitchLink = require('../src/core/pitch-link');
const { config } = require('../src/config');

const SRC = (...bits) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8')
    .split('\r\n')
    .join('\n');

const MINUTE = 60_000;

// --- what a live link does --------------------------------------------------

test('A LINK WE JUST MINTED OPENS', () => {
  assert.equal(pitchLink.verify(pitchLink.mint()).ok, true);
});

test('AND STOPS OPENING AFTER FIVE MINUTES', () => {
  // Neil's number. Short for a sales page on purpose: it is sent to somebody he
  // is standing in front of or already on the phone to.
  assert.equal(config.partners.pitchLinkMinutes, 5);
  assert.equal(pitchLink.lifetimeMs(), 5 * MINUTE);

  const now = Date.now();
  const token = pitchLink.mint(now);

  assert.equal(pitchLink.verify(token, now + 4 * MINUTE).ok, true, 'dead after four minutes');
  assert.equal(pitchLink.verify(token, now + 5 * MINUTE).ok, true, 'dead exactly on the limit');
  assert.deepEqual(pitchLink.verify(token, now + 5 * MINUTE + 1), { ok: false, expired: true });
  assert.deepEqual(pitchLink.verify(token, now + 60 * MINUTE), { ok: false, expired: true });
});

test('EVERY SEND IS ITS OWN LINK', () => {
  // So one forwarded link is one link, rather than the key to the page.
  const a = pitchLink.mint();
  const b = pitchLink.mint();
  assert.notEqual(a, b);
  assert.equal(pitchLink.verify(a).ok, true);
  assert.equal(pitchLink.verify(b).ok, true);
});

// --- what a guessed link does -----------------------------------------------

test('A GUESSED URL IS REFUSED, AND IS NOT EVEN TOLD IT EXPIRED', () => {
  // The signature is checked before the clock is, so only somebody who really
  // held a link is ever told "expired". A stranger cannot tell an expired link
  // from a path that was never a page.
  for (const bad of [
    '',
    null,
    undefined,
    'for-laundromats',
    'aaa.bbb.ccc',
    'mu21zerx.d46c1c9eac4b0495.deadbeefdeadbeefdeadbeef',
    '../../etc/passwd',
  ]) {
    const out = pitchLink.verify(bad);
    assert.equal(out.ok, false, JSON.stringify(bad));
    assert.ok(!out.expired, `${JSON.stringify(bad)} was told it had expired`);
  }
});

test('A TAMPERED TOKEN IS REFUSED, however small the edit', () => {
  const token = pitchLink.mint();
  const [minted, nonce, sig] = token.split('.');

  // Each third altered on its own. Moving the clock forward is the interesting
  // one: the minting time is readable, so it has to be covered by the signature
  // or a link would extend its own life.
  const forward = Number(Date.now() + 60 * MINUTE).toString(36);

  for (const forged of [
    `${forward}.${nonce}.${sig}`,
    `${minted}.${'0'.repeat(nonce.length)}.${sig}`,
    // FLIPPED, NOT SET. This read `${sig.slice(0, -1)}0`, which is not a
    // forgery at all when the signature already ends in 0 - the "forged" token
    // is then byte-for-byte the real one and verify() rightly accepts it. The
    // signature is hex, so that was a one-in-sixteen red build for a year, and
    // it finally came up during an unrelated copy change.
    `${minted}.${nonce}.${sig.slice(0, -1)}${sig.slice(-1) === '0' ? '1' : '0'}`,
    `${minted}.${nonce}.${sig}extra`,
    `${minted}.${nonce}`,
  ]) {
    assert.equal(pitchLink.verify(forged).ok, false, forged);
  }
});

test('the signature is compared in constant time', () => {
  // Otherwise it can be guessed a character at a time, which is the whole
  // reason bags.js does the same thing for sticker codes.
  const src = SRC('core', 'pitch-link.js');
  assert.match(src, /timingSafeEqual/);
});

test('and it is keyed separately from everything else the admin key signs', () => {
  // One secret, separate keys - the rule customer sessions and bag stickers
  // already follow - so a token minted here can never be replayed as another.
  const src = SRC('core', 'pitch-link.js');
  assert.match(src, /lyndry\.partner\.pitch/);
  assert.ok(!/createHmac\('sha256', config\.adminApiKey\)[\s\S]{0,40}update\(`/.test(src));
});

// --- the page is not part of the website ------------------------------------

test('THERE IS NO BARE PATH THAT RENDERS THE PITCH', () => {
  const src = SRC('routes', 'web.js');

  // Out of PAGES, so it cannot be rendered by the generic page route and
  // cannot appear in the sitemap, which reads the same list.
  const pages = src.slice(src.indexOf('const PAGES'), src.indexOf('const LOCATIONS_HUB'));
  assert.ok(!/'\/for-laundromats'/.test(pages), 'the page is still in PAGES');

  // And the bare path is a redirect, not a render.
  assert.match(src, /router\.get\('\/for-laundromats', \(req, res\) => res\.redirect/);
});

test('THE PITCH IS ONLY SENT BEHIND A VERIFIED TOKEN', () => {
  const src = SRC('routes', 'web.js');
  const at = src.indexOf("router.get('/for-laundromats/:token'");
  assert.notEqual(at, -1, 'the token route has moved');

  const end = src.indexOf("router.get('/for-laundromats',", at);
  const body = src.slice(at, end);

  const verified = body.indexOf('pitchLink.verify');
  const rendered = body.indexOf('for-laundromats.html');

  assert.ok(verified > -1 && rendered > -1);
  assert.ok(verified < rendered, 'the page is read before the token is checked');
  assert.match(body, /noindex: true/);
});

test('NOTHING IN THE SITE OR THE OPS SCREENS LINKS TO IT', () => {
  // Neil: the link can only be texted. A link on a page is a link that outlives
  // the tab it was drawn in, and a menu entry is one that never expires at all.
  const root = path.join(__dirname, '..');
  const files = [
    path.join(root, 'src', 'routes', 'admin.js'),
    path.join(root, 'src', 'web', 'partners-page.js'),
    path.join(root, 'src', 'web', 'layout.js'),
    path.join(root, 'public', 'pages', 'partners.html'),
  ];

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const links = src.match(/href="[^"]*for-laundromats[^"]*"/g) || [];
    assert.deepEqual(links, [], `${path.basename(file)} links to the pitch page`);
  }
});

test('THE ONLY THING THAT MAKES A WORKING URL IS THE TEXT', () => {
  const src = SRC('routes', 'admin.js');
  assert.match(src, /pitchLink\.urlFor\(\)/, 'the send does not mint a link');

  // The old hardcoded address is gone from the message, or every text would
  // carry a URL that no longer renders anything.
  assert.ok(
    !/baseUrl\}\/for-laundromats/.test(src),
    'the send still texts the bare, ungated address'
  );
});

test('and the link is on our own domain, never a shortener', () => {
  // Carriers score a texted link partly by its domain. Same rule as /pay and
  // the delivery photos.
  assert.match(pitchLink.urlFor(), new RegExp(`^${config.baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/for-laundromats/`));
});

// --- no table, and nothing to clean up --------------------------------------

test('nothing is stored, so there is nothing to sweep', () => {
  // The token carries its own minting time, covered by the signature. The
  // message itself is already in `messages`, which is the record of what was
  // sent and to whom - a row here would be a second copy of that.
  const src = SRC('core', 'pitch-link.js');
  assert.ok(!/require\('\.\.\/db'\)/.test(src), 'pitch-link.js reached for the database');
});

test('and nothing here sends a text either', () => {
  // It mints a URL. The caller decides who gets it, through notify.sendAndLog
  // like every other outbound.
  const src = SRC('core', 'pitch-link.js');
  assert.ok(!/sendAndLog|notify/.test(src));
});
