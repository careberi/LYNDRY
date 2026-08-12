'use strict';

const crypto = require('crypto');

const db = require('../db');
const sms = require('../providers/sms');
const { config } = require('../config');
const { normalisePhone } = require('./phone');

// ---------------------------------------------------------------------------
// Who is allowed into /ops.
//
// TWO DIFFERENT CREDENTIALS, for two different callers:
//
//   People    sign in with their mobile number and a six-digit code we text
//             them. One row per person in ops_users, so a driver who leaves is
//             switched off without disturbing anyone else, and every session
//             belongs to somebody.
//
//   Machines  send ADMIN_API_KEY in an x-admin-key header. That is the driver
//             script and anything else calling the /ops JSON API. A script
//             cannot receive a text.
//
// The session cookie is not a credential in itself. It says "user <id> proved
// who they were, and this is good until <date>", signed with ADMIN_API_KEY.
// A leaked cookie expires on its own; rotating ADMIN_API_KEY invalidates every
// session ever issued, which is the emergency sign-everyone-out lever.
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'ly_ops';

// Long enough that a driver isn't signing in mid-round, short enough that a
// lost phone stops working on its own.
const SESSION_DAYS = 30;

// Codes are short-lived on purpose. One sitting valid for an hour is one
// someone can read off a lock screen long after it was needed.
const CODE_TTL_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;

function hasKey() {
  return Boolean(config.adminApiKey);
}

