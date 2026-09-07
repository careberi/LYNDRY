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
const booking = require('../core/booking');
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

// ---------------------------------------------------------------------------
// THE ADMIN DASHBOARD: everything you decide, on one page.
//
// NEIL'S CONSOLIDATION. Taking orders, promotions, text blasts and the weight
// thresholds were four screens, three of which you visit to read one number and
// leave. That is four taps to answer "what is the state of the business", and
// the closed sign in particular lives on a screen nobody opens daily - which is
// exactly why there is a banner shouting about it on every other page.
//
// WHAT IS INLINE AND WHAT STAYS A LINK, and the rule is not arbitrary: a
// control that is one field and one button lives here; a control that needs its
// own screen keeps it. Turning orders off is a toggle and a reason. Setting
// three thresholds is three numbers. Writing a text to every customer you have
// is not, and neither is creating a promotion - those get a summary and a way
// through, because putting them inline would make this the page somebody sends
// a blast from by accident.
//
// Nothing here is a second implementation. Every form posts to the route that
// already existed, and the summaries read what the full screens read.
// ---------------------------------------------------------------------------

// What the follow-up card says. Two numbers rather than one, because they are
// different promises: a chase only happens if the customer stays quiet, a
// reminder happens because a van is coming.
function scheduledLine({ chases = 0, reminders = 0 } = {}) {
  const bits = [];
  if (chases) bits.push(`${chases} follow-up${chases === 1 ? '' : 's'}`);
  if (reminders) bits.push(`${reminders} reminder${reminders === 1 ? '' : 's'}`);
  return bits.length ? `${bits.join(', ')} queued` : 'Nothing queued';
}

function adminDashboardBody({
  settings,
  limits,
  promotions = [],
  openIssues = 0,
  orderCounts = {},
  scheduled = {},
  notice,
  problem,
}) {
  const open = settings.taking_orders !== false;
  const running = promotions.filter((p) => p.status === 'ACTIVE');

  const stat = (label, value, bg) => `
    <div class="card" style="padding:16px 20px;min-width:120px;flex:1 1 120px;${
      bg ? `background:${bg};` : ''
    }">
      <div style="font-family:var(--font-display);font-weight:900;font-size:26px;line-height:1;">${value}</div>
      <div class="eyebrow" style="margin:6px 0 0;">${escapeHtml(label)}</div>
    </div>`;

  const card = (c) => `
  <a href="${c.href}" style="display:block;text-decoration:none;color:inherit;">
    <div class="card" style="padding:22px;height:100%;">
      <p class="eyebrow" style="margin:0 0 6px;">${escapeHtml(c.eyebrow)}</p>
      <div style="font-family:var(--font-display);font-weight:900;font-size:21px;margin-bottom:8px;">
        ${escapeHtml(c.title)}
      </div>
      <p style="font-size:14px;line-height:1.5;color:var(--ink-700);margin:0;">${escapeHtml(c.line)}</p>
    </div>
  </a>`;

  return `
<p class="eyebrow" style="margin:0 0 8px;">The business</p>
<h1 style="margin:0 0 10px;font-size:40px;line-height:1.05;">Admin dashboard</h1>
<p style="font-size:16px;line-height:1.6;color:var(--ink-700);max-width:62ch;margin:0 0 26px;">
  Everything you decide, in one place. The day itself - orders, the route,
  routing - is under Dashboard.
</p>

${banner(notice, 'good')}
${banner(problem, 'bad')}

<div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:34px;">
  ${stat('Taking orders', open ? 'Yes' : 'No', open ? 'var(--suds-300)' : 'var(--stain-100)')}
  ${stat('Open issues', openIssues, openIssues ? 'var(--stain-100)' : undefined)}
  ${stat('Promotions', running.length)}
  ${stat('With us now', orderCounts.withUs || 0)}
  ${stat('To collect', orderCounts.toCollect || 0)}
</div>

<div class="card card-xl" style="padding:0;overflow:hidden;margin-bottom:24px;">
  <div style="padding:24px;background:${open ? 'var(--suds-300)' : 'var(--stain-100)'};
              border-bottom:2px solid var(--ink-900);">
    <p class="eyebrow" style="margin:0 0 6px;">Right now</p>
    <div style="font-family:var(--font-display);font-weight:900;font-size:26px;line-height:1.1;">
      ${open ? 'Open. Taking orders.' : 'Closed. Not taking orders.'}
    </div>
    ${
      !open && settings.paused_reason
        ? `<p style="font-size:15px;line-height:1.6;margin:10px 0 0;">
             <strong>Customers are told:</strong> ${escapeHtml(settings.paused_reason)}
           </p>`
        : ''
    }
    ${
      !open
        ? config.alwaysBookNumbers.length
          ? `<p style="font-size:14px;line-height:1.6;margin:10px 0 0;">
               Exempt and can still book: ending
               ${config.alwaysBookNumbers.map((n) => escapeHtml(n.slice(-4))).join(', ')}.
             </p>`
          : `<p style="font-size:14px;line-height:1.6;margin:10px 0 0;font-weight:700;color:var(--stain-500);">
               Nobody is exempt - your own number cannot book either.
             </p>`
        : ''
    }
  </div>

  <div style="padding:24px;">
    ${
      open
        ? `<form method="post" action="/ops/settings/close">
             <label class="field-label" for="reason">Why are we closed?</label>
             <input class="field" id="reason" name="reason" type="text" maxlength="300"
                    placeholder="we are still lining up our first laundromat"
                    style="width:100%;margin-bottom:12px;">
             <button class="btn btn-lg" type="submit">Stop taking orders</button>
           </form>`
        : `<form method="post" action="/ops/settings/open">
             <button class="btn btn-primary btn-lg" type="submit">Start taking orders</button>
           </form>`
    }
  </div>
</div>

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));
            grid-auto-rows:1fr;gap:18px;">
  ${[
    {
      href: '/ops/promotions',
      eyebrow: 'Giving money away',
      title: 'Promotions',
      line: running.length ? running.map((p) => p.name).join(', ') : 'Nothing running',
    },
    {
      href: '/ops/broadcast',
      eyebrow: 'Everybody at once',
      title: 'Text blast',
      line: 'One message to every customer who has not opted out',
    },
    {
      // The other thing that texts customers without anybody pressing send.
      // It belongs beside Promotions and the text blast for the same reason
      // they are here: all three are an owner deciding what customers hear.
      href: '/ops/scheduled',
      eyebrow: 'Texts nobody has to send',
      title: 'Customer follow-up',
      line: scheduledLine(scheduled),
    },
    {
      href: '/ops/issues',
      eyebrow: 'Waiting on a person',
      title: 'Issues',
      line: openIssues ? `${openIssues} open` : 'Nothing open',
    },
    {
      href: '/ops',
      eyebrow: 'Where everything is',
      title: 'Orders',
      line: `${orderCounts.toCollect || 0} to collect, ${orderCounts.withUs || 0} with us`,
    },
    {
      // Three weights side by side and the money beside them. It reads real
      // orders, so it belongs with the rest of what an owner checks rather
      // than with the two what-if calculators under Tools.
      href: '/ops/reports',
      eyebrow: 'Three weights',
      title: 'Weight and money report',
      line: 'Every order that went to a laundromat, ours against theirs',
    },
    {
      // Was a full-width form in the middle of this page. It is a thing you go
      // and change, not a thing you read, so it reads as a card like the rest.
      href: '/ops/weights',
      eyebrow: 'How far apart is too far',
      title: 'Weight thresholds',
      line: `Normal to ${limits.weight_normal_pct}%, exception past ${limits.weight_acceptable_pct}%`,
    },
  ]
    .map(card)
    .join('')}
</div>`;
}

