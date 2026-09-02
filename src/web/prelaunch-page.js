'use strict';

// ---------------------------------------------------------------------------
// The three pre-launch screens: the switch, promotions, and the text blast.
//
// They live in one file because they are one situation - the service is not
// open yet, the number is live, and people are texting it anyway. Splitting
// them across three files would scatter a single decision.
// ---------------------------------------------------------------------------

const { escapeHtml, icon } = require('./layout');
const promotionsCore = require('../core/promotions');
const { config } = require('../config');

function banner(text, tone) {
  if (!text) return '';
  const skin =
    tone === 'bad'
      ? 'border-color:var(--stain-500);background:var(--stain-100);box-shadow:6px 6px 0 var(--stain-500);'
      : 'background:var(--suds-300);';
  return `<p role="${tone === 'bad' ? 'alert' : 'status'}" class="card card-xl"
             style="padding:16px 20px;margin:0 0 24px;font-size:16px;font-weight:600;${skin}">
            ${escapeHtml(text)}
          </p>`;
}

// --- 1. Open or closed ------------------------------------------------------

function settingsBody({ settings, notice, problem }) {
  const open = settings.taking_orders !== false;

  return `
<p class="eyebrow" style="margin:0 0 8px;">The service</p>
<h1 style="margin:0 0 10px;font-size:40px;line-height:1.05;">Are we taking orders?</h1>
<p style="font-size:16px;line-height:1.6;color:var(--ink-700);max-width:62ch;margin:0 0 26px;">
  This changes what the AI says to customers and whether a booking can be made
  at all. Turning it off shuts the text thread, the website form and the
  standing-order job alike.
</p>

${banner(notice, 'good')}
${banner(problem, 'bad')}

<div class="card card-xl" style="padding:0;overflow:hidden;margin-bottom:26px;">
  <div style="padding:26px;background:${open ? 'var(--suds-300)' : 'var(--stain-100)'};
              border-bottom:2px solid var(--ink-900);">
    <p class="eyebrow" style="margin:0 0 6px;">Right now</p>
    <div style="font-family:var(--font-display);font-weight:900;font-size:30px;line-height:1.1;">
      ${open ? 'Open. Taking orders.' : 'Closed. Not taking orders.'}
    </div>
    ${
      !open && settings.paused_reason
        ? `<p style="font-size:16px;line-height:1.6;margin:12px 0 0;">
             <strong>Customers are told:</strong> ${escapeHtml(settings.paused_reason)}
           </p>`
        : ''
    }

    ${
      // WHO IS EXEMPT, SAID ON THE SCREEN THAT CLOSES THE SERVICE.
      //
      // The exemption is configured in the environment, which means its absence
      // is completely silent - everything keeps working and the one person who
      // is meant to be able to book anyway quietly cannot. He would find that
      // out by trying, on the one day it matters. So it is stated here, both
      // ways round, on the screen where the closing actually happens.
      !open
        ? config.alwaysBookNumbers.length
          ? `<p style="font-size:15px;line-height:1.6;margin:14px 0 0;">
               ${config.alwaysBookNumbers.length === 1 ? 'One number is' : `${config.alwaysBookNumbers.length} numbers are`}
               exempt and can still book: ending
               ${config.alwaysBookNumbers.map((n) => escapeHtml(n.slice(-4))).join(', ')}.
             </p>`
          : `<p style="font-size:15px;line-height:1.6;margin:14px 0 0;font-weight:700;color:var(--stain-500);">
               Nobody is exempt - your own number cannot book either. Set
               ALWAYS_BOOK_NUMBERS or SUPPORT_PHONE to change that.
             </p>`
        : ''
    }
  </div>

  <div style="padding:26px;">
    ${
      open
        ? `<form method="post" action="/ops/settings/close">
             <label class="field-label" for="reason">Why are we closed?</label>
             <p class="field-hint" style="margin:0 0 10px;">
               The AI works this into its own sentence rather than reciting it, so
               write it the way you would say it. Leave it blank and it just says
               we are not booking yet.
             </p>
             <input class="field" id="reason" name="reason" type="text" maxlength="300"
                    placeholder="we are still lining up our first laundromat">
             <button class="btn btn-lg" type="submit"
                     style="margin-top:18px;background:var(--stain-500);color:var(--paper-050);">
               Stop taking orders ${icon('arrow-right', '22')}
             </button>
           </form>`
        : `<p style="font-size:16px;line-height:1.6;margin:0 0 18px;max-width:60ch;">
             Turning this back on needs no message. The AI simply starts booking
             again and the reason above is cleared.
           </p>
           <form method="post" action="/ops/settings/open">
             <button class="btn btn-primary btn-lg" type="submit">
               Start taking orders ${icon('arrow-right', '22')}
             </button>
           </form>`
    }
  </div>
</div>

<div class="card card-xl" style="padding:24px;background:var(--paper-200);">
  <p class="eyebrow" style="margin:0 0 10px;">What closed actually does</p>
  <ul style="margin:0;padding-left:20px;font-size:16px;line-height:1.7;color:var(--ink-700);">
    <li>The AI will not book, will not offer a date, and will not collect an
        address to "get you ready"</li>
    <li><code>bookPickup()</code> refuses, so the website form and the standing
        order job are shut too. The AI being talked round changes nothing</li>
    <li>Everything else still works: questions get answered, new numbers are
        still saved, and anyone on a promotion still holds it</li>
  </ul>
</div>`;
}

