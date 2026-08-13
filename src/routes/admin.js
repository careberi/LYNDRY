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
const booking = require('../core/booking');
const issues = require('../core/issues');
const { runEconomicsBody } = require('../web/run-economics');
const { routePlannerBody, routePlannerHead } = require('../web/route-planner');
const { processBody } = require('../web/process');
const { labelSheetBody } = require('../web/labels');
const bags = require('../core/bags');
const fulfilment = require('../core/fulfilment');

// The delivery photo arrives from a phone camera, so it is held in memory and
// pushed straight to storage. Same limits as the JSON API.
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

// A timestamp, shown in New Jersey's time rather than the server's.
//
// Railway runs in UTC, so this used to render a text sent at 6pm as "10pm" and
// tip messages sent after 8pm onto the following day. On a message thread that
// is not a cosmetic problem: the timestamps are how you work out what happened
// in what order when a customer says nobody ever replied to them.
const STAMP = new Intl.DateTimeFormat('en-US', {
  timeZone: booking.SERVICE_TZ,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

function dateTime(iso) {
  if (!iso) return '—';

  const parts = {};
  for (const p of STAMP.formatToParts(new Date(iso))) parts[p.type] = p.value;

  return `${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${parts.dayPeriod.toLowerCase()}`;
}

// "just now", "20m ago", "3d ago" — for a conversation list, where how long
// someone has been waiting for a reply is the thing you are scanning for.
function timeAgo(iso) {
  if (!iso) return '';

  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : dateTime(iso);
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

// `head` is for the rare page that needs something of its own in <head> - the
// route planner's map library, and so far nothing else. Kept as a parameter
// rather than letting pages write their own <head> so that every ops screen
// still gets the same stylesheets, the same noindex and the same furniture.
function adminPage({ title, active = '', body, user = null, openIssues = 0, head = '' }) {
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
${head}
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
        ${roles.can(user, 'messages.view') ? tab('/ops/messages', 'Messages') : ''}
        ${roles.can(user, 'issues.manage') ? tab('/ops/issues', 'Issues') : ''}
        ${roles.can(user, 'money.view') ? tab('/ops/economics', 'Economics') : ''}
        ${roles.can(user, 'money.view') ? tab('/ops/planner', 'Planner') : ''}
        ${roles.can(user, 'partners.view') ? tab('/ops/partners', 'Partners') : ''}
        ${roles.can(user, 'team.manage') ? tab('/ops/team', 'Team') : ''}
        <!-- No permission on this one. It is the page you hand a new driver on
             their first morning, and it holds no customer and no wholesale
             figure - only how the service works. -->
        ${tab('/ops/process', 'Process')}
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
${
    // THE FLAG THAT WILL NOT GO AWAY.
    //
    // On every ops page, on every load, until a person resolves it. There is
    // deliberately no dismiss button: a customer whose shirt was ruined should
    // be impossible to forget, and a banner you can close is a banner that
    // gets closed.
    openIssues
      ? `<a href="/ops/issues" style="display:block;text-decoration:none;margin-bottom:32px;">
           <div class="card" style="padding:18px 24px;background:var(--stain-500);color:var(--paper-050);">
             <div style="display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;">
               <div>
                 <div class="eyebrow" style="margin:0 0 4px;color:var(--paper-050);">Needs a person</div>
                 <div style="font-family:var(--font-display);font-weight:900;font-size:24px;line-height:1.1;">
                   ${openIssues} unresolved ${openIssues === 1 ? 'issue' : 'issues'}
                 </div>
               </div>
               <span style="font-size:16px;font-weight:700;text-decoration:underline;">Open them</span>
             </div>
           </div>
         </a>`
      : ''
  }
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

// ---------------------------------------------------------------------------
// The work card
//
// The single most-used thing on this screen: what a driver taps, standing on a
// doorstep with one hand full. Before this existed the only way to move an
// order along was a terminal command, which is fine for testing and useless
// for a round.
//
// Buttons are 56px and full width on a phone deliberately. Every one of them
// posts a form and reloads the page, with no JavaScript anywhere: a driver on
// two bars of signal in a stairwell gets a page that either worked or didn't,
// rather than a spinner that lies.
// ---------------------------------------------------------------------------

function workCard(order, { canAct, notice, problem }) {
  const weighed = order.weight_lb != null;

  // Weighing is an event rather than a step, so it is offered the whole time
  // we have the bag rather than at one point in the sequence.
  const canWeigh = orders.IN_FLIGHT.includes(order.status);

  // NOTHING LEAVES OUR HANDS UNWEIGHED.
  //
  // Once we have the bag, the next steps both send it somewhere: to a partner,
  // or back to the customer. Both need our own weight on record first, so the
  // buttons are withheld until there is one rather than offered and refused.
  // The rule is enforced in src/core/fulfilment.js as well; this just stops
  // the driver tapping something that cannot work.
  const mustWeighFirst = !weighed && order.status === 'IN_PROCESS';
  const steps = mustWeighFirst ? [] : fulfilment.nextSteps(order);

  if (!canAct) return '';

  const banner = (text, background) => `
    <p style="margin:0 0 18px;padding:13px 16px;border:2px solid var(--ink-900);border-radius:12px;
              background:${background};font-size:16px;font-weight:600;">${escapeHtml(text)}</p>`;

  // Delivered needs a photo, so it is a file input rather than a bare button.
  const stepButton = (s) =>
    s.to === 'DELIVERED'
      ? `
      <form method="post" action="/ops/orders/${order.order_number}/delivered"
            enctype="multipart/form-data" style="margin:0;display:flex;flex-direction:column;gap:10px;">
        <label class="field-label" for="photo">Photo at the door &mdash; required</label>
        <!-- The required attribute stops the tap before it costs a round
             trip. The real enforcement is in src/core/fulfilment.js, because
             the JSON API reaches the same code and a form attribute guards
             neither of them. -->
        <input class="input" type="file" id="photo" name="photo" accept="image/*" capture="environment" required>
        <button type="submit" class="btn btn-primary btn-lg btn-full">${s.label}</button>
        <span class="field-hint">
          This is the proof of delivery. The customer gets a link to it that expires after 30 days.
        </span>
      </form>`
      : `
      <form method="post" action="/ops/orders/${order.order_number}/${s.action}" style="margin:0;">
        <button type="submit" class="btn btn-primary btn-lg btn-full">${s.label}</button>
        <span class="field-hint" style="display:block;margin-top:6px;">${escapeHtml(s.hint)}</span>
      </form>`;

  return `
  <div class="card card-xl" style="padding:28px;margin-bottom:28px;">
    ${sectionHeading('Next', 'What happens now')}

    ${problem ? banner(problem, 'var(--stain-500)') : ''}
    ${notice ? banner(notice, 'var(--suds-300)') : ''}

    ${
      mustWeighFirst
        ? `<p style="margin:0 0 4px;padding:14px 18px;border:2px solid var(--ink-900);border-radius:12px;
                     background:var(--sunbeam-500);font-size:16px;line-height:1.45;">
             <strong>Weigh it before it goes anywhere.</strong> The weight sets the price, and it
             has to be ours rather than the partner's. Nothing else opens until it's in.
           </p>`
        : steps.length
          ? `<div style="display:flex;flex-direction:column;gap:22px;">${steps.map(stepButton).join('')}</div>`
          : `<p style="font-size:16px;color:var(--ink-500);margin:0;">
               Nothing left to do. This order is ${escapeHtml(order.status.replace(/_/g, ' ').toLowerCase())}.
             </p>`
    }

    ${
      canWeigh
        ? `
      <form method="post" action="/ops/orders/${order.order_number}/weight"
            style="margin:${mustWeighFirst ? '18px' : '26px'} 0 0;${
              // No divider when the scale IS the task: a rule under a
              // yellow "weigh it first" note reads as a separate section.
              mustWeighFirst ? '' : 'padding-top:24px;border-top:2px solid var(--ink-900);'
            }">
        <label class="field-label" for="weight_lb">
          ${weighed ? 'Correct the weight' : 'Weigh it'}
        </label>
        <div style="display:flex;gap:12px;align-items:flex-start;">
          <input class="input input-lg" type="number" id="weight_lb" name="weight_lb"
                 step="0.1" min="0.1" max="200" inputmode="decimal" required
                 ${mustWeighFirst ? 'autofocus' : ''}
                 style="flex:1;" value="${weighed ? escapeHtml(String(order.weight_lb)) : ''}"
                 placeholder="Pounds">
          <button type="submit" class="btn btn-${mustWeighFirst ? 'primary' : 'ink'} btn-lg">Save</button>
        </div>
        <span class="field-hint" style="display:block;margin-top:8px;">
          This sets the price and charges the card. ${
            weighed
              ? 'It has already been weighed once, so saving again is a correction and the customer is told so.'
              : 'It is the only moment money moves.'
          }
        </span>
      </form>`
        : ''
    }
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

// Counts what is unresolved, for the banner in the shell. Runs on every ops
// page so a new page cannot accidentally hide the flag; a failure here returns
// zero rather than taking the dashboard down.
async function withIssues(req, res, next) {
  req.openIssues = await issues.openCount().catch(() => 0);
  next();
}

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
  'id, order_number, status, pickup_date, pickup_time, pickup_window_start, pickup_window_end, pickup_method, bag_count, weight_lb, price_cents, payment_status, ' +
  'delivery_photo_url, notes, created_at, from_schedule, ' +
  // preferences carries where the driver should look and how it gets washed.
  // Without it the order page could show "leave outside" but not "front door",
  // which is the half the driver actually needs.
  'customers(id, name, phone, address_line1, address_line2, city, postal_code, preferences, recurring_cadence, recurring_weekday)';

router.get('/ops', guard, withIssues, may('orders.view'), async (req, res, next) => {
  try {
    const { data, error } = await db
      .from('orders')
      .select(`${ORDER_FIELDS}, collected_at, at_partner_at, ready_at, delivered_at`)
      .order('pickup_date', { ascending: false })
      .order('pickup_time', { ascending: true, nullsFirst: false });

    if (error) throw error;

    const all = data || [];
    const now = today();

    // Grouped by WHERE THE BAG PHYSICALLY IS, not by a vague notion of
    // "active". The old board had three buckets and AT_PARTNER matched none
    // of them, so a 45 lb order sat invisible at a laundromat. Every status
    // belongs to exactly one group below, which is what stops that recurring.
    const inGroup = {
      collect: (o) => orders.AWAITING_COLLECTION.includes(o.status) && o.pickup_date <= now,
      upcoming: (o) => orders.AWAITING_COLLECTION.includes(o.status) && o.pickup_date > now,
      van: (o) => o.status === 'IN_PROCESS',
      partner: (o) => o.status === 'AT_PARTNER',
      ready: (o) => o.status === 'READY',
      out: (o) => o.status === 'OUT_FOR_DELIVERY',
      past: (o) => ['DELIVERED', 'CANCELED'].includes(o.status),
    };

    const g = {};
    for (const [key, test] of Object.entries(inGroup)) g[key] = all.filter(test);

    // Anything a group forgot. If this is ever non-empty the board is lying,
    // so it is shown rather than swallowed.
    const grouped = new Set(Object.values(g).flat().map((o) => o.id));
    g.stray = all.filter((o) => !grouped.has(o.id));

    // With us right now: collected and not yet back at their door.
    const withUs = [...g.van, ...g.partner, ...g.ready, ...g.out];
    const poundsWithUs = withUs.reduce((sum, o) => sum + Number(o.weight_lb || 0), 0);
    const late = withUs.filter((o) => {
      const t = fulfilment.turnaround(o);
      return t && t.overdue;
    });

    const owed = all.filter((o) => ['FAILED', 'UNPAID'].includes(o.payment_status) && o.price_cents);
    const owedTotal = owed.reduce((sum, o) => sum + (o.price_cents || 0), 0);

    // A driver does the round; they have no business seeing the books. The
    // money columns are dropped from the markup entirely rather than hidden
    // with CSS — a value that never reaches the page cannot leak from it.
    const showMoney = roles.can(req.opsUser, 'money.view');

    const clock = (o) => {
      const t = fulfilment.turnaround(o);
      if (!t) return '—';
      const tone = t.overdue ? 'var(--stain-500)' : t.urgent ? 'var(--sunbeam-500)' : 'var(--ink-100)';
      const ink = t.overdue ? 'var(--paper-050)' : 'var(--ink-900)';
      return `<span class="badge" style="background:${tone};color:${ink};white-space:nowrap;">${escapeHtml(t.text)}</span>`;
    };

    const row = (o) => {
      const c = o.customers || {};
      return [
        `<a href="/ops/orders/${o.order_number}" style="font-weight:700;font-variant-numeric:tabular-nums;">#${o.order_number}</a>`,
        `<a href="/ops/orders/${o.order_number}" style="font-weight:600;">${escapeHtml(c.name || 'Unknown')}</a>
         <div style="font-size:13px;color:var(--ink-500);">${escapeHtml(addressOf(c))}</div>`,
        // The window under the day, because "Wednesday" is not enough to plan a
        // round with once customers start naming times.
        `${shortDate(o.pickup_date)}${
          o.pickup_window_start
            ? `<div style="font-size:13px;color:var(--ink-500);">${escapeHtml(booking.arrivalWindow(o))}</div>`
            : ''
        }`,
        statusBadge(o.status),
        clock(o),
        o.weight_lb ? `${o.weight_lb} lb` : '—',
        ...(showMoney ? [money(o.price_cents), paymentBadge(o)] : []),
      ];
    };

    const headings = ['Order', 'Customer', 'Pickup', 'Status', 'Clock', 'Weight'];
    if (showMoney) headings.push('Price', 'Payment');

    // A section is only drawn when it has something in it, so the board is a
    // list of work rather than a wall of "Nothing here".
    const board = (eyebrow, heading, list, note = '') =>
      list.length
        ? `
      <section style="margin-bottom:48px;">
        ${sectionHeading(eyebrow, heading, list.length)}
        ${note ? `<p style="font-size:15px;color:var(--ink-500);margin:-10px 0 18px;">${note}</p>` : ''}
        ${table(headings, list.map(row))}
      </section>`
        : '';

    const body = `
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:40px;">
        ${statCard('To collect', g.collect.length, g.collect.length ? 'var(--suds-300)' : undefined)}
        ${statCard('At laundromat', g.partner.length)}
        ${statCard('Ready to collect', g.ready.length, g.ready.length ? 'var(--sunbeam-500)' : undefined)}
        ${statCard('Out for delivery', g.out.length)}
        ${statCard('Pounds with us', poundsWithUs ? `${poundsWithUs} lb` : '0')}
        ${late.length ? statCard('Late', late.length, 'var(--stain-500)', 'var(--paper-050)') : ''}
        ${showMoney && owed.length ? statCard('Owed', money(owedTotal), 'var(--stain-500)', 'var(--paper-050)') : ''}
      </div>

      ${board('Not in a group', 'Unclassified', g.stray, 'These match no stage. That is a bug worth reporting.')}
      ${board('Ready', 'Ready to collect from the partner', g.ready, 'Washed and folded. Collect these and get them out.')}
      ${board('Today', 'To collect from customers', g.collect)}
      ${board('On the van', 'Collected, not yet dropped', g.van)}
      ${board('At the partner', 'Being washed', g.partner)}
      ${board('On the way back', 'Out for delivery', g.out)}
      ${board('Booked', 'Upcoming', g.upcoming)}
      ${board('Finished', 'Past', g.past)}

      ${
        all.length
          ? ''
          : '<p style="font-size:17px;color:var(--ink-500);">No orders yet. The first one will appear here the moment somebody books.</p>'
      }
    `;

    res.type('html').send(adminPage({ title: 'Orders', active: '/ops', body, user: req.opsUser, openIssues: req.openIssues }));
  } catch (err) {
    next(err);
  }
});