// THE WEIGHT THRESHOLDS, on their own page.
//
// They were a full-width card in the middle of the Admin dashboard, which made
// that page a list of six small cards with one enormous form dropped into it.
// Neil's call: it is a screen you visit to change something, not something you
// read at a glance, so it gets a card like everything else and lives behind it.
//
// The markup is the same and the form still posts to the same route - only
// where it lands afterwards changed, from the dashboard back to here.
function weightLimitsBody({ limits, notice, problem }) {
  return `
<p class="eyebrow" style="margin:0 0 8px;">Admin</p>
<h1 style="margin:0 0 10px;font-size:40px;line-height:1.05;">Weight thresholds</h1>
<p style="font-size:16px;line-height:1.6;color:var(--ink-700);max-width:62ch;margin:0 0 26px;">
  How far two scales may disagree before an order stops and waits for a person.
  One set of numbers for every laundromat.
</p>

${banner(notice, 'good')}
${banner(problem, 'bad')}

<div class="card card-xl" style="padding:26px;margin-bottom:24px;">
  <p class="eyebrow" style="margin:0 0 6px;">Two scales</p>
  <h2 style="font-family:var(--font-display);font-weight:900;font-size:24px;margin:0 0 10px;">
    How far apart is too far
  </h2>
  <p style="font-size:15px;line-height:1.6;color:var(--ink-700);max-width:62ch;margin:0 0 18px;">
    The customer is charged the <strong>heavier</strong> of our weight and the
    laundromat's, always. The laundromat is billed <strong>their own</strong>
    figure - unless the two are further apart than the exception line, and then
    nothing is invoiced until you decide it.
  </p>

  <form method="post" action="/ops/admin/weights"
        style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;">
    <div style="flex:1 1 130px;">
      <label class="field-label" for="np">Normal up to</label>
      <div style="display:flex;align-items:center;gap:6px;">
        <input class="field" id="np" name="normal_pct" type="number" step="0.5" min="0" max="50"
               value="\${escapeHtml(String(limits.normalPct))}" required style="min-width:0;">
        <span style="font-weight:700;">%</span>
      </div>
    </div>
    <div style="flex:1 1 130px;">
      <label class="field-label" for="ap">Acceptable up to</label>
      <div style="display:flex;align-items:center;gap:6px;">
        <input class="field" id="ap" name="acceptable_pct" type="number" step="0.5" min="0" max="50"
               value="\${escapeHtml(String(limits.acceptablePct))}" required style="min-width:0;">
        <span style="font-weight:700;">%</span>
      </div>
    </div>
    <div style="flex:1 1 130px;">
      <label class="field-label" for="ml">Always allow at least</label>
      <div style="display:flex;align-items:center;gap:6px;">
        <input class="field" id="ml" name="min_lb" type="number" step="0.5" min="0" max="20"
               value="\${escapeHtml(String(limits.minLb))}" required style="min-width:0;">
        <span style="font-weight:700;">lb</span>
      </div>
    </div>
    <div style="flex:1 1 100%;padding-top:18px;margin-top:6px;border-top:2px solid var(--ink-100);">
      <p class="eyebrow" style="margin:0 0 6px;">Dirty in against clean out</p>
      <p style="font-size:15px;line-height:1.6;color:var(--ink-700);max-width:62ch;margin:0 0 14px;">
        A different question, so it has its own numbers. Water and grit come out
        in the wash, so laundry comes back <strong>lighter</strong> - that is
        normal and this says how much. Heavier is never normal, whatever the
        load weighs, so that one is a flat allowance rather than a percentage.
      </p>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;">
        <div style="flex:1 1 150px;">
          <label class="field-label" for="dl">May come back lighter by</label>
          <div style="display:flex;align-items:center;gap:6px;">
            <input class="field" id="dl" name="dry_loss_pct" type="number" step="0.5" min="0" max="50"
                   value="\${escapeHtml(String(limits.dryLossPct))}" required style="min-width:0;">
            <span style="font-weight:700;">%</span>
          </div>
        </div>
        <div style="flex:1 1 150px;">
          <label class="field-label" for="gl">May come back heavier by</label>
          <div style="display:flex;align-items:center;gap:6px;">
            <input class="field" id="gl" name="gain_lb" type="number" step="0.1" min="0" max="10"
                   value="\${escapeHtml(String(limits.gainLb))}" required style="min-width:0;">
            <span style="font-weight:700;">lb</span>
          </div>
        </div>
      </div>
    </div>

    <button class="btn btn-ink btn-lg" type="submit">Save</button>
  </form>

  <p class="field-hint" style="margin-top:14px;max-width:62ch;">
    The pounds figure is a floor, and it matters as much as the percentages:
    5% of a 10 lb bag is half a pound, which is inside what two honest scales
    differ by. Without it every small order would raise an exception.
    <strong>One set of numbers for every laundromat</strong> - a bad scale is
    something to replace, not something to make allowances for.
  </p>
</div>`;
}

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

