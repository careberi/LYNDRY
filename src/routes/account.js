'use strict';

const express = require('express');

const db = require('../db');
const orders = require('../core/orders');
const booking = require('../core/booking');
const billing = require('../core/billing');
const auth = require('../core/customer-auth');
const payments = require('../providers/payments');
const { sendAndLog } = require('../core/notify');
const { site } = require('../web/site');
const { renderPage, escapeHtml } = require('../web/layout');
const { formatPhone } = require('../core/phone');

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
function accountPage(res, { title, body, status = 200 }) {
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

function phoneStep({ error = '', next = '/account', phone = '' } = {}) {
  return `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="max-width:560px;padding-top:80px;padding-bottom:72px;">
    <p class="eyebrow eyebrow-brand">Your pickups</p>
    <h1 class="display-2">Sign in.</h1>
    <p style="font-size:19px;line-height:1.5;color:var(--ink-800);max-width:44ch;margin:0;">
      Your mobile number is your account. We'll text you a code — there's no
      password to remember.
    </p>
  </div>
</section>

<section class="container" style="max-width:560px;padding-top:56px;padding-bottom:104px;">
  ${error ? banner(escapeHtml(error)) : ''}

  <form method="post" action="/account/login" class="card card-xl" style="padding:30px;">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <div class="field">
      <label class="field-label" for="phone">Mobile number</label>
      <input class="input input-lg" type="tel" id="phone" name="phone" required
             autocomplete="tel" inputmode="tel" placeholder="(201) 555-0142"
             value="${escapeHtml(phone)}" autofocus>
    </div>
    <button type="submit" class="btn btn-ink btn-lg btn-full" style="margin-top:20px;">
      Text me a code {{ICON_ARROW}}
    </button>
  </form>

  <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:24px 0 0;">
    Not signed up yet? <a href="/signup">Create your account</a> — it takes two
    minutes and we only ask once.
  </p>
</section>`;
}

function codeStep({ error = '', next = '/account', phone = '' } = {}) {
  return `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="max-width:560px;padding-top:80px;padding-bottom:72px;">
    <p class="eyebrow eyebrow-brand">Your pickups</p>
    <h1 class="display-2">Check your phone.</h1>
    <p style="font-size:19px;line-height:1.5;color:var(--ink-800);max-width:44ch;margin:0;">
      We texted a six-digit code to <strong>${escapeHtml(formatPhone(phone))}</strong>.
      It expires in ${auth.CODE_TTL_MINUTES} minutes.
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
    Nothing arrived? Check the number, or
    <a href="/signup">sign up</a> if you haven't yet.
  </p>
</section>`;
}

router.get('/account/login', (req, res) => {
  if (auth.isSignedIn(req)) return res.redirect(302, safeNext(req.query.next));
  accountPage(res, { title: 'Sign in', body: phoneStep({ next: safeNext(req.query.next) }) });
});

router.post('/account/login', async (req, res, next) => {
  const wanted = safeNext((req.body || {}).next);
  const phone = (req.body || {}).phone;

  try {
    const result = await auth.requestCode(phone, req);

    if (!result.ok) {
      const error =
        result.reason === 'throttled'
          ? 'Too many codes requested. Wait fifteen minutes and try again.'
          : 'That does not look like a US mobile number.';
      return accountPage(res, {
        title: 'Sign in',
        status: result.reason === 'throttled' ? 429 : 400,
        body: phoneStep({ error, next: wanted, phone }),
      });
    }

    // Identical response whether or not that number is one of ours.
    setPending(res, result.phone);
    return res.redirect(303, `/account/login/code?next=${encodeURIComponent(wanted)}`);
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

const STATUS_WORDS = {
  REQUESTED: 'Booked in',
  ASSIGNED: 'Booked in',
  DEPOSITED: 'With us',
  IN_PROCESS: 'Being washed',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELED: 'Cancelled',
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

function money(cents) {
  return cents == null ? null : `$${(cents / 100).toFixed(2)}`;
}

// The soonest and latest days someone may pick. Today is allowed — a morning
// booking for the same afternoon is a normal thing to want.
function dateBounds() {
  const from = new Date();
  const to = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  return { min: from.toISOString().slice(0, 10), max: to.toISOString().slice(0, 10) };
}

function currentOrderCard(order) {
  const words = STATUS_WORDS[order.status] || order.status;
  const canChange = orders.AWAITING_COLLECTION.includes(order.status);
  const price = money(order.price_cents);

  return `
  <div class="card card-xl" style="padding:32px;margin-bottom:26px;">
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:18px;">
      <span class="badge" style="background:${STATUS_TONE[order.status]};${
        order.status === 'DELIVERED' ? 'color:var(--paper-050);' : ''
      }">${escapeHtml(words)}</span>
      <span class="eyebrow" style="margin:0;">${escapeHtml(booking.whenLine(order))}</span>
    </div>

    <h2 style="font-family:var(--font-display);font-weight:800;font-size:30px;letter-spacing:-0.02em;margin:0 0 12px;">
      ${
        canChange
          ? `We're coming ${escapeHtml(booking.whenLine(order))}.`
          : order.status === 'IN_PROCESS'
            ? "We've got it."
            : order.status === 'OUT_FOR_DELIVERY'
              ? "It's on the van."
              : 'All done.'
      }
    </h2>

    <p style="font-size:17px;line-height:1.55;color:var(--ink-700);margin:0 0 ${canChange ? '24px' : '0'};">
      ${
        order.pickup_method === 'HAND_TO_DRIVER'
          ? "We'll knock when we arrive."
          : 'Leave the bag outside your door — you don’t need to be in.'
      }
      ${
        order.weight_lb
          ? ` Weighed at ${order.weight_lb} lb${price ? `, ${escapeHtml(price)}` : ''}.`
          : ` ${site.pricePerLb} a pound, weighed after pickup.`
      }
    </p>

    ${
      canChange
        ? `
    <div style="display:flex;flex-wrap:wrap;gap:12px;">
      <form method="post" action="/account/cancel" style="margin:0;"
            onsubmit="return confirm('Cancel this pickup? There is no charge.');">
        <button class="btn btn-outline">Cancel this pickup</button>
      </form>
    </div>
    <p style="font-size:15px;color:var(--ink-500);margin:16px 0 0;">
      Free to cancel or move any time before we collect. To change the day, use
      the form below.
    </p>`
        : ''
    }
  </div>`;
}

router.get('/account', auth.requireCustomer, async (req, res, next) => {
  try {
    const customer = req.customer;

    const open = await orders.findAwaitingCollection(customer.id);
    const inFlight = open || (await orders.findLatestInFlight(customer.id));

    const { data: history } = await db
      .from('orders')
      .select('id, status, pickup_date, weight_lb, price_cents')
      .eq('customer_id', customer.id)
      .in('status', ['DELIVERED', 'CANCELED'])
      .order('pickup_date', { ascending: false })
      .limit(8);

    const { min, max } = dateBounds();
    const prefs = customer.preferences || {};
    const defaultMethod = prefs.default_pickup_method || 'LEAVE_OUTSIDE';

    const flash = req.query.booked
      ? banner('Booked. We’ve texted you a confirmation.', 'suds')
      : req.query.moved
        ? banner('Moved. We’ve texted you the new day.', 'suds')
        : req.query.cancelled
          ? banner('Cancelled, no charge.', 'suds')
          : req.query.error
            ? banner(escapeHtml(String(req.query.error)))
            : '';

    // A booking form is pointless while an order is already open — the rule is
    // one at a time — so it becomes a reschedule form instead.
    const formCard = inFlight && orders.AWAITING_COLLECTION.includes(inFlight.status)
      ? `
      <div class="card card-xl" style="padding:32px;">
        <p class="eyebrow" style="margin-bottom:6px;">Change the day</p>
        <h2 style="font-family:var(--font-display);font-weight:800;font-size:28px;margin:0 0 22px;">Move your pickup</h2>
        <form method="post" action="/account/reschedule">
          <div class="stack">
            <div class="field">
              <label class="field-label" for="new_date">New day</label>
              <input class="input input-lg" type="date" id="new_date" name="new_date" required
                     min="${min}" max="${max}" value="${escapeHtml(inFlight.pickup_date)}">
            </div>

            <div class="field">
              <label class="field-label" for="new_time">What time? <span style="font-weight:400;color:var(--ink-500);">Optional</span></label>
              <input class="input input-lg" type="time" id="new_time" name="new_time"
                     value="${escapeHtml(booking.normaliseTime(inFlight.pickup_time) || '')}">
              <span class="field-hint">We'll aim for a window around it. Leave it blank if any time works.</span>
            </div>
          </div>

          <button type="submit" class="btn btn-primary btn-lg" style="margin-top:20px;">
            Move it {{ICON_ARROW}}
          </button>
        </form>
      </div>`
      : `
      <div class="card card-xl" style="padding:32px;">
        <p class="eyebrow" style="margin-bottom:6px;">Book</p>
        <h2 style="font-family:var(--font-display);font-weight:800;font-size:28px;margin:0 0 8px;">Next pickup</h2>
        <p style="font-size:16px;color:var(--ink-500);margin:0 0 24px;">
          We already know your address and how you like it washed.
        </p>

        <form method="post" action="/account/book">
          <div class="stack">
            <div class="field">
              <label class="field-label" for="pickup_date">Which day?</label>
              <input class="input input-lg" type="date" id="pickup_date" name="pickup_date" required
                     min="${min}" max="${max}" value="${min}">
              <span class="field-hint">Any day that suits — there are no fixed route days.</span>
            </div>

            <div class="field">
              <label class="field-label" for="pickup_time">What time? <span style="font-weight:400;color:var(--ink-500);">Optional</span></label>
              <input class="input input-lg" type="time" id="pickup_time" name="pickup_time">
              <span class="field-hint">We'll aim for a window around it. Leave it blank if any time works.</span>
            </div>

            <fieldset style="border:0;padding:0;margin:0;">
              <legend class="field-label" style="padding:0;">How are we collecting?</legend>
              <div style="display:flex;flex-direction:column;gap:14px;margin-top:10px;">
                <label class="check">
                  <input type="radio" name="pickup_method" value="LEAVE_OUTSIDE"${
                    defaultMethod === 'LEAVE_OUTSIDE' ? ' checked' : ''
                  }>
                  <span class="check-box check-box-round">{{ICON_CHECK}}</span>
                  <span>
                    <span style="font-size:16px;font-weight:600;color:var(--ink-900);">I'll leave it outside my door</span><br>
                    <span style="font-size:14px;color:var(--ink-500);">You don't need to be home.</span>
                  </span>
                </label>
                <label class="check">
                  <input type="radio" name="pickup_method" value="HAND_TO_DRIVER"${
                    defaultMethod === 'HAND_TO_DRIVER' ? ' checked' : ''
                  }>
                  <span class="check-box check-box-round">{{ICON_CHECK}}</span>
                  <span>
                    <span style="font-size:16px;font-weight:600;color:var(--ink-900);">I'll hand it to the driver</span><br>
                    <span style="font-size:14px;color:var(--ink-500);">We'll knock when we arrive.</span>
                  </span>
                </label>
              </div>
            </fieldset>

            <div class="field">
              <label class="field-label" for="notes">Anything for this pickup? (optional)</label>
              <textarea class="textarea" id="notes" name="notes" rows="3"
                        placeholder="Gate code, where the bag will be, something that needs care&hellip;"></textarea>
            </div>
          </div>

          <button type="submit" class="btn btn-primary btn-lg btn-full" style="margin-top:24px;">
            Book this pickup {{ICON_ARROW}}
          </button>
        </form>
      </div>`;

    const body = `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="max-width:760px;padding-top:72px;padding-bottom:56px;">
    <p class="eyebrow eyebrow-brand">Your pickups</p>
    <h1 class="display-2" style="margin-bottom:12px;">Hello, ${escapeHtml(
      (customer.name || '').split(' ')[0] || 'there'
    )}.</h1>
    <p style="font-size:18px;line-height:1.5;color:var(--ink-800);max-width:46ch;margin:0;">
      ${escapeHtml(booking.hasAddress(customer) ? customer.address_line1 : 'No address on file yet')}${
        booking.hasAddress(customer) ? `, ${escapeHtml(customer.city)}` : ''
      }
    </p>
  </div>
</section>

<section class="container" style="max-width:760px;padding-top:48px;padding-bottom:96px;">
  ${flash}
  ${inFlight ? currentOrderCard(inFlight) : ''}
  ${formCard}

  ${
    (history || []).length
      ? `
  <div style="margin-top:56px;">
    <p class="eyebrow" style="margin-bottom:6px;">Before</p>
    <h2 style="font-family:var(--font-display);font-weight:800;font-size:28px;margin:0 0 20px;">Past pickups</h2>
    ${(history || [])
      .map(
        (o) => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:14px 0;border-bottom:1px solid var(--ink-100);">
        <span style="font-size:16px;">${escapeHtml(booking.readableDate(o.pickup_date))}</span>
        <span style="display:flex;align-items:center;gap:14px;">
          ${o.weight_lb ? `<span style="font-size:15px;color:var(--ink-500);">${o.weight_lb} lb</span>` : ''}
          ${o.price_cents ? `<span style="font-size:16px;font-weight:600;">${escapeHtml(money(o.price_cents))}</span>` : ''}
          <span class="badge" style="background:${STATUS_TONE[o.status]};${
            o.status === 'DELIVERED' ? 'color:var(--paper-050);' : ''
          }">${escapeHtml(STATUS_WORDS[o.status] || o.status)}</span>
        </span>
      </div>`
      )
      .join('')}
  </div>`
      : ''
  }

  <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:48px;">
    <form method="post" action="/account/logout" style="margin:0;">
      <button class="btn btn-ghost">Sign out</button>
    </form>
    <span style="font-size:15px;color:var(--ink-500);">
      Prefer texting? Everything here works by text too.
    </span>
  </div>
</section>`;

    accountPage(res, { title: 'Your pickups', body });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Booking, moving and cancelling
// ---------------------------------------------------------------------------

const back = (res, query) => res.redirect(303, `/account${query}`);

router.post('/account/book', auth.requireCustomer, async (req, res, next) => {
  try {
    const customer = req.customer;
    const form = req.body || {};

    const result = await booking.bookPickup(customer, {
      pickupDate: String(form.pickup_date || ''),
      pickupTime: String(form.pickup_time || ''),
      pickupMethod: String(form.pickup_method || ''),
      notes: String(form.notes || '').trim().slice(0, 500) || null,
    });

    if (!result.ok) {
      const message = {
        no_address: 'We need your address before we can collect. Email us and we’ll add it.',
        bad_date: result.detail,
        bad_time: result.detail,
        already_booked: 'You already have a pickup booked. Move it rather than booking a second.',
        needs_card: 'We need a card on file first — check your texts for the link.',
      }[result.reason];

      // A customer with no card gets the setup link texted, the same as they
      // would over SMS. The website never touches card details.
      if (result.reason === 'needs_card') {
        await billing
          .setupLinkMessage(customer)
          .then((text) => sendAndLog(customer.phone, text, customer.id))
          .catch((err) => console.error('Could not send a card link:', err.message));
      }

      return back(res, `?error=${encodeURIComponent(message || 'That did not work.')}`);
    }

    // Confirm by text, exactly as a booking made over SMS would be — same
    // wording, from the same function, so the messages table reads the same
    // whichever door they came through.
    await sendAndLog(
      customer.phone,
      booking.confirmationMessage(customer, result.order, { rolled: result.rolled }),
      customer.id
    );

    return back(res, '?booked=1');
  } catch (err) {
    return next(err);
  }
});

router.post('/account/reschedule', auth.requireCustomer, async (req, res, next) => {
  try {
    const customer = req.customer;
    const newDate = String((req.body || {}).new_date || '');
    const newTime = booking.normaliseTime((req.body || {}).new_time);

    const problem = booking.dateProblem(newDate);
    if (problem) return back(res, `?error=${encodeURIComponent(problem)}`);

    const timeIssue = booking.timeProblem(newTime);
    if (timeIssue) return back(res, `?error=${encodeURIComponent(timeIssue)}`);

    const order = await orders.findAwaitingCollection(customer.id);
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

    const updated = await orders.reschedule(order, newDate, newTime, window);

    await sendAndLog(customer.phone, booking.rescheduledMessage(updated), customer.id);

    return back(res, '?moved=1');
  } catch (err) {
    return next(err);
  }
});

router.post('/account/cancel', auth.requireCustomer, async (req, res, next) => {
  try {
    const customer = req.customer;

    const order = await orders.findAwaitingCollection(customer.id);
    if (!order) {
      return back(
        res,
        `?error=${encodeURIComponent('That pickup has already been collected, so it cannot be cancelled.')}`
      );
    }

    // Through the state machine, never a direct write — the same rule the ops
    // endpoints follow.
    await orders.transition(order, 'CANCELED');

    await sendAndLog(
      customer.phone,
      `Cancelled, no charge. Book again whenever you need us.`,
      customer.id
    );

    return back(res, '?cancelled=1');
  } catch (err) {
    return next(err);
  }
});

module.exports = { router };
