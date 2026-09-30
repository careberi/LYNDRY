'use strict';
const format = require('../core/format');

const { escapeHtml } = require('./layout');

// ---------------------------------------------------------------------------
// EVERYTHING THAT WILL TEXT A CUSTOMER WITHOUT ANYBODY PRESSING SEND.
//
// Neil's ask. Two things go out on their own - the AI chasing a question nobody
// answered, and the reminder that a pickup is tomorrow - and until now the only
// way to know one was coming was to open the conversation it belonged to.
//
// One list, in the order they will happen, with a way into each conversation
// and a switch for the chases. Nothing on this page sends anything; it is a
// reading of what is already queued, and the times come from the same functions
// the scheduler calls, so the list and the send cannot disagree.
//
// A REMINDER HAS NO SWITCH, on purpose. It goes because a van is coming to
// somebody's door tomorrow morning and they need the bag out; the way to stop
// it is to cancel or move the pickup, which is a decision about the order
// rather than about a text. A chase does have one - a customer who has said
// "I'll let you know" should not be chased, and that is a decision about the
// conversation.
// ---------------------------------------------------------------------------

// MM/DD/YYYY with the time beside it, through the one owner. Both of these
// used to build their own en-GB string with a weekday in it, which is a third
// shape of a date on a screen somebody opens straight after the board.
function when(date) {
  return date ? format.displayDateTime(date, { empty: '' }) : '';
}

// MIDDAY, NOT MIDNIGHT, and that has to stay. A date-only string pinned to
// T12:00:00Z survives the conversion to New Jersey without sliding onto the
// day before, which midnight does not.
function onlyDay(iso) {
  return iso ? format.displayDate(String(iso).slice(0, 10), { empty: '' }) : '';
}

const digitsOf = (phone) => String(phone || '').replace(/\D/g, '');

function card({ kind, tone, who, phone, goes, detail, extra, action }) {
  return `
  <div class="card" style="padding:16px;margin-bottom:12px;">
    <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;justify-content:space-between;">
      <div style="min-width:0;flex:1 1 300px;">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:6px;">
          <span class="badge" style="background:${tone};">${escapeHtml(kind)}</span>
          <a href="/ops/messages/${escapeHtml(digitsOf(phone))}" style="font-weight:700;font-size:17px;">
            ${escapeHtml(who)}
          </a>
          ${extra || ''}
        </div>
        <p style="margin:0;font-size:15px;line-height:1.55;color:var(--ink-700);">${detail}</p>
      </div>

      <div style="text-align:right;flex:none;">
        <div class="eyebrow" style="margin:0 0 4px;">Goes</div>
        <div style="font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;">
          ${escapeHtml(goes)}
        </div>
      </div>
    </div>
    ${action ? `<div style="margin-top:14px;padding-top:14px;border-top:2px solid var(--ink-100);">${action}</div>` : ''}
  </div>`;
}

function scheduledBody({ followUps, reminders, followUpsOn, canManage, notice, problem }) {
  const strip = (text, background) =>
    text
      ? `<p style="margin:0 0 18px;padding:13px 16px;border:2px solid var(--ink-900);border-radius:12px;
                   background:${background};font-size:13px;font-weight:600;white-space:pre-wrap;">${escapeHtml(
          text
        )}</p>`
      : '';

  const live = followUps.filter((f) => !f.off && !f.paused);
  const held = followUps.filter((f) => f.off || f.paused);

  const followUpCard = (f) =>
    card({
      kind: f.stage === 'early' ? 'Early nudge' : 'Follow-up',
      tone: f.off || f.paused ? 'var(--paper-200)' : 'var(--lilac-300)',
      who: f.name || f.phoneDisplay,
      phone: f.phone,
      goes: f.off || f.paused ? 'never' : when(f.dueAt),
      detail: `We said: <em>${escapeHtml(
        String(f.lastMessage || '').slice(0, 130)
      )}${String(f.lastMessage || '').length > 130 ? '&hellip;' : ''}</em>`,
      extra: f.paused
        ? '<span class="badge" style="background:var(--sunbeam-500);">AI off for this chat</span>'
        : f.off
        ? '<span class="badge">Chases off</span>'
        : '',
      action: canManage
        ? `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
             <a class="btn btn-outline btn-sm" href="/ops/messages/${escapeHtml(
               digitsOf(f.phone)
             )}">View messages</a>
             ${
               f.paused
                 ? '<span style="font-size:14px;color:var(--ink-500);align-self:center;">Automated replies are paused for this conversation.</span>'
                 : `<form method="post" action="/ops/scheduled/follow-ups/${escapeHtml(
                     digitsOf(f.phone)
                   )}" style="margin:0;">
                      <input type="hidden" name="state" value="${f.off ? 'on' : 'off'}">
                      <button class="btn btn-sm ${f.off ? 'btn-ink' : 'btn-outline'}" type="submit">
                        ${f.off ? 'Enable follow-up' : 'Disable follow-up'}
                      </button>
                    </form>`
             }
           </div>`
        : '',
    });

  const reminderCard = (r) =>
    card({
      kind: 'Pickup reminder',
      tone: 'var(--suds-300)',
      who: (r.customer && r.customer.name) || r.phoneDisplay,
      phone: r.phone,
      goes: `${onlyDay(r.goesOn)} evening`,
      detail: `Order #${r.order.order_number}, ${escapeHtml(onlyDay(r.order.pickup_date))}${
        r.window ? ` ${escapeHtml(r.window)}` : ''
      }. They get "have the bag out".`,
      action: `<a class="btn btn-outline btn-sm" href="/ops/orders/${r.order.order_number}">Open order #${r.order.order_number}</a>`,
    });

  return `
<p class="eyebrow" style="margin:0 0 8px;">Admin</p>
<h1 style="margin:0 0 10px;font-size:40px;line-height:1.05;">Customer follow-up</h1>


${strip(notice, 'var(--suds-300)')}
${strip(problem, 'var(--stain-100)')}

${
  !followUpsOn
    ? `<div class="ops-note ops-note--warn">
         <p class="ops-note__body">
           <strong>Follow-ups are switched off for the whole business.</strong>
           Nothing below will be chased until they are turned back on from
           <a href="/ops/settings">Taking orders?</a>.
         </p>
       </div>`
    : ''
}

<h2 style="font-family:var(--font-display);font-weight:800;font-size:24px;margin:0 0 4px;">
  Follow-ups
</h2>


${
  live.length
    ? live.map(followUpCard).join('')
    : `<div class="card" style="padding:16px;margin-bottom:12px;">
         <p style="margin:0;font-size:13px;">No follow-ups scheduled. Eligible conversations will appear here when a follow-up is due.</p>
       </div>`
}

${
  held.length
    ? `<p class="eyebrow" style="margin:24px 0 12px;">Disabled</p>
       ${held.map(followUpCard).join('')}`
    : ''
}

<h2 style="font-family:var(--font-display);font-weight:800;font-size:24px;margin:34px 0 4px;">
  Pickup reminders
</h2>


${
  reminders.length
    ? reminders.map(reminderCard).join('')
    : `<div class="card" style="padding:16px;">
         <p style="margin:0;font-size:13px;">No pickup reminders scheduled. Confirmed pickups appear here when their reminder is queued.</p>
       </div>`
}`;
}

module.exports = { scheduledBody };
