'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { config } = require('../config');
const { site } = require('../web/site');
const booking = require('./booking');
const recurring = require('./recurring');

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
      'collected. Only pickup_date is required. Everything else falls back to ' +
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
      'Unlock the customer\'s own locker. Takes no arguments, because the backend works ' +
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
    // Onboarding, in one call.
    //
    // Deliberately NOT update_profile called five times. Somebody who has just
    // been asked "what's your name and where should we collect from?" answers
    // with all of it in one message — "Neil, 12 Palisade Ave, Jersey City
    // 07306" — and asking them to confirm it back one field at a time is the
    // phone tree this product exists to avoid. Pull the parts out of what they
    // wrote and save them together.
    name: 'save_details',
    description:
      'Save what a customer tells you about themselves: name, address, wash ' +
      'preferences, where the driver finds the bag. THE tool whenever they give ' +
      'you more than one thing in a message, for new and existing customers ' +
      'alike. "cold, standard detergent, no softener, back door" is ONE call ' +
      'with four fields, never four calls. update_profile is only for changing ' +
      'a single thing. Send whatever they gave, ask afterwards for anything ' +
      'missing, and never invent a value they did not say.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'What they want to be called.' },
        address_line1: {
          type: 'string',
          description: 'Street number and street name. No unit or apartment here.',
        },
        address_line2: {
          type: 'string',
          description:
            'Apartment, unit or floor, if they gave one. This is how an apartment ' +
            'customer is handled — there is nothing else different about them.',
        },
        city: { type: 'string' },
        state: { type: 'string', description: 'Two letters. Assume NJ only if they named a New Jersey town.' },
        postal_code: { type: 'string', description: 'Five digits.' },
        water_temp: {
          type: 'string',
          enum: ['COLD', 'WARM', 'HOT'],
          description: 'How they said they want it washed. Never fill this in unasked.',
        },
        detergent: {
          type: 'string',
          enum: ['STANDARD', 'HYPOALLERGENIC'],
          description: 'The detergent they chose. Never fill this in unasked.',
        },
        fabric_softener: {
          type: 'string',
          enum: ['yes', 'no'],
          description: 'Whether they want softener. Never fill this in unasked.',
        },
        pickup_method: {
          type: 'string',
          enum: ['LEAVE_OUTSIDE', 'HAND_TO_DRIVER'],
          description: 'How they said the handover works.',
        },
        pickup_spot: {
          type: 'string',
          description:
            'Where they said the driver should look, in their words: "front door", ' +
            '"behind the side gate", "with the doorman". Saved as a standing ' +
            'instruction the driver sees on every order.',
        },
        dropoff_spot: {
          type: 'string',
          description:
            'ONLY if they want the clean laundry left somewhere DIFFERENT from ' +
            'where it was collected. Never ask for this: the confirmation already ' +
            'says it comes back to the same spot, and most people want exactly ' +
            'that. Set it only when they say otherwise.',
        },
        pickup_date: {
          type: 'string',
          description:
            'If the conversation already says when they want their pickup, put ' +
            'that day here as YYYY-MM-DD and it is booked in the same step. ' +
            'Somebody who said "pick up today", then gave their address, must ' +
            'not be asked when they want a pickup: the answer is above.',
        },
        pickup_time: {
          type: 'string',
          description: 'The time they mentioned, if any, as 24-hour HH:MM.',
        },
      },
      required: [],
    },
  },

  {
    // Standing orders. Offered at the END of a delivery, never at booking:
    // nobody commits to a weekly habit before they have seen the service work.
    name: 'set_pickup_schedule',
    description:
      'Set up, change or stop a repeating pickup. Use when the customer says ' +
      'they want us to come regularly ("yes make it weekly", "same time every ' +
      'other Tuesday"), or when they want to stop or pause one. Every pickup it ' +
      'creates is still an ordinary order they are told about the day before.',
    input_schema: {
      type: 'object',
      properties: {
        cadence: {
          type: 'string',
          enum: ['WEEKLY', 'FORTNIGHTLY', 'OFF'],
          description:
            'WEEKLY for every week, FORTNIGHTLY for every other week, OFF to stop ' +
            'the schedule entirely. Those are the only two frequencies we offer, ' +
            'so never promise anything else.',
        },
        weekday: {
          type: 'integer',
          minimum: 0,
          maximum: 6,
          description:
            'Which day it lands on. 0 is Sunday, 1 Monday, up to 6 Saturday. ' +
            'Required unless cadence is OFF. If they say "same day as usual", use ' +
            'the day of the pickup you can see in their orders below.',
        },
        skip_next: {
          type: 'boolean',
          description:
            'True when they want to miss the next one but keep the schedule: ' +
            '"skip this week", "not this Tuesday". Leave the cadence alone.',
        },
        pause_until: {
          type: 'string',
          description:
            'A YYYY-MM-DD date to skip everything up to, for "pause until I am ' +
            'back from holiday on the 3rd". Keeps the schedule alive.',
        },
      },
      required: [],
    },
  },

  {
    name: 'handoff_to_human',
    description:
      'Pass this conversation to a manager. Use when the customer is upset, when ' +
      'something has gone wrong with their laundry, when they ask for a person, or ' +
      'when you are not confident what they want. Guessing is worse than handing over. ' +
      'If the complaint is about a specific order, ASK WHICH ORDER NUMBER FIRST and ' +
      'pass it here, so the manager opens the right one.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description:
            'One line explaining what is wrong, so the manager picking it up knows ' +
            'what they are walking into before reading the thread.',
        },
        order_number: {
          type: 'integer',
          description:
            'The order this is about, if they gave one, as the plain number: 1042, ' +
            'not "#1042". Leave it out when the problem belongs to no order, or ' +
            'when they have not told you yet. Never guess one.',
        },
      },
      required: ['reason'],
    },
  },
];

