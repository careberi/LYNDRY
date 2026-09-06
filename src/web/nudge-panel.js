'use strict';

const { escapeHtml } = require('./layout');

// ---------------------------------------------------------------------------
// WHAT IS STILL MISSING FROM THIS CUSTOMER, AND ONE BUTTON PER THING.
//
// Rendered on the customer page and on the order page, from one function,
// because two copies of "what do we still need" would disagree the first time
// one of them learned something the other did not.
//
// EVERY BUTTON SHOWS THE EXACT WORDS IT SENDS. That is the whole reason the
// messages are written in code rather than by the AI: a person can read the
// text before a real phone gets it. A button labelled "ask for a card" that
// sends something you have never seen is not a button anybody should press.
// ---------------------------------------------------------------------------

// One gap: what it is, why it matters, and the message waiting behind it.
function gapCard(gap, { action, canSend, primary }) {
  const cost =
    gap.cost.segments === 1
      ? '1 segment'
      : `${gap.cost.segments} segments`;

  return `
    <div class="card" style="padding:20px 22px;${
      primary ? 'background:var(--paper-050);' : ''
    }">
      <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;justify-content:space-between;">
        <p class="eyebrow" style="margin:0;">${escapeHtml(gap.title)}</p>
        <span style="font-family:var(--font-mono);font-size:11px;text-transform:uppercase;
                     letter-spacing:0.08em;color:var(--ink-500);">
          ${escapeHtml(cost)}${gap.blocks ? ' &middot; blocks booking' : ''}
        </span>
      </div>

      <p style="margin:10px 0 0;font-size:15px;line-height:1.55;color:var(--ink-700);">
        ${escapeHtml(gap.why)}
      </p>

      <p style="margin:14px 0 0;padding:14px 16px;border:2px solid var(--ink-900);border-radius:12px;
                background:var(--paper-000);font-size:15px;line-height:1.55;white-space:pre-wrap;"
         >${escapeHtml(gap.text)}</p>

      ${
        gap.approximate
          ? `<p style="margin:8px 0 0;font-size:13px;color:var(--ink-500);line-height:1.5;">
               The card link is created when you press the button, so the address
               above is shown short. Everything else is word for word.
             </p>`
          : ''
      }

      ${
        canSend
          ? `<form method="post" action="${action}" style="margin:16px 0 0;">
               <input type="hidden" name="gap" value="${escapeHtml(gap.key)}">
               <button class="btn ${primary ? 'btn-ink' : 'btn-outline'}" type="submit">
                 Send it
               </button>
             </form>`
          : ''
      }
    </div>`;
}

// The whole panel. `gaps` comes from nudges.gapsFor().
function nudgePanel({ gaps, action, canSend, heading = 'What is still missing' }) {
  if (!gaps.length) {
    return `
      <div class="card" style="padding:18px 22px;margin-bottom:28px;">
        <p style="margin:0;font-size:16px;line-height:1.55;">
          <strong>Nothing to chase.</strong> They are set up, they have a card on
          file, and a pickup is booked.
        </p>
      </div>`;
  }

  const blocking = gaps.filter((g) => g.blocks).length;

  return `
    <div style="margin-bottom:32px;">
      <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;margin-bottom:6px;">
        <h2 style="font-family:var(--font-display);font-weight:800;font-size:24px;margin:0;">
          ${escapeHtml(heading)}
        </h2>
        <span class="badge" style="background:var(--${blocking ? 'sunbeam-500' : 'suds-300'});">
          ${gaps.length} to ask for
        </span>
      </div>

      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:var(--ink-700);max-width:64ch;">
        ${
          blocking
            ? `<strong>${
                blocking === 1 ? 'One of these stops' : `${blocking} of these stop`
              } a booking going through.</strong> `
            : ''
        }Ask for the first one and the AI carries on from there - it reads the
        thread before it replies, so whatever they send back is handled in the
        conversation like any other message. You do not have to press all of them.
      </p>

      <div style="display:flex;flex-direction:column;gap:14px;">
        ${gaps
          .map((gap, i) => gapCard(gap, { action, canSend, primary: i === 0 }))
          .join('')}
      </div>
    </div>`;
}

module.exports = { nudgePanel };
