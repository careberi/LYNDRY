'use strict';

// ---------------------------------------------------------------------------
// Print exactly what the AI is told, and everything it is allowed to do.
//
//   npm run prompt
//
// This is the whole of the AI's behaviour. There is nothing else: no hidden
// training, no separate rules file, no memory between messages. Every message
// a customer sends starts from a blank slate plus the text below.
//
// It exists because "what is the AI allowed to do" should be answerable by
// reading one screen, not by reading source code.
// ---------------------------------------------------------------------------

const brain = require('../src/core/brain');
const booking = require('../src/core/booking');

const line = (ch = '-') => console.log(ch.repeat(78));

const now = booking.nowInService();

line('=');
console.log('  WHAT THE AI IS TOLD');
console.log('  src/core/brain.js  ->  systemPrompt()');
line('=');
console.log();
console.log(brain.systemPrompt(now.date, now));
console.log();

line('=');
console.log('  WHAT IT IS TOLD ABOUT THE PERSON TEXTING');
console.log('  src/core/brain.js  ->  customerContext()');
line('=');
console.log();
console.log(
  brain.customerContext(
    {
      name: 'Andre',
      address_line1: '1 Placeholder Ave',
      city: 'Jersey City',
      state: 'NJ',
      postal_code: '07302',
      preferences: {
        water_temp: 'COLD',
        detergent: 'STANDARD',
        fabric_softener: true,
        default_pickup_method: 'LEAVE_OUTSIDE',
      },
    },
    {
      order_number: 1011,
      status: 'REQUESTED',
      pickup_date: '2026-08-13',
      pickup_time: '15:00',
      pickup_window_start: '14:00',
      pickup_window_end: '17:00',
    },
    [
      { direction: 'INBOUND', body: 'hey can you grab my laundry tomorrow' },
      { direction: 'OUTBOUND', body: "Of course! We'll be there Thursday 13 Aug between 2 and 5pm." },
    ]
  )
);
console.log();

line('=');
console.log('  THE ONLY ACTIONS IT CAN TAKE');
console.log('  src/core/brain.js  ->  TOOLS,  carried out by src/core/actions.js');
line('=');
console.log();

for (const tool of brain.TOOLS) {
  const args = Object.keys(tool.input_schema.properties || {});
  const required = tool.input_schema.required || [];

  console.log(`  ${tool.name}(${args.join(', ')})`);
  console.log(`      ${tool.description.replace(/\s+/g, ' ').trim()}`);
  if (args.length) {
    console.log(`      required: ${required.length ? required.join(', ') : 'nothing'}`);
  }
  console.log();
}

line('=');
console.log('  WHAT IT CANNOT DO, NO MATTER WHAT ANYONE TEXTS');
line('=');
console.log(`
  - Set or change a price. Every figure comes from the database, and the rate
    is the one stored on that order, not today's rate.
  - Move money. Charging happens in code at the moment a weight is recorded.
  - Open a locker it was told to open. open_locker() takes no arguments; the
    compartment is worked out from the caller's own phone number.
  - Touch anybody else's order. Every action is scoped to the phone number the
    message arrived from.
  - Change an order's status. Only src/core/orders.js may do that, and it
    refuses any move the state machine does not allow.
  - Answer STOP, START or HELP. Those are handled in code before the AI is
    ever called, because they are legally required and must not depend on a
    model reading them correctly.
  - Sign anyone up without a consent record.

  The model chooses WHICH action to take. Our code decides what actually
  happens, and writes every number the customer is told.
`);
