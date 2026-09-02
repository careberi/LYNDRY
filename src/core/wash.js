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

// The surcharge is in whole cents, like every other amount in this system.
const OPTIONS = Object.freeze({
  detergent: Object.freeze({
    label: 'Detergent',
    default: 'STANDARD',
    choices: Object.freeze([
      Object.freeze({ value: 'STANDARD', label: 'Standard scented', cents: 0 }),
      Object.freeze({ value: 'FREE_CLEAR', label: 'Free & clear, fragrance-free', cents: 200 }),
    ]),
  }),

  fabric_softener: Object.freeze({
    label: 'Softener',
    default: 'STANDARD',
    choices: Object.freeze([
      Object.freeze({ value: 'STANDARD', label: 'Standard scented', cents: 0 }),
      Object.freeze({ value: 'NONE', label: 'No softener', cents: 0 }),
      Object.freeze({ value: 'FRAGRANCE_FREE', label: 'Fragrance-free', cents: 200 }),
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
  return KEYS.map((key) => {
    const option = OPTIONS[key];
    const choice = choiceFor(key, p[key]);
    return [option.label, choice.label];
  });
}

// The same thing said to a customer, with the prices in it.
function describeChoices(key) {
  const option = OPTIONS[key];
  if (!option) return '';
  return option.choices
    .map((c) => `${c.label}${c.cents ? ` (+$${(c.cents / 100).toFixed(0)})` : ''}`)
    .join(', ');
}

module.exports = { OPTIONS, KEYS, SORTING, choiceFor, isValid, surchargeFor, washLines, describeChoices };
