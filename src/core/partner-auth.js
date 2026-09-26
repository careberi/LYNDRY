'use strict';

const crypto = require('crypto');

const db = require('../db');
const sms = require('../providers/sms');
const { config } = require('../config');
const { normalisePhone } = require('./phone');
const { hit, clearBucket } = require('./throttle');

// ---------------------------------------------------------------------------
// Who is allowed into the laundromat portal.
//
// Neil's ask, 25 September: an attendant signs in, sees the orders at HER store,
// enters the weight of every bag, and then tells the courier to come and get it.
//
// A THIRD SIGN-IN, AND DELIBERATELY NOT EITHER OF THE OTHER TWO. `admin-auth.js`
// hands out sessions that reach the books; `customer-auth.js` hands out sessions
// that reach one person's own orders. An attendant is neither, and the reason
// those two are separate files in the first place is that one bug must never be
// able to hand out the wrong kind of session. This is the same argument a third
// time, so it is the same answer.
//
// THE SHAPE IS COPIED FROM `admin-auth.js` ON PURPOSE, down to the constant-time
// compares, the HMAC'd codes, the one-live-session token and the sliding expiry.
// Everything that is different is different for a stated reason and marked.
//
// WHAT IS DIFFERENT:
//
//   the cookie      scoped to /shop, and its signature is salted 'shop.' so a
//                   cookie from one portal cannot be replayed at another
//   the session     EIGHT HOURS of inactivity, not one. See SESSION_MINUTES
//   what it proves  which PARTNER, not which role. There are no roles here:
//                   every attendant can do everything at their own shop, and
//                   the only question a portal request asks is which shop
//   no machine key  there is no x-admin-key equivalent and there must not be.
//                   A laundromat has no scripts, and a second credential that
//                   reached the portal would reach every shop at once
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'ly_shop';

// EIGHT HOURS OF DOING NOTHING, against the ops screens' one.
//
// It is the same sliding-window mechanism and a different number, because the
// device is different. An ops session lives on Neil's phone and holds customer
// addresses and the books; a portal session lives on a tablet behind a counter
// and holds order numbers, wash instructions and weights. Signing that tablet
// out every hour means an attendant with laundry in her hands waiting on a text
// message, and what she would actually do is write the code on the wall.
//
// A SHIFT IS THE HONEST UNIT. Eight hours covers one and does not survive to the
// next, so a tablet found in the morning is signed out.
const SESSION_MINUTES = 8 * 60;
const SESSION_MS = SESSION_MINUTES * 60 * 1000;

// Five minutes and five guesses, matching both other sign-ins. Two different
// lifetimes on two sign-ins is a thing somebody has to go and look up, and this
// is now the third.
const CODE_TTL_MINUTES = 5;
const MAX_CODE_ATTEMPTS = 5;

// Compare in constant time. A plain === leaks how much of a secret was correct
// through how long the comparison took.
function sameSecret(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// KEYED WITH ADMIN_API_KEY UNDER ITS OWN LABEL, the same trick `pitch-link.js`
// uses. One secret to rotate, and a value signed for one purpose can never be
// presented as a value signed for another - so a portal cookie cannot become a
// staff cookie even though both are signed with the same key.
function hmac(value) {
  return crypto.createHmac('sha256', config.adminApiKey).update(`shop.${value}`).digest('hex');
}

// --- The session cookie -----------------------------------------------------

function newSessionToken() {
  return crypto.randomBytes(18).toString('hex');
}

function issueSession(userId, token) {
  const expiresAt = Date.now() + SESSION_MS;
  const payload = `${userId}.${expiresAt}.${token}`;
  return { value: `${payload}.${hmac(payload)}`, maxAgeMs: SESSION_MS };
}

// Returns { userId, token } the cookie vouches for, or null.
//
// This proves the cookie is OURS and still in date. It cannot prove the token is
// the live one or that the attendant is still employed - those are rows, and
// `requirePartner` does that half where it is loading the person anyway.
function readSession(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 4) return null;

  const [userId, expiresAt, token, signature] = parts;

  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;

  if (!sameSecret(signature, hmac(`${userId}.${expiresAt}.${token}`))) return null;

  return { userId, token };
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }

  return null;
}

