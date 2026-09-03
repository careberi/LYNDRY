'use strict';

// ---------------------------------------------------------------------------
// What a customer can choose about their wash, and what it costs.
//
// ONE PLACE. The AI's tool schema, the price, the laundromat's ticket, the
// account page and the ops screens all read this, so an option cannot exist in
// one of them and not another - which is how a customer ends up choosing
// something the people doing the washing never see.
//
// TWO THINGS ARE NOT CHOICES AND MUST NOT BECOME ONE:
//
//   Drying. Everything is tumble dried. There is no field for it, and the
//   prompt says the AI must not offer an exception or promise to make a note.
//
//   Sorting. Every order is sorted the same way - see SORTING below. It is a
//   standard, not a preference, so it is stated to the laundromat rather than
//   asked of the customer.
// ---------------------------------------------------------------------------

// TWO QUESTIONS, AND NEITHER COSTS ANYTHING. Neil's simplification: the
// customer picks the water temperature and says whether they want softener.
// That is the whole of it.
//
// DETERGENT LEFT THIS LIST and became a standard, below. It was a choice
// between standard and free & clear at +$2, which meant every new customer had
// to be asked about detergent before we could book them - and the +$2 was
// never actually billed, which the reconciliation report found. Neil's call:
// "detergent is just gonna be standard across the board, there's not gonna be
// an upcharge, we're not gonna ask about that."
//
// SO NOTHING HERE COSTS ANYTHING NOW. surchargeFor() is kept and returns zero,
// because a paid option is a plausible thing to want again and the billing
// path that reads it is already correct - see fulfilment.recordWeight(). What
// is gone is any option that charges, not the ability to have one.
const OPTIONS = Object.freeze({
  fabric_softener: Object.freeze({
    label: 'Softener',
    default: 'STANDARD',
    // A yes and a no, and the SHORT names say exactly that. "Softener:
    // Softener or No Softener" is what building the question out of the full
    // labels produced, and it reads like a machine. The full labels are what a
    // laundromat sees on the ticket, where precision matters more than
    // register.
    //
    // Fragrance-free was the third and went with the
    // detergent: it was the other +$2, and asking somebody to choose between
    // three kinds of softener on a phone is the form this product exists not
    // to be.
    choices: Object.freeze([
      Object.freeze({ value: 'STANDARD', label: 'Standard scented', short: 'Yes', cents: 0 }),
      Object.freeze({ value: 'NONE', label: 'No softener', short: 'No', cents: 0 }),
    ]),
  }),

  water_temp: Object.freeze({
    label: 'Water',
    default: 'COLD',
    choices: Object.freeze([
      Object.freeze({ value: 'COLD', label: 'Cold', cents: 0 }),
      Object.freeze({ value: 'WARM', label: 'Warm', cents: 0 }),
      Object.freeze({ value: 'HOT', label: 'Hot', cents: 0 }),
    ]),
  }),
});

// WHAT IS FIXED AND THEREFORE NEVER ASKED.
//
// A laundromat still has to be TOLD these - they are instructions for the wash
// - but a customer is never offered them, exactly like the sorting standard
// below. Detergent moved here from OPTIONS; drying has always been here in
// spirit and is stated in the prompt.
const STANDARDS = Object.freeze([Object.freeze(['Detergent', 'Standard'])]);

// HOW EVERY ORDER IS SORTED. Neil's words, and it is a standard rather than a
// preference: it is printed on the laundromat's ticket and never asked of a
// customer, because a customer choosing not to separate their delicates is not
// a thing we would honour.
const SORTING = Object.freeze([
  'Sort into whites/lights and colours/darks when practical.',
  'Separate obvious delicates, heavily soiled items, and anything needing special care.',
  'Never combine different customers\' laundry.',
]);

const KEYS = Object.freeze(Object.keys(OPTIONS));

// The choice a customer made for one option, falling back to its default.
function choiceFor(key, value) {
  const option = OPTIONS[key];
  if (!option) return null;

  const wanted = String(value == null ? '' : value).toUpperCase();
  return (
    option.choices.find((c) => c.value === wanted) ||
    option.choices.find((c) => c.value === option.default)
  );
}

// Is this a value we actually offer? Used to refuse anything the AI invents.
function isValid(key, value) {
  const option = OPTIONS[key];
  if (!option) return false;
  return option.choices.some((c) => c.value === String(value || '').toUpperCase());
}

// What the chosen options add, in cents.
//
// Read at BOOKING and frozen onto the order. Never at billing time: changing
// what an option costs must not re-price work already quoted, and a customer
// switching preference after collection must not change the price of a bag
// already on a scale.
function surchargeFor(preferences) {
  const p = preferences || {};
  return KEYS.reduce((total, key) => {
    const choice = choiceFor(key, p[key]);
    return total + (choice ? choice.cents : 0);
  }, 0);
}

