'use strict';

const { escapeHtml, icon } = require('./layout');
const { config } = require('../config');
const partnersCore = require('../core/partners');

// ---------------------------------------------------------------------------
// /ops/routing - the day, on a map, from the live queue.
//
// The planner's twin. It looks the same on purpose - the same map, the same
// pins, the same shape of numbers - because they answer the same question about
// two different things. THE PLANNER IS A MODEL and reads nothing from the
// database: you type made-up stops into it to ask "would a day like this work".
// THIS IS THE REAL DAY and types nothing: every stop on it is an order somebody
// actually placed.
//
// Keeping both is deliberate. A planner that only ever shows real orders cannot
// answer "what if we had twelve stops in Hoboken" before those twelve orders
// exist, and that is the question that decides whether to go there at all.
//
// WHAT IS SERVER-RENDERED AND WHAT IS NOT, because it matters here:
//
//   The run sheet - the order of the stops, the times, the laundromat, the
//   pounds - is built on the server and is in the HTML. It works with the
//   JavaScript switched off, on a phone with two bars, exactly like every other
//   ops page. That is the part somebody drives.
//
//   The map, and only the map, is JavaScript. It is a picture OF the run sheet
//   rather than the source of it, so losing it costs you the picture and
//   nothing else. The sequence never moves because the map loaded.
//
// The mileage is straight-line times the road factor, and the map then asks
// OSRM for real driving miles the way the planner does. The badge under the map
// says which of the two you are looking at, and the two are never mixed.
// ---------------------------------------------------------------------------

const money = (cents) =>
  cents == null ? null : `${cents < 0 ? '-' : ''}$${Math.abs(cents / 100).toFixed(2)}`;

const money0 = (cents) =>
  cents == null ? null : `${cents < 0 ? '-' : ''}$${Math.abs(Math.round(cents / 100))}`;

// "09:45" -> "9:45am"
function readableTime(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m || 0).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

function minutesToClock(mins) {
  const h = Math.floor(mins / 60) % 24;
  return readableTime(`${String(h).padStart(2, '0')}:${String(Math.round(mins) % 60).padStart(2, '0')}`);
}

const KIND_TONE = {
  collect: { bg: 'var(--suds-500)', word: 'Pick up' },
  dropoff: { bg: 'var(--sunbeam-500)', word: 'Drop off' },
  pickup_partner: { bg: 'var(--lilac-500)', word: 'Collect' },
  deliver: { bg: 'var(--paper-000)', word: 'Deliver' },
};

function addressOf(c) {
  if (!c) return '';
  return [c.address_line1, c.address_line2, c.city, c.state].filter(Boolean).join(', ');
}

// One line of the run sheet. This is the thing a driver reads, so it says what
// to do in words before it says anything else.
function stopRow(stop, { showNames, showMoney }) {
  const tone = KIND_TONE[stop.kind] || KIND_TONE.collect;
  const order = stop.order;
  const customer = order ? order.customers || {} : null;

  const who = order
    ? showNames && customer.name
      ? escapeHtml(customer.name)
      : `#${order.order_number}`
    : stop.partner
      ? escapeHtml(stop.partner.name)
      : '<span style="color:var(--stain-500);font-weight:700;">no laundromat available</span>';

  const where = order
    ? escapeHtml(addressOf(customer))
    : stop.partner
      ? escapeHtml(addressOf(stop.partner))
      : '';

  const detail = order
    ? [
        order.bag_count ? `${order.bag_count} bag${order.bag_count === 1 ? '' : 's'}` : null,
        order.weight_lb ? `${order.weight_lb} lb` : null,
      ]
        .filter(Boolean)
        .join(' &middot; ')
    : `${stop.bags} bag${stop.bags === 1 ? '' : 's'}${
        stop.pounds ? ` &middot; ${stop.pounds.toFixed(0)} lb` : ''
      }`;

  return `
  <div style="display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:14px;align-items:start;
              padding:14px 0;border-bottom:1px solid var(--ink-100);">
    <span style="flex:none;width:34px;height:34px;border:2px solid var(--ink-900);border-radius:50%;
                 background:${tone.bg};display:flex;align-items:center;justify-content:center;
                 font-family:var(--font-mono);font-weight:700;font-size:14px;">${stop.position}</span>
    <div style="min-width:0;">
      <div style="font-size:16px;font-weight:700;line-height:1.3;">
        ${escapeHtml(tone.word)} ${order ? `&mdash; ${who}` : `at ${who}`}
      </div>
      ${where ? `<div style="font-size:14px;color:var(--ink-700);line-height:1.45;">${where}</div>` : ''}
      ${detail ? `<div style="font-size:13px;color:var(--ink-500);margin-top:2px;">${detail}</div>` : ''}
      ${
        !stop.at
          ? `<div style="font-size:13px;color:var(--stain-500);font-weight:700;margin-top:3px;">
               Not on the map - it still has to be driven to.
             </div>`
          : ''
      }
    </div>
    <div style="text-align:right;white-space:nowrap;">
      <div style="font-family:var(--font-mono);font-weight:700;font-size:15px;">${escapeHtml(readableTime(stop.eta))}</div>
      ${
        order && showMoney && order.weight_lb
          ? `<div style="font-size:13px;color:var(--ink-500);">${escapeHtml(
              money0(Math.max(Math.round(order.weight_lb * config.pricing.perPoundCents), config.pricing.minimumCents))
            )}</div>`
          : ''
      }
    </div>
  </div>`;
}