function setSessionCookie(res, userId, token) {
  const { value, maxAgeMs } = issueSession(userId, token);

  res.cookie(COOKIE_NAME, value, {
    httpOnly: true, // JavaScript on the page can never read it
    sameSite: 'strict', // never sent from another site's page
    secure: config.env === 'production',

    // SCOPED TO /shop, so it is not sent to the marketing site, to /ops or to
    // /account. A cookie is offered to every path under its own, and no more.
    path: '/shop',
    maxAge: maxAgeMs,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/shop' });
}

// --- Sending a code ---------------------------------------------------------

const codeSender = require('./code-sender').createCodeSender({
  delayMs: config.signIn.codeDelayMs,
  send: (phone, text) =>
    sms.sendMessage({
      to: phone,
      text,
      from: config.telnyx.codeNumber || undefined,
    }),
});

// Always resolves to the same shape whether or not the number belongs to
// anybody.
//
// THE CALLER MUST NOT TELL THE VISITOR WHICH IT WAS. The rule `/ops/login`
// already follows, and here it protects a third party: otherwise this page is a
// way to find out who works at a laundromat we deal with.
async function requestCode(rawPhone, req) {
  const phone = normalisePhone(rawPhone);
  if (!phone) return { ok: false, reason: 'invalid' };

  if (hit(`shopcode:phone:${phone}`, 5, 15 * 60 * 1000)) return { ok: false, reason: 'throttled' };
  if (hit(`shopcode:ip:${req.ip}`, 15, 15 * 60 * 1000)) return { ok: false, reason: 'throttled' };

  const { data: user, error } = await db
    .from('partner_users')
    .select('id, name, phone, status, partner_id')
    .eq('phone', phone)
    .maybeSingle();

  if (error) throw error;

  // Nobody, or somebody switched off. Say nothing different to the visitor.
  if (!user || user.status !== 'ACTIVE') {
    console.warn(`Laundromat sign-in requested for a number that cannot sign in: ${phone}`);
    return { ok: true, phone };
  }

  // Six digits, from a cryptographic source. Math.random() is predictable
  // enough that it has no business generating a credential.
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

  const { error: insertError } = await db.from('partner_login_codes').insert({
    partner_user_id: user.id,
    code_hash: hmac(`code.${user.id}.${code}`),
    expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
    requested_ip: req.ip,
  });

  if (insertError) throw insertError;

  const text = `${code} is your LYNDRY sign-in code. It expires in ${CODE_TTL_MINUTES} minutes.`;

  codeSender.schedule(phone, text, (err) => {
    // THE CODE IS NOT WRITTEN TO THE LOG, and this is the one place that differs
    // from the staff sign-in on purpose.
    //
    // A staff code goes to the server log when texting fails, because the log is
    // Neil's way back into a dashboard nobody else can reach. An attendant
    // cannot read our server log, so writing hers there would be a live
    // credential sitting in a log for nobody's benefit - the exact reasoning
    // `customer-auth.js` already applies to a customer's code.
    //
    // If texting is down, Neil rings the shop. That is a person solving it,
    // which is the right answer for somebody else's employee.
    console.error(`Could not text a laundromat sign-in code to ${phone}: ${err.message}`);
  });

  return { ok: true, phone };
}

// The waiting sends, for shutdown() in src/index.js. A deploy inside the delay
// must still send the code the database already holds.
function flushPendingCodes() {
  return codeSender.flush();
}

// --- Checking a code --------------------------------------------------------

async function verifyCode(rawPhone, rawCode, req) {
  const phone = normalisePhone(rawPhone);
  const code = String(rawCode || '').replace(/\D/g, '');

  if (!phone || code.length !== 6) return { ok: false, reason: 'bad' };

  if (hit(`shopverify:ip:${req.ip}`, 20, 15 * 60 * 1000)) return { ok: false, reason: 'throttled' };

  const { data: user } = await db
    .from('partner_users')
    .select('id, name, status, partner_id')
    .eq('phone', phone)
    .maybeSingle();

  if (!user || user.status !== 'ACTIVE') return { ok: false, reason: 'bad' };

  // The most recent code for this person that is still alive.
  const { data: rows } = await db
    .from('partner_login_codes')
    .select('id, code_hash, expires_at, attempts, consumed_at')
    .eq('partner_user_id', user.id)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  const record = (rows || [])[0];
  if (!record) return { ok: false, reason: 'bad' };

  if (record.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: 'bad' };

  if (!sameSecret(hmac(`code.${user.id}.${code}`), record.code_hash)) {
    // Count the miss. Enough of them and this code is dead regardless of its
    // expiry, which is what stops somebody working through all million.
    await db
      .from('partner_login_codes')
      .update({ attempts: record.attempts + 1 })
      .eq('id', record.id);
    return { ok: false, reason: 'bad' };
  }

  // Burn it. A code works exactly once.
  await db
    .from('partner_login_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', record.id);

  // Minted here rather than by the caller, because this is the only place a
  // correct code has just been proved - and a caller that forgot would leave
  // every other device signed in, which is the whole thing this prevents.
  const token = newSessionToken();

  await db
    .from('partner_users')
    .update({
      last_login_at: new Date().toISOString(),
      session_token: token,
      session_started_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  clearBucket(`shopverify:ip:${req.ip}`);
  clearBucket(`shopcode:phone:${phone}`);

  return { ok: true, user, token };
}

// --- The guard --------------------------------------------------------------

// Every portal page and every portal action goes through this.
//
// IT RE-READS THE ROW EVERY REQUEST, like `requireAdminPage` does. An attendant
// who leaves is switched off and stops being able to do anything on her next tap,
// rather than at the end of an eight-hour session. It also re-reads the PARTNER,
// because a laundromat we stop working with must not keep a live portal.
async function requirePartner(req, res, next) {
  const signIn = (why) => {
    clearSessionCookie(res);
    const next = req.originalUrl && req.originalUrl.startsWith('/shop') ? req.originalUrl : null;

    // `?next=` ONLY EVER ACCEPTS A /shop PATH, the same rule `/ops/login`
    // follows. Without it the sign-in page is an open redirector on our own
    // domain, which is a ready-made phishing link.
    const params = new URLSearchParams();
    if (why) params.set('why', why);
    if (next && next !== '/shop') params.set('next', next);

    const query = params.toString();
    return res.redirect(303, `/shop/login${query ? `?${query}` : ''}`);
  };

  if (!config.adminApiKey) {
    // Nothing can be signed, so nothing can be verified. Refusing is the only
    // honest answer; accepting would mean a portal with no lock on it.
    console.error('ADMIN_API_KEY is not set, so the laundromat portal cannot verify a session.');
    return signIn(null);
  }

  const session = readSession(readCookie(req, COOKIE_NAME));
  if (!session) return signIn(null);

  const { data: user, error } = await db
    .from('partner_users')
    .select('id, name, phone, status, role, partner_id, session_token')
    .eq('id', session.userId)
    .maybeSingle();

  if (error) throw error;
  if (!user || user.status !== 'ACTIVE') return signIn(null);

  // ONE LIVE SESSION. A token that is not the current one means they signed in
  // somewhere else, and saying so matters: being thrown out of a screen you were
  // just using with no explanation is indistinguishable from the thing being
  // broken, and would be reported as a bug.
  if (!user.session_token || !sameSecret(session.token, user.session_token)) {
    return signIn('elsewhere');
  }

  const { data: partner, error: partnerError } = await db
    .from('partners')
    .select('id, name, slug, status, type, turnaround_minutes, address_line1, address_line2, city, state, postal_code, phone')
    .eq('id', user.partner_id)
    .maybeSingle();

  if (partnerError) throw partnerError;

  // A LAUNDROMAT WE NO LONGER WORK WITH HAS NO PORTAL. Checked here rather than
  // in each page, because a page that forgot would show live orders to a shop
  // that has been stood down.
  if (!partner || partner.status !== 'ACTIVE' || partner.type !== 'LAUNDROMAT') {
    return signIn('shop_closed');
  }

  // SLID AFTER THE CHECKS, NOT BEFORE, so somebody switched off does not get
  // their session quietly extended on the way to being refused.
  setSessionCookie(res, user.id, user.session_token);

  req.partnerUser = user;
  req.partner = partner;
  return next();
}

module.exports = {
  COOKIE_NAME,
  SESSION_MINUTES,
  CODE_TTL_MINUTES,
  MAX_CODE_ATTEMPTS,

  requestCode,
  verifyCode,
  flushPendingCodes,
  requirePartner,

  setSessionCookie,
  clearSessionCookie,

  // For the tests: the pure halves of the cookie, and nothing that writes.
  issueSession,
  readSession,
};