// The lines a laundromat sees, as label/value pairs.
//
// STRUCTURED FIELDS ONLY, and this is a security boundary rather than a
// styling decision. Free text never crosses to a partner: a real saved
// preference reads "deliver to 16-51 Chandler Dr", and no pattern catches
// "the Bergen Pediatrics name tags", so the page lists what it allows rather
// than trying to redact what it does not.
function washLines(preferences) {
  const p = preferences || {};

  // Water first, then softener, then the fixed standards. The order is what
  // somebody at a machine works through, not the order the object happens to
  // have its keys in.
  const chosen = ['water_temp', 'fabric_softener'].map((key) => {
    const option = OPTIONS[key];
    const choice = choiceFor(key, p[key]);
    return [option.label, choice.label];
  });

  // STANDARDS ARE PRINTED, NOT ASKED. A laundromat needs to know the detergent
  // even though nobody chose it - leaving it off the ticket would leave them
  // guessing at the one thing we have decided for them.
  return chosen.concat(STANDARDS.map((pair) => [...pair]));
}

// The same thing said to a customer, with the prices in it.
function describeChoices(key) {
  const option = OPTIONS[key];
  if (!option) return '';
  return option.choices
    .map((c) => `${c.label}${c.cents ? ` (+$${(c.cents / 100).toFixed(0)})` : ''}`)
    .join(', ');
}

// WHAT ONE CUSTOMER ACTUALLY CHOSE, as a sentence for a text message.
//
// Not to be confused with describeChoices() above, which lists what is on
// OFFER for a key. This one reads a saved profile back, and it is what the
// booking confirmation says - the single message that is the record of the
// order, so it has to be right.
//
// It reads through washLines(), which is the same function the laundromat's
// tag page uses, so a customer and the person washing their clothes are being
// told the same thing from the same place.
function describeSaved(prefs) {
  const lines = washLines(prefs);
  if (!lines.length) return '';

  const water = lines.find(([k]) => k === 'Water');
  const softener = lines.find(([k]) => k === 'Softener');

  // The detergent is not mentioned. It is the same for everybody, so reading it
  // back as though they had chosen it is telling somebody what they have been
  // "set up with" - the exact sentence Neil called unacceptable when it went to
  // a real customer.
  const parts = [];
  if (water) parts.push(`Washed ${water[1].toLowerCase()}`);
  if (softener) {
    parts.push(/^no /i.test(softener[1]) ? 'with no softener' : 'with softener');
  }

  return parts.join(' ');
}

// THE WASH QUESTION, IN THE ONE PLACE IT IS ALLOWED TO EXIST.
//
// Built from OPTIONS above rather than typed out, so a price that changes here
// changes what the customer is quoted, and an option that is added cannot be
// missing from the question.
//
// It is a single verbatim string because the prompt used to carry TWO different
// wordings of it, and a model handed the same question twice in two forms
// paraphrases. On a live thread it produced "cold or warm water, regular or
// hypoallergenic detergent, and softener or no?" - which dropped hot water,
// invented a word we do not use, and, worst of all, dropped BOTH $2 charges.
// A surcharge somebody first learns about on their bill is a complaint.
function money(cents) {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

// "a, b or c" - the way somebody says a list out loud. A trailing comma before
// "or" reads as written-down rather than spoken, which is the whole register
// this thread is trying to hold.
function orList(items) {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

// NEIL'S WORDING, BUILT FROM THE OPTIONS ABOVE.
//
// A labelled list rather than a sentence, which is a deliberate exception to
// the never-send-a-menu rule and worth saying why it is not one: there are no
// numbers to reply with, no codes, no "reply 1 for". A customer answers it the
// way they would answer a person - "cold, standard, no softener" - and the
// three lines only make the choices legible instead of running them together
// in a paragraph that has to be read twice.
//
// GENERATED, NOT TYPED OUT, so a price that changes on the options above
// changes what the customer is quoted. The one thing this file must never do
// is name a figure the billing code does not agree with.
//
// Title Case and the short names, because this is the customer's message. The
// full labels are what a laundromat reads off a tag, where there is room; here
// every character is billed by the segment. It lands at 183 characters - two
// segments, the same as the sentence it replaces, so the clarity is free.
const QUESTION = (() => {
  const name = (c) => c.short || c.label;

  // "a, b, or c" - Neil's punctuation, including the serial comma, because
  // this list is read at a glance rather than out loud.
  const list = (choices) => {
    const parts = choices.map(
      (c) => `${name(c)}${c.cents ? ` (+${money(c.cents)})` : ''}`
    );
    if (parts.length < 3) return parts.join(' or ');
    return `${parts.slice(0, -1).join(', ')}, or ${parts[parts.length - 1]}`;
  };

  // TWO LINES NOW, NOT THREE. The detergent line went with the choice, which
  // takes the question from 183 characters to about 100 - back inside a single
  // SMS segment, where it was two. A shorter question is also one people answer
  // in a single reply.
  return [
    'How would you like your laundry washed?',
    '',
    `Water: ${list(OPTIONS.water_temp.choices)}`,
    '',
        `Softener: ${list(OPTIONS.fabric_softener.choices)}`,
  ].join('\n');
})();

module.exports = {
  OPTIONS,
  KEYS,
  SORTING,
  STANDARDS,
  QUESTION,
  choiceFor,
  isValid,
  surchargeFor,
  washLines,
  describeChoices,
  describeSaved,
};
