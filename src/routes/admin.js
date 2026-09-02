'use strict';

const express = require('express');

const db = require('../db');
const orders = require('../core/orders');
const auth = require('../core/admin-auth');
const { config } = require('../config');
const { site } = require('../web/site');
const { escapeHtml, logo, icon, CSS_BASE } = require('../web/layout');
const { normalisePhone, formatPhone } = require('../core/phone');
const notify = require('../core/notify');
const roles = require('../core/roles');
const booking = require('../core/booking');
const recurring = require('../core/recurring');
const issues = require('../core/issues');
const { runEconomicsBody } = require('../web/run-economics');
const { routePlannerBody, routePlannerHead } = require('../web/route-planner');
const { processBody } = require('../web/process');
const { journeyBody } = require('../web/journey');
const { labelSheetBody, SHEET: LABEL_SHEET } = require('../web/labels');
const bags = require('../core/bags');
const tags = require('../core/tags');
const orderEvents = require('../core/order-events');
const dispatch = require('../core/dispatch');
const drivers = require('../core/drivers');
const runCore = require('../core/run');
const { routingBoardBody } = require('../web/routing-board');
const { runBody } = require('../web/run-page');
const { teamMemberBody, ROLE_TONE } = require('../web/team-page');
const loadout = require('../core/loadout');
const { loadoutBody } = require('../web/loadout-page');
const { scanField, scannerScript, describeCodeFormat } = require('../web/scanner');
const partners = require('../core/partners');
const { partnerListBody, partnerFormBody, partnerDetailBody } = require('../web/partners-page');
const { settingsBody, promotionsBody, broadcastBody, AUDIENCES } = require('../web/prelaunch-page');
const settings = require('../core/settings');
const promotions = require('../core/promotions');
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

// The ops navigation, grouped.
//
// Ten flat tabs was more than a phone could hold and more than a person could
// scan. These are Neil's groupings; Load out, Issues and Labels were not in his
// list and are placed where they belong - the two a driver uses every day under
// Dashboard, and the sticker printer under Tools, where it is findable instead
// of only reachable from an order page.
//
// Each entry carries the permission that already guards its route, so the menu
// cannot offer somebody a screen they would be refused at. A group with nothing
// left in it disappears entirely rather than opening onto nothing.
// THE MENUS ARE GROUPED BY THE QUESTION EACH SCREEN ANSWERS, not by what kind
// of thing it is. "Dashboard" was a grab bag - a board, a scanning task, a
// message list and a problem queue - and Routing, which is the live day, sat
// under Tools next to two what-if calculators.
//
//   TODAY     what is happening right now, and the screens you act on
//   PEOPLE    every human in the system, customer or staff
//   BUSINESS  what you set up, and what it earns
//   HELP      how the whole thing works
//
// Names say what the screen is rather than what it is called internally.
// "Load out" was jargon; "Planner" and "Routing" were indistinguishable until
// one of them said route.
const OPS_MENUS = Object.freeze([
  {
    label: 'Today',
    items: [
      // First, because for somebody on the round it is the only screen that
      // matters - everything else is looking something up. Behind orders.drive,
      // so an admin who has not put themselves on the round is not offered one.
      { href: '/ops/run', label: 'Your round', permission: 'orders.drive' },
      { href: '/ops', label: 'Orders', permission: 'orders.view' },
      // The live day. It belongs beside the orders it sequences, not beside the
      // calculators - it reads the real queue and nothing on it is invented.
      { href: '/ops/routing', label: 'Routing', permission: 'orders.act' },
      { href: '/ops/loadout', label: 'Load the van', permission: 'orders.act' },
      // Under Today because an open issue is something happening NOW that is
      // stopping an order moving - it belongs beside the board it is blocking,
      // not filed with the people it happens to be about.
      { href: '/ops/issues', label: 'Issues', permission: 'issues.manage' },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/ops/customers', label: 'Customers', permission: 'customers.view' },
      // "Conversations" rather than "Messages": the screen is one row per phone
      // number and holds people who never became customers, which is the whole
      // reason it is worth reading.
      { href: '/ops/messages', label: 'Conversations', permission: 'messages.view' },
      { href: '/ops/team', label: 'Team', permission: 'team.manage' },
      // Neil's call: a partner is a relationship with a person, so it sits with
      // the customers and the team rather than with the calculators.
      { href: '/ops/partners', label: 'Partners', permission: 'partners.view' },
    ],
  },
  {
    label: 'Business',
    items: [
      // First in the group: whether we are open decides whether anything else
      // in here matters.
      { href: '/ops/settings', label: 'Taking orders?', permission: 'service.manage' },
      { href: '/ops/promotions', label: 'Promotions', permission: 'service.manage' },
      { href: '/ops/broadcast', label: 'Text blast', permission: 'service.manage' },
      { href: '/ops/labels', label: 'Bag tags', permission: 'orders.act' },
      { href: '/ops/economics', label: 'Unit economics', permission: 'money.view' },
      // "Route planner" says which of the two it is. This one is a day you
      // invent; Routing above is the day that exists.
      { href: '/ops/planner', label: 'Route planner', permission: 'money.view' },
    ],
  },
  {
    // "Resources" rather than "Help": these are not answers to a problem you
    // are having, they are the documents you read before you start and hand to
    // somebody else - the process, the physical walkthrough, and the page we
    // send a laundromat owner.
    label: 'Resources',
    items: [
      { href: '/ops/process', label: 'How it all works', permission: null },
      // The physical walkthrough. Same group and same no-permission rule as the
      // page above: it holds no customer detail and no wholesale figure, and it
      // is the other thing you hand somebody before their first round.
      { href: '/ops/journey', label: 'What happens to a bag', permission: null },
      // THE ACTUAL PAGE WE SEND A LAUNDROMAT OWNER, not a copy of it. It is
      // public, so this is only a shortcut - but a shortcut worth having,
      // because the thing most likely to go stale is the page nobody who works
      // here ever opens. Behind partners.view: it is a sales document, and it
      // is the same permission that guards everything else about partners.
      {
        href: '/for-laundromats',
        label: 'What we send a laundromat',
        permission: 'partners.view',
      },
    ],
  },
]);

function opsNav(user, active) {
  return OPS_MENUS.map((menu) => {
    const items = menu.items.filter((i) => !i.permission || roles.can(user, i.permission));
    if (!items.length) return '';

    // Which group holds the page you are on, so "where am I" survives being
    // folded into a menu. Deliberately NOT opened on load - a panel covering
    // the page you just asked for is worse than a highlighted word.
    const here = items.some((i) => i.href === active);

    const links = items
      .map(
        (i) =>
          `<a href="${i.href}"${i.href === active ? ' aria-current="page"' : ''}>${escapeHtml(i.label)}</a>`
      )
      .join('');

    return `
        <details class="ops-menu"${here ? " data-here=\"1\"" : ''}>
          <summary>${escapeHtml(menu.label)}</summary>
          <div class="ops-menu-panel">${links}</div>
        </details>`;
  }).join('');
}

// `head` is for the rare page that needs something of its own in <head> - the
// route planner's map library, and so far nothing else. Kept as a parameter
// rather than letting pages write their own <head> so that every ops screen
// still gets the same stylesheets, the same noindex and the same furniture.
function adminPage({ title, active = '', body, user = null, openIssues = 0, head = '', serviceClosed = false }) {
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
        ${opsNav(user, active)}
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
    // SHUT. Sunbeam rather than Stain, because this is a state Neil chose
    // rather than a problem to fix - but it is on every page for the same
    // reason the issues banner is: a switch on a screen nobody visits daily is
    // a switch that gets left on by accident.
    serviceClosed
      ? `<a href="/ops/settings" style="display:block;text-decoration:none;margin-bottom:20px;">
           <div class="card" style="padding:16px 24px;background:var(--sunbeam-500);">
             <div style="display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;">
               <div>
                 <div class="eyebrow" style="margin:0 0 4px;">Pre-launch</div>
                 <div style="font-family:var(--font-display);font-weight:900;font-size:22px;line-height:1.1;">
                   Not taking orders
                 </div>
               </div>
               <span style="font-weight:700;text-decoration:underline;">Change it</span>
             </div>
           </div>
         </a>`
      : ''
}
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
  <script>
  // One menu open at a time.
  //
  // <details> has no idea its siblings exist, so opening a second panel leaves
  // the first one hanging underneath it - three overlapping white boxes across
  // the top of the page. Closing the others is the one thing the markup cannot
  // do by itself.
  //
  // ENHANCEMENT ONLY. Without this the menus still open, still close, and still
  // navigate; they just overlap. Nothing here is load-bearing, which is why it
  // is eight lines at the bottom of the page rather than a dependency.
  (function () {
    var menus = [].slice.call(document.querySelectorAll('.ops-menu'));
    if (!menus.length) return;

    function closeAll(except) {
      menus.forEach(function (m) { if (m !== except) m.open = false; });
    }

    menus.forEach(function (menu) {
      // 'toggle' rather than a click on the summary: it fires however the menu
      // was opened, including by keyboard.
      menu.addEventListener('toggle', function () {
        if (menu.open) closeAll(menu);
      });
    });

    // Clicking anywhere else puts them all away, the way a menu should behave.
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.ops-menu')) closeAll(null);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll(null);
    });
  })();
  </script>
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

