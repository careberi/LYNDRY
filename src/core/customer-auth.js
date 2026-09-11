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

// FIVE MINUTES, DOWN FROM TEN. Neil's call. A sign-in code is used within
// seconds of arriving or not at all, so the other nine and a half minutes are
// only a window for somebody who picked up the phone.
const CODE_TTL_MINUTES = 5;
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

// SAMESITE=LAX, NOT STRICT, AND THE DIFFERENCE IS THE TRIP TO STRIPE.
//
// Neil, 11 September: somebody placed an order, typed their card into Stripe's
// page, and was sent back to the sign-in page instead of a confirmation. The
// cookie was Strict, and a Strict cookie is withheld on ANY arrival from
// another site - including Stripe sending the browser back to
// /account/card/done/<token>. So the page saw nobody signed in, at the one
// moment the customer had just proved who they were.
//
// Lax still withholds the cookie from another site's forms, images and frames,
// and every /account route that changes anything is a POST, so nothing another
// site can do moves an order or a card. What it adds is being signed in when a
// plain link or redirect brings you back to one of our pages. The staff cookie
// stays Strict: nothing ever sends a member of staff to /ops from another site.
//
// `expiresAt` is passed when re-issuing an existing session, so upgrading the
// attribute never extends how long a session lasts. See requireCustomer().
function setSessionCookie(res, customerId, expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000) {
  const value = `${customerId}.${expiresAt}.${hmac(`cust.${customerId}.${expiresAt}`)}`;

  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    path: '/account',
    maxAge: Math.max(0, expiresAt - Date.now()),
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/account' });
}

// ---------------------------------------------------------------------------
// THE GUEST COOKIE: a number we are part-way through taking an order for.
//
// Neil's flow. Somebody who is not a customer yet does not get a text - they
// place the order in the browser, and the account is created at the end, when
// they have given a name, an address and ticked the box. Until then there is no
// customer row, so there is nothing to sign in to and nothing to point a
// session at. This cookie is what carries them across those screens.
//
// IT IS SIGNED, and that is not ceremony. Without a signature anybody could set
// this cookie to somebody else's number and walk it through to the end, and the
// account created at the bottom would be in that person's name against their
// phone. The signature means the only numbers that reach the last step are ones
// this server put in the cookie itself.
//
// IT IS NOT A SESSION AND MUST NEVER BE TREATED AS ONE. It proves a number was
// typed into our form, nothing more - nobody has verified they hold that phone.
// So it may only ever do what a stranger may do: fill in an order that has not
// been placed. requireCustomer() does not look at it, and no page that shows
// somebody's orders, address or card may accept it.
// ---------------------------------------------------------------------------
const GUEST_COOKIE = 'ly_guest';

// Long enough to fill in an order without being hurried, short enough that a
// shared computer does not offer the next person a half-finished one.
const GUEST_MINUTES = 60;

function setGuestCookie(res, phone) {
  const expiresAt = Date.now() + GUEST_MINUTES * 60 * 1000;
  const value = `${phone}.${expiresAt}.${hmac(`guest.${phone}.${expiresAt}`)}`;

  res.cookie(GUEST_COOKIE, value, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.env === 'production',
    path: '/account',
    maxAge: GUEST_MINUTES * 60 * 1000,
  });
}

// The number, or null. Same shape as readSession() and just as strict.
function readGuest(req) {
  const parts = String(readCookie(req, GUEST_COOKIE) || '').split('.');
  if (parts.length !== 3) return null;

  const [phone, expiresAt, signature] = parts;

  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;

  if (!sameSecret(signature, hmac(`guest.${phone}.${expiresAt}`))) return null;

  return phone;
}