// --- 2. Promotions ----------------------------------------------------------

function promotionsBody({ list, counts, notice, problem }) {
  const rows = list
    .map((p) => {
      const held = counts[p.id] || { granted: 0, redeemed: 0 };
      return `
  <div class="card card-xl" style="padding:22px 24px;margin-bottom:14px;">
    <div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:flex-start;">
      <div style="min-width:0;flex:1 1 320px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="font-family:var(--font-display);font-weight:900;font-size:22px;">
            ${escapeHtml(p.name)}
          </span>
          ${p.auto_grant ? '<span class="badge" style="background:var(--sunbeam-500);">Auto</span>' : ''}
          ${
            p.status === 'ENDED'
              ? '<span class="badge">Ended</span>'
              : '<span class="badge" style="background:var(--suds-300);">Live</span>'
          }
        </div>
        <p style="font-size:16px;margin:8px 0 0;color:var(--ink-700);">
          ${escapeHtml(promotionsCore.describe(p))}
        </p>
        <p style="font-size:15px;margin:10px 0 0;padding:10px 14px;border:2px solid var(--ink-900);
                  border-radius:10px;background:var(--paper-200);">
          <strong>The AI says:</strong> ${escapeHtml(p.blurb)}
        </p>
      </div>
      <div style="text-align:right;font-family:var(--font-mono);font-size:13px;color:var(--ink-500);">
        <div>${held.granted} given</div>
        <div>${held.redeemed} used</div>
        ${
          p.status === 'ACTIVE'
            ? `<form method="post" action="/ops/promotions/${p.id}/end" style="margin-top:12px;">
                 <button class="btn btn-sm btn-outline">End it</button>
               </form>`
            : ''
        }
      </div>
    </div>
  </div>`;
    })
    .join('');

  return `
<p class="eyebrow" style="margin:0 0 8px;">What we are giving away</p>
<h1 style="margin:0 0 10px;font-size:40px;line-height:1.05;">Promotions</h1>
<p style="font-size:16px;line-height:1.6;color:var(--ink-700);max-width:62ch;margin:0 0 26px;">
  A promotion is applied by code when an order is priced. The AI only ever
  repeats the sentence you write here. It cannot invent a discount, decide who
  qualifies, or work out what anything costs.
</p>

${banner(notice, 'good')}
${banner(problem, 'bad')}

${rows || '<p style="font-size:16px;color:var(--ink-500);margin-bottom:26px;">Nothing running.</p>'}

<div class="card card-xl" style="padding:28px;margin-top:30px;">
  <p class="eyebrow" style="margin:0 0 16px;">New promotion</p>
  <form method="post" action="/ops/promotions" style="display:flex;flex-direction:column;gap:18px;">

    <div>
      <label class="field-label" for="p_name">Name</label>
      <p class="field-hint" style="margin:0 0 8px;">For you and for the order history. A customer never sees it on its own.</p>
      <input class="field" id="p_name" name="name" required maxlength="60" placeholder="Pre-launch 20%">
    </div>

    <div class="grid-2">
      <div>
        <label class="field-label" for="p_kind">What it takes off</label>
        <select class="field" id="p_kind" name="kind">
          <option value="PERCENT_OFF">A percentage</option>
          <option value="AMOUNT_OFF">A fixed amount</option>
        </select>
      </div>
      <div>
        <label class="field-label" for="p_value">How much</label>
        <p class="field-hint" style="margin:0 0 8px;">Percent as a whole number, or dollars.</p>
        <input class="field" id="p_value" name="value" type="number" min="1" step="0.01" required placeholder="20">
      </div>
    </div>

    <div>
      <label class="field-label" for="p_applies">Applies to</label>
      <select class="field" id="p_applies" name="applies_to">
        <option value="FIRST_ORDER">Their first order only</option>
        <option value="EVERY_ORDER">Every order</option>
      </select>
    </div>

    <div>
      <label class="field-label" for="p_blurb">The sentence the AI may say</label>
      <p class="field-hint" style="margin:0 0 8px;">
        Written by you, because a discount is money and the AI never invents money.
        Plain words, no dashes, and it gets worked into a reply rather than quoted.
      </p>
      <input class="field" id="p_blurb" name="blurb" required maxlength="200"
             placeholder="you have 20% off your first order for texting us early">
    </div>

    <label style="display:flex;gap:12px;align-items:flex-start;font-size:16px;line-height:1.5;">
      <input type="checkbox" name="auto_grant" value="yes" style="margin-top:4px;width:22px;height:22px;">
      <span>
        <strong>Give it to every new number automatically.</strong>
        The moment somebody texts in for the first time they hold this, before
        they have booked anything. Only one promotion can do this at a time.
      </span>
    </label>

    <div><button class="btn btn-ink btn-lg" type="submit">Create it ${icon('arrow-right', '22')}</button></div>
  </form>
</div>`;
}