// A laundromat, with the two facts that decide whether a bag can go there.
function partnerCard(p, { showMoney }) {
  const cap = p.capacity;
  const bar =
    cap.fraction == null
      ? ''
      : `
      <div style="height:12px;border:2px solid var(--ink-900);border-radius:999px;overflow:hidden;
                  background:var(--paper-000);margin:10px 0 6px;">
        <div style="height:100%;width:${Math.round(cap.fraction * 100)}%;
                    background:${cap.full ? 'var(--stain-500)' : cap.fraction > 0.8 ? 'var(--sunbeam-500)' : 'var(--suds-500)'};"></div>
      </div>`;

  return `
  <div class="card" style="padding:18px;border:2px solid var(--ink-900);border-radius:14px;
                           background:var(--paper-050);box-shadow:var(--shadow-pop-xs);">
    <div style="display:flex;gap:10px;align-items:baseline;justify-content:space-between;flex-wrap:wrap;">
      <a href="/ops/partners/${p.id}" style="font-weight:700;font-size:16px;">${escapeHtml(p.name)}</a>
      <span class="badge" style="background:${p.openNow ? 'var(--suds-300)' : 'var(--paper-200)'};">
        ${p.openNow ? 'Open' : 'Shut'}
      </span>
    </div>
    <div style="font-size:13px;color:var(--ink-500);margin-top:4px;line-height:1.45;">
      ${p.hoursText ? escapeHtml(p.hoursText) : '<span style="color:var(--stain-500);font-weight:700;">no hours set</span>'}
    </div>
    ${bar}
    <div style="font-size:14px;">
      ${
        cap.capacity == null
          ? `${cap.used.toFixed(0)} lb with them &middot; <span style="color:var(--ink-500);">no capacity set</span>`
          : `<strong>${cap.used.toFixed(0)}</strong> of ${cap.capacity} lb${
              cap.full
                ? ' &middot; <span style="color:var(--stain-500);font-weight:700;">full</span>'
                : ` &middot; ${cap.remaining.toFixed(0)} lb free`
            }`
      }
      ${cap.unweighed ? `<br><span style="font-size:13px;color:var(--ink-500);">${cap.unweighed} not weighed yet</span>` : ''}
    </div>
    ${
      showMoney && p.wholesale_per_lb_cents != null
        ? `<div style="font-size:13px;color:var(--ink-500);margin-top:6px;">
             ${escapeHtml(money(p.wholesale_per_lb_cents))} / lb to us
           </div>`
        : ''
    }
  </div>`;
}

