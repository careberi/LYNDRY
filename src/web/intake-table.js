'use strict';

const { escapeHtml } = require('./layout');
const intake = require('../core/intake');

// ---------------------------------------------------------------------------
// EVERY FIELD, ITS VALUE, WHERE THE VALUE CAME FROM, AND A WAY TO ASK.
//
// This REPLACES the "what is still missing" cards. Neil's brief, 16 September:
// the screen's job is no longer to list gaps, it is to answer "what does
// LYNDRY know about this customer" at a glance - so completed rows stay, and a
// default is shown as a default rather than as a warning.
//
// It is one function rendered in three places - the conversation, the customer
// and the order - because two copies of "what do we know" would disagree the
// first time one of them learned something the other did not. Same reason the
// panel it replaces was one function.
//
// DENSE AND SCANNABLE, which is his rule 35 and is also the ops house style: a
// table you read down a column, not a stack of cards with a paragraph under
// each. The explanation that used to sit under every card is gone; what is
// left is the four things an operator actually needs.
//
// NO JAVASCRIPT, like every other ops screen. The composer opens with `:target`
// - the action is a plain link to the row's own id, and CSS shows that row.
// A driver or an owner on two bars of signal gets a page that either worked or
// did not, and the one thing that must never fail is the box that texts a
// customer.
//
// THAT ALSO GIVES ONE COMPOSER AT A TIME FOR FREE, which is what you want:
// opening the pickup-date question closes the address one, so there is never a
// second half-typed message on screen that somebody thinks they sent.
// ---------------------------------------------------------------------------

// The four states, as the words Neil asked for and the tone each earns.
//
// A DEFAULT IS NOT A WARNING. That is the whole point of the table. Only a
// MISSING row that is actually holding something up gets the loud treatment,
// and "missing" on an optional field gets nothing at all - see `tone()`.
const WORDS = {
  [intake.STATES.EXPLICIT]: 'Explicit',
  [intake.STATES.DEFAULT]: 'Default',
  [intake.STATES.MISSING]: 'Missing',
  [intake.STATES.NA]: 'N/A',
};

function tone(field) {
  if (field.state === intake.STATES.MISSING) {
    // Three kinds of missing, and only two of them are anybody's problem right
    // now. A customer between orders is missing a pickup date and is missing
    // nothing.
    if (field.blocks === intake.NEEDED.BOOKING) return 'bad';
    if (field.blocks === intake.NEEDED.DISPATCH) return 'bad';
    return 'warn';
  }
  if (field.state === intake.STATES.EXPLICIT) return 'ok';
  return '';
}

// --- one row ----------------------------------------------------------------

function fieldRow(field, { action, canSend, ago, id }) {
  const value =
    field.value == null
      ? `<span class="intake-none">&mdash;</span>`
      : escapeHtml(field.value);

  const asked = field.askedAt
    ? `<div class="intake-asked">Asked ${escapeHtml(ago(field.askedAt))}, awaiting reply</div>`
    : '';

  const control =
    canSend && field.action
      ? `<a class="cbtn intake-open" href="#${id}">${escapeHtml(field.action)}</a>`
      : `<span class="intake-none">&mdash;</span>`;

  return `
    <tr>
      <th scope="row">${escapeHtml(field.label)}</th>
      <td>${value}</td>
      <td>
        <span class="intake-state intake-state--${tone(field) || 'plain'}">${WORDS[field.state]}</span>
        ${asked}
      </td>
      <td class="intake-act">${control}</td>
    </tr>`;
}

// --- the composer -----------------------------------------------------------
//
// ONE WORKFLOW, NOT TWO. Neil's rule 15: there is no "send standard" beside a
// "send custom". The box opens prefilled with the standard wording, the admin
// edits it or does not, and Send sends exactly what is in the box.
//
// The sentence is still written in code and still shown in full before
// anything is sent, which is the rule the nudges kept and the reason they
// existed: a button that texts a customer something nobody has read is not a
// button anybody should press. What has changed is that the person reading it
// can now fix it.
function composerRow(field, { action, id }) {
  if (!field.action) return '';

  const cost = field.cost
    ? `${field.cost.segments} segment${field.cost.segments === 1 ? '' : 's'}`
    : '';

  return `
    <tr class="intake-ask" id="${id}">
      <td colspan="4">
        <form method="post" action="${action}">
          <input type="hidden" name="field" value="${escapeHtml(field.key)}">
          <!-- WHAT THE ADMIN WAS LOOKING AT. The send is refused if the answer
               has changed since this page was drawn - see intake.send(). -->
          <input type="hidden" name="state" value="${escapeHtml(field.state)}">

          <label class="intake-label" for="msg-${escapeHtml(field.key)}">
            ${escapeHtml(field.action)}
          </label>

          <textarea class="field intake-text" id="msg-${escapeHtml(field.key)}"
                    name="message" rows="3" required>${escapeHtml(field.text || '')}</textarea>

          <div class="intake-send">
            <button class="cbtn primary" type="submit">Send</button>
            <a class="cbtn" href="#intake">Cancel</a>
            <span class="intake-cost">
              ${
                field.approximate
                  ? `The payment link is created when you press Send and added to the end. ` +
                    `Everything above is word for word.`
                  : `${escapeHtml(cost)} as written above. Editing it changes what it costs.`
              }
            </span>
          </div>
        </form>
      </td>
    </tr>`;
}

// --- the whole thing --------------------------------------------------------

// `fields` comes from intake.fieldsFor(). `ago` is the relative-time formatter
// the ops screens already use, passed in rather than copied.
function intakeTable({ fields, action, canSend = false, ago = () => '', optedOut = false }) {
  if (!fields || !fields.length) return '';

  const blocking = intake.blocking(fields);

  // THE ONE LINE AN OPERATOR READS FIRST. Neil's rule 22: for a returning
  // customer the screen should say "they are ready for another pickup, they
  // just need a date", not make somebody read ten rows to work that out.
  const summary = optedOut
    ? `They have opted out, so nothing here can text them. Everything they told us is still below.`
    : blocking.length
    ? `Waiting on ${blocking.map((f) => f.label.toLowerCase()).join(', ')}.`
    : fields.find((f) => f.key === 'pickup_date' && f.state === intake.STATES.MISSING)
    ? 'Ready for another pickup. They just need a date.'
    : 'Nothing outstanding.';

  const rows = fields
    .map((f) => {
      const id = `ask-${f.key}`;
      return (
        fieldRow(f, { action, canSend, ago, id }) +
        (canSend ? composerRow(f, { action, id }) : '')
      );
    })
    .join('');

  return `
    <div class="intake" id="intake">
      <div class="intake-head">
        <h2 style="margin:0;">Customer fields</h2>
        <span class="intake-summary">${escapeHtml(summary)}</span>
      </div>

      <div class="ops-table-wrap">
        <table class="ops-table intake-tbl">
          <thead>
            <tr>
              <th>Field</th>
              <th>Current value</th>
              <th>State</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

module.exports = { intakeTable };
