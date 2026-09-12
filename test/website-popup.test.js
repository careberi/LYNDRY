'use strict';

// ---------------------------------------------------------------------------
// THE OFFER POPUP SAYS WHAT THE PROMOTION SAYS, OR IT DOES NOT APPEAR.
//
// Neil's ask, 12 September. The danger in a popup is not the popup: it is a
// front page promising a discount the pricing code is not giving, read by
// somebody who has not typed anything yet and cannot be corrected afterwards.
//
// So every refusal below is really one rule - the popup may only repeat a
// promise that already exists - and each is pinned here because each of them
// would fail silently on a live website.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { popupOffer } = require('../src/core/promotions');
const popup = require('../src/web/popup');

// The offer actually running on 12 September, as it sits in the database.
const CLEAN50 = {
  id: '0d0cc597-79a3-46da-b17a-ff844b29f4e9',
  name: 'CLEAN50 - 50% off first order',
  blurb: '50% off your first order',
  kind: 'PERCENT_OFF',
  value: 50,
  applies_to: 'FIRST_ORDER',
  audience: 'NEW_NUMBERS',
  status: 'ACTIVE',
  expires_days: 30,
};

test('the headline is the promotion\'s own blurb, word for word', () => {
  const offer = popupOffer(CLEAN50);
  assert.equal(offer.headline, '50% off your first order');
});

test('an ended promotion comes off the website immediately', () => {
  // honoured() would still say yes here, and it is the wrong question: it is
  // about a promise already made to somebody. This is about handing one to a
  // stranger who has not typed anything yet.
  assert.equal(popupOffer({ ...CLEAN50, status: 'ENDED' }), null);
});

test('a promotion that has not started yet is not advertised', () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  assert.equal(popupOffer({ ...CLEAN50, starts_at: tomorrow }), null);
});

test('a silent promotion stays silent on the website too', () => {
  // "A PROMOTION WITH NO BLURB IS SILENT" - the AI is told nothing about it.
  // Neil's case for one was an offer he had already texted somebody about by
  // hand, and a popup would be the same news a second time in a second voice.
  assert.equal(popupOffer({ ...CLEAN50, blurb: null }), null);
  assert.equal(popupOffer({ ...CLEAN50, blurb: '   ' }), null);
});

test('the small print is only what the promotion actually carries', () => {
  assert.deepEqual(popupOffer({ ...CLEAN50, expires_days: null }).terms, []);

  assert.deepEqual(popupOffer(CLEAN50).terms, ['Good for 30 days from the day you get it.']);

  assert.deepEqual(popupOffer({ ...CLEAN50, expires_days: 1 }).terms, [
    'Good for 1 day from the day you get it.',
  ]);
});

test('a cap on a half-price offer is said in money, not in pounds', () => {
  // freeAllowanceLb() turns a money cap into a weight by dividing by the price
  // per pound, which only means anything when the offer covers the whole cost.
  // On a 50% offer a $60 cap is not 30 lb of laundry, and saying so would
  // promise nearly twice what the code allows.
  const capped = popupOffer({ ...CLEAN50, max_discount_cents: 6000, expires_days: null });
  assert.deepEqual(capped.terms, ['Up to $60.00 off.']);
});

test('a cap on a free offer is said in pounds, as the texts already say it', () => {
  const free = popupOffer({
    ...CLEAN50,
    kind: 'PERCENT_OFF',
    value: 100,
    blurb: 'your first order is on us',
    max_discount_cents: 6000,
    expires_days: null,
  });
  assert.deepEqual(free.terms, ['Covers the first 30 lb.']);
});

test('a minimum order is small print and is stated', () => {
  const offer = popupOffer({ ...CLEAN50, min_order_cents: 3000, expires_days: null });
  assert.deepEqual(offer.terms, ['On orders over $30.00.']);
});

test('a capped offer is handed back with its cap, for the caller to count', () => {
  // How many orders are left is a query, so popupOffer() does not answer it.
  // It says there is a cap; src/core/site-popup.js asks whether it is gone.
  assert.equal(popupOffer(CLEAN50).maxOrders, null);
  assert.equal(popupOffer({ ...CLEAN50, max_orders: 20 }).maxOrders, 20);
});

// ---------------------------------------------------------------------------
// The markup. Four things about it are load-bearing rather than decorative.
// ---------------------------------------------------------------------------

test('the form is the home page form: /start, honeypot, consent, nothing new', () => {
  const html = popup.markup(popupOffer(CLEAN50));

  assert.match(html, /action="\/start" method="post"/);
  assert.match(html, /name="website"/);
  assert.match(html, /name="sms_consent" value="yes" required/);
  assert.match(html, /name="phone"[^>]*required/);
});

test('it says which box it is, so the consent record can say so too', () => {
  assert.match(popup.markup(popupOffer(CLEAN50)), /name="from" value="popup"/);
});

test('a blurb from the database is escaped before it reaches the page', () => {
  // The blurb is typed on the promotions page, which makes it input like any
  // other. Anything from the database goes through escapeHtml().
  const html = popup.markup(popupOffer({ ...CLEAN50, blurb: '<script>alert(1)</script>' }));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('nothing in it promises a price or a pound of its own', () => {
  // Every figure a visitor reads has to have come off the promotion. A number
  // typed into this markup is a second copy of a promise, and the day they
  // disagree the website is the one making it.
  const html = popup.markup({ headline: 'an offer', terms: [] });
  const body = html.split('<script>')[0];
  assert.ok(!/\$\d/.test(body), 'a dollar figure is written into the popup markup');
  assert.ok(!/\d+\s*lb\b/.test(body), 'a weight is written into the popup markup');
  assert.ok(!/\d+%/.test(body), 'a percentage is written into the popup markup');
});
