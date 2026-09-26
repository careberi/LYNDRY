'use strict';

const express = require('express');

const db = require('../db');
const auth = require('../core/partner-auth');
const wash = require('../core/wash');
const fulfilment = require('../core/fulfilment');
const partnerWeighIn = require('../core/partner-weighin');
const courierLegs = require('../core/courier-legs');
const carriers = require('../core/carriers');
const page = require('../web/shop-page');
const signInTap = require('../web/sign-in-tap');
const { normalisePhone } = require('../core/phone');
const partnersCore = require('../core/partners');
const { site } = require('../web/site');

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
  'partner_weight_at, at_partner_at, ready_at, partner_id, return_carrier, ' +
  // WHETHER THIS ORDER HAS ALREADY BEEN PRICED AND PAID, and leaving it out was
  // a live bug rather than a tidiness point.
  //
  // `settleWeight()` opens `if (order.weight_settled_at)` and returns early - it
  // records the laundromat's scale and touches no money, because a van order was
  // charged at the doorstep before it ever reached a laundromat. Unselected the
  // column arrives undefined, which is falsy, so that early return never fired
  // from here: a PAID order weighed in the portal fell through to the two-scale
  // branch, and a disagreement wrote `weight_held_at` on it and raised an issue
  // reading "NOTHING HAS BEEN CHARGED and the customer has not been told a
  // price" - both false, about an order that was settled days earlier.
  //
  // The bag tag page never had this because `tags.findByTag()` selects `*`.
  'weight_settled_at, price_cents, payment_status, ' +
  // AND EVERY COLUMN THE PRICING BRANCH READS, because the weigh-in is what
  // prices the order and all four arrive undefined without this.
  //
  // `price_per_lb_cents` is the serious one: settleWeight falls back to
  // `config.pricing.perPoundCents` when it is missing, so a subscriber sold
  // $1.80 would be billed at today's default - which is the exact rule
  // CLAUDE.md states, that changing a price must not re-price work already
  // quoted. The other three are the floor, its fallback and any surcharge.
  //
  // NONE OF THEM IS RENDERED. They are loaded because the function this order is
  // handed to reads them, which is the whole point: what a caller must select is
  // decided by the callee, not by what the page happens to show.
  'price_per_lb_cents, minimum_cents, deposit_cents, surcharge_cents, ' +
  'preferences, customers(preferences)';

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

// WHO MAY MANAGE THE SHOP'S OWN STAFF. Neil, 25 September: "i should be able to
// assign the owner of the laundromat to be the admin of that account. the owner
// should be able to add and remove attendants."
//
// ONE QUESTION, ASKED IN ONE PLACE, the rule `roles.js` already sets for the ops
// screens: `if (user.role === 'OWNER')` scattered through templates is how a
// screen ends up showing somebody a control they would be refused at.
const isOwner = (req) => Boolean(req.partnerUser && req.partnerUser.role === 'OWNER');

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

// --- the shop's own URL and its home-screen app -----------------------------

