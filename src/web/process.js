'use strict';

const { config } = require('../config');
const { site } = require('../web/site');
const roles = require('../core/roles');
const booking = require('../core/booking');
const fulfilment = require('../core/fulfilment');
const orders = require('../core/orders');
const brain = require('../core/brain');
const payments = require('../providers/payments');

// ---------------------------------------------------------------------------
// /ops/process - how the whole thing works.
//
// What LYNDRY is, what happens to a bag, and who does what, written for
// somebody who has never seen the code. It is the page to hand a new driver,
// and the page to read before changing anything.
//
// THIS PAGE MUST NOT BE ALLOWED TO GO STALE. A process document that is wrong
// is worse than none, because people act on it. Two things keep it honest:
//
//   1. As much as possible is READ FROM THE CODE rather than written down
//      again here. The price, the minimum, the turnaround, the pickup windows,
//      the order states and which of them text the customer, the AI's tools,
//      the role table, whether Stripe is live - all of it is imported. Change
//      the code and this page changes with it. Nothing below restates a fact
//      that the program already knows.
//
//   2. What is genuinely prose - the reasoning, the sequence, the things a
//      person has to do - carries REVIEWED below. CLAUDE.md says to update
//      this page with any change to the system, and bumping that date is the
//      visible half of doing it.
// ---------------------------------------------------------------------------

// Bumped by hand whenever the prose here is checked against the code.
const REVIEWED = '13 August 2026';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const money = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;

// A numbered step in one of the three walkthroughs.
function step(n, title, body) {
  return `
  <li class="pr-step">
    <div class="pr-num">${n}</div>
    <div>
      <h3>${title}</h3>
      <p>${body}</p>
    </div>
  </li>`;
}

function section(id, eyebrow, heading, lead, body) {
  return `
<section class="pr-section" id="${id}">
  <p class="eyebrow" style="margin:0 0 8px;">${esc(eyebrow)}</p>
  <h2 style="font-size:34px;line-height:1.05;margin:0 0 14px;">${esc(heading)}</h2>
  ${lead ? `<p class="pr-lead">${lead}</p>` : ''}
  ${body}
</section>`;
}

