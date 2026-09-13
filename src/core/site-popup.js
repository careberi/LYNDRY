'use strict';

const { config } = require('../config');
const settings = require('./settings');
const promotions = require('./promotions');

// ---------------------------------------------------------------------------
// THE OFFER POPUP ON THE WEBSITE.
//
// Neil's ask, 12 September: somebody arrives at lyndry.com and is offered the
// first-order discount, with a box for their mobile number, switched on and off
// from the ops screens.
//
// IT ADVERTISES THE PROMOTION EVERY NEW NUMBER IS ALREADY GIVEN, AND IT IS NOT
// ALLOWED TO ADVERTISE ANYTHING ELSE. This is the whole design and the reason
// there is no "which promotion" setting anywhere - see migration 0089.
//
// The popup makes a promise to a stranger before they have typed anything. The
// only promise we can keep is the one promotions.autoGrant() hands out, because
// that is literally what lands on their account a second after they submit the
// form. A stored promotion id beside the switch would be a second copy of that
// fact, and CLAUDE.md already records that creating a second automatic
// promotion stands the first down - so the day Neil made a new offer, the
// website would have gone on advertising the old one to everybody.
//
// THE FORM IS THE HOME PAGE'S FORM. It posts to POST /start, with the same
// honeypot, the same consent box in the same words, and the same throttles, and
// it lands on the same /start/sent page. Nothing here is a second way to create
// a customer: that is the rule the two booking doors already follow, and it is
// what keeps the consent record identical however somebody arrived at the box.
//
// NOTHING HERE GRANTS ANYTHING. The promotion attaches in
// onboarding.startConversation() exactly as it does for the hero form, so the
// popup is a piece of window dressing over a path that already worked. If this
// file were deleted tomorrow, every number typed into it would still have got
// the same offer.
// ---------------------------------------------------------------------------

// ONE COOKIE, TWO WAYS OF EARNING IT: closing the popup, and giving us a
// number. Its presence is the whole question the server asks, so the value is
// only there for whoever opens dev tools.
//
// NOT httpOnly, because the close button sets it from the page. That is safe in
// a way the Google Ads marker is not: ly_conv says a customer was really
// created and so had to be hidden from the page, while this is set for every
// submission carrying a readable number whatever came of it. It says somebody
// typed a number into this browser, which is a fact that browser already knows.
const COOKIE = 'ly_popup';
const COOKIE_DAYS = 30;

// HOW LONG AFTER THE PAGE LOADS THE POPUP APPEARS, AND IT IS NONE.
//
// It was eight seconds, on the reasoning that an offer arriving over the top of
// the headline somebody came to read is rude. Neil, 12 September: "as soon as a
// new user who's never been to the site before appears, this thing should come
// up. The popup should appear with the website being loaded, not a delayed time
// afterwards."
//
// He is right and the old reasoning was answering the wrong question. Eight
// seconds is longer than most visits: somebody who bounces never sees the offer
// at all, so the delay was not protecting them from an interruption, it was
// hiding the offer from exactly the people it exists for. The ones who stay are
// not saved from anything either - they get it eight seconds later, having
// already started reading, which is the more interrupting of the two.
//
// NOTHING PROTECTS ANYBODY FROM SEEING IT TWICE EXCEPT THE COOKIE, and that is
// unchanged: a visitor who closes it, or gives us a number, does not see it
// again for a month, and the dialog is not even in the markup for them.
//
// Zero means shown as soon as the script runs, which is at the foot of the
// body, so the page is parsed and on screen behind it. The knob survives for a
// day when somebody wants a pause again; there is no exit-intent version, which
// reads the mouse leaving the top of the window and no phone has one.
const SHOW_AFTER_MS = Number(process.env.POPUP_DELAY_MS || 0);

// Same reasoning and the same number as settings.js: every marketing page asks
// this question, a cached answer costs a stale switch for a few seconds, and an
// uncached one costs a query per page view on the pages the adverts point at.
const CACHE_MS = 10 * 1000;

let cached = null;
let cachedAt = 0;

// A third copy of this in the codebase (src/core/ad-attribution.js and
// src/core/customer-auth.js have the others) and deliberately not a shared one:
// folding them together means a single function that three unrelated features
// depend on, and none of the three is more than a header split on semicolons.
function readCookie(req, name) {
  const header = (req && req.headers && req.headers.cookie) || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// Has this browser already closed it, or already given us a number.
function seen(req) {
  return Boolean(readCookie(req, COOKIE));
}

// Stop showing it. Called from POST /start and POST /bergen/join for every
// submission that carried a number we could read - including the ones that go
// nowhere, because setting it only for a real save would turn the cookie into a
// way of finding out whether a number was already on our books.
function markSeen(res) {
  res.cookie(COOKIE, '1', {
    httpOnly: false,
    sameSite: 'lax',
    secure: config.env === 'production',
    path: '/',
    maxAge: COOKIE_DAYS * 24 * 60 * 60 * 1000,
  });
}

// WHAT THE POPUP WOULD SAY TODAY, or null if it should not appear at all.
//
// A capped promotion that has run out is refused here rather than in
// popupOffer(), because "how many are left" is a count of claimed orders and so
// is a query. It is the same rule the promotions page shows as "All gone - the
// next booking pays full price", and putting a sold-out offer on the front page
// would be the one failure this whole file exists to avoid.
async function offer() {
  if (cached !== null && Date.now() - cachedAt < CACHE_MS) return cached;

  let answer = null;

  try {
    if (await settings.websitePopup()) {
      const promo = await promotions.autoGrant();
      const built = promotions.popupOffer(promo);

      // Only asked when there is a cap to ask about, so the ordinary promotion
      // costs no extra query.
      if (built && (!built.maxOrders || !(await promotions.full(promo)))) answer = built;
    }
  } catch (err) {
    // A popup is the least important thing on the page. Failing to work out
    // whether to show one must never take the home page down with it.
    console.error('Could not work out the website popup:', err.message);
    answer = null;
  }

  cached = answer;
  cachedAt = Date.now();
  return answer;
}

// What a given request should get. The cookie is checked first because it costs
// nothing and answers most requests.
async function forRequest(req) {
  if (seen(req)) return null;
  return offer();
}

// For the ops screens, which have just flipped the switch and must not be shown
// the answer from ten seconds ago.
function forget() {
  cached = null;
  cachedAt = 0;
}

module.exports = { COOKIE, COOKIE_DAYS, SHOW_AFTER_MS, CACHE_MS, seen, markSeen, offer, forRequest, forget };
