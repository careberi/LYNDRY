'use strict';

const { escapeHtml } = require('./layout');
const partners = require('../core/partners');
const format = require('../core/format');
const pitchLink = require('../core/pitch-link');

// ---------------------------------------------------------------------------
// The partner directory: /ops/partners
//
// The businesses we actually work with, entered by hand. The website enquiry
// form moved to /ops/partners/enquiries - a stranger who filled in a web form
// and a laundromat we pay every week are not the same list, and having them on
// one screen made the short important one hard to find inside the long one.
// ---------------------------------------------------------------------------

const money = (cents) => (cents == null ? null : `$${(cents / 100).toFixed(2)}`);

function typeBadge(type) {
  const laundromat = type === 'LAUNDROMAT';
  return `<span class="badge" style="background:${
    laundromat ? 'var(--sunbeam-500)' : 'var(--lilac-500)'
  };">${escapeHtml(partners.TYPES[type] || type)}</span>`;
}

function statusBadge(status) {
  if (status === 'ACTIVE') return '';
  return `<span class="badge" style="background:${
    status === 'PAUSED' ? 'var(--paper-300)' : 'var(--ink-200)'
  };">${escapeHtml(partners.STATUSES[status] || status)}</span>`;
}

function addressOf(p) {
  return [p.address_line1, p.address_line2, p.city, p.state, p.postal_code]
    .filter(Boolean)
    .join(', ');
}

// --- The list ---------------------------------------------------------------

function partnerRow(p) {
  const laundromat = p.type === 'LAUNDROMAT';

  // The margin per pound, which is the number the whole relationship turns on.
  // Only shown when both halves are known; a margin computed against a missing
  // rate is a made-up number.
  const margin =
    laundromat && p.wholesale_per_lb_cents != null
      ? `<span class="num">${escapeHtml(money(p.wholesale_per_lb_cents))}/lb</span> wholesale`
      : '<span style="color:var(--ink-500);">no rate agreed</span>';

  return `
  <a href="/ops/partners/${p.id}" class="card card-xl"
     style="display:block;padding:24px;margin-bottom:16px;text-decoration:none;color:inherit;">
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;margin-bottom:8px;">
      <span style="font-family:var(--font-display);font-weight:900;font-size:22px;">
        ${escapeHtml(p.name)}
      </span>
      ${typeBadge(p.type)}
      ${statusBadge(p.status)}
    </div>
    <div style="font-size:15px;color:var(--ink-700);">${escapeHtml(addressOf(p) || 'No address')}</div>
    <div style="font-family:var(--font-mono);font-size:13px;color:var(--ink-500);margin-top:8px;">
      ${margin}${
        laundromat && p.daily_capacity_lb ? ` &middot; ${p.daily_capacity_lb} lb a day` : ''
      }${p.hours ? ` &middot; ${escapeHtml(p.hours)}` : ''}
    </div>
  </a>`;
}

