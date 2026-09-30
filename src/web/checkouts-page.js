'use strict';
const format = require('../core/format');

// ---------------------------------------------------------------------------
// UNFINISHED ONLINE CHECKOUTS.
//
// Neil's ask, 14 September, made as part of the booking intent change: "I do
// not want unfinished online customers to disappear simply because they are no
// longer represented as orders."
//
// He is right that this needed saying. Before the change, somebody who reached
// the card step and stopped left a real order on the board badged AWAITING
// CARD - ugly, but visible, and visible is what made anybody ring them. No
// order is written now, so without this screen the warmest lead in the business
// would be a row in a table nobody opens.
//
// WHAT THIS IS NOT: a queue of things to fix. Nothing here is broken. Each row
// is a person who typed an address, chose a day and did not put a card in, and
// the only actions are human ones - ring them, or open the thread and write.
// There is deliberately no button that texts them from this page: the card
// chase already sends one message half an hour in, and a screen that lets
// somebody fire a second is how a person gets chased twice for the same thing.
//
// IT SHOWS THE DAY THEY WANTED, which is the whole reason to ring rather than
// text: "you were after Tuesday morning" is a conversation, and "your checkout
// is incomplete" is a dunning notice.
// ---------------------------------------------------------------------------

const { escapeHtml } = require('./layout');
const booking = require('../core/booking');
const bookingIntents = require('../core/booking-intents');

function when(intent) {
  const date = bookingIntents.firstDateFor(intent);
  if (!date) return 'Date not selected';

  // MM/DD/YYYY, not readableDate(). That one writes 'Monday 14 Sep', which is
  // right in a text message and wrong in a column - see src/core/format.js.
  const readable = format.displayDate(date, { empty: '' }) || date;
  const slot = booking.windowFor(date, intent.pickup_time || '');
  const window = slot
    ? booking.arrivalWindow({ pickup_window_start: slot.start, pickup_window_end: slot.end })
    : null;

  return [readable, window].filter(Boolean).join(', ');
}

// How long ago, in the roughest terms that are still useful. A person reading
// this wants "this morning" or "three days ago", not a timestamp.
function since(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 90) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function row(intent, { showNames }) {
  const customer = intent.customers || {};
  const digits = String(customer.phone || '').replace(/[^0-9+]/g, '');

  // WHY IT IS STILL OPEN, WHEN WE KNOW. blocked_reason is set when a card WAS
  // saved and the pickup was then refused on re-check - a different person to
  // ring, and a different thing to say, from somebody who never came back at
  // all. Saying "no payment method" about the first would be wrong.
  const stuck = intent.blocked_reason
    ? `<span class="badge" style="background:var(--sunbeam-500);">Pickup time required</span>`
    : `<span class="badge">No payment method</span>`;

  const chased = intent.card_link_sent_at
    ? '<span style="color:var(--ink-500);">Reminder sent</span>'
    : '<span style="color:var(--ink-500);">Reminder not sent</span>';

  return `
  <tr>
    <td>${showNames ? escapeHtml(customer.name || 'Not provided') : 'Customer'}</td>
    <td>${showNames && digits ? `<a href="tel:${escapeHtml(digits)}">${escapeHtml(format.displayPhone(customer.phone))}</a>` : '—'}</td>
    <td>${escapeHtml(customer.city || '—')}</td>
    <td style="padding:12px 14px;vertical-align:top;">${escapeHtml(when(intent))}</td>
    <td style="padding:12px 14px;vertical-align:top;">${stuck}${
      intent.blocked_reason
        ? `<div style="font-size:14px;color:var(--ink-500);margin-top:4px;">${escapeHtml(
            intent.blocked_reason
          )}</div>`
        : ''
    }</td>
    <td style="padding:12px 14px;vertical-align:top;white-space:nowrap;">
      ${escapeHtml(since(intent.created_at))}<br>
      <span style="font-size:14px;">${chased}</span>
    </td>
    <td style="padding:12px 14px;vertical-align:top;white-space:nowrap;">
      ${
        showNames && digits
          ? `<a class="btn btn-sm" href="/ops/messages/${encodeURIComponent(digits)}">View messages</a>`
          : ''
      }
    </td>
  </tr>`;
}

function checkoutsBody({ intents = [], showNames = true, minutes = 20 }) {
  return `
  <h1>Unfinished checkouts</h1>
  <p>People who started booking but have not completed it. These are not confirmed pickups. Open their messages to follow up without duplicating reminders.</p>
  ${!intents.length ? '<p role="status" class="ops-note">No unfinished checkouts.</p>' : `
  <div class="ops-table-wrap">
    <table class="ops-table">
      <thead><tr>
        <th>Customer</th><th>Phone</th><th>City</th><th>Requested pickup</th>
        <th>Status</th><th>Started</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${intents.map((i) => row(i, { showNames })).join('')}
      </tbody>
    </table>
  </div>`}`;
}

module.exports = { checkoutsBody, when, since };