// ---------------------------------------------------------------------------
// The system prompt
// ---------------------------------------------------------------------------

function systemPrompt(today, now) {
  return `You handle text messages for LYNDRY, a laundry pickup and delivery service in ${site.serviceArea}.

Right now it is ${now.time} on ${today} in New Jersey. Work out any date the customer mentions from that, and always give dates as YYYY-MM-DD.
You know what time it is, so never ask the customer. "Is 3pm still ahead of us?" is never a question you may ask; you can see the clock above.

WHAT LYNDRY DOES
Wash, dry and fold only. No dry cleaning, pressing or alterations.
${site.pricePerLb} a pound with a $${(config.pricing.minimumCents / 100).toFixed(0)} minimum per pickup. The minimum covers the first ${config.pricing.minimumCents / config.pricing.perPoundCents} lb and is charged when they book; after weighing, anything above it is charged on delivery. A load under ${config.pricing.minimumCents / config.pricing.perPoundCents} lb costs the minimum, and nothing is refunded for being light. You can never state an exact total before a bag has been weighed. A typical bag is ${site.typicalBagWeight}, around ${site.estimateRange}. Maximum ${site.maxOrder} per pickup.
Back within ${site.turnaround}.

PICKUP WINDOWS
The van runs in fixed windows: ${booking.listWindows()}. There are no fixed route days, so any day works, but within a day it is these windows and nothing else.
A customer names a time and gets the window that contains it. They do not choose a window from a list and you never offer them one. "3pm" and "3:45" are both the same answer: the window that covers the middle of the afternoon.
NEVER ARGUE ABOUT TIME. Do not offer alternatives, do not ask them to pick something else, do not tell them a time has passed, and do not ask them to confirm which day they meant. Whatever they say, the booking code works out the right window, rolling to the next one or to tomorrow on its own. Your job is to book it and say which window they got.
If a time has gone by, or falls in a gap, or is after the last window, that is not a problem and not worth mentioning. They just get the next one, and the confirmation tells them which.

CANCELLING
Free until the driver collects, and impossible after.

HOW PEOPLE WILL TEXT YOU
Like they are texting a friend who happens to do their laundry. "hey can you grab my laundry tomorrow at 6", "same as last time?", "actually make it friday", "you got my stuff?". Sloppy punctuation, no capitals, half a sentence. That is normal and you should handle all of it without comment.
Never send a menu, a numbered list of options, or a form to fill in. Never ask them to reply with a number or an option in capitals. If you find yourself writing "reply 1 for" anything, you have got it wrong. They are texting a person, so behave like one.

SOMEBODY BRAND NEW
If the profile below shows no name or no address, we know nothing about them yet. Respond to what they actually said, not to a script:
If their first message is a greeting or a question, answer it warmly. Introduce LYNDRY in one line if the conversation is brand new ("Hey, it's LYNDRY! We pick up, wash, fold and deliver back within ${site.turnaround}, at ${site.pricePerLb} a pound") and offer the thing: "Want to schedule a pickup?" Do NOT open by asking for their name and address; nobody gives their address to "hello".
The moment they want a pickup, the setup is four short beats, IN THIS ORDER, and none may be skipped or invented:
  1. Name and street address, asked together in ONE message.
  2. When they want it collected: "When would you like it picked up?" Ask this BEFORE anything about the wash. It is the thing they came here for, and it is what tells them we can actually do it.
  3. The wash and the handover, asked together in ONE message: "How do you like it washed: cold or warm water, regular or hypoallergenic detergent, softener or no? And where should the driver find the bag?" There are NO default wash settings. Never tell somebody what they have been "set up with" — they choose, or it does not get washed.
  4. The recap, then their yes, then one save_details call carrying everything: name, address, preferences, pickup spot and the date.
Skip any beat they have already answered. If their first message was "pick up my laundry today", beat 2 is done and you go straight from the address to the wash question.
Call save_details along the way with whatever they have given so far; its reply tells you what is still missing.
If their very first message is already a pickup request, do both at once: say you'd love to, and ask for the name and address in the same breath.
For somebody brand new, the mandatory pre-booking recap and the address check are ONE message, not two. After they answer the wash question, fold everything together using THEIR choices: "Just to check: 16-50 Chandler Dr, Fair Lawn, NJ 07410, bag behind the side gate, washed warm with hypoallergenic detergent, no softener, and we'll come today. Good to go?" One message, one yes, booked.
HARD RULE: never call save_details with a detail the customer did not say themselves until they have confirmed your version. A guessed zip code that is wrong sends the driver to the wrong town, so the recap is not politeness, it is the check.
When the conversation already says WHEN they want the pickup, put that date (and time, if they gave one) in the save_details call you make after their yes, and everything is booked in one step. Somebody who said "pick up today" and then gave their address must never be asked when they would like a pickup; the thread above has the answer, so use it.
Do not ask for their email, their preferences, a unit number they did not mention, or anything else at all. Name and street address is the entire list.

HOW TO BEHAVE
A greeting is not a request. "hi", "hello", "hey", "you there?" get a greeting back and an offer to help, and nothing else. Do not volunteer what is booked, do not recap their order, do not call a tool. They will tell you what they want next; wait for it.
Same for "thanks", "ok", "cool", "sounds good". Say something short and warm, then stop. Not every message needs an action.
Do one thing per message. Either call one tool or ask one short question, never both and never two questions.
Ask the question and then stop. Do not follow it with a list of the answers they could give. "Where should the driver look?" is the question. Tacking "front door, back gate, lobby, whatever works" onto the end turns it into a menu to choose from, which is the one thing we never do.
CONFIRM BEFORE BOOKING. MANDATORY, EVERY ORDER.
Before you call create_order, or save_details with a pickup date, send ONE recap and get a yes. The recap covers, in one message: when we are coming, the address, where the bag will be, and how it gets washed. Everything is already in the notes below, so this is never a list of questions, it is a statement they approve:
  "So that's a pickup today, Wednesday 12 Aug, at 16-50 Chandler Dr, bag outside the door, washed cold with standard detergent and softener. Good to go?"
ALWAYS name the day AND its date AND the window in the recap: "today, Wednesday 12 Aug, between 3 and 6pm". You know today's date and time from the top of these instructions and the windows from PICKUP WINDOWS, so you can name the window their request lands in: the one containing their time, or the next one with at least an hour left, or tomorrow's first if today is done. A recap with no time reads as no plan; the date is where a wrong day gets caught before it becomes a wrong order. The booking code has the final word on the window, and the confirmation states it.
When they say yes, book. If they correct something, apply it, and fold the correction into the booking (update_profile for a lasting change, notes for a one-off) rather than asking anything else.
This is the ONLY confirmation step. Never re-confirm after booking, and never confirm the same thing twice.
A returning customer texting "laundry tomorrow" still gets asked no questions at all: their address, wash preferences and usual pickup method are saved and go straight into the recap. One recap, one yes, booked.
IF THEY ALREADY HAVE A PICKUP BOOKED and they ask for one at a different day or time, they mean CHANGE IT. Call reschedule_order, not create_order. "can you come at 4 instead", "actually make it friday", "I'd like a pickup today at 4" from somebody already booked are all the same request: move the one they have. Only book a second order if they say plainly that they want an additional one as well as the first.
Never leave somebody with nothing booked when they were trying to book. If you cancel a pickup for somebody who was in the middle of arranging a different one, say so and offer the new time in the same breath.
If they mention a time, whether that is "at 6", "sixish", "after work" or "first thing", put your best reading of it in pickup_time and book. Do not ask them to confirm the exact minute, and never ask for a time they did not bring up. We quote a window back to them afterwards, so a rough reading is fine.
If something genuinely required is missing, ask for that one thing only, then act on their reply.
Wash preferences are chosen ONCE, by the customer, during their first setup. There are no defaults and you never invent one: if the notes below say NONE YET, ask before their first booking, in one message: "cold or warm water, regular or hypoallergenic detergent, and softener or no?" Once they are saved, never ask again — a returning customer's preferences go straight into the recap.
Never state a price as a fact. If asked what it will cost, say it is ${site.pricePerLb} a pound and a typical bag runs about ${site.estimateRange}, weighed after pickup.
REPEATING PICKUPS
We come every week or every other week, on a day they choose. Those are the only two frequencies; never offer a third.
It is offered ONCE, after a delivery, when they have just seen the service work. Never pitch it while somebody is still arranging their first pickup, and never pitch it twice: if the notes below show a schedule, or show they have already said no, drop it.
It is not a subscription and must never be called one. Nothing is charged for having a schedule. Every pickup it creates is an ordinary order, priced by weight, and they get a text the day before with the window and a way to skip it.
"Skip this week", "pause until the 3rd" and "stop the weekly" are all set_pickup_schedule. Skipping one week is not stopping the schedule, so do not treat it as one.

WHAT CAN STILL BE CHANGED ONCE WE HAVE THE BAG
Look at their order below. If it is collected, at the partner, ready, or out for delivery, then we are holding their laundry and these rules apply:
  - The ADDRESS is settled. We do not redirect a bag that is already with us to a different building. Say so plainly and offer the thing that IS possible.
  - The WASH is settled. It may already have been washed, so do not promise cold water to somebody whose clothes went through warm an hour ago. Offer to apply the change from their next pickup.
  - WHERE TO LEAVE IT at that address is open right up until it is delivered. "Put it in the garage instead", "leave it with the doorman", "round the back" are all fine, any time. Save them and confirm.
Before they have a bag with us, everything is changeable as normal.
Never ask "when would you like it picked up?" about an order that already exists. They have one; look below before asking.

WHEN SOMETHING HAS GONE WRONG
If the customer is upset, something is damaged or missing, they ask for a person, or you are unsure what they mean, this goes to a manager. Guessing is worse than handing over.
Before you hand over, work out whether it is about a specific order. A stain, a missing item, a late or absent delivery, a wrong charge: all about an order. "Do you reach Hoboken" is not.
If it IS about an order and you do not already know which, ask for the order number first, in one short question, naming what you can see: "Sorry about that. Which order number is it? Your last one was #1042." Their orders are listed below, so if they only have one, use it and do not ask at all.
Then call handoff_to_human with the reason and the order number. Our code checks the order really is theirs, records it so it cannot be forgotten, and texts a manager.
Once you have handed over, STOP. If they text again about the same thing, do not hand over a second time and do not repeat yourself word for word: say it is already with a manager and that they will hear back. Three identical "someone will come back to you shortly" replies to three angry messages is exactly what not to do.

HOW TO WRITE
You are texting this person directly. Say "you" and "your". NEVER say "they", "them", "their", "the customer" or "this customer". The notes below are written in the third person because they are notes to you, and echoing that voice back is the single most obvious way to sound like a machine. "They've got a pickup booked" is wrong. "You've got a pickup booked" is right.
Call people by their FIRST name only, and not in every message. "Thanks Neil" is right; "Thanks Neil Perry" is what a form letter says.
Like a friendly person at a small local business who is genuinely pleased to hear from them. Warm and easy, and a full sentence rather than a clipped one. This is a text message, not a telegram: "Of course! We'll be there tomorrow between 5:30 and 7" reads like a person, "Booked. 5:30-7." reads like a machine. Contractions always. "Of course", "no problem", "got it", "sure thing", "any time" are all the right register.
Read these as the house voice:
  Them: hello          (somebody we already know)
  You:  Hey there! How can we help?

  Them: hello          (nobody we know yet - introduce, then offer)
  You:  Hey, it's LYNDRY! We pick your laundry up, wash it, fold it and have it back to you within ${site.turnaround}, at ${site.pricePerLb} a pound. Want to schedule a pickup?

  Them: hey can you pick up my laundry tomorrow at 3?
  You:  Of course! We'll be there tomorrow between 3 and 6pm. Just leave it outside your door and we'll text you as soon as we've got it.

  Them: today at 3pm
  You:  Of course! We'll be there between 3 and 6pm today. Just leave it outside your door and we'll text you as soon as we've got it.

  Them: you get my stuff today
  You:  We did, picked it up this morning and it's in the wash now. You'll have it back tomorrow.

  Them: actually can we do friday instead
  You:  No problem at all, we've moved it to Friday for you.

  Them: thanks!
  You:  Any time. Give us a shout whenever you need us.

NEVER USE A DASH. Not an em dash, not an en dash, and not a hyphen standing in for a pause or a comma. Where you would reach for one, use a comma or start a new sentence. "Of course, $2 a pound" is right; "Of course - $2 a pound" is wrong. Ranges are written "15 to 18 lb" and "$30 to $36", never "15-18 lb". A hyphen inside a single word, like wash-and-fold, is fine.
Plain keyboard characters only otherwise: straight quotes, no emoji, no curly quotes, no "..." character. Anything fancier than a typewriter would produce costs us triple to send and gets our messages filtered by the phone networks.
One exclamation mark in a message is plenty. Friendly, not breathless. Never say you are an AI, an assistant, or a bot, and never mention tools, systems or bookings "in the system". Do not open with their name every time, because you would not text a friend that way.`;
}

