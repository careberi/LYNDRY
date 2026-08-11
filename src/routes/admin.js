'use strict';

const express = require('express');

const db = require('../db');
const orders = require('../core/orders');
const auth = require('../core/admin-auth');
const { config } = require('../config');
const { site } = require('../web/site');
const { escapeHtml, logo, icon, CSS_BASE } = require('../web/layout');

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

function adminPage({ title, active = '', body }) {
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
      <nav class="site-nav">
        ${tab('/ops', 'Orders')}
        ${tab('/ops/customers', 'Customers')}
        ${tab('/ops/partners', 'Partners')}
      </nav>
      <form method="post" action="/ops/logout" style="margin:0;">
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

function loginPage({ error = '', next = '/ops' } = {}) {
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
    <div class="container" style="max-width:460px;">

      <div style="margin-bottom:32px;">${logo('offset', { href: null })}</div>

      <p class="eyebrow eyebrow-brand">Operations</p>
      <h1 class="display-4" style="margin-bottom:10px;">Sign in.</h1>
      <p style="font-size:17px;line-height:1.5;color:var(--ink-800);margin:0 0 28px;">
        Enter the access code. You'll stay signed in on this device.
      </p>

      ${
        error
          ? `<div role="alert" class="card card-xl" style="padding:20px;margin-bottom:22px;background:var(--stain-100);box-shadow:6px 6px 0 var(--stain-500);">
               <p style="font-size:16px;line-height:1.5;color:var(--ink-900);margin:0;">${escapeHtml(error)}</p>
             </div>`
          : ''
      }

      <form method="post" action="/ops/login" class="card card-xl" style="padding:28px;">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <div class="field">
          <label class="field-label" for="code">Access code</label>
          <input class="input input-lg" type="password" id="code" name="code" required
                 autocomplete="current-password" autofocus>
        </div>
        <button type="submit" class="btn btn-ink btn-lg btn-full" style="margin-top:20px;">
          Sign in ${icon('arrow-right', '22')}
        </button>
      </form>

    </div>
  </main>
</body>
</html>`;
}

router.get('/ops/login', (req, res) => {
  // Already signed in? Don't make them do it again.
  if (auth.isAuthed(req)) return res.redirect(302, safeNext(req.query.next));

  res.type('html').send(loginPage({ next: safeNext(req.query.next) }));
});

router.post('/ops/login', (req, res) => {
  const next = safeNext((req.body || {}).next);

  if (!auth.hasKey()) {
    return res
      .status(503)
      .type('html')
      .send(loginPage({ error: 'ADMIN_API_KEY is not set on the server.', next }));
  }

  if (auth.tooManyAttempts(req)) {
    return res
      .status(429)
      .type('html')
      .send(loginPage({ error: 'Too many attempts. Wait fifteen minutes and try again.', next }));
  }

  if (!auth.sameSecret((req.body || {}).code, config.adminApiKey)) {
    auth.recordFailure(req);
    console.warn('Failed ops sign-in attempt.');
    return res
      .status(401)
      .type('html')
      .send(loginPage({ error: "That code isn't right.", next }));
  }

  auth.clearFailures(req);
  auth.setSessionCookie(res);
  return res.redirect(303, next);
});

router.post('/ops/logout', (req, res) => {
  auth.clearSessionCookie(res);
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

// ---------------------------------------------------------------------------
// GET /ops — the orders board
// ---------------------------------------------------------------------------

const ORDER_FIELDS =
  'id, status, pickup_date, pickup_method, bag_count, weight_lb, price_cents, payment_status, ' +
  'delivery_photo_url, notes, created_at, customers(id, name, phone, address_line1, address_line2, city, postal_code)';

router.get('/ops', guard, async (req, res, next) => {
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

    const row = (o) => {
      const c = o.customers || {};
      return [
        `<a href="/ops/orders/${o.id}" style="font-weight:600;">${escapeHtml(c.name || 'Unknown')}</a>
         <div style="font-size:13px;color:var(--ink-500);">${escapeHtml(addressOf(c))}</div>`,
        shortDate(o.pickup_date),
        statusBadge(o.status),
        o.weight_lb ? `${o.weight_lb} lb` : '—',
        money(o.price_cents),
        paymentBadge(o),
      ];
    };

    const board = (eyebrow, heading, list) => `
      <section style="margin-bottom:56px;">
        ${sectionHeading(eyebrow, heading, list.length)}
        ${table(['Customer', 'Pickup', 'Status', 'Weight', 'Price', 'Payment'], list.map(row))}
      </section>`;

    const body = `
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:44px;">
        ${statCard('Active', active.length)}
        ${statCard('Upcoming', upcoming.length)}
        ${statCard('Completed', past.filter((o) => o.status === 'DELIVERED').length)}
        ${
          owed.length
            ? statCard('Owed', money(owedTotal), 'var(--stain-500)', 'var(--paper-050)')
            : ''
        }
      </div>

      ${board('Right now', 'Active', active)}
      ${board('Booked', 'Upcoming', upcoming)}
      ${board('Finished', 'Past', past)}
    `;

    res.type('html').send(adminPage({ title: 'Orders', active: '/ops', body }));
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

router.get('/ops/orders/:id', guard, async (req, res, next) => {
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
          ${detail('Rate', money(order.price_per_lb_cents) + ' / lb')}
          ${detail('Price', `<strong>${money(order.price_cents)}</strong>`)}
          ${detail('Payment', escapeHtml(order.payment_status) + (order.paid_at ? ` on ${dateTime(order.paid_at)}` : ''))}
          ${order.payment_failure_reason ? detail('Decline reason', escapeHtml(order.payment_failure_reason)) : ''}
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
              <a href="/ops/customers/${c.id}" class="btn btn-outline">Full profile ${icon('arrow-right', '16')}</a>
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

    res.type('html').send(adminPage({ title: 'Order', active: '/ops', body }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/customers — everyone
// ---------------------------------------------------------------------------

router.get('/ops/customers', guard, async (req, res, next) => {
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

    const rows = (people || []).map((p) => {
      const stats = byCustomer.get(p.id) || { count: 0, spent: 0 };
      return [
        `<a href="/ops/customers/${p.id}" style="font-weight:600;">${escapeHtml(p.name || '—')}</a>`,
        `<a href="tel:${escapeHtml(p.phone)}">${escapeHtml(p.phone)}</a>`,
        escapeHtml(p.city || '—'),
        String(stats.count),
        money(stats.spent),
        p.status === 'ACTIVE'
          ? '<span class="badge" style="background:var(--suds-300);">ACTIVE</span>'
          : `<span class="badge">${escapeHtml(p.status)}</span>`,
      ];
    });

    const body = `
      ${sectionHeading('Everyone', 'Customers', (people || []).length)}
      ${table(['Name', 'Phone', 'City', 'Orders', 'Billed', 'Status'], rows)}`;

    res.type('html').send(adminPage({ title: 'Customers', active: '/ops/customers', body }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/customers/:id — one profile, with their whole order history
// ---------------------------------------------------------------------------

router.get('/ops/customers/:id', guard, async (req, res, next) => {
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
          ${detail('Card', card)}
          ${detail('Lifetime billed', `<strong>${money(billed)}</strong>`)}
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
        ['Pickup', 'Status', 'Weight', 'Price', 'Payment', ''],
        (history || []).map((o) => [
          shortDate(o.pickup_date),
          statusBadge(o.status),
          o.weight_lb ? `${o.weight_lb} lb` : '—',
          money(o.price_cents),
          paymentBadge(o),
          `<a href="/ops/orders/${o.id}" style="font-weight:600;">Open</a>`,
        ])
      )}`;

    res.type('html').send(adminPage({ title: person.name || 'Customer', active: '/ops/customers', body }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/partners — enquiries from the /partners page
// ---------------------------------------------------------------------------

const PARTNER_LABEL = { LAUNDROMAT: 'Laundromat', PROPERTY: 'Property' };

router.get('/ops/partners', guard, async (req, res, next) => {
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

    res.type('html').send(adminPage({ title: 'Partners', active: '/ops/partners', body }));
  } catch (err) {
    next(err);
  }
});

router.post('/ops/partners/:id/status', guard, async (req, res, next) => {
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
