'use strict';

const { escapeHtml, icon } = require('./layout');
const roles = require('../core/roles');

// ---------------------------------------------------------------------------
// One person on the team: /ops/team/:id
//
// The list used to be the only screen, and everything you could change to a
// person was a control wedged into their row - a role dropdown here, a switch
// off button there - with home bases in a separate card further down that
// listed people you had never picked. Nothing could edit a name or a phone
// number at all, so a typo on either meant deleting the person and starting
// again, which loses the record of what they did.
//
// So: the list is a list, and this is where a person is edited. One form, one
// save, everything about them in it.
//
// TWO THINGS THIS FORM MUST NEVER LET YOU DO TO YOURSELF, and both are here as
// well as in the route: change your own role, and switch yourself off. Either
// one locks the door behind you on a tool with no other way in.
// ---------------------------------------------------------------------------

const ROLE_TONE = {
  ADMIN: 'var(--sunbeam-500)',
  DRIVER: 'var(--suds-300)',
  SALES: 'var(--lilac-300)',
};

function field({ name, label, value = '', hint = '', type = 'text', attrs = '' }) {
  return `
  <div class="field">
    <label class="field-label" for="f_${name}">${escapeHtml(label)}</label>
    <input class="input input-lg" type="${type}" id="f_${name}" name="${name}"
           value="${escapeHtml(value == null ? '' : String(value))}" ${attrs} style="width:100%;">
    ${hint ? `<span class="field-hint">${hint}</span>` : ''}
  </div>`;
}

// The week, as fourteen time boxes. Same control as a partner's opening hours,
// and read the same way - a day left blank is a day off.
//
// The one difference is what BLANK ALTOGETHER means. For a partner it means
// closed; for a driver it means always available, because a one-van business
// has never needed a rota and refusing them work would stop the system.
function shiftGrid(rows) {
  const at = (day, n) => {
    const forDay = (rows || []).filter((r) => Number(r.weekday) === day);
    return forDay[n] || null;
  };

  const box = (name, value) =>
    `<input class="input" type="time" name="${name}" value="${
      value ? escapeHtml(String(value).slice(0, 5)) : ''
    }" style="width:100%;min-width:0;">`;

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const row = (day) => {
    const first = at(day, 0);
    const second = at(day, 1);
    return `
    <div class="tm-shift">
      <span class="tm-day">${escapeHtml(DAYS[day])}</span>
      <div class="tm-pair">
        ${box(`shift_${day}_start`, first && first.starts_at)}
        <span class="tm-dash">to</span>
        ${box(`shift_${day}_end`, first && first.ends_at)}
      </div>
      <div class="tm-pair tm-second">
        ${box(`shift_${day}_start_2`, second && second.starts_at)}
        <span class="tm-dash">to</span>
        ${box(`shift_${day}_end_2`, second && second.ends_at)}
      </div>
    </div>`;
  };

  return `
    <p style="font-size:15px;line-height:1.6;color:var(--ink-700);margin:0 0 6px;">
      Orders are only given to somebody on a day they work.
      <strong>Leave the whole week blank and they are available any time</strong> -
      which is what a single van with no rota wants. The second pair is for a
      split shift.
    </p>
    ${
      !(rows || []).length
        ? `<p style="font-size:14px;color:var(--ink-500);margin:0 0 14px;">
             Nothing set, so they can be given work any day.
           </p>`
        : ''
    }
    <div class="tm-head"><span></span><span>Working</span><span>And again</span></div>
    <div class="tm-shifts">${[1, 2, 3, 4, 5, 6, 0].map(row).join('')}</div>`;
}