function workCard(order, { canAct, notice, problem, bagScan = { total: 0, scanned: 0, allScanned: true, labels: [] }, laundromats = [] }) {
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
  //
  // And, on a labelled order, it needs every bag scanned first. The scan at the
  // door is a CONFIRMATION - the driver already has the bag, chosen by the
  // number on its tag, and this only agrees or shouts. A refusal here is cheap;
  // the expensive failure is two doors away when somebody else's laundry is
  // gone and both customers need a second trip.
  const stepButton = (s) =>
    s.to === 'DELIVERED'
      ? // EVERY BAG SCANNED FIRST, THEN ONE PHOTO.
        //
        // While anything is unscanned the camera is not on the page at all -
        // not disabled, absent. A driver who photographs the doorstep and then
        // discovers he is holding the wrong bag has already done the step that
        // says "delivered" in his head, and the scan becomes a formality he is
        // motivated to get past.
        //
        // However many bags there are, there is exactly ONE photo: it is a
        // picture of the drop-off, not of each bag.
        bagScan.total && !bagScan.allScanned
        ? `
      <div style="padding:20px;border:2px solid var(--ink-900);border-radius:14px;background:var(--sunbeam-500);">
        <p style="margin:0 0 6px;font-family:var(--font-display);font-weight:900;font-size:22px;line-height:1.15;">
          Scan ${bagScan.total === 1 ? 'the bag' : `all ${bagScan.total} bags`} first
        </p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
          ${bagScan.scanned} of ${bagScan.total} done. Grab the bag with the right
          number on its tag and scan it - this checks you have the right one
          before you put it down. The camera opens once they are all in.
        </p>

        <div style="margin:0 0 18px;">
          ${(bagScan.labels || [])
            .map(
              (l) => `
          <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid rgba(16,18,16,0.15);">
            <span style="flex:none;width:22px;height:22px;border:2px solid var(--ink-900);border-radius:6px;
                         background:${l.delivered_at ? 'var(--suds-500)' : 'var(--paper-050)'};
                         display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">
              ${l.delivered_at ? '&check;' : ''}
            </span>
            <span style="font-family:var(--font-mono);font-size:16px;font-weight:700;letter-spacing:0.06em;">
              ${escapeHtml(l.code)}
            </span>
            <span style="font-size:14px;">Bag ${l.position} of ${bagScan.total}</span>
          </div>`
            )
            .join('')}
        </div>

        ${scanField({
          action: `/ops/orders/${order.order_number}/door-scan`,
          label: 'Bag in your hand',
          buttonLabel: 'Check',
          autofocus: true,
          hint: describeCodeFormat(),
        })}
      </div>`
        : `
      <form method="post" action="/ops/orders/${order.order_number}/delivered"
            enctype="multipart/form-data" style="margin:0;display:flex;flex-direction:column;gap:10px;">
        ${
          bagScan.total
            ? `<p style="margin:0 0 6px;padding:12px 15px;border:2px solid var(--ink-900);border-radius:12px;
                         background:var(--suds-300);font-size:15px;font-weight:600;">
                 All ${bagScan.total} bag${bagScan.total === 1 ? '' : 's'} scanned. Take the photo.
               </p>`
            : ''
        }
        <label class="field-label" for="photo">Photo at the door &mdash; required</label>
        <!-- The required attribute stops the tap before it costs a round
             trip. The real enforcement is in src/core/fulfilment.js, because
             the JSON API reaches the same code and a form attribute guards
             neither of them. -->
        <input class="input" type="file" id="photo" name="photo" accept="image/*" capture="environment" required>
        <button type="submit" class="btn btn-primary btn-lg btn-full">${s.label}</button>
        <span class="field-hint">
          One photo of where you left it, however many bags there were. The
          customer gets a link to it that expires after 30 days.
        </span>
      </form>`
      : `
      <form method="post" action="/ops/orders/${order.order_number}/${s.action}" style="margin:0;">
        ${
          // Which laundromat, chosen as the bag changes hands. Without this
          // there is no way to tell later whose scale was heavy.
          s.to === 'AT_PARTNER' && laundromats.length
            ? `<label class="field-label" for="partner_id">Which laundromat</label>
               <select class="input input-lg" id="partner_id" name="partner_id"
                       style="width:100%;margin-bottom:12px;">
                 ${laundromats
                   .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
                   .join('')}
                 <option value="">Somewhere else</option>
               </select>`
            : ''
        }
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
            enctype="multipart/form-data"
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
        </div>

        <!-- capture="environment" opens the back camera straight away rather
             than a file picker. On the first weighing it is required; on a
             correction it is optional, because a typo is usually spotted after
             the bag has gone and refusing the fix would leave the wrong number
             on the order for good. -->
        <label class="field-label" for="weight_photo" style="display:block;margin-top:18px;">
          ${weighed ? 'New photo of the scale (optional)' : 'Photo of the scale'}
        </label>
        <input class="input input-lg" type="file" id="weight_photo" name="photo"
               accept="image/*" capture="environment" ${weighed ? '' : 'required'}
               style="width:100%;">

        <button type="submit" class="btn btn-${mustWeighFirst ? 'primary' : 'ink'} btn-lg btn-full"
                style="margin-top:16px;">Save the weight</button>

        <span class="field-hint" style="display:block;margin-top:10px;">
          This sets the price. The card is charged when you mark it delivered. ${
            weighed
              ? 'It has already been weighed once, so saving again is a correction and the customer is told so.'
              : 'Photograph the display with the bag on it - that photo is what settles any argument about the number later.'
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

  // A `..` segment walks back out. "/ops/../admin" passes a naive starts-with
  // check, and a browser normalises it to "/admin" before asking for it - so
  // the constraint this function exists to enforce is gone. Same origin rather
  // than an open redirect, but it defeats the point.
  //
  // Backslashes go too: some clients treat them as separators.
  if (wanted.includes('..') || wanted.includes('\\')) return '/ops';

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

// THE SIGN-IN PAGES MUST NEVER BE CACHED, and this is not housekeeping.
//
// Neil reported typing his number and landing straight in /ops without ever
// being asked for the code. The cause is a stale sign-in form: the browser had
// kept a copy of GET /ops/login from a time when he was signed out, served it
// again later while his session was in fact still alive, and the moment he
// submitted it the next page saw a valid session and waved him through. It
// looked exactly like the code step had been skipped.
//
// No-store means the form is fetched fresh every time, so a page that offers
// to sign you in is only ever shown to somebody who is actually signed out.
function noStore(res) {
  res.set('Cache-Control', 'no-store, private');
}

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
  noStore(res);

  // Already signed in? Don't make them do it again.
  if (auth.isAuthed(req)) return res.redirect(302, safeNext(req.query.next));

  res.type('html').send(phoneStep({ next: safeNext(req.query.next) }));
});

// Step one: they gave us a number. Send a code.
router.post('/ops/login', async (req, res, next) => {
  const wanted = safeNext((req.body || {}).next);
  const phone = (req.body || {}).phone;

  noStore(res);

  // ALREADY SIGNED IN. Send them on rather than texting a code that the next
  // page would then swallow - which is what made this look like the code step
  // could be skipped. A credential is not minted for somebody already inside.
  if (auth.isAuthed(req)) return res.redirect(303, wanted);

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
  noStore(res);
  if (auth.isAuthed(req)) return res.redirect(302, safeNext(req.query.next));

  const phone = readPending(req);
  if (!phone) return res.redirect(302, '/ops/login');

  res.type('html').send(codeStep({ next: safeNext(req.query.next), phone }));
});

// Step two: they gave us the code.
router.post('/ops/login/code', async (req, res, next) => {
  const wanted = safeNext((req.body || {}).next);
  const phone = readPending(req);

  noStore(res);

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

  // A CLOSED SERVICE HAS TO BE IMPOSSIBLE TO FORGET. The switch lives on one
  // screen nobody visits daily, and an owner who forgets it is off watches the
  // board stay empty and concludes the business is quiet rather than shut.
  req.serviceClosed = await settings
    .takingOrders()
    .then((open) => !open)
    .catch(() => false);

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
  // The return leg. Without these the order page renders its outgoing
  // section from undefined and quietly shows nothing, which is exactly what
  // it did the first time somebody recorded what came back.
  'return_bag_count, return_weight_lb, partner_id, tag_code, ' +
  'delivery_photo_url, notes, created_at, from_schedule, ' +
  // preferences carries where the driver should look and how it gets washed.
  // Without it the order page could show "leave outside" but not "front door",
  // which is the half the driver actually needs.
  'customers(id, name, phone, address_line1, address_line2, city, postal_code, preferences)';

router.get('/ops', guard, withIssues, may('orders.view'), async (req, res, next) => {
  try {
    // A DRIVER SEES THEIR OWN ROUND AND NOBODY ELSE'S.
    //
    // Filtered in the query rather than after it, so another driver's stops
    // never reach this process at all - the same reason prices are left out of
    // the markup instead of hidden with CSS. Anyone who can browse customers
    // sees the whole business.
    const ownRoundOnly = !roles.can(req.opsUser, 'customers.view');

    let query = db
      .from('orders')
      .select(`${ORDER_FIELDS}, collected_at, at_partner_at, ready_at, delivered_at, driver_id`)
      .order('pickup_date', { ascending: false })
      .order('pickup_time', { ascending: true, nullsFirst: false });

    if (ownRoundOnly) query = query.eq('driver_id', req.opsUser.id);

    const { data, error } = await query;

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

    // OWED MEANS DELIVERED AND NOT PAID, not merely unpaid.
    //
    // The card is charged at the door, so everything still in the van, at a
    // laundromat or out for delivery is legitimately unpaid - that is the whole
    // design, not a debt. Counting it as owed made a normal day look like a
    // collections problem: thirteen orders "owed" when one had actually been
    // delivered without paying.
    const owed = all.filter(
      (o) => o.delivered_at && ['FAILED', 'UNPAID'].includes(o.payment_status) && o.price_cents
    );
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

    const showNames = roles.can(req.opsUser, 'customers.view');

    const row = (o) => {
      const c = o.customers || {};
      return [
        `<a href="/ops/orders/${o.order_number}" style="font-weight:700;font-variant-numeric:tabular-nums;">#${o.order_number}</a>`,
        // A DRIVER PICKS A STOP OFF THIS BOARD BY WHERE IT IS, NOT BY WHO.
        // With the name gone the address moves up and carries the column on
        // its own - it is the half a round is planned with anyway.
        showNames
          ? `<a href="/ops/orders/${o.order_number}" style="font-weight:600;">${escapeHtml(c.name || 'Unknown')}</a>
         <div style="font-size:13px;color:var(--ink-500);">${escapeHtml(addressOf(c))}</div>`
          : `<a href="/ops/orders/${o.order_number}" style="font-weight:600;">${
              escapeHtml(addressOf(c)) || 'No address'
            }</a>`,
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

    const headings = ['Order', showNames ? 'Customer' : 'Where', 'Pickup', 'Status', 'Clock', 'Weight'];
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

    // WHERE EACH DRIVER IS, right under the totals.
    //
    // Only for somebody who can see the whole business - a driver gets their
    // own stops on this board and does not need a picture of everybody else's
    // day. Drawn from the timestamps already on the orders rather than a
    // progress column, so it cannot drift from what actually happened.
    const crew = roles.can(req.opsUser, 'customers.view') ? await drivers.board(booking.today()) : null;

    const driverCard = (r) => {
      const p = r.progress;
      const pct = p.fraction == null ? 0 : Math.round(p.fraction * 100);

      const where = p.idle
        ? '<span style="color:var(--ink-500);">nothing on today</span>'
        : p.nextStop
          ? `on the round &middot; next is stop ${p.nextStop.stop_number}, #${p.nextStop.order_number}`
          : p.toCollect
            ? `${p.toCollect} still to collect`
            : p.carrying
              ? `carrying ${p.carrying}, nothing loaded yet`
              : 'everything done';

      return `
      <a href="/ops/routing?driver=${escapeHtml(r.driver.id)}"
         style="display:block;text-decoration:none;color:inherit;flex:1 1 260px;min-width:0;
                padding:18px 20px;border:2px solid var(--ink-900);border-radius:14px;
                background:var(--paper-050);box-shadow:var(--shadow-pop-xs);">
        <div style="display:flex;gap:10px;align-items:baseline;justify-content:space-between;flex-wrap:wrap;">
          <span style="font-weight:700;font-size:17px;">${escapeHtml(r.driver.name)}</span>
          <span class="eyebrow" style="margin:0;">${
            r.base.own ? escapeHtml(r.driver.base_city || 'own base') : 'service base'
          }</span>
        </div>

        <div style="height:12px;border:2px solid var(--ink-900);border-radius:999px;overflow:hidden;
                    background:var(--paper-000);margin:12px 0 8px;">
          <div style="height:100%;width:${pct}%;background:var(--suds-500);"></div>
        </div>

        <div style="font-size:14px;line-height:1.5;">
          ${p.done} of ${p.total} delivered &middot; ${where}
        </div>
        <div style="font-size:13px;color:var(--ink-500);margin-top:4px;">
          ${p.toCollect} to collect &middot; ${p.carrying} in hand
        </div>
      </a>`;
    };

    const driverStrip = crew
      ? `
      <section style="margin-bottom:44px;">
        ${sectionHeading('Where everybody is', 'The round', crew.rows.length)}
        <div style="display:flex;flex-wrap:wrap;gap:16px;">
          ${
            crew.rows.length
              ? crew.rows.map(driverCard).join('')
              : `<p style="margin:0;font-size:15px;color:var(--ink-500);line-height:1.6;">
                   Nobody on the team can drive yet. Add somebody at
                   <a href="/ops/team">Team</a>.
                 </p>`
          }
        </div>
        ${
          // AN ORDER NOBODY OWNS IS THE ONE THAT DOES NOT GET COLLECTED, so the
          // banner now fixes it rather than only reporting it. Saying "nobody
          // is going to collect this" and then making somebody go to another
          // page to do something about it is a warning that costs more than it
          // saves.
          //
          // The picker only appears for somebody who may actually reassign -
          // customers.view, the same permission the route checks. A driver sees
          // the warning and no control, which is right: handing work to
          // somebody else is a scheduling decision, not a step in the round.
          crew.orphans.length
            ? `<div style="margin:16px 0 0;padding:13px 16px;border:2px solid var(--ink-900);border-radius:12px;
                           background:var(--stain-500);color:var(--paper-050);font-size:15px;line-height:1.5;">
                 <strong>${crew.orphans.length} order${crew.orphans.length === 1 ? '' : 's'} with no driver.</strong>
                 Nobody is going to collect ${crew.orphans.length === 1 ? 'it' : 'them'} until somebody owns
                 ${crew.orphans.length === 1 ? 'it' : 'them'}.

                 ${
                   roles.can(req.opsUser, 'customers.view') && crew.rows.length
                     ? crew.orphans
                         .map(
                           (o) => `
                 <form method="post" action="/ops/orders/${o.order_number}/driver"
                       style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px;">
                   <input type="hidden" name="from" value="board">
                   <a href="/ops/orders/${o.order_number}"
                      style="color:var(--paper-050);font-weight:700;">#${o.order_number}</a>
                   <label class="sr-only" for="assign-${o.order_number}">Driver for #${o.order_number}</label>
                   <select class="field" id="assign-${o.order_number}" name="driver_id"
                           style="height:38px;padding:0 10px;font-size:15px;width:auto;min-width:150px;">
                     ${crew.rows
                       .map((r) => `<option value="${r.driver.id}">${escapeHtml(r.driver.name)}</option>`)
                       .join('')}
                   </select>
                   <button class="btn btn-sm" type="submit"
                           style="background:var(--paper-050);color:var(--ink-900);">Assign</button>
                 </form>`
                         )
                         .join('')
                     : `<div style="margin-top:8px;">${crew.orphans
                         .map((o) => `<a href="/ops/orders/${o.order_number}" style="color:var(--paper-050);">#${o.order_number}</a>`)
                         .join(', ')}</div>`
                 }
               </div>`
            : ''
        }
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

      ${driverStrip}

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

    res.type('html').send(adminPage({ title: 'Orders', active: '/ops', body, user: req.opsUser, openIssues: req.openIssues, serviceClosed: req.serviceClosed }));
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
// What happened to this order
//
// The order row says where it IS. This says how it got there - weighed twice
// and 4 lb lighter the second time, a laundromat 3 lb heavier, which driver
// tapped delivered, why a charge was waived.
//
// Newest first, because the question is almost always "what just happened",
// not "what happened first".
// ---------------------------------------------------------------------------

const EVENT_TONE = Object.freeze({
  CREATED: 'var(--lilac-500)',
  STATUS: 'var(--suds-500)',
  WEIGHT: 'var(--sunbeam-500)',
  PRICE: 'var(--sunbeam-500)',
  PAYMENT: 'var(--sunbeam-500)',
  REFUND: 'var(--stain-500)',
  LABEL: 'var(--paper-300)',
  PARTNER: 'var(--paper-300)',
  PARTNER_WEIGHT: 'var(--sunbeam-500)',
  CANCELLED: 'var(--stain-500)',
});