${
  // DID LAST NIGHT'S TEXTS ACTUALLY GO OUT.
  //
  // Standing orders and the day-before pickup reminders both hang off one pass
  // that runs each evening, and its whole failure mode is silence: it either
  // runs, or nothing happens and nobody is told. It used to be a cron service
  // nobody had set up, which is exactly that failure with nowhere to see it.
  // So the last night it completed is said out loud, on the screen about how
  // the service is running.
  (() => {
    const ran = settings.nightly_ran_on || null;
    const today = booking.today();
    const yesterday = booking.addDays(today, -1);

    // Ran today or last night is normal. Anything older, or never, is worth
    // looking at - though "never" is also what a brand new deployment says,
    // so it is phrased as a fact rather than an alarm.
    const recent = ran === today || ran === yesterday;

    return `<div class="card" style="padding:16px 20px;margin-bottom:26px;${
      recent ? '' : 'background:var(--sunbeam-500);'
    }">
      <p style="margin:0;font-size:15px;line-height:1.6;">
        <strong>Evening texts</strong> - standing orders booked, and everybody
        reminded their pickup is tomorrow.
        ${
          ran
            ? `Last ran <strong>${escapeHtml(booking.readableDate(ran))}</strong>.`
            : `<strong>Has not run yet.</strong>`
        }
        ${recent ? '' : 'It runs between 6pm and 9pm New Jersey time, every evening.'}
      </p>
    </div>`;
  })()
}

${
  // THE OTHER THING THAT TEXTS PEOPLE ON ITS OWN. Beside the evening line
  // rather than buried, because the two are the same kind of switch: things
  // that speak to customers while nobody is watching.
  (() => {
    const chasing = settings.follow_ups_on !== false;
    return `<div class="card" style="padding:16px 20px;margin-bottom:26px;">
      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;">
        <p style="margin:0;font-size:15px;line-height:1.6;max-width:60ch;">
          <strong>Follow-ups</strong> - when the AI asks somebody a question and
          they go quiet, it chases once a day later and then never again.
          ${
            chasing
              ? 'Switching the AI off on one conversation already stops that one.'
              : '<strong>Off. Nobody is being chased.</strong>'
          }
        </p>
        <form method="post" action="/ops/settings/follow-ups" style="margin:0;display:flex;gap:12px;align-items:center;">
          <span class="badge" style="background:var(--${chasing ? 'suds-300' : 'sunbeam-500'});">
            ${chasing ? 'On' : 'Off'}
          </span>
          <input type="hidden" name="state" value="${chasing ? 'off' : 'on'}">
          <button class="btn btn-outline btn-sm" type="submit">
            Switch them ${chasing ? 'off' : 'on'}
          </button>
        </form>
      </div>
    </div>`;
  })()
}

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
      // ways route, on the screen where the closing actually happens.
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