// WHERE THIS DRIVER IS UP TO, drawn from the same reading of the orders that
// his own screen uses.
//
// The stop list below is what is LEFT, because the board is built from live
// queries and a finished stop drops out of it. That is right for "what remains"
// and useless for "how far through is he", which is the question somebody at a
// desk is actually asking - so the answer comes from the run rather than being
// inferred from a list that no longer contains the past.
function whereTheyAre(run) {
  const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;

  const doing = run.finished
    ? 'Finished the round.'
    : run.current
      ? `${run.arrived ? 'At' : 'On the way to'} ${
          run.current.name
            ? escapeHtml(run.current.name)
            : escapeHtml(run.current.address || 'the next stop')
        }${
          run.current.order ? ` &mdash; #${run.current.order.order_number}` : ''
        }, to ${escapeHtml((KIND_TONE[run.current.kind] || {}).word || 'work on it').toLowerCase()}.`
      : 'Nothing on.';

  return `
  <div class="card card-xl" style="padding:22px;margin-bottom:26px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:10px;">
      <p class="eyebrow" style="margin:0;">Where they are now</p>
      <span class="eyebrow" style="margin:0;">
        Stop ${Math.min(run.done + 1, run.total)} of ${run.total} &middot; ${run.done} done
      </span>
    </div>

    <div style="height:14px;border:2px solid var(--ink-900);border-radius:999px;overflow:hidden;
                background:var(--paper-000);margin-bottom:14px;">
      <div style="height:100%;width:${pct}%;background:var(--suds-500);"></div>
    </div>

    <p style="font-size:16px;line-height:1.5;margin:0 0 14px;font-weight:600;">${doing}</p>

    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      ${run.stops
        .map(
          (s, i) => `
        <span style="display:flex;align-items:center;gap:7px;padding:6px 11px;border:2px solid var(--ink-900);
                     border-radius:999px;font-size:13px;
                     background:${
                       s.done
                         ? 'var(--suds-300)'
                         : s === run.current
                           ? 'var(--sunbeam-500)'
                           : 'var(--paper-050)'
                     };">
          <span style="font-family:var(--font-mono);font-weight:700;">${i + 1}</span>
          ${escapeHtml((KIND_TONE[s.kind] || {}).word || s.kind)}
          ${s.done ? '&check;' : s === run.current ? '&larr; here' : ''}
        </span>`
        )
        .join('')}
    </div>
  </div>`;
}

function statCard(label, value, tone) {
  return `
  <div style="flex:1 1 130px;min-width:0;padding:16px 18px;border:2px solid var(--ink-900);border-radius:14px;
              background:${tone || 'var(--paper-050)'};box-shadow:var(--shadow-pop-xs);">
    <div style="font-family:var(--font-display);font-weight:900;font-size:26px;line-height:1;
                letter-spacing:-0.02em;">${value}</div>
    <div class="eyebrow" style="margin:8px 0 0;">${escapeHtml(label)}</div>
  </div>`;
}

function routingBoardBody({
  board,
  quote,
  form = {},
  problem = null,
  showNames,
  showMoney,
  drivers = [],
  driverId = null,
  lockedToSelf = false,
  progress = null,
}) {
  const r = config.routing;

  // Only the pins go to the browser. Not a name, not an address, not a price -
  // the map needs a dot and a number, and anything more would be personal
  // detail sitting in a script tag for no reason.
  const mapData = {
    // Whose base the route starts and ends at. Read from the board rather than
    // written down here - a driver out of Fair Lawn and one out of Maryland
    // must not share a hardcoded pin.
    base: { lat: board.home.lat, lng: board.home.lng },
    // Where the van actually is, when the day is underway. Drawn as its own pin
    // so the route visibly starts from it rather than from the depot.
    position: board.position ? { lat: board.position.lat, lng: board.position.lng } : null,
    stops: board.stops
      .filter((s) => s.at)
      .map((s) => ({ n: s.position, lat: s.at.lat, lng: s.at.lng, kind: s.kind })),
    partners: board.partners
      .filter((p) => p.at)
      .map((p) => ({ lat: p.at.lat, lng: p.at.lng, name: p.name, used: p.id === (board.choice.chosen || {}).id })),
  };

  const legGroups = [
    { kinds: ['collect'], title: 'Pick up', blurb: 'Dirty bags off doorsteps' },
    { kinds: ['dropoff', 'pickup_partner'], title: 'The laundromat', blurb: 'Hand over the dirty, take the finished' },
    { kinds: ['deliver'], title: 'Deliver', blurb: 'Clean bags back to the door' },
  ];

  return `
<style>
  .db-map { height: 460px; border: 2px solid var(--ink-900); border-radius: 16px; overflow: hidden;
            box-shadow: var(--shadow-pop-sm); background: var(--paper-200); }
  .db-map .leaflet-container { background: var(--paper-200); }
  .db-mk { display: flex; align-items: center; justify-content: center; border: 2px solid var(--ink-900);
           font-family: var(--font-mono); font-weight: 700; font-size: 12px; color: var(--ink-900);
           box-shadow: 2px 2px 0 var(--ink-900); }
  .db-mk.collect { width: 28px; height: 28px; border-radius: 50%; background: var(--suds-500); }
  .db-mk.deliver { width: 28px; height: 28px; border-radius: 50%; background: var(--paper-000); }
  .db-mk.dropoff, .db-mk.pickup_partner { width: 28px; height: 28px; border-radius: 6px; background: var(--sunbeam-500); }
  .db-mk.partner { width: 24px; height: 24px; border-radius: 5px; background: var(--sunbeam-500); }
  .db-mk.partner.unused { background: var(--paper-200); color: var(--ink-500); }
  .db-mk.base { width: 24px; height: 24px; border-radius: 5px; background: var(--lilac-500); }
  .db-mk.van { width: 28px; height: 28px; border-radius: 50%; background: var(--stain-500); color: var(--paper-050); }
  .db-cols { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 26px; align-items: start; }
  .db-cols > * { min-width: 0; }
  .db-when { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) auto; gap: 12px; align-items: end; }
  .db-partners { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; }
  @media (max-width: 900px) {
    .db-cols { grid-template-columns: minmax(0, 1fr); }
    .db-when { grid-template-columns: minmax(0,1fr); }
    .db-map { height: 320px; }
  }