// Compare in constant time. A plain === leaks how much of a secret was correct
// through how long the comparison took, which is enough to guess it one
// character at a time.
function sameSecret(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hmac(value) {
  return crypto.createHmac('sha256', config.adminApiKey).update(String(value)).digest('hex');
}

// --- The session cookie -----------------------------------------------------

function issueSession(userId) {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${userId}.${expiresAt}`;
  return { value: `${payload}.${hmac(`ops.${payload}`)}`, maxAgeMs: SESSION_DAYS * 24 * 60 * 60 * 1000 };
}

// Returns the user id the cookie vouches for, or null.
function readSession(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) return null;

  const [userId, expiresAt, signature] = parts;

  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;

  if (!sameSecret(signature, hmac(`ops.${userId}.${expiresAt}`))) return null;

  return userId;
}

// Express doesn't parse cookies on its own and this is the only cookie the app
// has, so a few lines here beats another dependency.
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

function setSessionCookie(res, userId) {
  const { value, maxAgeMs } = issueSession(userId);

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

// --- Throttling -------------------------------------------------------------
//
// Moved to src/core/throttle.js when the home page started sending texts too.
// Both are public and both cost money when abused, so they share one
// implementation rather than each keeping a copy that could drift.

const { hit, clearBucket } = require('./throttle');

// --- Sending a code ---------------------------------------------------------

// Always resolves to the same shape whether or not the number belongs to
// anyone. THE CALLER MUST NOT TELL THE VISITOR WHICH IT WAS — otherwise
// /ops/login becomes a way to find out who works here.
async function requestCode(rawPhone, req) {
  const phone = normalisePhone(rawPhone);
  if (!phone) return { ok: false, reason: 'invalid' };

  // Two limits: one stops a single number being spammed with texts, the other
  // stops one machine walking through many numbers.
  if (hit(`code:phone:${phone}`, 5, 15 * 60 * 1000)) return { ok: false, reason: 'throttled' };
  if (hit(`code:ip:${req.ip}`, 15, 15 * 60 * 1000)) return { ok: false, reason: 'throttled' };

  const { data: user, error } = await db
    .from('ops_users')
    .select('id, name, phone, status, role')
    .eq('phone', phone)
    .maybeSingle();

  if (error) throw error;

  // Nobody, or somebody switched off. Say nothing different to the visitor.
  if (!user || user.status !== 'ACTIVE') {
    console.warn(`Ops sign-in requested for a number that cannot sign in: ${phone}`);
    return { ok: true, phone };
  }

  // Six digits, from a cryptographic source. Math.random() is predictable
  // enough that it has no business generating a credential.
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

  const { error: insertError } = await db.from('ops_login_codes').insert({
    ops_user_id: user.id,
    // The code itself is never stored. See the migration.
    code_hash: hmac(`code.${user.id}.${code}`),
    expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
    requested_ip: req.ip,
  });

  if (insertError) throw insertError;

  const text = `${code} is your LYNDRY sign-in code. It expires in ${CODE_TTL_MINUTES} minutes.`;

  try {
    await sms.sendMessage({
      to: phone,
      text,
      // Blank unless a short code or second number is configured.
      from: config.telnyx.codeNumber || undefined,
    });
  } catch (err) {
    // Texting is not working yet — carrier registration is still pending — so
    // without this the dashboard would be unreachable. The code goes to the
    // server log ONLY when the send failed, so it can be read from the hosting
    // dashboard as a way back in. Nothing is written to the messages table:
    // a live credential does not belong in a database row.
    console.error(`Could not text an ops sign-in code to ${phone}: ${err.message}`);
    console.error(`  Sign-in code for ${user.name}: ${code}  (valid ${CODE_TTL_MINUTES} minutes)`);
  }

  return { ok: true, phone };
}

// --- Checking a code --------------------------------------------------------

async function verifyCode(rawPhone, rawCode, req) {
  const phone = normalisePhone(rawPhone);
  const code = String(rawCode || '').replace(/\D/g, '');

  if (!phone || code.length !== 6) return { ok: false, reason: 'bad' };

  if (hit(`verify:ip:${req.ip}`, 20, 15 * 60 * 1000)) return { ok: false, reason: 'throttled' };

  const { data: user } = await db
    .from('ops_users')
    .select('id, name, status')
    .eq('phone', phone)
    .maybeSingle();

  if (!user || user.status !== 'ACTIVE') return { ok: false, reason: 'bad' };

  // The most recent code for this person that is still alive.
  const { data: rows } = await db
    .from('ops_login_codes')
    .select('id, code_hash, expires_at, attempts, consumed_at')
    .eq('ops_user_id', user.id)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  const record = (rows || [])[0];
  if (!record) return { ok: false, reason: 'bad' };

  if (record.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: 'bad' };

  if (!sameSecret(hmac(`code.${user.id}.${code}`), record.code_hash)) {
    // Count the miss. Enough of them and this code is dead regardless of its
    // expiry, which is what stops someone working through all million.
    await db
      .from('ops_login_codes')
      .update({ attempts: record.attempts + 1 })
      .eq('id', record.id);
    return { ok: false, reason: 'bad' };
  }

  // Burn it. A code works exactly once.
  await db
    .from('ops_login_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', record.id);

  await db
    .from('ops_users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', user.id);

  clearBucket(`verify:ip:${req.ip}`);
  clearBucket(`code:phone:${phone}`);

  return { ok: true, user };
}

// --- The checks routes use --------------------------------------------------

// The machine credential. Scripts only.
function hasApiKey(req) {
  return hasKey() && sameSecret(req.get('x-admin-key'), config.adminApiKey);
}

function sessionUserId(req) {
  if (!hasKey()) return null;
  return readSession(readCookie(req, COOKIE_NAME));
}

function isAuthed(req) {
  return hasApiKey(req) || Boolean(sessionUserId(req));
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

// For the browser screens: send them to sign in, remembering where they were
// headed, and hang the signed-in person off the request so pages can use it.
async function requireAdminPage(req, res, next) {
  if (!hasKey()) {
    return res.status(503).type('text/plain').send('ADMIN_API_KEY is not set on the server.');
  }

  const userId = sessionUserId(req);

  if (!userId) {
    const wanted = encodeURIComponent(req.originalUrl);
    return res.redirect(302, `/ops/login?next=${wanted}`);
  }

  try {
    // Checked on every request, not just at sign-in. Switching someone off has
    // to take effect immediately, not in thirty days when their cookie lapses.
    const { data: user } = await db
      .from('ops_users')
      .select('id, name, phone, status, role')
      .eq('id', userId)
      .maybeSingle();

    if (!user || user.status !== 'ACTIVE') {
      clearSessionCookie(res);
      return res.redirect(302, '/ops/login');
    }

    req.opsUser = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  COOKIE_NAME,
  CODE_TTL_MINUTES,
  hasKey,
  sameSecret,
  isAuthed,
  requireAdminApi,
  requireAdminPage,
  requestCode,
  verifyCode,
  setSessionCookie,
  clearSessionCookie,
};
