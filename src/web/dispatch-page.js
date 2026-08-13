'use strict';

const { escapeHtml } = require('./layout');
const { config } = require('../config');

// ---------------------------------------------------------------------------
// /ops/dispatch - can we take this one?
//
// An order comes in while the driver is out. This page answers the only
// question that matters: does it fit into what he is already doing, and what
// does saying yes cost.
//
// Deliberately NOT a map. The answer is a number of minutes, and a map invites
// somebody to second-guess a sequence that is already physical - bags are in
// the van with numbers on them, and the one thing this must never do is
// suggest re-ordering them.
// ---------------------------------------------------------------------------

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

function stopRow(stop, index) {
  const c = stop.order.customers || {};
  const address = [c.address_line1, c.city].filter(Boolean).join(', ');
  const deliver = stop.kind === 'deliver';

  return `
  <div style="display:flex;gap:14px;align-items:center;padding:12px 0;border-bottom:1px solid var(--ink-100);">
    <span style="flex:none;width:34px;height:34px;border:2px solid var(--ink-900);border-radius:10px;
                 background:${deliver ? 'var(--suds-500)' : 'var(--lilac-500)'};
                 display:flex;align-items:center;justify-content:center;
                 font-family:var(--font-mono);font-weight:700;font-size:14px;">${index + 1}</span>
    <div style="flex:1;min-width:0;">
      <div style="font-weight:600;font-size:15px;">
        #${stop.order.order_number} &middot; ${escapeHtml(c.name || 'Unknown')}
      </div>
      <div style="font-size:14px;color:var(--ink-700);">${escapeHtml(address || 'No address')}</div>
    </div>
    <span class="eyebrow" style="margin:0;white-space:nowrap;">
      ${deliver ? 'Deliver' : 'Collect'}${stop.at ? '' : ' &middot; no map'}
    </span>
  </div>`;
}

function answerCard(q) {
  if (q.empty) {
    return `
    <div class="card card-xl" style="padding:26px;background:var(--sunbeam-500);">
      <p class="eyebrow" style="margin:0 0 8px;">Nothing to fit it into</p>
      <div style="font-family:var(--font-display);font-weight:900;font-size:26px;line-height:1.15;">
        This would be a trip on its own
      </div>
      <p style="font-size:15px;line-height:1.6;margin:12px 0 0;">${escapeHtml(q.detail)}</p>
    </div>`;
  }

  // Three outcomes, and they are genuinely different answers rather than
  // shades of the same one: take it without asking, take it but somebody
  // should look, or the day is full.
  const tone = !q.fits
    ? { bg: 'var(--stain-500)', fg: 'var(--paper-050)', head: 'The day is full' }
    : q.losesMoney
      ? { bg: 'var(--stain-500)', fg: 'var(--paper-050)', head: 'Costs more than it bills' }
      : q.auto
        ? { bg: 'var(--suds-500)', fg: 'var(--ink-900)', head: 'Take it' }
        : { bg: 'var(--sunbeam-500)', fg: 'var(--ink-900)', head: 'Your call' };

  return `
  <div class="card card-xl" style="padding:26px;background:${tone.bg};color:${tone.fg};margin-bottom:22px;">
    <p class="eyebrow" style="margin:0 0 8px;color:${tone.fg};">
      ${q.auto ? `Under the ${q.threshold} minute threshold` : 'Needs a decision'}
    </p>
    <div style="font-family:var(--font-display);font-weight:900;font-size:34px;line-height:1.05;">
      ${escapeHtml(tone.head)}
    </div>
    <p style="font-size:16px;line-height:1.6;margin:12px 0 0;">
      ${
        !q.fits
          ? `Taking this pushes the run to ${Math.round(q.runAfter)} minutes, past the
             ${q.dayMinutes} the van is out for. Offer them tomorrow.`
          : q.losesMoney
            ? `The detour costs ${money(Math.round(q.addCost * 100))} and the bag would bill
               about ${money(q.revenue)}. It fits the day and still loses money - offer
               them tomorrow, when they might be on the way to somebody else.`
          : q.auto
            ? `It adds ${Math.round(q.addMin)} minutes to a ${Math.round(q.runBefore)} minute run.
               Small enough that nobody needs to be asked.`
            : `It adds ${Math.round(q.addMin)} minutes, which is over the
               ${q.threshold} minute threshold. It still fits the day.`
      }
    </p>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:22px;">
    ${[
      ['Slots in at', `stop ${q.position}`],
      ['Adds', `${Math.round(q.addMin)} min`],
      ['Extra driving', `${q.addMiles.toFixed(1)} mi`],
      ['Costs', money(Math.round(q.addCost * 100))],
      q.revenue == null ? null : ['Bills about', money(q.revenue)],
      ['Run becomes', `${Math.round(q.runAfter)} of ${q.dayMinutes} min`],
    ]
      .filter(Boolean)
      .map(
        ([k, v]) => `
      <div class="card" style="padding:16px 18px;">
        <div class="eyebrow" style="margin:0;">${escapeHtml(k)}</div>
        <div style="font-family:var(--font-display);font-weight:900;font-size:24px;line-height:1.1;margin-top:6px;">
          ${escapeHtml(v)}
        </div>
      </div>`
      )
      .join('')}
  </div>

  <p style="font-size:14px;color:var(--ink-500);line-height:1.6;max-width:62ch;">
    <strong>Nothing has been booked.</strong> This is arithmetic, not an action -
    book it the usual way once you have decided. The stop number is where it
    would land in the run as it stands; the bags already in the van keep the
    numbers on their tags.
  </p>`;
}