function partnerListBody({ list, notice, problem = null, baseUrl = '' }) {
  const laundromats = list.filter((p) => p.type === 'LAUNDROMAT');
  const managers = list.filter((p) => p.type === 'PROPERTY_MANAGER');

  const group = (title, rows) =>
    rows.length
      ? `<h2 style="font-family:var(--font-display);font-weight:900;font-size:26px;margin:34px 0 16px;">
           ${escapeHtml(title)}
         </h2>${rows.map(partnerRow).join('')}`
      : '';

  return `
<div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-end;justify-content:space-between;margin-bottom:8px;">
  <div>
    <p class="eyebrow" style="margin:0 0 8px;">Who we work with</p>
    <h1 style="margin:0;font-size:40px;line-height:1.05;">Partners</h1>
  </div>
  <div style="display:flex;gap:12px;flex-wrap:wrap;">
    <a class="btn btn-outline" href="/ops/partners/enquiries">Enquiries</a>
    <a class="btn" href="/ops/partners/new">Add a partner</a>
  </div>
</div>

${
  notice
    ? `<p class="ops-note ops-note--good" style="margin-top:20px;">${escapeHtml(notice)}</p>`
    : ''
}
${
  problem
    ? `<p role="alert" class="ops-note ops-note--bad" style="margin-top:20px;">${escapeHtml(problem)}</p>`
    : ''
}

<!-- Sending somebody the overview.
     A text rather than an email because that is what actually gets read by
     somebody standing behind a counter, and because we already have a number
     for most of them written on a scrap of paper. The link is on our own
     domain - never a shortener - for the same reason every other link we send
     is: carriers score a texted link partly by its domain. -->
<div class="card card-xl" style="padding:26px;margin-top:26px;">
  <p class="eyebrow" style="margin:0 0 10px;">Send the overview</p>
  <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:0 0 18px;max-width:64ch;">
    Texts a laundromat a link to the page explaining how working with us
    works - what their part is, what we handle, and the questions they
    always ask. No prices on it, because none are agreed.
  </p>
  <form method="post" action="/ops/partners/send-overview"
        style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
    <div style="flex:1 1 240px;min-width:0;">
      <label class="field-label" for="ov_phone">Their mobile number</label>
      <input class="field" id="ov_phone" name="phone" type="tel" inputmode="tel"
             autocomplete="off" placeholder="201-555-0134" required>
    </div>
    <div style="flex:1 1 200px;min-width:0;">
      <label class="field-label" for="ov_name">Who they are <span style="font-weight:400;color:var(--ink-500);">(optional)</span></label>
      <input class="field" id="ov_name" name="name" type="text" autocomplete="off"
             maxlength="60" placeholder="Cedar Lane Launderette">
    </div>
    <button class="btn btn-ink btn-lg" type="submit">Send it</button>
  </form>
  <p class="field-hint" style="margin-top:12px;">
    Goes out from our own number and is logged in the conversation like any
    other message. <strong>The link is good for ${pitchLink.lifetimeMs() / 60000} minutes</strong>
    and is made fresh each time you press this - so send it to somebody who is
    going to look now, and send another if they did not. There is no address to
    copy: the page does not open without a link we sent - so to read it
    yourself, send it to your own number.
  </p>
</div>

<p style="font-size:16px;line-height:1.6;color:var(--ink-700);max-width:60ch;margin:14px 0 0;">
  Added by hand. This is the short list of places we have a relationship with,
  not the pile of people who filled in the website form - those are under
  Enquiries.
</p>

${
  list.length
    ? group('Laundromats', laundromats) + group('Management companies', managers)
    : `<div class="card card-xl" style="padding:28px;margin-top:28px;">
         <p style="margin:0;font-size:16px;color:var(--ink-500);line-height:1.6;">
           Nobody yet. Add the first one above.
         </p>
       </div>`
}`;
}

// --- The form ---------------------------------------------------------------

function field({ name, label, value = '', hint = '', type = 'text', attrs = '' }) {
  return `
  <div style="margin-bottom:18px;">
    <label class="field-label" for="${name}">${escapeHtml(label)}</label>
    <input class="input input-lg" type="${type}" id="${name}" name="${name}"
           value="${escapeHtml(value == null ? '' : value)}" ${attrs} style="width:100%;">
    ${hint ? `<span class="field-hint" style="display:block;margin-top:6px;">${escapeHtml(hint)}</span>` : ''}
  </div>`;
}

// The week, as fourteen time boxes.
//
// A DAY LEFT BLANK IS CLOSED, and the form says so out loud - that is the one
// thing about this grid somebody could get wrong by leaving it alone, and the
// consequence is a van sent to a shut door.
//
// The second pair on each row is for a laundromat that shuts at lunch. It is
// deliberately quieter than the first: most places have one shift and a form
// that presents two equal pairs makes the common case look unfinished.
function hoursGrid(rows) {
  const at = (day, n) => {
    const forDay = (rows || []).filter((r) => Number(r.weekday) === day);
    return forDay[n] || null;
  };

  const box = (name, value) =>
    `<input class="input" type="time" name="${name}" value="${value ? escapeHtml(String(value).slice(0, 5)) : ''}"
            style="width:100%;min-width:0;">`;

  const row = (day) => {
    const first = at(day, 0);
    const second = at(day, 1);
    return `
    <div class="ph-row">
      <span class="ph-day">${escapeHtml(partners.WEEKDAYS[day])}</span>
      <div class="ph-pair">
        ${box(`hours_${day}_open`, first && first.opens_at)}
        <span class="ph-dash">to</span>
        ${box(`hours_${day}_close`, first && first.closes_at)}
      </div>
      <div class="ph-pair ph-second">
        ${box(`hours_${day}_open_2`, second && second.opens_at)}
        <span class="ph-dash">to</span>
        ${box(`hours_${day}_close_2`, second && second.closes_at)}
      </div>
    </div>`;
  };

  // Monday first, the way hours are written on a door. Sunday is 0 in the
  // database because that is what JavaScript's getDay() returns, so it lives at
  // the end of this list rather than the start.
  const order = [1, 2, 3, 4, 5, 6, 0];

  return `
    <style>
      .ph-grid { display:flex; flex-direction:column; gap:10px; margin:0 0 8px; }
      .ph-row { display:grid; grid-template-columns:74px minmax(0,1fr) minmax(0,1fr); gap:12px; align-items:center; }
      .ph-row > * { min-width:0; }
      .ph-day { font-family:var(--font-mono); font-size:12px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; }
      .ph-pair { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); gap:8px; align-items:center; }
      .ph-dash { font-size:13px; color:var(--ink-500); }
      .ph-second { opacity:0.65; }
      .ph-second:focus-within { opacity:1; }
      .ph-head { display:grid; grid-template-columns:74px minmax(0,1fr) minmax(0,1fr); gap:12px; margin:0 0 4px; }
      .ph-head span { font-family:var(--font-mono); font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink-500); }
      /* An inline grid-template-columns would beat this media query and the
         rows would refuse to stack, which is the rule the whole stylesheet
         follows - ratios are classes, never inline styles. */
      @media (max-width: 640px) {
        .ph-head { display:none; }
        .ph-row { grid-template-columns:1fr; gap:8px; padding-bottom:12px; border-bottom:1px solid var(--ink-100); }
        .ph-second { opacity:1; }
      }
    </style>

    <label class="field-label">Opening hours</label>
    <p style="font-size:14px;color:var(--ink-500);line-height:1.5;margin:0 0 14px;">
      <strong>A day left blank is closed</strong>, and the dispatch board will
      not send a bag there. The second pair is only for somewhere that shuts in
      the middle of the day.
    </p>

    <div class="ph-head">
      <span></span><span>Open</span><span>And again</span>
    </div>
    <div class="ph-grid">
      ${order.map(row).join('')}
    </div>`;
}