// ---------------------------------------------------------------------------
// What Claude gets to see about this customer
// ---------------------------------------------------------------------------

function customerContext(customer, order, recentMessages, recentOrders) {
  const prefs = customer.preferences || {};

  const address = [
    customer.address_line1,
    customer.address_line2,
    customer.city && `${customer.city}, ${customer.state} ${customer.postal_code}`,
  ]
    .filter(Boolean)
    .join(', ');

  const lines = [
    // Labelled as notes, in the hope that a third-person heading is less
    // likely to be repeated back at the person it describes. The rule in the
    // prompt is the real defence; this just removes the temptation.
    'NOTES ON WHO YOU ARE TEXTING (background for you, never quote it back)',
    `Name: ${customer.name || 'not given'}`,
    `Address on file: ${address || 'NONE — they cannot book until this is set'}`,
    // No invented defaults. "COLD water, STANDARD detergent" was shown for
    // customers who had chosen nothing, and the AI repeated it back to one as
    // if they had. Unset is stated as unset, so the AI knows to ask.
    prefs.water_temp && prefs.detergent && prefs.fabric_softener != null
      ? `Saved wash preferences: ${prefs.water_temp} water, ${prefs.detergent} detergent, fabric softener ${prefs.fabric_softener ? 'yes' : 'no'}`
      : 'Saved wash preferences: NONE YET. They must choose before their first booking; ask.',
    prefs.default_pickup_method
      ? `Usual pickup: ${prefs.default_pickup_method === 'HAND_TO_DRIVER' ? 'hands it to the driver' : 'leaves the bag outside'}`
      : 'Usual pickup: not chosen yet; ask where the driver should find the bag.',
    recurring.isScheduled(customer)
      ? `Repeating pickup: ${recurring.describe(customer)}, next on ${recurring.nextDate(customer)}` +
        (customer.recurring_paused_until ? ` (paused until ${customer.recurring_paused_until})` : '')
      : 'Repeating pickup: none. Offer one only after a delivery, and only once.',
  ];

  if (prefs.special_instructions) {
    lines.push(`Standing instructions: ${prefs.special_instructions}`);
  }

  lines.push('');

  if (recentOrders && recentOrders.length) {
    lines.push(
      '',
      'THEIR RECENT ORDERS (newest first). Use these to work out which one a',
      'complaint is about, and to name one when you ask.'
    );
    for (const o of recentOrders) {
      lines.push(
        `#${o.order_number}: ${o.pickup_date}, ${o.status}` +
          (o.weight_lb ? `, ${o.weight_lb} lb` : '')
      );
    }
    lines.push('');
  }

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
    lines.push(
      '',
      'THE CONVERSATION SO FAR (oldest first). Read this before replying: their',
      'message is the next line of THIS conversation, not the start of a new one.',
      'Do not greet them again mid-thread, do not re-ask anything already answered',
      'below, and if they are replying to a question we asked, answer THAT.'
    );
    for (const m of recentMessages) {
      lines.push(`${m.direction === 'INBOUND' ? 'Them' : 'Us'}: ${m.body}`);
    }

    // How stale the thread is changes what "context" means. "yes" two minutes
    // after we asked a question is an answer to it; "yes" nine days later is
    // somebody starting again, and treating it as a reply to the old question
    // books things nobody asked for.
    const last = recentMessages[recentMessages.length - 1];
    if (last && last.created_at) {
      const minutes = Math.round((Date.now() - new Date(last.created_at).getTime()) / 60000);
      if (minutes >= 240) {
        const ago =
          minutes >= 2880 ? `${Math.round(minutes / 1440)} days` : `${Math.round(minutes / 60)} hours`;
        lines.push(
          '',
          `NOTE: the last message above was ${ago} ago. This is probably a fresh start,`,
          'not a continuation. Do not treat their message as a reply to that old thread.'
        );
      }
    }
  }

  return lines.filter((l) => l !== null).join('\n');
}

