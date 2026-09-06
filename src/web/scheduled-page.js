'use strict';

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

function when(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

function onlyDay(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${iso}T12:00:00Z`));
}

const digitsOf = (phone) => String(phone || '').replace(/\D/g, '');

function card({ kind, tone, who, phone, goes, detail, extra, action }) {
  return `
  <div class="card" style="padding:18px 22px;margin-bottom:12px;">
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
        <div style="font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;">
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
                   background:${background};font-size:16px;font-weight:600;white-space:pre-wrap;">${escapeHtml(
          text
        )}</p>`
      : '';

  const live = followUps.filter((f) => !f.off && !f.paused);
  const held = followUps.filter((f) => f.off || f.paused);

  const followUpCard = (f) =>
    card({
      kind: 'Follow-up',
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
             )}">Read the conversation</a>
             ${
               f.paused
                 ? '<span style="font-size:14px;color:var(--ink-500);align-self:center;">The AI is switched off on this chat, so nothing is sent either way.</span>'
                 : `<form method="post" action="/ops/scheduled/follow-ups/${escapeHtml(
                     digitsOf(f.phone)
                   )}" style="margin:0;">
                      <input type="hidden" name="state" value="${f.off ? 'on' : 'off'}">
                      <button class="btn btn-sm ${f.off ? 'btn-ink' : 'btn-outline'}" type="submit">
                        ${f.off ? 'Chase them after all' : 'Do not chase this one'}
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
<p style="font-size:16px;line-height:1.6;color:var(--ink-700);max-width:64ch;margin:0 0 26px;">
  Every text queued to send without anybody pressing a button. Nothing here goes
  outside 8am to 9pm, and nothing on this page sends anything - it is a reading
  of what is already scheduled.
</p>

${strip(notice, 'var(--suds-300)')}
${strip(problem, 'var(--stain-100)')}

${
  !followUpsOn
    ? `<div class="card" style="padding:16px 20px;margin-bottom:24px;background:var(--sunbeam-500);">
         <p style="margin:0;font-size:16px;line-height:1.55;">
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
<p style="font-size:15px;color:var(--ink-700);margin:0 0 16px;max-width:64ch;">
  The AI asked something and nobody answered. It chases once, a day later, and
  then never again unless they reply. If somebody has said they will come back
  to you, switch theirs off.
</p>

${
  live.length
    ? live.map(followUpCard).join('')
    : `<div class="card" style="padding:18px 22px;margin-bottom:12px;">
         <p style="margin:0;font-size:16px;">Nobody is waiting on a chase.</p>
       </div>`
}

${
  held.length
    ? `<p class="eyebrow" style="margin:24px 0 12px;">Switched off</p>
       ${held.map(followUpCard).join('')}`
    : ''
}

<h2 style="font-family:var(--font-display);font-weight:800;font-size:24px;margin:34px 0 4px;">
  Pickup reminders
</h2>
<p style="font-size:15px;color:var(--ink-700);margin:0 0 16px;max-width:64ch;">
  Sent the evening before every pickup so the bag is actually out when the van
  arrives. There is no switch: the way to stop one is to move or cancel the
  pickup, which is a decision about the order rather than about a text.
</p>

${
  reminders.length
    ? reminders.map(reminderCard).join('')
    : `<div class="card" style="padding:18px 22px;">
         <p style="margin:0;font-size:16px;">No pickups are booked, so nothing to remind anybody about.</p>
       </div>`
}`;
}

module.exports = { scheduledBody };