function partnerFormBody({ partner = null, hours = [], problem = null }) {
  const p = partner || {};
  const editing = Boolean(partner);
  const laundromat = (p.type || 'LAUNDROMAT') === 'LAUNDROMAT';

  const option = (value, label, selected) =>
    `<option value="${value}"${selected === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;

  return `
<style>
  /* A class, never an inline grid-template-columns - an inline style beats the
     media query and the form then refuses to collapse on a phone. */
  .pt-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
  @media (max-width: 640px) { .pt-two { grid-template-columns: minmax(0, 1fr); } }
</style>

<div style="max-width:640px;">
  <a href="/ops/partners" style="font-size:15px;font-weight:600;">&larr; All partners</a>

  <h1 style="margin:18px 0 8px;font-size:38px;line-height:1.05;">
    ${editing ? escapeHtml(p.name) : 'Add a partner'}
  </h1>
  <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:0 0 28px;">
    ${
      editing
        ? 'Changing the address looks the location up again.'
        : 'A laundromat is somewhere we pay to wash bags. A management company sends us customers.'
    }
  </p>

  ${
    problem
      ? `<p role="alert" class="ops-note ops-note--bad">${escapeHtml(problem)}</p>`
      : ''
  }

  <form method="post" action="${editing ? `/ops/partners/${p.id}` : '/ops/partners'}">

    <div class="card card-xl" style="padding:26px;margin-bottom:24px;">
      <div style="margin-bottom:18px;">
        <label class="field-label" for="type">What kind</label>
        <select class="input input-lg" id="type" name="type" style="width:100%;">
          ${option('LAUNDROMAT', partners.TYPES.LAUNDROMAT, p.type || 'LAUNDROMAT')}
          ${option('PROPERTY_MANAGER', partners.TYPES.PROPERTY_MANAGER, p.type)}
        </select>
        <span class="field-hint" style="display:block;margin-top:6px;">
          The rate, hours and capacity below only apply to a laundromat, and are
          cleared if you switch this to a management company.
        </span>
      </div>

      ${field({ name: 'name', label: 'Name', value: p.name, attrs: 'required autofocus' })}

      <div style="margin-bottom:18px;">
        <label class="field-label" for="status">Status</label>
        <select class="input input-lg" id="status" name="status" style="width:100%;">
          ${option('ACTIVE', partners.STATUSES.ACTIVE, p.status || 'ACTIVE')}
          ${option('PAUSED', partners.STATUSES.PAUSED, p.status)}
          ${option('ENDED', partners.STATUSES.ENDED, p.status)}
        </select>
        <span class="field-hint" style="display:block;margin-top:6px;">
          Only an active laundromat can be picked when dropping a bag off.
        </span>
      </div>
    </div>

    <div class="card card-xl" style="padding:26px;margin-bottom:24px;">
      <p class="eyebrow" style="margin:0 0 18px;">Where</p>
      ${field({ name: 'address_line1', label: 'Street', value: p.address_line1 })}
      ${field({ name: 'address_line2', label: 'Unit or suite', value: p.address_line2 })}
      <div class="pt-two">
        ${field({ name: 'city', label: 'Town', value: p.city })}
        ${field({ name: 'state', label: 'State', value: p.state, attrs: 'maxlength="2" placeholder="NJ"' })}
      </div>
      ${field({ name: 'postal_code', label: 'Zip', value: p.postal_code })}
    </div>

    <div class="card card-xl" style="padding:26px;margin-bottom:24px;">
      <p class="eyebrow" style="margin:0 0 18px;">Who to ring</p>
      ${field({ name: 'contact_name', label: 'Contact', value: p.contact_name })}
      <div class="pt-two">
        ${field({ name: 'phone', label: 'Phone', value: p.phone, type: 'tel' })}
        ${field({ name: 'email', label: 'Email', value: p.email, type: 'email' })}
      </div>
    </div>

    <div class="card card-xl" style="padding:26px;margin-bottom:24px;${
      laundromat ? '' : 'opacity:0.6;'
    }">
      <p class="eyebrow" style="margin:0 0 6px;">Laundromat only</p>
      <p style="font-size:14px;color:var(--ink-500);line-height:1.5;margin:0 0 18px;">
        Left blank is fine. Nothing here is invented for you - a rate you have
        not agreed should stay empty rather than be guessed at.
      </p>

      ${hoursGrid(hours)}

      ${field({
        name: 'hours',
        label: 'Anything else about their hours',
        value: p.hours,
        hint: 'A note for a person, not for the routing. "Call ahead on Sundays", "shuts early on holidays".',
      })}

      <div class="pt-two">
        ${field({
          name: 'wholesale_per_lb',
          label: 'What they charge us, per lb',
          value: p.wholesale_per_lb_cents == null ? '' : (p.wholesale_per_lb_cents / 100).toFixed(2),
          type: 'number',
          attrs: 'step="0.01" min="0" placeholder="1.10"',
        })}
        ${field({
          name: 'retail_per_lb',
          label: 'What they charge walk-ins, per lb',
          value: p.retail_per_lb_cents == null ? '' : (p.retail_per_lb_cents / 100).toFixed(2),
          type: 'number',
          attrs: 'step="0.01" min="0" placeholder="1.75"',
        })}
      </div>

      ${field({
        name: 'daily_capacity_lb',
        label: 'Most they can take in a day, in lb',
        value: p.daily_capacity_lb,
        type: 'number',
        attrs: 'step="1" min="1" placeholder="400"',
      })}

      <div class="pt-two">
        ${field({
          name: 'turnaround_hours',
          label: 'How long they take, in hours',
          value: p.turnaround_minutes == null ? '' : Math.round(p.turnaround_minutes / 60),
          type: 'number',
          attrs: 'step="1" min="1" max="168" placeholder="12"',
          hint: 'Drop-off to ready. Somewhere cheap that takes 36 hours breaks the next-day promise, so routing will not send bags there.',
        })}
        ${field({
          name: 'dropoff_cutoff',
          label: 'Latest they will take work',
          value: p.dropoff_cutoff ? String(p.dropoff_cutoff).slice(0, 5) : '',
          type: 'time',
          hint: "Arrive after this and it is tomorrow's wash, whatever time they close.",
        })}
      </div>

      <!-- HOW THE MONEY GOES BACK THE OTHER WAY. Everything above is what a
           wash costs; this is how often they bill us for it and how long we
           have to pay. Per partner, because it is agreed with each one
           separately - a second laundromat need not want the first one's
           cycle. -->
      <div class="pt-two">
        <label class="field">
          <span class="field-label">How often they invoice us</span>
          <select class="select" name="billing_period">
            ${[
              ['DAILY', 'Every day'],
              ['WEEKLY', 'Weekly'],
              ['BIWEEKLY', 'Every two weeks'],
              ['MONTHLY', 'Monthly'],
            ]
              .map(
                ([value, label]) =>
                  `<option value="${value}"${
                    (p.billing_period || 'BIWEEKLY') === value ? ' selected' : ''
                  }>${label}</option>`
              )
              .join('')}
          </select>
        </label>
        ${field({
          name: 'payment_terms_days',
          label: 'Days we have to pay',
          value: p.payment_terms_days == null ? 15 : p.payment_terms_days,
          type: 'number',
          attrs: 'step="1" min="0" max="120" placeholder="15"',
          hint: 'From their invoice to our payment.',
        })}
      </div>
    </div>

    <div class="card card-xl" style="padding:26px;margin-bottom:24px;">
      <label class="field-label" for="notes">Notes</label>
      <textarea class="input" id="notes" name="notes" rows="4"
                style="width:100%;padding:12px;">${escapeHtml(p.notes || '')}</textarea>
    </div>

    <button type="submit" class="btn btn-lg btn-full">
      ${editing ? 'Save changes' : 'Add this partner'}
    </button>
  </form>