function teamMemberBody({ person, isMe, hours = [], notice = null, problem = null, formatPhone }) {
  const drives = roles.can(person, 'orders.drive');

  return `
<div style="max-width:720px;">
  <a href="/ops/team" style="font-size:15px;font-weight:600;">&larr; Everyone</a>

  <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:14px;margin:18px 0 26px;">
    <h1 style="font-family:var(--font-display);font-weight:900;font-size:38px;letter-spacing:-0.03em;margin:0;">
      ${escapeHtml(person.name)}
    </h1>
    ${isMe ? '<span style="color:var(--ink-400);font-size:17px;">(you)</span>' : ''}
    <span class="badge" style="background:${ROLE_TONE[person.role]};">${escapeHtml(roles.labelFor(person.role))}</span>
    <span class="badge" style="background:${
      person.status === 'ACTIVE' ? 'var(--suds-300)' : 'var(--paper-200)'
    };">${escapeHtml(person.status)}</span>
  </div>

  ${
    problem
      ? `<p style="margin:0 0 22px;padding:14px 17px;border:2px solid var(--ink-900);border-radius:12px;
                   background:var(--stain-500);color:var(--paper-050);font-weight:700;">${escapeHtml(problem)}</p>`
      : ''
  }
  ${
    notice
      ? `<p style="margin:0 0 22px;padding:14px 17px;border:2px solid var(--ink-900);border-radius:12px;
                   background:var(--suds-300);font-size:16px;">${escapeHtml(notice)}</p>`
      : ''
  }

  <form method="post" action="/ops/team/${person.id}">

    <div class="card card-xl" style="padding:26px;margin-bottom:22px;">
      <p class="eyebrow" style="margin:0 0 16px;">Who they are</p>

      <div class="stack">
        ${field({ name: 'name', label: 'Name', value: person.name, attrs: 'required' })}
        ${field({
          name: 'phone',
          label: 'Mobile number',
          value: formatPhone ? formatPhone(person.phone) : person.phone,
          type: 'tel',
          attrs: 'required inputmode="tel"',
          hint: 'They sign in with this. It has to receive texts.',
        })}
      </div>
    </div>

    <div class="card card-xl" style="padding:26px;margin-bottom:22px;">
      <p class="eyebrow" style="margin:0 0 16px;">What they can do</p>

      <div class="field">
        <label class="field-label" for="f_role">Role</label>
        ${
          isMe
            ? `<p style="font-size:15px;line-height:1.55;color:var(--ink-700);margin:0;">
                 <span class="badge" style="background:${ROLE_TONE[person.role]};">${escapeHtml(
                   roles.labelFor(person.role)
                 )}</span>
                 &nbsp; You cannot change your own role - demoting yourself out of
                 team management would lock the door behind you.
               </p>`
            : `<select class="select input-lg" id="f_role" name="role" style="width:100%;">
                 ${Object.entries(roles.ROLES)
                   .map(
                     ([key, r]) =>
                       `<option value="${key}"${key === person.role ? ' selected' : ''}>${escapeHtml(
                         r.label
                       )} &mdash; ${escapeHtml(r.description)}</option>`
                   )
                   .join('')}
               </select>`
        }
      </div>

      <div class="field" style="margin-top:20px;">
        <label class="field-label">On the route</label>
        ${
          person.role === 'ADMIN'
            ? `<label style="display:flex;gap:12px;align-items:flex-start;font-size:16px;line-height:1.5;cursor:pointer;">
                 <input type="checkbox" name="drives" value="yes" ${person.drives ? 'checked' : ''}
                        style="width:22px;height:22px;margin-top:2px;flex:none;">
                 <span>
                   <strong>Put them on the route.</strong>
                   Orders get assigned to them, they get a home base and their own
                   day to drive. Off, they can still fix any order - they just are
                   not one of the people it goes to.
                 </span>
               </label>`
            : person.role === 'DRIVER'
              ? `<p style="font-size:15px;line-height:1.55;color:var(--ink-700);margin:0;">
                   <span class="badge" style="background:var(--suds-300);">Always</span>
                   &nbsp; A driver drives - that is the role. Change the role above if
                   they should not be on the route.
                 </p>`
              : `<p style="font-size:15px;line-height:1.55;color:var(--ink-500);margin:0;">
                   Sales never drives.
                 </p>`
        }
      </div>

      ${
        // Only for somebody on the route: it feeds the margin on their day, and
        // a wage on a person who never drives changes nothing.
        drives
          ? `
      <div class="field" style="margin-top:20px;">
        ${field({
          name: 'wage_dollars_hour',
          label: 'Paid per hour',
          value: person.wage_cents_hour == null ? '' : (person.wage_cents_hour / 100).toFixed(2),
          type: 'number',
          attrs: 'step="0.25" min="1" max="200" placeholder="20.00"',
          hint:
            'Feeds the margin on their route, which charges every paid minute - driving ' +
            'and standing at a door. Left blank they cost whatever the system default is.',
        })}
      </div>`
          : ''
      }

      <div class="field" style="margin-top:20px;">
        <label class="field-label">Active</label>
        ${
          isMe
            ? `<p style="font-size:15px;line-height:1.55;color:var(--ink-700);margin:0;">
                 You cannot switch yourself off. It is the one action that can lock
                 everybody out of a tool with no other way in.
               </p>`
            : `<label style="display:flex;gap:12px;align-items:flex-start;font-size:16px;line-height:1.5;cursor:pointer;">
                 <input type="checkbox" name="active" value="yes" ${person.status === 'ACTIVE' ? 'checked' : ''}
                        style="width:22px;height:22px;margin-top:2px;flex:none;">
                 <span>
                   <strong>They work here.</strong>
                   Switched off, they cannot sign in and <strong>nothing is
                   assigned to them</strong> - it takes effect on their next
                   request, and everything they did is kept.
                 </span>
               </label>`
        }
      </div>
    </div>

    ${
      // The rota, for anybody on the route. Somebody who never drives has no
      // work to be given, so a rota would change nothing.
      drives
        ? `
    <div class="card card-xl" style="padding:26px;margin-bottom:22px;">
      <p class="eyebrow" style="margin:0 0 12px;">When they work</p>
      ${shiftGrid(hours)}
    </div>`
        : ''
    }

    ${
      // Only somebody on the route has anywhere to start from. Sales has no
      // route; an admin who has not switched driving on has no route either,
      // and the field would change nothing.
      drives
        ? `
    <div class="card card-xl" style="padding:26px;margin-bottom:22px;">
      <p class="eyebrow" style="margin:0 0 6px;">Home base</p>
      <p style="font-size:15px;line-height:1.6;color:var(--ink-700);margin:0 0 18px;">
        Where they start and end the day. A route is solved from here, and an
        order goes to whoever's base is nearest.
        <strong>Left blank they fall back to the service base</strong>, which is
        what every route used before this existed.
        ${
          person.base_lat != null
            ? '<br>On the map.'
            : person.base_address_line1
              ? person.base_geocode_failed
                ? '<br><span style="color:var(--stain-500);font-weight:700;">That address could not be found on the map, so they are routing from the service base.</span>'
                : '<br>Looking it up now.'
              : ''
        }
      </p>

      <div class="stack">
        ${field({ name: 'base_address_line1', label: 'Street', value: person.base_address_line1, attrs: 'placeholder="12 Berdan Ave"' })}
        ${field({ name: 'base_address_line2', label: 'Unit, if any', value: person.base_address_line2 })}
      </div>

      <div class="tm-three" style="margin-top:16px;">
        ${field({ name: 'base_city', label: 'Town', value: person.base_city, attrs: 'placeholder="Fair Lawn"' })}
        ${field({ name: 'base_state', label: 'State', value: person.base_state, attrs: 'maxlength="2" placeholder="NJ"' })}
        ${field({ name: 'base_postal_code', label: 'Zip', value: person.base_postal_code, attrs: 'placeholder="07410"' })}
      </div>
    </div>`
        : ''
    }

    <button type="submit" class="btn btn-ink btn-lg">Save ${icon('arrow-right', '22')}</button>
  </form>

  ${
    // REMOVING SOMEBODY IS TWO DIFFERENT THINGS and they are not
    // interchangeable, so the page offers both and says which is which.
    //
    // Switching off is what "they left" means: they cannot sign in, nothing is
    // assigned to them, and every order they touched still says who touched it.
    // That is almost always the right answer, so it is the ordinary control
    // above rather than something down here.
    //
    // Deleting erases the row. It is only offered when they have NEVER been
    // given an order, because otherwise it would blank the actor on work they
    // actually did - and a delivery whose history says nobody delivered it is
    // worse than a disabled row nobody looks at.
    isMe
      ? ''
      : `
  <div class="card card-xl" style="padding:26px;margin-top:28px;border-color:var(--stain-500);">
    <p class="eyebrow" style="margin:0 0 8px;">If they leave</p>
    <p style="font-size:15px;line-height:1.6;color:var(--ink-700);margin:0 0 18px;">
      <strong>Switching them off above is what you usually want.</strong> They
      cannot sign in, nothing is assigned to them, and every order they handled
      still records that they handled it.
    </p>

    ${
      person.orderCount
        ? `<p style="font-size:15px;line-height:1.6;margin:0;padding:14px 17px;border:2px solid var(--ink-900);
                      border-radius:12px;background:var(--paper-200);">
             <strong>They cannot be deleted.</strong> They have handled
             ${person.orderCount} order${person.orderCount === 1 ? '' : 's'}, and
             deleting them would leave that work with no record of who did it.
             Switch them off instead.
           </p>`
        : `<form method="post" action="/ops/team/${person.id}/delete" style="margin:0;"
                 onsubmit="return confirm('Delete ${escapeHtml(person.name)} completely? This cannot be undone.');">
             <button class="btn btn-outline" style="border-color:var(--stain-500);color:var(--stain-500);">
               Delete ${escapeHtml(person.name)} completely
             </button>
             <span class="field-hint" style="display:block;margin-top:10px;">
               Only possible because they have never been given an order. There is
               nothing to lose the record of.
             </span>
           </form>`
    }
  </div>`
  }

  <style>
    .tm-three { display: grid; grid-template-columns: minmax(0,2fr) minmax(0,1fr) minmax(0,1fr); gap: 14px; }
    .tm-three > * { min-width: 0; }
    .tm-shifts { display: flex; flex-direction: column; gap: 10px; }
    .tm-shift { display: grid; grid-template-columns: 84px minmax(0,1fr) minmax(0,1fr); gap: 12px; align-items: center; }
    .tm-shift > * { min-width: 0; }
    .tm-day { font-family: var(--font-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .tm-pair { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); gap: 8px; align-items: center; }
    .tm-dash { font-size: 13px; color: var(--ink-500); }
    .tm-second { opacity: 0.65; }
    .tm-second:focus-within { opacity: 1; }
    .tm-head { display: grid; grid-template-columns: 84px minmax(0,1fr) minmax(0,1fr); gap: 12px; margin: 0 0 6px; }
    .tm-head span { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-500); }
    @media (max-width: 640px) {
      .tm-head { display: none; }
      .tm-shift { grid-template-columns: 1fr; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--ink-100); }
      .tm-second { opacity: 1; }
    }
    /* An inline grid-template-columns would beat this and the row would refuse
       to stack, which is the rule the whole stylesheet follows. */
    @media (max-width: 620px) { .tm-three { grid-template-columns: minmax(0,1fr); } }
  </style>
</div>`;
}

module.exports = { teamMemberBody, ROLE_TONE };