// ITS OWN MANIFEST, SCOPED TO /shop.
//
// Sharing `/ops/app.webmanifest` would give a laundromat's tablet a home-screen
// app scoped to /ops, opening on the driver's route, bouncing to a sign-in they
// can never pass. The scope is what makes the installed app stay inside the
// portal instead of spilling into the browser the first time somebody taps
// something.
router.get('/shop/app.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  return res.send(
    JSON.stringify({
      name: `${site.name} laundromat`,
      short_name: site.name,
      start_url: '/shop',
      scope: '/shop',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#FFF8EC',
      theme_color: '#101210',
      icons: [
        { src: '/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    })
  );
});

// A LAUNDROMAT'S OWN ADDRESS, `/shop/riverside-wash-co`.
//
// Neil, 25 September: "when I add a laundromat, they should get their own url
// that they can log into".
//
// IT IS NOT A CREDENTIAL AND MUST NEVER BECOME ONE. It names which laundromat
// you are signing in to; a texted six-digit code is still the only thing that
// gets anybody in. What it buys is that an attendant lands on a page with her
// own shop's name on it rather than a generic box, which is the difference
// between a bookmark somebody trusts and one they ring us about.
//
// AN UNKNOWN SLUG REDIRECTS RATHER THAN 404ING, so the page is not a way of
// finding out which laundromats we work with - and a typo'd bookmark still gets
// somebody to a sign-in they can use.
//
// SOMEBODY ALREADY SIGNED IN GOES STRAIGHT TO THEIR BOARD, including when the
// slug names a different shop: the session decides which orders they see, never
// the URL. A bookmark pointing at the wrong shop must not be a way to look at it.
router.get('/shop/:slug', async (req, res, next) => {
  const lang = langOf(req);
  const asked = String(req.params.slug || '').toLowerCase();

  try {
    // A PATH THE PORTAL USES IS NOT A SHOP, SO IT FALLS THROUGH - `next()`, never
    // a redirect.
    //
    // This route is declared before the sign-in guard, so it sits in front of
    // `/shop/staff` in the table and Express answers whichever matched first.
    // Redirecting here would have made the Staff page unreachable: the slug
    // `staff` is reserved, the reserved branch fired, and an owner tapping their
    // own nav landed back on the sign-in page.
    //
    // `RESERVED_SLUGS` is the one list, shared with the slug generator, so a
    // path added to this file cannot be taken by a laundromat tomorrow.
    if (!/^[a-z0-9-]{1,60}$/.test(asked) || partnersCore.RESERVED_SLUGS.includes(asked)) {
      return next();
    }

    const { data: shop, error } = await db
      .from('partners')
      .select('id, name, slug, status, type')
      .eq('slug', asked)
      .maybeSingle();

    if (error) throw error;

    if (!shop || shop.status !== 'ACTIVE' || shop.type !== 'LAUNDROMAT') {
      return res.redirect(303, `/shop/login?lang=${lang}`);
    }

    res.set('Cache-Control', 'no-store');
    return html(res, page.phoneStep({ lang, shop, next: '/shop' }));
  } catch (err) {
    return next(err);
  }
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

    // WHICH ONES ALREADY HAVE A COURIER COMING, in one query rather than one per
    // row. An attendant who cannot see that she already pressed the button
    // presses it again, and a second car arrives.
    const coming = await courierLegs.bookedFor((data || []).map((o) => o.id));

    // WHAT A COURIER IS BRINGING. Scoped to this shop inside the query, like
    // everything else here - a laundromat must never see an order heading
    // somewhere else.
    const expected = await courierLegs.expectedAt(req.partner.id);

    res.set('Cache-Control', 'no-store');
    return html(
      res,
      page.board({
        lang,
        shop: req.partner,
        isOwner: isOwner(req),
        orders: (data || []).map((o) => ({ ...o, courierBooked: coming.has(o.id) })),
        expected,
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

  const said = {
    'done:weight': 'weightSaved',
    'done:courier': 'collectSent',
    'done:arrived': 'arrived',
    'problem:arrivedFailed': 'arrivedFailed',
    'done:added': 'staffAdded',
    'done:removed': 'staffRemoved',
    'done:restored': 'staffRestored',
    'problem:bad': 'weightBad',
    'problem:early': 'weightEarly',
    'problem:courier': 'collectFailed',
    'problem:weighfirst': 'weighFirst',
    'problem:oursToDrive': 'oursToDrive',
    'problem:phone': 'staffBadPhone',
    'problem:taken': 'staffTaken',
    'problem:notyours': 'staffNotYours',
    'problem:self': 'staffNotYou',
  };

  return said[`done:${done}`] || said[`problem:${problem}`] || null;
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

    const coming = await courierLegs.findLeg(order.id, 'TO_CUSTOMER');

    res.set('Cache-Control', 'no-store');
    return html(
      res,
      page.orderPage({
        lang,
        shop: req.partner,
        isOwner: isOwner(req),
        order: { ...order, courierBooked: Boolean(coming) },
        washLines: wash.washLines(preferences),
        flash: flashOf(req),
        // THE BUTTON EXISTS ONCE THE WORK IS WEIGHED AND NO COURIER IS COMING.
        // The route checks both again, because markup guards nothing.
        // THREE THINGS, AND ONE OF THEM IS NEIL'S DECISION. `carriers` answers
        // whether this leg is ours to drive; a courier booked on a leg he has
        // taken is a second vehicle sent for bags somebody is already on the way
        // for, and we pay for it.
        canSendCourier: carriers.mayBookReturnCourier(order).ok && !coming,
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

// --- "come and get these bags" ----------------------------------------------
//
// Neil, 25 September: "in the order screen, there should be a button of the
// attendant to tell the uber driver to come get the bags."
//
// IT DOES NOT MOVE THE ORDER'S STATUS. `OUT_FOR_DELIVERY` texts the customer
// "Washed, folded and out for delivery today!", and a courier having been
// REQUESTED is not the laundry being on its way - nobody has collected anything,
// and a courier can decline, time out or cancel. See `courier-legs.js`.
//
// THE ATTENDANT NEVER LEARNS WHERE THE BAGS ARE GOING. The customer's address is
// loaded here, handed to the courier, and never rendered. It is the one query in
// this file that reads a customer, and it reads exactly what a courier needs.
router.post('/shop/orders/:number/collect', async (req, res, next) => {
  const lang = langOf(req);

  try {
    const order = await theirOrder(req);
    if (!order) return res.redirect(303, `/shop?lang=${lang}`);

    const back = `/shop/orders/${encodeURIComponent(order.order_number)}?lang=${lang}`;

    // THE SAME QUESTION THE PAGE ASKED, ASKED AGAIN. A screen that hides a
    // control while the route behind it still fires is not a guard, and this one
    // spends money at a vendor.
    const may = carriers.mayBookReturnCourier(order);
    if (!may.ok) {
      const problem = may.reason === 'ours_to_drive' ? 'oursToDrive' : 'weighfirst';
      return res.redirect(303, `${back}&problem=${problem}`);
    }

    // The customer, for the courier and for nothing else.
    const { data: customer, error } = await db
      .from('customers')
      .select('id, name, phone, address_line1, address_line2, city, state, postal_code')
      .eq('id', order.customer_id)
      .maybeSingle();

    if (error) throw error;
    if (!customer) return res.redirect(303, `${back}&problem=courier`);

    const sent = await courierLegs.sendForReturn(order, {
      by: req.partnerUser,
      customer,
      partner: req.partner,
    });

    if (!sent.ok) {
      console.error(
        `Courier refused for order ${order.order_number} at ${req.partner.name}: ${sent.reason}` +
          (sent.detail ? ` (${sent.detail})` : '')
      );
      return res.redirect(303, `${back}&problem=courier`);
    }

    return res.redirect(303, `${back}&done=courier`);
  } catch (err) {
    return next(err);
  }
});

// THE BAGS ARE ON THE COUNTER.
//
// What actually moves an order to AT_PARTNER under a courier. There is no van to
// confirm and no driver to tap, so the signal is the laundromat saying the bags
// are here - which is the only person who knows.
//
// SCOPED TO THIS SHOP, in the query that finds the order. An attendant typing
// another laundromat's order number confirms nothing.
router.post('/shop/expected/:number/arrived', async (req, res, next) => {
  const lang = langOf(req);
  const back = `/shop?lang=${lang}`;

  try {
    const asked = String(req.params.number || '').replace(/\D/g, '');
    if (!asked) return res.redirect(303, back);

    const { data: order, error } = await db
      .from('orders')
      .select(ORDER_FIELDS)
      .eq('order_number', Number(asked))
      .eq('partner_id', req.partner.id)
      .in('status', ['REQUESTED', 'IN_PROCESS'])
      .maybeSingle();

    if (error) throw error;
    if (!order) return res.redirect(303, `${back}&problem=arrivedFailed`);

    const done = await courierLegs.arrived(order, {
      by: { id: req.partnerUser.id, name: `${req.partnerUser.name} at ${req.partner.name}` },
      partner: req.partner,
    });

    if (!done.ok) {
      console.error(
        `Could not mark order ${order.order_number} arrived at ${req.partner.name}: ${done.reason}` +
          (done.detail ? ` (${done.detail})` : '')
      );
      return res.redirect(303, `${back}&problem=arrivedFailed`);
    }

    return res.redirect(303, `${back}&done=arrived`);
  } catch (err) {
    return next(err);
  }
});

// --- the shop's own staff, run by its owner ---------------------------------
//
// Neil, 25 September: "the owner should be able to add and remove attendants."
//
// EVERY ROUTE CHECKS, NOT JUST THE NAV. The Staff tab only renders for an owner,
// and a menu that hides a link whose route still fires is not a guard - the rule
// the ops screens already follow for a driver and the money columns.
//
// AN OWNER CANNOT PROMOTE ANYBODY. Nothing here writes `role`, so the worst an
// owner can do is add and remove people at the shop they already run. Who owns a
// shop is LYNDRY's decision and is made on the partner's own page.
function requireOwner(req, res, next) {
  if (!isOwner(req)) return res.redirect(303, `/shop?lang=${langOf(req)}`);
  return next();
}

router.get('/shop/staff', requireOwner, async (req, res, next) => {
  const lang = langOf(req);

  try {
    const { data, error } = await db
      .from('partner_users')
      .select('id, name, phone, role, status, created_at')
      .eq('partner_id', req.partner.id)
      .order('role', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.set('Cache-Control', 'no-store');
    return html(
      res,
      page.staffPage({
        lang,
        shop: req.partner,
        me: req.partnerUser,
        staff: data || [],
        flash: flashOf(req),
      })
    );
  } catch (err) {
    return next(err);
  }
});

router.post('/shop/staff', requireOwner, async (req, res, next) => {
  const lang = langOf(req);
  const body = req.body || {};
  const back = `/shop/staff?lang=${lang}`;

  try {
    const phone = normalisePhone(body.phone);
    const name = String(body.name || '').trim().slice(0, 60);

    if (!phone || !name) return res.redirect(303, `${back}&problem=phone`);

    // ALWAYS AN ATTENDANT. `role` is not read off the form and must not be: a
    // hidden field is the submitter's to edit, and an owner minting another
    // owner is exactly what the two ladders exist to prevent.
    const { error } = await db.from('partner_users').insert({
      partner_id: req.partner.id,
      phone,
      name,
      role: 'ATTENDANT',
    });

    if (error) {
      // The phone column is unique across every laundromat, deliberately: a
      // number that signs in has to resolve to exactly one shop.
      if (String(error.message).includes('duplicate') || error.code === '23505') {
        return res.redirect(303, `${back}&problem=taken`);
      }
      throw error;
    }

    // NOBODY IS TEXTED. They are added to a list; they sign in when they choose
    // to, from the shop's own URL, and the code goes then. An unprompted text
    // saying "you have been added to a system" is a message nobody asked for.
    return res.redirect(303, `${back}&done=added`);
  } catch (err) {
    return next(err);
  }
});

router.post('/shop/staff/:id', requireOwner, async (req, res, next) => {
  const lang = langOf(req);
  const back = `/shop/staff?lang=${lang}`;
  const wanted = String((req.body || {}).status || '') === 'ACTIVE' ? 'ACTIVE' : 'DISABLED';

  try {
    // NOBODY CAN REMOVE THEMSELVES. The form does not offer it and the route
    // refuses it anyway - it is the one action that can leave a shop with no
    // owner and no way to add one, which would take a phone call to us to undo.
    if (String(req.params.id) === String(req.partnerUser.id)) {
      return res.redirect(303, `${back}&problem=self`);
    }

    // SCOPED TO THIS SHOP IN THE QUERY, never after it. An owner typing another
    // laundromat's user id into the address bar changes nothing there.
    const { data, error } = await db
      .from('partner_users')
      .update({
        status: wanted,
        // SWITCHING SOMEBODY OFF ENDS THEIR SESSION NOW, not in eight hours.
        // `requirePartner` re-reads the row every request, so clearing the token
        // is belt and braces - and somebody just let go is where both belts
        // matter.
        ...(wanted === 'ACTIVE' ? {} : { session_token: null }),
      })
      .eq('id', req.params.id)
      .eq('partner_id', req.partner.id)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.redirect(303, `${back}&problem=notyours`);

    return res.redirect(303, `${back}&done=${wanted === 'ACTIVE' ? 'restored' : 'removed'}`);
  } catch (err) {
    return next(err);
  }
});
