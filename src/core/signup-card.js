'use strict';

const { config } = require('../config');

// ---------------------------------------------------------------------------
// ASKING FOR THE CARD WHILE THEY ARE STILL ON THE PAGE.
//
// Neil, 16 September, reading the real numbers: of 54 customers, six have a
// card on file and ALL SIX have ordered; forty five have no card and NONE of
// them has ordered. "Card on file is the whole funnel; everything upstream of
// it is noise."
//
// THIS REVERSES A DELIBERATE DECISION, and the old one is worth stating because
// it was not careless. /start/sent was written as a dead end on purpose - the
// note in the page file says "a page telling them to go and finish signing up
// somewhere else would undo the thing we just did", the thing being that
// everything happens in their messages app with no account and no password.
// That reasoning is still true about ACCOUNTS. It turned out not to be true
// about the card, because the card is not a signup step - it is the only thing
// that predicts whether somebody ever becomes a customer.
//
// SO THE TEXT HANDOFF IS UNCHANGED. The welcome still goes out, the thread is
// still where the pickup gets booked, and the page still leads with the number
// we text from. The card is offered underneath it, and skipping it costs
// nothing that was not already lost.
//
// WHY A COOKIE AND NOT A TOKEN IN THE URL. The button has to know which
// customer, and a customer id or a Stripe token on the address bar is exactly
// what CLAUDE.md refuses - it lands in history, in the Referer header, and in
// anything sitting in front of the site. This marker is httpOnly, so no script
// can read it, SameSite=Strict so it is never sent from another site, and
// scoped to the two paths that use it.
//
// SET ONLY WHEN A REAL CUSTOMER WAS CREATED, the same rule ly_conv follows. An
// opted-out number, a throttle, a bot in the honeypot and somebody already on
// the books all get the identical page with no marker on it, so the presence of
// a card button can never be used to find out which of those happened.
//
// THIRTY MINUTES. Long enough to read the page, find a wallet and come back;
// short enough that a shared or borrowed browser is not carrying somebody
// else's card offer around for a week. It is not a credential - the worst it
// does is offer to add a card to an account that has no orders on it.
// ---------------------------------------------------------------------------

const COOKIE = 'ly_signup';
const MINUTES = 30;

// The card step lives on the page the form lands on, and posts to one route
// beside it. Scoped to those, so the marker is not sent with every request for
// every image on the site.
const PATH = '/start';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function remember(res, customerId) {
  if (!UUID.test(String(customerId || ''))) return;

  res.cookie(COOKIE, String(customerId), {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.env === 'production',
    path: PATH,
    maxAge: MINUTES * 60 * 1000,
  });
}

// Express only parses cookies when something has mounted a parser; this reads
// the header directly for the same reason ad-attribution.js does, so the module
// works wherever it is called from.
function recall(req) {
  const header = String((req.headers && req.headers.cookie) || '');

  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== COOKIE) continue;

    let value = part.slice(at + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch (err) {
      return null;
    }
    return UUID.test(value) ? value : null;
  }

  return null;
}

function forget(res) {
  res.clearCookie(COOKIE, { path: PATH });
}

module.exports = { remember, recall, forget, COOKIE, MINUTES, PATH };
