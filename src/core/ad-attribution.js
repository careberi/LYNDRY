'use strict';

const db = require('../db');

// ---------------------------------------------------------------------------
// GOOGLE ADS: WHICH CLICK A CUSTOMER CAME FROM, AND COUNTING A LEAD ONCE.
//
// Neil, 10 September, with two Google Search campaigns live. Two jobs, both
// small, both here so the three website forms that create customers do them
// the same way:
//
//   1. Remember the ad click. Google puts gclid (or gbraid/wbraid on restricted
//      iOS traffic) on the landing URL. It is kept in a first-party cookie for
//      90 days and written onto the customer when a website form creates them,
//      so a booked first pickup can later be uploaded to Google against the
//      click that found them. See migration 0085.
//
//   2. Count a lead exactly once, on a real save, with a real id. The page
//      after a form reads a one-shot marker and fires the conversion.
//
// WHY A MARKER COOKIE RATHER THAN THE FORM'S OWN SUCCESS HANDLER, which is what
// the brief asked for. Neither of the two forms it named has one to hook:
//
//   - the home page form is a plain HTML POST with no script, and it answers
//     every outcome - a new number, an existing customer, a throttled one, a
//     bot caught by the honeypot - with the same redirect, so nobody can use it
//     to find out who is a customer;
//   - /bergen/join does run a script, but it answers {ok: true} to all of those
//     too, for the same reason, and to stop a bot learning it was caught.
//
// So the success signal cannot come back to the browser without undoing that.
// The server, which is the only thing that knows a customer was actually
// created, sets a marker only then; the next page takes it and fires. A bot, a
// refused number and an existing customer get the identical redirect and no
// marker. JavaScript on the page cannot read it, because it is httpOnly.
// ---------------------------------------------------------------------------

// --- 1. The ad click --------------------------------------------------------

const CLICK_COOKIE = 'ly_adclick';
const CLICK_DAYS = 90;
const CLICK_KEYS = Object.freeze(['gclid', 'gbraid', 'wbraid']);

// Google's click ids are URL-safe tokens. Anything else is not one of theirs,
// and is not going into a cookie header or a database row on faith.
const CLICK_ID = /^[A-Za-z0-9_-]{1,200}$/;

function clickIdsFrom(source) {
  const out = {};
  for (const key of CLICK_KEYS) {
    const value = source && source[key] != null ? String(source[key]).trim() : '';
    if (CLICK_ID.test(value)) out[key] = value;
  }
  return out;
}

// Middleware. A GET that lands with a click id in its URL has the cookie set.
//
// SERVER-SIDE, so it works with scripts blocked and on the first byte of the
// page rather than after a tag has loaded. A NEW CLICK REPLACES THE OLD ONE
// WHOLESALE - a click carries a gclid or a gbraid/wbraid, never a mix, so
// keeping last month's gclid beside this week's wbraid would pair two clicks
// that have nothing to do with each other.
function captureAdClick(req, res, next) {
  if (req.method === 'GET' && req.query) {
    const ids = clickIdsFrom(req.query);
    if (Object.keys(ids).length) {
      res.cookie(CLICK_COOKIE, JSON.stringify(ids), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: CLICK_DAYS * 24 * 60 * 60 * 1000,
      });
    }
  }
  next();
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}

function readAdClick(req) {
  const raw = readCookie(req, CLICK_COOKIE);
  if (!raw) return {};
  try {
    return clickIdsFrom(JSON.parse(raw));
  } catch (e) {
    return {};
  }
}

// Put the click on a customer the website just created.
//
// FIRST TOUCH: only columns that are still empty are written, so a customer who
// comes back through a second ad is still credited to the click that brought
// them in. NEVER BREAKS A SIGNUP - attribution failing must not fail the thing
// it is attributing, exactly as the utm write beside it already works.
async function recordAdClick(req, customerId) {
  if (!customerId) return;
  const ids = readAdClick(req);
  if (!Object.keys(ids).length) return;

  try {
    const { data: row } = await db
      .from('customers')
      .select('gclid, gbraid, wbraid')
      .eq('id', customerId)
      .maybeSingle();
    if (!row) return;

    const fill = {};
    for (const key of CLICK_KEYS) {
      if (ids[key] && !row[key]) fill[key] = ids[key];
    }
    if (!Object.keys(fill).length) return;

    const { error } = await db.from('customers').update(fill).eq('id', customerId);
    if (error) throw error;
  } catch (err) {
    console.error(`Could not record the ad click on customer ${customerId}: ${err.message}`);
  }
}

// --- 2. Counting a lead once ----------------------------------------------

const LEAD_COOKIE = 'ly_conv';

// A customer or order id is a UUID. It is written into a <script> on the next
// page, so nothing else is allowed through.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Set on the response that confirms a real save. Scoped to the one page that
// reads it and gone in two minutes: the redirect is immediate, so a marker
// still around after that is stale and must not fire later.
function markLead(res, id, path) {
  if (!UUID.test(String(id || ''))) return;
  res.cookie(LEAD_COOKIE, String(id), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path,
    maxAge: 2 * 60 * 1000,
  });
}

// Read by that page, and deleted as it is read, so a refresh or the Back
// button cannot count the same lead twice. Returns the id to use as Google's
// transaction_id, or null. The transaction id is a second guard against double
// counting: Google discards a repeat of the same one.
function takeLead(req, res, path) {
  const id = readCookie(req, LEAD_COOKIE);
  if (!id) return null;
  res.clearCookie(LEAD_COOKIE, { path });
  return UUID.test(id) ? id : null;
}

module.exports = {
  captureAdClick,
  readAdClick,
  recordAdClick,
  clickIdsFrom,
  markLead,
  takeLead,
  CLICK_COOKIE,
  LEAD_COOKIE,
  CLICK_KEYS,
};
