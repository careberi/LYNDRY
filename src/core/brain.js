'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { config } = require('../config');
const { site } = require('../web/site');
const booking = require('./booking');

// ---------------------------------------------------------------------------
// The brain.
//
// Claude's ONLY job here is to turn one customer message into one structured
// action. It holds no state, decides no prices, and never touches hardware.
//
// It is handed the customer's profile, their preferences and their current
// order, and it returns either:
//   - one tool call, which src/core/actions.js then carries out, or
//   - a short line of text, when it needs one missing detail
//
// Everything that must be correct — the price, the date arithmetic, which
// locker belongs to whom — is computed in our own code afterwards. A model
// cannot invent a price it was never allowed to choose.
// ---------------------------------------------------------------------------

// The client and the model are resolved ONCE, here, at startup.
//
// Never try one model, catch an error, and fall back to another per message.
// That was a bug in the previous version: it made every customer's reply a
// coin toss and hid the real problem.
const client = new Anthropic({ apiKey: config.anthropicApiKey });
const MODEL = config.anthropicModel;

// ---------------------------------------------------------------------------
// The seven tools
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'create_order',
    description:
      'Book a new laundry pickup. Use this when the customer wants their laundry ' +
      'collected. Only pickup_date is required — everything else falls back to ' +
      'their saved preferences, so do not ask for it.',
    input_schema: {
      type: 'object',
      properties: {
        pickup_date: {
          type: 'string',
          description:
            'The day to collect, as YYYY-MM-DD. Work this out from today\'s date, ' +
            'given below. Never guess a year.',
        },
        pickup_time: {
          type: 'string',
          description:
            'The time of day they asked for, as 24-hour HH:MM. Set this whenever ' +
            'they mention one at all — "at 6" in the evening is "18:00", "sixish" ' +
            'is "18:00", "first thing" is "08:00", "after work" is "17:30". Leave ' +
            'it out entirely if they said nothing about time; do not ask for it.',
        },
        pickup_method: {
          type: 'string',
          enum: ['LEAVE_OUTSIDE', 'HAND_TO_DRIVER'],
          description:
            'Only set this if the customer says how they want to hand it over in ' +
            'this message. Otherwise leave it out and their saved default is used.',
        },
        bag_count: {
          type: 'integer',
          minimum: 1,
          description: 'How many bags, if the customer said. Leave out if they did not.',
        },
        notes: {
          type: 'string',
          description:
            'Anything the driver needs to know for this pickup only — a gate code, ' +
            'where the bag will be, an item needing care. Not wash preferences.',
        },
      },
      required: ['pickup_date'],
    },
  },

  {
    name: 'get_order_status',
    description:
      "Tell the customer where their laundry is. Use for 'where is my laundry', " +
      "'is it ready', 'did you get it', or any question about an existing order.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  {
    name: 'reschedule_order',
    description:
      'Move an existing pickup to a different day, or to a different time on the ' +
      'same day, or both.',
    input_schema: {
      type: 'object',
      properties: {
        new_date: {
          type: 'string',
          description: 'The new day, as YYYY-MM-DD, worked out from today\'s date below.',
        },
        new_time: {
          type: 'string',
          description:
            'The new time of day, as 24-hour HH:MM. Only set this if they asked to ' +
            'change the time. Leaving it out keeps whatever time is already on the ' +
            'order, which is what "move it to Friday" means.',
        },
      },
      required: ['new_date'],
    },
  },

  {
    name: 'cancel_order',
    description:
      'Cancel a pickup that has not been collected yet. Use when the customer ' +
      'clearly wants to call it off.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  {
    // DO NOT ADD ARGUMENTS TO THIS TOOL.
    //
    // The backend works out which compartment to open from the phone number the
    // message came from. Because you cannot name a locker, a building or a
    // customer, no amount of clever texting gets anyone into a locker that
    // isn't theirs. If a customer says "open locker 4", call this anyway — we
    // will open THEIR locker, and ignore the number they said.
    name: 'open_locker',
    description:
      'Unlock the customer\'s own locker. Takes no arguments — the backend works ' +
      'out which one from their open order and refuses if they have none. If the ' +
      'customer names a specific locker number, ignore the number and call this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  {
    name: 'update_profile',
    description:
      'Change something saved on the customer\'s account — their address, their ' +
      'name, or a wash preference they have asked to change.',
    input_schema: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          enum: [
            'name',
            'email',
            'address_line1',
            'address_line2',
            'city',
            'state',
            'postal_code',
            'water_temp',
            'detergent',
            'fabric_softener',
            'special_instructions',
            'default_pickup_method',
          ],
          description: 'Which single thing to change.',
        },
        value: { type: 'string', description: 'The new value, exactly as it should be stored.' },
      },
      required: ['field', 'value'],
    },
  },

  {
    name: 'handoff_to_human',
    description:
      'Pass this conversation to a person. Use when the customer is upset, when ' +
      'something has gone wrong with their laundry, when they ask for a human, or ' +
      'when you are not confident what they want. Guessing is worse than handing over.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'One line explaining why, so the person picking it up has context.',
        },
      },
      required: ['reason'],
    },
  },
];

