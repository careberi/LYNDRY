'use strict';

const booking = require('../core/booking');
const { describeAll } = require('../core/recurring');
const wash = require('../core/wash');
const { site } = require('./site');
const { escapeHtml } = require('./layout');

// ---------------------------------------------------------------------------
// The customer portal's dashboard: one big card to place an order, three to
// change the things that carry over between orders, and the two tables under
// them. Neil's layout.
//
// WHAT IS MISSING IS DERIVED, NEVER STORED. Same rule as the ops nudge panel
// and for the same reason: a name, an address, preferences and a card are
// already facts in the database, and a "setup stage" column would be a second
// copy of them, free to disagree the first time anybody changed one by hand or
// over text. So it is worked out on every request, from the same predicates
// booking.checkSlot() refuses on.
//
// THE CARDS ARE ALWAYS THERE. An earlier version showed a setup panel that
// vanished once everything was filled in, which meant the only way to change an
// address was to first make it invalid. These are permanent: they show what is
// on file and open to a form. What changes with state is the wording - "Add" or
// "Update" - and whether placing an order is possible yet.
//
// THE FORMS WRITE THE SAME COLUMNS THE AI WRITES. There is no web-only shape
// for a preference: wash values come from src/core/wash.js, the spot goes to the
// field the AI already uses, and the card goes through billing.js. A second way
// of storing the same fact is how the text thread and the website end up
// disagreeing about somebody's laundry.
// ---------------------------------------------------------------------------

// Both spot fields, newest first - exactly as run.spotOf() and the reminder do.
// `special_instructions` is where the AI saves a pickup spot and where every
// older customer's lives; `dropoff_spot` is only set when somebody wants the
// clean laundry left somewhere different. Checking only the second says "no
// spot" for almost everybody who has actually told us.
function spotOf(customer) {
  const prefs = customer.preferences || {};
  return String(customer.dropoff_spot || prefs.special_instructions || '').trim();
}

// How to get to the spot, as opposed to where the spot is. Kept apart from
// special_instructions on purpose: that field is read as THE SPOT by the run
// sheet, the reminder and the confirmation text, and folding a gate code into
// it would put a paragraph where a doorway should be.
function accessNotesOf(customer) {
  return String((customer.preferences || {}).access_notes || '').trim();
}

function hasName(customer) {
  return Boolean(String(customer.name || '').trim());
}

// ---------------------------------------------------------------------------
// What is still missing, in the order a booking is refused for it.
//
// THREE, MATCHING THE THREE CARDS. The spot used to be its own gap and its own
// form; it lives inside the address form now, because "where do we come" and
// "where is the bag when we get there" are one question to the person answering
// and were two boxes writing to one record.
//
// `blocks` is the part that matters: an address and wash preferences stop
// bookPickup() dead. A card does not - the order is written first and the card
// asked for after, deliberately, so somebody who hesitates still has a booking
// to come back to.
// ---------------------------------------------------------------------------
function gapsFor(customer) {
  const gaps = [];

  if (!hasName(customer) || !booking.hasAddress(customer) || !spotOf(customer)) {
    gaps.push({ key: 'address', blocks: true });
  }

  if (!booking.hasPreferences(customer)) {
    gaps.push({ key: 'wash', blocks: true });
  }

  if (!customer.default_payment_method_id) {
    gaps.push({ key: 'card', blocks: false });
  }

  return gaps;
}

const blocking = (customer) => gapsFor(customer).some((g) => g.blocks);

// --- The forms --------------------------------------------------------------

const field = (label, hint, control) => `
  <div class="field">
    <label class="field-label" for="${label.id}">${escapeHtml(label.text)}</label>
    ${hint ? `<span class="field-hint" style="display:block;margin-bottom:8px;">${hint}</span>` : ''}
    ${control}
  </div>`;

// ---------------------------------------------------------------------------
// WHERE THE BAG GOES: A LIST, PLUS SOMEWHERE TO TYPE.
//
// Neil's call. It was a free-text box, which is a small essay question for an
// answer that is almost always one of three words - and free text is what the
// driver reads off a run sheet at a door, so "by the thing round the side" is
// a real cost. The list covers the common ones; Other is there because a
// doorman building is not a front door and never will be.
//
// NO SCRIPT REVEALS THE BOX. It sits under the list, always visible, so the
// page cannot end up with a hidden field somebody has to fill in on a phone
// that ran no JavaScript. The route ignores it unless Other is chosen.
//
// WHAT IS STORED IS STILL A SENTENCE, not a code: preferences.
// special_instructions is the field the AI writes and the run sheet reads, and
// it has always held words. A new enum here would be a second vocabulary that
// the text thread knows nothing about.
// ---------------------------------------------------------------------------
const SPOTS = ['Front door', 'Back door', 'Side door', 'Garage', 'Porch', 'With the doorman'];

