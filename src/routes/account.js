'use strict';

const express = require('express');

const db = require('../db');
// baseUrl only. The Stripe keys stay behind src/providers/payments - see the
// note on publishableKey there.
const { config } = require('../config');
const orders = require('../core/orders');
const booking = require('../core/booking');
const settings = require('../core/settings');
const billing = require('../core/billing');
const cardSaved = require('../core/card-saved');
const promotions = require('../core/promotions');
const auth = require('../core/customer-auth');
const adAttribution = require('../core/ad-attribution');
const payments = require('../providers/payments');
const { sendAndLog } = require('../core/notify');
const { site } = require('../web/site');
const { renderPage, escapeHtml } = require('../web/layout');
const { formatPhone, normalisePhone } = require('../core/phone');
const wash = require('../core/wash');
const recurring = require('../core/recurring');
const onboarding = require('../core/onboarding');
const throttle = require('../core/throttle');
const setup = require('../web/account-setup');

const router = express.Router();

// ---------------------------------------------------------------------------
// Booking a pickup on the website.
//
// The same thing the text thread does, for people who would rather tap than
// type. It shares src/core/booking.js with the AI, so the two cannot come to
// different conclusions about whether a booking is allowed.
//
// Every status change still goes through src/core/orders.js — this file never
// writes a status directly, exactly like the ops endpoints.
// ---------------------------------------------------------------------------

// These pages use the ordinary site chrome, because to a customer this is just
// another part of lyndry.com. They are noindex all the same.
// THE GOOGLE ADS TAG IS OFF HERE UNLESS A ROUTE ASKS FOR IT: the sign-in page,
// the card step, and /account/thanks when it follows a card-on-file order. Every
// account page comes through this one helper, including
// /account/booked/<token> and /account/card/done/<token>, and Google's tag
// reports the browser's REAL address rather than the `path` below - so turning
// it on here for everyone would hand those tokens to Google. See googleTag() in
// src/web/layout.js.
function accountPage(res, { title, body, status = 200, tracking = false, conversionId = null, stripQuery = false }) {
  res
    .status(status)
    .type('html')
    .send(
      renderPage({
        title,
        description: 'Book a LYNDRY pickup.',
        path: '/account',
        body,
        noindex: true,
        tracking,
        conversionId,
        stripQuery,
      })
    );
}

function banner(message, tone = 'stain') {
  const fill = tone === 'stain' ? 'var(--stain-100)' : 'var(--suds-100)';
  const shadow = tone === 'stain' ? 'box-shadow:6px 6px 0 var(--stain-500);' : '';
  return `
  <div role="alert" class="card card-xl" style="padding:20px 24px;margin-bottom:26px;background:${fill};${shadow}">
    <p style="font-size:16px;line-height:1.5;color:var(--ink-900);margin:0;">${message}</p>
  </div>`;
}

function safeNext(value) {
  const wanted = String(value || '');
  return /^\/account(\/|$)/.test(wanted) ? wanted : '/account';
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

const PENDING_COOKIE = 'ly_cust_pending';

function setPending(res, phone) {
  res.cookie(PENDING_COOKIE, phone, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/account',
    maxAge: (auth.CODE_TTL_MINUTES + 5) * 60 * 1000,
  });
}

function readPending(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === PENDING_COOKIE) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return '';
}



// The create-an-account page, redisplayed with an error and whatever they
// typed. The happy path is rendered by web.js from public/pages/signup.html;
// this is the same form written out here so a validation failure can keep
// their name and number rather than emptying the form.
// signupStep() lived here and is gone with the second door. Creating an account
// and signing in are one screen now - phoneStep() below is it, and it carries
// the consent box because for a number we have never met that is the only place
// written consent can be captured before we text them.

// ---------------------------------------------------------------------------
// ONE DOOR FOR EVERYBODY: a number, and the box.
//
// Neil's call. There were two screens - /signup for a stranger and this one for
// a customer - and a person standing in front of them has to know which of the
// two they are before they can start. They do not care. They want to place an
// order.
//
// So the number decides. Type it in and the site works out whether it knows
// you: a customer signs in and books, a stranger gets an account made and is
// walked straight into the order.
//
// IT STILL CANNOT BE USED TO FIND OUT WHO IS A CUSTOMER. That property was
// worth keeping and nearly died here: a screen that branched visibly would let
// anybody type a number and read the answer off the next page. It does not
// branch. Both cases send a code and land on the same "check your phone" - the
// paths only separate AFTER the code proves whose phone it is.
//
// THE CONSENT BOX IS ON IT FOR EVERYONE, and that is not decoration. The very
// next thing that happens is a text, so for a number we have never met this is
// the only place written consent can be captured. An existing customer ticking
// it again costs them a tap and changes nothing - their original consent record
// is never overwritten, because the first time they agreed is the one that
// matters if anybody ever asks.
// ---------------------------------------------------------------------------
function phoneStep({ error = '', next = '/account', phone = '' } = {}) {
  return `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="max-width:560px;padding-top:80px;padding-bottom:72px;">
    <h1 class="display-2">Start with your number.</h1>
    <p style="font-size:19px;line-height:1.5;color:var(--ink-800);max-width:44ch;margin:0;">
      Your cell number is your account. No password.
    </p>
  </div>
</section>

<section class="container" style="max-width:560px;padding-top:56px;padding-bottom:104px;">
  ${error ? banner(escapeHtml(error)) : ''}

  <form method="post" action="/account/login" class="card card-xl" style="padding:30px;">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <div class="field">
      <label class="field-label" for="phone">Cell number</label>
      <input class="input input-lg" type="tel" id="phone" name="phone" required
             autocomplete="tel" inputmode="tel" placeholder="(201) 555-0142"
             value="${escapeHtml(phone)}" autofocus>
      <span class="field-hint">Has to be able to get texts.</span>
    </div>

    <!-- NO CONSENT BOX HERE, AND THAT IS THE POINT OF THIS SCREEN.

         Neil: at this moment neither of us knows what is about to happen. A
         customer signing in has already consented and being asked again is
         noise; somebody new is not being texted yet, so there is nothing to
         consent TO. The number decides which, and the tick box lives on the
         screen where it is actually true - the address step, immediately
         before the first message we would ever send them. -->
    <button type="submit" class="btn btn-ink btn-lg btn-full" style="margin-top:22px;">
      Continue {{ICON_ARROW}}
    </button>

    <p style="font-size:15px;line-height:1.6;color:var(--ink-700);margin:18px 0 0;">
      By continuing you agree to our <a href="/terms">terms of service</a>.
    </p>
  </form>
</section>`;
}

function codeStep({ error = '', next = '/account', phone = '' } = {}) {
  return `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="max-width:560px;padding-top:80px;padding-bottom:72px;">
    <p class="eyebrow eyebrow-brand">Your pickups</p>
    <h1 class="display-2">Check your phone.</h1>
    <!-- ON ITS WAY, NOT ALREADY SENT. The text is handed to a timer rather than
         sent inside the request (see src/core/customer-auth.js), so for the
         first few seconds this page is up and the message is not. "We texted
         you a code" would be a sentence the phone contradicts, and somebody
         reading it decides the site is broken and starts tapping. -->
    <p style="font-size:19px;line-height:1.5;color:var(--ink-800);max-width:44ch;margin:0;">
      A six-digit code is on its way to <strong>${escapeHtml(formatPhone(phone))}</strong>.
      Give it a few seconds. It expires ${auth.CODE_TTL_MINUTES} minutes after it lands.
    </p>
  </div>
</section>

<section class="container" style="max-width:560px;padding-top:56px;padding-bottom:104px;">
  ${error ? banner(escapeHtml(error)) : ''}

  <form method="post" action="/account/login/code" class="card card-xl" style="padding:30px;">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <div class="field">
      <label class="field-label" for="code">Six-digit code</label>
      <input class="input input-lg" type="text" id="code" name="code" required
             inputmode="numeric" pattern="[0-9]*" maxlength="6"
             autocomplete="one-time-code" autofocus
             style="letter-spacing:0.4em;font-size:24px;text-align:center;">
    </div>
    <button type="submit" class="btn btn-ink btn-lg btn-full" style="margin-top:20px;">
      Sign in {{ICON_ARROW}}
    </button>
  </form>

  <form method="post" action="/account/login" style="margin-top:18px;">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <input type="hidden" name="phone" value="${escapeHtml(phone)}">
    <button type="submit" class="btn btn-ghost">Send another code</button>
  </form>

  <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:24px 0 0;">
    Nothing arrived? Give it a few seconds, then
    <a href="/account/login">try the number again</a>.
  </p>
</section>`;
}

// ---------------------------------------------------------------------------
// Create an account.
//
// Name, number, consent - then exactly the same code step as signing in, and
// they land in the portal. Everything else about them (address, how they like
// it washed, where the bag goes, a card) is collected in there, attached to the
// order they are actually trying to place. It used to all be asked on one long
// form before an account existed at all.
//
// IT LIVES HERE, NOT IN web.js, because it sets the pending cookie and mints a
// sign-in code. Those belong with the rest of the session handling; the page
// itself is still rendered by web.js like every other page.
//
// A NUMBER WE ALREADY KNOW IS NOT AN ERROR AND NOT ANNOUNCED. It used to be
// refused with "that mobile number is already registered", which is both a dead
// end for somebody who simply forgot they had signed up, and a way for anybody
// to test whether a given number is one of our customers. Now the answer is the
// same either way: a code goes out and they sign in. Their existing record is
// NOT overwritten - anyone can type any number into this form, so letting it
// update a name would let a stranger rewrite a real customer's account.
// POST /account/signup is gone. POST /account/login does both jobs: it finds
// the customer or makes one, and sends the same code either way.

router.get('/account/login', (req, res) => {
  if (auth.isSignedIn(req)) return res.redirect(302, safeNext(req.query.next));

  // THEIR OWN NUMBER, OUT OF THEIR OWN COOKIE. Somebody part-way through an
  // order who presses Back on the first screen lands here, and an empty box
  // reads as having lost their place. It reveals nothing: the cookie is signed
  // by this server and holds the number they typed into this form minutes ago.
  // Shown the way the box asks for it, not the way it is stored: the
  // placeholder beside it reads (201) 555-0142, and +12015550166 sitting in a
  // field that asks for that is a format nobody typed.
  const phone = formatPhone(auth.readGuest(req) || '');

  accountPage(res, {
    title: 'Sign in',
    body: phoneStep({ next: safeNext(req.query.next), phone }),
    // The number form Google Ads measures. The tag reads the address and the
    // title, never the form: the number pre-filled from the cookie above is in
    // the page, and it is not in anything the tag sends.
    tracking: true,
  });
});

router.post('/account/login', async (req, res, next) => {
  const wanted = safeNext((req.body || {}).next);
  const form = req.body || {};
  const phone = form.phone;

  const fail = (error, status = 400) =>
    accountPage(res, {
      title: 'Place an order',
      status,
      body: phoneStep({ error, next: wanted, phone }),
    });

  try {
    const number = normalisePhone(phone);
    if (!number) {
      return fail('Please enter a valid 10-digit US mobile number, for example (201) 555-0142.');
    }

    // THE NUMBER DECIDES WHAT HAPPENS NEXT.
    //
    // Neil's flow, and it reverses what was here. A customer gets a code and
    // signs in. Somebody we have never met gets NO TEXT at all - they place the
    // order in the browser and the account is created at the end, once they
    // have given a name and an address and ticked the box.
    //
    // THIS SCREEN NOW ANSWERS "IS THIS NUMBER A CUSTOMER", which it used to
    // refuse to. That was deliberate and it has been deliberately given up:
    // Neil chose a flow where the site works out what to do rather than making
    // the person say which of the two they are. The throttles below are what is
    // left standing between that and somebody enumerating numbers.
    const { data: existing, error } = await db
      .from('customers')
      .select('id, status')
      .eq('phone', number)
      .maybeSingle();

    if (error) throw error;

    // OPTED OUT IS ITS OWN ANSWER. They are a customer, so we do not offer to
    // make them one - and we may not text them, so a code is out of the
    // question. START from their own handset is the only thing that undoes
    // STOP, and that is the rule everywhere else in this system.
    if (existing && existing.status === 'UNSUBSCRIBED') {
      return fail(
        `You asked us to stop texting this number, so we cannot send a code. Text ` +
          `START to ${site.publicPhoneDisplay} from that phone and you can sign in again.`
      );
    }

    if (existing) {
      const result = await auth.requestCode(phone, req);

      if (!result.ok) {
        return result.reason === 'throttled'
          ? fail('Too many codes requested. Wait fifteen minutes and try again.', 429)
          : fail('That does not look like a US mobile number.');
      }

      setPending(res, result.phone);
      return res.redirect(303, `/account/login/code?next=${encodeURIComponent(wanted)}`);
    }

    // NOBODY YET. No row, no text, no session - just a signed note of the
    // number they typed, and straight into the order. See the guest cookie in
    // src/core/customer-auth.js for what that cookie may and may not do.
    if (throttle.hit(`guest:${number}`, 5, 15 * 60 * 1000)) {
      return fail('Too many attempts. Wait fifteen minutes and try again.', 429);
    }

    auth.setGuestCookie(res, number);
    return res.redirect(303, '/account/book');
  } catch (err) {
    return next(err);
  }
});

router.get('/account/login/code', (req, res) => {
  if (auth.isSignedIn(req)) return res.redirect(302, safeNext(req.query.next));

  const phone = readPending(req);
  if (!phone) return res.redirect(302, '/account/login');

  accountPage(res, {
    title: 'Enter your code',
    body: codeStep({ next: safeNext(req.query.next), phone }),
    // NO TAG HERE, and it was briefly the conversion page, wrongly. Only an
    // EXISTING customer is ever sent a code: POST /account/login texts a code to
    // somebody already on the books and sends a new number straight into the
    // order instead. So this page is a returning customer signing in, which is
    // the one thing a lead is not. Found by submitting a new number for real and
    // watching it land on /account/book. An online lead is now counted when the
    // order is created - see POST /account/book.
  });
});

