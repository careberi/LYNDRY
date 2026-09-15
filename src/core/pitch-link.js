'use strict';

// ---------------------------------------------------------------------------
// THE LINK TO THE LAUNDROMAT PITCH, WHICH ONLY OPENS IF WE TEXTED IT.
//
// Neil, 14 September: /for-laundromats should not be public, a guessed URL
// should not show the pitch, and the link should only work for about five
// minutes after it is sent to a person.
//
// So the page moved out of the website entirely. There is no bare path that
// renders it, nothing links to it, and the only way one exists is
// /ops/partners texting it to a number somebody typed in.
//
// WHY A SIGNED TOKEN RATHER THAN A TABLE. Nothing here needs to be looked up
// afterwards: the link is minted, texted, opened within minutes and then dead.
// A row per send would be a table that only ever grows, to answer questions
// nobody is asking - and the message itself is already in `messages`, which is
// the record of what was sent and to whom. CLAUDE.md's rule about not storing a
// second copy of a fact applies to rows we would write as much as to columns.
//
// EVERY SEND IS ITS OWN LINK. The random half means two people texted a minute
// apart do not hold the same URL, so one forwarded link is one link rather than
// the key to the page.
//
// WHAT IT IS NOT. This is a gate on a sales page carrying no commercial terms -
// CLAUDE.md is emphatic that no rate ever appears on it. It is not protecting
// customer data, and it is not a login. The five minutes is what makes a leaked
// link worthless, which is why there is no revocation and does not need to be.
// ---------------------------------------------------------------------------

const crypto = require('node:crypto');
const { config } = require('../config');

// Derived from the admin key rather than being it, exactly as bags.js does for
// the sticker signatures and customer-auth.js does for customer sessions: one
// secret, separate keys, so a token minted here can never be replayed as
// anything else.
function signingKey() {
  return crypto.createHmac('sha256', config.adminApiKey).update('lyndry.partner.pitch').digest();
}

function sign(payload) {
  return crypto.createHmac('sha256', signingKey()).update(payload).digest('hex').slice(0, 24);
}

function lifetimeMs() {
  return Math.max(1, Number(config.partners.pitchLinkMinutes || 5)) * 60_000;
}

// `<minted>.<random>.<signature>`, all base36 or hex, so it survives a text
// message intact and has nothing in it a carrier will try to linkify oddly.
//
// THE MINTING TIME IS IN THE TOKEN, NOT IN A ROW. It has to be readable to be
// checked, and it is covered by the signature, so it can be read and cannot be
// edited - somebody moving their clock forward does not extend anything.
function mint(now = Date.now()) {
  const minted = Number(now).toString(36);
  const nonce = crypto.randomBytes(8).toString('hex');

  return `${minted}.${nonce}.${sign(`${minted}.${nonce}`)}`;
}

// THREE ANSWERS, AND THE THIRD IS WHY THEY ARE NOT TWO.
//
//   ok        we texted this, recently. Show the pitch
//   expired   we texted this, too long ago. Say so, and show nothing else
//   false     nobody was ever texted this. Say nothing at all
//
// Only somebody who genuinely held a real link is ever told "expired" - the
// signature has to check out before the clock is even looked at. A guessed URL
// cannot tell the difference between a page that exists and one that does not,
// which is what "a guessed URL should not show the pitch" means at the edges.
function verify(token, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false };

  const [minted, nonce, signature] = parts;
  const expected = sign(`${minted}.${nonce}`);

  // Constant time, so the signature cannot be guessed a character at a time.
  if (signature.length !== expected.length) return { ok: false };
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return { ok: false };

  const at = parseInt(minted, 36);
  if (!Number.isFinite(at)) return { ok: false };

  // A token minted in the future is not ours going wrong, it is a clock going
  // wrong - and either way it is not something to honour indefinitely.
  const age = now - at;
  if (age < 0 || age > lifetimeMs()) return { ok: false, expired: true };

  return { ok: true, ageMs: age };
}

// The whole URL, ready to go in a text. On lyndry.com, never a shortener, for
// the reason every other link we send is: carriers score a texted link partly
// by its domain, and a shortened one reads as a spam signal.
function urlFor(now = Date.now()) {
  return `${config.baseUrl}/for-laundromats/${mint(now)}`;
}

module.exports = { mint, verify, urlFor, lifetimeMs };
