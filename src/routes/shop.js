'use strict';

const express = require('express');

const db = require('../db');
const auth = require('../core/partner-auth');
const wash = require('../core/wash');
const fulfilment = require('../core/fulfilment');
const partnerWeighIn = require('../core/partner-weighin');
const page = require('../web/shop-page');
const signInTap = require('../web/sign-in-tap');
const { normalisePhone } = require('../core/phone');

// ---------------------------------------------------------------------------
// The laundromat portal, at /shop.
//
// Neil's ask, 25 September: an attendant signs in, sees the orders at HER store,
// enters the weight of the bags, and later tells the courier to come and get it.
//
// THIS REVERSES "A PARTNER NEVER TOUCHES THE SYSTEM", which was right under the
// van and cannot survive the courier. That rule's whole argument was that
// `/ops/weight` charges a card, so 400 instead of 40 is a $1,000 charge and our
// own driver belongs between that number and somebody's card. Under a courier
// nobody of ours is ever in the building - so either an attendant types the
// weight or nobody does.
//
// WHICH MAKES THE GUARD AROUND THIS PAGE THE THING THAT MATTERS, and it is three
// separate things:
//
//   the session   scoped to one partner, re-read every request, eight hours
//   the query     every order is fetched WITH `partner_id` EQUAL TO THEIRS.
//                 Filtered in the query, never after it, so another shop's order
//                 never reaches the process - the same reason a driver's board
//                 leaves other drivers' stops out of the SQL rather than out of
//                 the markup
//   the weight    goes through `partner-weighin.js`, which the bag page also
//                 calls, so there is one implementation of "the laundromat
//                 weighed it" and the mismatch issue cannot be forgotten here
//
// WHAT IS NOT BUILT YET, DELIBERATELY: confirming a courier handover with Uber's
// PIN, and calling a courier to collect the finished work. Both need the courier
// order flow, which does not exist - and building half of it here would mean
// building it twice. The statuses this page reads are the ones the system has
// today.
//
// NO JAVASCRIPT EXCEPT THE SIGN-IN TAP GATE, which every sign-in in this
// codebase carries and which exists because a phone will otherwise submit a
// one-time code form by itself. Everything after signing in is plain forms.
// ---------------------------------------------------------------------------

const router = express.Router();

// WHAT AN ATTENDANT'S QUERIES MAY SELECT.
//
// NO NAME, NO PHONE, NO ADDRESS, NO MONEY. Not hidden in the template - absent
// from the process, which is the rule the ops screens follow for a driver and
// prices. A value that never reaches the page cannot leak from it, and this page
// is in somebody else's shop.
//
// `preferences` IS THE ORDER'S OWN SNAPSHOT and `customers(preferences)` is the
// live fallback, exactly as the bag page reads them - an order carries the wash
// it was booked with, and a null one means read the live row. Nothing else about
// the customer comes along.
// `customer_id` IS THE ONE EXCEPTION AND IT IS NOT A NAME. When the two scales
// disagree the weigh-in raises an issue, and an issue has to name whose laundry
// it is - so `partner-weighin.js` looks the customer up, and a bare id is what it
// needs to do that. Nothing renders it. Without it the issue was silently never
// raised: the price held, the card was not charged, and nobody was told.
const ORDER_FIELDS =
  'id, customer_id, order_number, status, bag_count, weight_lb, partner_weight_lb, ' +
  'partner_weight_at, at_partner_at, ready_at, partner_id, preferences, customers(preferences)';

// The two statuses that mean the bags are physically in their building.
const IN_THE_SHOP = ['AT_PARTNER', 'READY'];

function langOf(req) {
  const asked = String((req.query && req.query.lang) || (req.body && req.body.lang) || '').toLowerCase();
  return asked === 'es' ? 'es' : 'en';
}

// `?next=` ONLY EVER ACCEPTS A /shop PATH. Without it the sign-in page is an
// open redirector on lyndry.com, which is a ready-made phishing link - the same
// check `/ops/login` and `scanner.scanReturn()` make, and for the same reason.
function safeNext(value) {
  const asked = String(value || '');

  // `/shop` EXACTLY, OR SOMETHING UNDER `/shop/`. A plain `startsWith('/shop')`
  // also accepted `/shopping-not-ours`, which is same-origin and so not a
  // redirector - but "starts with the right letters" is not the rule anybody
  // means, and the next path added to this app could be the one that matters.
  if (asked !== '/shop' && !asked.startsWith('/shop/') && !asked.startsWith('/shop?')) return '/shop';

  if (asked.includes('//') || asked.includes('\\') || asked.includes(':')) return '/shop';
  return asked;
}