router.post('/account/login/code', async (req, res, next) => {
  const wanted = safeNext((req.body || {}).next);
  const phone = readPending(req);

  try {
    if (!phone) return res.redirect(303, '/account/login');

    const result = await auth.verifyCode(phone, (req.body || {}).code, req);

    if (!result.ok) {
      const error =
        result.reason === 'throttled'
          ? 'Too many attempts. Wait fifteen minutes and try again.'
          : 'That code is wrong or has expired. Ask for a new one.';
      return accountPage(res, {
        title: 'Enter your code',
        status: result.reason === 'throttled' ? 429 : 401,
        body: codeStep({ error, next: wanted, phone }),
      });
    }

    res.clearCookie(PENDING_COOKIE, { path: '/account' });
    auth.setSessionCookie(res, result.customer.id);

    // STRAIGHT INTO THE ORDER IF THERE IS NOTHING ON FILE YET.
    //
    // Neil's flow: somebody who came to place an order should be placing one,
    // not looking at an empty dashboard working out where to start. The wizard
    // asks in his order - how it is washed, whether it repeats, when, then the
    // name and address, then the card - and saves each answer as it goes.
    //
    // Only when something is actually missing. A customer with an address and
    // wash preferences already lands on their own dashboard, where their
    // pickups are.
    if (wanted === '/account' && setup.blocking(result.customer)) {
      return res.redirect(303, '/account/book');
    }

    return res.redirect(303, wanted);
  } catch (err) {
    return next(err);
  }
});

router.post('/account/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.clearCookie(PENDING_COOKIE, { path: '/account' });
  res.redirect(303, '/');
});

// ---------------------------------------------------------------------------
// The account page: what's happening, and the booking form
// ---------------------------------------------------------------------------

// EVERY STATUS A CUSTOMER CAN SEE NEEDS A WORD HERE, because the fallback is
// the raw column value - so an order at the laundromat read "AT_PARTNER" on
// their own account page. Both of those steps say "Being washed", which is
// what is true from the customer's side and is the same reason neither of them
// sends a text: which building their laundry is in is a fact about how we run
// the business, not about their order.
const STATUS_WORDS = {
  REQUESTED: 'Booked in',
  ASSIGNED: 'Booked in',
  DEPOSITED: 'With us',
  IN_PROCESS: 'Being washed',
  AT_PARTNER: 'Being washed',
  READY: 'Being washed',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELED: 'Canceled',
};

const STATUS_TONE = {
  REQUESTED: 'var(--stage-scheduled)',
  ASSIGNED: 'var(--stage-scheduled)',
  DEPOSITED: 'var(--stage-collected)',
  IN_PROCESS: 'var(--stage-washing)',
  OUT_FOR_DELIVERY: 'var(--stage-ready)',
  DELIVERED: 'var(--stage-delivered)',
  CANCELED: 'var(--ink-200)',
};

// ---------------------------------------------------------------------------
// DATES IN THE PORTAL ARE mm/dd/yyyy. Neil's call, and it is the portal only.
//
// booking.readableDate() writes "Monday 14 Sep", which is right in a text
// message - it is a sentence somebody reads on a phone, and a slash-separated
// number in the middle of one reads as a form. A table is the opposite: a
// column of dates is scanned rather than read, and they need to line up and
// sort by eye.
//
// So this is a portal-local formatter and readableDate() is left exactly as it
// is. Changing that would silently rewrite every confirmation, reminder and
// weigh-in text as well.
function mdy(iso) {
  const [y, m, d] = String(iso || '').split('-');
  return y && m && d ? `${m}/${d}/${y}` : '';
}

// The same shape whenLine() gives, with the date in figures:
// "09/14/2026 between 10am and 12pm".
function whenLineMdy(order) {
  const window = booking.arrivalWindow(order);
  return [mdy(order.pickup_date), window].filter(Boolean).join(' ');
}

function money(cents) {
  return cents == null ? null : `$${(cents / 100).toFixed(2)}`;
}

// The soonest and latest days someone may pick. Today is allowed — a morning
// booking for the same afternoon is a normal thing to want.
//
// NEW JERSEY'S CLOCK, NOT UTC. This was `new Date().toISOString()`, which from
// 8pm Eastern onward has already rolled to tomorrow — so the picker quietly
// stopped offering today every evening, which is exactly when somebody sitting
// at home decides to book one. CLAUDE.md carries the same warning about the
// same mistake elsewhere in the codebase.
//
// `opensOn` raises the floor before we start running: no picker, no refusal.
// It is still enforced in bookPickup(), because a form control is a courtesy
// and not a guard.
// ---------------------------------------------------------------------------
// TODAY COMES OFF THE PICKER ONCE THE LAST WINDOW HAS GONE.
//
// Neil's, at half past eight one evening: the picker still offered today, and
// the earliest time it would let him choose was eight in the morning, twelve
// hours gone. checkSlot() refuses that - so the form was offering a day it
// knew nothing could be booked on, and the only way to find out was to press
// Continue and read an error.
//
// booking.windowsToday() is the same answer the AI is handed, so the picker and
// the booking code cannot disagree about whether today is still possible. A day
// is done when no window has YET TO START, which is the test everything else
// here uses: a van cannot begin a run that began an hour ago.
// ---------------------------------------------------------------------------
function dateBounds(opensOn = null) {
  const today = booking.today();
  const from = booking.windowsToday().dayIsDone ? booking.addDays(today, 1) : today;
  const to = booking.addDays(today, 60);

  return { min: opensOn && opensOn > from ? opensOn : from, max: to };
}

// currentOrderCard() lived here and is gone. It drew one pickup as a card, and
// the dashboard has shown pickups as three tables since Neil redrew it - so it
// had no callers, and the dead copy still carried the confirm() cancel button
// that turned out not to work.

// ---------------------------------------------------------------------------
// The dashboard. Neil's layout, and it replaced a single long column.
//
//   one big lilac card   place an order
//   three cards          address, wash instructions, payment method
//   table                upcoming orders
//   table                order history
//
// The cards are permanent rather than a setup panel that disappears once
// everything is filled in - the old version meant the only way to change an
// address was to first make it invalid.
// ---------------------------------------------------------------------------

// A table that scrolls inside its own box rather than pushing the page sideways
// on a phone. Everything here is five columns of short text, so it only bites
// on the narrowest screens, but a body that scrolls horizontally is a bug.
function table(caption, headings, rows, empty) {
  if (!rows.length) {
    return `
  <div style="margin-bottom:44px;">
    <p class="eyebrow" style="margin-bottom:6px;">${escapeHtml(caption.eyebrow)}</p>
    <h2 style="font-family:var(--font-display);font-weight:800;font-size:26px;margin:0 0 14px;">
      ${escapeHtml(caption.title)}
    </h2>
    <p style="font-size:16px;color:var(--ink-500);margin:0;">${escapeHtml(empty)}</p>
  </div>`;
  }

  return `
  <div style="margin-bottom:44px;">
    <p class="eyebrow" style="margin-bottom:6px;">${escapeHtml(caption.eyebrow)}</p>
    <h2 style="font-family:var(--font-display);font-weight:800;font-size:26px;margin:0 0 14px;">
      ${escapeHtml(caption.title)}
    </h2>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:15px;min-width:520px;">
        <thead>
          <tr>
            ${headings
              .map(
                (h) => `<th style="text-align:left;padding:0 14px 10px 0;font-family:var(--font-mono);
                             font-size:11px;letter-spacing:0.08em;text-transform:uppercase;
                             color:var(--ink-500);font-weight:700;white-space:nowrap;">${escapeHtml(h)}</th>`
              )
              .join('')}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (cells) => `
          <tr>
            ${cells
              .map(
                (c) => `<td style="padding:14px 14px 14px 0;border-top:1px solid var(--ink-100);
                             vertical-align:top;line-height:1.45;">${c}</td>`
              )
              .join('')}
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

// What a customer was promised for THIS order, not what they have set today.
// orders.preferences is a snapshot taken when the order was written, so
// somebody who changed their wash last week still sees what the bag in the van
// is actually getting.
function washOf(order, customer) {
  const prefs =
    order.preferences && Object.keys(order.preferences).length
      ? order.preferences
      : customer.preferences || {};

  return prefs.water_temp ? escapeHtml(wash.describeSaved(prefs)) : '<span style="color:var(--ink-500);">Not set</span>';
}

function spotLine(order, customer) {
  const prefs = order.preferences && Object.keys(order.preferences).length ? order.preferences : null;
  const spot = String((prefs && prefs.special_instructions) || setup.spotOf(customer) || '').trim();

  if (order.pickup_method === 'HAND_TO_DRIVER') return 'Handed to the driver';
  return spot ? `Bag at the ${escapeHtml(spot)}` : 'Outside the door';
}