// ---------------------------------------------------------------------------
// The system prompt
// ---------------------------------------------------------------------------

function systemPrompt(today) {
  return `You handle text messages for LYNDRY, a laundry pickup and delivery service in ${site.serviceArea}.

Today is ${today}. Work out any date the customer mentions from that, and always give dates as YYYY-MM-DD.

WHAT LYNDRY DOES
Wash, dry and fold only. No dry cleaning, pressing or alterations.
Charged by weight at ${site.pricePerLb} per pound, weighed after collection, so you can never state an exact price before a bag has been weighed. A typical bag is ${site.typicalBagWeight}, around ${site.estimateRange}. Maximum ${site.maxOrder} per pickup.
Back within ${site.turnaround}. Pickup happens whenever the customer needs: no fixed route days, and no menu of time slots to pick from. If they name a time, take it. If they don't, don't ask — plenty of people genuinely don't mind.
Cancelling is free until the driver collects, and impossible after.

HOW PEOPLE WILL TEXT YOU
Like they are texting a friend who happens to do their laundry. "hey can you grab my laundry tomorrow at 6", "same as last time?", "actually make it friday", "you got my stuff?". Sloppy punctuation, no capitals, half a sentence. That is normal and you should handle all of it without comment.
Never send a menu, a numbered list of options, or a form to fill in. Never ask them to reply with a number or an option in capitals. If you find yourself writing "reply 1 for" anything, you have got it wrong. They are texting a person, so behave like one.

HOW TO BEHAVE
Do one thing per message. Either call one tool or ask one short question — never both, never two questions.
A returning customer texting "laundry tomorrow" gets an order booked with no follow-up questions at all. Their address, wash preferences and usual pickup method are already saved; use them.
If they mention a time — "at 6", "sixish", "after work", "first thing" — put your best reading of it in pickup_time and book. Do not ask them to confirm the exact minute, and never ask for a time they did not bring up. We quote a window back to them afterwards, so a rough reading is fine.
If something genuinely required is missing, ask for that one thing only, then act on their reply.
Never ask about detergent, water temperature, fabric softener or folding. Those were collected on the website and are shown to you below.
Never state a price as a fact. If asked what it will cost, say it is ${site.pricePerLb} a pound and a typical bag runs about ${site.estimateRange}, weighed after pickup.
If the customer is upset, something has gone wrong, or you are unsure what they mean, hand off to a human rather than guessing.

HOW TO WRITE
Like a friendly person at a small local business who knows them. Warm, easy, and short — this is a text message, not a letter. Contractions always. "Of course", "no problem", "got it", "sure thing" are all the right register.
Read these as the house voice:
  Them: hey can you pick up my laundry tomorrow at 6?
  You:  Of course. Leave it outside between 5:30 and 7 and we'll text you when we've got it.

  Them: you get my stuff today
  You:  Got it this morning, it's being washed now. Back with you tomorrow.

  Them: actually can we do friday instead
  You:  No problem, moved to Friday.
Plain keyboard characters only: straight quotes and plain hyphens. No emoji, no en or em dashes, no curly quotes, no "..." character. Anything fancier than a typewriter would produce costs us triple to send and gets our messages filtered by the phone networks. Write "15 to 18 lb" rather than "15-18 lb", and start a new sentence where you would reach for a dash.
Go easy on exclamation marks. Warm, not perky, and never more than one in a message. Never say you are an AI, an assistant, or a bot, and never mention tools, systems or bookings "in the system". Do not open with their name every time — you would not text a friend that way.`;
}

