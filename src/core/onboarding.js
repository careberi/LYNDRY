'use strict';

const db = require('../db');
const promotions = require('./promotions');
const settings = require('./settings');
const booking = require('./booking');
// The introduction's words live in lyn.js and nowhere else. No loop: lyn.js
// requires only the database at load.
const lyn = require('./lyn');
const { sendAndLog } = require('./notify');
const { site } = require('../web/site');

// ---------------------------------------------------------------------------
// Starting a conversation with someone new.
//
// There are two doors into this and they must behave identically:
//
//   1. The phone field on the home page. Someone types a number, ticks the
//      consent box, and we text them.
//   2. An unknown number texting us first.
//
// Both end up here so that the consent record, the throttling and the opening
// message cannot drift apart. The difference between them is only where the
// consent came from, which is recorded rather than assumed.
//
// Whichever door it is, the first thing they hear from us is firstMessage()
// below - one introduction, one offer if they hold one, one short line. After
// that everything happens in the thread with Lyn.
// ---------------------------------------------------------------------------

// WEB_BERGEN is the advert landing page. It is its own source rather than
// being folded into WEB_HERO because an audit asks WHICH page somebody ticked
// the box on, and "the one we were paying to send them to" is a different
// answer from "the home page".
//
// FACEBOOK_FORM is the tick box on Meta's instant form. It is its own source
// for the same reason WEB_BERGEN is: the evidence is different. There is no IP
// and no page of ours involved - what we hold is Meta's own record of the lead,
// the box they ticked, and the row in facebook_leads that copied it.
//
// DOOR_HANGER is a scan off a card on somebody's front door. The evidence is
// their own inbound message, exactly as INBOUND_TEXT - what it records is
// WHICH door, the same reason WEB_BERGEN is not folded into WEB_HERO.
// EVERY WAY SOMEBODY CAN COME TO BE A CUSTOMER, and this list has to match the
// CHECK constraint on customers.sms_consent_source exactly. It is the second
// copy of that list, which is a thing to be uncomfortable about: the database
// refuses a bad value with a constraint error nobody can read, so this refuses
// it first with a sentence naming the source. The cost is that adding a source
// in a migration and not here throws "Unknown consent source" from a route that
// looked fine in review - which is precisely how WEB_ORDER and PHONE_CALL both
// arrived here late.
const CONSENT_SOURCES = [
  'WEB_SIGNUP',
  // Placed an order on the website. Its own value since migration 0081,
  // because the deleted /signup form used to share WEB_SIGNUP with it.
  'WEB_ORDER',
  'WEB_HERO',
  'WEB_BERGEN',
  // The offer popup on the marketing pages. Its own value rather than
  // WEB_HERO's, for the reason DOOR_HANGER has its own: what this records is
  // WHICH box somebody typed into. Migration 0090.
  'WEB_POPUP',
  'INBOUND_TEXT',
  'FACEBOOK_FORM',
  'DOOR_HANGER',
  // They rang us and a person typed it in. Migration 0083. The only source
  // whose evidence is a member of staff saying so rather than a ticked box or
  // the customer's own message, which is why customers.sms_consent_by records
  // who that was.
  'PHONE_CALL',
];

// ---------------------------------------------------------------------------
// CAN A CLAIMED CODE ACTUALLY COME OFF SOMETHING FOR THIS PERSON.
//
// Only a first-order offer has a question to answer here, and the question is
// the same one discountFor() asks at pricing: have they had a delivered order?
// Asking it the same way is the point - a code granted here that pricing later
// refuses is a promise on their account that nothing will ever keep.
//
// Everything that is not first-order is always eligible. NEXT_ORDERS and
// EVERY_ORDER apply whatever somebody's history.
// ---------------------------------------------------------------------------
async function firstOrderStillAhead(customerId, promo) {
  if (!promo || promo.applies_to !== 'FIRST_ORDER') return true;

  const { count, error } = await db
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .eq('status', 'DELIVERED');

  // FAILS TOWARDS GRANTING. The worse mistake is telling somebody who has
  // never ordered that a code they were sent does not apply to them; granting
  // it to somebody who has ordered costs nothing, because discountFor() still
  // refuses it at pricing.
  if (error) {
    console.error(`Could not check order history for ${customerId}: ${error.message}`);
    return true;
  }

  return !count;
}

