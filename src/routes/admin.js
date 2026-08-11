'use strict';

const express = require('express');

const db = require('../db');
const orders = require('../core/orders');
const auth = require('../core/admin-auth');
const { config } = require('../config');
const { site } = require('../web/site');
const { escapeHtml, logo, icon, CSS_BASE } = require('../web/layout');
const { normalisePhone, formatPhone } = require('../core/phone');
const roles = require('../core/roles');

const router = express.Router();

// ---------------------------------------------------------------------------
// The ops screens.
//
// Everything Neil and the driver look at. Deliberately separate from
// src/routes/ops.js, which is the JSON API the driver script talks to — this
// file only renders pages, and both share the sign-in check in
// src/core/admin-auth.js.
//
// These pages carry customer names, phone numbers and home addresses, so:
// every one of them is behind the sign-in, every one is noindex, and anything
// that came out of the database goes through escapeHtml() before it reaches
// the page.
// ---------------------------------------------------------------------------

// --- Formatting -------------------------------------------------------------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A date-only string, formatted from its own parts. Parsing "2026-08-14" as a
// Date makes it UTC midnight, which displays as the previous day in New Jersey.
function shortDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const day = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${day} ${d} ${MONTHS[m - 1]}`;
}

function dateTime(iso) {
  if (!iso) return '—';
  const at = new Date(iso);
  return `${at.getDate()} ${MONTHS[at.getMonth()]}, ${at.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function money(cents) {
  return cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// The design system carries a colour per lifecycle stage. Using those rather
// than inventing new ones keeps the ops screens recognisably LYNDRY.
const STATUS_TONE = {
  REQUESTED: 'var(--stage-scheduled)',
  ASSIGNED: 'var(--stage-scheduled)',
  DEPOSITED: 'var(--stage-collected)',
  IN_PROCESS: 'var(--stage-washing)',
  OUT_FOR_DELIVERY: 'var(--stage-ready)',
  DELIVERED: 'var(--stage-delivered)',
  CANCELED: 'var(--ink-200)',
};

function statusBadge(status) {
  const tone = STATUS_TONE[status] || 'var(--ink-200)';
  const onInk = status === 'DELIVERED';
  return `<span class="badge" style="background:${tone};${onInk ? 'color:var(--paper-050);' : ''}">${escapeHtml(
    status.replace(/_/g, ' ')
  )}</span>`;
}

function paymentBadge(order) {
  if (!order.price_cents && order.payment_status === 'UNPAID') return '';
  const tone = {
    PAID: 'var(--suds-300)',
    FAILED: 'var(--stain-500)',
    WAIVED: 'var(--ink-200)',
    UNPAID: 'var(--sunbeam-500)',
  }[order.payment_status];
  return `<span class="badge" style="background:${tone};">${escapeHtml(order.payment_status)}</span>`;
}

function addressOf(c) {
  return [c.address_line1, c.address_line2, c.city && `${c.city} ${c.postal_code || ''}`.trim()]
    .filter(Boolean)
    .join(', ');
}

// --- The page shell ---------------------------------------------------------
//
// Not renderPage() — that is the marketing chrome, with a Get started button
// and a legal footer, which is wrong on an internal tool. Same stylesheets and
// the same design language, different furniture.

function adminPage({ title, active = '', body, user = null }) {
  const tab = (href, label) =>
    `<a href="${href}"${href === active ? ' aria-current="page"' : ''}>${label}</a>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — ${site.name} ops</title>
  <!-- Internal, and full of customer addresses. Never index it. -->
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#101210">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Grandstander:wght@900&display=swap">
  <link rel="stylesheet" href="${CSS_BASE}/ds/styles.css">
  <link rel="stylesheet" href="${CSS_BASE}/icons.css">
  <link rel="stylesheet" href="${CSS_BASE}/lyndry.css">
</head>
<body>
  <header class="site-header">
    <div class="container site-header-bar ops-bar">
      ${logo('compact', { href: '/ops', label: 'LYNDRY ops' })}
      <!-- Only the tabs this person may actually open. A driver never sees a
           Customers link they would be refused at. -->
      <nav class="site-nav">
        ${roles.can(user, 'orders.view') ? tab('/ops', 'Orders') : ''}
        ${roles.can(user, 'customers.view') ? tab('/ops/customers', 'Customers') : ''}
        ${roles.can(user, 'partners.view') ? tab('/ops/partners', 'Partners') : ''}
        ${roles.can(user, 'team.manage') ? tab('/ops/team', 'Team') : ''}
      </nav>
      <form method="post" action="/ops/logout" style="margin:0;display:flex;align-items:center;gap:12px;">
        ${
          user
            ? `<span class="eyebrow" style="margin:0;color:var(--paper-300);">${escapeHtml(
                user.name
              )} &middot; ${escapeHtml(roles.labelFor(roles.roleOf(user)))}</span>`
            : ''
        }
        <button type="submit" class="btn btn-outline btn-sm">Sign out</button>
      </form>
    </div>
  </header>

  <main class="container" style="padding-top:36px;padding-bottom:96px;">
${body}
  </main>
</body>
</html>`;
}

// A compact table. Plain HTML — this is a list of orders, not an app.
function table(headings, rows) {
  if (!rows.length) {
    return `<p style="font-size:16px;color:var(--ink-500);margin:0;">Nothing here.</p>`;
  }

  return `
  <div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:15px;">
      <thead>
        <tr>${headings
          .map(
            (h) =>
              `<th style="text-align:left;padding:10px 14px 10px 0;font-family:var(--font-mono);font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:var(--ink-500);border-bottom:2px solid var(--ink-900);white-space:nowrap;">${h}</th>`
          )
          .join('')}</tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (cells) =>
              `<tr>${cells
                .map(
                  (c) =>
                    `<td style="padding:14px 14px 14px 0;border-bottom:1px solid var(--ink-100);vertical-align:top;">${c}</td>`
                )
                .join('')}</tr>`
          )
          .join('')}
      </tbody>
    </table>
  </div>`;
}

function sectionHeading(eyebrow, heading, count) {
  return `
  <p class="eyebrow" style="margin-bottom:6px;">${escapeHtml(eyebrow)}</p>
  <h2 style="font-family:var(--font-display);font-weight:900;font-size:30px;letter-spacing:-0.03em;margin:0 0 20px;">
    ${escapeHtml(heading)}${count == null ? '' : ` <span style="color:var(--ink-400);">${count}</span>`}
  </h2>`;
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

// Only ever send people back to a path on this site. Without this check,
// /ops/login?next=https://example.com would turn our own sign-in page into a
// redirector someone could use to make a phishing link look like it came
// from lyndry.com.
function safeNext(value) {
  const wanted = String(value || '');
  return /^\/ops(\/|$)/.test(wanted) ? wanted : '/ops';
}

// The shell both sign-in steps share.
function loginShell({ heading, intro, error = '', form }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in — ${site.name} ops</title>
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#0EA47A">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Grandstander:wght@900&display=swap">
  <link rel="stylesheet" href="${CSS_BASE}/ds/styles.css">
  <link rel="stylesheet" href="${CSS_BASE}/icons.css">
  <link rel="stylesheet" href="${CSS_BASE}/lyndry.css">
</head>
<body>
  <main class="hero" style="min-height:100vh;display:flex;align-items:center;">
    <div class="container" style="max-width:460px;padding-top:48px;padding-bottom:48px;">

      <div style="margin-bottom:32px;">${logo('offset', { href: null })}</div>

      <p class="eyebrow eyebrow-brand">Operations</p>
      <h1 class="display-4" style="margin-bottom:10px;">${escapeHtml(heading)}</h1>
      <p style="font-size:17px;line-height:1.5;color:var(--ink-800);margin:0 0 28px;">${intro}</p>

      ${
        error
          ? `<div role="alert" class="card card-xl" style="padding:20px;margin-bottom:22px;background:var(--stain-100);box-shadow:6px 6px 0 var(--stain-500);">
               <p style="font-size:16px;line-height:1.5;color:var(--ink-900);margin:0;">${escapeHtml(error)}</p>
             </div>`
          : ''
      }

      ${form}

    </div>
  </main>
</body>
</html>`;
}

function phoneStep({ error = '', next = '/ops', phone = '' } = {}) {
  return loginShell({
    heading: 'Sign in.',
    intro: "Enter your mobile number and we'll text you a code.",
    error,
    form: `
      <form method="post" action="/ops/login" class="card card-xl" style="padding:28px;">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <div class="field">
          <label class="field-label" for="phone">Mobile number</label>
          <input class="input input-lg" type="tel" id="phone" name="phone" required
                 autocomplete="tel" inputmode="tel" placeholder="(201) 555-0142"
                 value="${escapeHtml(phone)}" autofocus>
        </div>
        <button type="submit" class="btn btn-ink btn-lg btn-full" style="margin-top:20px;">
          Text me a code ${icon('arrow-right', '22')}
        </button>
      </form>`,
  });
}

function codeStep({ error = '', next = '/ops', phone = '' } = {}) {
  return loginShell({
    heading: 'Check your phone.',
    intro: `We texted a six-digit code to <strong>${escapeHtml(
      formatPhone(phone)
    )}</strong>. It expires in ${auth.CODE_TTL_MINUTES} minutes.`,
    error,
    form: `
      <form method="post" action="/ops/login/code" class="card card-xl" style="padding:28px;">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <div class="field">
          <label class="field-label" for="code">Six-digit code</label>
          <input class="input input-lg" type="text" id="code" name="code" required
                 inputmode="numeric" pattern="[0-9]*" maxlength="6"
                 autocomplete="one-time-code" autofocus
                 style="letter-spacing:0.4em;font-size:24px;text-align:center;">
        </div>
        <button type="submit" class="btn btn-ink btn-lg btn-full" style="margin-top:20px;">
          Sign in ${icon('arrow-right', '22')}
        </button>
      </form>

      <form method="post" action="/ops/login" style="margin-top:18px;">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <input type="hidden" name="phone" value="${escapeHtml(phone)}">
        <button type="submit" class="btn btn-ghost">Send another code</button>
      </form>`,
  });
}

// The number being verified is carried between the two steps in its own
// short-lived cookie rather than in the URL — a phone number has no business
// sitting in a browser history or a server log line.
const PENDING_COOKIE = 'ly_ops_pending';

function setPending(res, phone) {
  res.cookie(PENDING_COOKIE, phone, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.env === 'production',
    path: '/ops',
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

router.get('/ops/login', (req, res) => {
  // Already signed in? Don't make them do it again.
  if (auth.isAuthed(req)) return res.redirect(302, safeNext(req.query.next));

  res.type('html').send(phoneStep({ next: safeNext(req.query.next) }));
});

// Step one: they gave us a number. Send a code.
router.post('/ops/login', async (req, res, next) => {
  const wanted = safeNext((req.body || {}).next);
  const phone = (req.body || {}).phone;

  try {
    if (!auth.hasKey()) {
      return res
        .status(503)
        .type('html')
        .send(phoneStep({ error: 'ADMIN_API_KEY is not set on the server.', next: wanted }));
    }

    const result = await auth.requestCode(phone, req);

    if (!result.ok && result.reason === 'invalid') {
      return res
        .status(400)
        .type('html')
        .send(phoneStep({ error: 'That does not look like a US mobile number.', next: wanted, phone }));
    }

    if (!result.ok && result.reason === 'throttled') {
      return res
        .status(429)
        .type('html')
        .send(
          phoneStep({
            error: 'Too many codes requested. Wait fifteen minutes and try again.',
            next: wanted,
            phone,
          })
        );
    }

    // Deliberately identical whether or not that number belongs to anyone.
    // Saying "no such user" would turn this page into a way to find out who
    // works here.
    setPending(res, result.phone);
    return res.redirect(303, `/ops/login/code?next=${encodeURIComponent(wanted)}`);
  } catch (err) {
    return next(err);
  }
});

router.get('/ops/login/code', (req, res) => {
  if (auth.isAuthed(req)) return res.redirect(302, safeNext(req.query.next));

  const phone = readPending(req);
  if (!phone) return res.redirect(302, '/ops/login');

  res.type('html').send(codeStep({ next: safeNext(req.query.next), phone }));
});

// Step two: they gave us the code.
router.post('/ops/login/code', async (req, res, next) => {
  const wanted = safeNext((req.body || {}).next);
  const phone = readPending(req);

  try {
    if (!phone) return res.redirect(303, '/ops/login');

    const result = await auth.verifyCode(phone, (req.body || {}).code, req);

    if (!result.ok) {
      const message =
        result.reason === 'throttled'
          ? 'Too many attempts. Wait fifteen minutes and try again.'
          : 'That code is wrong or has expired. Ask for a new one.';
      return res
        .status(result.reason === 'throttled' ? 429 : 401)
        .type('html')
        .send(codeStep({ error: message, next: wanted, phone }));
    }

    res.clearCookie(PENDING_COOKIE, { path: '/ops' });
    auth.setSessionCookie(res, result.user.id);
    console.log(`Ops sign-in: ${result.user.name}`);
    return res.redirect(303, wanted);
  } catch (err) {
    return next(err);
  }
});

router.post('/ops/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.clearCookie(PENDING_COOKIE, { path: '/ops' });
  res.redirect(303, '/ops/login');
});

// The guard goes on each page individually rather than as a blanket
// router.use('/ops', ...).
//
// A blanket guard here would also catch the JSON API in src/routes/ops.js —
// this router is mounted first, so it sees every /ops request — and a script
// calling /ops/today with a bad key would get a 302 to a sign-in page instead
// of a clean 401. ADDING A PAGE BELOW MEANS ADDING `guard` TO IT.
const guard = auth.requireAdminPage;

// Signed in, but not allowed here. A plain refusal rather than a redirect to
// the sign-in page — they ARE signed in, and bouncing them would be a
// confusing lie about what went wrong.
function refuse(req, res) {
  return res.status(403).type('html').send(
    adminPage({
      title: 'Not for you',
      user: req.opsUser,
      body: `
      <h1 style="font-family:var(--font-display);font-weight:900;font-size:38px;letter-spacing:-0.03em;margin:0 0 12px;">
        Not your department
      </h1>
      <p style="font-size:17px;line-height:1.55;color:var(--ink-700);max-width:46ch;">
        You're signed in as <strong>${escapeHtml(req.opsUser.name)}</strong>
        (${escapeHtml(roles.labelFor(roles.roleOf(req.opsUser)))}), and that
        page isn't part of this role. Ask an admin if you need it.
      </p>
      <a href="/ops" class="btn btn-primary" style="margin-top:22px;">Back to work</a>`,
    })
  );
}

// `guard` proves who you are; `may(...)` proves you're allowed. Every page
// below takes both.
const may = (permission) => roles.requirePermission(permission, refuse);

// ---------------------------------------------------------------------------
// GET /ops — the orders board
// ---------------------------------------------------------------------------

const ORDER_FIELDS =
  'id, status, pickup_date, pickup_method, bag_count, weight_lb, price_cents, payment_status, ' +
  'delivery_photo_url, notes, created_at, customers(id, name, phone, address_line1, address_line2, city, postal_code)';

router.get('/ops', guard, may('orders.view'), async (req, res, next) => {
  try {
    const { data, error } = await db
      .from('orders')
      .select(ORDER_FIELDS)
      .order('pickup_date', { ascending: false });

    if (error) throw error;

    const all = data || [];
    const now = today();

    // Active is "we have it, or we're going to get it today". Upcoming is
    // booked for a later day. Past is finished, one way or the other.
    const active = all.filter(
      (o) =>
        ['IN_PROCESS', 'OUT_FOR_DELIVERY'].includes(o.status) ||
        (orders.AWAITING_COLLECTION.includes(o.status) && o.pickup_date <= now)
    );
    const upcoming = all.filter(
      (o) => orders.AWAITING_COLLECTION.includes(o.status) && o.pickup_date > now
    );
    const past = all.filter((o) => ['DELIVERED', 'CANCELED'].includes(o.status));

    const owed = all.filter((o) => o.payment_status === 'FAILED');
    const owedTotal = owed.reduce((sum, o) => sum + (o.price_cents || 0), 0);

    // A driver does the round; they have no business seeing the books. The
    // money columns are dropped from the markup entirely rather than hidden
    // with CSS — a value that never reaches the page cannot leak from it.
    const showMoney = roles.can(req.opsUser, 'money.view');

    const row = (o) => {
      const c = o.customers || {};
      return [
        `<a href="/ops/orders/${o.id}" style="font-weight:600;">${escapeHtml(c.name || 'Unknown')}</a>
         <div style="font-size:13px;color:var(--ink-500);">${escapeHtml(addressOf(c))}</div>`,
        shortDate(o.pickup_date),
        statusBadge(o.status),
        o.weight_lb ? `${o.weight_lb} lb` : '—',
        ...(showMoney ? [money(o.price_cents), paymentBadge(o)] : []),
      ];
    };

    const headings = ['Customer', 'Pickup', 'Status', 'Weight'];
    if (showMoney) headings.push('Price', 'Payment');

    const board = (eyebrow, heading, list) => `
      <section style="margin-bottom:56px;">
        ${sectionHeading(eyebrow, heading, list.length)}
        ${table(headings, list.map(row))}
      </section>`;

    const body = `
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:44px;">
        ${statCard('Active', active.length)}
        ${statCard('Upcoming', upcoming.length)}
        ${statCard('Completed', past.filter((o) => o.status === 'DELIVERED').length)}
        ${
          showMoney && owed.length
            ? statCard('Owed', money(owedTotal), 'var(--stain-500)', 'var(--paper-050)')
            : ''
        }
      </div>

      ${board('Right now', 'Active', active)}
      ${board('Booked', 'Upcoming', upcoming)}
      ${board('Finished', 'Past', past)}
    `;

    res.type('html').send(adminPage({ title: 'Orders', active: '/ops', body, user: req.opsUser }));
  } catch (err) {
    next(err);
  }
});

function statCard(label, value, bg = 'var(--paper-050)', fg = 'var(--ink-900)') {
  return `
  <div class="card" style="padding:18px 24px;min-width:130px;background:${bg};color:${fg};">
    <div style="font-family:var(--font-display);font-weight:900;font-size:32px;line-height:1;">${value}</div>
    <div class="eyebrow" style="margin:8px 0 0;color:${fg === 'var(--ink-900)' ? 'var(--ink-500)' : fg};">${escapeHtml(label)}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// GET /ops/orders/:id — one order, in full
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/ops/orders/:id', guard, may('orders.view'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return notFoundPage(res, 'That order id is not valid.');

    const { data: order, error } = await db
      .from('orders')
      // No special_instructions here — those live on the customer's
      // preferences, not on the order, and asking for them makes the whole
      // query fail rather than just returning null.
      .select(`${ORDER_FIELDS}, price_per_lb_cents, payment_failure_reason, paid_at`)
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!order) return notFoundPage(res, 'No order with that id.');

    const c = order.customers || {};
    const showMoney = roles.can(req.opsUser, 'money.view');

    // The conversation around this order. There is no order id on a message,
    // so this is the customer's recent thread rather than a per-order log.
    const { data: messages } = await db
      .from('messages')
      .select('direction, body, created_at')
      .eq('customer_id', c.id)
      .order('created_at', { ascending: false })
      .limit(12);

    const detail = (label, value) => `
      <div style="display:flex;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:1px solid var(--ink-100);">
        <span class="eyebrow" style="margin:0;">${escapeHtml(label)}</span>
        <span style="font-size:16px;text-align:right;">${value}</span>
      </div>`;

    const body = `
      <a href="/ops" style="font-size:15px;font-weight:600;">&larr; All orders</a>

      <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:14px;margin:18px 0 32px;">
        <h1 style="font-family:var(--font-display);font-weight:900;font-size:38px;letter-spacing:-0.03em;margin:0;">
          ${escapeHtml(c.name || 'Unknown customer')}
        </h1>
        ${statusBadge(order.status)}
        ${paymentBadge(order)}
      </div>

      <div class="grid-2" style="align-items:start;">

        <div class="card card-xl" style="padding:28px;">
          ${sectionHeading('The order', 'Details')}
          ${detail('Pickup', shortDate(order.pickup_date))}
          ${detail('Method', escapeHtml((order.pickup_method || '').replace(/_/g, ' ').toLowerCase() || '—'))}
          ${detail('Bags', order.bag_count || '—')}
          ${detail('Weight', order.weight_lb ? `${order.weight_lb} lb` : 'not weighed yet')}
          ${
            showMoney
              ? detail('Rate', money(order.price_per_lb_cents) + ' / lb') +
                detail('Price', `<strong>${money(order.price_cents)}</strong>`) +
                detail(
                  'Payment',
                  escapeHtml(order.payment_status) +
                    (order.paid_at ? ` on ${dateTime(order.paid_at)}` : '')
                ) +
                (order.payment_failure_reason
                  ? detail('Decline reason', escapeHtml(order.payment_failure_reason))
                  : '')
              : ''
          }
          ${detail('Booked', dateTime(order.created_at))}
          ${order.notes ? detail('Notes', escapeHtml(order.notes)) : ''}
          ${
            order.delivery_photo_url
              ? `<div style="padding-top:20px;">
                   <a href="${escapeHtml(order.delivery_photo_url)}" class="btn btn-outline" target="_blank" rel="noopener">
                     View delivery photo
                   </a>
                 </div>`
              : ''
          }
        </div>

        <div>
          <div class="card card-xl" style="padding:28px;margin-bottom:22px;">
            ${sectionHeading('Who', 'Customer')}
            ${detail('Name', escapeHtml(c.name || '—'))}
            ${detail('Phone', `<a href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone || '—')}</a>`)}
            ${detail('Address', escapeHtml(addressOf(c)) || '—')}
            <div style="padding-top:20px;">
              ${
                roles.can(req.opsUser, 'customers.view')
                  ? `<a href="/ops/customers/${c.id}" class="btn btn-outline">Full profile ${icon('arrow-right', '16')}</a>`
                  : ''
              }
            </div>
          </div>

          <div class="card card-xl" style="padding:28px;">
            ${sectionHeading('Thread', 'Recent messages')}
            ${
              (messages || []).length
                ? (messages || [])
                    .slice()
                    .reverse()
                    .map(
                      (m) => `
              <div style="padding:10px 0;border-bottom:1px solid var(--ink-100);">
                <div class="eyebrow" style="margin:0 0 4px;">${m.direction === 'INBOUND' ? 'Them' : 'Us'} &middot; ${dateTime(m.created_at)}</div>
                <div style="font-size:15px;line-height:1.45;">${escapeHtml(m.body)}</div>
              </div>`
                    )
                    .join('')
                : '<p style="font-size:15px;color:var(--ink-500);margin:0;">No messages yet.</p>'
            }
          </div>
        </div>

      </div>`;

    res.type('html').send(adminPage({ title: 'Order', active: '/ops', body, user: req.opsUser }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/customers — everyone
// ---------------------------------------------------------------------------

router.get('/ops/customers', guard, may('customers.view'), async (req, res, next) => {
  try {
    const { data: people, error } = await db
      .from('customers')
      .select('id, name, phone, email, city, status, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // One query for every order, counted in memory. At this size that beats a
    // per-customer query, and it keeps the page to two round trips.
    const { data: allOrders } = await db.from('orders').select('customer_id, status, price_cents');

    const byCustomer = new Map();
    for (const o of allOrders || []) {
      const seen = byCustomer.get(o.customer_id) || { count: 0, spent: 0 };
      seen.count += 1;
      if (o.payment_status !== 'WAIVED') seen.spent += o.price_cents || 0;
      byCustomer.set(o.customer_id, seen);
    }

    const showMoney = roles.can(req.opsUser, 'money.view');

    const rows = (people || []).map((p) => {
      const stats = byCustomer.get(p.id) || { count: 0, spent: 0 };
      return [
        `<a href="/ops/customers/${p.id}" style="font-weight:600;">${escapeHtml(p.name || '—')}</a>`,
        `<a href="tel:${escapeHtml(p.phone)}">${escapeHtml(p.phone)}</a>`,
        escapeHtml(p.city || '—'),
        String(stats.count),
        ...(showMoney ? [money(stats.spent)] : []),
        p.status === 'ACTIVE'
          ? '<span class="badge" style="background:var(--suds-300);">ACTIVE</span>'
          : `<span class="badge">${escapeHtml(p.status)}</span>`,
      ];
    });

    const headings = ['Name', 'Phone', 'City', 'Orders'];
    if (showMoney) headings.push('Billed');
    headings.push('Status');

    const body = `
      ${sectionHeading('Everyone', 'Customers', (people || []).length)}
      ${table(headings, rows)}`;

    res.type('html').send(adminPage({ title: 'Customers', active: '/ops/customers', body, user: req.opsUser }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/customers/:id — one profile, with their whole order history
// ---------------------------------------------------------------------------

router.get('/ops/customers/:id', guard, may('customers.view'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return notFoundPage(res, 'That customer id is not valid.');

    const { data: person, error } = await db
      .from('customers')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!person) return notFoundPage(res, 'No customer with that id.');

    const { data: history } = await db
      .from('orders')
      .select('id, status, pickup_date, weight_lb, price_cents, payment_status')
      .eq('customer_id', person.id)
      .order('pickup_date', { ascending: false });

    const showMoney = roles.can(req.opsUser, 'money.view');
    const prefs = person.preferences || {};
    const billed = (history || [])
      .filter((o) => o.payment_status !== 'WAIVED')
      .reduce((sum, o) => sum + (o.price_cents || 0), 0);

    const detail = (label, value) => `
      <div style="display:flex;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:1px solid var(--ink-100);">
        <span class="eyebrow" style="margin:0;">${escapeHtml(label)}</span>
        <span style="font-size:16px;text-align:right;">${value}</span>
      </div>`;

    const card = person.card_last4
      ? `${escapeHtml(person.card_brand || 'card')} ending ${escapeHtml(person.card_last4)}`
      : 'none on file';

    const body = `
      <a href="/ops/customers" style="font-size:15px;font-weight:600;">&larr; All customers</a>

      <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:14px;margin:18px 0 32px;">
        <h1 style="font-family:var(--font-display);font-weight:900;font-size:38px;letter-spacing:-0.03em;margin:0;">
          ${escapeHtml(person.name || 'Unnamed')}
        </h1>
        <span class="badge" style="${person.status === 'ACTIVE' ? 'background:var(--suds-300);' : ''}">${escapeHtml(person.status)}</span>
      </div>

      <div class="grid-2" style="align-items:start;margin-bottom:44px;">

        <div class="card card-xl" style="padding:28px;">
          ${sectionHeading('Contact', 'Details')}
          ${detail('Phone', `<a href="tel:${escapeHtml(person.phone)}">${escapeHtml(person.phone)}</a>`)}
          ${detail('Email', `<a href="mailto:${escapeHtml(person.email)}">${escapeHtml(person.email || '—')}</a>`)}
          ${detail('Address', escapeHtml(addressOf(person)) || '—')}
          ${detail('Signed up', dateTime(person.created_at))}
          ${detail('Texting consent', person.sms_consent_at ? dateTime(person.sms_consent_at) : 'not recorded')}
          ${showMoney ? detail('Card', card) + detail('Lifetime billed', `<strong>${money(billed)}</strong>`) : ''}
        </div>

        <div class="card card-xl" style="padding:28px;">
          ${sectionHeading('Wash', 'Preferences')}
          ${detail('Temperature', escapeHtml(prefs.water_temp || 'COLD'))}
          ${detail('Detergent', escapeHtml((prefs.detergent || 'STANDARD').replace(/_/g, ' ')))}
          ${detail('Fabric softener', prefs.fabric_softener ? 'yes' : 'no')}
          ${detail('Usual pickup', escapeHtml((prefs.default_pickup_method || 'LEAVE_OUTSIDE').replace(/_/g, ' ').toLowerCase()))}
          ${
            prefs.special_instructions
              ? detail('Instructions', escapeHtml(prefs.special_instructions))
              : ''
          }
        </div>

      </div>

      ${sectionHeading('Everything they have sent us', 'Order history', (history || []).length)}
      ${table(
        showMoney
          ? ['Pickup', 'Status', 'Weight', 'Price', 'Payment', '']
          : ['Pickup', 'Status', 'Weight', ''],
        (history || []).map((o) => [
          shortDate(o.pickup_date),
          statusBadge(o.status),
          o.weight_lb ? `${o.weight_lb} lb` : '—',
          ...(showMoney ? [money(o.price_cents), paymentBadge(o)] : []),
          `<a href="/ops/orders/${o.id}" style="font-weight:600;">Open</a>`,
        ])
      )}`;

    res.type('html').send(adminPage({ title: person.name || 'Customer', active: '/ops/customers', body, user: req.opsUser }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/partners — enquiries from the /partners page
// ---------------------------------------------------------------------------

const PARTNER_LABEL = { LAUNDROMAT: 'Laundromat', PROPERTY: 'Property' };

router.get('/ops/partners', guard, may('partners.view'), async (req, res, next) => {
  try {
    const { data, error } = await db
      .from('partner_enquiries')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const all = data || [];
    const isNew = (e) => e.status === 'NEW';

    // A card each rather than a table: these carry a free-text message that
    // does not belong in a cell, and there will be a handful, not hundreds.
    const cardFor = (e) => `
      <div class="card card-xl" style="padding:26px;margin-bottom:18px;${
        isNew(e) ? 'box-shadow:6px 6px 0 var(--sunbeam-500);' : ''
      }">
        <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;margin-bottom:14px;">
          <span class="badge" style="background:${
            e.partner_type === 'LAUNDROMAT' ? 'var(--suds-300)' : 'var(--lilac-300)'
          };">${escapeHtml(PARTNER_LABEL[e.partner_type] || e.partner_type)}</span>
          <span class="badge"${isNew(e) ? ' style="background:var(--sunbeam-500);"' : ''}>${escapeHtml(e.status)}</span>
          <span style="font-size:13px;color:var(--ink-500);">${dateTime(e.created_at)}</span>
        </div>

        <h3 style="font-family:var(--font-display);font-weight:800;font-size:24px;margin:0 0 6px;">
          ${escapeHtml(e.company)}
        </h3>
        <p style="font-size:16px;color:var(--ink-700);margin:0 0 14px;">
          ${escapeHtml(e.contact_name)}
          &middot; <a href="mailto:${escapeHtml(e.email)}">${escapeHtml(e.email)}</a>
          ${e.phone ? `&middot; <a href="tel:${escapeHtml(e.phone)}">${escapeHtml(e.phone)}</a>` : ''}
        </p>

        <div style="display:flex;flex-wrap:wrap;gap:22px;font-size:15px;color:var(--ink-700);margin-bottom:${
          e.message ? '14px' : '18px'
        };">
          ${e.city ? `<span><strong>Where:</strong> ${escapeHtml(e.city)}</span>` : ''}
          ${e.size_note ? `<span><strong>Size:</strong> ${escapeHtml(e.size_note)}</span>` : ''}
        </div>

        ${
          e.message
            ? `<p style="font-size:16px;line-height:1.55;color:var(--ink-800);background:var(--paper-200);border:2px solid var(--ink-900);border-radius:var(--radius-md);padding:14px 16px;margin:0 0 18px;">${escapeHtml(
                e.message
              )}</p>`
            : ''
        }

        <form method="post" action="/ops/partners/${e.id}/status" style="display:flex;gap:10px;flex-wrap:wrap;margin:0;">
          ${
            e.status !== 'CONTACTED'
              ? '<button class="btn btn-sm btn-primary" name="status" value="CONTACTED">Mark contacted</button>'
              : ''
          }
          ${
            e.status !== 'CLOSED'
              ? '<button class="btn btn-sm btn-outline" name="status" value="CLOSED">Close</button>'
              : ''
          }
          ${
            e.status !== 'NEW'
              ? '<button class="btn btn-sm btn-ghost" name="status" value="NEW">Reopen</button>'
              : ''
          }
        </form>
      </div>`;

    const group = (heading, list) =>
      list.length
        ? `<section style="margin-bottom:48px;">
             ${sectionHeading(heading === 'Waiting on you' ? 'New' : 'Handled', heading, list.length)}
             ${list.map(cardFor).join('')}
           </section>`
        : '';

    const body = `
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:44px;">
        ${statCard('New', all.filter(isNew).length, all.some(isNew) ? 'var(--sunbeam-500)' : 'var(--paper-050)')}
        ${statCard('Laundromats', all.filter((e) => e.partner_type === 'LAUNDROMAT').length)}
        ${statCard('Properties', all.filter((e) => e.partner_type === 'PROPERTY').length)}
      </div>

      ${
        all.length
          ? group('Waiting on you', all.filter(isNew)) + group('Dealt with', all.filter((e) => !isNew(e)))
          : `<div class="card card-xl" style="padding:32px;">
               ${sectionHeading('Partners', 'Nothing yet')}
               <p style="font-size:16px;line-height:1.55;color:var(--ink-700);margin:0;">
                 Enquiries from <a href="/partners">the partners page</a> land here —
                 laundromats with spare capacity and property managers who want
                 LYNDRY offered to their residents.
               </p>
             </div>`
      }`;

    res.type('html').send(adminPage({ title: 'Partners', active: '/ops/partners', body, user: req.opsUser }));
  } catch (err) {
    next(err);
  }
});

router.post('/ops/partners/:id/status', guard, may('partners.manage'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return notFoundPage(res, 'That enquiry id is not valid.');

    const status = String((req.body || {}).status || '');
    if (!['NEW', 'CONTACTED', 'CLOSED'].includes(status)) {
      return notFoundPage(res, 'That is not a status an enquiry can have.');
    }

    const { error } = await db.from('partner_enquiries').update({ status }).eq('id', req.params.id);
    if (error) throw error;

    // Redirect rather than render, so a refresh doesn't resubmit.
    return res.redirect(303, '/ops/partners');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/team — who can sign in
// ---------------------------------------------------------------------------

router.get('/ops/team', guard, may('team.manage'), async (req, res, next) => {
  try {
    const { data: people, error } = await db
      .from('ops_users')
      .select('id, name, phone, status, role, last_login_at, created_at')
      .order('created_at', { ascending: true });

    if (error) throw error;

    const ROLE_TONE = {
      ADMIN: 'var(--sunbeam-500)',
      DRIVER: 'var(--suds-300)',
      SALES: 'var(--lilac-300)',
    };

    const roleControl = (p, isMe) => {
      // You cannot change your own role, for the same reason you cannot switch
      // yourself off: demoting yourself out of team management locks the door
      // behind you.
      if (isMe) {
        return `<span class="badge" style="background:${ROLE_TONE[p.role]};">${escapeHtml(
          roles.labelFor(p.role)
        )}</span>`;
      }

      return `
        <form method="post" action="/ops/team/${p.id}/role" style="margin:0;display:flex;gap:8px;">
          <select class="select" name="role" style="min-height:36px;padding:4px 10px;font-size:14px;">
            ${Object.keys(roles.ROLES)
              .map(
                (key) =>
                  `<option value="${key}"${key === p.role ? ' selected' : ''}>${escapeHtml(
                    roles.labelFor(key)
                  )}</option>`
              )
              .join('')}
          </select>
          <button class="btn btn-sm btn-outline">Save</button>
        </form>`;
    };

    const rows = (people || []).map((p) => {
      const isMe = p.id === req.opsUser.id;
      return [
        `${escapeHtml(p.name)}${isMe ? ' <span style="color:var(--ink-400);">(you)</span>' : ''}`,
        escapeHtml(formatPhone(p.phone)),
        roleControl(p, isMe),
        p.status === 'ACTIVE'
          ? '<span class="badge" style="background:var(--suds-300);">ACTIVE</span>'
          : '<span class="badge">DISABLED</span>',
        p.last_login_at ? dateTime(p.last_login_at) : 'never',
        // You cannot switch yourself off — that is the one way to lock
        // everybody out of a tool with no other way back in.
        isMe
          ? '<span style="color:var(--ink-400);font-size:14px;">—</span>'
          : `<form method="post" action="/ops/team/${p.id}/status" style="margin:0;">
               <button class="btn btn-sm ${p.status === 'ACTIVE' ? 'btn-outline' : 'btn-primary'}"
                       name="status" value="${p.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'}">
                 ${p.status === 'ACTIVE' ? 'Switch off' : 'Switch on'}
               </button>
             </form>`,
      ];
    });

    const body = `
      ${sectionHeading('Who can sign in', 'Team', (people || []).length)}

      ${
        req.query.added
          ? `<div class="card card-xl" style="padding:18px 22px;margin-bottom:24px;background:var(--suds-100);">
               <p style="font-size:16px;margin:0;">Added. They can sign in with that number now.</p>
             </div>`
          : ''
      }
      ${
        req.query.error
          ? `<div role="alert" class="card card-xl" style="padding:18px 22px;margin-bottom:24px;background:var(--stain-100);box-shadow:6px 6px 0 var(--stain-500);">
               <p style="font-size:16px;margin:0;">${escapeHtml(String(req.query.error))}</p>
             </div>`
          : ''
      }

      ${table(['Name', 'Mobile', 'Role', 'Status', 'Last signed in', ''], rows)}

      <div class="grid-2" style="align-items:start;margin-top:44px;">

        <div class="card card-xl" style="padding:28px;">
          ${sectionHeading('Add someone', 'New person')}
          <form method="post" action="/ops/team">
            <div class="stack">
              <div class="field">
                <label class="field-label" for="t_name">Name</label>
                <input class="input input-lg" type="text" id="t_name" name="name" required>
              </div>
              <div class="field">
                <label class="field-label" for="t_phone">Mobile number</label>
                <input class="input input-lg" type="tel" id="t_phone" name="phone" required
                       inputmode="tel" placeholder="(201) 555-0142">
                <span class="field-hint">They sign in with this. It has to receive texts.</span>
              </div>
              <div class="field">
                <label class="field-label" for="t_role">Role</label>
                <select class="select input-lg" id="t_role" name="role">
                  ${Object.entries(roles.ROLES)
                    .map(
                      ([key, r]) =>
                        `<option value="${key}"${
                          key === roles.DEFAULT_ROLE ? ' selected' : ''
                        }>${escapeHtml(r.label)} — ${escapeHtml(r.description)}</option>`
                    )
                    .join('')}
                </select>
              </div>
            </div>
            <button type="submit" class="btn btn-ink btn-lg" style="margin-top:20px;">
              Add them ${icon('arrow-right', '22')}
            </button>
          </form>
        </div>

        <div class="card card-xl card-sunken" style="padding:28px;">
          ${sectionHeading('Reference', 'What each role sees')}
          ${Object.entries(roles.ROLES)
            .map(
              ([key, r]) => `
            <div style="padding:14px 0;border-bottom:1px solid var(--ink-100);">
              <span class="badge" style="background:${ROLE_TONE[key]};">${escapeHtml(r.label)}</span>
              <p style="font-size:15px;line-height:1.5;color:var(--ink-700);margin:10px 0 0;">
                ${escapeHtml(r.description)}
              </p>
            </div>`
            )
            .join('')}
        </div>

      </div>`;

    res.type('html').send(adminPage({ title: 'Team', active: '/ops/team', body, user: req.opsUser }));
  } catch (err) {
    next(err);
  }
});

router.post('/ops/team', guard, may('team.manage'), async (req, res, next) => {
  try {
    const name = String((req.body || {}).name || '').trim();
    const phone = normalisePhone((req.body || {}).phone);

    if (!name) return res.redirect(303, '/ops/team?error=' + encodeURIComponent('They need a name.'));
    if (!phone) {
      return res.redirect(
        303,
        '/ops/team?error=' + encodeURIComponent('That does not look like a US mobile number.')
      );
    }

    // Anything unrecognised falls back to the least privileged role rather
    // than to whatever was posted.
    const role = roles.ROLES[String((req.body || {}).role || '')]
      ? String((req.body || {}).role)
      : roles.DEFAULT_ROLE;

    const { error } = await db.from('ops_users').insert({ name, phone, role, status: 'ACTIVE' });

    if (error) {
      // The unique index on phone is what catches a duplicate.
      const message = /duplicate|unique/i.test(error.message)
        ? 'Someone is already set up with that number.'
        : error.message;
      return res.redirect(303, '/ops/team?error=' + encodeURIComponent(message));
    }

    return res.redirect(303, '/ops/team?added=1');
  } catch (err) {
    return next(err);
  }
});

router.post('/ops/team/:id/role', guard, may('team.manage'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return notFoundPage(res, 'That person id is not valid.');

    const role = String((req.body || {}).role || '');
    if (!roles.ROLES[role]) return notFoundPage(res, 'That is not a role.');

    // Same reasoning as switching yourself off: demoting yourself out of team
    // management locks the door behind you.
    if (req.params.id === req.opsUser.id) {
      return res.redirect(
        303,
        '/ops/team?error=' + encodeURIComponent('You cannot change your own role.')
      );
    }

    const { error } = await db.from('ops_users').update({ role }).eq('id', req.params.id);
    if (error) throw error;

    return res.redirect(303, '/ops/team');
  } catch (err) {
    return next(err);
  }
});

router.post('/ops/team/:id/status', guard, may('team.manage'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return notFoundPage(res, 'That person id is not valid.');

    const status = String((req.body || {}).status || '');
    if (!['ACTIVE', 'DISABLED'].includes(status)) {
      return notFoundPage(res, 'That is not a status a person can have.');
    }

    // Belt and braces: the page hides the button, and this refuses it anyway.
    // Switching yourself off is how a tool with no other way in gets locked.
    if (req.params.id === req.opsUser.id) {
      return res.redirect(
        303,
        '/ops/team?error=' + encodeURIComponent('You cannot switch yourself off.')
      );
    }

    const { error } = await db.from('ops_users').update({ status }).eq('id', req.params.id);
    if (error) throw error;

    return res.redirect(303, '/ops/team');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------

function notFoundPage(res, message) {
  return res.status(404).type('html').send(
    adminPage({
      title: 'Not found',
      body: `
      <h1 style="font-family:var(--font-display);font-weight:900;font-size:38px;letter-spacing:-0.03em;margin:0 0 12px;">Not found</h1>
      <p style="font-size:17px;color:var(--ink-700);">${escapeHtml(message)}</p>
      <a href="/ops" class="btn btn-primary" style="margin-top:20px;">All orders</a>`,
    })
  );
}

module.exports = { router };