function spotField(customer) {
  const saved = spotOf(customer);
  const known = SPOTS.find((s) => s.toLowerCase() === saved.toLowerCase());
  const other = saved && !known ? saved : '';

  return `
    <!-- THE BOX ONLY APPEARS WHEN "SOMEWHERE ELSE" IS CHOSEN, and it does it
         in CSS rather than script - see .spot-group in public/css/lyndry.css.

         IT FAILS SAFE. The rule that hides it lives inside an @supports for
         :has(), so a browser that cannot do the revealing cannot do the hiding
         either and simply shows both. A box hidden by a selector the browser
         does not understand is a field somebody can never fill in. -->
    <div class="spot-group">
    <div class="field">
      <label class="field-label" for="spot">Where should the driver find the bag?</label>
      <span class="field-hint" style="display:block;margin-bottom:8px;">
        One spot for both. It is where we pick up from and where we bring it back.
      </span>
      <select class="select input-lg" id="spot" name="spot" required>
        <option value=""${saved ? '' : ' disabled selected'}>Please choose&hellip;</option>
        ${SPOTS.map(
          (s) =>
            `<option value="${escapeHtml(s)}"${known === s ? ' selected' : ''}>${escapeHtml(s)}</option>`
        ).join('')}
        <option value="OTHER"${other ? ' selected' : ''}>Somewhere else&hellip;</option>
      </select>
    </div>

    <div class="field spot-other">
      <label class="field-label" for="spot_other">If somewhere else, where?</label>
      <input class="input input-lg" type="text" id="spot_other" name="spot_other" maxlength="120"
             placeholder="Behind the planter, second gate on the left&hellip;"
             value="${escapeHtml(other)}">
    </div>
    </div>

    <!-- HOW TO GET TO THE SPOT, WHICH IS NOT THE SPOT.

         Neil's ask. "Back door" tells the driver where to stand; it does not
         tell him the gate code, that there is a doorman to ask, or that the
         side path is the only way through. Those are permanent facts about the
         address rather than about one pickup, so they belong here and not in
         the per-order note on the booking form.

         DRIVER ONLY. This never reaches the laundromat: /o/<code> builds its
         page from an allowlist in wash.washLines(), so a new preferences key
         cannot leak into it - which is exactly why that page is an allowlist
         and not a redaction. -->
    <div class="field">
      <label class="field-label" for="access_notes">
        Anything else the driver needs?
        <span style="font-weight:400;color:var(--ink-500);">Optional</span>
      </label>
      <textarea class="textarea" id="access_notes" name="access_notes" rows="3"
                placeholder="Gate code 4412. Ask the doorman for the Lyndry bag. Side path, not the front steps&hellip;">${escapeHtml(
        accessNotesOf(customer)
      )}</textarea>
      <span class="field-hint">
        Saved for every pickup, not just the next one. Only the driver sees this.
      </span>
    </div>`;
}

// Name, address and the spot in one form. All three answer "where does the
// driver go and what does he do when he gets there".
function addressForm(customer) {
  const v = (value) => escapeHtml(String(value || ''));

  return `
    <form method="post" action="/account/details">
      <div class="stack">
        ${field(
          { id: 'name', text: 'Your name' },
          '',
          `<input class="input input-lg" type="text" id="name" name="name" required maxlength="80"
                  autocomplete="name" value="${v(customer.name)}">`
        )}
        ${field(
          { id: 'address_line1', text: 'Street address' },
          '',
          `<input class="input input-lg" type="text" id="address_line1" name="address_line1" required
                  autocomplete="address-line1" value="${v(customer.address_line1)}">`
        )}
        ${field(
          { id: 'address_line2', text: 'Apartment, unit, floor (optional)' },
          'The driver comes to your door, so a unit number matters.',
          `<input class="input input-lg" type="text" id="address_line2" name="address_line2"
                  autocomplete="address-line2" value="${v(customer.address_line2)}">`
        )}
        <!-- BOTH CLASSES. grid-2-wide is a modifier - it sets the ratio and
             nothing else, so on its own there is no display:grid and the two
             fields stack. grid-2 is what makes it a grid, and the pair collapse
             to one column on a phone through the media query in lyndry.css. -->
        <div class="grid-2 grid-2-wide" style="gap:16px;">
          ${field(
            { id: 'city', text: 'Town' },
            '',
            `<input class="input input-lg" type="text" id="city" name="city" required
                    autocomplete="address-level2" value="${v(customer.city)}">`
          )}
          ${field(
            { id: 'postal_code', text: 'ZIP code' },
            '',
            `<input class="input input-lg" type="text" id="postal_code" name="postal_code" required
                    inputmode="numeric" pattern="[0-9]{5}" maxlength="5"
                    autocomplete="postal-code" value="${v(customer.postal_code)}">`
          )}
        </div>
        ${spotField(customer)}
      </div>
      <button type="submit" class="btn btn-primary btn-lg btn-full" style="margin-top:24px;">
        Save {{ICON_ARROW}}
      </button>
    </form>`;
}