// THE EXPIRY, AS A DAY SOMEBODY CAN PUT IN A DIARY - or nothing, when the grant
// has none. Read off the GRANT and never the promotion's rule: see the note
// where this is called. Same "Friday 18 Sep" shape every other text uses, on
// New Jersey's clock, because a date worked out in UTC is a day early for
// anybody reading it after 8pm.
function expiryNote(grant) {
  if (!grant || !grant.expires_at) return '';

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    })
      .formatToParts(new Date(grant.expires_at))
      .map((p) => [p.type, p.value])
  );

  return ` It is good until ${parts.weekday} ${parts.day} ${parts.month}.`;
}

// ---------------------------------------------------------------------------
// THE ONE FIRST MESSAGE, WHATEVER THE DOOR.
//
// Neil, 21 September: "Same intro everywhere. Website, Facebook lead, door
// hanger, or they text Hi: first AI reply is 'Hi, I'm Lyn, LYNDRY's automated
// assistant.' Then the same short next line. Do not send a longer website-only
// welcome to one source and a short Hi to another. If they have 50% off, say
// that in that same first reply for every source."
//
// IT REVERSES TWO THINGS AT ONCE, and both are recorded in CLAUDE.md:
//
//   - each door had its own opening clause - "thanks for sending over your
//     number", "you left this number on our Facebook laundry form", "thanks for
//     scanning" - in front of three paragraphs about who we are
//   - the same morning, somebody who texted "Hi" had been given a short line
//     and NO offer, on the rule that the offer was the website's alone
//
// Now every door sends exactly this, built here and nowhere else:
//
//   Hi, I'm Lyn, LYNDRY's automated assistant.   lyn.INTRODUCTION
//   50% off your first order is on your ...      the offer they hold, if any
//   Want us to pick up your laundry?             the one short next line
//
// THE INTRODUCTION IS lyn.INTRODUCTION, NEVER A RETYPED COPY, and that is load
// bearing: lyn.everIntroduced() looks for "I'm Lyn," in what we sent, so a
// code-sent first message carrying it is what stops Lyn introducing herself a
// second time on their first reply. Intro once per customer, whichever door.
//
// THE OFFER IS THE PROMOTION'S OR IT IS NOT MADE. freeOfferLine() for a
// genuinely free one, otherwise offerLine(), which is the blurb a person wrote.
// A door-hanger claimant holds $10 off, not the 50% - a claim replaces the
// automatic grant - so "say the 50%" means "say what they hold". No blurb, no
// sentence, exactly as everywhere else.
//
// NO PRICE AND NO TURNAROUND IN IT. Neil asked for a short line, and the same
// prices and next-day rule on every channel; Lyn gives both from the locked
// facts the moment anybody asks, on every door alike.
//
// SHUT, IT STILL INTRODUCES AND STILL NAMES THE OFFER, but it never invites a
// booking: the next line becomes a plain "not yet". Before the first van day it
// names that day, so "want us to pick up" is not answered with a refusal.
// ---------------------------------------------------------------------------
const NEXT_LINE = 'Want us to pick up your laundry?';

function firstMessageParts({ promo = null, open = true, opensOn = null } = {}) {
  // NO BLURB, NO SENTENCE, EVEN FOR A FREE ONE. freeOfferLine() does not look
  // at the blurb, so a hand-given 100% promotion - #1975's one-order waiver -
  // would have been announced as "the first 1 orders are completely free".
  // CLAUDE.md: a promotion with no blurb is silent, everywhere.
  const speaks = Boolean(promo && String(promo.blurb || '').trim());
  const offer = speaks ? promotions.freeOfferLine(promo) || promotions.offerLine(promo) || null : null;

  const next = !open
    ? `We're not booking pickups just yet, but we'll text you as soon as we are.`
    : opensOn
      ? `${NEXT_LINE} First pickups are ${booking.readableDate(opensOn)}.`
      : NEXT_LINE;

  return { intro: lyn.INTRODUCTION, offer, next };
}

function firstMessage(options = {}) {
  const { intro, offer, next } = firstMessageParts(options);
  return [intro, offer, next].filter(Boolean).join(' ');
}

