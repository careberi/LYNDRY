'use strict';

const crypto = require('crypto');

const db = require('../db');
const sms = require('../providers/sms');
const { config } = require('../config');
const { normalisePhone } = require('./phone');

// ---------------------------------------------------------------------------
// How a customer signs in to book on the website.
//
// The same mechanism as staff: your mobile number, and a six-digit code we
// text you. No password, because a password is a thing to forget and a thing
// to leak, and the whole service already runs on the assumption that the
// person holding that phone is the customer.
//
// This is deliberately NOT the "customer account login" the build plan rules
// out. There is no password, no profile to manage, and nothing to remember —
// it is the text-message model with a web page attached.
//
// Kept separate from src/core/admin-auth.js on purpose. Sharing one module
// would mean one bug could hand a customer a staff session, and the rules
// genuinely differ: staff have roles, customers have consent records.
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'ly_cust';

// Shorter than the 30-day staff session. A customer's phone is more likely to
// be shared or handed around, and signing in again is one text.
const SESSION_DAYS = 14;

const CODE_TTL_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;

// A separate signing key, derived from the admin key rather than being it.
// Even if the payload formats ever collided, a customer cookie could not be
// replayed as a staff one — they are signed with different key material.
function signingKey() {
  return crypto.createHmac('sha256', config.adminApiKey).update('lyndry.customer.sessions').digest();
}

function hasKey() {
  return Boolean(config.adminApiKey);
}

function sameSecret(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hmac(value) {
  return crypto.createHmac('sha256', signingKey()).update(String(value)).digest('hex');
}

// --- The session cookie -----------------------------------------------------

function readSession(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) return null;

  const [customerId, expiresAt, signature] = parts;

  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;

  if (!sameSecret(signature, hmac(`cust.${customerId}.${expiresAt}`))) return null;

  return customerId;
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

function setSessionCookie(res, customerId) {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const value = `${customerId}.${expiresAt}.${hmac(`cust.${customerId}.${expiresAt}`)}`;

  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.env === 'production',
    path: '/account',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/account' });
}

// --- Throttling -------------------------------------------------------------

const buckets = new Map();

function hit(key, limit, windowMs) {
  const now = Date.now();
  const record = buckets.get(key);

  if (!record || now > record.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  record.count += 1;
  return record.count > limit;
}

function clearBucket(key) {
  buckets.delete(key);
}

// --- Sending a code ---------------------------------------------------------

// Resolves the same whether or not that number belongs to a customer. THE
// CALLER MUST NOT SAY WHICH — the sign-in page would otherwise be a way to
// check whether a given phone number is one of our customers.
async function requestCode(rawPhone, req) {
  const phone = normalisePhone(rawPhone);
  if (!phone) return { ok: false, reason: 'invalid' };

  if (hit(`cust:code:phone:${phone}`, 5, 15 * 60 * 1000)) return { ok: false, reason: 'throttled' };
  if (hit(`cust:code:ip:${req.ip}`, 15, 15 * 60 * 1000)) return { ok: false, reason: 'throttled' };

  const { data: customer, error } = await db
    .from('customers')
    .select('id, name, phone, status')
    .eq('phone', phone)
    .maybeSingle();

  if (error) throw error;

  // Not a customer, or opted out. Say nothing different.
  //
  // An opted-out customer is refused deliberately: they told us to stop
  // texting, and a sign-in code is a text.
  if (!customer || customer.status !== 'ACTIVE') {
    console.warn(`Customer sign-in requested for a number that cannot sign in: ${phone}`);
    return { ok: true, phone };
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

  const { error: insertError } = await db.from('customer_login_codes').insert({
    customer_id: customer.id,
    code_hash: hmac(`code.${customer.id}.${code}`),
    expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
    requested_ip: req.ip,
  });

  if (insertError) throw insertError;

  try {
    await sms.sendMessage({
      to: phone,
      text: `${code} is your LYNDRY code. It expires in ${CODE_TTL_MINUTES} minutes.`,
      // Blank unless a short code or second number is configured.
      from: config.telnyx.codeNumber || undefined,
    });
  } catch (err) {
    // Unlike the staff sign-in, a customer's code is NOT written to the log as
    // a fallback. Staff can read the server log; a customer cannot, so it
    // would be a credential sitting in a log for no one's benefit.
    console.error(`Could not text a customer sign-in code to ${phone}: ${err.message}`);
  }

  return { ok: true, phone };
}

// --- Checking a code --------------------------------------------------------

async function verifyCode(rawPhone, rawCode, req) {
  const phone = normalisePhone(rawPhone);
  const code = String(rawCode || '').replace(/\D/g, '');

  if (!phone || code.length !== 6) return { ok: false, reason: 'bad' };
  if (hit(`cust:verify:ip:${req.ip}`, 20, 15 * 60 * 1000)) return { ok: false, reason: 'throttled' };

  const { data: customer } = await db
    .from('customers')
    .select('id, name, status')
    .eq('phone', phone)
    .maybeSingle();

  if (!customer || customer.status !== 'ACTIVE') return { ok: false, reason: 'bad' };

  const { data: rows } = await db
    .from('customer_login_codes')
    .select('id, code_hash, attempts')
    .eq('customer_id', customer.id)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  const record = (rows || [])[0];
  if (!record || record.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: 'bad' };

  if (!sameSecret(hmac(`code.${customer.id}.${code}`), record.code_hash)) {
    await db
      .from('customer_login_codes')
      .update({ attempts: record.attempts + 1 })
      .eq('id', record.id);
    return { ok: false, reason: 'bad' };
  }

  await db
    .from('customer_login_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', record.id);

  clearBucket(`cust:verify:ip:${req.ip}`);
  clearBucket(`cust:code:phone:${phone}`);

  return { ok: true, customer };
}

// --- The check routes use ---------------------------------------------------

// Loads the signed-in customer onto the request, or sends them to sign in.
async function requireCustomer(req, res, next) {
  if (!hasKey()) {
    return res.status(503).type('text/plain').send('The server is not configured for sign-in.');
  }

  const customerId = readSession(readCookie(req, COOKIE_NAME));

  if (!customerId) {
    const wanted = encodeURIComponent(req.originalUrl);
    return res.redirect(302, `/account/login?next=${wanted}`);
  }

  try {
    // Re-read every request rather than trusting the cookie. Somebody who
    // texts STOP has opted out, and that must take effect here immediately.
    const { data: customer } = await db
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .maybeSingle();

    if (!customer || customer.status !== 'ACTIVE') {
      clearSessionCookie(res);
      return res.redirect(302, '/account/login');
    }

    req.customer = customer;
    return next();
  } catch (err) {
    return next(err);
  }
}

function isSignedIn(req) {
  return hasKey() && Boolean(readSession(readCookie(req, COOKIE_NAME)));
}

module.exports = {
  COOKIE_NAME,
  CODE_TTL_MINUTES,
  requestCode,
  verifyCode,
  requireCustomer,
  isSignedIn,
  setSessionCookie,
  clearSessionCookie,
};