<!-- OPEN FOR BOOKINGS, VAN NOT RUNNING YET. A different thing from the switch
     above and it deserves its own card: closed means nobody can book at all,
     this means everybody can book and the first van comes later. It is what a
     launch actually needs - the pipeline fills while the round is still being
     set up. -->
<div class="card card-xl" style="padding:24px;margin-bottom:26px;">
  <p class="eyebrow" style="margin:0 0 8px;">The first day we collect</p>
  <h2 style="font-family:var(--font-display);font-weight:800;font-size:24px;margin:0 0 10px;">
    ${
      settings.opens_on
        ? `Booking now, collecting from ${escapeHtml(String(settings.opens_on).slice(0, 10))}`
        : 'Collecting any day'
    }
  </h2>
  <p style="font-size:16px;line-height:1.6;color:var(--ink-700);max-width:62ch;margin:0 0 18px;">
    ${
      settings.opens_on
        ? `Customers can book today, and the earliest pickup anyone can choose is
           that date. The AI offers it, the website picker starts there, and
           <code>bookPickup()</code> refuses anything sooner.`
        : `Nothing is holding pickups back. Set a date here if you want to take
           bookings before the van starts running.`
    }
  </p>
  <form method="post" action="/ops/settings/opens-on"
        style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
    <div>
      <label class="field-label" for="opens_on">First collection day</label>
      <input class="input input-lg" type="date" id="opens_on" name="opens_on"
             value="${settings.opens_on ? escapeHtml(String(settings.opens_on).slice(0, 10)) : ''}">
    </div>
    <button class="btn btn-primary btn-lg" type="submit">Save it</button>
    ${
      settings.opens_on
        ? // A DIFFERENT NAME FROM THE DATE FIELD. Sharing it meant a click sent
          // both - the typed date AND this empty one - and Express turns two
          // values of one name into an array, so clearing it would have been
          // read as the malformed date "2026-09-08,".
          `<button class="btn btn-lg" type="submit" name="clear" value="1">
             Clear it - collect any day
           </button>`
        : ''
    }
  </form>
  <p style="font-size:14px;line-height:1.55;color:var(--ink-500);margin:16px 0 0;">
    A date that has passed counts as no date, so nobody has to remember to clear
    it. Your own number is exempt, the same as it is from the closed sign.
  </p>
</div>

<div class="card card-xl" style="padding:24px;background:var(--paper-200);">
  <p class="eyebrow" style="margin:0 0 10px;">What closed actually does</p>
  <ul style="margin:0;padding-left:20px;font-size:16px;line-height:1.7;color:var(--ink-700);">
    <li>The AI will not book, will not offer a date, and will not collect an
        address to "get you ready"</li>
    <li><code>bookPickup()</code> refuses, so the website form and the standing
        order job are shut too. The AI being talked route changes nothing</li>
    <li>Everything else still works: questions get answered, new numbers are
        still saved, and anyone on a promotion still holds it</li>
  </ul>