const html = (res, body) => res.type('html').send(body);

// --- signing in -------------------------------------------------------------

router.get('/shop/login', (req, res) => {
  const lang = langOf(req);
  const why = String((req.query || {}).why || '');

  const error =
    why === 'elsewhere'
      ? page.T.signedOutElsewhere[lang === 'es' ? 'es' : 'en']
      : why === 'shop_closed'
        ? page.T.shopClosed[lang === 'es' ? 'es' : 'en']
        : '';

  // NO-STORE, like both other sign-ins. A cached sign-in form is served to
  // somebody whose session is in fact still alive, and submitting it then looks
  // exactly like the code step being skipped - which was reported as a bug on
  // the ops screens.
  res.set('Cache-Control', 'no-store');
  return html(res, page.phoneStep({ lang, error, next: safeNext((req.query || {}).next) }));
});

router.post('/shop/login', async (req, res, next) => {
  const lang = langOf(req);
  const body = req.body || {};
  const to = safeNext(body.next);

  try {
    // SUBMITTING A NUMBER CLEARS ANY SESSION FIRST. The hole `/ops/login` had:
    // typing a number on a device whose cookie was still alive got you inside
    // without a code ever being entered. Cleared before the code is sent, so
    // abandoning the form cannot leave somebody inside on the old credential.
    auth.clearSessionCookie(res);

    const asked = await auth.requestCode(body.phone, req);
    res.set('Cache-Control', 'no-store');

    if (!asked.ok) {
      const key = asked.reason === 'throttled' ? 'tooMany' : 'badPhone';
      return html(
        res,
        page.phoneStep({ lang, error: page.T[key][lang === 'es' ? 'es' : 'en'], phone: body.phone, next: to })
      );
    }

    // THE SAME ANSWER WHETHER OR NOT THE NUMBER BELONGS TO ANYBODY, so this page
    // cannot be used to find out who works at a laundromat we deal with.
    return html(
      res,
      page.codeStep({ lang, phone: asked.phone, next: to, ttlMinutes: auth.CODE_TTL_MINUTES, tapGate: signInTap.tapGate() })
    );
  } catch (err) {
    return next(err);
  }
});

router.post('/shop/login/code', async (req, res, next) => {
  const lang = langOf(req);
  const body = req.body || {};
  const to = safeNext(body.next);
  const phone = normalisePhone(body.phone) || String(body.phone || '');

  const again = (error, code = '') =>
    html(res, page.codeStep({ lang, error, phone, code, next: to, ttlMinutes: auth.CODE_TTL_MINUTES, tapGate: signInTap.tapGate() }));

  try {
    res.set('Cache-Control', 'no-store');

    // NOBODY IS SIGNED IN UNTIL THEY TAP. Neil's requirement, from the ops
    // sign-in: a phone offering a one-time code will submit the form by itself,
    // and a code that arrives without a tap is not checked at all - it uses up
    // no attempt and comes back with the code still in the box.
    if (!signInTap.wasTapped(body)) {
      return again(page.T.tapToFinish[lang === 'es' ? 'es' : 'en'], String(body.code || ''));
    }

    const checked = await auth.verifyCode(body.phone, body.code, req);

    if (!checked.ok) {
      const key = checked.reason === 'throttled' ? 'tooMany' : 'badCode';
      return again(page.T[key][lang === 'es' ? 'es' : 'en']);
    }

    auth.setSessionCookie(res, checked.user.id, checked.token);
    return res.redirect(303, `${to}${to.includes('?') ? '&' : '?'}lang=${lang}`);
  } catch (err) {
    return next(err);
  }
});

router.post('/shop/logout', (req, res) => {
  auth.clearSessionCookie(res);
  return res.redirect(303, '/shop/login');
});

// --- everything below needs a signed-in attendant ---------------------------

router.use('/shop', auth.requirePartner);