function clearGuestCookie(res) {
  res.clearCookie(GUEST_COOKIE, { path: '/account' });
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

// ---------------------------------------------------------------------------
// THE CODE IS WRITTEN NOW AND TEXTED IN A MOMENT. Neil's call.
//
// It used to be sent inside the request, which meant the sign-in form sat there
// waiting on the carrier before the page could even render. Handing the text to
// a timer answers the visitor immediately and lets the code follow.
//
// ONE PENDING SEND PER NUMBER, AND A SECOND REQUEST REPLACES THE FIRST. This is
// the part that makes the delay safe rather than a new bug. verifyCode() takes
// the NEWEST unconsumed code, so somebody tapping the button twice inside the
// window would otherwise be sent two texts of which only the second works - and
// the first one to arrive is the one they would try. Cancelling the pending
// send means exactly one text goes out per burst of taps, and it carries the
// code that will actually be accepted. Same shape as src/core/burst.js.
// ---------------------------------------------------------------------------

const SEND_DELAY_MS = Number(process.env.LOGIN_CODE_DELAY_MS ?? 10_000);

const pendingCodes = new Map();

async function deliver(phone, text) {
  pendingCodes.delete(phone);

  try {
    await sms.sendMessage({
      to: phone,
      text,
      // Blank unless a short code or second number is configured.
      from: config.telnyx.codeNumber || undefined,
    });
  } catch (err) {
    // Unlike the staff sign-in, a customer's code is NOT written to the log as
    // a fallback. Staff can read the server log; a customer cannot, so it would
    // be a credential sitting in a log for no one's benefit.
    console.error(`Could not text a customer sign-in code to ${phone}: ${err.message}`);
  }
}

function scheduleCode(phone, text) {
  const waiting = pendingCodes.get(phone);
  if (waiting) clearTimeout(waiting.timer);

  // Zero sends immediately, which is what the tests want and what to set if the
  // delay ever needs taking out in a hurry.
  if (SEND_DELAY_MS <= 0) return deliver(phone, text);

  const timer = setTimeout(() => {
    deliver(phone, text).catch(() => {});
  }, SEND_DELAY_MS);

  // Never hold the process open for a sign-in code. flushPendingCodes() below
  // is what makes a deploy inside the window safe; an un-unref'd timer would
  // only delay every shutdown by ten seconds.
  if (typeof timer.unref === 'function') timer.unref();

  pendingCodes.set(phone, { timer, text });
  return Promise.resolve();
}

// A DEPLOY INSIDE THE WINDOW MUST NOT SWALLOW A CODE. The row is already in the
// database, so without this somebody would wait for a text that was never sent
// and have to ask for another. Called from shutdown() in src/index.js, next to
// the burst flush and for the same reason.
async function flushPendingCodes() {
  const waiting = [...pendingCodes.entries()];
  pendingCodes.clear();

  for (const [, entry] of waiting) clearTimeout(entry.timer);

  await Promise.all(waiting.map(([phone, entry]) => deliver(phone, entry.text)));
}

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

  // THE CODE IS WRITTEN NOW AND TEXTED IN A MOMENT. See scheduleCode() above.
  scheduleCode(
    phone,
    `${code} is your LYNDRY code. It expires in ${CODE_TTL_MINUTES} minutes.`
  );

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
    // THE WHOLE ROW, NOT THREE COLUMNS. The caller decides where to send
    // somebody next from what is on their account - an address, wash
    // preferences, a card - and a partial select made every one of those look
    // missing, so a fully set-up customer was walked through setup again.
    .select('*')
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
// LOAD THE SESSION IF THERE IS ONE, AND DO NOTHING IF THERE IS NOT.
//
// requireCustomer() is a guard: no session and it redirects. This is the same
// lookup without the verdict, for the one page that serves both a customer and
// somebody who has no account yet - the order flow. That page decides for
// itself what to do about a visitor with neither.
//
// It sets req.customer or leaves it undefined. It never redirects, never sends
// a response, and applies the same rule requireCustomer() does: the row is
// re-read every time and an unsubscribed customer is not signed in.
async function attachCustomer(req) {
  if (!hasKey()) return null;

  const customerId = readSession(readCookie(req, COOKIE_NAME));
  if (!customerId) return null;

  const { data: customer } = await db
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();

  if (!customer || customer.status !== 'ACTIVE') return null;

  req.customer = customer;
  return customer;
}

async function requireCustomer(req, res, next) {
  if (!hasKey()) {
    return res.status(503).type('text/plain').send('The server is not configured for sign-in.');
  }

  const raw = readCookie(req, COOKIE_NAME);
  const customerId = readSession(raw);

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

    // RE-ISSUED AS LAX, WITH THE EXPIRY IT ALREADY HAD. A browser never tells
    // us a cookie's attributes, so a session signed in while the cookie was
    // Strict would stay Strict for up to fourteen days and keep bouncing that
    // customer to sign-in on the way back from Stripe. POST /account/card comes
    // through here right before the redirect to Stripe, so the cookie is Lax by
    // the time it matters. Same expiry, so this never lengthens a session.
    setSessionCookie(res, customer.id, Number(String(raw).split('.')[1]));

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
  SEND_DELAY_MS,
  requestCode,
  flushPendingCodes,
  verifyCode,
  requireCustomer,
  attachCustomer,
  isSignedIn,
  setSessionCookie,
  clearSessionCookie,
  setGuestCookie,
  readGuest,
  clearGuestCookie,
};