</div>`;
}

// --- One partner, with the scale history ------------------------------------

// WHAT IS ON THEIR FLOOR RIGHT NOW, against what they said they can take.
//
// Bags dropped off but not yet weighed are counted separately rather than as
// zero pounds: a laundromat holding four unweighed bags is not empty, and a
// figure that quietly says it is would send them a fifth.
function loadLine(load) {
  if (!load || !load.bags) return '<span style="color:var(--ink-500);">nothing</span>';

  const parts = [`<strong>${load.used.toFixed(1)} lb</strong>`, `${load.bags} bag${load.bags === 1 ? '' : 's'}`];
  if (load.unweighed) parts.push(`${load.unweighed} not weighed yet`);

  const tone = load.full ? 'var(--stain-500)' : load.fraction != null && load.fraction > 0.8 ? 'var(--sunbeam-500)' : null;
  const room =
    load.capacity == null
      ? '<span style="color:var(--ink-500);">no capacity set</span>'
      : load.full
        ? '<span style="color:var(--stain-500);font-weight:700;">full</span>'
        : `${load.remaining.toFixed(0)} lb of room left`;

  return `${parts.join(' &middot; ')}<br>
    <span style="font-size:14px;${tone ? `color:${tone};` : 'color:var(--ink-500);'}">${room}</span>`;
}

// ---------------------------------------------------------------------------
// THE SHOP'S OWN PORTAL, AND WHO CAN SIGN IN TO IT.
//
// Neil, 26 September. Until this the portal existed, every laundromat had a URL,
// and the only way to give anybody access was `npm run shop:user` in a terminal -
// so the screen listing laundromats could not say where a shop's portal was or who
// could open it.
//
// "THE ABILITY TO SIGN INTO IT AS WELL" NEEDS NO NEW MECHANISM, and saying so on
// the page is better than building one. Neil adds HIMSELF as an owner with his own
// number and signs in at the shop's URL like anybody else - as himself, with
// everything he does attributed to him. An impersonation feature would put his
// actions in an attendant's name, which is the one thing a staff list prevents.
//
// ONLY OPS MAY NAME AN OWNER. The portal's own Staff page cannot pass a role at
// all - `partnerStaff.addAttendant()` has no argument for one - because an owner
// minting another owner is what the two ladders exist to prevent. This is the rung
// between them and it belongs here.
function staffCard(p, staff) {
  if (p.type !== 'LAUNDROMAT') return '';

  const url = p.slug ? `/shop/${escapeHtml(p.slug)}` : null;

  const rows = (staff || [])
    .map((person) => {
      const off = person.status !== 'ACTIVE';
      const owner = person.role === 'OWNER';
      const act = `/ops/partners/${escapeHtml(p.id)}/staff/${escapeHtml(person.id)}`;

      return `
      <tr${off ? ' style="opacity:.55;"' : ''}>
        <td>${escapeHtml(person.name || '')}${off ? ' (switched off)' : ''}</td>
        <td>${escapeHtml(format.displayPhone(person.phone))}</td>
        <td>${owner ? '<strong>Owner</strong>' : 'Attendant'}</td>
        <td style="text-align:right;white-space:nowrap;">
          <form method="post" action="${act}" style="display:inline;">
            <input type="hidden" name="role" value="${owner ? 'ATTENDANT' : 'OWNER'}">
            <button class="btn btn-sm" type="submit">${owner ? 'Make attendant' : 'Make owner'}</button>
          </form>
          <form method="post" action="${act}" style="display:inline;">
            <input type="hidden" name="status" value="${off ? 'ACTIVE' : 'DISABLED'}">
            <button class="btn btn-sm" type="submit">${off ? 'Switch on' : 'Switch off'}</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');

  return `
<div class="card card-xl" style="padding:26px;margin-bottom:24px;">
  <p class="eyebrow" style="margin:0 0 6px;">Their portal</p>
  <h2 style="font-family:var(--font-display);font-weight:900;font-size:24px;margin:0 0 10px;">
    Who can sign in
  </h2>

  ${
    url
      ? `<p style="font-size:15px;line-height:1.6;color:var(--ink-700);margin:0 0 18px;">
           Their own address is
           <a href="${url}" style="font-family:var(--font-mono);">${url}</a> &mdash; it names the
           shop and is not a credential. Everybody below signs in there with a code we text them.
         </p>`
      : `<p style="font-size:15px;line-height:1.6;color:var(--stain-500);margin:0 0 18px;">
           This laundromat has no portal address yet. It is made from the name, so press Edit and
           save to give it one.
         </p>`
  }

  ${
    staff && staff.length
      ? `<div class="pt-scroll"><table class="pt-hist">
           <thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th></th></tr></thead>
           <tbody>${rows}</tbody>
         </table></div>`
      : `<p style="font-size:15px;line-height:1.6;color:var(--ink-500);margin:0 0 18px;">
           Nobody can sign in to this shop yet.
         </p>`
  }

  <form method="post" action="/ops/partners/${escapeHtml(p.id)}/staff"
        style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-top:22px;">
    <div style="flex:1 1 160px;">
      <label class="field-label" for="sn">Name</label>
      <input class="field" id="sn" name="name" type="text" maxlength="60" required style="min-width:0;">
    </div>
    <div style="flex:1 1 160px;">
      <label class="field-label" for="sp">Mobile</label>
      <input class="field" id="sp" name="phone" type="tel" placeholder="201-555-0142" required
             style="min-width:0;">
    </div>
    <div style="flex:0 1 150px;">
      <label class="field-label" for="sr">Role</label>
      <select class="field" id="sr" name="role" style="min-width:0;">
        <option value="OWNER">Owner</option>
        <option value="ATTENDANT">Attendant</option>
      </select>
    </div>
    <button class="btn btn-ink" type="submit">Add them</button>
  </form>

  <p style="font-size:13px;color:var(--ink-500);line-height:1.55;margin:16px 0 0;">
    An owner can add and remove their own attendants. Nobody is texted when they are added &mdash;
    they sign in when they choose to. <strong>To see the portal yourself, add your own number as an
    owner</strong> and sign in at their address: everything you do is then recorded as you rather
    than as one of their staff.
  </p>
</div>`;
}