router.get('/account', auth.requireCustomer, async (req, res, next) => {
  try {
    const customer = req.customer;

    // THREE TABLES, SPLIT ON WHO IS HOLDING THE LAUNDRY. Neil's ask, and the
    // groups are orders.js's own - so "upcoming" and "current" here can never
    // come to mean something different from what the rest of the system thinks.
    //
    //   upcoming  booked, we have not been yet   AWAITING_COLLECTION
    //   current   we have the bag                IN_OUR_HANDS
    //   past      finished or called off         DELIVERED / CANCELED
    const { data: live, error: liveError } = await db
      .from('orders')
      .select('*')
      .eq('customer_id', customer.id)
      .in('status', orders.IN_FLIGHT)
      .order('pickup_date', { ascending: true });

    if (liveError) throw liveError;

    const upcoming = (live || []).filter((o) => orders.AWAITING_COLLECTION.includes(o.status));
    const current = (live || []).filter((o) => orders.IN_OUR_HANDS.includes(o.status));

    // Their standing orders, so the dashboard can show them and offer a way
    // out. Without this the only way to stop one is to ask the AI, which is a
    // poor answer for something that books itself every week.
    const schedules = await recurring.forCustomer(customer.id);

    const { data: past } = await db
      .from('orders')
      .select('order_number, status, pickup_date, collected_at, delivered_at, weight_lb, billable_weight_lb, price_cents')
      .eq('customer_id', customer.id)
      .in('status', ['DELIVERED', 'CANCELED'])
      .order('pickup_date', { ascending: false })
      .limit(20);

    const flash = req.query.booked
      ? banner('Booked. We\u2019ve texted you a confirmation.', 'suds')
      : req.query.moved
        ? banner('Moved. We\u2019ve texted you the new day.', 'suds')
        : req.query.cancelled
          ? banner('Canceled, no charge.', 'suds')
          : req.query.saved
            ? banner(escapeHtml(String(req.query.saved)), 'suds')
            : req.query.error
              ? banner(escapeHtml(String(req.query.error)))
              : '';

    // BOOKED IN OR AWAITING CARD, NEVER JUST "BOOKED IN".
    //
    // The ops board has drawn this distinction for a while and the customer's
    // own page did not: a pickup with no card on file said "Booked in", which
    // is the half of the truth that stops somebody acting. It is the exact
    // shape of the order we lost - told it was booked, never clearly told the
    // driver could not come until a card was saved.
    //
    // DERIVED, NOT A STATUS. There is no fourth row in the state machine for
    // this; it is the order's status read together with a fact about the
    // customer, exactly as admin.js does it.
    const needsCard = !customer.default_payment_method_id;

    const statusBadge = (o) => {
      const awaiting = needsCard && orders.AWAITING_COLLECTION.includes(o.status);
      const tone = awaiting ? 'var(--sunbeam-500)' : STATUS_TONE[o.status];
      const word = awaiting ? 'Awaiting card' : STATUS_WORDS[o.status] || o.status;

      return `<span class="badge" style="background:${tone};${
        o.status === 'DELIVERED' ? 'color:var(--paper-050);' : ''
      }">${escapeHtml(word)}</span>`;
    };

    // --- upcoming: still ours to change ------------------------------------
    const upcomingRows = upcoming.map((o) => [
      `<strong>#${o.order_number}</strong><br>${statusBadge(o)}`,
      washOf(o, customer),
      `${escapeHtml(whenLineMdy(o))}<br>
       <span style="color:var(--ink-500);">${spotLine(o, customer)}</span>
       <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:12px;">
         <details>
           <summary style="cursor:pointer;font-size:15px;font-weight:600;">Move it</summary>
           <form method="post" action="/account/reschedule" style="margin:14px 0 0;">
             <input type="hidden" name="order_id" value="${o.id}">
             <div class="stack">
               <div class="field">
                 <label class="field-label" for="d_${o.id}">New day</label>
                 <input class="input" type="date" id="d_${o.id}" name="new_date" required
                        value="${escapeHtml(o.pickup_date)}">
               </div>
               <div class="field">
                 <label class="field-label" for="t_${o.id}">Time (optional)</label>
                 <input class="input" type="time" id="t_${o.id}" name="new_time"
                        value="${escapeHtml(booking.normaliseTime(o.pickup_time) || '')}">
               </div>
             </div>
             <button type="submit" class="btn btn-primary" style="margin-top:14px;">Move it</button>
           </form>
         </details>
         <details>
           <summary style="cursor:pointer;font-size:15px;font-weight:600;">Cancel</summary>
           <form method="post" action="/account/cancel" style="margin:14px 0 0;">
             <input type="hidden" name="order_id" value="${o.id}">
             <p style="margin:0 0 12px;font-size:15px;color:var(--ink-700);">
               Free to cancel before we pick up. You can book again any time.
             </p>
             <button class="btn btn-outline">Yes, cancel this pickup</button>
           </form>
         </details>
       </div>`,
    ]);

    // --- current: we have it, nothing to change ----------------------------
    //
    // No move or cancel controls, and that is the state machine's rule rather
    // than the page's: once the bag is collected the order cannot be cancelled,
    // because processing has begun.
    const currentRows = current.map((o) => [
      `<strong>#${o.order_number}</strong><br>${statusBadge(o)}`,
      washOf(o, customer),
      o.weight_lb
        ? `${escapeHtml(String(o.billable_weight_lb || o.weight_lb))} lb${
            o.price_cents != null ? `<br><strong>${escapeHtml(money(o.price_cents))}</strong>` : ''
          }`
        : '<span style="color:var(--ink-500);">Weighed after pickup</span>',
      `${escapeHtml(whenLineMdy(o))}<br>
       <span style="color:var(--ink-500);">Back the ${escapeHtml(site.turnaround)}</span>`,
    ]);

    // --- past ---------------------------------------------------------------
    const day = (iso) =>
      iso
        ? escapeHtml(mdy(booking.serviceDateOf(iso)))
        : '<span style="color:var(--ink-500);">&mdash;</span>';

    const pastRows = (past || []).map((o) => {
      const lbs = o.billable_weight_lb || o.weight_lb;

      return [
        `<strong>#${o.order_number}</strong>${
          o.status === 'CANCELED'
            ? '<br><span class="badge" style="background:var(--paper-200);">Canceled</span>'
            : ''
        }`,
        day(o.collected_at),
        day(o.delivered_at),
        lbs ? `${escapeHtml(String(lbs))} lb` : '<span style="color:var(--ink-500);">&mdash;</span>',
        o.price_cents != null
          ? `<strong>${escapeHtml(money(o.price_cents))}</strong>`
          : '<span style="color:var(--ink-500);">&mdash;</span>',
      ];
    });

    const body = `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="max-width:900px;padding-top:60px;padding-bottom:44px;">
    <p class="eyebrow eyebrow-brand">Your account</p>
    <h1 class="display-2" style="margin-bottom:0;">Hello, ${escapeHtml(
      (customer.name || '').split(' ')[0] || 'there'
    )}.</h1>
  </div>
</section>

<section class="container" style="max-width:900px;padding-top:40px;padding-bottom:96px;">
  ${flash}
  ${setup.placeOrderButton(schedules)}
  ${setup.summaryCards(customer, { needsCardNow: needsCard && Boolean(live && live.length) })}

  <!-- CURRENT FIRST. Neil's order, and it is the right one: the laundry we are
       actually holding is the thing somebody signs in to check on. What is
       booked for next week can wait a scroll. -->
  ${table(
    { eyebrow: 'With us', title: 'Current orders' },
    ['Order', 'Wash details', 'Weight', 'Picked up'],
    currentRows,
    'Nothing with us right now.'
  )}

  ${table(
    { eyebrow: 'Booked', title: 'Upcoming orders' },
    ['Order', 'Wash details', 'Pickup details'],
    upcomingRows,
    'Nothing booked at the moment.'
  )}

  ${table(
    { eyebrow: 'Finished', title: 'Past orders' },
    ['Order', 'Picked up', 'Delivered', 'Weight', 'Billed'],
    pastRows,
    'Nothing yet. Your first order will show here once it is done.'
  )}

  <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding-top:12px;border-top:2px solid var(--ink-100);">
    <form method="post" action="/account/logout" style="margin:0;">
      <button class="btn btn-ghost">Sign out</button>
    </form>
    <!-- THE NUMBER, NOT JUST THE OFFER. "Everything here works by text too" is
         useless without the number to text, and it is the one place on this
         page somebody is being sent somewhere else. -->
    <span style="font-size:15px;color:var(--ink-500);">
      Prefer texting? Everything here works by text -
      <a href="sms:${escapeHtml(site.publicPhoneLink)}">${escapeHtml(site.publicPhoneDisplay)}</a>.
    </span>
  </div>
</section>`;

    // NO GOOGLE ADS TAG HERE ANY MORE. It used to fire on the one landing that
    // followed a new online order; every order now ends on /account/thanks, and
    // that page counts it instead.
    accountPage(res, { title: 'Your account', body });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Booking, moving and cancelling
// ---------------------------------------------------------------------------

const back = (res, query) => res.redirect(303, `/account${query}`);

// ---------------------------------------------------------------------------
// Finishing your setup from the website.
//
// Each of these writes THE SAME COLUMN THE AI WRITES - there is no web-only
// shape for a name, an address, a wash preference or a spot. A second way of
// storing the same fact is how the text thread and the website come to
// disagree about somebody's laundry.
//
// None of them touches an order or a status. Booking still goes through
// booking.bookPickup() and statuses still go through orders.transition(),
// exactly as before.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The three settings pages the dashboard cards link to.
//
// PAGES, NOT DROPDOWNS. Neil's call. These forms lived inside <details> on the
// dashboard, which meant three long forms folded under one screen and no way to
// send anybody straight to the one they needed - "go to your account, open the
// second card" is not a link.
//
// Each renders the same form the booking wizard uses, so there is one copy of
// every field and one copy of every rule about it.
// ---------------------------------------------------------------------------

function settingsPage({ title, blurb, form, error = '' }) {
  return `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="max-width:600px;padding-top:60px;padding-bottom:44px;">
    <p class="eyebrow eyebrow-brand">Your account</p>
    <h1 class="display-2" style="margin-bottom:10px;">${escapeHtml(title)}</h1>
    <p style="font-size:18px;line-height:1.5;color:var(--ink-800);max-width:44ch;margin:0;">
      ${escapeHtml(blurb)}
    </p>
  </div>
</section>

<section class="container" style="max-width:600px;padding-top:40px;padding-bottom:96px;">
  ${error ? banner(escapeHtml(error)) : ''}
  <div class="card card-xl" style="padding:30px;">${form}</div>
  <p style="margin:22px 0 0;"><a href="/account">Back to your account</a></p>
</section>`;
}

router.get('/account/address', auth.requireCustomer, (req, res) => {
  accountPage(res, {
    title: 'Your address',
    body: settingsPage({
      title: 'Your address',
      blurb: 'Your pickup address, and where the bag will be when we get there.',
      form: setup.addressForm(req.customer),
      error: req.query.error ? String(req.query.error) : '',
    }),
  });
});

router.get('/account/wash', auth.requireCustomer, (req, res) => {
  accountPage(res, {
    title: 'Wash instructions',
    body: settingsPage({
      title: 'Wash instructions',
      blurb: 'Every order from now on uses this, until you change it again.',
      form: setup.washForm(req.customer),
      error: req.query.error ? String(req.query.error) : '',
    }),
  });
});

// ---------------------------------------------------------------------------
// NOTHING IS CALLED BOOKED UNTIL THERE IS A CARD. Neil's rule.
//
// The order row is still written first, and deliberately: a customer sent away
// to pay before their booking exists comes back to nothing, which happened to a
// real one. What changes is what we SAY. The row exists, the day is held, and
// the word "booked" waits for the card - the same distinction the ops board
// already draws between BOOKED and AWAITING CARD, and the account page between
// "Booked in" and "Awaiting card".
//
// No text goes out here either. The confirmation is sent by the Stripe webhook
// once the card is saved, opening with "Card saved", so the first thing that
// number is ever told about this pickup is true when it arrives.
// ---------------------------------------------------------------------------
router.get('/account/payment', auth.requireCustomer, async (req, res, next) => {
  try {
    // ARRIVED HERE STRAIGHT FROM BOOKING, which is the last step of placing an
    // order rather than an errand of its own. The order number is named so the
    // page is plainly about the pickup they just made.
    //
    // Backslash-D, not D. This was /D/g, which strips the letter D out of a number that
    // has never contained one - so anything at all could arrive in the query
    // string and be printed straight back onto the page.
    const booked = String(req.query.booked || '').replace(/\D/g, '');

    // THE DAY WE ARE HOLDING, said back to them. Scoped to this customer, so a
    // number typed into the query string can only ever name their own order.
    let held = null;
    if (booked) {
      const { data } = await db
        .from('orders')
        .select('pickup_date, pickup_time, pickup_window_start, pickup_window_end')
        .eq('customer_id', req.customer.id)
        .eq('order_number', Number(booked))
        .maybeSingle();
      if (data) held = whenLineMdy(data);
    }

    return accountPage(res, {
      title: 'Payment method',
      body: settingsPage({
        title: booked ? 'One last thing' : 'Payment method',
        blurb: booked
          ? `Order #${booked} needs a card.${held ? ` We are holding ${held} for you.` : ''} ` +
            `It is confirmed the moment a card is saved, and nothing is taken until we ` +
            `weigh your laundry.`
          : req.customer.card_last4
            ? 'The card we charge after we weigh your laundry.'
            : 'We need a card before the driver comes out.',
        form: setup.cardForm(req.customer),
        error: req.query.error ? String(req.query.error) : '',
      }),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/account/details', auth.requireCustomer, async (req, res, next) => {
  try {
    const saved = await saveAddress(req.customer, req.body || {});
    if (!saved.ok) return back(res, `?error=${encodeURIComponent(saved.error)}`);
    return back(res, `?saved=${encodeURIComponent('Saved your address.')}`);
  } catch (err) {
    return next(err);
  }
});

router.post('/account/wash', auth.requireCustomer, async (req, res, next) => {
  try {
    const saved = await saveWash(req.customer, req.body || {});
    if (!saved.ok) return back(res, `?error=${encodeURIComponent(saved.error)}`);
    return back(res, `?saved=${encodeURIComponent('Saved how you like it washed.')}`);
  } catch (err) {
    return next(err);
  }
});

// /account/spot is gone. The spot is part of the address form now - see the
// note in /account/details above.

// A POST, AND THE LINK IS MINTED HERE. Building the payment link into the
// dashboard would open a session with the payment provider every time anybody
// loaded the page - the same reason the ops nudge panel shows the card message
// with its link stubbed. One button, one session, on the way through.
// Stopping every standing order. All of them rather than one, because the
// dashboard describes them as a single sentence - picking one out of "every week
// on Monday, and every other week on Friday" needs a screen this portal does not
// have yet, and the AI can already stop one by name.
//
// IT CALLS OFF WHAT THE REPEAT HAD ALREADY BOOKED, and that reverses what was
// here. Neil's call, and it is the honest reading of the button: somebody who
// stops a weekly pickup does not expect a van on Monday. Leaving next week on
// the board meant "stopped" and "still coming" at the same time.
//
// ONLY PICKUPS THE SCHEDULE MADE, and only ones we have not collected. An order
// they booked by hand is theirs and is not touched; a bag already in the van
// cannot be un-collected, and the state machine refuses that anyway.
router.post('/account/repeat/stop', auth.requireCustomer, async (req, res, next) => {
  try {
    const customer = req.customer;

    await recurring.stop(customer);

    const { data: booked, error } = await db
      .from('orders')
      .select('*')
      .eq('customer_id', customer.id)
      .eq('from_schedule', true)
      .in('status', orders.AWAITING_COLLECTION);

    if (error) throw error;

    // THROUGH THE STATE MACHINE, never a direct write - the same rule the ops
    // endpoints follow. Best effort per order: one that refuses must not stop
    // the rest being called off, and the schedule is already ended either way.
    let cancelled = 0;
    for (const order of booked || []) {
      try {
        await orders.transition(order, 'CANCELED');
        cancelled += 1;
      } catch (err) {
        console.error(`Could not cancel #${order.order_number} on stopping a repeat: ${err.message}`);
      }
    }

    const said =
      cancelled === 0
        ? 'Stopped. Nothing was booked yet, so there is nothing to call off.'
        : cancelled === 1
          ? 'Stopped, and the pickup it had booked is canceled. No charge.'
          : `Stopped, and the ${cancelled} pickups it had booked are canceled. No charge.`;

    return back(res, `?saved=${encodeURIComponent(said)}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// The screen after the card is saved.
//
// Neil: "after the payment details are entered it should take you to a screen
// that says a confirmation was sent to you via text."
//
// IT ONLY SAYS THAT BECAUSE IT IS NOW TRUE. The route above sends the text
// through the one shared path before rendering this - it did not, until today:
// the return page saved the card and sent nothing, the webhook saw the card
// already saved and also sent nothing, and whichever arrived first decided
// whether the customer heard anything. A screen promising a text that never
// left would be the worst version of that bug rather than a fix for it.
// ---------------------------------------------------------------------------
function confirmedPage({ customer, orders: waiting }) {
  const card = billing.describeCard(customer);

  const rows = (waiting || [])
    .map(
      (o) => `
      <div style="display:flex;justify-content:space-between;gap:18px;padding:16px 0;border-bottom:1px solid var(--ink-100);">
        <span style="font-size:16px;font-weight:600;color:var(--ink-900);">#${o.order_number}</span>
        <span style="font-size:16px;color:var(--ink-700);text-align:right;">${escapeHtml(whenLineMdy(o))}</span>
      </div>`
    )
    .join('');

  return `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="max-width:600px;padding-top:60px;padding-bottom:44px;">
    <p class="eyebrow eyebrow-brand">Place an order &middot; done</p>
    <h1 class="display-2" style="margin-bottom:10px;">You're booked.</h1>
    <p style="font-size:18px;line-height:1.5;color:var(--ink-800);max-width:44ch;margin:0;">
      We have texted your confirmation to
      <strong>${escapeHtml(formatPhone(customer.phone))}</strong>.
    </p>
  </div>
</section>

<section class="container" style="max-width:600px;padding-top:40px;padding-bottom:96px;">

  <div class="card card-xl" style="padding:26px 30px;">
    <p class="eyebrow" style="margin-bottom:6px;">${
      (waiting || []).length === 1 ? 'Your pickup' : 'Your pickups'
    }</p>
    ${rows || '<p style="font-size:16px;color:var(--ink-700);margin:12px 0 0;">Nothing booked yet.</p>'}
  </div>

  <!-- THE THREE THINGS SOMEBODY WANTS TO KNOW after handing over a card, and
       the first one is the point: nothing has been taken. -->
  <div class="card card-xl card-sunken" style="padding:26px 30px;margin-top:18px;">
    <div style="display:flex;justify-content:space-between;gap:18px;padding-bottom:14px;">
      <span style="font-size:16px;color:var(--ink-700);">Charged today</span>
      <span style="font-size:16px;font-weight:700;color:var(--ink-900);">$0.00</span>
    </div>
    <div style="display:flex;justify-content:space-between;gap:18px;padding-bottom:14px;">
      <span style="font-size:16px;color:var(--ink-700);">Card on file</span>
      <span style="font-size:16px;font-weight:700;color:var(--ink-900);">${escapeHtml(card || 'saved')}</span>
    </div>
    <div style="display:flex;justify-content:space-between;gap:18px;">
      <span style="font-size:16px;color:var(--ink-700);">You are charged</span>
      <span style="font-size:16px;font-weight:700;color:var(--ink-900);text-align:right;">after we weigh it</span>
    </div>
  </div>

  <p style="margin:26px 0 0;"><a href="/account">Back to your account</a></p>
</section>`;
}

// ---------------------------------------------------------------------------
// GET /account/card/done/:token - back from Stripe, into their own account.
//
// Neil: "after you enter your information, it takes you back to your account
// page." Somebody who pressed a button inside their account belongs back in it,
// not on the standalone "card saved" page that a texted link lands on. Both
// still record the card the same way; only the destination differs.
//
// IT READS THE CARD BACK ITSELF rather than waiting for the webhook. The
// webhook is what makes this reliable - it arrives whatever the browser did -
// but it can be seconds late, and an account page still showing "no card on
// file" straight after saving one is a page that gets reported as broken.
// Whichever gets there first wins; the loser sees completed_at and does
// nothing.
// ---------------------------------------------------------------------------
router.get('/account/card/done/:token', auth.requireCustomer, async (req, res, next) => {
  try {
    const { data: link, error } = await db
      .from('payment_links')
      .select('*, customers(*)')
      .eq('token', req.params.token)
      // SCOPED TO THE PERSON SIGNED IN. The token is unguessable, but a link is
      // still a link: without this, one forwarded to somebody else would put a
      // card on an account that is not theirs.
      .eq('customer_id', req.customer.id)
      .maybeSingle();

    if (error) throw error;
    if (!link) return back(res, '');

    let customer = req.customer;

    if (!link.completed_at) {
      // THE WHOLE JOB, THROUGH THE ONE PATH BOTH OTHER DOORS USE. It records
      // the card, settles anything owed, confirms the booking that was waiting
      // on it and sends the text. It used to call recordSavedCard() alone,
      // which saves the card and sends nothing - and the webhook then saw
      // completed_at and stayed quiet, so whoever got here first decided
      // whether the customer heard anything at all.
      //
      // They may have closed the page rather than finished, in which case there
      // is no card to read and this quietly returns null.
      const updated = await cardSaved.cardWasSaved(link).catch((err) => {
        console.error('Could not finish saving the card:', err.message);
        return null;
      });
      if (updated) customer = updated;
    }

    // NOT SAVED IS NOT AN ERROR. They changed their mind or closed the tab, and
    // the pickup is still theirs - it simply is not confirmed until a card is
    // on it. The dashboard already says so on its own card, in red, so there is
    // nothing to add here.
    if (!billing.hasPaymentMethod(customer)) return back(res, '');

    const waiting = await orders.findAllAwaitingCollection(customer.id).catch(() => []);

    // BACK FROM THE LAST STEP OF PLACING AN ORDER: on to the thank-you page,
    // the one every online order ends on. A redirect rather than rendering it
    // here, so the address bar stops carrying the payment token and a refresh
    // is harmless. A number that matches none of their pickups falls through
    // to the page below rather than an error.
    const placed = String(req.query.order || '').replace(/\D/g, '');
    const order = placed ? waiting.find((o) => String(o.order_number) === placed) : null;

    if (order) return res.redirect(303, `/account/thanks?order=${order.order_number}`);

    return accountPage(res, {
      title: 'Pickup confirmed',
      body: confirmedPage({ customer, orders: waiting }),
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /account/thanks?order=<number> - where every online order ends.
//
// Neil: "always give the thank you page for ordering." Two ways reach it: back
// from Stripe once the card is saved, and straight from POST /account/book when
// a card was already on file. Both have sent the confirmation text before they
// redirect here, which is what lets the page say "check your texts".
//
// ONLY A BOOKED ORDER GETS THANKED. The order is looked up among THIS
// customer's pickups still waiting for us, so a number typed into the address
// bar can only show them their own. And an order still waiting on a card is not
// booked and has had no confirmation text, so it goes to the account page,
// which says "Awaiting card" in as many words.
//
// THE GOOGLE ADS TAG IS ON ONLY WHEN POST /account/book LEFT A MARKER, which is
// the card-on-file order arriving for the first time. The card path was already
// counted at the card step, and a refresh finds the marker gone. The order
// number rides in the query string, and stripQuery keeps it out of Google.
// ---------------------------------------------------------------------------
router.get('/account/thanks', auth.requireCustomer, async (req, res, next) => {
  try {
    const customer = req.customer;
    const placed = String(req.query.order || '').replace(/\D/g, '');
    const waiting = placed ? await orders.findAllAwaitingCollection(customer.id) : [];
    const order = waiting.find((o) => String(o.order_number) === placed);

    if (!order || billing.needsCardOnFile(customer)) return back(res, '');

    const free = await promotions
      .claimedFreeOrder(order.id)
      .catch(() => ({ freeOrder: false, freeUpToLb: null }));

    const lead = adAttribution.takeLead(req, res, '/account/thanks');

    return accountPage(res, {
      title: 'Thank you for your order',
      body: orderConfirmedPage({
        customer,
        order,
        others: waiting.filter((o) => o.id !== order.id),
        free,
      }),
      tracking: Boolean(lead),
      conversionId: lead,
      stripQuery: true,
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// THANK YOU FOR YOUR ORDER. Neil, 11 September: after the card, the customer
// should land on "a confirmation page that says thank you for your order,
// please check your texts from our text number, here is your order number, we
// will pick it up on... and it should lay out the order details."
//
// EVERY DETAIL IS READ FROM WHERE THE TEXT READS IT. The card from
// describeCard(), the wash from wash.describeSaved(), the bag spot from the
// same spotOf() the step before used, and whether it is free from
// claimedFreeOrder() - the exact lookup the confirmation text makes - so the
// page and the text can never describe two different orders.
//
// "Check your texts" is true by the time this renders, whichever way they came:
// POST /account/book texts the confirmation before redirecting, and the card
// path's return page sends it through cardSaved.cardWasSaved() (or the webhook
// already had). Rendered only by GET /account/thanks.
// ---------------------------------------------------------------------------
function orderConfirmedPage({ customer, order, others, free }) {
  const card = billing.describeCard(customer);
  const prefs = customer.preferences || {};
  const spot = setup.spotOf(customer);
  const access = setup.accessNotesOf(customer);
  const washed = booking.hasPreferences(customer) ? wash.describeSaved(prefs) : '';
  const where = [
    customer.address_line1,
    customer.address_line2,
    [customer.city, [customer.state, customer.postal_code].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', '),
  ]
    .filter(Boolean)
    .map((line) => escapeHtml(line))
    .join('<br>');

  const row = (label, value, last = false) => `
    <div style="display:flex;justify-content:space-between;gap:18px;${last ? '' : 'padding-bottom:14px;'}">
      <span style="font-size:16px;color:var(--ink-700);">${label}</span>
      <span style="font-size:16px;font-weight:700;color:var(--ink-900);text-align:right;">${value}</span>
    </div>`;

  const detail = (label, value) => `
    <div style="border-top:1px solid var(--ink-100);margin-top:16px;padding-top:14px;">
      <p class="eyebrow" style="margin:0 0 6px;">${label}</p>
      <p style="font-size:16px;line-height:1.5;color:var(--ink-800);margin:0;">${value}</p>
    </div>`;

  // THE PRICE, SAID THE WAY THE TEXT SAYS IT. A free order with a ceiling names
  // the ceiling, because nobody has seen the laundry yet.
  const price = free.freeOrder
    ? free.freeUpToLb
      ? `Free up to ${free.freeUpToLb} lb, then ${site.pricePerLb} a pound`
      : 'Free, nothing to pay'
    : `${site.pricePerLb} a pound, ${billing.money(config.pricing.minimumCents)} minimum`;

  const textUs = site.hasPublicPhone
    ? ` from <a href="sms:${escapeHtml(site.publicPhoneLink)}" style="white-space:nowrap;"><strong>${escapeHtml(
        site.publicPhoneDisplay
      )}</strong></a>`
    : '';

  return `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="max-width:600px;padding-top:60px;padding-bottom:44px;">
    <p class="eyebrow eyebrow-brand">Place an order &middot; done</p>
    <h1 class="display-2" style="margin-bottom:10px;">Thank you for your order.</h1>
    <p style="font-size:18px;line-height:1.5;color:var(--ink-800);max-width:44ch;margin:0;">
      Please check your texts${textUs}. Your confirmation is there.
    </p>
  </div>
</section>

<section class="container" style="max-width:600px;padding-top:40px;padding-bottom:96px;">

  <div class="card card-xl" style="padding:26px 30px;">
    <p class="eyebrow" style="margin:0 0 4px;">Order number</p>
    <p class="display-4" style="margin:0;font-variant-numeric:tabular-nums;">#${escapeHtml(String(order.order_number))}</p>

    <div style="border-top:1px solid var(--ink-100);margin-top:18px;padding-top:16px;">
      <p class="eyebrow" style="margin:0 0 6px;">We will pick it up</p>
      <p style="font-size:18px;line-height:1.45;font-weight:600;color:var(--ink-900);margin:0;">
        ${escapeHtml(whenLineMdy(order))}
      </p>
    </div>

    ${detail(
      'Pickup address',
      `${customer.name ? `<strong>${escapeHtml(customer.name)}</strong><br>` : ''}${where}`
    )}
    ${detail('Where to leave the bag', escapeHtml(spot ? 'At the ' + midSentence(spot) : 'Outside your door'))}
    ${access ? detail('Getting to it', escapeHtml(access)) : ''}
    ${washed ? detail('How we wash it', escapeHtml(washed)) : ''}
  </div>

  <div class="card card-xl card-sunken" style="padding:26px 30px;margin-top:18px;">
    ${row('Charged today', '$0.00')}
    ${card ? row('Card on file', escapeHtml(card)) : ''}
    ${row('Price', escapeHtml(price), free.freeOrder && !free.freeUpToLb)}
    ${free.freeOrder && !free.freeUpToLb ? '' : row('You are charged', 'after we weigh it', true)}
  </div>

  ${
    others.length
      ? `<div class="card card-xl" style="padding:22px 30px;margin-top:18px;">
           <p class="eyebrow" style="margin-bottom:6px;">Also booked</p>
           ${others
             .map(
               (o) => `
           <div style="display:flex;justify-content:space-between;gap:18px;padding:12px 0;border-bottom:1px solid var(--ink-100);">
             <span style="font-size:16px;font-weight:600;color:var(--ink-900);">#${escapeHtml(String(o.order_number))}</span>
             <span style="font-size:16px;color:var(--ink-700);text-align:right;">${escapeHtml(whenLineMdy(o))}</span>
           </div>`
             )
             .join('')}
         </div>`
      : ''
  }

  <p style="margin:26px 0 0;"><a href="/account">Back to your account</a></p>
</section>`;
}
// STRAIGHT TO STRIPE, NOTHING OF OURS IN BETWEEN. This is what the Update
// button on the payment card posts to: it mints the session and redirects, so
// the next thing the customer sees is the card page itself.
//
// A FAILURE COMES BACK HERE RATHER THAN TO THE ERROR PAGE. It used to call
// next(err), which is right for a bug and wrong for this: somebody pressed a
// button on their own account and the honest answer is a sentence on the page
// they were just on, not a generic apology screen with no way forward. The
// details still go to the server log, where they are of use to somebody.
router.post('/account/card', auth.requireCustomer, async (req, res) => {
  try {
    // providerUrl, not url. `url` is lyndry.com/pay/<token>, which exists for
    // links we TEXT: a carrier scores a message partly by the domain in it, so
    // every texted link is on our own. In a browser that indirection buys
    // nothing and costs a hop - and the session was minted a millisecond ago,
    // so the one thing /pay/<token> adds, re-minting an expired session,
    // cannot apply. The row is still written, so the webhook still resolves.
    // Back into their account afterwards rather than onto the standalone page
    // a texted link lands on. See createSetupLink() for how the token gets in.
    //
    // ?order= IS ONLY SET FROM THE LAST STEP OF PLACING AN ORDER, and it is
    // what turns the page they come back to into that order's confirmation.
    // Digits only, because it rides in a URL we hand to Stripe; the page it
    // reaches only ever looks it up among this customer's own pickups.
    const placed = String((req.body || {}).order || '').replace(/\D/g, '').slice(0, 9);
    const { providerUrl } = await billing.createSetupLink(req.customer, {
      returnTo: `/account/card/done/{token}${placed ? `?order=${placed}` : ''}`,
    });
    return res.redirect(303, providerUrl);
  } catch (err) {
    console.error('Could not open the card page:', err.message);
    return back(
      res,
      `?error=${encodeURIComponent('We could not open the card page just then. Try again in a moment.')}`
    );
  }
});

// ---------------------------------------------------------------------------
// Saving the two things that carry between orders.
//
// ONE IMPLEMENTATION EACH, because there are two doors onto both now: the
// settings page, and the step inside placing an order. Two copies would drift
// the first time one learned something the other did not - the same rule
// booking.js follows for the AI and the web form.
//
// They return a message instead of writing a response, so the caller decides
// where to send somebody: the settings page bounces back to the dashboard, the
// wizard re-renders its own step with the error above the form.
// ---------------------------------------------------------------------------

async function saveAddress(customer, form) {
  const name = String(form.name || '').trim();
  const addressLine1 = String(form.address_line1 || '').trim();
  const city = String(form.city || '').trim();
  const postalCode = String(form.postal_code || '').trim();
  // THE LIST OR THE BOX, NEVER BOTH. "Somewhere else" with nothing typed is
  // not an answer, and it is the one the driver acts on - so it is refused
  // rather than saved as a blank that reads on the run sheet as "we were never
  // told".
  const chosen = String(form.spot || '').trim();
  const spot =
    chosen === 'OTHER' ? String(form.spot_other || '').trim() : chosen;

  if (!name) return { ok: false, error: 'Please tell us your name.' };
  if (!addressLine1 || !city) {
    return { ok: false, error: 'Please give us a street address and a town.' };
  }
  if (!/^\d{5}$/.test(postalCode)) {
    return { ok: false, error: 'Please enter a five-digit ZIP code.' };
  }

  // THE ZIP IS CHECKED HERE, NOT ONLY AT BOOKING. Saving an address outside
  // Bergen and then refusing the booking tells somebody twice, the second time
  // after they have picked a day. booking.inServiceArea() is the same list
  // bookPickup() uses, so the two cannot disagree.
  if (!booking.inServiceArea({ postal_code: postalCode })) {
    return {
      ok: false,
      error:
        `We only cover ${site.serviceArea} at the moment, so we cannot pick up from ` +
        `${postalCode} yet. Text us and we will let you know when that changes.`,
    };
  }

  if (chosen === 'OTHER' && !spot) {
    return { ok: false, error: 'Please type where the driver should find the bag.' };
  }
  if (!spot) return { ok: false, error: 'Please say where the driver should find the bag.' };

  // MERGED, NOT REPLACED. preferences is one JSON column that also holds the
  // wash choices and the default pickup method; writing a fresh object would
  // silently drop all of them.
  //
  // THE SPOT GOES WHERE THE AI WRITES IT. special_instructions is the field the
  // thread has always used for a pickup spot, and where every existing
  // customer's lives; dropoff_spot is only for wanting the clean laundry left
  // somewhere different. Writing it to the other one would leave the driver
  // reading a blank on the run sheet.
  const preferences = {
    ...(customer.preferences || {}),
    special_instructions: spot.slice(0, 120),
    // Blank clears it rather than storing an empty string, so "do they have
    // access notes" is one question and not two.
    access_notes: String(form.access_notes || '').trim().slice(0, 400) || null,
  };

  const changes = {
    name,
    address_line1: addressLine1,
    address_line2: String(form.address_line2 || '').trim() || null,
    city,
    state: 'NJ',
    postal_code: postalCode,
    preferences,
  };

  const { error } = await db.from('customers').update(changes).eq('id', customer.id);
  if (error) throw error;

  return { ok: true, customer: { ...customer, ...changes } };
}

// The weekdays they ticked, as numbers Sunday=0, deduplicated and in order.
// A checkbox group arrives as a string when one is ticked and an array when
// several are, which is the classic way a form parser catches somebody out.
function weekdaysFrom(form) {
  const raw = form.weekday === undefined ? [] : [].concat(form.weekday);
  const days = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
  return days.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Setting up a standing order, and working out when its first pickup is.
//
// ONE SCHEDULE PER WEEKDAY. recurring_schedules is one row per arrangement, so
// "every Monday and Thursday" is two rows - which is what lets somebody stop
// one of them later without stopping both.
//
// IT RETURNS THE FIRST DATE so the caller can book a real pickup for it. The
// nightly pass would get there on its own, but only the day before - and
// somebody who has just set up a weekly pickup should see a pickup, not an
// empty board and a promise.
async function startSchedules(customer, { cadence, weekdays, timeOfDay }) {
  const made = [];

  for (const weekday of weekdays) {
    made.push(await recurring.addSchedule(customer, { cadence, weekday, timeOfDay }));
  }

  const dates = made.map((s) => recurring.nextDate(s)).filter(Boolean).sort();
  return { schedules: made, firstDate: dates[0] || null };
}

async function saveWash(customer, form) {
  // VALIDATED THROUGH wash.js. No defaults and no guessing: an unanswered
  // option is refused rather than filled in, which is the rule that exists
  // because "we've set you up with cold water" went to a real customer who had
  // chosen nothing.
  for (const key of wash.KEYS) {
    if (!wash.isValid(key, form[key])) {
      return { ok: false, error: 'Please answer both parts of how you like it washed.' };
    }
  }

  const preferences = { ...(customer.preferences || {}) };
  for (const key of wash.KEYS) preferences[key] = form[key];

  const { error } = await db.from('customers').update({ preferences }).eq('id', customer.id);
  if (error) throw error;

  return { ok: true, customer: { ...customer, preferences } };
}

// ---------------------------------------------------------------------------
// PLACING AN ORDER, AND COLLECTING WHATEVER IS MISSING ON THE WAY.
//
// Neil's call, and it reverses the old shape. The dashboard used to refuse to
// link here until an address and wash preferences existed, which put a setup
// form in front of the only reason anybody signed in. Now the order is the way
// IN: the button is always live, and each step asks for the next thing the
// booking actually needs, in the order the person is already thinking about it.
//
//   wash      how you like it washed        (skipped if already saved)
//   when      the day, the time, the bag    (always)
//   address   where we come, where the bag is  (skipped if already saved)
//   -> the order is written here <-
//   card      handled by /account/payment   (skipped if already saved)
//
// THE ADDRESS COMES AFTER THE DAY, WHICH IS A REAL TRADE AND A DELIBERATE ONE.
// It means somebody outside Bergen answers two steps before being told we
// cannot come. Asking for it first would catch that sooner, and Neil chose the
// other way: the person is already motivated, the two steps are thirty seconds,
// and leading with "where do you live" reads as a form rather than an order.
//
// WASH AND ADDRESS ARE SAVED AS THEY ARE ANSWERED, because both are permanent
// settings rather than facts about this one order - so somebody who abandons
// halfway has still told us, and never gets asked again. Only the day and time
// are carried between steps, in hidden fields, because there is nowhere to put
// them until the order exists.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WHO IS PLACING THIS ORDER.
//
// Either a signed-in customer, or somebody who typed a number on the way in
// and has no account yet. The wizard runs the same for both; the difference is
// where the answers go.
//
// A CUSTOMER'S ANSWERS ARE SAVED AS THEY GO, because there is a row to save
// them to and they are permanent settings. A GUEST'S ARE CARRIED IN THE FORM,
// because there is nothing to save them to yet - and deliberately so: we do
// not want a half-finished stranger in the customers table, and we may not
// write a consent record for somebody who has not ticked the box.
//
// The synthetic customer below is enough for every screen the wizard draws -
// it has a phone and empty preferences - and has no id, which is what stops
// anything trying to write against it.
// ---------------------------------------------------------------------------
function whoIsOrdering(req) {
  if (req.customer) return { customer: req.customer, guest: false };

  const phone = auth.readGuest(req);
  if (!phone) return { customer: null, guest: false };

  return { customer: { phone, preferences: {} }, guest: true };
}

// A guest carries every answer in the form, so the wizard needs them all back
// out of it to know what is still missing.
function withAnswers(customer, given) {
  const preferences = { ...(customer.preferences || {}) };
  for (const key of wash.KEYS) if (given[key]) preferences[key] = given[key];
  if (given.spot) preferences.special_instructions = given.spot;

  return {
    ...customer,
    name: given.name || customer.name,
    address_line1: given.address_line1 || customer.address_line1,
    address_line2: given.address_line2 || customer.address_line2,
    city: given.city || customer.city,
    postal_code: given.postal_code || customer.postal_code,
    preferences,
  };
}

// ---------------------------------------------------------------------------
// THE SCREENS, IN ORDER. CONTINUE GOES TO THE NEXT ONE. BACK GOES TO THE ONE
// BEFORE. Neither of them looks at what has been answered to decide WHERE to
// go, and that is the fix.
//
// It used to work out the next screen by asking what was still missing, which
// is right when you arrive and wrong the moment you walk backwards: press Back
// twice, press Continue, and the answers you already gave made the screen you
// had just come from look answered, so it was skipped. Continue jumped over
// "when" and, from there, straight past "where" into booking the order.
//
// A SCREEN IS SKIPPED ONLY WHEN ITS ANSWER IS ON THE CUSTOMER'S ROW - saved,
// permanently, from a previous order. That is the "we ask once" rule and it is
// the only reason a screen may be missed out.
//
// The two middle screens are never skipped, because they are about THIS
// pickup: how often, and which day. An answer in the form is this booking's
// answer, not a saved setting, and must never take its own screen away.
//
// A GUEST HAS NO ROW, so a guest walks all four, always, in the same order
// every time.
const ORDER = ['wash', 'repeat', 'when', 'address'];

function alreadySaved(step, customer) {
  if (step === 'wash') return booking.hasPreferences(customer);
  if (step === 'address') {
    return setup.hasName(customer) && booking.hasAddress(customer) && Boolean(setup.spotOf(customer));
  }
  return false;
}

// The next screen they have not been shown, or 'book' when there are none left.
// 'book' is not a screen: reaching it is what writes the order.
function nextStep(from, customer) {
  for (let i = ORDER.indexOf(from) + 1; i < ORDER.length; i += 1) {
    if (!alreadySaved(ORDER[i], customer)) return ORDER[i];
  }
  return 'book';
}

// The mirror of it, so Back cannot land on a screen Continue would have
// skipped. Null means there is nothing behind this one inside the wizard.
function previousStep(from, customer) {
  for (let i = ORDER.indexOf(from) - 1; i >= 0; i -= 1) {
    if (!alreadySaved(ORDER[i], customer)) return ORDER[i];
  }
  return null;
}

// WHAT THIS SCREEN STILL NEEDS BEFORE IT MAY BE LEFT. Continue used to be
// unable to skip a blank screen only because the next-screen calculation was
// the same one that noticed the blank. Now that they are separate, the check
// has to be written down.
function unanswered(step, given) {
  if (step === 'repeat' && given.regular === undefined) {
    return 'Please choose whether this is a regular pickup.';
  }

  if (step === 'when') {
    if (given.regular === 'yes' && !String(given.weekdays || '').trim()) {
      return 'Please pick at least one day.';
    }
    if (given.regular !== 'yes' && !given.pickup_date) return 'Please pick a day.';
    if (!given.pickup_time) return 'Please pick a time.';
  }

  return null;
}

// Where somebody ARRIVING at the wizard starts: the first thing still missing.
// This is the one place it is right to ask, because they have not been shown
// anything yet.
function bookingStep(customer, given) {
  if (!booking.hasPreferences(customer)) return 'wash';

  // REGULAR OR NOT COMES FIRST, because the answer decides what the next
  // screen even asks. A one-off wants a date; a standing order wants weekdays
  // and never a date at all, and asking for both on one screen means half the
  // form is always irrelevant. `regular` is present on every submission from
  // that step, including "no", so an empty string is an answer and undefined
  // is "not asked yet".
  if (given.regular === undefined) return 'repeat';

  const regular = given.regular === 'yes';
  if (regular && !String(given.weekdays || '').trim()) return 'when';
  if (!regular && !given.pickup_date) return 'when';
  if (!given.pickup_time) return 'when';
  if (!setup.hasName(customer) || !booking.hasAddress(customer) || !setup.spotOf(customer)) {
    return 'address';
  }
  return 'book';
}

// Everything the wizard has been told so far, in the order it was asked for.
const ANSWERS = [
  'pickup_date', 'pickup_time', 'notes', 'regular', 'cadence', 'weekdays',
  'water_temp', 'fabric_softener', 'name', 'address_line1', 'address_line2',
  'city', 'postal_code', 'spot', 'access_notes',
];

// WHICH ANSWERS EACH SCREEN ASKS FOR ITSELF. A screen must not also carry them
// as hidden fields: two inputs of one name post an array, and the answer that
// reaches the other end is neither of them.
// ---------------------------------------------------------------------------
// BACK GOES BACK ONE SCREEN, NOT OUT OF THE ORDER.
//
// It was a link to /account, so pressing it on the third screen threw away the
// two answers behind it and dropped you on the dashboard.
//
// IT IS A SUBMIT BUTTON, NOT A LINK, and that is the whole design. A link can
// only carry the answers in the URL, which would put somebody's name and street
// address in their browser history and in every server log. Posting sends them
// in the body exactly as Continue does, so going back keeps every answer and
// leaks none of them.
//
// Nor is it history.back(): every screen here arrives as the response to a POST,
// so the browser would meet it with a "confirm form resubmission" page.
const ASKED_ON = {
  wash: ['water_temp', 'fabric_softener'],
  repeat: ['regular'],
  when: ['pickup_date', 'pickup_time', 'weekdays', 'cadence', 'regular'],
  address: ['name', 'address_line1', 'address_line2', 'city', 'postal_code',
            'spot', 'access_notes'],
};

// ---------------------------------------------------------------------------
// THE ANSWERS ALREADY GIVEN, CARRIED FORWARD AS HIDDEN INPUTS.
//
// EVERY SCREEN IN THE WIZARD HAS TO CALL THIS, and two of them did not - which
// is the loop Neil found: a guest answered the wash question, the next screen
// carried nothing, so the answer was gone by the time it posted and the wizard
// asked how they liked it washed all over again, radios blank.
//
// A signed-in customer never saw it. Their wash and address are written to their
// row as they go, so the answers survive whether or not a form carries them; a
// guest has no row yet by design, and the form is the only place their answers
// exist.
// ---------------------------------------------------------------------------
function carried(given, step) {
  const asked = ASKED_ON[step] || [];

  // AN EMPTY ANSWER IS STILL AN ANSWER, and this is the second half of the same
  // loop. "No, just this once" posts regular="", which is falsy - so a filter on
  // the value dropped it, the address step posted without it, and bookingStep()
  // read "not asked yet" and sent them back to the how-often screen with their
  // address already typed in.
  //
  // Carrying a blank is safe because ASKED_ON above has already taken out
  // whatever this screen asks for itself: a hidden field can no longer collide
  // with a visible one of the same name, which is the only reason the value was
  // being tested in the first place.
  return ANSWERS
    .filter((k) => given[k] !== undefined && given[k] !== null && !asked.includes(k))
    .map(
      (k) => `<input type="hidden" name="${k}" value="${escapeHtml(String(given[k]))}">`
    )
    .join('');
}

// The consent wording, character for character. It appears on the home page
// hero and in the blockquote on /sms-terms as well, and a carrier comparing the
// three expects to find one sentence. They drifted apart once already.
function consentTick() {
  return `
        <label class="check" style="margin-top:6px;">
          <input type="checkbox" id="sms_consent" name="sms_consent" value="yes" required>
          <span class="check-box">{{ICON_CHECK}}</span>
          <span class="check-text" style="color:var(--ink-800);">
            By checking this box you agree to receive text messages from lyndry at
            the number provided, including messages sent by autodialer. Consent is
            not a condition of purchase. Message and data rates may apply. Message
            frequency varies. Reply HELP for help, STOP to cancel. See our
            <a href="/privacy">Privacy Policy</a> and <a href="/sms-terms">SMS Terms</a>.
          </span>
        </label>`;
}

// The first screen has nothing behind it, so there it is a plain link out.
//
// formnovalidate, because going back must never be refused for a field they
// have not filled in yet - that is the whole reason they are going back. The
// button sits OUTSIDE the form and is tied to it by id, the same way the Send
// it button on an ops thread is, because the markup around it is not the form.
function backControl(step, guest, customer) {
  // A GUEST HAS NOTHING SAVED, so no screen behind them was skipped. The
  // customer object here is the synthetic one built from the form, and asking
  // IT what is saved would say the wash screen had been skipped the moment they
  // answered it - putting Back out of the wizard from screen two.
  const previous = previousStep(step, guest ? { preferences: {} } : customer);

  // THE FIRST SCREEN GOES BACK TOO, and where it goes depends on who is
  // standing on it. A guest arrived from the number box, so that is what Back
  // means to them - and their number is drawn back into it, because being sent
  // back to an empty field is being asked the question a second time. Somebody
  // signed in came from their account.
  if (!previous) return `<a href="${guest ? '/account/login' : '/account'}">Back</a>`;

  return `<button type="submit" form="wizard" name="back" value="${previous}" formnovalidate
                  class="btn-link" style="background:none;border:0;padding:0;font:inherit;
                  color:var(--suds-700);text-decoration:underline;cursor:pointer;">Back</button>`;
}

function stepPage({ customer, step, given, error = '', opensOn = null, guest = false }) {
  // NAMED, NOT NUMBERED. This counted "step N of M", and M was recomputed from
  // the customer on every render - so the moment the wash step saved, the total
  // dropped while the index kept climbing and it read "step 3 of 2". Carrying a
  // total through the flow would fix the arithmetic and still be a number nobody
  // needs; the step's own name says where you are and cannot go wrong.
  const labels = { wash: 'wash preferences', repeat: 'how often', when: 'when', address: 'where' };

  const regular = given.regular === 'yes';

  const heads = {
    wash: ['How would you like it washed?', 'We save this and use it on every pickup. Change it any time by text.'],
    repeat: ['One pickup, or regularly?', 'You can change or cancel a regular pickup any time.'],
    when: regular
      ? ['Which days?', 'Pick as many as you like. We come at the same time on each.']
      : ['Schedule your pickup', 'Any day. There are no fixed route days.'],
    address: ['Where should we pick up?', 'Address, and where to leave the bag.'],
  };

  const [title, blurb] = heads[step];

  // The wash and address forms are the same ones the settings pages use, with
  // their action pointed back at the wizard so the answer carries the order
  // details with it rather than saving and dropping them.
  const form =
    step === 'repeat'
      ? repeatForm(given)
      : step === 'when'
      ? whenForm(customer, given, opensOn)
      : (step === 'wash' ? setup.washForm(customer) : setup.addressForm(customer))
          .replace(/action="\/account\/(wash|details)"/, 'action="/account/book" id="wizard"')
          .replace('<div class="stack">', `<div class="stack">${carried(given, step)}<input type="hidden" name="step" value="${step}">`)
          // The same form serves the settings page, where "Save" is right. Inside
          // the wizard there is another step after this one, so it says so.
          .replace(/>\s*Save {{ICON_ARROW}}/, '>Continue {{ICON_ARROW}}')
          // THE TICK BOX GOES ON THE ADDRESS STEP, AND ONLY FOR A GUEST.
          //
          // This is the screen where an account gets created, and the first
          // message we would ever send that number is the confirmation for the
          // order they are about to place - so this is the moment consent has
          // to be captured, with a timestamp and an IP behind it.
          //
          // A signed-in customer never sees it: they agreed once already, and
          // their original record is the one that counts if anybody asks.
          .replace(
            '<button type="submit"',
            guest && step === 'address'
              ? consentTick() + '<button type="submit"'
              : '<button type="submit"'
          );

  return `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="max-width:600px;padding-top:60px;padding-bottom:44px;">
    <p class="eyebrow eyebrow-brand">Place an order &middot; ${escapeHtml(labels[step])}</p>
    <h1 class="display-2" style="margin-bottom:10px;">${escapeHtml(title)}</h1>
    <p style="font-size:18px;line-height:1.5;color:var(--ink-800);max-width:44ch;margin:0;">
      ${escapeHtml(blurb)}
    </p>
  </div>
</section>

<section class="container" style="max-width:600px;padding-top:40px;padding-bottom:96px;">
  ${error ? banner(escapeHtml(error)) : ''}
  <div class="card card-xl" style="padding:30px;">${form}</div>
  <p style="margin:22px 0 0;">${backControl(step, guest, customer)}</p>
</section>`;
}

// ---------------------------------------------------------------------------
// STEP: the card, on the screen the address was on.
//
// Neil: "Don't make add a card its own page. That's why it feels like a
// surprise bill. On US checkout, address and card live in one flow."
//
// So Continue on the address screen sends nobody anywhere. The pickup is
// written, said back to them at the top, and a panel opens underneath with
// Stripe's own card field in it. Finishing that goes to the confirmation,
// which is the only page change in the whole sequence.
//
// THE FIELD IS STRIPE'S, DRAWN INSIDE OUR PAGE. It is an iframe served from
// js.stripe.com, so a card number still never touches this server or this
// markup - the same guarantee the hosted page gave, without the hop. What we
// hand it is a client secret, which authorises attaching a card to this one
// setup and nothing else: it cannot charge, read a card, or reach another
// customer.
//
// AND IF THE SCRIPT NEVER LOADS THERE IS STILL A WAY THROUGH. The panel ships
// with a plain link to the hosted page, and the script removes that link only
// once the field has actually mounted - on the element's own ready event,
// rather than hopefully, one line after asking for it. A blocked script, a
// dead CDN or an old browser leaves somebody with a working link instead of a
// grey box. Same fail-safe rule the scroll reveal follows.
// ---------------------------------------------------------------------------
// The spot is stored the way it is shown on its own line - "Front door" - and
// reads wrong dropped into the middle of a sentence. Only the first letter
// moves, so a spot somebody typed themselves keeps whatever case they used.
function midSentence(text) {
  const s = String(text || '').trim();
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function cardStep({ customer, order }) {
  const when = whenLineMdy(order);
  const where = [customer.address_line1, customer.address_line2, customer.city]
    .filter(Boolean)
    .join(', ');

  // Through setup.spotOf(), which reads dropoff_spot and then the older
  // special_instructions - the same order run.spotOf() uses. Reading only one
  // of the two says nothing for almost every customer who has told us.
  const spot = setup.spotOf(customer);


  return `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="max-width:600px;padding-top:60px;padding-bottom:44px;">
    <p class="eyebrow eyebrow-brand">Place an order &middot; where</p>
    <h1 class="display-2" style="margin-bottom:10px;">Where should we pick up?</h1>
    <p style="font-size:18px;line-height:1.5;color:var(--ink-800);max-width:44ch;margin:0;">
      Address, and where to leave the bag.
    </p>
  </div>
</section>

<section class="container" style="max-width:600px;padding-top:40px;padding-bottom:96px;">

  <!-- THE SAME SCREEN, NOT THE NEXT ONE. Neil, twice: Continue must not take
       you anywhere, it reveals the payment underneath.

       So the heading above is the heading they were already reading, and the
       address they just typed is still the first thing on the page - ticked
       now rather than gone. What changed is that a panel opened below it. -->
  <div class="card card-xl" style="padding:26px 30px;">
    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:16px;">
      <span class="eyebrow" style="margin:0;">Address</span>
      <span class="badge" style="background:var(--suds-500);">Confirmed</span>
    </div>

    <p style="font-size:17px;line-height:1.5;color:var(--ink-900);margin:0 0 4px;font-weight:600;">
      ${escapeHtml(customer.name || '')}
    </p>
    <p style="font-size:16px;line-height:1.5;color:var(--ink-700);margin:0;">
      ${escapeHtml(where)}
    </p>
    <p style="font-size:16px;line-height:1.5;color:var(--ink-700);margin:8px 0 0;">
      ${escapeHtml(spot ? 'Bag at the ' + midSentence(spot) : 'Bag outside your door')}
    </p>

    <div style="border-top:1px solid var(--ink-100);margin-top:18px;padding-top:16px;">
      <p class="eyebrow" style="margin:0 0 6px;">Pickup</p>
      <p style="font-size:17px;line-height:1.45;font-weight:600;color:var(--ink-900);margin:0;">
        ${escapeHtml(when)}
      </p>
    </div>
  </div>

  <!-- THE PANEL THAT OPENED. Sunken grey rather than another white card, so it
       reads as a drawer under the address rather than a second page stacked on
       the first.

       A BUTTON TO STRIPE, NOT STRIPE'S FIELD IN OUR PAGE. Neil's call after
       seeing the embedded version: it arrived carrying Link, Cash App, Klarna
       and a second form asking for an email and a mobile number to make a Link
       account, none of which we asked for and none of which we can turn off
       from here. The hosted page is the same card capture without the shop
       floor, and it comes with Apple Pay and Google Pay already working
       because Stripe's own domain is the one Apple has verified.

       What we give up is the hop. What we get back is a page we are not
       fighting. createInlineCardSetup() and the setup_intent webhook stay in
       place, tested, for the day that trade looks different. -->
  <div class="card card-xl card-sunken" style="padding:26px 30px;margin-top:18px;">
    <p class="eyebrow" style="margin-bottom:6px;">Payment method</p>
    <p style="font-size:15px;line-height:1.55;color:var(--ink-700);margin:0 0 20px;">
      Nothing is charged now. We keep this on file and charge it once, after we
      weigh your laundry.
    </p>

    <form method="post" action="/account/card" style="margin:0;">
      <!-- WHICH ORDER THIS CARD IS FOR, carried to Stripe and back so the page
           they return to can say "thank you for your order" about this one. -->
      <input type="hidden" name="order" value="${escapeHtml(String(order.order_number))}">
      <button type="submit" class="btn btn-primary btn-lg btn-full">
        Add payment method {{ICON_ARROW}}
      </button>
    </form>

    <p style="font-size:14px;line-height:1.55;color:var(--ink-500);margin:16px 0 0;">
      Handled by Stripe, our payment provider. We never see the number.
    </p>
  </div>

  <p style="margin:22px 0 0;font-size:15px;color:var(--ink-500);">
    Your pickup is held. It is confirmed the moment a card is saved.
  </p>
</section>`;
}

// ---------------------------------------------------------------------------
// STEP: just this once, or regularly?
//
// Neil's ask, and it comes before the day because the answer changes what the
// next screen is: a one-off needs a date, a standing order needs weekdays and no
// date at all. Asking both on one screen leaves half of it always irrelevant,
// and there is no JavaScript here to hide the half that is.
//
// DEFAULTS TO JUST ONCE. A repeating pickup books itself every week without
// anybody visiting the site, so it is never the thing somebody gets by not
// reading a screen.
// ---------------------------------------------------------------------------
function repeatForm(given) {
  const regular = given.regular === 'yes';

  return `
    <form method="post" action="/account/book" id="wizard">
      <input type="hidden" name="step" value="repeat">
      ${carried(given, 'repeat')}

      <fieldset style="border:0;padding:0;margin:0;">
        <legend class="field-label" style="padding:0;">Make this a regular pickup?</legend>
        <div style="display:flex;flex-direction:column;gap:14px;margin-top:12px;">
          <label class="check">
            <input type="radio" name="regular" value=""${regular ? '' : ' checked'}>
            <span class="check-box check-box-round">{{ICON_CHECK}}</span>
            <span>
              <span style="font-size:16px;font-weight:600;color:var(--ink-900);">No, just this once</span><br>
              <span style="font-size:14px;color:var(--ink-500);">Pick a day and time next.</span>
            </span>
          </label>

          <label class="check">
            <input type="radio" name="regular" value="yes"${regular ? ' checked' : ''}>
            <span class="check-box check-box-round">{{ICON_CHECK}}</span>
            <span>
              <span style="font-size:16px;font-weight:600;color:var(--ink-900);">Yes, same days each or every other week</span><br>
              <span style="font-size:14px;color:var(--ink-500);">Pick days and time next.</span>
            </span>
          </label>
        </div>
      </fieldset>

      <button type="submit" class="btn btn-primary btn-lg btn-full" style="margin-top:26px;">
        Continue {{ICON_ARROW}}
      </button>
    </form>`;
}

// ---------------------------------------------------------------------------
// STEP: when.
//
// TWO SHAPES, ONE STEP. A one-off asks for a date; a standing order asks which
// weekdays and never a date - the first pickup is worked out from the weekdays
// they chose, so a date box would be a second answer to the same question.
//
// The time is asked either way, and is REQUIRED here where it is optional over
// text: "Tuesday" with no time is a real answer in a thread, but somebody
// looking at a time picker has one in mind, and a blank silently becomes the 9am
// default they never chose.
// ---------------------------------------------------------------------------
const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function whenForm(customer, given, opensOn) {
  const regular = given.regular === 'yes';
  const { min, max } = dateBounds(opensOn);

  // The first window opens and the last window closes. One source of truth for
  // when a van is on the road.
  const windows = booking.PICKUP_WINDOWS;
  const opensAt = windows[0].start;
  const closesAt = windows[windows.length - 1].end;

  // THE DEFAULT TIME HAS TO BE ONE WE COULD ACTUALLY COME AT. The box opens on
  // the first window of the day, which is right for tomorrow and wrong at two in
  // the afternoon if today is still the earliest day offered - it would be
  // refused, by the same rule that took today off the picker above.
  //
  // min stays at the start of the day either way: tomorrow is selectable from
  // the same picker, and every window is open on it.
  const left = booking.windowsToday();
  const startsAt = min === booking.today() && left.open.length ? left.open[0].start : opensAt;
  const picked = new Set(
    String(given.weekdays || '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
  );

  const days = `
        <fieldset style="border:0;padding:0;margin:0;">
          <legend class="field-label" style="padding:0;">Which days?</legend>
          <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px;">
            ${WEEKDAY_LABELS.map(
              (label, i) => `
            <label class="check">
              <input type="checkbox" name="weekday" value="${i}"${
                picked.has(String(i)) ? ' checked' : ''
              }>
              <span class="check-box">{{ICON_CHECK}}</span>
              <span style="font-size:16px;color:var(--ink-900);">${label}</span>
            </label>`
            ).join('')}
          </div>
          <p class="field-hint" style="margin-top:12px;">Pick as many as you like.</p>
        </fieldset>

        <!-- EVERY OTHER WEEK SITS WITH THE DAYS IT CHANGES. It was a third
             radio on the previous screen, which mixed "do you want this at all"
             with "how often" - two questions in one list. -->
        <label class="check" style="margin-top:4px;">
          <input type="checkbox" name="fortnightly" value="yes"${
            given.cadence === 'FORTNIGHTLY' ? ' checked' : ''
          }>
          <span class="check-box">{{ICON_CHECK}}</span>
          <span>
            <span style="font-size:16px;font-weight:600;color:var(--ink-900);">Every other week</span><br>
            <span style="font-size:14px;color:var(--ink-500);">Instead of every week: one week on, one week off.</span>
          </span>
        </label>
`;

  const oneDay = `
        <div class="field">
          <label class="field-label" for="pickup_date">Which day?</label>
          <input class="input input-lg" type="date" id="pickup_date" name="pickup_date" required
                 min="${min}" max="${max}" value="${escapeHtml(given.pickup_date || min)}">
        </div>`;

  return `
    <form method="post" action="/account/book" id="wizard">
      <input type="hidden" name="step" value="when">
      <input type="hidden" name="regular" value="${escapeHtml(String(given.regular || ''))}">
      ${carried(given, 'when')}
      <div class="stack">
        ${regular ? days : oneDay}

        <!-- BOUNDED BY THE HOURS THE VAN ACTUALLY RUNS, and taken from
             PICKUP_WINDOWS rather than typed here - so changing the windows moves
             this with them, the same way it already moves the turnaround promise.

             min/max on a time input is a courtesy and not a guard: some browsers
             only mark an out-of-range value invalid rather than refusing it, and
             none of them stop a form being posted by hand. checkSlot() is what
             actually decides, and it already answers "that time has gone, the
             next slot is..." in a sentence. -->
        <div class="field">
          <label class="field-label" for="pickup_time">What time?</label>
          <input class="input input-lg" type="time" id="pickup_time" name="pickup_time" required
                 min="${opensAt}" max="${closesAt}"
                 value="${escapeHtml(given.pickup_time || startsAt)}">
          <span class="field-hint">
            We pick up between ${booking.readableTime(opensAt)} and ${booking.readableTime(closesAt)}.
          </span>
        </div>

        <!-- WHAT YOU JUST CHOSE, SAID BACK TO YOU. Neil's ask, and it sits after
             the time because it cannot describe a pickup until it has one.

             THE STATIC SENTENCE IS THE REAL ONE. It explains the rule and is what
             anybody with no JavaScript reads - which is why it is written into
             the markup rather than left to the script to fill in. The script
             below replaces it with the specific version once there is something
             specific to say, and puts it back the moment there is not. A summary
             that starts empty would be a blank box on a page that had not
             finished loading. -->
        ${regular ? `
        <div class="card" id="repeat-summary" data-fallback="1"
             style="background:var(--paper-200);padding:18px 20px;box-shadow:none;">
          <p style="margin:0;font-size:15px;line-height:1.55;color:var(--ink-800);">
            <strong>How this works:</strong> we pick up on every day you tick, at the
            time you choose, and bring it back the ${escapeHtml(site.turnaround)}.
            Tick <em>every other week</em> and we come one week and skip the next. We
            text you the evening before every pickup, and you can skip a week or stop
            the lot whenever you like.
          </p>
        </div>` : ''}

        <!-- NO PER-PICKUP NOTE HERE ANY MORE. Neil's call: it asked every single
             order for something that is almost always a permanent fact about the
             address - a door code, a doorman, which gate - and that now has its
             own box on the address page, saved once and read by the driver on
             every run. Asking again per booking was a second place to type the
             same thing and a second place for it to go stale.

             orders.notes still exists and the AI still sets it from a thread,
             where "there is a wool jumper in this one" is genuinely about one
             load. -->
      </div>

      <button type="submit" class="btn btn-primary btn-lg btn-full" style="margin-top:24px;">
        Continue {{ICON_ARROW}}
      </button>
    </form>

    <!-- READS THE FORM BACK IN A SENTENCE, AND ONLY EVER THE SENTENCE.

         It writes into one paragraph and touches nothing else - it cannot
         change a value, tick a box or submit anything - so the worst a bug in
         here can do is describe the form wrongly, never book the wrong pickup.
         The form still works with the script removed; the static wording it
         replaces is in the markup above.

         No framework and no build step, like every other script on this site. -->
    ${regular ? `<script>
    (function () {
      var form = document.querySelector('form[action="/account/book"]');
      var box = document.getElementById('repeat-summary');
      if (!form || !box) return;

      var p = box.querySelector('p');
      var fallback = p.innerHTML;
      var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      // 08:00 -> "8:00 AM". Written out rather than left to toLocaleTimeString,
      // which follows the VIEWER's locale and would print 24-hour time for
      // somebody whose phone is set to it - on a page that says AM everywhere
      // else.
      function clock(value) {
        var bits = String(value || '').split(':');
        if (bits.length < 2) return null;
        var h = Number(bits[0]);
        var m = bits[1];
        if (!isFinite(h)) return null;
        var suffix = h < 12 ? 'AM' : 'PM';
        var hour = h % 12;
        if (hour === 0) hour = 12;
        return hour + ':' + m + ' ' + suffix;
      }

      // "Sunday", "Sunday and Monday", "Sunday, Monday and Thursday".
      function list(names) {
        if (names.length === 1) return names[0];
        return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
      }

      function paint() {
        var days = [];
        var boxes = form.querySelectorAll('input[name=weekday]');
        for (var i = 0; i < boxes.length; i += 1) {
          if (boxes[i].checked) days.push(DAYS[Number(boxes[i].value)]);
        }

        var every = form.querySelector('input[name=fortnightly]');
        var when = form.querySelector('#pickup_time');
        var time = clock(when && when.value);

        // Nothing specific to say yet, so say the rule instead.
        if (!days.length || !time) {
          p.innerHTML = fallback;
          return;
        }

        var cadence = every && every.checked ? 'Every other week' : 'Every week';

        p.textContent =
          cadence +
          ' on ' +
          list(days) +
          ', we will pick up your laundry at ' +
          time +
          '.';
      }

      form.addEventListener('change', paint);
      form.addEventListener('input', paint);
      paint();
    })();
    </script>` : ''}`;
}

// NOT requireCustomer. A guest has no session by design - see whoIsOrdering()
// above - so the guard is done by hand: a signed guest cookie or a session,
// and anything else goes to the front door.
router.get('/account/book', async (req, res, next) => {
  try {
    await auth.attachCustomer(req);

    const who = whoIsOrdering(req);
    if (!who.customer) return res.redirect(302, '/account/login');

    const opensOn = await settings.opensOn();
    const given = req.query || {};
    const customer = who.guest ? withAnswers(who.customer, given) : who.customer;
    const step = bookingStep(customer, given);

    // Nothing missing and a day already chosen means this was reached by going
    // back; send them to the first thing that is actually still open.
    const shown = step === 'book' ? 'when' : step;

    // NO GOOGLE ADS TAG ON ANY RENDER OF THIS PAGE. Its query string carries the
    // order wizard's answers - name, street address, zip - so the tag's full
    // address report would send a customer's home address to Google. It
    // briefly fired a conversion here on a new number's first arrival; nothing
    // is saved at that point, so it came out. An online lead is counted when
    // the order is created - see POST /account/book.
    return accountPage(res, {
      title: 'Place an order',
      body: stepPage({ customer, step: shown, given, opensOn, guest: who.guest }),
    });
  } catch (err) {
    return next(err);
  }
});

// NOT requireCustomer, for the same reason the GET is not - see
// whoIsOrdering(). A guest reaches the end of this and becomes a customer on
// the way through.
router.post('/account/book', async (req, res, next) => {
  try {
    await auth.attachCustomer(req);

    const who = whoIsOrdering(req);
    if (!who.customer) return res.redirect(303, '/account/login');

    const form = req.body || {};
    const opensOn = await settings.opensOn();

    let guest = who.guest;
    let customer = guest ? withAnswers(who.customer, form) : who.customer;

    const reshow = (step, error) =>
      accountPage(res, {
        title: 'Place an order',
        body: stepPage({ customer, step, given: form, error, opensOn, guest }),
        status: error ? 400 : 200,
      });

    // GOING BACK IS CHECKED FIRST, BEFORE A SINGLE THING IS SAVED OR VALIDATED.
    //
    // Somebody leaving the address screen has half an address typed, and saving
    // or validating it on the way out would either write a broken record or
    // refuse to let them leave. Back means "show me that screen again", nothing
    // more; every answer they HAVE given rides along in the form and is drawn
    // back onto whichever screen they land on.
    if (form.back && ORDER.includes(form.back)) return reshow(form.back);

    // WHATEVER THIS STEP ANSWERED IS SAVED BEFORE ANYTHING ELSE - for somebody
    // who has an account. They abandon the booking halfway and we have still
    // learned how they like it washed and where they live, and never ask again.
    //
    // A GUEST SAVES NOTHING YET. There is no row, and there must not be one
    // until they have ticked the box - so their answers stay in the form and
    // are validated the same way, just not written.
    if (form.step === 'wash' && !guest) {
      const saved = await saveWash(customer, form);
      if (!saved.ok) return reshow('wash', saved.error);
      customer = saved.customer;
    }

    if (form.step === 'wash' && guest) {
      for (const key of wash.KEYS) {
        if (!wash.isValid(key, form[key])) {
          return reshow('wash', 'Please answer both parts of how you like it washed.');
        }
      }
    }

    // ---------------------------------------------------------------------
    // THE ADDRESS STEP IS WHERE A GUEST BECOMES A CUSTOMER.
    //
    // It is the first moment we have everything the law and the carriers want:
    // a number, a name, an address, and an affirmative tick with a timestamp
    // and an IP behind it. It is also the last moment before we would text
    // them anything. Creating the row earlier would mean a consent record for
    // somebody who never agreed to one.
    // ---------------------------------------------------------------------
    if (form.step === 'address' && guest) {
      if (form.sms_consent !== 'yes') {
        return reshow(
          'address',
          'Please tick the box agreeing to receive text messages. LYNDRY runs on ' +
            'text, so we cannot book a pickup without it.'
        );
      }

      // Validate the address BEFORE creating anything, so a typo does not leave
      // an empty account behind.
      const checked = await saveAddress({ id: null, preferences: {} }, form).catch(() => null);
      if (checked && !checked.ok) return reshow('address', checked.error);

      const started = await onboarding.startConversation({
        phone: who.customer.phone,
        // WEB_ORDER, not WEB_SIGNUP. They ticked the box on the address step
        // of an order they were placing, which is a different door from the
        // signup form that used to exist - and telling the two apart is the
        // whole point of recording a source at all. See migration 0081.
        consentSource: 'WEB_ORDER',
        consentIp: req.ip,
        // No canned welcome. They are mid-order and about to get a real
        // confirmation; an introduction alongside it is two texts where one
        // was asked for.
        sendWelcome: false,
      });

      if (!started.ok) {
        return reshow(
          'address',
          started.reason === 'opted_out'
            ? `That number asked us to stop texting. Text START to ${site.publicPhoneDisplay} from it and try again.`
            : 'That does not look like a US mobile number.'
        );
      }

      // Signed in from here on, so the rest of this request is an ordinary
      // customer placing an ordinary order.
      auth.setSessionCookie(res, started.customer.id);
      auth.clearGuestCookie(res);
      guest = false;

      // WHICH GOOGLE AD FOUND THEM, if one did. Only on a customer this request
      // actually created - somebody already on the books keeps the click that
      // brought them in the first time. See src/core/ad-attribution.js.
      if (started.created) await adAttribution.recordAdClick(req, started.customer.id);

      const washed = await saveWash(started.customer, form);
      if (!washed.ok) return reshow('wash', washed.error);

      const saved = await saveAddress(washed.customer, form);
      if (!saved.ok) return reshow('address', saved.error);
      customer = saved.customer;
    }

    if (form.step === 'address' && !guest && who.guest === false) {
      const saved = await saveAddress(customer, form);
      if (!saved.ok) return reshow('address', saved.error);
      customer = saved.customer;
    }

    // TWO SCREENS, ONE ANSWER. "Is this regular" is its own step; "every other
    // week" is a tick box on the next one, beside the days it changes. Every
    // thing downstream wants a single cadence, so they are folded together here
    // and nowhere else.
    if (form.step === 'when' && form.regular === 'yes') {
      form.cadence = form.fortnightly === 'yes' ? 'FORTNIGHTLY' : 'WEEKLY';
    }

    const cadence = form.regular === 'yes' ? String(form.cadence || 'WEEKLY') : '';

    // A checkbox group is not a string. The 'when' step posts one `weekday` per
    // ticked day, and the rest of the flow carries them as a comma-separated
    // hidden field - so they are normalised here, once, on the way through.
    if (form.step === 'when' && form.regular === 'yes') {
      form.weekdays = weekdaysFrom(form).join(',');
    }

    // ONE SCREEN FORWARD FROM THE ONE THEY WERE ON. See ORDER above for why
    // this is not "the first thing still missing" any more.
    //
    // Anything that is not one of the four screens - a link straight into the
    // wizard, a stale form - falls back to asking what is missing, which is the
    // right question for somebody arriving rather than continuing.
    const from = ORDER.includes(form.step) ? form.step : null;

    if (from) {
      const blank = unanswered(from, form);
      if (blank) return reshow(from, blank);
    }

    const step = from ? nextStep(from, who.customer) : bookingStep(customer, form);
    if (step !== 'book') return reshow(step);

    // A STANDING ORDER IS SET UP BEFORE ITS FIRST PICKUP IS BOOKED, because the
    // schedule is what decides which day that pickup falls on. A one-off books
    // the date they picked and creates nothing.
    let firstDate = null;
    let schedules = [];

    if (cadence && recurring.CADENCES[cadence]) {
      try {
        const started = await startSchedules(customer, {
          cadence,
          weekdays: String(form.weekdays || '').split(',').map(Number).filter((n) => !Number.isNaN(n)),
          timeOfDay: String(form.pickup_time || '') || null,
        });
        firstDate = started.firstDate;
        schedules = started.schedules;
      } catch (err) {
        console.error(`Could not set up a standing order for ${customer.phone}: ${err.message}`);
        return reshow('when', 'We could not set that up. Try again, or text us and we will do it.');
      }
    }

    const result = await booking.bookPickup(customer, {
      pickupDate: firstDate || String(form.pickup_date || ''),
      pickupTime: String(form.pickup_time || ''),
      // MARKED AS THE SCHEDULE'S, because it is: the date came from the
      // schedule we just created, not from a day they picked. It is what lets
      // "stop repeating" call this pickup off with the rest, and what makes the
      // change log say the standing order booked it rather than the customer.
      fromSchedule: Boolean(firstDate),
      // pickupMethod is not passed. The bag is always left out - see the note on
      // PICKUP_METHODS in src/core/booking.js.
      notes: String(form.notes || '').trim().slice(0, 500) || null,
    });

    if (!result.ok) {
      const message = {
        // The web form is the other front door, and it has to be shut too -
        // bookPickup() refuses either way, but a customer deserves the reason
        // rather than "that did not work".
        not_taking_orders: result.detail
          ? `We’re not booking pickups just yet. ${result.detail}`
          : 'We’re not booking pickups just yet. We’ll be in touch the moment we are.',
        no_address: 'We need your address before we can pick up. Email us and we’ll add it.',
        out_of_area: `We don’t reach your address just yet. We cover ${site.serviceArea} right now.`,
        no_preferences: 'Tell us how you like it washed first. Text us and we’ll get you set up in a minute.',
        bad_date: result.detail,
        bad_time: result.detail,
        // Booked before the van starts. The same sentence the text thread
        // gives, from the same function, so the two doors cannot explain the
        // same refusal two different ways.
        before_opening: result.detail,
        already_booked: 'You already have a pickup booked. Move it rather than booking a second.',
        // Exactly what the text thread says, from the same function - the two
        // doors must not explain the same refusal two different ways.
        time_unavailable: result.say,
      }[result.reason];

      // A REFUSAL STAYS ON THE FORM. It used to bounce to the dashboard with the
      // reason in a banner, which threw away the day, the time, the note and the
      // repeat they had just chosen and left them to start again three screens
      // back - for a refusal whose whole point is "pick a different time".
      //
      // reshow() re-renders the step with everything they typed still in it, so
      // the answer to "10:44am today is not something we can promise, the next
      // slot is Wednesday between 10 and 12" is to change one field.
      //
      // NOTHING HAS BEEN WRITTEN AT THIS POINT. bookPickup() refused, so there
      // is no order - and startRepeat() is below this branch, so a booking that
      // fails cannot leave a standing order behind for a pickup that never
      // existed.
      // THE SCHEDULES GO WITH IT. They were created a moment ago so the first
      // pickup's date could be worked out; if that pickup is then refused,
      // leaving them behind would give somebody a standing order they never
      // successfully placed - which is exactly the confusion Neil hit.
      if (schedules.length) {
        await recurring
          .stop(customer)
          .catch((err) => console.error(`Could not undo a standing order: ${err.message}`));
      }

      return reshow('when', message || 'That did not work.');
    }

    // Booked, but we have no way to bill it. The pickup is real and stays on
    // their account; it is simply not confirmed until a card is saved, and the
    // link goes by text because the website never touches card details.
    //
    // The same shape as the SMS door: record the pickup first, ask for the
    // card second. Somebody who is sent away to pay before their booking
    // exists comes back to nothing.
    if (result.needsCard) {
      // NO TEXT YET, AND THIS IS THE WHOLE OF NEIL'S POINT. The card button is
      // on the very next thing they see, so a text telling them to add a card
      // arrives while they are adding one. src/core/card-chase.js sends it half
      // an hour later, and only if there is still no card by then - which for
      // most people there will be, so most of these texts now never happen.

      // THE CARD OPENS UNDERNEATH, IT DOES NOT LEAD ANYWHERE. Neil's sequence:
      // details in, Continue, the address confirmed, then a panel with the
      // card field in it - all on one screen. Sending somebody to a page
      // headed "One last thing" is what made this read as a surprise bill.
      //
      // A HOSTED LINK IS MINTED ALONGSIDE IT, and that is not waste: it is
      // what the panel falls back to when Stripe's script does not load, and
      // it costs one API call on the one screen where somebody is waiting for
      // a card field anyway.
      //
      // IF ANY OF THIS FAILS WE STILL HAVE A BOOKED ORDER, so the old page is
      // where we land rather than an error. The pickup is real either way and
      // the text with the link has already gone.
      // NOTHING IS CREATED AT STRIPE HERE ANY MORE. The screen is the address
      // said back to them and a button; the session is minted when they press
      // it, in POST /account/card. Minting one now would burn a checkout
      // session on every booking, including everyone who closes the tab.
      return accountPage(res, {
        title: 'Payment method',
        body: cardStep({ customer, order: result.order }),
        // AN ONLINE ORDER IS A LEAD, COUNTED HERE, Neil's brief. The order row
        // exists already - it is written before the card is asked for - so this
        // is the moment it was placed. Counted now rather than after the card,
        // on purpose: somebody who got as far as a day, an address and a wash
        // and then stalled at the card is exactly the lead the ads should learn
        // from. Whether they became a paying customer is the separate question
        // the stored click id answers later.
        //
        // In this response, not via a marker: there is no redirect, the card
        // panel is rendered straight back. The URL is the POST's - no query
        // string - and stripQuery makes sure of it.
        tracking: true,
        conversionId: result.order.id,
        stripQuery: true,
      });
    }


    // Confirm by text, exactly as a booking made over SMS would be — same
    // wording, from the same function, so the messages table reads the same
    // whichever door they came through.
    await sendAndLog(
      customer.phone,
      booking.confirmationMessage(customer, result.order, {
        // Placed on the website, so no conversational opener. See DOORS in
        // src/core/booking.js.
        source: booking.DOORS.WEB,
        rolled: result.rolled,
        freeOrder: result.freeOrder,
        freeUpToLb: result.freeUpToLb,
      }),
      customer.id
    );

    // The other way an online order ends: no card was needed, so it redirects -
    // to the same thank-you page the card path reaches. Neil: "always give the
    // thank you page for ordering." That page counts the lead, told by a
    // one-shot marker carrying the order id, scoped to its own path so no other
    // account page can take it. See src/core/ad-attribution.js.
    adAttribution.markLead(res, result.order.id, '/account/thanks');
    return res.redirect(303, `/account/thanks?order=${result.order.order_number}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /account/booked/:token - the confirmation, and the only page change in
// the whole sequence.
//
// Neil's step 5. Stripe sends a card that needed a bank check back here on its
// own; a card that needed none never left the page and the script sends itself
// here. Both arrive at the same screen.
//
// IT READS THE CARD BACK ITSELF rather than waiting for the webhook. The
// webhook is what makes this reliable - it arrives whatever the browser did -
// but it can be seconds late, and a confirmation page that says "no card yet"
// about a card the customer just typed in is a page that gets reported as
// broken. Whichever gets there first wins; the loser sees completed_at and
// does nothing, which is the same race the hosted return page already runs.
// ---------------------------------------------------------------------------
router.get('/account/booked/:token', auth.requireCustomer, async (req, res, next) => {
  try {
    const { token } = req.params;

    const { data: link, error } = await db
      .from('payment_links')
      .select('*, customers(*)')
      .eq('token', token)
      // SCOPED TO THE PERSON SIGNED IN. The token is unguessable, but a link is
      // still a link: without this, one forwarded to somebody else would show
      // them another customer's pickup and card.
      .eq('customer_id', req.customer.id)
      .maybeSingle();

    if (error) throw error;
    if (!link) return res.redirect(303, '/account');

    let customer = req.customer;

    if (!link.completed_at) {
      const updated = await billing.recordSavedCard(link).catch((err) => {
        console.error('Could not read back the saved card:', err.message);
        return null;
      });
      if (updated) customer = updated;
    }

    const saved = billing.hasPaymentMethod(customer);

    // The pickups this card just confirmed. Plural, because one card covers
    // every one of them and confirming only the soonest would leave the rest
    // off the driver's run sheet with nothing on screen to say why.
    const waiting = await orders.findAllAwaitingCollection(customer.id).catch(() => []);

    return accountPage(res, {
      title: saved ? 'Pickup confirmed' : 'Card not saved',
      body: bookedPage({ customer, orders: waiting, saved }),
    });
  } catch (err) {
    return next(err);
  }
});

function bookedPage({ customer, orders: waiting, saved }) {
  const card = billing.describeCard(customer);

  const rows = (waiting || [])
    .map(
      (o) => `
      <div style="display:flex;justify-content:space-between;gap:18px;padding:16px 0;border-bottom:1px solid var(--ink-100);">
        <span style="font-size:16px;font-weight:600;color:var(--ink-900);">#${o.order_number}</span>
        <span style="font-size:16px;color:var(--ink-700);text-align:right;">${escapeHtml(whenLineMdy(o))}</span>
      </div>`
    )
    .join('');

  // NOT SAVED IS NOT AN ERROR PAGE. They may have closed the card field or
  // changed their mind, and the pickup is still theirs - it simply is not
  // confirmed until a card is on it. Saying so plainly, with the way back, is
  // better than a red banner about something they did on purpose.
  if (!saved) {
    return `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="max-width:600px;padding-top:60px;padding-bottom:44px;">
    <p class="eyebrow eyebrow-brand">Place an order</p>
    <h1 class="display-2" style="margin-bottom:10px;">No card was saved.</h1>
    <p style="font-size:18px;line-height:1.5;color:var(--ink-800);max-width:44ch;margin:0;">
      Nothing was charged and nothing was stored. Your pickup is still held.
    </p>
  </div>
</section>

<section class="container" style="max-width:600px;padding-top:40px;padding-bottom:96px;">
  <div class="card card-xl" style="padding:30px;">
    <p style="font-size:16px;line-height:1.55;color:var(--ink-700);margin:0 0 20px;">
      We need a card on file before the driver comes out. It is confirmed the
      moment one is saved.
    </p>
    <a href="/account/payment" class="btn btn-primary btn-lg btn-full">Add a card {{ICON_ARROW}}</a>
  </div>
  <p style="margin:22px 0 0;"><a href="/account">Back to your account</a></p>
</section>`;
  }

  return `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="max-width:600px;padding-top:60px;padding-bottom:44px;">
    <p class="eyebrow eyebrow-brand">Place an order &middot; done</p>
    <h1 class="display-2" style="margin-bottom:10px;">You're booked.</h1>
    <p style="font-size:18px;line-height:1.5;color:var(--ink-800);max-width:44ch;margin:0;">
      We have texted you the details. Leave the bag out and we will do the rest.
    </p>
  </div>
</section>

<section class="container" style="max-width:600px;padding-top:40px;padding-bottom:96px;">

  <div class="card card-xl" style="padding:26px 30px;">
    <p class="eyebrow" style="margin-bottom:6px;">${(waiting || []).length === 1 ? 'Your pickup' : 'Your pickups'}</p>
    ${rows || '<p style="font-size:16px;color:var(--ink-700);margin:12px 0 0;">Nothing booked yet.</p>'}
  </div>

  <!-- THE THREE THINGS SOMEBODY WANTS TO KNOW after handing over a card, and
       the middle one is the point: nothing has been taken. -->
  <div class="card card-xl card-sunken" style="padding:26px 30px;margin-top:18px;">
    <div style="display:flex;justify-content:space-between;gap:18px;padding-bottom:14px;">
      <span style="font-size:16px;color:var(--ink-700);">Charged today</span>
      <span style="font-size:16px;font-weight:700;color:var(--ink-900);">$0.00</span>
    </div>
    <div style="display:flex;justify-content:space-between;gap:18px;padding-bottom:14px;">
      <span style="font-size:16px;color:var(--ink-700);">Card on file</span>
      <span style="font-size:16px;font-weight:700;color:var(--ink-900);">${escapeHtml(card || 'saved')}</span>
    </div>
    <div style="display:flex;justify-content:space-between;gap:18px;">
      <span style="font-size:16px;color:var(--ink-700);">You are charged</span>
      <span style="font-size:16px;font-weight:700;color:var(--ink-900);text-align:right;">after we weigh it</span>
    </div>
  </div>

  <p style="margin:26px 0 0;"><a href="/account">Back to your account</a></p>
</section>`;
}

router.post('/account/reschedule', auth.requireCustomer, async (req, res, next) => {
  try {
    const customer = req.customer;
    const newDate = String((req.body || {}).new_date || '');
    const newTime = booking.normaliseTime((req.body || {}).new_time);

    const problem = booking.dateProblem(newDate);
    if (problem) return back(res, `?error=${encodeURIComponent(problem)}`);

    const timeIssue = booking.timeProblem(newTime);
    if (timeIssue) return back(res, `?error=${encodeURIComponent(timeIssue)}`);

    const order = await pickupFromForm(customer, req.body);
    if (!order) {
      return back(res, `?error=${encodeURIComponent('There is no pickup to move.')}`);
    }

    // Nothing to do only if the day AND the time are both unchanged — otherwise
    // "same day, but make it 4 instead of 6" would silently do nothing.
    if (order.pickup_date === newDate && newTime === booking.normaliseTime(order.pickup_time)) {
      return back(res, '');
    }

    // Same window rules as the text thread, chosen in src/core/booking.js.
    const window = booking.windowFor(
      newDate,
      newTime === undefined ? booking.normaliseTime(order.pickup_time) : newTime
    );

    // Same person, different door: they signed in and moved it on the website.
    const updated = await orders.reschedule(order, newDate, newTime, window, {
      actor: 'customer',
    });

    await sendAndLog(
      customer.phone,
      booking.rescheduledMessage(updated, { source: booking.DOORS.WEB }),
      customer.id
    );

    return back(res, '?moved=1');
  } catch (err) {
    return next(err);
  }
});

// WHICH PICKUP DID THE FORM MEAN?
//
// A customer can have several booked - one per day - so every change and cancel
// form carries the order id of the one it belongs to. Falling back to the
// soonest is only safe when there is exactly one; with several it would move or
// cancel the wrong laundry, and there is no undo for that.
async function pickupFromForm(customer, body) {
  const open = await orders.findAllAwaitingCollection(customer.id);
  if (!open.length) return null;

  const wanted = String((body || {}).order_id || '');
  if (wanted) return open.find((o) => o.id === wanted) || null;

  return open.length === 1 ? open[0] : null;
}

router.post('/account/cancel', auth.requireCustomer, async (req, res, next) => {
  try {
    const customer = req.customer;

    const order = await pickupFromForm(customer, req.body);
    if (!order) {
      return back(
        res,
        `?error=${encodeURIComponent('That pickup has already been picked up, so it cannot be canceled.')}`
      );
    }

    // Through the state machine, never a direct write — the same rule the ops
    // endpoints follow.
    await orders.transition(order, 'CANCELED');

    await sendAndLog(
      customer.phone,
      `Canceled, no charge. Book again whenever you need us.`,
      customer.id
    );

    return back(res, '?cancelled=1');
  } catch (err) {
    return next(err);
  }
});

module.exports = { router };