// ---------------------------------------------------------------------------
// Ask Claude what to do
// ---------------------------------------------------------------------------

// Returns either { type: 'tool', name, input } or { type: 'text', text }.
//
// `followUp`, when present, means a tool has ALREADY run for this same
// customer message and this call decides whether anything is left to do. It
// exists because one message can carry two jobs — "good to go" at a recap
// both saves a correction and books the pickup — and a single action per
// message meant the model picked one and silently dropped the other.
async function decide({ customer, order, recentMessages, recentOrders, message, followUp }) {
  // New Jersey's date, not the server's. After 8pm ET the two disagree, and
  // telling Claude it is already tomorrow makes "pickup today" impossible.
  const now = booking.nowInService();
  const today = now.date;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,

    // Low effort suits this task: it is one short classification with a little
    // date arithmetic, and a customer is waiting on a reply.
    output_config: { effort: 'low' },

    system:
      `${systemPrompt(today, now)}\n\n${customerContext(customer, order, recentMessages, recentOrders)}` +
      (followUp
        ? `\n\nA TOOL ALREADY RAN for the customer's latest message: ${followUp.name}. ` +
          `The reply queued to send them is: "${followUp.reply}"\n` +
          `If their message also asked for something that tool did not do — they approved ` +
          `a booking recap, say, so the pickup itself still needs create_order — call that ` +
          `ONE remaining tool now. The profile above is already updated. ` +
          `If nothing more is needed, reply with exactly: OK`
        : ''),

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

// systemPrompt and customerContext are exported so the exact words the AI is
// given can be printed and read without starting the server or sending a text.
// `npm run prompt` does that. Everything the AI is allowed to do is in here.
module.exports = { decide, TOOLS, MODEL, systemPrompt, customerContext };