function processBody() {
  const minimum = money(config.pricing.minimumCents);
  const perLb = site.pricePerLb;
  const minimumLb = config.pricing.minimumCents / config.pricing.perPoundCents;

  // --- derived from the code -----------------------------------------------

  const stepRows = fulfilment.STEPS.map(
    (s) => `
      <tr>
        <td><code>${esc(s.to)}</code></td>
        <td>${esc(s.label)}</td>
        <td>${esc(s.hint)}</td>
        <td>${
          s.texts
            ? '<span class="pr-yes">Texted</span>'
            : '<span class="pr-no">Silent, deliberately</span>'
        }</td>
      </tr>`
  ).join('');

  const toolRows = brain.TOOLS.map(
    (t) => `
      <tr>
        <td><code>${esc(t.name)}</code></td>
        <td>${esc(String(t.description || '').split('.')[0])}</td>
      </tr>`
  ).join('');

  const permissionKeys = Object.keys(roles.PERMISSIONS);
  const roleKeys = Object.keys(roles.ROLES);

  const roleTable = `
    <table class="pr-tbl">
      <thead>
        <tr>
          <th>Can they</th>
          ${roleKeys.map((r) => `<th class="c">${esc(roles.labelFor(r))}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${permissionKeys
          .map(
            (p) => `
        <tr>
          <td>${esc(roles.PERMISSIONS[p])}<br><code>${esc(p)}</code></td>
          ${roleKeys
            .map((r) =>
              roles.ROLES[r].permissions.includes(p)
                ? '<td class="c pr-yes">Yes</td>'
                : '<td class="c pr-no">No</td>'
            )
            .join('')}
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`;

  const cancellableFrom = Object.keys(orders.ALLOWED_NEXT).filter((s) =>
    (orders.ALLOWED_NEXT[s] || []).includes('CANCELED')
  );

  // Whether the money side is actually switched on right now, and which mode.
  const stripeState = !payments.isConfigured
    ? { tone: 'pr-pill-wait', label: 'Off', note: 'No Stripe key is set here, so nothing is charged and no card can be saved.' }
    : config.stripeSecretKey && config.stripeSecretKey.startsWith('sk_live_')
      ? { tone: 'pr-pill-live', label: 'Live', note: 'Real cards, real money.' }
      : { tone: 'pr-pill-test', label: 'Test mode', note: 'Cards are Stripe test cards. No real money moves.' };

  return `
<style>
  .pr-wrap { display: flex; flex-direction: column; gap: 56px; max-width: 860px; }
  .pr-section { scroll-margin-top: 90px; }
  .pr-lead { font-size: 17px; line-height: 1.65; color: var(--ink-700); max-width: 66ch; margin: 0 0 20px; }
  .pr-section p { max-width: 66ch; line-height: 1.65; }

  .pr-toc { display: flex; flex-wrap: wrap; gap: 8px; }
  .pr-toc a {
    font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
    font-weight: 700; text-decoration: none; color: var(--ink-900); background: var(--paper-050);
    border: 2px solid var(--ink-900); border-radius: 999px; padding: 7px 14px;
    box-shadow: var(--shadow-pop-xs);
  }
  .pr-toc a:hover { transform: translate(-2px, -2px); box-shadow: var(--shadow-pop-sm); }

  ol.pr-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 22px; }
  .pr-step { display: grid; grid-template-columns: 46px minmax(0, 1fr); gap: 18px; align-items: start; }
  .pr-step h3 { font-family: var(--font-display); font-weight: 900; font-size: 20px; margin: 0 0 5px; line-height: 1.2; }
  .pr-step p { margin: 0; color: var(--ink-700); }
  .pr-num {
    width: 46px; height: 46px; border: 2px solid var(--ink-900); border-radius: 50%;
    background: var(--suds-500); box-shadow: var(--shadow-pop-xs);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-mono); font-weight: 700; font-size: 16px; color: var(--ink-900);
  }
  .pr-driver .pr-num { background: var(--lilac-500); }
  .pr-partner .pr-num { background: var(--sunbeam-500); }

  table.pr-tbl { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 8px; }
  table.pr-tbl th {
    font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--ink-500); font-weight: 700; text-align: left; padding: 0 12px 10px 0;
    border-bottom: 2px solid var(--ink-900);
  }
  table.pr-tbl th.c, table.pr-tbl td.c { text-align: center; }
  table.pr-tbl td { padding: 11px 12px 11px 0; border-bottom: 1px solid var(--ink-100); vertical-align: top; }
  table.pr-tbl code { font-family: var(--font-mono); font-size: 12px; color: var(--ink-500); }
  .pr-yes { color: var(--suds-700); font-weight: 700; }
  .pr-no  { color: var(--ink-500); }
  .pr-scroll { overflow-x: auto; }
  .pr-scroll table { min-width: 520px; }

  .pr-note {
    background: var(--sunbeam-500); border: 2px solid var(--ink-900); border-radius: 16px;
    box-shadow: var(--shadow-pop-sm); padding: 22px 26px;
  }
  .pr-note p { margin: 0 0 12px; color: var(--ink-900); }
  .pr-note p:last-child { margin: 0; }
  .pr-note h3 { font-family: var(--font-display); font-weight: 900; font-size: 20px; margin: 0 0 10px; }

  .pr-pill {
    display: inline-flex; align-items: center; gap: 8px; border: 2px solid var(--ink-900);
    border-radius: 999px; padding: 4px 13px; font-family: var(--font-mono); font-size: 11px;
    font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-900);
  }
  .pr-pill-live { background: var(--suds-500); }
  .pr-pill-test { background: var(--lilac-500); }
  .pr-pill-wait { background: var(--sunbeam-500); }

  dl.pr-defs { display: grid; grid-template-columns: minmax(0, 210px) minmax(0, 1fr); gap: 14px 22px; margin: 8px 0 0; }
  dl.pr-defs dt { font-weight: 700; }
  dl.pr-defs dd { margin: 0; color: var(--ink-700); }
  @media (max-width: 620px) {
    dl.pr-defs { grid-template-columns: minmax(0, 1fr); gap: 4px 0; }
    dl.pr-defs dd { margin-bottom: 12px; }
    .pr-step { grid-template-columns: 38px minmax(0, 1fr); gap: 14px; }
    .pr-num { width: 38px; height: 38px; font-size: 14px; }
  }
</style>

<div class="pr-wrap">

  <header>
    <p class="eyebrow" style="margin:0 0 8px;">The system</p>
    <h1 style="margin:0 0 16px;font-size:46px;line-height:1.03;">How the whole thing works.</h1>
    <p class="pr-lead" style="font-size:19px;">
      What LYNDRY is, what happens to a bag between one doorstep and the same
      doorstep, and who does what. Written for somebody who has never seen the
      code. If you are about to change how any of this works, read the part you
      are changing first.
    </p>
    <p style="font-family:var(--font-mono);font-size:12px;color:var(--ink-500);margin:0 0 22px;">
      Prose last checked against the code on ${esc(REVIEWED)}. Every figure,
      table and status on this page is read live from the running system.
    </p>
    <nav class="pr-toc">
      <a href="#what">What it is</a>
      <a href="#customer">The customer</a>
      <a href="#driver">The driver</a>
      <a href="#partner">The laundromat</a>
      <a href="#money">The money</a>
      <a href="#states">The states</a>
      <a href="#ai">The AI</a>
      <a href="#tech">The technology</a>
      <a href="#who">Who sees what</a>
    </nav>
  </header>

  ${section(
    'what',
    'Start here',
    'What LYNDRY is',
    `A wash, dry and fold service in ${esc(site.serviceArea)}. We collect a bag
     of laundry from somebody's door, wash it, fold it, and bring it back
     within ${esc(site.turnaround)}. That is the entire product. No dry
     cleaning, no pressing, no alterations.`,
    `
    <p>
      Two things make it different from the laundromat down the road, and both
      are worth protecting.
    </p>
    <p>
      <strong>You book it by texting, like you would text a friend.</strong>
      "hey can you grab my laundry tomorrow at 6" is a complete booking. There
      is no app to install, no account to make, no menu, and no "reply 1 for
      pickup". A person reads the message - except the person is Claude, and
      the reason that works is covered further down. If a reply we send ever
      reads like a phone tree, it is a bug.
    </p>
    <p>
      <strong>It is priced by weight, ${esc(perLb)} a pound</strong>, with a
      ${esc(minimum)} minimum per pickup - which covers the first
      ${esc(String(minimumLb))} lb. Nobody knows the price when they book,
      including us, because the bag has not been on a scale yet. Everything
      about how the money works follows from that one fact.
    </p>
    <dl class="pr-defs">
      <dt>Price</dt><dd>${esc(perLb)} a pound, ${esc(minimum)} minimum per pickup</dd>
      <dt>Turnaround</dt><dd>${esc(site.turnaround)}</dd>
      <dt>Service area</dt><dd>${esc(site.serviceArea)}</dd>
      <dt>Pickup windows</dt><dd>Between ${esc(booking.listWindows())}. Any day - there are no fixed route days.</dd>
      <dt>Cancellation</dt><dd>Free until the driver collects. Not possible after.</dd>
      <dt>Who does the work</dt><dd>One driver. The washing may happen at a laundromat we pay, or by us.</dd>
    </dl>`
  )}

  ${section(
    'customer',
    'Perspective one',
    'What the customer does',
    'Five things, and four of them are a text message.',
    `
    <ol class="pr-steps">
      ${step(
        1,
        'They text the number, or fill in the form',
        `A stranger texts <strong>${esc(site.publicPhoneDisplay)}</strong> and gets a reply.
         If we do not recognise the number, the whole of signing up happens in
         that thread: we ask their name and where to collect from, and how they
         like it washed - temperature, detergent, softener, and where the
         driver finds the bag. Those four are asked once and never again. They
         can also start from the website, which just texts them first.`
      )}
      ${step(
        2,
        'They save a card, once, ever',
        `Before the first pickup we text a link on our own domain that forwards
         to Stripe. <strong>Saving a card is not a payment.</strong> Nothing is
         taken then, or when they book. We never see or store the card number -
         Stripe holds it and gives us a reference. That link is the only time
         the customer deals with payment at all.`
      )}
      ${step(
        3,
        'They ask for a pickup',
        `"laundry tomorrow" is enough for a returning customer and creates the
         order with no follow-up questions. They can name a time and get a
         window back - we do not offer a list of slots to pick from. Before
         anything is booked they get one recap: when, the address, where the
         bag is, how it gets washed. They say yes, it is booked, and they get
         an order number. That is the only confirmation step there is; nothing
         is ever confirmed twice.`
      )}
      ${step(
        4,
        'They leave the bag out and forget about it',
        `They get a text when we collect it, a text with the weight and the
         total when it goes on the scale, a text when it is on the van coming
         back, and a text with a photo of it on their doorstep. Four messages,
         each saying exactly one new thing.`
      )}
      ${step(
        5,
        'They text us if they need anything',
        `Move it, cancel it, change the drop-off spot, ask where it is, set up a
         weekly pickup, or complain. Same thread, same number, no menu. Anything
         we are not sure about, or anybody who is upset, gets handed to a person
         and shows up on the Issues screen until somebody deals with it.`
      )}
    </ol>`
  )}

  ${section(
    'driver',
    'Perspective two',
    'What the driver does',
    `Everything physical, and every status change. The driver is the only person
     who touches the system during a run.`,
    `
    <ol class="pr-steps pr-driver">
      ${step(
        1,
        'Open the orders board',
        `Sign in at <code>/ops</code> with a mobile number and a six-digit code
         we text. No password, no app. The board shows what is on today, and
         a booking with no card on file is flagged as unconfirmed - do not drive
         to it, we have no way to bill it.`
      )}
      ${step(
        2,
        'Sticker every bag, and enter its code',
        `A label off the roll in the van goes on each bag, and the six
         characters printed under the QR go into the order page. That is what
         binds a sticker to a bag. Print more from the order page when the roll
         runs low. A sticker means nothing until it is entered - blank stock is
         just paper.`
      )}
      ${step(
        3,
        'Collect the bag, tap Collected',
        `Every step is a full-width button on the order page. There is no
         JavaScript on that screen on purpose: on two bars of signal in a
         stairwell you get a page that either worked or did not, rather than a
         spinner that lies. Tapping twice is refused and shown as a sentence.`
      )}
      ${step(
        4,
        'WEIGH IT BEFORE IT LEAVES YOUR HANDS',
        `The most important step on the round. The weight sets the price and
         <strong>charges the customer's card</strong>, so it has to be our
         number on our scale - never the laundromat's figure taken on trust. The
         system refuses to let a bag go to a partner, or onto the van for
         delivery, without a weight recorded. Getting it wrong by a factor of
         ten is a four-figure charge on somebody's card.`
      )}
      ${step(
        5,
        'Drop it at the laundromat, collect it when it is done',
        `Two taps, and they are the two the customer never hears about. Where
         the washing happens is our business, not theirs. If we wash it
         ourselves, skip both - the order goes straight from collected to out
         for delivery and nothing forces a partner visit that did not happen.`
      )}
      ${step(
        6,
        'Deliver it, and photograph it',
        `<strong>No photo, no delivery.</strong> The button will not complete
         without one. The photo is the answer to "you never delivered it" and
         the reason somebody is willing to leave a bag outside at all. It goes
         into private storage and the customer gets a link that expires after
         30 days.`
      )}
    </ol>
    <div class="pr-note" style="margin-top:26px;">
      <h3>The driver never decides money</h3>
      <p>
        There is no discount button and no price field. The only number a driver
        enters is a weight, and the price follows from it using the rate stored
        on that order - not today's rate, so changing the price never re-prices
        work already quoted. Waiving a charge is a separate, deliberate action
        that gets recorded as waived rather than quietly marked paid.
      </p>
    </div>`
  )}

  ${section(
    'partner',
    'Perspective three',
    'What the laundromat does',
    'Nothing. That is the current design, and it is deliberate.',
    `
    <ol class="pr-steps pr-partner">
      ${step(
        1,
        'They take a bag off our driver',
        `We hand over a bag we have already weighed, with a sticker on it. They
         wash, dry and fold it the way we asked.`
      )}
      ${step(
        2,
        'They point a phone at the sticker',
        `The QR opens one page. It shows the bag's code, which bag of how many,
         how it should be washed, and how long is left on the promise. No app,
         no install, no login, no password - it works on whatever cracked
         Android is behind the counter.`
      )}
      ${step(
        3,
        'They tell our driver it is done',
        `However they like. The driver records it in the system.`
      )}
    </ol>
    <div class="pr-note" style="margin-top:26px;">
      <h3>What that page deliberately does not show</h3>
      <p>
        <strong>No name, no phone number, no address, no history, no
        price.</strong> A laundromat needs to know how to wash a bag. It does
        not need to know whose bag it is, and information that never reaches the
        page cannot leak from it. The query behind it asks for the specific
        columns it is allowed to show rather than the whole row, so a field
        somebody adds upstream next year does not quietly appear on a stranger's
        screen.
      </p>
      <p>
        Three things keep it closed: the code is one of a billion and never
        sequential, the QR carries a signature so a guessed address is refused
        before the database is touched, and it only resolves while the label is
        on a live bag. Delivering an order releases its stickers, so one out of
        a bin is worth nothing. Every scan is logged, resolved or not.
      </p>
    </div>
    <div class="pr-note" style="margin-top:20px;">
      <h3>There are still no partner accounts and no partner logins</h3>
      <p>
        Scanning a sticker is not signing in. There is nothing to log into, and
        <strong>a laundromat cannot change anything</strong> - the page is read
        only. Weighing is what charges a customer's card, so our own driver
        belongs between that number and somebody's money.
      </p>
      <p>
        And <strong>no laundromat has signed.</strong> No terms are agreed, no
        wholesale rate is settled, and nothing on the website promises a revenue
        share or a per-pound rate, because none of it has been decided.
        Enquiries arrive through <code>/partners</code> and land on the Partners
        screen.
      </p>
    </div>`
  )}

  ${section(
    'money',
    'The money',
    'One charge, at the scale',
    `The card is touched exactly once in an order's life, and it is not when they
     book.`,
    `
    <p style="margin-bottom:18px;">
      <span class="pr-pill ${stripeState.tone}">Stripe: ${esc(stripeState.label)}</span>
      <span style="font-size:14px;color:var(--ink-500);margin-left:10px;">${esc(stripeState.note)}</span>
    </p>
    <ol class="pr-steps">
      ${step(
        1,
        'Booking takes nothing',
        `A card has to be on file before a driver comes out, but saving it is
         not a payment and is never described as one. An order booked without a
         card still exists - it is simply not confirmed, and stays off the run
         sheet until a card is saved, at which point it confirms itself.`
      )}
      ${step(
        2,
        `The scale charges the card, in full`,
        `This is the first moment an amount exists, and by then two
         authorisations are on record: the consent given on the Stripe page,
         and the booking confirmation naming the card. There is no third "reply
         YES to pay" step. The customer gets the weight, the total and the
         charge in one text.`
      )}
      ${step(
        3,
        'A declined card never holds up a delivery',
        `We wash it, we deliver it, and we chase by text. Holding somebody's
         clothes over a card is a bad look and legally murky, and the exposure
         is one order. An unpaid order stays visible until it is settled or
         deliberately waived.`
      )}
    </ol>
    <p style="margin-top:22px;">
      The ${esc(minimum)} minimum is a <strong>floor on the price</strong>, not
      a payment. A ${esc(String(Math.round(minimumLb / 2)))} lb load still costs
      ${esc(minimum)}; it is billed in one go with everything else, and nothing
      is refunded for being light. Cancelling before collection costs nothing
      because nothing has been taken.
    </p>
    <p>
      <strong>No card number is ever stored, logged or received by this
      system.</strong> Stripe holds the card; we keep their reference to it plus
      the brand and last four digits so a text can say "your Visa ending 1234".
      Accepting a real card number anywhere in this codebase would put the
      business inside PCI DSS.
    </p>`
  )}

  ${section(
    'states',
    'The machine',
    'Where a bag can be',
    `An order moves through these and cannot skip one. Only one file in the
     codebase is allowed to move it, so a driver double-tapping cannot deliver
     an order twice or charge for it twice.`,
    `
    <div class="pr-scroll">
      <table class="pr-tbl">
        <thead>
          <tr><th>State</th><th>Button</th><th>Means</th><th>Customer</th></tr>
        </thead>
        <tbody>${stepRows}</tbody>
      </table>
    </div>
    <p style="margin-top:20px;">
      <strong>The two silent steps are the point.</strong> "Your laundry is at
      our partner laundromat" tells a customer something about how the business
      is run rather than about their order, and two more texts per order is real
      money and a worse complaint profile for information nobody asked for.
    </p>
    <p>
      <strong>Weighing is an event, not a state.</strong> It can happen at any
      point while we hold the bag, and it is what turns an estimate into a
      price. The partner leg is optional - a bag we wash ourselves never enters
      those two states at all.
    </p>
    <p>
      An order can only be cancelled from
      ${cancellableFrom.map((s) => `<code>${esc(s)}</code>`).join(', ')} -
      in plain terms, right up until the bag is in the van, and never after.
    </p>`
  )}

  ${section(
    'ai',
    'The AI',
    'What Claude is actually allowed to do',
    `One job: turn one message into one structured action. It holds no state,
     decides no prices, and never touches hardware or money.`,
    `
    <p>
      Every incoming text passes through plain code first. Is it really from our
      carrier? Have we seen this message before? Is it STOP, START or HELP -
      which are legally required and must never depend on a model reading them
      correctly? Only what survives all of that reaches the AI.
    </p>
    <p>
      The AI then picks one of these, or none. It cannot invent an action, and
      the reply the customer reads for anything involving a number is written by
      our code, not by the model, so the figure in it is always the real one
      from the database.
    </p>
    <div class="pr-scroll">
      <table class="pr-tbl">
        <thead><tr><th>Tool</th><th>What it does</th></tr></thead>
        <tbody>${toolRows}</tbody>
      </table>
    </div>
    <div class="pr-note" style="margin-top:26px;">
      <h3>Two things the AI can never do</h3>
      <p>
        <strong>It cannot name a locker, a building or a customer.</strong> The
        unlock tool takes no arguments at all - the backend works out the
        compartment from the authenticated phone number's own open order. No
        amount of clever texting gets somebody into a locker that is not theirs.
        (Lockers are shelved, so it politely refuses either way.)
      </p>
      <p>
        <strong>It cannot move money.</strong> The AI works out that somebody
        wants a pickup. Code works out whether they have a card, whether to send
        a link, and when to charge.
      </p>
    </div>`
  )}

  ${section(
    'tech',
    'The technology',
    'Four vendors and a database',
    `Deliberately small. Everything below is chosen so that one person who is
     not a developer can still get an answer out of a search engine when
     something breaks.`,
    `
    <dl class="pr-defs">
      <dt>The server</dt>
      <dd>Node.js and Express, one deployment. No TypeScript, no React, no
          bundler, no job queue, no Docker. There is no build step: the files in
          the repository are the files that run.</dd>

      <dt>The database</dt>
      <dd>Supabase, which is hosted Postgres. Every table denies all access by
          default; the server holds the one key that bypasses that. The schema
          lives in the repository as numbered SQL files, so the repository is
          the record of what the database looks like.</dd>

      <dt>Texting</dt>
      <dd>Telnyx, behind an adapter - nothing outside one folder knows Telnyx
          exists, so switching carrier is an afternoon. Every message in and out
          is logged. Every outgoing text is forced to plain ASCII, because one
          curly quote turns a one-segment message into three and gets scored as
          spam.</dd>

      <dt>The AI</dt>
      <dd>Claude, model <code>${esc(brain.MODEL)}</code>, resolved once at
          startup.</dd>

      <dt>Payments</dt>
      <dd>Stripe, behind an adapter, exactly like Telnyx. Nothing outside that
          folder knows what a PaymentIntent is.</dd>

      <dt>The website</dt>
      <dd>Hand-written HTML and three stylesheets. No CSS framework. Stylesheets
          are served from a path containing a hash of their contents, so a
          deploy is picked up instantly and a returning visitor is never stuck
          with last week's styles.</dd>
    </dl>
    <p style="margin-top:22px;">
      <strong>Vendors live behind adapters, and that is not decoration.</strong>
      It is the difference between changing carrier in an afternoon and
      rewriting the application. The same rule applies to Stripe and to the
      locks that are currently shelved.
    </p>`
  )}

  ${section(
    'who',
    'Access',
    'Who sees what',
    `There are no customer logins to the ops screens and no partner logins at
     all. Staff sign in with a phone number and a texted code; scripts use a key
     in a header, because a script cannot receive a text.`,
    `
    <div class="pr-scroll">${roleTable}</div>
    <p style="margin-top:20px;">
      Prices are left out of a driver's screens entirely rather than hidden with
      styling - a value that never reaches the page cannot leak from it. New
      people default to the least privileged role, and nobody can change their
      own role or switch themselves off, because that is how an admin locks
      everyone out of the tool with no other way back in.
    </p>
    <p>
      Somebody who leaves is disabled, not deleted, and it takes effect on their
      next click rather than in thirty days when their session lapses. Deleting
      them would lose the record of who did what.
    </p>`
  )}

  <div class="pr-note" id="upkeep">
    <h3>Keeping this page true</h3>
    <p>
      Everything numbered, tabled or named above is read from the running system
      - the price, the minimum, the windows, the states, which of them text the
      customer, the AI's tools and model, the role table, and whether Stripe is
      live. Those cannot drift. Change the code and they change here.
    </p>
    <p>
      The prose can drift, and that is what the date at the top is for. Any
      change to how the service actually works means reading the affected
      section, correcting it, and bumping that date in
      <code>src/web/process.js</code>. A process document that is wrong is worse
      than no process document, because people act on it.
    </p>
  </div>

</div>`;
}

module.exports = { processBody, REVIEWED };