</style>

<div style="max-width:1180px;">
  <p class="eyebrow" style="margin:0 0 8px;">Routing</p>
  <h1 style="margin:0 0 14px;font-size:40px;line-height:1.05;">The day, as it stands</h1>
  <p style="font-size:16px;line-height:1.6;color:var(--ink-700);max-width:64ch;margin:0 0 22px;">
    Everything live in the queue for one day, put in the order it gets driven.
    Pick a day and a starting time and it works out the route, which laundromat
    the bags go to, and when the driver should be at each door. Nothing here
    changes anything - it is a picture, not a button.
  </p>

  ${progress && progress.total ? whereTheyAre(progress) : ''}

  ${
    // WITHOUT A DRIVER THIS IS NOT A ROUTE ANYBODY DRIVES. Everybody's stops
    // solved from the service base looks like a plan and is not one - two
    // drivers cannot both drive it, and neither starts where it starts.
    board.driver
      ? `<p style="font-size:15px;line-height:1.55;margin:0 0 26px;">
           <strong>${escapeHtml(board.driver.name)}</strong>, out of
           ${
             board.home.own
               ? escapeHtml(board.driver.base_city || board.driver.base_address_line1)
               : 'the service base - they have no base of their own set'
           }.
           ${
             // A mileage figure means different things measured from a depot at
             // six in the morning and from wherever the van is parked at three
             // in the afternoon, so the page says which it is.
             board.position
               ? `The route below is solved from <strong>where the van is now</strong>${
                   board.position.kind === 'partner' ? ' - the laundromat' : ' - their last stop'
                 }, not from the base.`
               : 'The day has not started, so the route is solved from there.'
           }
         </p>`
      : `<p style="margin:0 0 26px;padding:13px 16px;border:2px solid var(--ink-900);border-radius:12px;
                    background:var(--sunbeam-500);font-size:15px;line-height:1.55;">
           <strong>Everybody's stops at once, from the service base.</strong>
           Useful for seeing the whole day, but nobody drives this - pick a
           driver to get a route that starts where they do.
         </p>`
  }

  ${
    problem
      ? `<p style="margin:0 0 22px;padding:14px 17px;border:2px solid var(--ink-900);border-radius:12px;
                   background:var(--stain-500);color:var(--paper-050);font-weight:700;">${escapeHtml(problem)}</p>`
      : ''
  }

  <div class="card card-xl" style="padding:22px;margin-bottom:26px;">
    <form method="get" action="/ops/routing" class="db-when">
      <div>
        <label class="field-label" for="date">Which day</label>
        <input class="input input-lg" type="date" id="date" name="date"
               value="${escapeHtml(board.date)}" style="width:100%;">
      </div>
      <div>
        <label class="field-label" for="from">Leaving base at</label>
        <input class="input input-lg" type="time" id="from" name="from"
               value="${escapeHtml(board.start)}" style="width:100%;">
      </div>
      ${
        // A driver only ever sees their own day, so there is nothing to pick
        // and the control would be a dropdown with one entry in it.
        lockedToSelf
          ? ''
          : `
      <div>
        <label class="field-label" for="driver">Whose day</label>
        <select class="select input-lg" id="driver" name="driver" style="width:100%;">
          <option value="">Everybody</option>
          ${drivers
            .map(
              (d) =>
                `<option value="${escapeHtml(d.id)}"${d.id === driverId ? ' selected' : ''}>${escapeHtml(
                  d.name
                )}${d.base_city ? ` - ${escapeHtml(d.base_city)}` : ''}</option>`
            )
            .join('')}
        </select>
      </div>`
      }
      <button type="submit" class="btn btn-lg">Show it</button>
      ${form.address ? `<input type="hidden" name="address" value="${escapeHtml(form.address)}">` : ''}
      ${form.lb ? `<input type="hidden" name="lb" value="${escapeHtml(form.lb)}">` : ''}
    </form>
  </div>

  <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:26px;">
    ${statCard('Stops', board.stops.length)}
    ${statCard('Miles', board.miles.toFixed(1))}
    ${statCard(
      'On the road',
      `${Math.round(board.totalMin)}m`,
      board.overDay ? 'var(--stain-500)' : undefined
    )}
    ${statCard('Back at', minutesToClock(board.endMinutes))}
    ${
      // CASH IN, AND CASH COMING. Two different questions, side by side and
      // never added together: what has actually been charged at a door today,
      // and what the scale has already decided but is still out there.
      showMoney
        ? statCard('Grossed', escapeHtml(money0(board.money.grossedCents))) +
          statCard(
            'Expected',
            escapeHtml(money0(board.money.expectedCents)),
            board.money.expectedCents ? 'var(--suds-300)' : undefined
          )
        : ''
    }
    ${
      showMoney && board.money.marginCents != null
        ? statCard(
            'Margin',
            escapeHtml(money0(board.money.marginCents)),
            board.money.marginCents < 0 ? 'var(--stain-500)' : 'var(--sunbeam-500)'
          )
        : ''
    }
  </div>

  ${
    // THE MARGIN, SHOWING ITS WORKING.
    //
    // A single number invites being read as profit. It is not: it is what the
    // day leaves after the wash, the van, the wage and the card fees, and there
    // is a real list of things it does not cover. Spelling that out costs a few
    // lines and stops a figure being trusted further than it deserves.
    showMoney && board.money.marginCents != null
      ? `<div class="card card-xl" style="padding:22px;margin-bottom:26px;">
           <p class="eyebrow" style="margin:0 0 12px;">What the day leaves</p>

           <div style="display:flex;flex-wrap:wrap;gap:10px 26px;font-size:15px;line-height:1.6;">
             <span><strong>${escapeHtml(money(board.money.revenueCents))}</strong> billed
               <span style="color:var(--ink-500);">(${board.money.poundsWashed.toFixed(0)} lb)</span></span>
             <span style="color:var(--ink-500);">
               &minus; ${escapeHtml(money(board.money.wholesaleCents))} wash
               &minus; ${escapeHtml(money(board.money.labourCents))} wage
               &minus; ${escapeHtml(money(board.money.vehicleCents))} van
               &minus; ${escapeHtml(money(board.money.cardFeeCents))} card fees
             </span>
             <span>= <strong>${escapeHtml(money(board.money.marginCents))}</strong></span>
           </div>

           <p style="font-size:13px;color:var(--ink-500);line-height:1.55;margin:12px 0 0;">
             <strong>Grossed</strong> is what has been charged at a door today.
             <strong>Expected</strong> is weighed and not yet delivered - money the
             scale has already decided on, sitting in a laundromat or in the van.
             ${
               board.money.unpaidCents
                 ? `<strong style="color:var(--stain-500);">${escapeHtml(
                     money(board.money.unpaidCents)
                   )} was delivered today and did not pay</strong>, so it is not in Grossed.`
                 : ''
             }
             <br>
             The wage is ${escapeHtml(money(board.money.wagePerHour * 100))} an hour for
             ${board.driver ? escapeHtml(board.driver.name) : 'this round'} and counts
             <strong>every paid minute</strong>, on the road and on the
             ground. Bags not yet weighed are billed at what that customer's laundry
             usually weighs.
             <strong>This is not profit</strong> - insurance, the phone, the software
             and your own time are not in it.
           </p>
         </div>`
      : ''
  }

  ${
    // THE VAN PHYSICALLY WILL NOT HOLD IT. Shown, never silently trimmed - what
    // comes off the van is the driver's call, not the router's.
    board.load && board.load.overloaded
      ? `<p style="margin:0 0 24px;padding:14px 17px;border:2px solid var(--ink-900);border-radius:12px;
                   background:var(--stain-500);color:var(--paper-050);font-size:15px;line-height:1.55;">
           <strong>This is more than the van holds.</strong>
           ${board.load.pounds.toFixed(0)} lb and ${board.load.bags} bags against
           ${board.load.maxWeightLb} lb and ${board.load.maxBags}${
             board.load.name ? ` in ${escapeHtml(board.load.name)}` : ''
           }. Something has to come off, or it takes two trips.
         </p>`
      : ''
  }

  ${
    board.overDay
      ? `<p style="margin:0 0 24px;padding:14px 17px;border:2px solid var(--ink-900);border-radius:12px;
                   background:var(--sunbeam-500);font-size:15px;line-height:1.55;">
           <strong>This is more than a day.</strong> ${Math.round(board.totalMin)} minutes against
           ${r.workingDayMinutes} in the working day. Something has to move or somebody works late.
         </p>`
      : ''
  }

  <div class="db-cols">
    <div>
      <div class="db-map" id="db-map"></div>
      <div id="db-src" style="display:flex;align-items:center;gap:10px;margin:12px 0 26px;font-size:13px;
                              color:var(--ink-700);line-height:1.5;">
        <span style="flex:none;width:11px;height:11px;border:2px solid var(--ink-900);border-radius:50%;
                     background:var(--paper-300);"></span>
        <span><strong id="db-src-t">Straight line</strong> &mdash; <span id="db-src-note">Measuring the roads.</span></span>
      </div>

      ${
        board.stops.length
          ? legGroups
              .map((g) => {
                const rows = board.stops.filter((s) => g.kinds.includes(s.kind));
                if (!rows.length) return '';
                return `
      <div class="card card-xl" style="padding:24px;margin-bottom:20px;">
        <p class="eyebrow" style="margin:0 0 2px;">${escapeHtml(g.blurb)}</p>
        <h2 style="font-family:var(--font-display);font-weight:900;font-size:24px;margin:0 0 8px;">
          ${escapeHtml(g.title)}
        </h2>
        ${rows.map((s) => stopRow(s, { showNames, showMoney })).join('')}
      </div>`;
              })
              .join('')
          : `<div class="card card-xl" style="padding:26px;">
               <p style="margin:0;font-size:16px;color:var(--ink-500);line-height:1.6;">
                 Nothing booked for ${escapeHtml(board.date)} and nothing in the van.
               </p>
             </div>`
      }
    </div>

    <div>
      <div class="card card-xl" style="padding:24px;margin-bottom:20px;">
        <p class="eyebrow" style="margin:0 0 2px;">Where the bags go</p>
        <h2 style="font-family:var(--font-display);font-weight:900;font-size:24px;margin:0 0 14px;">
          The laundromats
        </h2>

        ${
          board.choice.chosen
            ? `<p style="font-size:15px;line-height:1.55;margin:0 0 16px;">
                 Today's dirty bags go to <strong>${escapeHtml(board.choice.chosen.name)}</strong>.
               </p>`
            : `<p style="margin:0 0 16px;padding:12px 15px;border:2px solid var(--ink-900);border-radius:12px;
                          background:var(--stain-500);color:var(--paper-050);font-size:15px;line-height:1.5;">
                 <strong>Nowhere to put the bags.</strong> No laundromat is open and has room at
                 ${escapeHtml(readableTime(board.start))}.
               </p>`
        }

        ${
          // THE WORKING, not just the name. The laundromat is chosen on total
          // cost - the wash plus the driving to get there and back - and a
          // figure whose reasoning is invisible is one nobody can check.
          board.choice.considered.length > 1 || !board.choice.chosen
            ? `<div style="margin:0 0 18px;">
                 ${board.choice.considered
                   .map(
                     (c) => `
                 <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;
                             padding:7px 0;border-bottom:1px solid var(--ink-100);font-size:13px;line-height:1.5;">
                   <span style="${c.chosen ? 'font-weight:700;' : 'color:var(--ink-500);'}">
                     ${escapeHtml(c.partner.name)}
                     ${c.chosen ? '' : `<br><span style="font-size:12px;">${escapeHtml(c.why || 'not used')}</span>`}
                   </span>
                   <span style="text-align:right;white-space:nowrap;${c.chosen ? 'font-weight:700;' : 'color:var(--ink-500);'}">
                     ${
                       showMoney && c.totalCents != null
                         ? `${escapeHtml(money(c.totalCents))}<br>
                            <span style="font-size:12px;font-weight:400;color:var(--ink-500);">
                              ${escapeHtml(money(c.washCents))} wash + ${escapeHtml(money(c.drivingCents))} drive
                            </span>`
                         : `${c.miles === Infinity ? '&mdash;' : `${c.miles.toFixed(1)} mi`}`
                     }
                   </span>
                 </div>`
                   )
                   .join('')}
                 ${
                   showMoney
                     ? `<p style="font-size:12px;color:var(--ink-500);line-height:1.5;margin:10px 0 0;">
                          Cheapest all in wins, not nearest. An unweighed pickup is
                          counted at the ${escapeHtml(String(config.pricing.minimumCents / config.pricing.perPoundCents))} lb
                          the minimum charge implies.
                        </p>`
                     : ''
                 }
               </div>`
            : ''
        }

        <div class="db-partners">
          ${
            board.partners.length
              ? board.partners.map((p) => partnerCard(p, { showMoney })).join('')
              : `<p style="margin:0;font-size:15px;color:var(--ink-500);line-height:1.6;">
                   No laundromats added yet. <a href="/ops/partners/new">Add one</a> and the board
                   can start routing bags to it.
                 </p>`
          }
        </div>
      </div>

      <div class="card card-xl" style="padding:24px;">
        <p class="eyebrow" style="margin:0 0 2px;">Mid-run</p>
        <h2 style="font-family:var(--font-display);font-weight:900;font-size:24px;margin:0 0 8px;">
          Can we take this one?
        </h2>
        <p style="font-size:14px;line-height:1.55;color:var(--ink-700);margin:0 0 16px;">
          Where a new <strong>pickup</strong> would slot into what is already
          being driven, and what saying yes costs.
        </p>

        <form method="get" action="/ops/routing">
          <input type="hidden" name="date" value="${escapeHtml(board.date)}">
          <input type="hidden" name="from" value="${escapeHtml(board.start)}">
          ${driverId ? `<input type="hidden" name="driver" value="${escapeHtml(driverId)}">` : ''}

          <label class="field-label" for="address">Where is it</label>
          <input class="input" type="text" id="address" name="address"
                 value="${escapeHtml(form.address || '')}"
                 placeholder="12 Berdan Ave, Fair Lawn NJ" style="width:100%;">

          <label class="field-label" for="lb" style="display:block;margin-top:14px;">
            Roughly how many pounds
          </label>
          <input class="input" type="number" id="lb" name="lb" step="1" min="1" max="200"
                 value="${escapeHtml(form.lb || '')}" placeholder="25" style="width:100%;">

          <button type="submit" class="btn btn-full" style="margin-top:16px;">Work it out</button>
          <span class="field-hint" style="display:block;margin-top:10px;">
            Nothing is booked and nobody is texted.
          </span>
        </form>

        ${quote ? quoteAnswer(quote, { showMoney }) : ''}
      </div>
    </div>
  </div>

  <p style="font-size:14px;color:var(--ink-500);line-height:1.6;margin:26px 0 0;max-width:64ch;">
    Times are an estimate from average street speed and ${r.minutesPerPickup} minutes
    on the ground per door, ${r.minutesPerPartnerVisit} at a laundromat. They are
    for seeing whether the day fits, not for promising anybody a minute.
  </p>