function historyCard(events) {
  if (!events.length) {
    return `
  <div class="card card-xl" style="padding:26px;">
    ${sectionHeading('History', 'Nothing recorded')}
    <p style="margin:10px 0 0;font-size:15px;color:var(--ink-500);line-height:1.6;">
      This order predates the log. Anything that happens from now on appears here.
    </p>
  </div>`;
  }

  const rows = events
    .map((e) => {
      const change =
        e.was && e.became
          ? `<span style="font-family:var(--font-mono);font-size:12px;color:var(--ink-500);">
               ${escapeHtml(e.was)} &rarr; ${escapeHtml(e.became)}
             </span>`
          : '';

      return `
      <div style="display:flex;gap:14px;padding:14px 0;border-bottom:1px solid var(--ink-100);">
        <span style="flex:none;width:10px;height:10px;margin-top:6px;border:2px solid var(--ink-900);
                     border-radius:50%;background:${EVENT_TONE[e.kind] || 'var(--paper-300)'};"></span>
        <div style="min-width:0;flex:1;">
          <div style="font-size:15px;font-weight:600;line-height:1.4;">${escapeHtml(e.summary)}</div>
          ${change ? `<div style="margin-top:3px;">${change}</div>` : ''}
          ${
            e.reason
              ? `<div style="font-size:14px;color:var(--ink-700);line-height:1.5;margin-top:4px;">
                   ${escapeHtml(e.reason)}
                 </div>`
              : ''
          }
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--ink-500);margin-top:5px;">
            ${escapeHtml(dateTime(e.created_at))} &middot; ${escapeHtml(e.actor)}
          </div>
        </div>
      </div>`;
    })
    .join('');

  return `
  <div class="card card-xl" style="padding:26px;">
    ${sectionHeading('History', `${events.length} ${events.length === 1 ? 'entry' : 'entries'}`)}
    <div style="margin-top:6px;">${rows}</div>
    <p style="font-size:13px;color:var(--ink-500);line-height:1.5;margin:16px 0 0;">
      Append only. Nothing here can be edited or removed.
    </p>
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

function bagRow(order, l, total, canAct, done) {
  const retired = Boolean(l.released_at);
  const url = l.code ? bags.labelUrl(l.code) : null;

  return `
    <div style="display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--ink-100);flex-wrap:wrap;">
      <div style="min-width:0;">
        <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;">
          <span style="font-family:var(--font-mono);font-size:22px;font-weight:700;letter-spacing:0.06em;${
            retired ? 'color:var(--ink-500);' : ''
          }">
            ${escapeHtml(l.code || 'Bag ' + l.position)}
          </span>
          <span class="eyebrow" style="margin:0;">Bag ${l.position} of ${total}</span>
          ${
            l.weight_lb != null
              ? `<span class="badge" style="background:var(--sunbeam-300);">${escapeHtml(
                  Number(l.weight_lb).toFixed(1)
                )} lb</span>`
              : '<span class="badge" style="background:var(--paper-300);">not weighed</span>'
          }
          ${retired ? '<span class="badge" style="background:var(--paper-300);">Retired</span>' : ''}
        </div>
        ${
          !url
            ? ''
            : retired
              ? `<div style="font-family:var(--font-mono);font-size:12px;color:var(--ink-400);
                             margin-top:6px;word-break:break-all;line-height:1.4;">
                   ${escapeHtml(url)}
                 </div>
                 <div style="font-size:12px;color:var(--ink-500);margin-top:3px;">
                   Stopped working when the order was delivered.
                 </div>`
              : `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"
                    style="display:inline-block;font-family:var(--font-mono);font-size:12px;
                           color:var(--ink-500);margin-top:6px;word-break:break-all;line-height:1.4;">
                   ${escapeHtml(url)}
                 </a>`
        }
      </div>
      <span style="flex:1;"></span>
      ${
        canAct && !done && !retired && l.code
          ? `<form method="post" action="/ops/orders/${order.order_number}/label/${l.id}/release" style="margin:0;">
               <button type="submit" class="btn btn-outline btn-sm">Take off</button>
             </form>`
          : ''
      }
    </div>`;
}

// The bags on an order, in TWO SECTIONS, because there are two of them.
//
// NEIL'S CALL, and the data has said so since bag legs were added - the page
// simply never showed it. What the driver collects from a CUSTOMER and what he
// collects from the LAUNDROMAT are different objects in different numbers: the
// laundromat empties the bags it is given and packs the clean laundry into its
// own, so three in can be four out.
//
// Each leg carries its own COUNT and its own WEIGHT, both logged by the driver
// at the moment he is holding them. The count is what he looks for; the WEIGHT
// is what proves he has it, because he can only count what he can see and the
// bag that gets left behind is the one behind the counter.
function bagsCard(order, labels, canAct, { mayOverride = false, refused = false } = {}) {
  const done = ['DELIVERED', 'CANCELED'].includes(order.status);

  const incoming = labels.filter((l) => (l.leg || 'PICKUP') === 'PICKUP');
  const outgoing = labels.filter((l) => l.leg === 'DELIVERY');

  const sum = (rows) => {
    const weighed = rows.filter((l) => l.weight_lb != null);
    return weighed.length ? weighed.reduce((t, l) => t + Number(l.weight_lb), 0) : null;
  };

  // The order's own totals win where they exist: they are what priced the order
  // and what the handover was checked against. The per-bag sum is the fallback.
  const inWeight = order.weight_lb != null ? Number(order.weight_lb) : sum(incoming);
  const outWeight = order.return_weight_lb != null ? Number(order.return_weight_lb) : sum(outgoing);

  const inCount = order.bag_count != null ? Number(order.bag_count) : incoming.length;
  const outCount = order.return_bag_count != null ? Number(order.return_bag_count) : outgoing.length;

  const leg = (title, hint, count, weight, rows, tone) => `
    <div style="border:2px solid var(--ink-900);border-radius:16px;background:${tone};
                padding:22px 24px;margin-bottom:16px;">
      <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:12px;">
        <div>
          <p class="eyebrow" style="margin:0 0 6px;">${escapeHtml(title)}</p>
          <div style="font-family:var(--font-display);font-weight:900;font-size:26px;line-height:1.1;">
            ${count ? count + ' bag' + (count === 1 ? '' : 's') : 'Not counted yet'}${
              weight != null ? ' &middot; ' + weight.toFixed(1) + ' lb' : ''
            }
          </div>
        </div>
        ${
          weight == null && count
            ? '<span class="badge" style="background:var(--stain-100);">not weighed</span>'
            : ''
        }
      </div>
      <p style="font-size:14px;line-height:1.55;color:var(--ink-500);margin:10px 0 0;">
        ${hint}
      </p>
      ${rows || ''}
    </div>`;

  // Dirty in against clean out. Deliberately NOT a symmetric comparison - see
  // the note in src/core/tags.js.
  const check = tags.checkHandover({ wentIn: inWeight, cameBack: outWeight });

  return `
  <div class="card card-xl" style="padding:28px;margin-bottom:28px;">
    <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:14px;margin-bottom:18px;">
      ${sectionHeading('The bags', 'In and out')}
      <a href="/ops/labels" style="font-size:14px;font-weight:600;">Print more stickers</a>
    </div>

    ${leg(
      'Collected from the customer',
      'Picked up off the doorstep and weighed bag by bag, each with a photo of the scale. This is what priced the order.',
      inCount,
      inWeight,
      incoming.length
        ? incoming.map((l) => bagRow(order, l, incoming.length, canAct, done)).join('')
        : '<p style="color:var(--ink-500);font-size:15px;margin:14px 0 0;">Nothing labelled yet.</p>',
      'var(--suds-100)'
    )}

    ${leg(
      'Collected from the laundromat',
      'What came back off their shelf. A different number of bags is normal, because they repack into their own, so this count is recorded separately and never assumed from the one above.',
      outCount,
      outWeight,
      outgoing.length
        ? outgoing.map((l) => bagRow(order, l, outgoing.length, canAct, done)).join('')
        : '',
      'var(--sunbeam-100)'
    )}

    ${
      check
        ? `<div style="border:2px solid ${check.ok ? 'var(--ink-900)' : 'var(--stain-500)'};
                       border-radius:14px;padding:16px 20px;
                       background:${check.ok ? 'var(--paper-050)' : 'var(--stain-100)'};">
             <p class="eyebrow" style="margin:0 0 6px;">Did it all come back</p>
             <p style="font-size:16px;line-height:1.55;margin:0;font-weight:600;">
               ${
                 check.ok
                   ? outWeight.toFixed(1) + ' lb back against ' + inWeight.toFixed(1) +
                     ' lb collected. Within what drying accounts for.'
                   : escapeHtml(check.detail)
               }
             </p>
           </div>`
        : ''
    }

    ${
      canAct && !done
        ? `<div style="margin:20px 0 0;">
             ${scanField({
               action: `/ops/orders/${order.order_number}/label`,
               label: 'Add a bag',
               buttonLabel: 'Add',
               hint: describeCodeFormat(),
             })}

             <!-- The return leg, recorded at the counter while the scale is
                  still out rather than at a doorstep in the dark. -->
             <form method="post" action="/ops/orders/${order.order_number}/return"
                   style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-top:22px;
                          padding-top:22px;border-top:2px solid var(--ink-100);">
               <div style="flex:1 1 150px;min-width:0;">
                 <label class="field-label" for="rc">Bags back from the laundromat</label>
                 <input class="field" id="rc" name="bag_count" type="number" min="1" max="40"
                        inputmode="numeric" value="${order.return_bag_count == null ? '' : order.return_bag_count}">
               </div>
               <div style="flex:1 1 150px;min-width:0;">
                 <label class="field-label" for="rw">What they weigh</label>
                 <input class="field" id="rw" name="weight_lb" type="number" step="0.1" min="0" max="400"
                        inputmode="decimal" value="${order.return_weight_lb == null ? '' : order.return_weight_lb}">
               </div>
               <button class="btn btn-ink" type="submit">Save</button>

               ${
                 // THE ESCAPE HATCH. Only after the check has actually refused,
                 // and only for somebody holding orders.override - a driver at
                 // a counter is the person in a hurry, and the whole value of
                 // the check is that somebody else agreed it was fine.
                 //
                 // Full width under the two number fields, because a reason is
                 // a sentence and a sentence does not belong in a 150px box.
                 refused && mayOverride
                   ? `<div style="flex:1 1 100%;padding-top:16px;margin-top:4px;
                                  border-top:2px dashed var(--stain-500);">
                        <label class="field-label" for="ovr">
                          Take it anyway - why?
                        </label>
                        <p class="field-hint" style="margin:0 0 10px;">
                          Only if you are sure. It goes on the order with your
                          name on it and still opens an issue for the morning,
                          because going ahead tonight is not the same as the
                          load being right.
                        </p>
                        <input class="field" id="ovr" name="override_reason" type="text"
                               maxlength="300"
                               placeholder="counted them twice with the owner, all four are here">
                      </div>`
                   : ''
               }
             </form>
           </div>`
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
      .select(
        `${ORDER_FIELDS}, price_per_lb_cents, payment_failure_reason, paid_at, ` +
          'weight_photo_path, partner_weight_lb, partner_weight_at, driver_id'
      )
      .eq(byNumber ? 'order_number' : 'id', wanted)
      .maybeSingle();

    if (error) throw error;
    if (!order) return notFoundPage(res, `No order ${byNumber ? `#${wanted}` : 'with that id'}.`);

    // A DRIVER'S OWN ROUND, HERE TOO. The board already hides other people's
    // stops, but a board that hides something and a page that serves it anyway
    // is not access control - it is a missing link. Typing the number reaches
    // this route directly.
    //
    // An order nobody owns stays open to everybody on purpose: it is the one
    // most likely to be missed, and locking it away from the person standing
    // nearest helps nobody.
    if (
      !roles.can(req.opsUser, 'customers.view') &&
      order.driver_id &&
      order.driver_id !== req.opsUser.id
    ) {
      return notFoundPage(res, 'That order is on somebody else\'s round.');
    }

    const c = order.customers || {};
    const showMoney = roles.can(req.opsUser, 'money.view');

    // Only fetched for somebody who can actually move the order; a driver has
    // no reassign control, so the query would be work for nothing.
    const team = roles.can(req.opsUser, 'customers.view') ? await drivers.active() : [];

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

    // Which stickers are on this order's bags, and how many have been scanned
    // at the door. Both drive the work card.
    const labels = await bags.forOrder(order.id);
    const doorScan = await loadout.allBagsScanned(order);
    const history = await orderEvents.forOrder(order.id);

    // Only fetched when the bag could actually be dropped somewhere, so every
    // other order page does not pay for a query it will not use.
    const laundromats = order.status === 'IN_PROCESS' ? await partners.activeLaundromats() : [];
    const bagScan = {
      total: doorScan.total,
      scanned: doorScan.scanned,
      allScanned: doorScan.ok,
      // The individual bags, so a three-bag order can show WHICH one is still
      // missing rather than only that one is.
      labels: doorScan.labels || [],
    };

    const body = `
      <a href="/ops" style="font-size:15px;font-weight:600;">&larr; All orders</a>

      <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:14px;margin:18px 0 32px;">
        <h1 style="font-family:var(--font-display);font-weight:900;font-size:38px;letter-spacing:-0.03em;margin:0;">
          <span style="font-variant-numeric:tabular-nums;">#${order.order_number}</span>
          ${
            // The order number identifies the stop; the name is the customer's,
            // and a driver working the round is not shown one. Without this the
            // whole page can be locked down and the heading still says who
            // lives there.
            roles.can(req.opsUser, 'customers.view')
              ? `<span style="color:var(--ink-400);">&middot;</span>
          ${escapeHtml(c.name || 'Unknown customer')}`
              : ''
          }
        </h1>
        ${statusBadge(order.status)}
        ${
          // PAID / UNPAID is the books, same as a price is.
          roles.can(req.opsUser, 'money.view') ? paymentBadge(order) : ''
        }
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
        bagScan,
        laundromats,
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

      ${bagsCard(order, labels, roles.can(req.opsUser, 'orders.act'), {
        mayOverride: roles.can(req.opsUser, 'orders.override'),
        // THE HATCH ONLY APPEARS AFTER A REFUSAL. Offering "go anyway" beside
        // a form nobody has submitted yet invites it to be used as the normal
        // way through, which is the opposite of what a check is for.
        refused: /did not|short|heavier|lighter/i.test(String(req.query.problem || '')),
      })}
      ${scannerScript()}

      ${(() => {

      // WHAT A DRIVER IS SHOWN IS THE STOP, NOT THE CUSTOMER.
      //
      // A round needs: where, when, how to get in, where the bag is, how many,
      // what it weighed. It does not need a name, a phone number, the thread,
      // the change log or the money - those are a file on a person, and the
      // permissions below are what keep them off the page rather than a role
      // check written out here (see src/core/roles.js).
      //
      // The address is the one personal detail that survives, because you
      // cannot drive to a stop without it.
      const seeCustomer = roles.can(req.opsUser, 'customers.view');
      const seeThread = roles.can(req.opsUser, 'messages.view');
      const seeAudit = roles.can(req.opsUser, 'orders.audit');

      // With both side cards gone the two-column grid would leave a column of
      // nothing, so the details card takes the full width instead.
      const sideColumn = seeCustomer || seeThread;

      return `
      ${seeAudit ? `<div style="margin-top:28px;">${historyCard(history)}</div>` : ''}

      <div class="${sideColumn ? 'grid-2' : ''}" style="align-items:start;">

        <div class="card card-xl" style="padding:28px;">
          ${sectionHeading('The order', 'Details')}
          ${
            // FIRST ROW, FOR EVERYONE. It used to sit in the customer card,
            // which meant hiding that card from a driver would have hidden the
            // one thing they cannot work without.
            detail(
              'Address',
              (() => {
                const where = addressOf(c);
                if (!where) return '<span style="color:var(--ink-500);">no address on file</span>';
                return `<a href="https://maps.google.com/?q=${encodeURIComponent(
                  where
                )}" target="_blank" rel="noopener"><strong>${escapeHtml(where)}</strong></a>`;
              })()
            )
          }
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
            // handed over. The laundromat reads it off the QR page instead, so
            // a driver does not need it here.
            (() => {
              const p = c.preferences || {};
              if (!seeCustomer || !p.water_temp) return '';
              const wash =
                `${String(p.water_temp).toLowerCase()} water, ` +
                `${p.detergent === 'HYPOALLERGENIC' ? 'hypoallergenic' : 'standard'} detergent, ` +
                `${p.fabric_softener ? 'softener' : 'no softener'}`;
              return detail('Wash', escapeHtml(wash));
            })()
          }
          ${detail('Bags', order.bag_count || '—')}
          ${detail(
            'Weight',
            order.weight_lb
              ? `${order.weight_lb} lb` +
                (order.weight_photo_path
                  ? ` &middot; <a href="/ops/orders/${order.order_number}/scale-photo">scale photo</a>`
                  : ' <span style="color:var(--ink-500);">(no photo, weighed before we asked for one)</span>')
              : 'not weighed yet'
          )}
          ${
            // Only when they gave one. A missing partner weight is the normal
            // case and an empty row would read as something being wrong.
            order.partner_weight_lb != null && roles.can(req.opsUser, 'partners.view')
              ? detail(
                  'Laundromat said',
                  (() => {
                    const theirs = Number(order.partner_weight_lb);
                    const ours = order.weight_lb == null ? null : Number(order.weight_lb);
                    const gap = ours == null ? null : Math.abs(ours - theirs);
                    const off = gap != null && gap > 1;
                    return (
                      `${theirs.toFixed(1)} lb` +
                      (off
                        ? ` <span style="color:var(--stain-500);font-weight:700;">&middot; ${gap.toFixed(
                            1
                          )} lb out</span>`
                        : ' <span style="color:var(--ink-500);">&middot; agrees</span>')
                    );
                  })()
                )
              : ''
          }
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
          ${
            // WHOSE ORDER IT IS, and a way to move it.
            //
            // Automatic assignment knows about distance and nothing about who
            // is off sick or already carrying a full van, so the answer it
            // gives has to be correctable. A driver does not get this control -
            // they cannot hand their own work to somebody else.
            seeCustomer
              ? detail(
                  'Driver',
                  `<form method="post" action="/ops/orders/${order.order_number}/driver"
                         style="margin:0;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
                     <select class="select" name="driver_id"
                             style="min-height:36px;padding:4px 10px;font-size:14px;">
                       <option value=""${order.driver_id ? '' : ' selected'}>Nobody yet</option>
                       ${team
                         .map(
                           (d) =>
                             `<option value="${escapeHtml(d.id)}"${
                               d.id === order.driver_id ? ' selected' : ''
                             }>${escapeHtml(d.name)}${d.base_city ? ` - ${escapeHtml(d.base_city)}` : ''}</option>`
                         )
                         .join('')}
                     </select>
                     <button class="btn btn-sm btn-outline" type="submit">Move</button>
                   </form>`
                )
              : ''
          }
          ${seeAudit ? detail('Booked', dateTime(order.created_at)) : ''}
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

        ${sideColumn ? `
        <div>
          ${seeCustomer ? `
          <div class="card card-xl" style="padding:28px;margin-bottom:22px;">
            ${sectionHeading('Who', 'Customer')}
            ${detail('Name', escapeHtml(c.name || '—'))}
            ${detail('Phone', `<a href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone || '—')}</a>`)}
            ${detail('Address', escapeHtml(addressOf(c)) || '—')}
            <div style="padding-top:20px;">
              <a href="/ops/customers/${c.id}" class="btn btn-outline">Full profile ${icon('arrow-right', '16')}</a>
            </div>
          </div>` : ''}

          ${seeThread ? `
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
          </div>` : ''}
        </div>` : ''}

      </div>`;
      })()}`;

    res.type('html').send(adminPage({ title: 'Order', active: '/ops', body, user: req.opsUser, openIssues: req.openIssues, serviceClosed: req.serviceClosed }));
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

    res.type('html').send(adminPage({ title: 'Customers', active: '/ops/customers', body, user: req.opsUser, openIssues: req.openIssues, serviceClosed: req.serviceClosed }));
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

    // A customer can have several standing orders - Tuesday mornings and
    // Saturday lunchtimes is a real arrangement - so they come from their own
    // table rather than a pair of columns on the row.
    const schedules = person ? await recurring.forCustomer(person.id) : [];

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
          ${sectionHeading(
            'Standing orders',
            schedules.filter((sc) => sc.status === 'ACTIVE').length
              ? `${schedules.filter((sc) => sc.status === 'ACTIVE').length} running`
              : 'None'
          )}
          ${
            schedules.filter((sc) => sc.status === 'ACTIVE').length
              ? schedules
                  .filter((sc) => sc.status === 'ACTIVE')
                  .map((sc) => {
                    const next = recurring.nextDate(sc);
                    const paused = Boolean(sc.paused_until);
                    return `
            <div style="display:flex;gap:14px;align-items:flex-start;padding:14px 0;border-bottom:1px solid var(--ink-100);">
              <span style="flex:none;width:12px;height:12px;margin-top:6px;border:2px solid var(--ink-900);
                           border-radius:50%;background:${paused ? 'var(--paper-300)' : 'var(--suds-500)'};"></span>
              <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:16px;">
                  ${escapeHtml(recurring.DAY_NAMES[sc.weekday])}${
                      sc.time_of_day ? ` at ${escapeHtml(booking.readableTime(sc.time_of_day))}` : ''
                    }
                </div>
                <div style="font-size:14px;color:var(--ink-700);margin-top:2px;">
                  ${escapeHtml(recurring.CADENCES[sc.cadence].label)}${
                      paused
                        ? ` &middot; paused until ${escapeHtml(booking.readableDate(String(sc.paused_until).slice(0, 10)))}`
                        : ''
                    }
                </div>
                <div style="font-family:var(--font-mono);font-size:12px;color:var(--ink-500);margin-top:4px;">
                  ${next ? `next ${escapeHtml(booking.readableDate(next))}` : 'nothing due'}
                </div>
              </div>
            </div>`;
                  })
                  .join('') +
                `<p style="font-size:13px;color:var(--ink-500);line-height:1.55;margin:16px 0 0;">
                   Booked the evening before by the nightly run, with a text they can
                   reply SKIP to. Changed by texting us, not from here.
                 </p>`
              : `<p style="margin:6px 0 0;font-size:15px;color:var(--ink-500);line-height:1.6;">
                   No repeating pickup. They are offered one after a clean delivery,
                   once, and can set one up any time by texting.
                 </p>`
          }
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

    res.type('html').send(adminPage({ title: person.name || 'Customer', active: '/ops/customers', body, user: req.opsUser, openIssues: req.openIssues, serviceClosed: req.serviceClosed }));
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
  weight: 'Weight saved. The price is set; the card is charged on delivery.',
  // The label banner carries its own sentence in ?note=, because "added" and
  // "was already there" and "taken off" are three different things.
  label: null,
  door: null,
  'out-for-delivery': 'Out for delivery. The customer has been texted.',
  delivered: 'Delivered. The card has been charged and the customer texted.',
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

// Move an order to a different driver, or to nobody.
//
// Behind customers.view rather than orders.act: a driver can work an order but
// cannot hand it to somebody else, which is a scheduling decision rather than a
// step in the round. Logged like every other change, because "who was supposed
// to collect this" is exactly the question asked after one goes missing.
router.post('/ops/orders/:id/driver', guard, may('customers.view'), async (req, res, next) => {
  try {
    const order = await loadOrderForAction(req.params.id);
    if (!order) return notFoundPage(res, 'No order with that number.');

    const wanted = String((req.body || {}).driver_id || '').trim();
    const driverId = /^[0-9a-f-]{36}$/i.test(wanted) ? wanted : null;

    const to = driverId ? await drivers.find(driverId) : null;
    if (driverId && !to) {
      return res.redirect(
        303,
        `/ops/orders/${order.order_number}?problem=${encodeURIComponent('No such driver.')}`
      );
    }

    const from = order.driver_id ? await drivers.find(order.driver_id) : null;

    const { error } = await db.from('orders').update({ driver_id: driverId }).eq('id', order.id);
    if (error) throw error;

    await orderEvents.record(order.id, {
      kind: 'DRIVER',
      summary: to ? `Moved to ${to.name}` : 'Unassigned',
      was: from ? from.name : 'nobody',
      became: to ? to.name : 'nobody',
      by: { opsUser: req.opsUser },
    });

    // Back where it was done from. Assigning from the board's red banner and
    // then landing on the order page loses the list of everything else that
    // still needs a driver, which is the whole reason for being there.
    const note = encodeURIComponent(
      to ? `#${order.order_number} assigned to ${to.name}.` : `#${order.order_number} unassigned.`
    );

    return res.redirect(
      303,
      (req.body || {}).from === 'board'
        ? `/ops?note=${note}`
        : `/ops/orders/${order.order_number}?note=${note}`
    );
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// The guided run: /ops/run
//
// One stop, one thing to do, and a button that opens the maps app. The routing
// board is the day for somebody at a desk; this is the same day for somebody in
// a van, and a driver should never have to work out what is next.
//
// Behind orders.act, and it is always the SIGNED-IN person's round. There is no
// ?driver= here on purpose - this is not a screen for looking at somebody
// else's day, that is what the routing board is for.
// ---------------------------------------------------------------------------

router.get('/ops/run', guard, withIssues, may('orders.drive'), async (req, res, next) => {
  try {
    const state = await runCore.forDriver(req.opsUser.id);

    return res.type('html').send(
      adminPage({
        title: 'Your round',
        active: '/ops/run',
        body: runBody({
          run: state,
          notice: req.query.note ? String(req.query.note).slice(0, 200) : null,
          problem: req.query.problem ? String(req.query.problem).slice(0, 200) : null,
        }),
        user: req.opsUser,
        openIssues: req.openIssues, serviceClosed: req.serviceClosed,
      })
    );
  } catch (err) {
    return next(err);
  }
});

// "I'm here."
//
// The only thing on the run that is not already a step in fulfilment.js, and it
// deliberately changes nothing about the order except a flag saying the driver
// is standing at it. Everything that actually moves an order still goes through
// the same routes the order page uses.
router.post('/ops/run/here', guard, may('orders.drive'), async (req, res, next) => {
  try {
    const orderId = String((req.body || {}).order_id || '');
    if (!UUID.test(orderId)) return res.redirect(303, '/ops/run');

    const order = await loadOrderForAction(orderId);
    if (!order) return res.redirect(303, '/ops/run');

    // A driver cannot mark himself present at somebody else's stop, for the
    // same reason he cannot open their order.
    if (!roles.can(req.opsUser, 'customers.view') && order.driver_id && order.driver_id !== req.opsUser.id) {
      return notFoundPage(res, "That order is on somebody else's round.");
    }

    await runCore.arrive(orderId);
    return res.redirect(303, '/ops/run');
  } catch (err) {
    return next(err);
  }
});

// Handing a load over at the laundromat. Several orders, one visit, so this
// loops fulfilment.dropAtPartner rather than being a new way to do it.
router.post('/ops/run/dropped', guard, may('orders.drive'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const partnerId = UUID.test(String(body.partner_id || '')) ? String(body.partner_id) : null;

    // A form with one hidden input gives a string, several give an array.
    const ids = []
      .concat(body.order_id || [])
      .map(String)
      .filter((id) => UUID.test(id));

    if (!ids.length) return res.redirect(303, '/ops/run');

    const failures = [];

    for (const id of ids) {
      const order = await loadOrderForAction(id);
      if (!order) continue;

      const result = await fulfilment.dropAtPartner(order, {
        partnerId,
        by: { opsUser: req.opsUser },
      });

      if (!result.ok) failures.push(`#${order.order_number}: ${result.detail}`);
    }

    if (failures.length) {
      return res.redirect(303, `/ops/run?problem=${encodeURIComponent(failures.join(' '))}`);
    }

    return res.redirect(
      303,
      `/ops/run?note=${encodeURIComponent(
        `${ids.length} bag${ids.length === 1 ? '' : 's'} handed over. On to the next one.`
      )}`
    );
  } catch (err) {
    return next(err);
  }
});

// WHERE A COMPLETED ACTION PUTS YOU BACK.
//
// The order page and the guided run post to the same routes - that is the whole
// point, there is one implementation of "collected" and not two - so the only
// difference is where you land afterwards. `?from=run` on the form action is
// what carries that, and a driver stepping through his round never sees the
// order page unless he asks for it.
function backTo(req, order) {
  return String(req.query.from) === 'run' ? '/ops/run' : `/ops/orders/${order.order_number}`;
}

// Every button route is this shape, so they are built rather than repeated.
function orderAction(action, run, middleware = null) {
  const handler = async (req, res, next) => {
    try {
      const order = await loadOrderForAction(req.params.id);
      if (!order) return notFoundPage(res, 'No order with that number.');

      // The same round check the page does. Hiding a button while the route
      // behind it still fires is not access control, and every one of these is
      // a plain form post somebody could aim anywhere.
      if (
        !roles.can(req.opsUser, 'customers.view') &&
        order.driver_id &&
        order.driver_id !== req.opsUser.id
      ) {
        return notFoundPage(res, "That order is on somebody else's round.");
      }

      const back = backTo(req, order);

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
orderAction('collected', (order, req) =>
  fulfilment.collect(order, { bagCount: (req.body || {}).bag_count, by: { opsUser: req.opsUser } })
);
orderAction('at-partner', (order, req) =>
  fulfilment.dropAtPartner(order, {
    partnerId: (req.body || {}).partner_id || null,
    by: { opsUser: req.opsUser },
  })
);
orderAction('ready', (order, req) => fulfilment.markReady(order, { by: { opsUser: req.opsUser } }));
// Multipart now: the scale photo rides along with the number it evidences.
orderAction(
  'weight',
  (order, req) =>
    fulfilment.recordWeight(order, (req.body || {}).weight_lb, req.file, { by: { opsUser: req.opsUser } }),
  upload.single('photo')
);
orderAction('out-for-delivery', (order, req) =>
  fulfilment.outForDelivery(order, { by: { opsUser: req.opsUser } })
);
orderAction('delivered', (order, req) =>
  fulfilment.deliver(order, req.file, { by: { opsUser: req.opsUser } }), upload.single('photo')
);

// ---------------------------------------------------------------------------
// GET /ops/routing — the day, on a map, from the live queue
//
// A GET with the address in the query string on purpose. It writes nothing, so
// it is safe to refresh, safe to bookmark and safe to send to somebody - which
// a POST would not be. The one cost is that an address ends up in the ops
// server log; these pages are already full of them.
//
// Behind orders.act rather than money.view. It shows a per-mile cost, but that
// is the van's cost and not the customer's book, and the person who needs the
// answer is whoever is being asked to take the order.
// ---------------------------------------------------------------------------

// The screen was called Dispatch until Neil renamed it. Anything already
// bookmarked or pasted into a message still lands, query string and all, so a
// link somebody saved this morning does not 404 this afternoon.
router.get('/ops/dispatch', (req, res) => {
  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(301, `/ops/routing${query}`);
});

router.get('/ops/routing', guard, withIssues, may('orders.act'), async (req, res, next) => {
  try {
    const address = String(req.query.address || '').trim().slice(0, 200);
    const lb = String(req.query.lb || '').trim().slice(0, 6);

    // A day and a time, both from the query string so the whole board is a URL
    // somebody can send. Anything unparseable falls back to today and now
    // rather than erroring - a date box is not worth a 400.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
      ? String(req.query.date)
      : null;
    const from = /^\d{1,2}:\d{2}$/.test(String(req.query.from || ''))
      ? String(req.query.from)
      : null;

    // WHOSE DAY. A driver is locked to their own - they see the stop, not the
    // business, and that holds here exactly as it does on the order page.
    // Anyone who can see customers picks from the list.
    const canPickAnyone = roles.can(req.opsUser, 'customers.view');
    const team = canPickAnyone ? await drivers.active() : [];

    const asked = /^[0-9a-f-]{36}$/i.test(String(req.query.driver || '')) ? String(req.query.driver) : null;
    const driverId = canPickAnyone ? asked : req.opsUser.id;

    const board = await dispatch.board(date, from, driverId);

    // WHERE THAT DRIVER ACTUALLY IS RIGHT NOW.
    //
    // The board is what is LEFT - a stop disappears from it the moment it is
    // done - so on its own it cannot say whether somebody is at their first
    // stop or their last. The run already works this out for the driver's own
    // screen; the same call answers it here, so the two can never disagree
    // about how far through he is.
    //
    // Only for a real driver on today. "Everybody" has no single progress, and
    // a future day has not started.
    // board.date, not the raw query param - that is null when no day was asked
    // for, so comparing it to today was false on the very page somebody lands
    // on and the card never appeared.
    const progress =
      driverId && board.date === booking.today() ? await runCore.forDriver(driverId) : null;

    let quote = null;
    let problem = null;

    if (address) {
      const answer = await dispatch.quote({
        address,
        estimateLb: lb ? Number(lb) : null,
      });

      if (answer.ok) quote = answer;
      else problem = answer.detail;
    }

    return res.type('html').send(
      adminPage({
        title: 'Routing',
        active: '/ops/routing',
        head: routePlannerHead(),
        body: routingBoardBody({
          board,
          quote,
          form: { address, lb },
          problem,
          drivers: team,
          driverId,
          progress,
          lockedToSelf: !canPickAnyone,
          // A driver gets the run sheet; the customer's name and the money on
          // it are not theirs, exactly as on the order page.
          showNames: roles.can(req.opsUser, 'customers.view'),
          showMoney: roles.can(req.opsUser, 'money.view'),
        }),
        user: req.opsUser,
        openIssues: req.openIssues, serviceClosed: req.serviceClosed,
      })
    );
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// The load-out pass: /ops/loadout
//
// Scan every bag into the van at the laundromat, then build the run. Behind
// orders.act because it is the driver's screen and the driver is the one
// holding the bags.
// ---------------------------------------------------------------------------

async function renderLoadout(req, res, { built = false } = {}) {
  const run = await loadout.currentRun();

  return res.type('html').send(
    adminPage({
      title: 'Load the van',
      active: '/ops/loadout',
      body: loadoutBody({
        run,
        built,
        notice: req.query.note ? String(req.query.note).slice(0, 200) : null,
        problem: req.query.problem ? String(req.query.problem).slice(0, 200) : null,
      }),
      user: req.opsUser,
      openIssues: req.openIssues, serviceClosed: req.serviceClosed,
    })
  );
}

router.get('/ops/loadout', guard, withIssues, may('orders.act'), async (req, res, next) => {
  try {
    return await renderLoadout(req, res, { built: req.query.built === '1' });
  } catch (err) {
    return next(err);
  }
});

router.post('/ops/loadout/scan', guard, may('orders.act'), async (req, res, next) => {
  try {
    const result = await loadout.scanIn((req.body || {}).code, req.opsUser && req.opsUser.id);

    if (!result.ok) {
      return res.redirect(303, `/ops/loadout?problem=${encodeURIComponent(result.detail)}`);
    }

    const note = result.already
      ? `${result.label.code} was already in the van.`
      : `${result.label.code} loaded, order #${result.order.order_number}.`;

    return res.redirect(303, `/ops/loadout?note=${encodeURIComponent(note)}`);
  } catch (err) {
    return next(err);
  }
});

router.post('/ops/loadout/build', guard, may('orders.act'), async (req, res, next) => {
  try {
    const { orders: sequenced, miles } = await loadout.buildRun();

    const lost = sequenced.filter((o) => !o.located).length;
    const note =
      `${sequenced.length} stop${sequenced.length === 1 ? '' : 's'}, about ${miles.toFixed(1)} miles.` +
      (lost ? ` ${lost} address could not be found and sorted last.` : '');

    return res.redirect(303, `/ops/loadout?built=1&note=${encodeURIComponent(note)}`);
  } catch (err) {
    return next(err);
  }
});

// --- The scale photo --------------------------------------------------------
//
// Internal evidence, so unlike a delivery photo there is no public link and no
// 30-day window: it is signed for a minute at a time and only for somebody
// already signed in to ops. money.view rather than orders.view, because the
// whole reason the photo exists is the charge it justifies.

router.get('/ops/orders/:id/scale-photo', guard, may('money.view'), async (req, res, next) => {
  try {
    const order = await loadOrderForAction(req.params.id);
    if (!order) return notFoundPage(res, 'No order with that number.');
    if (!order.weight_photo_path) return notFoundPage(res, 'No scale photo on that order.');

    const { data: signed, error } = await db.storage
      .from(fulfilment.WEIGHT_PHOTO_BUCKET)
      .createSignedUrl(order.weight_photo_path, 60);

    if (error) throw error;

    res.set('Cache-Control', 'no-store, private');
    return res.redirect(302, signed.signedUrl);
  } catch (err) {
    return next(err);
  }
});

// --- Scanning a bag at the customer's door ----------------------------------

router.post('/ops/orders/:id/door-scan', guard, may('orders.act'), async (req, res, next) => {
  try {
    const order = await loadOrderForAction(req.params.id);
    if (!order) return notFoundPage(res, 'No order with that number.');

    const back = backTo(req, order);
    const result = await loadout.scanAtDoor((req.body || {}).code, order);

    if (!result.ok) {
      return res.redirect(303, `${back}?problem=${encodeURIComponent(result.detail)}`);
    }

    const after = await loadout.allBagsScanned(order);
    const note = result.already
      ? `${result.label.code} was already scanned. ${after.scanned} of ${after.total} done.`
      : `${result.label.code} checked. ${after.scanned} of ${after.total} done.` +
        (after.ok ? ' All bags accounted for - take the photo.' : '');

    return res.redirect(303, `${back}?done=door&note=${encodeURIComponent(note)}`);
  } catch (err) {
    return next(err);
  }
});

// --- How many bags, and what each one weighs --------------------------------
//
// A driver stands at a door with his hands full, so the run asks how many bags
// there are, then walks them one at a time: sticker, scale, photo. These two
// routes are what those steps post to.

router.post('/ops/orders/:id/bag-count', guard, may('orders.act'), async (req, res, next) => {
  try {
    const order = await loadOrderForAction(req.params.id);
    if (!order) return notFoundPage(res, 'No order with that number.');

    const back = backTo(req, order);
    const count = Math.round(Number((req.body || {}).bag_count));

    if (!Number.isFinite(count) || count < 1 || count > 20) {
      return res.redirect(
        303,
        `${back}?problem=${encodeURIComponent('How many bags? A number between 1 and 20.')}`
      );
    }

    const { error } = await db.from('orders').update({ bag_count: count }).eq('id', order.id);
    if (error) throw error;

    await orderEvents.record(order.id, {
      kind: 'NOTE',
      summary: `${count} bag${count === 1 ? '' : 's'} at the door`,
      was: order.bag_count == null ? 'not counted' : String(order.bag_count),
      became: String(count),
      by: { opsUser: req.opsUser },
    });

    return res.redirect(303, `${back}?note=${encodeURIComponent(`${count} bags. Sticker the first one.`)}`);
  } catch (err) {
    return next(err);
  }
});

router.post(
  '/ops/orders/:id/bag-weight',
  guard,
  may('orders.act'),
  upload.single('photo'),
  async (req, res, next) => {
    try {
      const order = await loadOrderForAction(req.params.id);
      if (!order) return notFoundPage(res, 'No order with that number.');

      const back = backTo(req, order);
      const body = req.body || {};

      const result = await bags.recordBagWeight(body.code, body.weight_lb, req.file, { order });

      if (!result.ok) {
        return res.redirect(303, `${back}?problem=${encodeURIComponent(result.detail)}`);
      }

      // THE CLIP GOES ON HERE, the moment the bag has a weight and is about to
      // go in the van. From now until it is handed to the laundromat this
      // number is what the bag is called.
      const clipped = await bags.assignClip(result.label, order.driver_id);

      if (!clipped.ok) {
        return res.redirect(303, `${back}?problem=${encodeURIComponent(clipped.detail)}`);
      }

      // A RETURNING BAG IS WEIGHED, NEVER PRICED.
      //
      // The laundromat repacks into its own bags, so what comes back is a
      // different number of different objects. What proves nothing was lost is
      // not the count - it is the WEIGHT under one order number: 25 lb collected
      // and 25 lb returned means it is all there, in one bag or in three.
      //
      // This must never touch price_cents. The pickup scale is the figure the
      // customer was texted and agreed to, and re-pricing from a clean weight
      // would move money nobody authorised - the same rule that keeps a
      // laundromat's own figure out of the pricing code.
      if ((result.label.leg || 'PICKUP') === 'DELIVERY') {
        const back_ = await bags.totalWeight(order.id, 'DELIVERY');

        if (!back_ || !back_.allWeighed) {
          return res.redirect(
            303,
            `${back}?note=${encodeURIComponent(
              `Clip ${clipped.clip} on that one. ${back_ ? back_.bags : 0} of ` +
                `${back_ ? back_.total : 0} bags coming back weighed.`
            )}`
          );
        }

        const check = await fulfilment.reconcileReturn(order, back_, {
          by: { opsUser: req.opsUser },
        });

        return res.redirect(
          303,
          check.overThreshold
            ? `${back}?problem=${encodeURIComponent(check.detail)}`
            : `${back}?note=${encodeURIComponent(check.detail)}`
        );
      }

      // THE ORDER'S WEIGHT IS THE SUM OF ITS BAGS, recomputed here rather than
      // typed. It stays the authoritative figure - it prices the order and it is
      // what a laundromat's number is checked against - it is simply added up.
      //
      // Written through fulfilment so the price, the audit entry and the text to
      // the customer all happen the one way they already happen. There is no
      // second implementation of "this order now weighs X".
      const totals = await bags.totalWeight(order.id, 'PICKUP');

      if (totals && totals.allWeighed) {
        const priced = await fulfilment.recordWeight(order, totals.pounds, null, {
          by: { opsUser: req.opsUser },
          // Every bag was photographed on the scale individually, which is
          // better evidence than the single photo recordWeight would otherwise
          // insist on.
          photoOnBags: true,
        });

        if (!priced.ok) {
          return res.redirect(303, `${back}?problem=${encodeURIComponent(priced.detail)}`);
        }

        return res.redirect(
          303,
          `${back}?note=${encodeURIComponent(
            `Clip ${clipped.clip} on that one. All ${totals.bags} bags weighed - ` +
              `${totals.pounds.toFixed(1)} lb altogether.`
          )}`
        );
      }

      return res.redirect(
        303,
        `${back}?note=${encodeURIComponent(
          `${Number(body.weight_lb).toFixed(1)} lb - put clip ${clipped.clip} on it. ` +
            `${totals ? totals.bags : 0} of ${totals ? totals.total : 0} bags done.`
        )}`
      );
    } catch (err) {
      return next(err);
    }
  }
);

// --- Collecting the finished work off a laundromat --------------------------
//
// WEIGH FIRST, THEN CLIP, and the order of the two is the point. The driver is
// at a counter with some number of finished bags that carry nothing at all. He
// says how many and what they weigh; the weight is checked against what he
// collected from the customer; and ONLY if that passes do the clips go on.
//
// So a clipped bag is a verified bag. The clips in the van are not just a way
// of telling orders apart, they are the record that this load was weighed and
// matched before it moved.
//
// It also needs nothing stuck to anything. A clip attaches to a bag row, not to
// a code, so the laundromat is not asked to label what it packed.
router.post('/ops/orders/:id/return', guard, may('orders.act'), async (req, res, next) => {
  try {
    const order = await loadOrderForAction(req.params.id);
    if (!order) return notFoundPage(res, 'No order with that number.');

    const back = backTo(req, order);
    const body = req.body || {};

    // THE ESCAPE HATCH, and who is allowed to pull it.
    //
    // Checked here rather than trusted from the form, because a hidden field
    // whose route still fires is not a guard - the same rule the bag page and
    // the team page already follow. A driver posting an override reason gets
    // the refusal exactly as before.
    const mayOverride = roles.can(req.opsUser, 'orders.override');
    const reason = String(body.override_reason || '').trim();
    const override = mayOverride && reason ? { reason } : null;

    const result = await tags.collectFromPartner(order, {
      bagCount: body.bag_count,
      weightLb: body.weight_lb,
      driverId: order.driver_id,
      override,
    });

    if (!result.ok) {
      // A mismatch is worth a person looking at, and the place to look is the
      // counter he is standing at. Nothing was created and no clip was taken,
      // so he can weigh again and retry without undoing anything.
      if (result.reason === 'mismatch') {
        await orderEvents.record(order.id, {
          kind: 'WEIGHT',
          summary: `Refused at collection: ${result.check.direction.toLowerCase()} than expected`,
          was: order.weight_lb == null ? null : `${order.weight_lb} lb collected`,
          became: `${Number(body.weight_lb).toFixed(1)} lb offered back`,
          by: { opsUser: req.opsUser },
          reason: result.detail,
        });

        await issues
          .raise({ customer: order.customers || null, order, reason: result.detail })
          .catch((err) => console.error(`Could not raise a handover mismatch: ${err.message}`));
      }

      return res.redirect(303, `${back}?problem=${encodeURIComponent(result.detail)}`);
    }

    await orderEvents.record(order.id, {
      kind: 'WEIGHT',
      summary:
        (result.overrode ? 'OVERRIDDEN: ' : '') +
        `${result.count} bag${result.count === 1 ? '' : 's'} collected from the laundromat, ` +
        `${result.weight.toFixed(1)} lb` +
        (result.clips.length ? ` on clip${result.clips.length === 1 ? '' : 's'} ${result.clips.join(', ')}` : ''),
      was: order.weight_lb == null ? null : `${order.weight_lb} lb collected`,
      became: `${result.weight.toFixed(1)} lb back`,
      by: { opsUser: req.opsUser },
      // The reason only exists when somebody pushed past a refusal, which is
      // exactly the row anybody reading this log later is looking for.
      reason: result.overrode
        ? `${result.check.detail} Waved through: ${result.overrideReason}`
        : null,
    });

    // AN OVERRIDE STILL RAISES THE ISSUE. Going ahead is a decision about
    // tonight - the driver is at a counter and the laundromat is closing - and
    // it is not the same as the load being right. Somebody still has to find
    // out in the morning whether a bag is sitting on a shelf.
    if (result.overrode) {
      await issues
        .raise({
          customer: order.customers || null,
          order,
          reason: `${result.check.detail} Collected anyway by ${
            (req.opsUser || {}).name || 'an admin'
          }: ${result.overrideReason}`,
        })
        .catch((err) => console.error(`Could not raise an overridden handover: ${err.message}`));
    }

    // WHAT HE IS TOLD MUST NOT SAY "that matches" WHEN IT DID NOT. An override
    // that reads back like a clean pass is worse than no override at all.
    const clipList = `Clip${result.clips.length === 1 ? '' : 's'} ${result.clips.join(', ')}.`;

    const note = result.overrode
      ? `${result.count} bag${result.count === 1 ? '' : 's'}, ${result.weight.toFixed(1)} lb. ` +
        `This did NOT match - taken anyway, and it is on the order and in Issues. ` +
        (result.ranOut || clipList)
      : result.ranOut
        ? `${result.count} bags, ${result.weight.toFixed(1)} lb. ${result.ranOut}`
        : `${result.count} bag${result.count === 1 ? '' : 's'}, ${result.weight.toFixed(1)} lb. ` +
          `That matches what we collected. ${clipList}`;

    return res.redirect(303, `${back}?note=${encodeURIComponent(note)}`);
  } catch (err) {
    return next(err);
  }
});

// --- Sticking a label on a bag, and taking it off again ---------------------

router.post('/ops/orders/:id/label', guard, may('orders.act'), async (req, res, next) => {
  try {
    const order = await loadOrderForAction(req.params.id);
    if (!order) return notFoundPage(res, 'No order with that number.');

    const back = backTo(req, order);

    // Which leg this sticker belongs to is worked out from where the order is,
    // never asked. A sticker going on at a laundromat counter after the wash is
    // a bag THEY packed, and has nothing to do with how many we collected.
    const leg = bags.legForStatus(order.status);

    const result = await bags.bind(
      (req.body || {}).code,
      order,
      req.opsUser && req.opsUser.id,
      { leg }
    );

    if (!result.ok) {
      return res.redirect(303, `${back}?problem=${encodeURIComponent(result.detail)}`);
    }

    // Scanning the same sticker twice is not a mistake worth a red banner.
    const what = leg === 'DELIVERY' ? 'Bag coming back' : 'Bag';
    const note = result.already
      ? 'That label was already on this order.'
      : `${what} ${result.position} labelled.`;

    if (!result.already) {
      await orderEvents.record(order.id, {
        kind: 'LABEL',
        summary:
          `Label ${result.label.code} put on ` +
          `${leg === 'DELIVERY' ? 'returning bag' : 'bag'} ${result.position}`,
        became: result.label.code,
        by: { opsUser: req.opsUser },
      });
    }

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

    await orderEvents.record(order.id, {
      kind: 'LABEL',
      summary: `Label ${label.code} taken off`,
      was: label.code,
      by: { opsUser: req.opsUser },
    });

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

// A sticker is in exactly one of three states, and every count and colour on
// this page comes from this one function so they cannot disagree.
//
//   OUTSTANDING  printed, never used. Blank stock sitting in the van.
//   IN USE       on a bag right now. Its QR opens.
//   EXPIRED      the order it was on has been delivered. The code is kept so
//                the order page can still show which sticker was on which bag,
//                but the link is dead.
function labelState(label) {
  if (label.released_at) return 'EXPIRED';
  if (label.order_id) return 'IN_USE';
  return 'OUTSTANDING';
}

const LABEL_STATES = Object.freeze({
  OUTSTANDING: { label: 'Outstanding', colour: 'var(--lilac-500)', blurb: 'Printed, not yet on a bag' },
  IN_USE: { label: 'In use', colour: 'var(--suds-500)', blurb: 'On a bag right now, QR opens' },
  EXPIRED: { label: 'Expired', colour: 'var(--paper-300)', blurb: 'Order delivered, link dead' },
  // Kept in step with the sheet: a tag is one printed thing however many
  // stickers are on it, so nothing here counts in fours.
});

router.get('/ops/labels', guard, withIssues, may('orders.act'), async (req, res, next) => {
  try {
    // Every label, so the counts and the list are the same data rather than
    // three separate queries that could each be right about a different moment.
    // INTAKE ROWS ONLY. Since bag tags arrived, bag_labels also holds a row per
    // peelable sticker a laundromat has used - up to four more per tag, all
    // carrying the same code. Those are bags that came back, not tags that came
    // out of a printer, and counting them here would inflate the stock figures
    // by a factor of five and list the same code five times over. A row with no
    // sticker_seq is the tag itself, which is the thing this page is about.
    const { data: all, error: labelError } = await db
      .from('bag_labels')
      .select('*, orders(order_number)')
      .is('sticker_seq', null)
      .order('printed_at', { ascending: false })
      .limit(600);

    if (labelError) throw labelError;

    const labels = all || [];
    const byState = { OUTSTANDING: [], IN_USE: [], EXPIRED: [] };
    labels.forEach((l) => byState[labelState(l)].push(l));

    const blank = byState.OUTSTANDING.length;
    const inUse = byState.IN_USE.length;

    const filter = ['OUTSTANDING', 'IN_USE', 'EXPIRED'].includes(String(req.query.state))
      ? String(req.query.state)
      : null;

    const showing = filter ? byState[filter] : labels;

    const labelRow = (l) => {
      const state = labelState(l);
      const tone = LABEL_STATES[state];

      // THE URL IS PRINTED ON THE STICKER, so every label has one whatever
      // state it is in - it is physically there, under the QR, from the moment
      // the sheet comes out of the printer. What changes is what it resolves
      // to: nothing yet while the sticker is blank, the bag page while it is on
      // an order, and nothing again once that order is delivered and the label
      // is released. Showing it only for bound labels would suggest the others
      // have no address, which is not true of the thing in your hand.
      const url = bags.labelUrl(l.code);

      return `
      <div style="display:grid;grid-template-columns:12px minmax(0,1fr) auto;gap:10px 14px;
                  align-items:start;padding:14px 0;border-bottom:1px solid var(--ink-100);">
        <span style="width:12px;height:12px;margin-top:6px;border:2px solid var(--ink-900);border-radius:50%;
                     background:${tone.colour};"></span>

        <div style="min-width:0;">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <span style="font-family:var(--font-mono);font-size:18px;font-weight:700;letter-spacing:0.06em;
                         ${state === 'EXPIRED' ? 'color:var(--ink-500);' : ''}">${escapeHtml(l.code)}</span>
            <span class="badge" style="background:${tone.colour};">${escapeHtml(tone.label)}</span>
          </div>

          ${
            state === 'EXPIRED'
              ? `<div style="font-family:var(--font-mono);font-size:12px;line-height:1.5;margin-top:5px;
                             color:var(--ink-500);overflow-wrap:anywhere;">
                   <s>${escapeHtml(url)}</s><br>
                   <span style="color:var(--stain-500);font-weight:700;">dead - the order was delivered</span>
                 </div>`
              : `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"
                    style="display:block;font-family:var(--font-mono);font-size:12px;line-height:1.5;
                           margin-top:5px;overflow-wrap:anywhere;">${escapeHtml(url)}</a>
                 ${
                   state === 'OUTSTANDING'
                     ? `<div style="font-size:12px;color:var(--ink-500);margin-top:3px;">
                          Opens, but says the tag is not on a bag yet.
                        </div>`
                     : ''
                 }`
          }
        </div>

        <div style="text-align:right;font-size:14px;color:var(--ink-700);white-space:nowrap;">
          ${
            l.orders
              ? `<a href="/ops/orders/${l.orders.order_number}" style="font-weight:700;">#${l.orders.order_number}</a>${
                  l.position ? `<br><span style="font-size:13px;color:var(--ink-500);">bag ${l.position}</span>` : ''
                }`
              : '<span style="color:var(--ink-500);">no order</span>'
          }
        </div>
      </div>`;
    };

    const body = `
      <div style="max-width:640px;">
        <p class="eyebrow" style="margin:0 0 8px;">Bag tags</p>
        <h1 style="margin:0 0 16px;font-size:40px;line-height:1.05;">Bag tags</h1>
        <p style="font-size:16px;line-height:1.65;color:var(--ink-700);">
          A bag tag is blank until a driver puts it on a bag at the door and
          enters its id. Print a batch, keep them in the van. The tag is what
          lets a bag be identified without opening it, and what a laundromat
          scans to see how the wash is meant to be done.
        </p>
        <p style="font-size:16px;line-height:1.65;color:var(--ink-700);">
          Each tag carries <strong>four numbered stickers</strong>. They come
          off it one at a time and go on whatever bags the laundromat packs the
          clean laundry into, so one bag in can be four bags out and still be
          one order. The stickers are not counted here - this is printed stock.
        </p>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:20px;margin:32px 0;">
        ${statCard('Outstanding', byState.OUTSTANDING.length, 'var(--lilac-500)')}
        ${statCard('In use', byState.IN_USE.length, 'var(--suds-500)')}
        ${statCard('Expired', byState.EXPIRED.length)}
      </div>

      ${
        blank < 10
          ? `<div class="card card-xl" style="padding:22px;margin-bottom:28px;background:var(--sunbeam-500);max-width:560px;">
               <p style="margin:0;font-size:16px;line-height:1.6;font-weight:600;">
                 ${blank === 0 ? 'No blank bag tags left.' : `Only ${blank} blank bag tag${blank === 1 ? '' : 's'} left.`}
                 Print a sheet before the next round - a driver with no tag
                 cannot label a bag, an unlabelled bag cannot be scanned at the
                 door, and the laundromat has nothing to peel a sticker off.
               </p>
             </div>`
          : ''
      }

      <div class="card card-xl" style="padding:28px;max-width:560px;">
        ${sectionHeading('Print', 'A fresh sheet')}
        <form method="post" action="/ops/labels" style="margin:18px 0 0;">
          <label class="eyebrow" for="count" style="display:block;margin-bottom:8px;">How many</label>
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <input class="input input-lg" type="number" id="count" name="count"
                   min="1" max="300" step="6" value="30" required style="flex:1;">
            <button type="submit" class="btn btn-lg">Make them</button>
          </div>
          <span class="field-hint" style="display:block;margin-top:10px;">
            Six to a sheet on ${escapeHtml(LABEL_SHEET.stock)} shipping labels,
            which is ordinary stock sold everywhere. Print at 100% scale, not
            "fit to page".
          </span>
        </form>
      </div>

      <div class="card card-xl" style="padding:28px;margin-top:28px;">
        <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;justify-content:space-between;margin-bottom:14px;">
          ${sectionHeading('Every tag', filter ? LABEL_STATES[filter].label : 'All', showing.length)}
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a class="btn btn-sm ${filter ? 'btn-outline' : ''}" href="/ops/labels">All</a>
            ${['OUTSTANDING', 'IN_USE', 'EXPIRED']
              .map(
                (k) =>
                  `<a class="btn btn-sm ${filter === k ? '' : 'btn-outline'}" href="/ops/labels?state=${k}">${escapeHtml(
                    LABEL_STATES[k].label
                  )}</a>`
              )
              .join('')}
          </div>
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:16px 24px;margin-bottom:18px;">
          ${['OUTSTANDING', 'IN_USE', 'EXPIRED']
            .map(
              (k) => `
            <span style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-700);">
              <span style="width:12px;height:12px;border:2px solid var(--ink-900);border-radius:50%;
                           background:${LABEL_STATES[k].colour};"></span>
              ${escapeHtml(LABEL_STATES[k].blurb)}
            </span>`
            )
            .join('')}
        </div>

        ${
          showing.length
            ? showing.map(labelRow).join('')
            : `<p style="margin:0;font-size:15px;color:var(--ink-500);line-height:1.6;">
                 Nothing in that state.
               </p>`
        }
      </div>`;

    return res.type('html').send(
      adminPage({ title: 'Bag stickers', active: '/ops/labels', body, user: req.opsUser, openIssues: req.openIssues, serviceClosed: req.serviceClosed })
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
      title: 'Unit economics',
      active: '/ops/economics',
      body: runEconomicsBody(),
      user: req.opsUser,
      openIssues: req.openIssues, serviceClosed: req.serviceClosed,
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
      openIssues: req.openIssues, serviceClosed: req.serviceClosed,
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

// GET /ops/journey - one bag, doorstep to laundromat to doorstep.
//
// Sits beside /ops/process rather than inside it: that page is the system by
// perspective, this one is the physical sequence. src/web/journey.js explains
// which belongs where before either is edited.
router.get('/ops/journey', guard, withIssues, (req, res) => {
  res.type('html').send(
    adminPage({
      title: 'What happens to a bag',
      active: '/ops/journey',
      body: journeyBody(),
      user: req.opsUser,
      openIssues: req.openIssues, serviceClosed: req.serviceClosed,
    })
  );
});

router.get('/ops/process', guard, withIssues, (req, res) => {
  res.type('html').send(
    adminPage({
      title: 'How it all works',
      active: '/ops/process',
      // The page is built for the person reading it - a driver is never sent
      // the sections that are not his.
      body: processBody(req.opsUser),
      user: req.opsUser,
      openIssues: req.openIssues, serviceClosed: req.serviceClosed,
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
      ${sectionHeading('Issues', 'Open', open.length)}
      ${
        open.length
          ? open.map(card).join('')
          : '<p style="font-size:17px;color:var(--ink-500);margin-bottom:56px;">Nothing open. Everything a customer raised has been dealt with.</p>'
      }

      ${closed.length ? `<div style="margin-top:56px;">${sectionHeading('Dealt with', 'Resolved', closed.length)}${closed.map(card).join('')}</div>` : ''}
    `;

    res.type('html').send(
      adminPage({ title: 'Issues', active: '/ops/issues', body, user: req.opsUser, openIssues: req.openIssues, serviceClosed: req.serviceClosed })
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
      adminPage({ title: 'Conversations', active: '/ops/messages', body, user: req.opsUser, openIssues: req.openIssues, serviceClosed: req.serviceClosed })
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
          user: req.opsUser, openIssues: req.openIssues, serviceClosed: req.serviceClosed,
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
      adminPage({ title: heading, active: '/ops/messages', body, user: req.opsUser, openIssues: req.openIssues, serviceClosed: req.serviceClosed })
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// The partner directory
//
// Added by hand, unlike the enquiries below.
//
// The ":id" routes fall through on anything that is not a UUID. Without that,
// Express matches /ops/partners/enquiries against ":id" - it takes the first
// route that matches, not the most specific - and the leads page becomes a
// lookup for a partner called "enquiries". Guarding beats relying on the order
// these happen to be written in, because the next literal sub-path somebody
// adds will not come with a reminder.
// ---------------------------------------------------------------------------

// POST /ops/partners/send-overview - text a laundromat the explainer.
//
// Behind partners.manage rather than partners.view: this SENDS SOMETHING to a
// real phone, which is a different kind of act from reading a list, and a
// driver browsing partners should not be able to do it.
//
// The message is deliberately dull and short. It says who we are, what the
// link is, and stops - a first text to a business that never asked for one
// should read like a person, and anything longer reads like a blast.
router.post('/ops/partners/send-overview', guard, may('partners.manage'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const phone = normalisePhone(body.phone);

    if (!phone) {
      return res.redirect(
        303,
        `/ops/partners?problem=${encodeURIComponent(
          "That number did not look like a US mobile. Try it with the area code."
        )}`
      );
    }

    // Capped at 30, and the cap is about money rather than tidiness. SMS gives
    // you 160 characters per segment and carriers bill per segment, so a long
    // shop name pasted in here quietly doubles the cost of every one of these.
    // 30 fits every real laundromat name and keeps the whole message in one.
    const who = String(body.name || '').trim().slice(0, 30);

    // Plain ASCII, one link, on our own domain. notify.js cleans the text
    // anyway, but writing it plain here means what is sent is what was meant.
    //
    // Deliberately plain and short. A first text to a business that never
    // asked for one should read like a person sent it, and every extra clause
    // makes it read more like a blast.
    //
    // The greeting is written with a COMMA rather than a dash. notify.js
    // rewrites " - " to ", " on the way out - no dashes in a LYNDRY text,
    // deliberately - and writing the dash anyway left a capital "It's" sitting
    // mid-sentence after the comma it became.
    const message = who
      ? `Hi ${who}, it's ${site.name}. Check out how the process works: ${config.baseUrl}/for-laundromats`
      : `It's ${site.name}. Check out how the process works: ${config.baseUrl}/for-laundromats`;

    await notify.sendAndLog(phone, message, null);

    return res.redirect(
      303,
      `/ops/partners?note=${encodeURIComponent(`Overview sent to ${formatPhone(phone)}.`)}`
    );
  } catch (err) {
    return next(err);
  }
});

// ===========================================================================
// Pre-launch: the switch, promotions, and the text blast.
//
// All three behind service.manage, which is Admin only. Closing the business,
// giving money away and texting everybody at once are the three things a
// salesperson or a driver should never be able to do.
// ===========================================================================

router.get('/ops/settings', guard, withIssues, may('service.manage'), async (req, res, next) => {
  try {
    return res.type('html').send(
      adminPage({
        title: 'Are we taking orders?',
        active: '/ops/settings',
        body: settingsBody({
          settings: await settings.read({ fresh: true }),
          notice: req.query.note ? String(req.query.note).slice(0, 200) : null,
          problem: req.query.problem ? String(req.query.problem).slice(0, 200) : null,
        }),
        user: req.opsUser,
        openIssues: req.openIssues, serviceClosed: req.serviceClosed,
      })
    );
  } catch (err) {
    return next(err);
  }
});

router.post('/ops/settings/close', guard, may('service.manage'), async (req, res, next) => {
  try {
    const reason = String((req.body || {}).reason || '').trim();
    await settings.setTakingOrders(false, reason, req.opsUser && req.opsUser.id);
    return res.redirect(
      303,
      `/ops/settings?note=${encodeURIComponent('Closed. The AI will not book anything.')}`
    );
  } catch (err) {
    return next(err);
  }
});

router.post('/ops/settings/open', guard, may('service.manage'), async (req, res, next) => {
  try {
    await settings.setTakingOrders(true, null, req.opsUser && req.opsUser.id);
    return res.redirect(
      303,
      `/ops/settings?note=${encodeURIComponent('Open. Bookings are live again.')}`
    );
  } catch (err) {
    return next(err);
  }
});

// --- Promotions ------------------------------------------------------------

async function promoCounts() {
  const { data } = await db.from('customer_promotions').select('promotion_id, redeemed_at');
  const counts = {};
  for (const row of data || []) {
    const c = (counts[row.promotion_id] = counts[row.promotion_id] || { granted: 0, redeemed: 0 });
    c.granted += 1;
    if (row.redeemed_at) c.redeemed += 1;
  }
  return counts;
}

router.get('/ops/promotions', guard, withIssues, may('service.manage'), async (req, res, next) => {
  try {
    return res.type('html').send(
      adminPage({
        title: 'Promotions',
        active: '/ops/promotions',
        body: promotionsBody({
          list: await promotions.list({ includeEnded: true }),
          counts: await promoCounts(),
          notice: req.query.note ? String(req.query.note).slice(0, 200) : null,
          problem: req.query.problem ? String(req.query.problem).slice(0, 200) : null,
        }),
        user: req.opsUser,
        openIssues: req.openIssues, serviceClosed: req.serviceClosed,
      })
    );
  } catch (err) {
    return next(err);
  }
});

router.post('/ops/promotions', guard, may('service.manage'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim().slice(0, 60);
    const blurb = String(body.blurb || '').trim().slice(0, 200);
    const kind = body.kind === 'AMOUNT_OFF' ? 'AMOUNT_OFF' : 'PERCENT_OFF';
    const raw = Number(body.value);

    if (!name || !blurb || !Number.isFinite(raw) || raw <= 0) {
      return res.redirect(
        303,
        `/ops/promotions?problem=${encodeURIComponent('Needs a name, a sentence and an amount.')}`
      );
    }

    // Percent stays a whole number; dollars become whole cents. Money is never
    // stored as a decimal here, exactly as everywhere else.
    const value = kind === 'PERCENT_OFF' ? Math.round(raw) : Math.round(raw * 100);

    if (kind === 'PERCENT_OFF' && value > 100) {
      return res.redirect(
        303,
        `/ops/promotions?problem=${encodeURIComponent('Over 100% would pay them to send us laundry.')}`
      );
    }

    const autoGrant = body.auto_grant === 'yes';

    // ONLY ONE AUTO-GRANT AT A TIME. The unique index refuses a second, so the
    // old one is stood down first rather than the save failing with a database
    // error nobody can act on.
    if (autoGrant) {
      await db
        .from('promotions')
        .update({ auto_grant: false })
        .eq('auto_grant', true)
        .eq('status', 'ACTIVE');
    }

    const { error } = await db.from('promotions').insert({
      name,
      blurb,
      kind,
      value,
      applies_to: body.applies_to === 'EVERY_ORDER' ? 'EVERY_ORDER' : 'FIRST_ORDER',
      auto_grant: autoGrant,
      created_by: req.opsUser && req.opsUser.id,
    });

    if (error) throw error;

    return res.redirect(
      303,
      `/ops/promotions?note=${encodeURIComponent(
        `${name} is live${autoGrant ? ' and every new number gets it' : ''}.`
      )}`
    );
  } catch (err) {
    return next(err);
  }
});

router.post('/ops/promotions/:id/end', guard, may('service.manage'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return next();

    // Ending stops NEW grants. Anyone already holding it keeps it, which is
    // why customer_promotions is a separate table: a promise already made to a
    // person is not ours to withdraw quietly.
    const { error } = await db
      .from('promotions')
      .update({ status: 'ENDED', auto_grant: false })
      .eq('id', req.params.id);

    if (error) throw error;

    return res.redirect(
      303,
      `/ops/promotions?note=${encodeURIComponent('Ended. Anyone already holding it keeps it.')}`
    );
  } catch (err) {
    return next(err);
  }
});

// --- The text blast --------------------------------------------------------

// Who is in each group.
//
// UNSUBSCRIBED IS EXCLUDED IN THE QUERY, not filtered out afterwards, so a
// number that replied STOP never reaches the sending loop at all. That is the
// one rule here that is legally load-bearing.
async function audienceOf(key) {
  const { data: people, error } = await db
    .from('customers')
    .select('id, phone, status')
    .neq('status', 'UNSUBSCRIBED');

  if (error) throw error;

  const list = (people || []).filter((c) => c.phone);
  if (key === 'ALL') return list;

  const { data: orders } = await db.from('orders').select('customer_id');
  const ordered = new Set((orders || []).map((o) => o.customer_id));

  return key === 'CUSTOMERS'
    ? list.filter((c) => ordered.has(c.id))
    : list.filter((c) => !ordered.has(c.id));
}

router.get('/ops/broadcast', guard, withIssues, may('service.manage'), async (req, res, next) => {
  try {
    const counts = {};
    for (const a of AUDIENCES) counts[a.key] = (await audienceOf(a.key)).length;

    const { data: recent } = await db
      .from('broadcasts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(15);

    return res.type('html').send(
      adminPage({
        title: 'Send a text blast',
        active: '/ops/broadcast',
        body: broadcastBody({
          counts,
          recent: recent || [],
          notice: req.query.note ? String(req.query.note).slice(0, 300) : null,
          problem: req.query.problem ? String(req.query.problem).slice(0, 300) : null,
        }),
        user: req.opsUser,
        openIssues: req.openIssues, serviceClosed: req.serviceClosed,
      })
    );
  } catch (err) {
    return next(err);
  }
});

router.post('/ops/broadcast', guard, may('service.manage'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const text = String(body.body || '').trim().slice(0, 480);
    const key = AUDIENCES.some((a) => a.key === body.audience) ? body.audience : 'ALL';

    if (!text) {
      return res.redirect(303, `/ops/broadcast?problem=${encodeURIComponent('Nothing to send.')}`);
    }

    if (body.confirm !== 'yes') {
      return res.redirect(
        303,
        `/ops/broadcast?problem=${encodeURIComponent('Tick the box to confirm before sending.')}`
      );
    }

    const people = await audienceOf(key);

    if (!people.length) {
      return res.redirect(
        303,
        `/ops/broadcast?problem=${encodeURIComponent('Nobody is in that group.')}`
      );
    }

    let sent = 0;
    let skipped = 0;

    // ONE AT A TIME, on purpose. A hundred texts fired at once is a burst a
    // carrier reads as spam, and notify.js logs each one as it goes - so a
    // failure halfway through leaves an accurate record of who actually got it
    // rather than a count claiming everybody did.
    for (const person of people) {
      try {
        await notify.sendAndLog(person.phone, text, person.id);
        sent += 1;
      } catch (err) {
        skipped += 1;
        console.error(`Blast to ${person.phone} failed: ${err.message}`);
      }
    }

    await db.from('broadcasts').insert({
      body: text,
      audience: key,
      sent_count: sent,
      skipped_count: skipped,
      created_by: req.opsUser && req.opsUser.id,
    });

    return res.redirect(
      303,
      `/ops/broadcast?note=${encodeURIComponent(
        `Sent to ${sent} ${sent === 1 ? 'number' : 'numbers'}` +
          (skipped ? `, ${skipped} failed and are in the log.` : '.')
      )}`
    );
  } catch (err) {
    return next(err);
  }
});

router.get('/ops/partners', guard, withIssues, may('partners.view'), async (req, res, next) => {
  try {
    const list = await partners.list({ includeEnded: req.query.all === '1' });

    return res.type('html').send(
      adminPage({
        title: 'Partners',
        active: '/ops/partners',
        body: partnerListBody({
          list,
          notice: req.query.note ? String(req.query.note).slice(0, 200) : null,
          problem: req.query.problem ? String(req.query.problem).slice(0, 200) : null,
          baseUrl: config.baseUrl,
        }),
        user: req.opsUser,
        openIssues: req.openIssues, serviceClosed: req.serviceClosed,
      })
    );
  } catch (err) {
    return next(err);
  }
});

router.get('/ops/partners/new', guard, withIssues, may('partners.manage'), (req, res) => {
  res.type('html').send(
    adminPage({
      title: 'Add a partner',
      active: '/ops/partners',
      body: partnerFormBody({ problem: req.query.problem ? String(req.query.problem).slice(0, 200) : null }),
      user: req.opsUser,
      openIssues: req.openIssues, serviceClosed: req.serviceClosed,
    })
  );
});

router.post('/ops/partners', guard, may('partners.manage'), async (req, res, next) => {
  try {
    const result = await partners.create(req.body || {});

    if (!result.ok) {
      return res.redirect(303, `/ops/partners/new?problem=${encodeURIComponent(result.detail)}`);
    }

    // After the insert, because the hours rows need the partner's id. A
    // management company has no opening hours to route by, so it gets none.
    if (result.partner.type === 'LAUNDROMAT') {
      await partners.saveHours(result.partner.id, req.body || {});
    }

    return res.redirect(
      303,
      `/ops/partners/${result.partner.id}?note=${encodeURIComponent(`${result.partner.name} added.`)}`
    );
  } catch (err) {
    return next(err);
  }
});

router.get('/ops/partners/:id/edit', guard, withIssues, may('partners.manage'), async (req, res, next) => {
  try {
    // ":id" also matches a literal like /ops/partners/enquiries, and Express
    // takes the first route that matches. Falling through on anything that is
    // not a UUID means a sub-path added later cannot be silently swallowed by
    // this handler - which is exactly what happened to the enquiries page.
    if (!UUID.test(req.params.id)) return next();

    const partner = await partners.find(req.params.id);
    if (!partner) return notFoundPage(res, 'No partner with that id.');

    return res.type('html').send(
      adminPage({
        title: `Edit ${partner.name}`,
        active: '/ops/partners',
        body: partnerFormBody({
          partner,
          hours: await partners.hoursFor(partner.id),
          problem: req.query.problem ? String(req.query.problem).slice(0, 200) : null,
        }),
        user: req.opsUser,
        openIssues: req.openIssues, serviceClosed: req.serviceClosed,
      })
    );
  } catch (err) {
    return next(err);
  }
});

router.post('/ops/partners/:id', guard, may('partners.manage'), async (req, res, next) => {
  try {
    // ":id" also matches a literal like /ops/partners/enquiries, and Express
    // takes the first route that matches. Falling through on anything that is
    // not a UUID means a sub-path added later cannot be silently swallowed by
    // this handler - which is exactly what happened to the enquiries page.
    if (!UUID.test(req.params.id)) return next();

    const result = await partners.update(req.params.id, req.body || {});

    if (!result.ok) {
      return res.redirect(303, `/ops/partners/${req.params.id}/edit?problem=${encodeURIComponent(result.detail)}`);
    }

    // Switching a record to a management company clears the laundromat fields,
    // and the hours are one of them - a stale opening time on a landlord would
    // be read as real the same way a stale wholesale rate would. saveHours with
    // no time boxes filled in deletes the lot, which is exactly what is wanted.
    if (result.partner.type === 'LAUNDROMAT') {
      await partners.saveHours(req.params.id, req.body || {});
    } else {
      await partners.saveHours(req.params.id, {});
    }

    return res.redirect(303, `/ops/partners/${req.params.id}?note=${encodeURIComponent('Saved.')}`);
  } catch (err) {
    return next(err);
  }
});

router.get('/ops/partners/:id', guard, withIssues, may('partners.view'), async (req, res, next) => {
  try {
    // ":id" also matches a literal like /ops/partners/enquiries, and Express
    // takes the first route that matches. Falling through on anything that is
    // not a UUID means a sub-path added later cannot be silently swallowed by
    // this handler - which is exactly what happened to the enquiries page.
    if (!UUID.test(req.params.id)) return next();

    const partner = await partners.find(req.params.id);
    if (!partner) return notFoundPage(res, 'No partner with that id.');

    const history = await partners.weightHistory(partner.id);
    const hours = await partners.hoursFor(partner.id);

    // What is on their floor right now. One query across every partner, then
    // the one row we want - the same call the dispatch board makes, so the two
    // screens can never disagree about how full somebody is.
    const load = partners.capacityOf(partner, (await partners.loadByPartner()).get(partner.id));

    return res.type('html').send(
      adminPage({
        title: partner.name,
        active: '/ops/partners',
        body: partnerDetailBody({
          partner,
          history,
          hours,
          load,
          notice: req.query.note ? String(req.query.note).slice(0, 200) : null,
        }),
        user: req.opsUser,
        openIssues: req.openIssues, serviceClosed: req.serviceClosed,
      })
    );
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/partners/enquiries — leads from the website form
//
// Moved off /ops/partners when the real partner directory arrived. A stranger
// who filled in a web form and a laundromat we pay every week are not the same
// list, and having them on one screen buried the short important one inside
// the long unimportant one.
// ---------------------------------------------------------------------------

const PARTNER_LABEL = { LAUNDROMAT: 'Laundromat', PROPERTY: 'Property' };

router.get('/ops/partners/enquiries', guard, withIssues, may('partners.view'), async (req, res, next) => {
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

        <form method="post" action="/ops/partners/enquiries/${e.id}/status" style="display:flex;gap:10px;flex-wrap:wrap;margin:0;">
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

    res.type('html').send(adminPage({ title: 'Enquiries', active: '/ops/partners', body, user: req.opsUser, openIssues: req.openIssues, serviceClosed: req.serviceClosed }));
  } catch (err) {
    next(err);
  }
});

router.post('/ops/partners/enquiries/:id/status', guard, may('partners.manage'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return notFoundPage(res, 'That enquiry id is not valid.');

    const status = String((req.body || {}).status || '');
    if (!['NEW', 'CONTACTED', 'CLOSED'].includes(status)) {
      return notFoundPage(res, 'That is not a status an enquiry can have.');
    }

    const { error } = await db.from('partner_enquiries').update({ status }).eq('id', req.params.id);
    if (error) throw error;

    // Redirect rather than render, so a refresh doesn't resubmit.
    return res.redirect(303, '/ops/partners/enquiries');
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
      .select(
        'id, name, phone, status, role, drives, last_login_at, created_at, ' +
          'base_address_line1, base_address_line2, base_city, base_state, ' +
          'base_postal_code, base_lat, base_lng, base_geocode_failed'
      )
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Their rotas, in one query rather than one per person.
    const rota = await drivers.hoursForAll();

    // A LIST IS A LIST. Every control that used to be wedged into a row -
    // the role dropdown, the driving toggle, the switch-off button - now lives
    // on the person's own page, along with the two things nothing could edit at
    // all: their name and their number. One place, one save.
    const rows = (people || []).map((p) => {
      const isMe = p.id === req.opsUser.id;
      return [
        `<a href="/ops/team/${p.id}" style="font-weight:700;">${escapeHtml(p.name)}</a>${
          isMe ? ' <span style="color:var(--ink-400);">(you)</span>' : ''
        }`,
        escapeHtml(formatPhone(p.phone)),
        `<span class="badge" style="background:${ROLE_TONE[p.role]};">${escapeHtml(
          roles.labelFor(p.role)
        )}</span>`,
        p.status === 'ACTIVE'
          ? '<span class="badge" style="background:var(--suds-300);">ACTIVE</span>'
          : '<span class="badge">DISABLED</span>',
        // On the round, and when. The rota is what decides who gets a load, so
        // it belongs next to the badge rather than only on their own page.
        roles.can(p, 'orders.drive')
          ? '<span class="badge" style="background:var(--suds-300);">On the round</span>' +
            `<span style="display:block;margin-top:6px;font-size:13px;color:var(--ink-500);">${
              escapeHtml(drivers.describeHours(rota.get(p.id) || []))
            }</span>`
          : '<span style="color:var(--ink-400);">&mdash;</span>',
        roles.can(p, 'orders.drive')
          ? p.base_address_line1
            ? `${escapeHtml(p.base_city || p.base_address_line1)}${
                p.base_lat == null
                  ? p.base_geocode_failed
                    ? ' <span style="color:var(--stain-500);font-size:13px;">not on the map</span>'
                    : ' <span style="color:var(--ink-500);font-size:13px;">locating</span>'
                  : ''
              }`
            : '<span style="color:var(--ink-500);">service base</span>'
          : '<span style="color:var(--ink-400);">&mdash;</span>',
        p.last_login_at ? dateTime(p.last_login_at) : 'never',
        `<a class="btn btn-sm btn-outline" href="/ops/team/${p.id}">Edit</a>`,
      ];
    });

    const body = `
      ${sectionHeading('Who can sign in', 'Team', (people || []).length)}

      ${
        req.query.note
          ? `<div class="card card-xl" style="padding:18px 22px;margin-bottom:24px;background:var(--suds-100);">
               <p style="font-size:16px;margin:0;">${escapeHtml(String(req.query.note).slice(0, 300))}</p>
             </div>`
          : ''
      }
      ${
        req.query.based
          ? `<div class="card card-xl" style="padding:18px 22px;margin-bottom:24px;background:var(--suds-100);">
               <p style="font-size:16px;margin:0;">Base saved. Putting it on the map now - the
               route and the assignment start using it as soon as it lands.</p>
             </div>`
          : ''
      }
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

      ${table(['Name', 'Mobile', 'Role', 'Status', 'Driving', 'Home base', 'Last signed in', ''], rows)}

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

      </div>

      `;

    res.type('html').send(adminPage({ title: 'Team', active: '/ops/team', body, user: req.opsUser, openIssues: req.openIssues, serviceClosed: req.serviceClosed }));
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

// ---------------------------------------------------------------------------
// One person: GET /ops/team/:id, POST /ops/team/:id
//
// Everything about a person is edited here, in one form with one save. It
// replaced four separate routes - role, status, driving, home base - each of
// which was a control wedged into a table row, and none of which could edit the
// two things most likely to be wrong: their name and their number. A typo on
// either used to mean deleting the person and starting again, which loses the
// record of what they did.
// ---------------------------------------------------------------------------

router.get('/ops/team/:id', guard, withIssues, may('team.manage'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return next();

    const person = await drivers.find(req.params.id);
    if (!person) return notFoundPage(res, 'No such person.');

    // Whether they can be deleted at all. Somebody who has handled work cannot
    // be erased without blanking the record of who did it.
    const { count: orderCount } = await db
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('driver_id', person.id);

    return res.type('html').send(
      adminPage({
        title: person.name,
        active: '/ops/team',
        body: teamMemberBody({
          person: { ...person, orderCount: orderCount || 0 },
          isMe: person.id === req.opsUser.id,
          hours: await drivers.hoursFor(person.id),
          formatPhone,
          notice: req.query.note ? String(req.query.note).slice(0, 300) : null,
          problem: req.query.problem ? String(req.query.problem).slice(0, 300) : null,
        }),
        user: req.opsUser,
        openIssues: req.openIssues, serviceClosed: req.serviceClosed,
      })
    );
  } catch (err) {
    return next(err);
  }
});

// Erase somebody completely.
//
// Only ever possible when they have never been given an order. The ordinary
// answer to "they left" is switching them off, which keeps every record of what
// they did; this exists for the row added with a typo in the phone number, and
// it refuses anything else.
router.post('/ops/team/:id/delete', guard, may('team.manage'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return next();

    const person = await drivers.find(req.params.id);
    if (!person) return notFoundPage(res, 'No such person.');

    if (person.id === req.opsUser.id) {
      return res.redirect(
        303,
        `/ops/team/${person.id}?problem=${encodeURIComponent('You cannot delete yourself.')}`
      );
    }

    const { count } = await db
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('driver_id', person.id);

    if (count) {
      return res.redirect(
        303,
        `/ops/team/${person.id}?problem=${encodeURIComponent(
          `${person.name} has handled ${count} order${count === 1 ? '' : 's'}. ` +
            'Deleting them would leave that work with no record of who did it - switch them off instead.'
        )}`
      );
    }

    await db.from('ops_user_hours').delete().eq('ops_user_id', person.id);
    await db.from('vehicles').delete().eq('driver_id', person.id);
    await db.from('ops_login_codes').delete().eq('ops_user_id', person.id);
    await db.from('ops_users').delete().eq('id', person.id);

    return res.redirect(
      303,
      `/ops/team?note=${encodeURIComponent(`${person.name} deleted.`)}`
    );
  } catch (err) {
    return next(err);
  }
});

router.post('/ops/team/:id', guard, may('team.manage'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return next();

    const person = await drivers.find(req.params.id);
    if (!person) return notFoundPage(res, 'No such person.');

    const isMe = person.id === req.opsUser.id;
    const back = `/ops/team/${person.id}`;
    const body = req.body || {};
    const refuse = (why) => res.redirect(303, `${back}?problem=${encodeURIComponent(why)}`);

    const name = String(body.name || '').trim();
    if (!name) return refuse('They need a name.');

    const phone = normalisePhone(body.phone);
    if (!phone) return refuse('That does not look like a US mobile number.');

    // NEITHER OF THESE MAY BE DONE TO YOURSELF, and the form hides both - this
    // is the half that holds when somebody posts the form anyway. Changing your
    // own role out of team management, or switching yourself off, locks the
    // door behind you on a tool with no other way in.
    const role = !isMe && roles.ROLES[String(body.role || '')] ? String(body.role) : person.role;
    const status = isMe ? 'ACTIVE' : String(body.active) === 'yes' ? 'ACTIVE' : 'DISABLED';

    // Only an admin has a driving choice. A driver drives by role; sales never
    // does. Changing somebody INTO a driver clears the flag, so it cannot sit
    // set on a row where it means nothing.
    const drives = role === 'ADMIN' ? String(body.drives) === 'yes' : false;

    // Entered in dollars because that is how a wage is talked about, stored in
    // cents like every other money column here. Blank means "use the default",
    // which is different from zero.
    const wageText = String(body.wage_dollars_hour || '').trim();
    const wageNumber = wageText ? Number(wageText) : null;
    const wage_cents_hour =
      wageNumber != null && Number.isFinite(wageNumber) && wageNumber > 0
        ? Math.round(wageNumber * 100)
        : null;

    const row = { name, phone, role, status, drives, wage_cents_hour };

    const { error } = await db.from('ops_users').update(row).eq('id', person.id);

    if (error) {
      return refuse(
        /duplicate|unique/i.test(error.message)
          ? 'Someone is already set up with that number.'
          : error.message
      );
    }

    // The base is saved separately because it re-pins from scratch and that
    // costs a geocoder call. Only for somebody who is actually on the round -
    // there is nothing for a route to start from otherwise.
    const willDrive = roles.can({ ...person, role, drives }, 'orders.drive');
    if (willDrive) {
      await drivers.saveBase(person.id, body);
      await drivers.saveHours(person.id, body);
    }

    // WORK DOES NOT FOLLOW SOMEBODY OFF THE ROUND. An order still pointing at
    // a person who no longer drives appears on no board and gets collected by
    // nobody, which is the exact gap driver_id exists to close.
    let moved = 0;
    let stranded = 0;

    const wasDriving = roles.can(person, 'orders.drive');
    const stillActive = status === 'ACTIVE';

    if ((wasDriving && !willDrive) || !stillActive) {
      const { data: theirs } = await db
        .from('orders')
        .select('id, order_number, customers(*)')
        .eq('driver_id', person.id)
        .not('status', 'in', '(DELIVERED,CANCELED)');

      for (const order of theirs || []) {
        // Cleared first, so nearest() cannot hand it straight back to somebody
        // who is no longer in the pool.
        await db.from('orders').update({ driver_id: null }).eq('id', order.id);
        if (await drivers.assign({ ...order, driver_id: null })) moved += 1;
        else stranded += 1;
      }
    }

    const note =
      'Saved.' +
      (moved ? ` ${moved} order${moved === 1 ? '' : 's'} moved to another driver.` : '') +
      (stranded
        ? ` ${stranded} order${stranded === 1 ? '' : 's'} left with nobody - there is no other driver.`
        : '');

    return res.redirect(303, `${back}?note=${encodeURIComponent(note)}`);
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