// Have we texted this number before, or does this customer have any order at
// all? Read by phone for messages - a person's first text to a stranger is
// logged with no customer id - and by customer for orders. Fails to "yes": a
// lookup that breaks must not hand the consumer pitch to somebody mid-thread.
async function weHaveHistoryWith(customer) {
  try {
    const spoke = await db
      .from('messages')
      .select('id')
      .eq('phone', customer.phone)
      .eq('direction', 'OUTBOUND')
      .limit(1);
    if (spoke.error) throw spoke.error;
    if ((spoke.data || []).length) return true;

    const booked = await db
      .from('orders')
      .select('id')
      .eq('customer_id', customer.id)
      .limit(1);
    if (booked.error) throw booked.error;
    return (booked.data || []).length > 0;
  } catch (err) {
    console.error(`Could not read ${customer.phone}'s history for the first message: ${err.message}`);
    return true;
  }
}

// The same parts, for somebody already in the database - the Lyn door, where a
// brand-new texter's customer row and grant were made a moment ago.
//
// THE OFFER IS WHAT THEY HOLD NOW, read through heldBy(), so an expired grant
// or a spent one is not announced. The first one with any sentence to say
// wins, which is the rule brain.decide() already uses for the blurb.
//
// NULL FOR ANYBODY WE HAVE ALREADY SPOKEN TO OR ALREADY BOOKED, and the review
// that found it was right twice over. A customer who booked on the website or
// by phone has only our own texts in their thread - the confirmation, the
// reminder - so lyn.opener() still owes them the introduction; texting
// "hello?" while they wait for the van got them "Want us to pick up your
// laundry?". And a laundromat owner replying "Hi" to Neil's pitch link got the
// 50%-off consumer offer over the top of his conversation. The code doors
// already carry the introduction, so the only person who genuinely needs this
// from the Lyn door is somebody we have never texted and who has booked nothing.
// Everybody else gets the introduction alone and a real answer from Lyn.
async function firstMessagePartsFor(customer) {
  if (await weHaveHistoryWith(customer)) return null;

  const held = await promotions.heldBy(customer.id).catch(() => []);
  const promo = held.find((h) => String(h.blurb || '').trim()) || null;

  const owner = booking.alwaysAllowed(customer);
  const open = owner || (await settings.takingOrders());
  const opensOn = owner ? null : await settings.opensOn();

  return firstMessageParts({ promo, open, opensOn });
}

// IS THIS FIRST TEXT NOTHING BUT A HELLO?
//
// A bare greeting from a brand-new number gets the first message above, word
// for word, rather than something the model writes - that is what makes the
// "Hi" door identical to the website one. Anything more than a greeting goes
// to Lyn, who answers it with the introduction and the offer in front.
//
// A LIST, NOT THE PROMO-CODE FILLER. promocodes' filler counts "thanks" and
// "please" as nothing, which is right for a code and wrong here. JOIN is in it
// deliberately: the /bergen advert page tells people to text JOIN, and under
// the junk rule a bare "JOIN" reaching the model could be read as spam.
const GREETING_WORDS = new Set([
  'hi', 'hii', 'hiii', 'hello', 'hey', 'heyy', 'heyyy', 'hiya', 'heya', 'yo',
  'howdy', 'join', 'good', 'morning', 'afternoon', 'evening', 'there', 'lyndry',
  'lyn',
]);
const CORE_GREETINGS = new Set([
  'hi', 'hii', 'hiii', 'hello', 'hey', 'heyy', 'heyyy', 'hiya', 'heya', 'yo',
  'howdy', 'join', 'morning', 'afternoon', 'evening',
]);

// People stretch a greeting - "heyyy", "hellooo", "hiiii" - so a word is also
// tried with its repeated letters folded ("hellooo" to "helo"). Both forms are
// tried rather than only the folded one, because folding turns "good" into
// "god" and "afternoon" into "afternon".
const fold = (w) => w.replace(/(.)\1+/g, (run) => run[0]);
const FOLDED_GREETINGS = new Set(['hi', 'hey', 'helo', 'hiya', 'heya', 'yo', 'howdy', 'sup', 'wasup', 'whatsup']);

function isJustAGreeting(text) {
  const raw = String(text || '').trim();

  // A wave on its own, with no letters at all, is a hello.
  if (raw && !/[a-z]/i.test(raw) && /\p{Extended_Pictographic}/u.test(raw)) return true;

  const words = raw
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const greeting = (w) => GREETING_WORDS.has(w) || FOLDED_GREETINGS.has(fold(w));
  const core = (w) => CORE_GREETINGS.has(w) || FOLDED_GREETINGS.has(fold(w));
  return words.length > 0 && words.every(greeting) && words.some(core);
}