// WHAT THEY HAVE WEIGHED, WHEN THEIRS IS THE ONLY SCALE.
//
// Replaces "Their scale against ours" under the courier model. No drift, no
// tolerance and no flags, because there is no second number to be out by.
//
// THE LOST CONTROL IS NAMED RATHER THAN QUIETLY DROPPED. Under the van our scale
// checked theirs, which is what made a shop running consistently heavy visible. A
// courier removes our half, so the same unchecked figure bills the customer and
// pays the shop. This page is exactly where somebody would look for that check, so
// it is the page that has to say it is gone.
function theirScaleAlone(p, weighed) {
  if (p.type !== 'LAUNDROMAT') return '';

  const w = weighed || { orders: 0, totalLb: 0, meanLb: 0, meanPerBag: null };
  const n = (value, dp = 1) => (value == null ? '&mdash;' : Number(value).toFixed(dp));

  const figure = (value, label) => `
    <div>
      <div style="font-family:var(--font-display);font-weight:900;font-size:30px;line-height:1;">${value}</div>
      <div class="eyebrow" style="margin:6px 0 0;">${label}</div>
    </div>`;

  return `
<div class="card card-xl" style="padding:26px;">
  <p class="eyebrow" style="margin:0 0 6px;">Their scale</p>
  <h2 style="font-family:var(--font-display);font-weight:900;font-size:24px;margin:0 0 10px;">
    What they have weighed
  </h2>

  ${
    w.orders
      ? `<div style="display:flex;flex-wrap:wrap;gap:22px;margin:14px 0 18px;">
           ${figure(w.orders, 'Orders weighed')}
           ${figure(n(w.totalLb), 'Pounds in total')}
           ${figure(n(w.meanLb), 'Average order')}
           ${figure(n(w.meanPerBag), 'Average per bag')}
         </div>`
      : `<p style="font-size:15px;line-height:1.6;color:var(--ink-500);margin:0 0 6px;">
           Nothing weighed yet. It fills in as orders go through them.
         </p>`
  }

  <p style="font-size:13px;color:var(--ink-500);line-height:1.55;margin:14px 0 0;">
    <strong>Nobody of ours weighs these bags.</strong> A courier takes them off a doorstep and hands
    them over this counter, so their figure is the only one there is &mdash; it bills the customer and
    it pays them. There is nothing to check it against. Pounds per bag against their own history is
    the one signal left: a shop that has always reported 25 lb a bag and starts reporting 40 shows up
    above.
  </p>
</div>`;
}

