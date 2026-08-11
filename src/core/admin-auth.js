'use strict';

const crypto = require('crypto');
const { config } = require('../config');

// ---------------------------------------------------------------------------
// Who is allowed into /ops.
//
// There are no accounts and no passwords — it is Neil and a driver, sharing
// one code. That code is ADMIN_API_KEY, the same secret the /ops API already
// uses. Two ways in:
//
//   x-admin-key header   scripts, and the driver simulator
//   ly_ops cookie        the browser, after signing in once
//
// THE COOKIE IS NOT THE KEY. It is a signed token that says "someone proved
// they knew the key, and this is good until <date>". If a cookie leaks, it
// expires on its own and the key itself was never in it. Changing
// ADMIN_API_KEY invalidates every cookie ever issued, which is the whole
// revocation story and is enough for two people.
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'ly_ops';

// Long enough that a driver isn't signing in mid-round, short enough that a
// lost phone stops working on its own.
const SESSION_DAYS = 30;

function hasKey() {
  return Boolean(config.adminApiKey);
}

// Compare in constant time. A plain === leaks how much of the secret was
// correct through how long the comparison took, which is enough to guess it
// one character at a time.
function sameSecret(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- The session cookie -----------------------------------------------------

function sign(expiresAt) {
  return crypto
    .createHmac('sha256', config.adminApiKey)
    .update(`ops.${expiresAt}`)
    .digest('hex');
}

function issueSession() {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  return { value: `${expiresAt}.${sign(expiresAt)}`, maxAgeMs: SESSION_DAYS * 24 * 60 * 60 * 1000 };
}

function verifySession(value) {
  const [expiresAt, signature] = String(value || '').split('.');
  if (!expiresAt || !signature) return false;

  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  return sameSecret(signature, sign(expiresAt));
}

// Express doesn't parse cookies on its own and this is the only cookie the
// app has, so a few lines here beats another dependency.
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

function setSessionCookie(res) {
  const { value, maxAgeMs } = issueSession();

  res.cookie(COOKIE_NAME, value, {
    httpOnly: true, // JavaScript on the page can never read it
    sameSite: 'strict', // never sent from another site's page
    secure: config.env === 'production', // HTTPS only in production
    path: '/ops',
    maxAge: maxAgeMs,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/ops' });
}

// --- Login throttle ---------------------------------------------------------
//
// A public sign-in page protected by one shared secret will get probed. This
// is a deliberately simple in-memory counter — it resets when the server
// restarts and it is per-instance, which is fine for one small server and is
// far better than nothing. If this ever runs on more than one instance, it
// needs to move into the database.

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map();

function throttleKey(req) {
  return req.ip || 'unknown';
}

function tooManyAttempts(req) {
  const record = attempts.get(throttleKey(req));
  if (!record) return false;
  if (Date.now() > record.resetAt) {
    attempts.delete(throttleKey(req));
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function recordFailure(req) {
  const key = throttleKey(req);
  const record = attempts.get(key);

  if (!record || Date.now() > record.resetAt) {
    attempts.set(key, { count: 1, resetAt: Date.now() + ATTEMPT_WINDOW_MS });
    return;
  }

  record.count += 1;
}

function clearFailures(req) {
  attempts.delete(throttleKey(req));
}

// --- The checks routes use --------------------------------------------------

// True if this request is authenticated by either route.
function isAuthed(req) {
  if (!hasKey()) return false;
  if (sameSecret(req.get('x-admin-key'), config.adminApiKey)) return true;
  return verifySession(readCookie(req, COOKIE_NAME));
}

// For the JSON API: refuse with a status code.
function requireAdminApi(req, res, next) {
  if (!hasKey()) {
    console.error('ADMIN_API_KEY is not set — ops endpoints are refusing everything.');
    return res.status(503).json({ error: 'ops_not_configured' });
  }

  if (!isAuthed(req)) {
    console.warn('Rejected an ops request with a bad admin key.');
    return res.status(401).json({ error: 'unauthorized' });
  }

  return next();
}

// For the browser screens: send them to the sign-in page instead of a 401,
// remembering where they were headed.
function requireAdminPage(req, res, next) {
  if (!hasKey()) {
    return res.status(503).type('text/plain').send('ADMIN_API_KEY is not set on the server.');
  }

  if (!isAuthed(req)) {
    const wanted = encodeURIComponent(req.originalUrl);
    return res.redirect(302, `/ops/login?next=${wanted}`);
  }

  return next();
}

module.exports = {
  COOKIE_NAME,
  hasKey,
  sameSecret,
  isAuthed,
  requireAdminApi,
  requireAdminPage,
  setSessionCookie,
  clearSessionCookie,
  tooManyAttempts,
  recordFailure,
  clearFailures,
};