// The first text a new number gets from a code door: the website form, the
// popup, /bergen, a door-hanger scan. It is firstMessage() and nothing else.
function welcomeMessage({ open = true, promo = null, opensOn = null } = {}) {
  return firstMessage({ promo, open, opensOn });
}

// HOW RECENTLY COUNTS AS "STILL TALKING". Long enough to cover a thread that
// is paused while somebody finds their wallet or answers the door, short enough
// that a genuine returning customer still gets greeted.
const THREAD_LIVE_MINUTES = 60;

// Is there a conversation going on that a greeting would land in the middle of?
//
// Three ways to be busy, and all three mean say nothing:
//   a person has taken it over   an open ai_hold issue
//   the AI is switched off       somebody is handling this thread by hand
//   anybody spoke recently       they are mid-thread, not returning
async function threadIsLive(customer) {
  const issues = require('./issues');
  const aiPause = require('./ai-pause');

  if (await issues.holdFor(customer.id)) return true;
  if (await aiPause.isPaused(customer.phone)) return true;

  const since = new Date(Date.now() - THREAD_LIVE_MINUTES * 60_000).toISOString();

  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('customer_id', customer.id)
    .gt('created_at', since)
    .limit(1);

  if (error) throw error;
  return (data || []).length > 0;
}

// Somebody we already know, who typed their number in again.
function welcomeBackMessage(customer, { open = true, opensOn = null } = {}) {
  if (!open) return `Welcome back. We're not booking pickups yet, but we'll text you the moment we are.`;

  // THE OPENING DATE BELONGS HERE TOO, AND IT WAS MISSED.
  //
  // welcomeMessage learned about it and this one did not. So somebody who put
  // their number in twice was told "say when you'd like a pickup and I'll book
  // it" one second after being told the first pickups are next Tuesday - the
  // same system contradicting itself in consecutive texts. Every sentence that
  // invites a booking has to know when a van can actually come.
  if (opensOn) {
    return booking.hasAddress(customer)
      ? `Welcome back. First pickups ${booking.readableDate(opensOn)} - say the word and I'll book you in.`
      : `Welcome back. First pickups ${booking.readableDate(opensOn)} - I just need your name and address.`;
  }

  return booking.hasAddress(customer)
    ? `Welcome back. Say when you'd like a pickup and I'll book it.`
    : `Welcome back. I still need your name and address before I can book a pickup.`;
}

// ---------------------------------------------------------------------------
// Start, or resume, a conversation.
//
// Returns one of:
//   { ok: true,  customer, created }
//   { ok: false, reason: 'bad_phone' }
//   { ok: false, reason: 'opted_out' }   they texted STOP. Do not message them.
// ---------------------------------------------------------------------------