// BUILT FROM wash.OPTIONS, NOT TYPED OUT. The text thread asks this question
// from the same place, so the website cannot come to offer a choice the wash
// module does not know about - which is exactly how the signup form ended up
// offering two kinds of detergent that had not existed for months.
//
// NOTHING IS PRE-SELECTED on a first answer. There are no default wash
// preferences anywhere: "we've set you up with cold water" went to a real
// customer who had chosen nothing, and a radio that arrives already ticked is
// the same sentence written in HTML.
function washForm(customer) {
  const prefs = customer.preferences || {};

  const group = (key) => {
    const option = wash.OPTIONS[key];
    const saved = prefs[key];

    return `
      <fieldset style="border:0;padding:0;margin:0;">
        <legend class="field-label" style="padding:0;">${escapeHtml(option.label)}</legend>
        <div style="display:flex;flex-wrap:wrap;gap:22px;margin-top:10px;">
          ${option.choices
            .map(
              (choice) => `
            <label class="check">
              <input type="radio" name="${key}" value="${escapeHtml(choice.value)}" required${
                saved === choice.value ? ' checked' : ''
              }>
              <span class="check-box check-box-round">{{ICON_CHECK}}</span>
              <span style="font-size:16px;color:var(--ink-900);">${escapeHtml(
                choice.short || choice.label
              )}</span>
            </label>`
            )
            .join('')}
        </div>
      </fieldset>`;
  };

  return `
    <form method="post" action="/account/wash">
      <div class="stack">
        ${wash.KEYS.map(group).join('')}
      </div>
      <p style="font-size:14px;line-height:1.55;color:var(--ink-500);margin:18px 0 0;">
        We use a standard detergent.
      </p>
      <button type="submit" class="btn btn-primary btn-lg btn-full" style="margin-top:18px;">
        Save {{ICON_ARROW}}
      </button>
    </form>`;
}

// A BUTTON, NOT A PRE-BUILT LINK. Minting the payment link needs a call to the
// payment provider, so building it into this page would open a session every
// time anybody loaded their dashboard. The route does it on the way through.
function cardForm(customer) {
  const saved = customer.card_last4;

  return `
    <form method="post" action="/account/card">
      <p style="font-size:15px;line-height:1.55;color:var(--ink-700);margin:0 0 16px;">
        ${
          saved
            ? `Nothing is taken until we weigh your laundry. We never see the number.`
            : `<strong>Nothing is taken now.</strong> You are charged after we weigh your
               laundry, and we never see the number.`
        }
      </p>
      <button type="submit" class="btn ${saved ? 'btn-outline' : 'btn-primary btn-full'} btn-lg">
        ${saved ? 'Replace card' : 'Save a card, $0 today'} {{ICON_ARROW}}
      </button>
    </form>`;
}

// --- The dashboard pieces ---------------------------------------------------

// THE BUTTON IS ALWAYS LIVE, whatever is missing. Neil's call, and it reverses
// what was here: a card that refused to link anywhere until the address and the
// wash preferences were in, which put the setup in front of the reason anybody
// came. Placing an order is now the way IN to setup rather than something
// gated behind it - /account/book collects what it needs as it goes, in the
// order the person is already thinking about.
//
// A thin box with a button in it, not a poster.
function placeOrderButton(schedules = []) {
  const active = (schedules || []).filter((s) => s.status === 'ACTIVE');

  // A STANDING ORDER HAS TO BE VISIBLE AND STOPPABLE. It books itself every
  // week without anybody touching the site, so a portal that could start one
  // and not show it would be the worst version of this feature.
  const repeating = active.length
    ? `
    <div class="card card-xl" style="display:flex;flex-wrap:wrap;align-items:center;
                justify-content:space-between;gap:16px;padding:18px 26px;margin-bottom:26px;
                background:var(--paper-050);">
      <p style="margin:0;font-size:16px;line-height:1.5;color:var(--ink-800);">
        <strong>Repeating:</strong> ${escapeHtml(String(describeAll(active)))}.
        We text you the evening before each one.
      </p>
      <details style="margin:0;">
        <summary class="btn btn-outline" style="cursor:pointer;list-style:none;">Stop repeating</summary>
        <form method="post" action="/account/repeat/stop" style="margin:16px 0 0;">
          <p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:var(--ink-700);">
            This stops the repeat and cancels any pickup it had already booked that
            we have not picked up yet. Nothing we are already holding is affected,
            and you can start a new repeat whenever you like.
          </p>
          <button class="btn btn-outline">Yes, stop repeating</button>
        </form>
      </details>
    </div>`
    : '';

  return `
  ${repeating}
  <div class="card card-xl card-lilac"
       style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;
              gap:18px;padding:22px 26px;margin-bottom:26px;">
    <div>
      <h2 style="font-family:var(--font-display);font-weight:900;font-size:26px;
                 line-height:1.1;margin:0;color:var(--ink-900);">Place an order</h2>
    </div>
    <a href="/account/book" class="btn btn-ink btn-lg" style="text-decoration:none;">
      Book a pickup {{ICON_ARROW}}
    </a>
  </div>`;
}