</div>

<script>
(function () {
  'use strict';

  var DATA = ${JSON.stringify(mapData)};
  var map = null;

  function markerIcon(cls, label) {
    return L.divIcon({
      className: '',
      html: '<div class="db-mk ' + cls + '">' + label + '</div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }

  function start() {
    if (!window.L) {
      document.getElementById('db-map').innerHTML =
        '<div style="padding:26px;font-size:15px;line-height:1.6;">The map did not load. ' +
        'The run sheet below is complete without it.</div>';
      return;
    }

    map = L.map('db-map', { zoomControl: true, scrollWheelZoom: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      detectRetina: true,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    }).addTo(map);

    var pts = [];

    L.marker([DATA.base.lat, DATA.base.lng], { icon: markerIcon('base', 'B') })
      .addTo(map)
      .bindTooltip('Base', { direction: 'right', offset: [14, 0] });
    pts.push([DATA.base.lat, DATA.base.lng]);

    if (DATA.position) {
      L.marker([DATA.position.lat, DATA.position.lng], { icon: markerIcon('van', 'V') })
        .addTo(map)
        .bindTooltip('The van is here', { direction: 'right', offset: [14, 0] });
      pts.push([DATA.position.lat, DATA.position.lng]);
    }

    DATA.partners.forEach(function (p) {
      L.marker([p.lat, p.lng], { icon: markerIcon('partner' + (p.used ? '' : ' unused'), 'L') })
        .addTo(map)
        .bindTooltip(p.name, { direction: 'right', offset: [14, 0] });
      pts.push([p.lat, p.lng]);
    });

    DATA.stops.forEach(function (s) {
      L.marker([s.lat, s.lng], { icon: markerIcon(s.kind, String(s.n)) }).addTo(map);
      pts.push([s.lat, s.lng]);
    });

    // Leaflet reads its container size on creation, and on first paint that
    // size has not settled - fitting immediately lands two zoom levels out.
    // setTimeout rather than a frame callback, which never runs in a tab that
    // is not being painted.
    setTimeout(function () {
      map.invalidateSize();
      if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
      roads();
    }, 0);
  }

  function line(coords, dashed) {
    L.polyline(coords, {
      color: '#101210',
      weight: 3,
      opacity: 0.85,
      dashArray: dashed ? '6 7' : null,
    }).addTo(map);
  }

  function setSource(state, title, note) {
    var dot = document.getElementById('db-src').firstElementChild;
    dot.style.background =
      state === 'road' ? 'var(--suds-500)' : state === 'straight' ? 'var(--sunbeam-500)' : 'var(--paper-300)';
    document.getElementById('db-src-t').textContent = title;
    document.getElementById('db-src-note').textContent = note;
  }

  // OSRM is a free public demo server with nothing promised behind it, so
  // losing it has to be a downgrade rather than a break. When it answers, the
  // line follows real streets and the badge says so. When it does not, the line
  // is drawn straight and DASHED, and the badge says that instead. The two are
  // never mixed and the badge is never quietly dropped - a mileage figure whose
  // provenance is invisible is worse than no figure.
  function roads() {
    var order = [DATA.position || DATA.base].concat(DATA.stops).concat([DATA.base]);
    var straight = order.map(function (p) { return [p.lat, p.lng]; });

    if (DATA.stops.length < 1) {
      setSource('straight', 'Nothing to draw', 'No stops on the map for this day.');
      return;
    }

    var coords = order
      .map(function (p) { return p.lng.toFixed(5) + ',' + p.lat.toFixed(5); })
      .join(';');

    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 8000);

    fetch('https://router.project-osrm.org/route/v1/driving/' + coords + '?overview=full&geometries=geojson', {
      signal: ctl.signal,
    })
      .then(function (res) { if (!res.ok) throw new Error('http ' + res.status); return res.json(); })
      .then(function (json) {
        clearTimeout(timer);
        if (!json || !json.routes || !json.routes.length) throw new Error('no route');
        var route = json.routes[0];
        line(route.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }), false);
        var miles = route.distance / 1609.344;
        setSource(
          'road',
          miles.toFixed(1) + ' road miles',
          'Real driving distance from OSRM, a free public routing service. The ' +
            'figures above are straight-line estimates.'
        );
      })
      .catch(function () {
        clearTimeout(timer);
        line(straight, true);
        setSource(
          'straight',
          'Straight line',
          'The routing service did not answer, so the line is drawn direct and the miles ' +
            'above are straight-line times the road allowance. Treat them as an estimate.'
        );
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
</script>`;
}

// The mid-run answer, in the sidebar rather than as its own page.
function quoteAnswer(q, { showMoney }) {
  // Nothing else booked. Not the same answer as "it fits" - one stop on its own
  // is a trip out for one order, and calling that a fit would be true about the
  // wrong question.
  if (q.empty) {
    return `
  <div style="margin-top:20px;padding:18px;border:2px solid var(--ink-900);border-radius:14px;
              background:var(--sunbeam-500);">
    <p style="margin:0 0 6px;font-family:var(--font-display);font-weight:900;font-size:20px;line-height:1.15;">
      Nothing else is on.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.55;">${escapeHtml(q.detail)}</p>
  </div>`;
  }

  const tone = q.auto ? 'var(--suds-300)' : q.losesMoney ? 'var(--stain-500)' : 'var(--sunbeam-500)';
  const ink = q.losesMoney ? 'var(--paper-050)' : 'var(--ink-900)';

  return `
  <div style="margin-top:20px;padding:18px;border:2px solid var(--ink-900);border-radius:14px;
              background:${tone};color:${ink};">
    <p style="margin:0 0 8px;font-family:var(--font-display);font-weight:900;font-size:20px;line-height:1.15;">
      ${q.auto ? 'Take it.' : q.losesMoney ? 'It loses money.' : 'Your call.'}
    </p>
    <p style="margin:0 0 6px;font-size:15px;line-height:1.55;">
      Slots in at stop ${q.position}. Adds <strong>${Math.round(q.addMin)} minutes</strong>
      and ${q.addMiles.toFixed(1)} miles${
        q.fits ? '' : ', which puts the day over'
      }.
    </p>
    ${
      showMoney && q.revenue != null
        ? `<p style="margin:0;font-size:14px;line-height:1.5;">
             Worth about ${escapeHtml(money0(q.revenue))}, costs
             ${escapeHtml(money(Math.round(q.addCost * 100)))} to drive there.
           </p>`
        : ''
    }
  </div>`;
}

module.exports = { routingBoardBody };