// `claimed` is a promotion somebody has just claimed by texting a code off a
// door hanger. It REPLACES the automatic grant rather than adding to it - which
// is the whole reason it is threaded through here rather than granted by the
// caller afterwards. Every new number is auto-granted whatever is on
// NEW_NUMBERS, so a door-hanger scan that granted its $10 separately would end
// up holding the free-orders promotion as well, and the free one wins. Somebody
// who scanned a card offering $10 off would get their whole order free.
async function startConversation({
  phone,
  consentSource,
  consentIp = null,
  sendWelcome = true,
  claimed = null,
  // WHICH MARKETING BROUGHT THEM, when the caller can name it. Today that is
  // only a tap on a Google search ad's message button, which types a fixed
  // starter text and never loads the website - so those clicks carry no gclid
  // and were invisible to the conversion feed. See migration 0098.
  //
  // IT IS NOT THE CONSENT SOURCE and must never be folded into it: that column
  // is a legal record of HOW CONSENT WAS OBTAINED, and INBOUND_TEXT stays the
  // honest answer for somebody who texted us, whatever made them do it.
  firstTouchSource = null,
}) {
  if (!phone) return { ok: false, reason: 'bad_phone' };

  if (!CONSENT_SOURCES.includes(consentSource)) {
    throw new Error(`Unknown consent source: ${consentSource}`);
  }

  const { data: existing, error } = await db
    .from('customers')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (error) throw error;

  // Somebody who has opted out stays opted out.
  //
  // This is the case that makes the home page form safe to leave in public: a
  // stranger typing an unsubscribed number into it cannot use us to text that
  // person again. STOP is only ever undone by START, sent from the handset
  // itself, which is handled in src/core/compliance.js before any of this runs.
  if (existing && existing.status === 'UNSUBSCRIBED') {
    console.log(`${phone} has opted out - refused a new conversation.`);
    return { ok: false, reason: 'opted_out' };
  }

  if (existing) {
    // SOMEBODY ALREADY ON THE BOOKS TEXTED A CODE.
    //
    // THIS USED TO REFUSE EVERY TIME, and it was unreachable anyway. Neil's
    // original call for the door hanger was that the $10 was for new customers
    // only, so this sent "that one is for people who have not used us yet" and
    // granted nothing - but src/routes/sms.js only ever scanned a NEW number
    // for a code, so an existing customer's code went straight to the AI, which
    // had never been told a code existed and replied "I don't have any promo
    // codes running on my end". Which was false.
    //
    // NEIL REVERSED IT ON 10 SEPTEMBER: "by text, fixed for existing contacts".
    // Most of the people who will text CLEAN50 are the forty-odd already in the
    // thread, and a promo code that tells them it does not exist is worse than
    // no promo code.
    //
    // THE OLD SENTENCE WAS POINTING AT THE HONEST RULE. A first-order offer
    // genuinely cannot help somebody who has already had their first order -
    // discountFor() refuses it the moment a DELIVERED order exists - so
    // granting it would put a promise on their account that pricing will never
    // keep. "Have they used us yet" is now the literal gate rather than a
    // stand-in for "are they new", and almost everybody in the book has not.
    if (claimed) {
      const eligible = await firstOrderStillAhead(existing.id, claimed);

      // grant() is idempotent: it hands back the grant somebody already holds
      // rather than writing a second, so texting the code twice is harmless.
      //
      // AND THAT IS WHY THE EXPIRY IS READ OFF WHAT IT RETURNS rather than the
      // promotion's rule. Somebody who claimed it three weeks ago and texts the
      // code again holds the grant from three weeks ago, with three weeks
      // already gone. Telling them "good for the next 30 days" would be a
      // promise the pricing code never agreed to - CLAUDE.md is explicit that a
      // grant's expiry is stamped once and never recomputed.
      const held = eligible ? await promotions.grant(existing.id, claimed.id) : null;

      // ONLY ANSWERED WHEN THE CODE IS ALL THEY SENT. sendWelcome carries the
      // same decision it does for a new number: a message with a real question
      // in it goes to the AI, which answers the question and can see the grant
      // now sitting on their account. Two replies to one message - a canned
      // "it's on your account" and then the AI - is the robot behaviour this
      // exists to avoid.
      if (sendWelcome) {
        await sendAndLog(
          phone,
          eligible
            ? `Got it! ${promotions.offerLine(claimed)}${expiryNote(held)} ${NEXT_LINE}`
            : `Hey, good to hear from you again. That one is for a first order, ` +
                `and you have already had yours with us, so it would not come off ` +
                `anything. ${NEXT_LINE}`,
          existing.id
        );
      }

      return { ok: true, customer: existing, created: false, claimed: eligible ? claimed : null };
    }

    // Their consent record is NOT overwritten. The first time they agreed is
    // the one that matters legally, and rewriting the timestamp every time
    // somebody retypes their number would destroy the evidence.
    if (sendWelcome) {
      // An exempt number is never told we are shut, because for them we are
      // not - bookPickup() will take their order. Same rule as the AI's prompt
      // and the tool replies in actions.js: a number that can book must not be
      // greeted with a closed sign.
      const open =
        booking.alwaysAllowed(existing) || (await settings.takingOrders());

      // Exempt numbers are not held to the opening date either, so they are not
      // told about one - the same rule as the closed sign directly above.
      const opensOn = booking.alwaysAllowed(existing) ? null : await settings.opensOn();

      // NOT INTO A CONVERSATION THAT IS ALREADY HAPPENING.
      //
      // Manpreet Singh got "Welcome back. Say when you'd like a pickup and
      // I'll book it." at 10:09, three minutes after telling us not to come and
      // ten minutes after being handed to a manager. Nothing he texted caused
      // it - he had typed his number into the website a second time, which
      // lands here with sendWelcome on.
      //
      // "Welcome back" is a greeting for somebody we have not heard from. Sent
      // to somebody mid-thread it is the system talking over itself, and sent
      // into a handoff it is the machine talking over the person who is
      // supposed to be taking it from here.
      //
      // IT FAILS SILENT, NOT OPEN. If the check itself breaks we say nothing,
      // because the cost of a missed greeting is nil and the cost of this
      // landing on a held thread is what it did to Manpreet.
      const busy = await threadIsLive(existing).catch(() => true);

      if (busy) {
        console.warn(
          `WELCOME ${phone}: already mid-conversation or handed over. Saying nothing.`
        );
      } else {
        await sendAndLog(phone, welcomeBackMessage(existing, { open, opensOn }), existing.id);
      }
    }
    return { ok: true, customer: existing, created: false };
  }

  // A row with nothing but a phone number and a consent record. Name, address
  // and preferences are all nullable, and the AI fills the first two in from
  // the thread. This is deliberately the smallest row that can legally be
  // texted.
  const { data: customer, error: insertError } = await db
    .from('customers')
    .insert({
      phone,
      sms_consent_at: new Date().toISOString(),
      sms_consent_ip: consentIp,
      sms_consent_source: consentSource,
      // First touch, like the click ids: written once, here, and never
      // overwritten. Null unless the caller could name the channel.
      first_touch_source: firstTouchSource || null,
      status: 'ACTIVE',
    })
    .select('*')
    .single();

  if (insertError) throw insertError;

  console.log(`New conversation with ${phone} (consent: ${consentSource})`);

  // A NEW NUMBER GETS WHATEVER IS ON AUTO-GRANT, and gets it here rather than
  // when they book - which is the whole point of it during pre-launch. Somebody
  // who texts us before we open should already hold the thing they were
  // promised for texting, even though there is nothing to spend it on yet.
  //
  // Best effort on purpose. A promotion failing to attach must never stop a
  // customer being created; they would then be unable to text us at all, which
  // is a far worse outcome than a discount somebody has to be given by hand.
  // THE PROMOTION ITSELF IS KEPT, not just its blurb. The welcome now says
  // "the first 20 orders are free" in as many words when that is true, and the
  // sentence needs the count and the discount off the promotion - a blurb on
  // its own cannot be checked for whether it is actually free.
  // A CLAIMED CODE REPLACES THE AUTOMATIC GRANT, it does not join it. Neil:
  // door-hanger people get their $10 and must not also hold the free orders.
  let granted = null;

  try {
    const promo = claimed || (await promotions.autoGrant());
    if (promo) {
      await promotions.grant(customer.id, promo.id);
      granted = promo;
      console.log(`  granted "${promo.name}" to ${phone}${claimed ? ' (claimed by code)' : ''}`);
    }
  } catch (err) {
    console.error(`Could not grant a promotion to ${phone}: ${err.message}`);
  }

  // The code doors send the first message here: the website forms, and a
  // door-hanger or promo code with nothing else typed around it. There is
  // nothing to reply TO.
  //
  // Somebody who texted us something real goes to Lyn instead, who answers it
  // with the same introduction and offer in front (sms.js). A bare "Hi" gets
  // exactly this message from sms.js too, so every door reads the same.
  if (sendWelcome) {
    const open = booking.alwaysAllowed(customer) || (await settings.takingOrders());
    const opensOn = booking.alwaysAllowed(customer) ? null : await settings.opensOn();

    await sendAndLog(
      phone,
      // The one first message, open or shut: the offer they now hold rides in
      // it either way. See firstMessage().
      welcomeMessage({ open, opensOn, promo: granted }),
      customer.id
    );
  }

  return { ok: true, customer, created: true };
}

module.exports = {
  startConversation,
  welcomeMessage,
  welcomeBackMessage,
  threadIsLive,
  THREAD_LIVE_MINUTES,
  firstMessage,
  firstMessageParts,
  firstMessagePartsFor,
  isJustAGreeting,
  NEXT_LINE,
  CONSENT_SOURCES,
  expiryNote,
  firstOrderStillAhead,
};
