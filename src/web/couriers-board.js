'use strict';

const { displayDateTime } = require('../core/format');

// ---------------------------------------------------------------------------
// THE UBER SITUATION, ON ONE SCREEN.
//
// Neil, 25 September: "ad pages that help me see/mange the uber situation".
//
// WHAT THERE WAS INSTEAD: nothing. A courier leg is booked from the laundromat
// portal, a row goes into `courier_deliveries`, and the only way to know whether a
// car was coming was to query the database. A REFUSED booking was invisible - the
// order simply sat there looking unbooked - and a booked one reads `pending` for
// ever, because that is what Uber said at the moment it was booked and there is no
// webhook yet to tell us anything since.
//
// SO THE PAGE IS HONEST ABOUT BEING A SNAPSHOT, and carries the button that makes
// it current. Every row says when it was last asked, and "Ask Uber" re-reads that
// one delivery. Per row rather than a refresh-everything button on purpose: each
// one is a call to somebody else's service, and a page that fires thirty on load
// is a page that gets rate-limited on the day it matters.
//
// ADMIN ONLY, BEHIND `money.view`. Every row carries what a courier cost, and the
// two controls spend and unspend money at a vendor. A driver has no use for it.
//
// NO CUSTOMER NAME AND NO ADDRESS. The order number links to the order, which is
// where a person belongs. This screen is about the supplier, and keeping it that
// way means the one ops page about an outside company is not also a list of who
// lives where.
//
// EVERY CLASS ON IT EXISTS IN `ops.css`, WHICH THE FIRST DRAFT GOT WRONG. It used
// `ops-card`, `ops-quiet`, `ops-good`, `ops-bad` and `btn-danger`, none of which
// are real - the same mistake as the wash table rendering unstyled because `.kv`
// is scoped to `.console`. The live ones are `card card-xl`, `ops-note`
// with `--good`/`--bad`, `ops-table-wrap`, `ops-table`, `ops-empty` and `eyebrow`;
// anything else here is an inline style on a palette token.
// ---------------------------------------------------------------------------

const QUIET = 'color:var(--ink-500);';
const GOOD = 'color:var(--suds-500);font-weight:700;';
const BAD = 'color:var(--stain-500);font-weight:700;';