function statCard(label, value, bg = 'var(--paper-050)', fg = 'var(--ink-900)') {
  // Zero is drawn quieter than a number that needs acting on: a board of
  // shouting zeroes is a board nobody reads.
  return `
  <div class="card" style="padding:18px 24px;min-width:130px;background:${bg};color:${fg};">
    <div style="font-family:var(--font-display);font-weight:900;font-size:32px;line-height:1;">${value}</div>
    <div class="eyebrow" style="margin:8px 0 0;color:${fg === 'var(--ink-900)' ? 'var(--ink-500)' : fg};">${escapeHtml(label)}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// The bags on an order, and the stickers on the bags.
//
// A sticker means nothing until it is on a bag. Binding is a driver typing or
// scanning the six characters printed under the QR, which is why the input is
// a plain text box: the camera in phase 9c fills the same box, and on the day
// the camera will not focus in a dark basement the driver reads the code out
// and types it. The fallback is the primary path with one step added, not a
// separate worse mode.
// ---------------------------------------------------------------------------

function bagsCard(order, labels, canAct) {
  const total = labels.length;
  const done = ['DELIVERED', 'CANCELED'].includes(order.status);

  const rows = labels
    .map(
      (l) => `
    <div style="display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--ink-100);">
      <span style="font-family:var(--font-mono);font-size:22px;font-weight:700;letter-spacing:0.06em;">
        ${escapeHtml(l.code)}
      </span>
      <span class="eyebrow" style="margin:0;">Bag ${l.position} of ${total}</span>
      <span style="flex:1;"></span>
      ${
        canAct && !done
          ? `<form method="post" action="/ops/orders/${order.order_number}/label/${l.id}/release" style="margin:0;">
               <button type="submit" class="btn btn-outline btn-sm">Take off</button>
             </form>`
          : ''
      }
    </div>`
    )
    .join('');

  return `
  <div class="card card-xl" style="padding:28px;margin-bottom:28px;">
    <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:14px;margin-bottom:6px;">
      ${sectionHeading('The bags', total ? `${total} labelled` : 'No labels yet')}
      <a href="/ops/labels" style="font-size:14px;font-weight:600;">Print more stickers</a>
    </div>

    ${
      total
        ? rows
        : `<p style="color:var(--ink-500);font-size:15px;line-height:1.6;margin:4px 0 0;">
             Nothing labelled yet. Stick a label on each bag as you pick it up and
             enter its code here, so the bag can be identified without opening it.
           </p>`
    }

    ${
      canAct && !done
        ? `<form method="post" action="/ops/orders/${order.order_number}/label" style="margin:20px 0 0;">
             <label class="eyebrow" for="label_code" style="display:block;margin-bottom:8px;">
               Add a bag
             </label>
             <div style="display:flex;gap:12px;align-items:flex-start;">
               <input class="input input-lg" type="text" id="label_code" name="code" required
                      autocomplete="off" autocapitalize="characters" spellcheck="false"
                      inputmode="text" maxlength="12" placeholder="Code under the QR"
                      style="flex:1;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.08em;">
               <button type="submit" class="btn btn-ink btn-lg">Add</button>
             </div>
             <span class="field-hint" style="display:block;margin-top:8px;">
               Six characters. O reads as zero and I or L as one, so a misread still finds the right bag.
             </span>
           </form>`
        : ''
    }
  </div>`;
}

// ---------------------------------------------------------------------------
// GET /ops/orders/:id — one order, in full
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/ops/orders/:id', guard, withIssues, may('orders.view'), async (req, res, next) => {
  try {
    // Accepts either form: the UUID, or the number a person would actually
    // have — off a bag tag, out of a text, or read down the phone. A UUID
    // always has hyphens and letters, so digits alone are never ambiguous.
    const wanted = String(req.params.id);
    const byNumber = /^\d+$/.test(wanted);

    if (!byNumber && !UUID.test(wanted)) {
      return notFoundPage(res, 'That is not an order number or an order id.');
    }

    const { data: order, error } = await db
      .from('orders')
      // No special_instructions here — those live on the customer's
      // preferences, not on the order, and asking for them makes the whole
      // query fail rather than just returning null.
      .select(`${ORDER_FIELDS}, price_per_lb_cents, payment_failure_reason, paid_at`)
      .eq(byNumber ? 'order_number' : 'id', wanted)
      .maybeSingle();

    if (error) throw error;
    if (!order) return notFoundPage(res, `No order ${byNumber ? `#${wanted}` : 'with that id'}.`);

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

    // Which stickers are on this order's bags.
    const labels = await bags.forOrder(order.id);

    const body = `
      <a href="/ops" style="font-size:15px;font-weight:600;">&larr; All orders</a>

      <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:14px;margin:18px 0 32px;">
        <h1 style="font-family:var(--font-display);font-weight:900;font-size:38px;letter-spacing:-0.03em;margin:0;">
          <span style="font-variant-numeric:tabular-nums;">#${order.order_number}</span>
          <span style="color:var(--ink-400);">&middot;</span>
          ${escapeHtml(c.name || 'Unknown customer')}
        </h1>
        ${statusBadge(order.status)}
        ${paymentBadge(order)}
        ${
          // The promise, counting down. Only while we are holding it.
          (() => {
            const t = fulfilment.turnaround(order);
            if (!t) return '';
            const bg = t.overdue ? 'var(--stain-500)' : t.urgent ? 'var(--sunbeam-500)' : 'var(--ink-100)';
            const fg = t.overdue ? 'var(--paper-050)' : 'var(--ink-900)';
            return `<span class="badge" style="background:${bg};color:${fg};">${escapeHtml(t.text)} on the promise</span>`;
          })()
        }
      </div>

      ${workCard(order, {
        canAct: roles.can(req.opsUser, 'orders.act'),
        // ?note= carries a sentence the action wrote itself, for steps where a
        // fixed banner cannot say enough. Sliced and escaped like any other
        // thing a person put in a URL.
        notice: req.query.note
          ? String(req.query.note).slice(0, 200)
          : req.query.done
            ? DONE_MESSAGES[String(req.query.done)] || null
            : null,
        problem: req.query.problem ? String(req.query.problem).slice(0, 200) : null,
      })}

      ${bagsCard(order, labels, roles.can(req.opsUser, 'orders.act'))}

      <div class="grid-2" style="align-items:start;">

        <div class="card card-xl" style="padding:28px;">
          ${sectionHeading('The order', 'Details')}
          ${detail('Pickup', shortDate(order.pickup_date))}
          ${detail(
            'Window',
            order.pickup_window_start
              ? escapeHtml(booking.arrivalWindow(order))
              : 'no window set'
          )}
          ${detail(
            'They asked for',
            order.pickup_time ? escapeHtml(booking.readableTime(order.pickup_time)) : 'no time'
          )}
          ${detail('Method', escapeHtml((order.pickup_method || '').replace(/_/g, ' ').toLowerCase() || '—'))}
          ${
            // WHERE THE DRIVER SHOULD LOOK, in the customer's own words.
            //
            // The single most operationally useful line on this page, and it
            // was missing: a customer said "front door" and the page showed
            // only "leave outside", so the driver never saw the half that
            // tells them where to go.
            detail(
              'Where to find it',
              (() => {
                const spot = ((c.preferences || {}).special_instructions || '').trim();
                return spot
                  ? `<strong>${escapeHtml(spot)}</strong>`
                  : '<span style="color:var(--ink-500);">not specified</span>';
              })()
            )
          }
          ${
            // One-off instructions for THIS pickup, as opposed to their
            // standing spot above. Only drawn when there are some.
            order.notes
              ? detail('Just this time', escapeHtml(order.notes))
              : ''
          }
          ${
            // What the partner needs to know. On the order rather than only on
            // the customer, because this is the page open while a bag is being
            // handed over.
            (() => {
              const p = c.preferences || {};
              if (!p.water_temp) return '';
              const wash =
                `${String(p.water_temp).toLowerCase()} water, ` +
                `${p.detergent === 'HYPOALLERGENIC' ? 'hypoallergenic' : 'standard'} detergent, ` +
                `${p.fabric_softener ? 'softener' : 'no softener'}`;
              return detail('Wash', escapeHtml(wash));
            })()
          }
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

    res.type('html').send(adminPage({ title: 'Order', active: '/ops', body, user: req.opsUser, openIssues: req.openIssues }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/customers — everyone
// ---------------------------------------------------------------------------

router.get('/ops/customers', guard, withIssues, may('customers.view'), async (req, res, next) => {
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

    res.type('html').send(adminPage({ title: 'Customers', active: '/ops/customers', body, user: req.opsUser, openIssues: req.openIssues }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/customers/:id — one profile, with their whole order history
// ---------------------------------------------------------------------------

router.get('/ops/customers/:id', guard, withIssues, may('customers.view'), async (req, res, next) => {
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
        ${
          roles.can(req.opsUser, 'messages.view')
            ? `<a href="/ops/messages/${encodeURIComponent(
                String(person.phone || '').replace(/\D/g, '')
              )}" class="btn btn-outline btn-sm">Read the thread</a>`
            : ''
        }
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

    res.type('html').send(adminPage({ title: person.name || 'Customer', active: '/ops/customers', body, user: req.opsUser, openIssues: req.openIssues }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// The buttons on the order page
//
// One route per step, each a thin wrapper over src/core/fulfilment.js, which
// is the same code the JSON API calls. They answer with a redirect rather than
// JSON because a browser is on the other end: a driver who taps twice gets the
// page back with a plain sentence, not a wall of braces.
//
// Both middlewares, every time: guard proves who you are, may('orders.act')
// proves you are allowed to move an order. Admins have orders.act as well as
// drivers, so the same buttons appear for both.
// ---------------------------------------------------------------------------

// What the green banner says after each step. Keyed by the ?done= value so a
// refresh cannot repeat the action, only the message.
const DONE_MESSAGES = Object.freeze({
  collected: 'Collected. The customer has been texted.',
  'at-partner': 'Marked as dropped at the partner.',
  ready: 'Marked ready for collection.',
  weight: 'Weight saved. The price is set and the card has been charged.',
  // The label banner carries its own sentence in ?note=, because "added" and
  // "was already there" and "taken off" are three different things.
  label: null,
  'out-for-delivery': 'Out for delivery. The customer has been texted.',
  delivered: 'Delivered. The customer has been texted.',
});

// Loads the order behind an ops button. Accepts the number or the UUID, the
// same as the page itself.
async function loadOrderForAction(idOrNumber) {
  const wanted = String(idOrNumber);
  const byNumber = /^\d+$/.test(wanted);

  if (!byNumber && !UUID.test(wanted)) return null;

  const { data, error } = await db
    .from('orders')
    .select('*, customers(*)')
    .eq(byNumber ? 'order_number' : 'id', wanted)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// Every button route is this shape, so they are built rather than repeated.
function orderAction(action, run, middleware = null) {
  const handler = async (req, res, next) => {
    try {
      const order = await loadOrderForAction(req.params.id);
      if (!order) return notFoundPage(res, 'No order with that number.');

      const back = `/ops/orders/${order.order_number}`;

      const result = await run(order, req);

      if (!result.ok) {
        // A refused transition is a driver double-tapping, not a crash. Say
        // what happened in a sentence and put them back on the page.
        return res.redirect(303, `${back}?problem=${encodeURIComponent(result.detail || 'That did not work.')}`);
      }

      return res.redirect(303, `${back}?done=${action}`);
    } catch (err) {
      return next(err);
    }
  };

  const path = `/ops/orders/:id/${action}`;
  if (middleware) router.post(path, guard, may('orders.act'), middleware, handler);
  else router.post(path, guard, may('orders.act'), handler);
}

// req.body is undefined when a form posts nothing at all, which is exactly
// what a bare button does.
orderAction('collected', (order, req) => fulfilment.collect(order, { bagCount: (req.body || {}).bag_count }));
orderAction('at-partner', (order) => fulfilment.dropAtPartner(order));
orderAction('ready', (order) => fulfilment.markReady(order));
orderAction('weight', (order, req) => fulfilment.recordWeight(order, (req.body || {}).weight_lb));
orderAction('out-for-delivery', (order) => fulfilment.outForDelivery(order));
orderAction('delivered', (order, req) => fulfilment.deliver(order, req.file), upload.single('photo'));

// --- Sticking a label on a bag, and taking it off again ---------------------

router.post('/ops/orders/:id/label', guard, may('orders.act'), async (req, res, next) => {
  try {
    const order = await loadOrderForAction(req.params.id);
    if (!order) return notFoundPage(res, 'No order with that number.');

    const back = `/ops/orders/${order.order_number}`;
    const result = await bags.bind((req.body || {}).code, order, req.opsUser && req.opsUser.id);

    if (!result.ok) {
      return res.redirect(303, `${back}?problem=${encodeURIComponent(result.detail)}`);
    }

    // Scanning the same sticker twice is not a mistake worth a red banner.
    const note = result.already
      ? 'That label was already on this order.'
      : `Bag ${result.position} labelled.`;

    return res.redirect(303, `${back}?done=label&note=${encodeURIComponent(note)}`);
  } catch (err) {
    return next(err);
  }
});

router.post('/ops/orders/:id/label/:labelId/release', guard, may('orders.act'), async (req, res, next) => {
  try {
    const order = await loadOrderForAction(req.params.id);
    if (!order) return notFoundPage(res, 'No order with that number.');

    const back = `/ops/orders/${order.order_number}`;
    const label = await bags.release(req.params.labelId);

    if (!label) return res.redirect(303, `${back}?problem=${encodeURIComponent('No such label.')}`);

    // The remaining bags close the gap, so they never read "1 of 2" and
    // "3 of 2" at the same time.
    await bags.renumber(order.id);

    return res.redirect(303, `${back}?done=label&note=${encodeURIComponent(`Label ${label.code} taken off.`)}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// Bag stickers: printing a roll of them
//
// Behind orders.act rather than an admin permission, because running out of
// stickers is an operational problem and whoever is working should be able to
// print more. Not in the nav: it is reached from an order, which is where you
// discover you need one.
// ---------------------------------------------------------------------------

router.get('/ops/labels', guard, withIssues, may('orders.act'), async (req, res, next) => {
  try {
    const { count: blank } = await db
      .from('bag_labels')
      .select('id', { count: 'exact', head: true })
      .is('order_id', null);

    const { count: inUse } = await db
      .from('bag_labels')
      .select('id', { count: 'exact', head: true })
      .not('order_id', 'is', null);

    const body = `
      <div style="max-width:640px;">
        <p class="eyebrow" style="margin:0 0 8px;">Stickers</p>
        <h1 style="margin:0 0 16px;font-size:40px;line-height:1.05;">Bag labels</h1>
        <p style="font-size:16px;line-height:1.65;color:var(--ink-700);">
          A label is a blank sticker until a driver puts it on a bag and enters
          its code. Print a roll, keep them in the van. They are what lets a bag
          be identified without opening it, and what a laundromat scans.
        </p>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:20px;margin:32px 0;">
        ${statCard('Blank, in the van', blank == null ? '?' : blank)}
        ${statCard('On a bag right now', inUse == null ? '?' : inUse, 'var(--suds-500)')}
      </div>

      <div class="card card-xl" style="padding:28px;max-width:560px;">
        ${sectionHeading('Print', 'A fresh sheet')}
        <form method="post" action="/ops/labels" style="margin:18px 0 0;">
          <label class="eyebrow" for="count" style="display:block;margin-bottom:8px;">How many</label>
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <input class="input input-lg" type="number" id="count" name="count"
                   min="1" max="300" step="30" value="30" required style="flex:1;">
            <button type="submit" class="btn btn-lg">Make them</button>
          </div>
          <span class="field-hint" style="display:block;margin-top:10px;">
            30 to a sheet on Avery 5160 address labels, which is the standard
            30-per-sheet size sold everywhere. Print at 100% scale.
          </span>
        </form>
      </div>`;

    return res.type('html').send(
      adminPage({ title: 'Bag labels', active: '', body, user: req.opsUser, openIssues: req.openIssues })
    );
  } catch (err) {
    return next(err);
  }
});

router.post('/ops/labels', guard, may('orders.act'), async (req, res, next) => {
  try {
    const wanted = Math.max(1, Math.min(300, Number((req.body || {}).count) || 30));

    // Stamped a moment before minting so the sheet can find exactly this batch
    // again on a refresh, without a redirect carrying 30 codes in the URL.
    const from = new Date(Date.now() - 1000).toISOString();
    await bags.mint(wanted);

    return res.redirect(303, `/ops/labels/sheet?from=${encodeURIComponent(from)}&n=${wanted}`);
  } catch (err) {
    return next(err);
  }
});

router.get('/ops/labels/sheet', guard, may('orders.act'), async (req, res, next) => {
  try {
    const n = Math.max(1, Math.min(300, Number(req.query.n) || 30));
    const from = String(req.query.from || '');

    let query = db.from('bag_labels').select('*').order('printed_at', { ascending: true }).limit(n);
    if (from) query = query.gte('printed_at', from);

    const { data, error } = await query;
    if (error) throw error;

    return res.type('html').send(
      adminPage({
        title: 'Print labels',
        active: '',
        body: await labelSheetBody(data || []),
        user: req.opsUser,
        openIssues: 0,
      })
    );
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/economics — what one route cycle actually earns
//
// A model, not a report: it reads nothing from the database and shows no real
// order. Behind money.view because it is the whole cost structure of the
// business, wholesale rate included, which is not a driver's to browse.
// ---------------------------------------------------------------------------

router.get('/ops/economics', guard, withIssues, may('money.view'), (req, res) => {
  res.type('html').send(
    adminPage({
      title: 'Run economics',
      active: '/ops/economics',
      body: runEconomicsBody(),
      user: req.opsUser,
      openIssues: req.openIssues,
    })
  );
});

// ---------------------------------------------------------------------------
// GET /ops/planner — one van-load of stops, on a real map
//
// The other half of the same question. Economics asks whether the shape of a
// run works; this asks whether a particular run works, with these stops in
// these places. Also a model, also reads nothing from the database, and behind
// money.view for the same reason: it shows the wholesale wash rate.
// ---------------------------------------------------------------------------

router.get('/ops/planner', guard, withIssues, may('money.view'), (req, res) => {
  res.type('html').send(
    adminPage({
      title: 'Route planner',
      active: '/ops/planner',
      head: routePlannerHead(),
      body: routePlannerBody(),
      user: req.opsUser,
      openIssues: req.openIssues,
    })
  );
});

// ---------------------------------------------------------------------------
// GET /ops/process — how the whole thing works
//
// The one page that explains the service rather than operating it: what LYNDRY
// is, what the customer, the driver and the laundromat each do, and what the
// technology underneath is. Reference material, so no permission beyond being
// signed in — a driver on their first morning is exactly who it is for, and it
// carries no customer details and no wholesale rate.
//
// Most of what it shows is read from the running system rather than written
// out again, so it cannot quietly disagree with the code. See src/web/process.js.
// ---------------------------------------------------------------------------

router.get('/ops/process', guard, withIssues, (req, res) => {
  res.type('html').send(
    adminPage({
      title: 'How it works',
      active: '/ops/process',
      body: processBody(),
      user: req.opsUser,
      openIssues: req.openIssues,
    })
  );
});

// ---------------------------------------------------------------------------
// GET /ops/issues — everything a person still has to deal with
//
// Open ones first and impossible to skip. Closing one is a deliberate act by a
// named person, recorded with what they did about it, because "resolved" with
// no author is how a complaint gets quietly buried.
// ---------------------------------------------------------------------------

router.get('/ops/issues', guard, withIssues, may('issues.manage'), async (req, res, next) => {
  try {
    const all = await issues.listRecent(60);
    const open = all.filter((i) => i.status === 'OPEN');
    const closed = all.filter((i) => i.status === 'RESOLVED');

    const card = (i) => {
      const c = i.customers || {};
      const o = i.orders || null;

      return `
      <div class="card card-xl" style="padding:26px;margin-bottom:20px;${
        i.status === 'OPEN' ? 'box-shadow:6px 6px 0 var(--stain-500);' : ''
      }">
        <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;margin-bottom:14px;">
          <span class="badge" style="background:${
            i.status === 'OPEN' ? 'var(--stain-500);color:var(--paper-050)' : 'var(--ink-200)'
          };">${escapeHtml(i.status)}</span>
          ${
            o
              ? `<a href="/ops/orders/${o.order_number}" style="font-weight:700;">Order #${o.order_number}</a>`
              : '<span style="font-size:14px;color:var(--ink-500);">No order attached</span>'
          }
          <span style="font-size:14px;color:var(--ink-500);">${escapeHtml(dateTime(i.created_at))}</span>
        </div>

        <p style="font-size:19px;line-height:1.45;margin:0 0 12px;font-weight:600;">
          ${escapeHtml(i.reason)}
        </p>

        ${
          i.customer_said
            ? `<p style="font-size:16px;line-height:1.5;margin:0 0 16px;padding:12px 16px;border-left:3px solid var(--ink-900);background:var(--paper-100);">
                 &ldquo;${escapeHtml(i.customer_said)}&rdquo;
               </p>`
            : ''
        }

        <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;font-size:15px;margin-bottom:${
          i.status === 'OPEN' ? '20px' : '0'
        };">
          <a href="/ops/customers/${c.id}" style="font-weight:600;">${escapeHtml(c.name || 'Unknown')}</a>
          <a href="tel:${escapeHtml(c.phone || '')}">${escapeHtml(formatPhone(c.phone || ''))}</a>
          <a href="/ops/messages/${encodeURIComponent(String(c.phone || '').replace(/\\D/g, ''))}">Read the thread</a>
        </div>

        ${
          i.status === 'OPEN'
            ? `<form method="post" action="/ops/issues/${i.id}/resolve"
                     style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;border-top:2px solid var(--ink-900);padding-top:18px;margin:0;">
                 <input class="input" type="text" name="resolution" maxlength="200"
                        placeholder="What did you do about it?" style="flex:1;min-width:240px;">
                 <button type="submit" class="btn btn-primary">Mark resolved</button>
               </form>`
            : `<p style="font-size:14px;color:var(--ink-500);margin:14px 0 0;">
                 Resolved ${escapeHtml(dateTime(i.resolved_at))}${
                   i.ops_users ? ` by ${escapeHtml(i.ops_users.name)}` : ''
                 }${i.resolution ? `: ${escapeHtml(i.resolution)}` : ''}
               </p>`
        }
      </div>`;
    };

    const body = `
      ${sectionHeading('Needs a person', 'Open', open.length)}
      ${
        open.length
          ? open.map(card).join('')
          : '<p style="font-size:17px;color:var(--ink-500);margin-bottom:56px;">Nothing open. Everything a customer raised has been dealt with.</p>'
      }

      ${closed.length ? `<div style="margin-top:56px;">${sectionHeading('Dealt with', 'Resolved', closed.length)}${closed.map(card).join('')}</div>` : ''}
    `;

    res.type('html').send(
      adminPage({ title: 'Issues', active: '/ops/issues', body, user: req.opsUser, openIssues: req.openIssues })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/ops/issues/:id/resolve', guard, may('issues.manage'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return notFoundPage(res, 'That is not an issue id.');

    const closed = await issues.resolve(
      req.params.id,
      req.opsUser,
      (req.body || {}).resolution
    );

    if (!closed) {
      // Already resolved by somebody else, most likely. Not an error worth a
      // page of its own.
      console.log(`Issue ${req.params.id} was already resolved.`);
    }

    return res.redirect(303, '/ops/issues');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/messages — every conversation, one row per phone number
//
// Grouped by PHONE, not by customer, and that is the point. A message from
// someone with no account still gets logged with their number, so this is the
// only screen in the system that shows people who texted once and never signed
// up. Grouping by customer_id would silently hide exactly the rows worth
// reading.
// ---------------------------------------------------------------------------

// How far back the conversation list reaches.
//
// There is no "conversations" table to query, so the threads are assembled in
// memory from recent messages. At a few hundred messages this is nothing; if
// the table ever gets big enough for this to be the wrong shape, the fix is a
// database view, not a bigger number here. The page says when it has hit the
// limit rather than quietly showing a partial list.
const THREAD_SCAN_LIMIT = 2000;

// Turns a flat list of messages into one entry per phone number.
function groupIntoThreads(messages) {
  const threads = new Map();

  for (const m of messages) {
    // Older rows pre-date the phone column and only have a customer. Skip
    // rather than inventing a thread with no number to open.
    if (!m.phone) continue;

    let thread = threads.get(m.phone);
    if (!thread) {
      thread = {
        phone: m.phone,
        customer: m.customers || null,
        total: 0,
        inbound: 0,
        // Messages arrive newest first, so the first one seen for a number is
        // the latest — which is what the list is sorted and previewed on.
        last: m,
      };
      threads.set(m.phone, thread);
    }

    thread.total += 1;
    if (m.direction === 'INBOUND') thread.inbound += 1;

    // A number can text before signing up and again afterwards. Whichever
    // message carries the customer wins, so the row shows a name.
    if (!thread.customer && m.customers) thread.customer = m.customers;
  }

  return [...threads.values()];
}

router.get('/ops/messages', guard, withIssues, may('messages.view'), async (req, res, next) => {
  try {
    const { data, error } = await db
      .from('messages')
      .select('phone, direction, body, created_at, delivery_status, customers(id, name, status)')
      .order('created_at', { ascending: false })
      .limit(THREAD_SCAN_LIMIT);

    if (error) throw error;

    const scanned = (data || []).length;
    const threads = groupIntoThreads(data || []);

    // Numbers with no customer row. These are people who texted and never
    // signed up — worth chasing, and invisible everywhere else in ops.
    const leads = threads.filter((t) => !t.customer);

    const row = (t) => {
      const who = t.customer
        ? `<span style="font-weight:600;">${escapeHtml(t.customer.name || 'Unnamed')}</span>`
        : `<span class="badge" style="background:var(--sunbeam-500);">Not a customer</span>`;

      const stopped =
        t.customer && t.customer.status === 'UNSUBSCRIBED'
          ? ` <span class="badge" style="background:var(--stain-500);color:var(--paper-050);">Opted out</span>`
          : '';

      const preview = String(t.last.body || '').replace(/\s+/g, ' ').slice(0, 90);

      return [
        `<a href="/ops/messages/${encodeURIComponent(t.phone.replace(/\D/g, ''))}">
           ${who}${stopped}
           <div style="font-size:13px;color:var(--ink-500);font-variant-numeric:tabular-nums;">${escapeHtml(
             formatPhone(t.phone)
           )}</div>
         </a>`,
        `<div style="font-size:14px;color:var(--ink-700);max-width:46ch;">
           <span class="eyebrow" style="margin:0 6px 0 0;">${t.last.direction === 'INBOUND' ? 'Them' : 'Us'}</span>
           ${escapeHtml(preview)}${t.last.body && t.last.body.length > 90 ? '&hellip;' : ''}
         </div>`,
        `<span style="white-space:nowrap;">${escapeHtml(timeAgo(t.last.created_at))}</span>`,
        `<span style="font-variant-numeric:tabular-nums;">${t.total}</span>`,
      ];
    };

    const body = `
      ${sectionHeading('Everything anyone has texted us', 'Conversations', threads.length)}

      ${
        leads.length
          ? `<div class="card" style="padding:18px 22px;margin-bottom:28px;background:var(--sunbeam-500);">
               <p style="margin:0;font-size:16px;">
                 <strong>${leads.length} ${leads.length === 1 ? 'number has' : 'numbers have'} texted without signing up.</strong>
                 They got sent the signup link automatically. Nothing else chases them.
               </p>
             </div>`
          : ''
      }

      ${table(['Who', 'Latest message', 'When', 'Total'], threads.map(row))}

      ${
        scanned >= THREAD_SCAN_LIMIT
          ? `<p style="font-size:14px;color:var(--ink-500);margin-top:22px;">
               Showing conversations from the most recent ${THREAD_SCAN_LIMIT} messages. Older threads are not listed.
             </p>`
          : ''
      }`;

    res.type('html').send(
      adminPage({ title: 'Conversations', active: '/ops/messages', body, user: req.opsUser, openIssues: req.openIssues })
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/messages/:phone — one conversation, oldest first
// ---------------------------------------------------------------------------

// What the carrier did with a message we sent. This is the only place a
// blocked or filtered text admits to itself — the send looked fine at the time,
// and the bad news arrives later on a separate webhook.
function deliveryNote(m) {
  if (m.direction !== 'OUTBOUND') return '';

  const failed = m.delivery_status && /fail|undeliver|reject|expired/i.test(m.delivery_status);

  if (failed || m.delivery_error) {
    return `<span class="badge" style="background:var(--stain-500);color:var(--paper-050);">
              Not delivered${m.delivery_error ? `: ${escapeHtml(m.delivery_error)}` : ''}
            </span>`;
  }

  if (m.delivery_status === 'delivered') {
    return `<span style="font-size:12px;color:var(--ink-500);">Delivered</span>`;
  }

  // No receipt yet. Not the same as delivered, and saying so matters when
  // someone is asking why a customer never replied.
  return `<span style="font-size:12px;color:var(--ink-400);">Sent${
    m.delivery_status ? ` &middot; ${escapeHtml(m.delivery_status)}` : ''
  }</span>`;
}

function bubble(m) {
  const inbound = m.direction === 'INBOUND';

  // Suds for what we said, paper for what they said. Ink text on both — a
  // brand colour is never dark enough to carry white type.
  return `
  <div style="display:flex;flex-direction:column;align-items:${inbound ? 'flex-start' : 'flex-end'};gap:5px;">
    <div style="
      max-width:min(560px, 78%);
      background:${inbound ? 'var(--paper-050)' : 'var(--suds-500)'};
      border:2px solid var(--ink-900);
      border-radius:${inbound ? '4px 16px 16px 16px' : '16px 16px 4px 16px'};
      box-shadow:${inbound ? '3px 3px' : '-3px 3px'} 0 var(--ink-900);
      padding:13px 17px;
      font-size:16px;
      line-height:1.45;
      color:var(--ink-900);
      white-space:pre-wrap;
      overflow-wrap:anywhere;
    ">${escapeHtml(m.body)}</div>
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-500);">
      <span>${escapeHtml(dateTime(m.created_at))}</span>
      ${deliveryNote(m)}
    </div>
  </div>`;
}

router.get('/ops/messages/:phone', guard, withIssues, may('messages.view'), async (req, res, next) => {
  try {
    // The URL carries digits only, so a "+" never has to survive a path.
    const phone = normalisePhone(req.params.phone);

    if (!phone) {
      return res.status(404).type('html').send(
        adminPage({
          title: 'Conversation',
          active: '/ops/messages',
          body: `<a href="/ops/messages" style="font-size:15px;font-weight:600;">&larr; All conversations</a>
                 <p style="font-size:17px;margin-top:20px;">That is not a phone number we could read.</p>`,
          user: req.opsUser, openIssues: req.openIssues,
        })
      );
    }

    const [{ data: messages, error }, { data: customer }] = await Promise.all([
      db
        .from('messages')
        .select('direction, body, created_at, delivery_status, delivery_error')
        .eq('phone', phone)
        .order('created_at', { ascending: true }),
      db.from('customers').select('id, name, status, address_line1, city, postal_code').eq('phone', phone).maybeSingle(),
    ]);

    if (error) throw error;

    const thread = messages || [];

    const heading = customer ? customer.name || 'Unnamed customer' : formatPhone(phone);

    const who = customer
      ? `<a href="/ops/customers/${customer.id}" class="btn btn-outline btn-sm">Open profile</a>`
      : `<span class="badge" style="background:var(--sunbeam-500);">Never signed up</span>`;

    const body = `
      <a href="/ops/messages" style="font-size:15px;font-weight:600;">&larr; All conversations</a>

      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin:18px 0 6px;">
        <h1 style="font-family:var(--font-display);font-weight:900;font-size:38px;letter-spacing:-0.03em;margin:0;">
          ${escapeHtml(heading)}
        </h1>
        ${who}
        ${
          customer && customer.status === 'UNSUBSCRIBED'
            ? `<span class="badge" style="background:var(--stain-500);color:var(--paper-050);">Opted out - do not text</span>`
            : ''
        }
      </div>

      <p style="font-size:15px;color:var(--ink-500);margin:0 0 32px;font-variant-numeric:tabular-nums;">
        ${escapeHtml(formatPhone(phone))}
        &middot; ${thread.length} message${thread.length === 1 ? '' : 's'}
        ${customer && customer.address_line1 ? `&middot; ${escapeHtml(addressOf(customer))}` : ''}
      </p>

      <div class="card card-xl" style="padding:28px;">
        ${
          thread.length
            ? `<div style="display:flex;flex-direction:column;gap:20px;">${thread.map(bubble).join('')}</div>`
            : `<p style="font-size:16px;color:var(--ink-500);margin:0;">Nothing has been sent to or from this number.</p>`
        }
      </div>`;

    res.type('html').send(
      adminPage({ title: heading, active: '/ops/messages', body, user: req.opsUser, openIssues: req.openIssues })
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/partners — enquiries from the /partners page
// ---------------------------------------------------------------------------

const PARTNER_LABEL = { LAUNDROMAT: 'Laundromat', PROPERTY: 'Property' };

router.get('/ops/partners', guard, withIssues, may('partners.view'), async (req, res, next) => {
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

    res.type('html').send(adminPage({ title: 'Partners', active: '/ops/partners', body, user: req.opsUser, openIssues: req.openIssues }));
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

router.get('/ops/team', guard, withIssues, may('team.manage'), async (req, res, next) => {
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

    res.type('html').send(adminPage({ title: 'Team', active: '/ops/team', body, user: req.opsUser, openIssues: req.openIssues }));
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