router.get('/shop', async (req, res, next) => {
  const lang = langOf(req);

  try {
    // FILTERED IN THE QUERY, ON THEIR OWN partner_id. Another shop's orders
    // never reach the process, which is access control rather than a template
    // choosing not to print them.
    const { data, error } = await db
      .from('orders')
      .select(ORDER_FIELDS)
      .eq('partner_id', req.partner.id)
      .in('status', IN_THE_SHOP)
      .order('at_partner_at', { ascending: true });

    if (error) throw error;

    res.set('Cache-Control', 'no-store');
    return html(
      res,
      page.board({
        lang,
        shopName: req.partner.name,
        orders: data || [],
        flash: flashOf(req),
      })
    );
  } catch (err) {
    return next(err);
  }
});

// The banner rides on the redirect, so refreshing repeats the message and never
// the action - the rule every ops screen follows with `?done=` and `?problem=`.
function flashOf(req) {
  const done = String((req.query || {}).done || '');
  const problem = String((req.query || {}).problem || '');

  if (done === 'weight') return 'weightSaved';
  if (problem === 'bad') return 'weightBad';
  if (problem === 'early') return 'weightEarly';
  return null;
}

// ONE ORDER, LOOKED UP BY ORDER NUMBER AND BY THEIR partner_id TOGETHER.
//
// Both in the same query, so an attendant typing another shop's order number
// into the address bar gets nothing found rather than a page they are then
// refused on. It is the same lookup for reading and for writing, which is why it
// is a function.
async function theirOrder(req) {
  const asked = String(req.params.number || '').replace(/\D/g, '');
  if (!asked) return null;

  const { data, error } = await db
    .from('orders')
    .select(ORDER_FIELDS)
    .eq('order_number', Number(asked))
    .eq('partner_id', req.partner.id)
    .in('status', IN_THE_SHOP)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

router.get('/shop/orders/:number', async (req, res, next) => {
  const lang = langOf(req);

  try {
    const order = await theirOrder(req);
    if (!order) return res.redirect(303, `/shop?lang=${lang}`);

    // The order's own snapshot first, the live customer row second - exactly as
    // the bag page reads them. An order carries the wash it was booked with, and
    // a null snapshot means read the live one.
    const preferences =
      order.preferences && Object.keys(order.preferences).length
        ? order.preferences
        : (order.customers && order.customers.preferences) || {};

    res.set('Cache-Control', 'no-store');
    return html(
      res,
      page.orderPage({
        lang,
        shopName: req.partner.name,
        order,
        washLines: wash.washLines(preferences),
        flash: flashOf(req),
      })
    );
  } catch (err) {
    return next(err);
  }
});

router.post('/shop/orders/:number/weight', async (req, res, next) => {
  const lang = langOf(req);

  try {
    const order = await theirOrder(req);
    if (!order) return res.redirect(303, `/shop?lang=${lang}`);

    const back = `/shop/orders/${encodeURIComponent(order.order_number)}?lang=${lang}`;

    // THE SAME FUNCTION THE BAG PAGE CALLS. It stores the figure, writes the
    // audit entry, settles, and raises the issue when the two scales disagree.
    // A second implementation here is how one of them forgets the issue.
    const done = await partnerWeighIn.recordWholeLoad({
      order,
      weightLb: (req.body || {}).weight_lb,

      // WHO DID IT, BY NAME, IN THE ORDER'S CHANGE LOG. "the laundromat" and
      // "Maria at Riverside Wash Co" are different answers, and the second is
      // the one worth having when a weight is queried a week later.
      //
      // IT GOES IN `actor`, NOT IN A `name` BESIDE IT. `orderEvents.record()`
      // reads a name off `by.opsUser` and falls back to `by.actor`; an attendant
      // is not an ops user and never will be, so anything passed as `by.name` is
      // silently dropped - which it was, and the first event this wrote said only
      // "partner".
      by: { actor: `${req.partnerUser.name} at ${req.partner.name}` },
      settleWeight: fulfilment.settleWeight,
    });

    if (!done.ok) {
      return res.redirect(303, `${back}&problem=${done.reason === 'bad_weight' ? 'bad' : 'early'}`);
    }

    return res.redirect(303, `${back}&done=weight`);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

// FOR THE TESTS. `safeNext` is the check that stops the sign-in page becoming an
// open redirector on lyndry.com, which is a ready-made phishing link - so it is
// held against its own rules rather than only being read.
module.exports.safeNext = safeNext;