// ---------------------------------------------------------------------------
// The three cards under it.
//
// THEY ARE LINKS TO PAGES, NOT DROPDOWNS. Neil's call. A form folded inside a
// <details> on the dashboard meant three long forms hiding under one screen and
// no way to link anybody straight to the thing they needed to change.
//
// A CARD ONLY APPEARS ONCE THERE IS SOMETHING TO SHOW. An empty "Not set yet"
// card is an instruction to go and do setup, which is exactly the thing the
// order button now handles - so a brand-new account sees the button and nothing
// else, and each card turns up as its fact comes into existence.
//
// THE PAYMENT CARD IS THE ONE EXCEPTION, and `needsCardNow` is what makes it.
// A customer with a pickup booked and no card has something they MUST do -
// the driver cannot come out - and hiding the card until they had saved one
// meant the dashboard said nothing about it at all. So it shows either when
// there is a card to update, or when there is an order waiting on one.
// ---------------------------------------------------------------------------
function summaryCards(customer, { needsCardNow = false } = {}) {
  const prefs = customer.preferences || {};
  const cards = [];

  // ONE HEIGHT, ONE WIDTH, AND THE BUTTON ON THE FLOOR OF EACH.
  //
  // These were link-shaped cards whose whole body was the anchor, so the words
  // "Update wash instructions" wrapped onto two lines in one card and not the
  // others - three boxes of three different heights with the control at three
  // different heights inside them. A column flex with the value stretching
  // pushes every button to the bottom, and the grid's own rows make the cards
  // equal.
  //
  // THE BUTTON SAYS "UPDATE" AND NOTHING ELSE. Neil's call: the heading two
  // lines above it already says which card this is, so repeating it is a longer
  // label that only makes the three disagree about how tall they are.
  const card = (href, title, value) => `
    <div class="card card-xl"
         style="display:flex;flex-direction:column;padding:24px;height:100%;">
      <p class="eyebrow" style="margin-bottom:6px;">On file</p>
      <h3 style="font-family:var(--font-display);font-weight:800;font-size:20px;margin:0 0 10px;color:var(--ink-900);">
        ${escapeHtml(title)}
      </h3>
      <p style="flex:1;font-size:15px;line-height:1.5;color:var(--ink-700);margin:0 0 18px;">${value}</p>
      <a href="${href}" class="btn btn-outline btn-full" style="text-decoration:none;">Update</a>
    </div>`;

  if (booking.hasAddress(customer)) {
    cards.push(
      card(
        '/account/address',
        'Address',
        `${escapeHtml(customer.address_line1)}${
          customer.address_line2 ? `, ${escapeHtml(customer.address_line2)}` : ''
        }<br>${escapeHtml(customer.city)} ${escapeHtml(customer.postal_code)}${
          spotOf(customer)
            ? `<br><span style="color:var(--ink-500);">Bag at the ${escapeHtml(spotOf(customer))}</span>`
            : ''
        }`
      )
    );
  }

  if (booking.hasPreferences(customer)) {
    cards.push(card('/account/wash', 'Wash instructions', escapeHtml(wash.describeSaved(prefs))));
  }

  if (customer.card_last4) {
    cards.push(
      card(
        '/account/payment',
        'Payment method',
        `${escapeHtml(String(customer.card_brand || 'Card'))} ending ${escapeHtml(
          String(customer.card_last4)
        )}`
      )
    );
  } else if (needsCardNow) {
    cards.push(
      card(
        '/account/payment',
        'Payment method',
        '<span style="color:var(--stain-600);">No card on file. The driver cannot come ' +
          'out until there is one.</span>'
      )
    );
  }

  if (!cards.length) return '';

  // The grid is sized to what is actually there, so one card does not sit in a
  // third of a row with two holes beside it.
  const cls = cards.length === 1 ? '' : cards.length === 2 ? 'grid-2' : 'grid-3';

  return `<div class="${cls}" style="gap:22px;margin-bottom:44px;grid-auto-rows:1fr;align-items:stretch;${
    cards.length === 1 ? 'max-width:340px;' : ''
  }">${cards.join('')}</div>`;
}

module.exports = {
  gapsFor,
  blocking,
  spotOf,
  accessNotesOf,
  hasName,
  placeOrderButton,
  summaryCards,
  addressForm,
  washForm,
  cardForm,
};