</div>`;
}

// --- 2. Promotions ----------------------------------------------------------

// --- 2. Promotions ----------------------------------------------------------
//
// A PROMOTION WAS ALREADY AN OBJECT ATTACHED TO A PERSON rather than a code -
// customer_promotions has recorded who holds what, whether they spent it and
// on which order since the day it was written. What it could not say was who
// should GET one, or for how long. This screen is where those two live.
//
// Everything on it is one of four questions, in this order: what is the offer,
// who is it for, how long does it last, and what may the AI say about it. The
// old form asked them all at once in a flat list, so "applies to" was quietly
// answering two of them.

// One promotion as a campaign card rather than a row.
function promotionCard(p, counts) {
  const held = counts[p.id] || { granted: 0, claimed: 0, redeemed: 0 };
  const aud = promotionsCore.audienceOf(p.audience);
  const ended = p.status === 'ENDED';

  // RUN OUT IS NOT THE SAME AS ENDED. Ended is a decision somebody took; this
  // is an offer that did exactly what it was set up to do.
  //
  // COUNTED IN ORDERS, NOT PEOPLE. A capped promotion is handed to everybody
  // and the slot is taken when a pickup is booked, so "given out" can be 200
  // while "taken" is 20 and it has run out.
  const gone = Boolean(p.max_orders) && held.claimed >= p.max_orders;

  // Only an audience that describes a group can be handed out in one go. The
  // automatic one needs no button and the by-hand one has no list to work from.
  const issuable = !ended && (p.audience === 'NEVER_ORDERED' || p.audience === 'EVERYONE');

  const stat = (n, label) => `
    <div style="text-align:right;">
      <div style="font-family:var(--font-display);font-weight:900;font-size:26px;line-height:1;
                  font-variant-numeric:tabular-nums;">${n}</div>
      <div class="eyebrow" style="margin:4px 0 0;">${escapeHtml(label)}</div>
    </div>`;

  return `
  <div class="card card-xl" style="padding:24px;margin-bottom:16px;${ended ? 'opacity:0.72;' : ''}">
    <div style="display:flex;flex-wrap:wrap;gap:20px;justify-content:space-between;align-items:flex-start;">
      <div style="min-width:0;flex:1 1 340px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
          <a href="/ops/promotions/${p.id}"
             style="font-family:var(--font-display);font-weight:900;font-size:24px;line-height:1.1;">
            ${escapeHtml(p.name)}
          </a>
          ${
            ended
              ? '<span class="badge">Ended</span>'
              : '<span class="badge" style="background:var(--suds-300);">Live</span>'
          }
          ${aud.automatic ? '<span class="badge" style="background:var(--sunbeam-500);">Automatic</span>' : ''}
        </div>

        <p style="font-size:17px;font-weight:700;margin:0 0 4px;">
          ${escapeHtml(promotionsCore.describe(p))}
        </p>
        <p style="font-size:15px;margin:0 0 12px;color:var(--ink-700);">
          For ${escapeHtml(aud.label.toLowerCase())}.${
            p.max_orders
              ? gone
                ? ' <strong>All gone - the next booking pays full price.</strong>'
                : ` ${p.max_orders - held.claimed} of ${p.max_orders} free orders left.`
              : ''
          }
        </p>

        ${
          p.blurb
            ? `<p style="font-size:15px;line-height:1.5;margin:0;padding:11px 14px;
                         border:2px solid var(--ink-900);border-radius:10px;background:var(--paper-000);">
                 <span class="eyebrow" style="margin:0 8px 0 0;">The AI may say</span>
                 ${escapeHtml(p.blurb)}
               </p>`
            : `<p style="font-size:15px;line-height:1.5;margin:0;color:var(--ink-700);">
                 Silent - it comes off the price and the AI is told nothing about it.
               </p>`
        }
      </div>

      <div style="display:flex;gap:26px;align-items:flex-start;">
        ${stat(held.granted, 'given out')}
        ${
          p.max_orders
            ? stat(`${held.claimed}/${p.max_orders}`, 'orders booked')
            : stat(held.claimed, 'orders booked')
        }
        ${stat(held.redeemed, 'used')}
      </div>
    </div>

    ${
      !ended
        ? `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:18px;padding-top:18px;
                       border-top:2px solid var(--ink-100);">
             ${
               issuable
                 ? `<form method="post" action="/ops/promotions/${p.id}/issue" style="margin:0;">
                      <button class="btn btn-outline" type="submit">
                        Give it to everyone who qualifies
                      </button>
                    </form>`
                 : ''
             }
             ${
               p.audience === 'SPECIFIC'
                 ? `<span style="align-self:center;font-size:15px;color:var(--ink-700);">
                      Hand this one out from a customer's own page.
                    </span>`
                 : ''
             }
             <a class="btn btn-outline btn-sm" href="/ops/promotions/${p.id}">See who has it</a>
             <form method="post" action="/ops/promotions/${p.id}/end" style="margin:0 0 0 auto;">
               <button class="btn btn-outline btn-sm" type="submit">Stop giving it out</button>
             </form>
           </div>`
        : `<p style="margin:16px 0 0;font-size:14px;color:var(--ink-500);">
             Nobody new gets this. Anyone already holding it keeps it.
           </p>`
    }
  </div>`;
}

// One promotion, and every person holding it. The number on the card is a
// count; this is the list behind it, which is what Neil asked for: not "82
// issued" but which 82.
function promotionDetailBody({ promo, holders, notice, problem }) {
  const aud = promotionsCore.audienceOf(promo.audience);
  const tone = { HOLDING: 'var(--suds-300)', USED: 'var(--paper-200)', EXPIRED: 'var(--sunbeam-500)' };
  const words = { HOLDING: 'Holding it', USED: 'Used it', EXPIRED: 'Ran out' };

  const counted = (state) => holders.filter((h) => h.state === state).length;

  const when = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'America/New_York' })}`;
  };

  const cell = 'padding:12px 10px;border-bottom:1px solid var(--ink-100);';

  const rows = holders
    .map((h) => {
      const c = h.customer;
      const who = c
        ? `<a href="/ops/customers/${c.id}">${escapeHtml(c.name || 'Unnamed')}</a>`
        : '<span style="color:var(--ink-500);">customer gone</span>';

      return `
      <tr>
        <td style="${cell}">
          ${who}
          <div style="font-size:13px;color:var(--ink-500);font-variant-numeric:tabular-nums;">
            ${escapeHtml(c ? c.phone : '')}
          </div>
        </td>
        <td style="${cell}white-space:nowrap;">
          <span class="badge" style="background:${tone[h.state]};">${words[h.state]}</span>
        </td>
        <td style="${cell}white-space:nowrap;font-variant-numeric:tabular-nums;">${escapeHtml(when(h.grantedAt))}</td>
        <td style="${cell}white-space:nowrap;font-variant-numeric:tabular-nums;">
          ${h.limit ? `${h.uses} of ${h.limit}` : h.uses ? String(h.uses) : '&mdash;'}
        </td>
        <td style="${cell}white-space:nowrap;font-variant-numeric:tabular-nums;">
          ${h.expiresAt ? escapeHtml(when(h.expiresAt)) : 'no expiry'}
        </td>
        <td style="${cell}white-space:nowrap;">
          ${h.order ? `<a href="/ops/orders/${h.order.order_number}">#${h.order.order_number}</a>` : '&mdash;'}
        </td>
      </tr>`;
    })
    .join('');

  const stat = (n, label) => `
    <div>
      <div style="font-family:var(--font-display);font-weight:900;font-size:32px;line-height:1;
                  font-variant-numeric:tabular-nums;">${n}</div>
      <div class="eyebrow" style="margin:5px 0 0;">${escapeHtml(label)}</div>
    </div>`;

  const heads = ['Who', 'Where it got to', 'Given', 'Used', 'Runs out', 'Order']
    .map(
      (h) =>
        `<th class="eyebrow" style="text-align:left;padding:14px 10px;border-bottom:2px solid var(--ink-900);">${h}</th>`
    )
    .join('');

  return `
<a href="/ops/promotions" style="font-size:15px;font-weight:600;">&larr; All promotions</a>

<div style="display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin:18px 0 8px;">
  <h1 style="font-family:var(--font-display);font-weight:900;font-size:38px;letter-spacing:-0.03em;margin:0;">
    ${escapeHtml(promo.name)}
  </h1>
  ${
    promo.status === 'ENDED'
      ? '<span class="badge">Ended</span>'
      : '<span class="badge" style="background:var(--suds-300);">Live</span>'
  }
  ${aud.automatic ? '<span class="badge" style="background:var(--sunbeam-500);">Automatic</span>' : ''}
</div>

<p style="font-size:18px;font-weight:700;margin:0 0 4px;">${escapeHtml(promotionsCore.describe(promo))}</p>
<p style="font-size:15px;color:var(--ink-700);margin:0 0 24px;">For ${escapeHtml(aud.label.toLowerCase())}.</p>

${banner(notice, 'good')}
${banner(problem, 'bad')}

<div class="card card-xl" style="padding:24px;margin-bottom:24px;">
  <div style="display:flex;flex-wrap:wrap;gap:40px;">
    ${stat(holders.length, 'given out')}
    ${stat(counted('HOLDING'), 'still holding')}
    ${stat(counted('USED'), 'used it')}
    ${stat(counted('EXPIRED'), 'ran out')}
  </div>

  <p style="margin:20px 0 0;padding:12px 16px;border:2px solid var(--ink-900);border-radius:10px;
            background:var(--paper-000);font-size:15px;line-height:1.55;">
    <span class="eyebrow" style="margin:0 8px 0 0;">The AI may say</span>
    ${
      String(promo.blurb || '').trim()
        ? escapeHtml(promo.blurb)
        : '<em style="color:var(--ink-500);">Nothing. This one is silent - it comes off the price and the AI never mentions it.</em>'
    }
  </p>
</div>

${
  holders.length
    ? `<div class="card card-xl" style="padding:8px 16px 4px;overflow-x:auto;">
         <table style="width:100%;border-collapse:collapse;font-size:15px;min-width:640px;">
           <thead><tr>${heads}</tr></thead>
           <tbody>${rows}</tbody>
         </table>
       </div>`
    : `<div class="card" style="padding:20px 24px;">
         <p style="margin:0;font-size:16px;">Nobody holds this yet.</p>
       </div>`
}`;
}

function promotionsBody({ list, counts, notice, problem }) {
  const live = list.filter((p) => p.status !== 'ENDED');
  const ended = list.filter((p) => p.status === 'ENDED');

  const audienceOptions = promotionsCore.AUDIENCES.map(
    (a) => `<option value="${a.key}">${escapeHtml(a.label)}</option>`
  ).join('');

  const audienceNotes = promotionsCore.AUDIENCES.map(
    (a) =>
      `<p class="js-aud" data-aud="${a.key}" hidden
          style="margin:8px 0 0;font-size:14px;line-height:1.55;color:var(--ink-700);">
         ${escapeHtml(a.detail)}
       </p>`
  ).join('');

  return `
<p class="eyebrow" style="margin:0 0 8px;">The business</p>
<h1 style="margin:0 0 10px;font-size:40px;line-height:1.05;">Promotions</h1>
<p style="font-size:16px;line-height:1.6;color:var(--ink-700);max-width:64ch;margin:0 0 26px;">
  An offer belongs to a person, not to a code. Give one out and it sits on their
  account until they spend it or it runs out - there is nothing for anybody to
  type, because the AI already knows who is texting.
</p>

${banner(notice, 'good')}
${banner(problem, 'bad')}

${
  live.length
    ? live.map((p) => promotionCard(p, counts)).join('')
    : `<div class="card" style="padding:20px 24px;margin-bottom:16px;">
         <p style="margin:0;font-size:16px;">Nothing running. The form below starts one.</p>
       </div>`
}

${
  ended.length
    ? `<p class="eyebrow" style="margin:30px 0 12px;">Finished</p>
       ${ended.map((p) => promotionCard(p, counts)).join('')}`
    : ''
}

<div class="grid-2 grid-2-wide" style="align-items:start;margin-top:34px;">

  <div class="card card-xl" style="padding:28px;">
    <p class="eyebrow" style="margin:0 0 18px;">New promotion</p>
    <form method="post" action="/ops/promotions" id="promo-form"
          style="display:flex;flex-direction:column;gap:26px;">

      <div>
        <p class="eyebrow" style="margin:0 0 12px;color:var(--suds-500);">1 &middot; What are you offering</p>

        <label class="field-label" for="p_name">Name it</label>
        <p class="field-hint" style="margin:0 0 8px;">
          For you and for the order history. A customer never sees this on its own.
        </p>
        <input class="field" id="p_name" name="name" required maxlength="60"
               placeholder="Win-back - 30% off">

        <div class="grid-2" style="margin-top:16px;">
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
            <input class="field" id="p_value" name="value" type="number" min="1" step="0.01" required
                   placeholder="30">
          </div>
        </div>
      </div>

      <div style="padding-top:22px;border-top:2px solid var(--ink-100);">
        <p class="eyebrow" style="margin:0 0 12px;color:var(--suds-500);">2 &middot; Who gets it</p>

        <select class="field" id="p_audience" name="audience">${audienceOptions}</select>
        ${audienceNotes}

        <div style="margin-top:16px;">
          <label class="field-label" for="p_cap">Stop after this many orders</label>
          <p class="field-hint" style="margin:0 0 8px;">
            For an offer with a number in it - "the first 20 orders are free".
            Everybody above still gets it; what runs out is the order.
          </p>
          <p class="field-hint" style="margin:0 0 8px;">
            A slot is taken <strong>the moment somebody books</strong>, so they
            are told there and then whether theirs is one of them. Cancel the
            pickup and the slot goes back. Blank means no limit.
          </p>
          <input class="field" id="p_cap" name="max_orders" type="number" min="1" step="1"
                 placeholder="20">
        </div>
      </div>

      <div style="padding-top:22px;border-top:2px solid var(--ink-100);">
        <p class="eyebrow" style="margin:0 0 12px;color:var(--suds-500);">3 &middot; What they can use it on</p>

        <label class="field-label" for="p_applies">Which order</label>
        <select class="field" id="p_applies" name="applies_to">
          <option value="FIRST_ORDER">Their first order only</option>
          <option value="NEXT_ORDERS">Their next few orders</option>
          <option value="EVERY_ORDER">Every order, for ever</option>
        </select>

        <div id="p_limit_row" hidden style="margin-top:12px;">
          <label class="field-label" for="p_limit">How many orders</label>
          <p class="field-hint" style="margin:0 0 8px;">
            One is their very next order. Five is the next five, whenever they come.
          </p>
          <input class="field" id="p_limit" name="use_limit" type="number" min="1" step="1" value="1">
        </div>

        <div class="grid-2" style="margin-top:16px;">
          <div>
            <label class="field-label" for="p_expires">Runs out after</label>
            <p class="field-hint" style="margin:0 0 8px;">Days from when they get it. Blank never expires.</p>
            <input class="field" id="p_expires" name="expires_days" type="number" min="1" step="1"
                   placeholder="7">
          </div>
          <div>
            <label class="field-label" for="p_min">Only on orders over</label>
            <p class="field-hint" style="margin:0 0 8px;">Dollars. Blank means any order.</p>
            <input class="field" id="p_min" name="min_order" type="number" min="1" step="0.01"
                   placeholder="30">
          </div>
        </div>

        <div style="margin-top:16px;">
          <label class="field-label" for="p_max">Never take off more than</label>
          <p class="field-hint" style="margin:0 0 8px;">
            Dollars. Worth setting on a percentage so a heavy load cannot cost more than you meant.
          </p>
          <input class="field" id="p_max" name="max_discount" type="number" min="1" step="0.01"
                 placeholder="20">
        </div>
      </div>

      <div style="padding-top:22px;border-top:2px solid var(--ink-100);">
        <p class="eyebrow" style="margin:0 0 12px;color:var(--suds-500);">4 &middot; What the AI may say</p>
        <p class="field-hint" style="margin:0 0 8px;">
          Written by you, because a discount is money and the AI never invents money.
          It gets worked into a reply rather than quoted. Plain words, no dashes.
        </p>
        <input class="field" id="p_blurb" name="blurb" maxlength="200"
               placeholder="you have 30% off your next order">
        <p class="field-hint" style="margin:8px 0 0;">
          <strong>Leave it blank and the promotion is silent.</strong> It still comes
          off the price; the AI is simply told nothing about it, which is what you
          want when you have already told somebody yourself.
        </p>
      </div>

      <div>
        <button class="btn btn-ink btn-lg" type="submit">Create it ${icon('arrow-right', '22')}</button>
      </div>
    </form>
  </div>

  <div class="card card-xl" id="promo-preview"
       style="padding:26px;background:var(--paper-050);position:sticky;top:20px;">
    <p class="eyebrow" style="margin:0 0 14px;">What you are making</p>

    <p id="pv_offer" style="font-family:var(--font-display);font-weight:900;font-size:28px;
              line-height:1.1;margin:0 0 16px;">30% off</p>

    <dl style="margin:0;display:flex;flex-direction:column;gap:12px;">
      <div><span class="eyebrow" style="margin:0;">Who</span>
        <div id="pv_who" style="font-size:16px;margin-top:3px;">Only people you pick</div></div>
      <div><span class="eyebrow" style="margin:0;">Which order</span>
        <div id="pv_order" style="font-size:16px;margin-top:3px;">Their first order only</div></div>
      <div><span class="eyebrow" style="margin:0;">Runs out</span>
        <div id="pv_expiry" style="font-size:16px;margin-top:3px;">Never</div></div>
      <div><span class="eyebrow" style="margin:0;">Limits</span>
        <div id="pv_limits" style="font-size:16px;margin-top:3px;">None</div></div>
    </dl>

    <p class="eyebrow" style="margin:22px 0 8px;">They might read</p>
    <p id="pv_blurb" style="margin:0;padding:13px 16px;border:2px solid var(--ink-900);
              border-radius:12px;background:var(--paper-000);font-size:15px;line-height:1.55;">
      Whatever you write in step 4, worked into a sentence by the AI.
    </p>

    <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:var(--ink-500);">
      Nothing is created until you press the button. The panel just reads the form.
    </p>
  </div>
</div>

<script>
(function () {
  // A PREVIEW, NOT A SECOND IMPLEMENTATION. Everything real - what the discount
  // is worth, who qualifies, whether it has expired - is decided in
  // src/core/promotions.js when an order is priced. This only reads the form
  // back to whoever is filling it in, and the page works perfectly without it.
  var form = document.getElementById('promo-form');
  if (!form) return;

  var $ = function (id) { return document.getElementById(id); };
  var money = function (v) { return '$' + (Math.round(Number(v) * 100) / 100).toFixed(2); };

  function paint() {
    var kind = $('p_kind').value;
    var value = $('p_value').value;
    var aud = $('p_audience');

    $('pv_offer').textContent = !value
      ? 'An offer'
      : (kind === 'PERCENT_OFF' ? value + '% off' : money(value) + ' off');

    $('pv_who').textContent = aud.options[aud.selectedIndex].text;

    var applies = $('p_applies').value;
    var limit = $('p_limit').value || '1';
    $('p_limit_row').hidden = applies !== 'NEXT_ORDERS';
    $('pv_order').textContent =
      applies === 'FIRST_ORDER'
        ? 'Their first order only'
        : applies === 'NEXT_ORDERS'
        ? 'Their next ' + limit + (Number(limit) === 1 ? ' order' : ' orders')
        : 'Every order, for ever';

    var days = $('p_expires').value;
    $('pv_expiry').textContent = days
      ? days + (Number(days) === 1 ? ' day' : ' days') + ' after they get it'
      : 'Never';

    var limits = [];
    if ($('p_min').value) limits.push('orders over ' + money($('p_min').value));
    if ($('p_max').value) limits.push('at most ' + money($('p_max').value) + ' off');
    $('pv_limits').textContent = limits.length ? limits.join(', ') : 'None';

    var blurb = $('p_blurb').value.trim();
    $('pv_blurb').textContent = blurb
      ? blurb
      : 'Nothing. This promotion is silent - it comes off the price and the AI never mentions it.';

    // Only the note for the chosen audience is on screen. Every option's note
    // is rendered server-side and hidden, so this needs no strings of its own.
    var notes = form.querySelectorAll('.js-aud');
    for (var i = 0; i < notes.length; i += 1) {
      notes[i].hidden = notes[i].getAttribute('data-aud') !== aud.value;
    }
  }

  form.addEventListener('input', paint);
  form.addEventListener('change', paint);
  paint();
})();
</script>`;
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

module.exports = {
  adminDashboardBody,
  settingsBody,
  weightLimitsBody,
  promotionsBody,
  promotionDetailBody,
  broadcastBody,
  AUDIENCES,
};