function dispatchBody({ run, quote, form = {}, problem = null }) {
  const r = config.routing;
  const full = run.totalMin >= r.workingDayMinutes;

  return `
<div style="max-width:820px;">
  <p class="eyebrow" style="margin:0 0 8px;">Dispatch</p>
  <h1 style="margin:0 0 14px;font-size:40px;line-height:1.05;">Can we take this one?</h1>
  <p style="font-size:16px;line-height:1.6;color:var(--ink-700);max-width:62ch;margin:0 0 28px;">
    An order comes in while the driver is out. This works out where it would
    slot into today's run and what taking it costs. It only ever answers for a
    <strong>pickup</strong> - a delivery needs a bag that is already on the van,
    and it is not.
  </p>

  ${
    problem
      ? `<p style="margin:0 0 22px;padding:14px 17px;border:2px solid var(--ink-900);border-radius:12px;
                   background:var(--stain-500);color:var(--paper-050);font-weight:700;">${escapeHtml(problem)}</p>`
      : ''
  }

  <div class="card card-xl" style="padding:26px;margin-bottom:28px;">
    <form method="get" action="/ops/dispatch">
      <label class="field-label" for="address">Where is it</label>
      <input class="input input-lg" type="text" id="address" name="address" required autofocus
             value="${escapeHtml(form.address || '')}"
             placeholder="12 Berdan Ave, Fair Lawn NJ" style="width:100%;">

      <label class="field-label" for="lb" style="display:block;margin-top:18px;">
        Roughly how many pounds (optional)
      </label>
      <input class="input input-lg" type="number" id="lb" name="lb" step="1" min="1" max="200"
             value="${escapeHtml(form.lb || '')}" placeholder="25" style="width:100%;">

      <button type="submit" class="btn btn-lg btn-full" style="margin-top:20px;">Work it out</button>
      <span class="field-hint" style="display:block;margin-top:10px;">
        Nothing is booked and nobody is texted. Looking up an address takes a second.
      </span>
    </form>
  </div>

  ${quote ? answerCard(quote) : ''}

  <div class="card card-xl" style="padding:26px;margin-top:28px;">
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;justify-content:space-between;margin-bottom:10px;">
      <h2 style="font-family:var(--font-display);font-weight:900;font-size:26px;margin:0;">Today's run</h2>
      <span class="eyebrow" style="margin:0;color:${full ? 'var(--stain-500)' : 'var(--ink-500)'};">
        ${Math.round(run.totalMin)} of ${r.workingDayMinutes} min &middot; ${run.miles.toFixed(1)} mi
      </span>
    </div>

    ${
      run.stops.length
        ? run.stops.map(stopRow).join('') +
          (run.unplaced
            ? `<p style="font-size:14px;color:var(--ink-500);margin:16px 0 0;line-height:1.6;">
                 ${run.unplaced} stop${run.unplaced === 1 ? '' : 's'} could not be placed on the map
                 and ${run.unplaced === 1 ? 'is' : 'are'} sorted last. They still have to be driven to.
               </p>`
            : '')
        : `<p style="margin:0;font-size:16px;color:var(--ink-500);line-height:1.6;">
             Nothing booked for today and nothing in the van.
           </p>`
    }
  </div>

  <p style="font-size:14px;color:var(--ink-500);line-height:1.6;margin:22px 0 0;max-width:62ch;">
    Distances are straight lines with a ${r.roadFactor}x road allowance, not real
    driving miles. That is deliberate: a rough answer now beats an exact one
    after a network call, and the planner is where exact miles live.
  </p>
</div>`;
}

module.exports = { dispatchBody };
