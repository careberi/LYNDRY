'use strict';

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
  if (!date) return 'No day chosen';

  const readable = booking.readableDate(date) || date;
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
    ? `<span class="badge" style="background:var(--sunbeam-500);">Card saved, needs a new time</span>`
    : `<span class="badge">No payment method</span>`;

  const chased = intent.card_link_sent_at
    ? '<span style="color:var(--ink-500);">texted</span>'
    : '<span style="color:var(--ink-500);">not texted</span>';

  return `
  <tr>
    <td style="padding:12px 14px;vertical-align:top;">
      <div style="font-weight:700;">${
        showNames ? escapeHtml(customer.name || 'No name yet') : 'Customer'
      }</div>
      ${
        showNames && digits
          ? `<div style="font-size:14px;"><a href="tel:${escapeHtml(digits)}">${escapeHtml(
              customer.phone
            )}</a></div>`
          : ''
      }
      ${
        customer.city
          ? `<div style="font-size:14px;color:var(--ink-500);">${escapeHtml(customer.city)}</div>`
          : ''
      }
    </td>
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
          ? `<a class="btn btn-sm" href="/ops/messages/${encodeURIComponent(digits)}">Thread</a>`
          : ''
      }
    </td>
  </tr>`;
}

function checkoutsBody({ intents = [], showNames = true, minutes = 20 }) {
  if (!intents.length) {
    return `
  <div class="card card-xl" style="padding:26px 30px;">
    <p class="eyebrow" style="margin:0 0 8px;">Unfinished checkouts</p>
    <p style="font-size:17px;line-height:1.5;margin:0;">
      Nobody is stalled. Everyone who started an order online in the last while
      either finished it or has only just begun.
    </p>
  </div>`;
  }

  return `
  <div class="card card-xl" style="padding:26px 30px;margin-bottom:26px;">
    <p class="eyebrow" style="margin:0 0 8px;">Unfinished checkouts</p>
    <p style="font-size:17px;line-height:1.5;margin:0 0 6px;">
      ${intents.length} ${intents.length === 1 ? 'person' : 'people'} chose a day
      and did not finish adding a payment method.
    </p>
    <p style="font-size:15px;line-height:1.55;color:var(--ink-500);margin:0;">
      No order exists for these, so they are not on the board and no driver is
      going. They keep everything they typed - if they come back, they carry on
      where they stopped. Anything started in the last ${minutes} minutes is left
      off, because somebody may still be typing.
    </p>
  </div>

  <div class="card card-xl" style="padding:0;overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:16px;">
      <thead>
        <tr style="text-align:left;border-bottom:2px solid var(--ink-900);">
          <th style="padding:12px 14px;">Who</th>
          <th style="padding:12px 14px;">Wanted</th>
          <th style="padding:12px 14px;">Stuck on</th>
          <th style="padding:12px 14px;">Since</th>
          <th style="padding:12px 14px;"></th>
        </tr>
      </thead>
      <tbody>
        ${intents.map((i) => row(i, { showNames })).join('')}
      </tbody>
    </table>
  </div>`;
}

module.exports = { checkoutsBody, when, since };