function esc(value) {
  return String(value == null ? '' : value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function money(cents) {
  return cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;
}

function quiet(text) {
  return `<span style="${QUIET}">${esc(text)}</span>`;
}

// --- what a status means, in words ------------------------------------------
//
// UBER'S OWN VOCABULARY, NOT OURS, and deliberately not translated into our order
// statuses. `pending` means Uber has the job and has not assigned a courier; it
// says nothing about our order, which is the distinction `courier-legs.js` is built
// around. Anything unrecognised is shown as Uber sent it rather than mapped to the
// nearest thing we know - a status we have not seen before is worth reading
// literally rather than guessing at.
const STATUS_WORDS = Object.freeze({
  pending: 'Uber has it, no courier yet',
  pickup: 'On the way to collect',
  pickup_complete: 'Bags collected',
  dropoff: 'On the way to drop off',
  delivered: 'Dropped off',
  canceled: 'Cancelled',
  cancelled: 'Cancelled',
  returned: 'Returned to sender',
});

// WRITTEN AS THE FINISHED ONES, so a status nobody has seen before counts as still
// out there - the safe direction for "is anything outstanding".
const FINISHED = Object.freeze(['delivered', 'canceled', 'cancelled', 'returned']);

function isLive(leg) {
  if (!leg || !leg.deliveryId) return false;
  return !FINISHED.includes(String(leg.status || '').toLowerCase());
}

function statusCell(leg) {
  if (!leg.deliveryId) {
    return (
      `<span style="${BAD}">Refused</span>` +
      (leg.refusedReason ? `<br><span style="${QUIET}">${esc(leg.refusedReason)}</span>` : '')
    );
  }

  const words = STATUS_WORDS[String(leg.status || '').toLowerCase()];

  return words
    ? `${esc(words)}<br><span style="${QUIET}">${esc(leg.status)}</span>`
    : `<span style="${QUIET}">${esc(leg.status || 'unknown')}</span>`;
}

function table(headings, rows) {
  if (!rows.length) return '<p class="ops-empty">Nothing here.</p>';

  return `
  <div class="ops-table-wrap">
    <table class="ops-table">
      <thead><tr>${headings.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  </div>`;
}

// --- is Uber even switched on, and is it the real one -----------------------
//
// THE FIRST QUESTION, AND NOTHING ANYWHERE ANSWERED IT. A development environment
// runs a courier that dispatches nobody, and the way you find that out today is
// that a booking succeeds and no car ever arrives. The driver's own name is shown
// rather than a tidy label, because `uber`, `uber-test` and `fake` are three
// different things and the difference is the whole point.
function healthCard({ courier, spendToday, legs }) {
  const live = legs.filter(isLive).length;
  const refused = legs.filter((l) => !l.deliveryId).length;

  // A collection leg with no code is a bag an attendant cannot verify at her
  // counter, which is the entire reason the PIN exists.
  const noPin = legs.filter((l) => l.leg === 'TO_PARTNER' && l.deliveryId && !l.pin).length;

  const rows = [
    ['Courier', `<code>${esc(courier.name)}</code>`],
    [
      'Sends a real car',
      courier.isFake
        ? `<span style="${BAD}">No. Nothing booked here reaches a driver.</span>`
        : `<span style="${GOOD}">Yes</span>`,
    ],
    ['Credentials', courier.configured ? 'Set' : `<span style="${BAD}">Missing</span>`],
    ['Still out there', String(live)],
    ['Refused', refused ? `<span style="${BAD}">${refused}</span>` : '0'],
    ['Collections with no code', noPin ? `<span style="${BAD}">${noPin}</span>` : '0'],
    ['Paid to couriers today', money(spendToday)],
  ];

  return `
<div class="card card-xl" style="padding:26px;margin-bottom:24px;">
  <p class="eyebrow" style="margin:0 0 6px;">The vendor</p>
  <h2 style="font-family:var(--font-display);font-weight:900;font-size:24px;margin:0 0 14px;">
    Uber Direct
  </h2>
  ${table(['', ''], rows.map(([k, v]) => [`<strong>${k}</strong>`, v]))}
</div>`;
}

// --- one leg ----------------------------------------------------------------

function legRow(leg) {
  const order = leg.orderNumber
    ? `<a href="/ops/orders/${esc(leg.orderNumber)}">#${esc(leg.orderNumber)}</a>`
    : quiet('no order');

  // WHICH DIRECTION, IN WORDS. `TO_PARTNER` and `TO_CUSTOMER` are the column
  // values and they read slowly: what you want at a glance is whether this is the
  // dirty laundry going out or the clean coming back.
  const direction =
    leg.leg === 'TO_PARTNER'
      ? 'Door &rarr; laundromat'
      : leg.leg === 'TO_CUSTOMER'
        ? 'Laundromat &rarr; door'
        : esc(leg.leg);

  // THE PIN IS ONLY EVER ON THE COLLECTION LEG, and its absence THERE is a problem
  // rather than a blank. On the return leg there is no PIN by design - Uber refuses
  // one on a leave-at-door delivery - so a dash is the right answer and a warning
  // would be noise on every second row.
  const pin =
    leg.leg === 'TO_PARTNER'
      ? leg.pin
        ? `<code style="font-size:18px;">${esc(leg.pin)}</code>`
        : `<span style="${BAD}">none</span>`
      : quiet('n/a');

  const links = [
    leg.trackingUrl ? `<a href="${esc(leg.trackingUrl)}" rel="noreferrer noopener">Track</a>` : null,
    leg.pickupPhotoUrl
      ? `<a href="${esc(leg.pickupPhotoUrl)}" rel="noreferrer noopener">collected</a>`
      : null,
    leg.dropoffPhotoUrl
      ? `<a href="${esc(leg.dropoffPhotoUrl)}" rel="noreferrer noopener">dropped</a>`
      : null,
  ].filter(Boolean);

  // ABSENT RATHER THAN DISABLED where they do not apply, which is the rule the
  // driver's screens already follow: a disabled button invites somebody to find
  // the way round it.
  const controls = leg.deliveryId
    ? `<form method="post" action="/ops/couriers/${esc(leg.id)}/refresh" style="display:inline;">
      <button class="btn btn-sm" type="submit">Ask Uber</button>
    </form>` +
      (isLive(leg)
        ? ` <form method="post" action="/ops/couriers/${esc(leg.id)}/cancel" style="display:inline;">
      <button class="btn btn-sm" type="submit">Call it off</button>
    </form>`
        : '')
    : quiet('nothing booked');

  return [
    order,
    direction,
    statusCell(leg),
    pin,
    money(leg.feeCents),
    // WHEN IT WAS LAST ASKED, not only when it was booked - that is what says how
    // much to trust the status beside it. A leg booked this morning and never
    // re-asked reads `pending` and is probably long delivered.
    `${esc(displayDateTime(leg.requestedAt))}<br>` +
      (leg.updatedAt
        ? `<span style="${QUIET}">asked ${esc(displayDateTime(leg.updatedAt))}</span>`
        : `<span style="${QUIET}">never asked since</span>`),
    links.join(' &middot; ') || '—',
    controls,
  ];
}

// --- the page ---------------------------------------------------------------

function couriersBody({ legs = [], courier, spendToday = 0, notice = null, problem = null } = {}) {
  const banner = notice
    ? `<div class="ops-note ops-note--good">${esc(notice)}</div>`
    : problem
      ? `<div class="ops-note ops-note--bad" role="alert">${esc(problem)}</div>`
      : '';

  return `
<p class="eyebrow" style="margin:0 0 8px;">Business</p>
<h1 style="margin:0 0 10px;font-size:40px;line-height:1.05;">Couriers</h1>
<p style="font-size:16px;line-height:1.6;color:var(--ink-700);max-width:62ch;margin:0 0 26px;">
  Every trip we have asked Uber for, in both directions, including the ones they
  turned down. Nothing here updates on its own.
</p>

${banner}
${healthCard({ courier, spendToday, legs })}

<div class="card card-xl" style="padding:26px;margin-bottom:24px;">
  <p class="eyebrow" style="margin:0 0 6px;">${esc(String(legs.length))} legs</p>
  <h2 style="font-family:var(--font-display);font-weight:900;font-size:24px;margin:0 0 10px;">
    Every courier leg
  </h2>
  <p style="font-size:15px;line-height:1.6;color:var(--ink-700);max-width:62ch;margin:0 0 18px;">
    Newest first. A status is whatever Uber last told us, which is the moment the leg
    was booked unless somebody has asked since. <strong>There is no webhook yet</strong>,
    so nothing arrives from Uber by itself.
  </p>
  ${table(
    ['Order', 'Direction', 'What Uber says', 'Code', 'Fee', 'Booked', 'Links', ''],
    legs.map(legRow)
  )}
</div>

<div class="card card-xl" style="padding:26px;">
  <p class="eyebrow" style="margin:0 0 6px;">Known gaps</p>
  <h2 style="font-family:var(--font-display);font-weight:900;font-size:24px;margin:0 0 12px;">
    What this screen cannot tell you
  </h2>
  <ul style="font-size:15px;line-height:1.7;color:var(--ink-700);max-width:62ch;margin:0;padding-left:20px;">
    <li><strong>Where a car actually is.</strong> Uber's own tracking link does that,
      per leg, and it is the only live view of a courier there is.</li>
    <li><strong>Whether a status is current.</strong> Until the webhook exists, a status
      is as fresh as the last time somebody pressed Ask Uber.</li>
    <li><strong>How far Uber will go.</strong> Their published bands stop at ten routed
      miles; CleanCloud's documentation says twenty from the store. Test mode quotes
      Fair Lawn to Los Angeles at $7.99, so it cannot settle it either.</li>
  </ul>
</div>`;
}

module.exports = { couriersBody, isLive, statusCell, STATUS_WORDS, FINISHED };