// --- 3. The text blast ------------------------------------------------------

const AUDIENCES = Object.freeze([
  { key: 'ALL', label: 'Everyone who has ever texted us or signed up' },
  { key: 'NEVER_ORDERED', label: 'People who have never had an order' },
  { key: 'CUSTOMERS', label: 'People who have had at least one order' },
]);

function broadcastBody({ counts, recent, notice, problem, draft = '' }) {
  const rows = recent
    .map(
      (b) => `
      <tr>
        <td style="padding:11px 12px 11px 0;border-bottom:1px solid var(--ink-100);
                   font-family:var(--font-mono);font-size:13px;white-space:nowrap;vertical-align:top;">
          ${escapeHtml(new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}
        </td>
        <td style="padding:11px 12px 11px 0;border-bottom:1px solid var(--ink-100);vertical-align:top;">
          ${escapeHtml(b.body)}
        </td>
        <td style="padding:11px 0;border-bottom:1px solid var(--ink-100);text-align:right;
                   font-family:var(--font-mono);font-size:13px;white-space:nowrap;vertical-align:top;">
          ${b.sent_count} sent${
            b.skipped_count
              ? `<br><span style="color:var(--ink-500);">${b.skipped_count} skipped</span>`
              : ''
          }
        </td>
      </tr>`
    )
    .join('');

  return `
<p class="eyebrow" style="margin:0 0 8px;">One message, everybody</p>
<h1 style="margin:0 0 10px;font-size:40px;line-height:1.05;">Send a text blast</h1>
<p style="font-size:16px;line-height:1.6;color:var(--ink-700);max-width:62ch;margin:0 0 26px;">
  Goes to every number in the group you pick, from our own number, and is
  logged in each person's thread like any other message.
</p>

${banner(notice, 'good')}
${banner(problem, 'bad')}

<div class="card card-xl" style="padding:24px;margin-bottom:24px;border-color:var(--stain-500);
            box-shadow:6px 6px 0 var(--stain-500);background:var(--stain-100);">
  <p class="eyebrow" style="margin:0 0 10px;">Before you send</p>
  <ul style="margin:0;padding-left:20px;font-size:16px;line-height:1.7;">
    <li><strong>Anyone who replied STOP is never included</strong>, whatever
        group you pick. That is not a setting and cannot be turned off.</li>
    <li>Everyone here gave us their number themselves, by texting us or by
        ticking the box. Keep it about laundry: a blast that reads as marketing
        to somebody who signed up for a pickup is how a number gets reported
        and blocked.</li>
    <li>There is no undo. A text is gone the moment it sends.</li>
  </ul>
</div>

<div class="card card-xl" style="padding:28px;margin-bottom:34px;">
  <form method="post" action="/ops/broadcast" style="display:flex;flex-direction:column;gap:18px;">

    <div>
      <label class="field-label" for="b_audience">Who gets it</label>
      <select class="field" id="b_audience" name="audience">
        ${AUDIENCES.map(
          (a) => `<option value="${a.key}">${escapeHtml(a.label)} (${counts[a.key] || 0})</option>`
        ).join('')}
      </select>
    </div>

    <div>
      <label class="field-label" for="b_body">The message</label>
      <p class="field-hint" style="margin:0 0 8px;">
        Plain words. 160 characters is one segment and carriers bill per segment,
        so a long message costs double to everybody at once.
      </p>
      <textarea class="field" id="b_body" name="body" rows="4" required maxlength="480"
                placeholder="It's LYNDRY. We open next week and you are first in line.">${escapeHtml(draft)}</textarea>
    </div>

    <label style="display:flex;gap:12px;align-items:flex-start;font-size:16px;line-height:1.5;">
      <input type="checkbox" name="confirm" value="yes" required style="margin-top:4px;width:22px;height:22px;">
      <span>I have read it back and I want it sent.</span>
    </label>

    <div><button class="btn btn-ink btn-lg" type="submit">Send it ${icon('arrow-right', '22')}</button></div>
  </form>
</div>

${
  recent.length
    ? `<h2 style="font-family:var(--font-display);font-weight:900;font-size:26px;margin:0 0 14px;">Already sent</h2>
       <div style="overflow-x:auto;">
         <table style="width:100%;border-collapse:collapse;font-size:15px;min-width:520px;">
           <thead><tr>
             <th style="text-align:left;padding:0 12px 10px 0;border-bottom:2px solid var(--ink-900);
                        font-family:var(--font-mono);font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">When</th>
             <th style="text-align:left;padding:0 12px 10px 0;border-bottom:2px solid var(--ink-900);
                        font-family:var(--font-mono);font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">Message</th>
             <th style="text-align:right;padding:0 0 10px 0;border-bottom:2px solid var(--ink-900);
                        font-family:var(--font-mono);font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">Reach</th>
           </tr></thead>
           <tbody>${rows}</tbody>
         </table>
       </div>`
    : ''
}`;
}

module.exports = { settingsBody, promotionsBody, broadcastBody, AUDIENCES };