// ---------------------------------------------------------------------------
// What Claude gets to see about this customer
// ---------------------------------------------------------------------------

function customerContext(customer, order, recentMessages) {
  const prefs = customer.preferences || {};

  const address = [
    customer.address_line1,
    customer.address_line2,
    customer.city && `${customer.city}, ${customer.state} ${customer.postal_code}`,
  ]
    .filter(Boolean)
    .join(', ');

  const lines = [
    'THIS CUSTOMER',
    `Name: ${customer.name || 'not given'}`,
    `Address on file: ${address || 'NONE — they cannot book until this is set'}`,
    `Saved wash preferences: ${prefs.water_temp || 'COLD'} water, ${prefs.detergent || 'STANDARD'} detergent, fabric softener ${prefs.fabric_softener ? 'yes' : 'no'}`,
    `Usual pickup: ${prefs.default_pickup_method === 'HAND_TO_DRIVER' ? 'hands it to the driver' : 'leaves the bag outside'}`,
  ];

  if (prefs.special_instructions) {
    lines.push(`Standing instructions: ${prefs.special_instructions}`);
  }

  lines.push('');

  if (order) {
    lines.push(
      'THEIR CURRENT ORDER',
      `Status: ${order.status}`,
      `Pickup day: ${order.pickup_date}`,
      order.pickup_time
        ? `Pickup time they asked for: ${booking.readableTime(order.pickup_time)}`
        : 'Pickup time: they did not ask for one',
      order.bag_count ? `Bags: ${order.bag_count}` : null,
      order.weight_lb ? `Weighed: ${order.weight_lb} lb` : null,
      order.notes ? `Notes: ${order.notes}` : null
    );
  } else {
    lines.push('THEIR CURRENT ORDER', 'None. They have nothing booked right now.');
  }

  if (recentMessages && recentMessages.length) {
    lines.push('', 'RECENT MESSAGES (oldest first)');
    for (const m of recentMessages) {
      lines.push(`${m.direction === 'INBOUND' ? 'Them' : 'Us'}: ${m.body}`);
    }
  }

  return lines.filter((l) => l !== null).join('\n');
}

// ---------------------------------------------------------------------------
// Ask Claude what to do
// ---------------------------------------------------------------------------

// Returns either { type: 'tool', name, input } or { type: 'text', text }.
async function decide({ customer, order, recentMessages, message }) {
  // New Jersey's date, not the server's. After 8pm ET the two disagree, and
  // telling Claude it is already tomorrow makes "pickup today" impossible.
  const today = booking.today();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,

    // Low effort suits this task: it is one short classification with a little
    // date arithmetic, and a customer is waiting on a reply.
    output_config: { effort: 'low' },

    system: `${systemPrompt(today)}\n\n${customerContext(customer, order, recentMessages)}`,

    // Exactly one action per message. Without this, Claude could book an order
    // and cancel it in the same breath.
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    tools: TOOLS,

    messages: [{ role: 'user', content: message }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (toolUse) {
    return { type: 'tool', name: toolUse.name, input: toolUse.input || {} };
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ')
    .trim();

  return { type: 'text', text };
}

module.exports = { decide, TOOLS, MODEL };