function partnerDetailBody({
  partner,
  history,
  hours = [],
  load = null,
  notice,
  // THE PORTAL, WHICH THE PAGE KNEW NOTHING ABOUT. Neil, 26 September:
  // "Shouldnt the laundromat page have a spot for me to add the owner/admin of
  // the laudnromat url page. also i shoudl a link to that page and the ability
  // to sign into it as well."
  //
  // Until this, a laundromat's portal existed and the only way to give anybody
  // access to it was `npm run shop:user` in a terminal. A screen listing
  // laundromats that could not say who could sign in to one, or even where it
  // was, was a screen missing the half that has people in it.
  staff = [],
  weighed = null,
  courierModel = false,
} = {}) {
  const p = partner;
  const laundromat = p.type === 'LAUNDROMAT';

  const fact = (label, value) => `
    <div style="display:flex;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:1px solid var(--ink-100);">
      <span class="eyebrow" style="margin:0;">${escapeHtml(label)}</span>
      <span style="font-size:16px;text-align:right;">${value}</span>
    </div>`;

  // The headline of the whole page when it is bad news: a partner whose scale
  // reads heavy nearly every time is not a scale problem.
  const drift = history.total ? history.meanDrift : null;
  const suspicious = history.total >= 5 && drift > 0.75 && history.heavier / history.total >= 0.8;

  const historyRows = history.rows
    .map(({ order, check }) => {
      if (!check) return '';
      return `
      <tr>
        <td><a href="/ops/orders/${order.order_number}">#${order.order_number}</a></td>
        <td class="num r">${check.ours.toFixed(1)}</td>
        <td class="num r">${check.theirs.toFixed(1)}</td>
        <td class="num r" style="font-weight:700;color:${
          check.overThreshold ? 'var(--stain-500)' : check.heavier ? 'var(--ink-900)' : 'var(--ink-500)'
        };">${check.difference > 0 ? '+' : ''}${check.difference.toFixed(1)}</td>
        <td class="r">${check.overThreshold ? '<span class="badge" style="background:var(--stain-500);color:var(--paper-050);">Flagged</span>' : ''}</td>
      </tr>`;
    })
    .join('');

  return `
<style>
  table.pt-hist { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.pt-hist th { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--ink-500); font-weight: 700; text-align: left;
    padding: 0 10px 10px 0; border-bottom: 2px solid var(--ink-900); }
  table.pt-hist th.r, table.pt-hist td.r { text-align: right; }
  table.pt-hist td { padding: 11px 10px 11px 0; border-bottom: 1px solid var(--ink-100); }
  table.pt-hist .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .pt-scroll { overflow-x: auto; }
  .pt-scroll table { min-width: 460px; }

  /* minmax(0, 1fr), not 1fr. A grid track defaults to min-content as its
     floor, so the 460px table inside pushed the whole card wider than the
     screen and the page scrolled sideways - the overflow-x on .pt-scroll
     never got a chance, because its parent had already grown to fit it. */
  .pt-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; align-items: start; }
  .pt-cols > * { min-width: 0; }
  @media (max-width: 900px) { .pt-cols { grid-template-columns: minmax(0, 1fr); } }
</style>

<a href="/ops/partners" style="font-size:15px;font-weight:600;">&larr; All partners</a>

<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;justify-content:space-between;margin:18px 0 28px;">
  <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;">
    <h1 style="font-family:var(--font-display);font-weight:900;font-size:36px;margin:0;">
      ${escapeHtml(p.name)}
    </h1>
    ${typeBadge(p.type)}
    ${statusBadge(p.status)}
  </div>
  <a class="btn btn-outline" href="/ops/partners/${p.id}/edit">Edit</a>
</div>

${
  notice
    ? `<p class="ops-note ops-note--good">${escapeHtml(notice)}</p>`
    : ''
}

${
  suspicious
    ? `<div class="ops-note ops-note--bad">
         <span class="ops-note__label">Worth looking at</span>
         <span class="ops-note__title">
           Their scale reads heavy nearly every time
         </span>
         <p style="margin:0;font-size:15px;line-height:1.6;">
           ${history.heavier} of ${history.total} bags came back heavier than ours,
           averaging ${drift > 0 ? '+' : ''}${drift.toFixed(2)} lb. An honest scale is
           wrong in both directions and averages near nothing.
         </p>
       </div>`
    : ''
}

<div class="pt-cols">
  <div class="card card-xl" style="padding:26px;">
    <p class="eyebrow" style="margin:0 0 6px;">Details</p>
    ${/* The dash is markup, so it must not go through escapeHtml with the
          value - escaping the whole expression turned an empty field into a
          literal "&mdash;" on the page. */ ''}
    ${fact('Address', addressOf(p) ? escapeHtml(addressOf(p)) : '&mdash;')}
    ${fact('Contact', p.contact_name ? escapeHtml(p.contact_name) : '&mdash;')}
    ${fact('Phone', p.phone ? escapeHtml(format.displayPhone(p.phone)) : '&mdash;')}
    ${fact('Email', p.email ? escapeHtml(p.email) : '&mdash;')}
    ${
      laundromat
        ? fact(
            'Open',
            hours.length
              ? escapeHtml(partners.describeHours(hours))
              : '<span style="color:var(--stain-500);font-weight:700;">no hours set - routing will not send bags here</span>'
          ) +
          (p.hours ? fact('Note', escapeHtml(p.hours)) : '') +
          fact(
            'They charge us',
            p.wholesale_per_lb_cents == null
              ? '<span style="color:var(--ink-500);">not agreed</span>'
              : `<strong>${escapeHtml(money(p.wholesale_per_lb_cents))}</strong> / lb`
          ) +
          fact(
            'They charge walk-ins',
            p.retail_per_lb_cents == null ? '&mdash;' : `${escapeHtml(money(p.retail_per_lb_cents))} / lb`
          ) +
          fact('Daily capacity', p.daily_capacity_lb ? `${p.daily_capacity_lb} lb` : '&mdash;') +
          fact(
            'Turnaround',
            p.turnaround_minutes == null
              ? '<span style="color:var(--stain-500);">not known - treated as a risk</span>'
              : `${Math.round(p.turnaround_minutes / 60)} hours`
          ) +
          fact(
            'Takes work until',
            p.dropoff_cutoff ? escapeHtml(String(p.dropoff_cutoff).slice(0, 5)) : 'closing time'
          ) +
          fact('With them now', loadLine(load))
        : ''
    }
    ${p.notes ? `<p style="margin:18px 0 0;font-size:15px;line-height:1.6;color:var(--ink-700);white-space:pre-wrap;">${escapeHtml(p.notes)}</p>` : ''}
  </div>

  ${staffCard(p, staff)}

  ${
    // THEIR SCALE AGAINST OURS IS A VAN QUESTION AND CANNOT BE ASKED UNDER A
    // COURIER. Neil, 26 September: "we are not weighing the orders anymore.
    // There is no need for the Their scale against ours check."
    //
    // He is right and it follows from the model rather than being a preference:
    // nobody of ours touches the bags, so `orders.weight_lb` is null for ever and
    // the comparison has one number in it. `weightHistory()` requires BOTH and can
    // only ever come back empty for a courier order - what was on screen was
    // seeded van-era data.
    //
    // THE VAN VERSION IS UNTOUCHED, because production still runs it. Third thing
    // in this codebase that is two rules on purpose, after the service area and
    // the order minimum.
    courierModel ? theirScaleAlone(p, weighed) : ''
  }
  ${
    // ABSENT, NEVER HIDDEN. The first version set `display:none` on this card
    // under the courier model, which is the exact thing this codebase refuses:
    // prices are left out of a driver's markup rather than hidden with CSS,
    // because a value that never reaches the page cannot leak from it - and a
    // screen that hides a thing while the data still renders is not a decision,
    // it is a stylesheet away from being undone.
    courierModel
      ? ''
      : `
  <div class="card card-xl" style="padding:26px;">
    <p class="eyebrow" style="margin:0 0 6px;">Their scale against ours</p>
    ${
      history.total
        ? `
      <div style="display:flex;flex-wrap:wrap;gap:22px;margin:14px 0 22px;">
        <div>
          <div style="font-family:var(--font-display);font-weight:900;font-size:30px;line-height:1;">
            ${drift > 0 ? '+' : ''}${drift.toFixed(2)}
          </div>
          <div class="eyebrow" style="margin:6px 0 0;">Average lb out</div>
        </div>
        <div>
          <div style="font-family:var(--font-display);font-weight:900;font-size:30px;line-height:1;">
            ${history.flagged}
          </div>
          <div class="eyebrow" style="margin:6px 0 0;">Over tolerance</div>
        </div>
        <div>
          <div style="font-family:var(--font-display);font-weight:900;font-size:30px;line-height:1;">
            ${history.heavier}/${history.total}
          </div>
          <div class="eyebrow" style="margin:6px 0 0;">Read heavier</div>
        </div>
      </div>

      <div class="pt-scroll">
        <table class="pt-hist">
          <thead>
            <tr><th>Order</th><th class="r">Ours</th><th class="r">Theirs</th><th class="r">Out by</th><th></th></tr>
          </thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>`
        : `<p style="margin:12px 0 0;font-size:15px;color:var(--ink-500);line-height:1.6;">
             Nothing to compare yet. It fills in as bags go through them and they
             enter their own weight from the sticker.
           </p>`
    }
    <p style="font-size:13px;color:var(--ink-500);line-height:1.55;margin:18px 0 0;">
      Tolerance is ${partners.TOLERANCE_LB} lb or ${(partners.TOLERANCE_PCT * 100).toFixed(0)}% of
      the bag, whichever is larger. Our weight is always what the customer was charged.
    </p>
  </div>`
  }
</div>`;
}

module.exports = { partnerListBody, partnerFormBody, partnerDetailBody };
