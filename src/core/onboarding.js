'use strict';

const db = require('../db');
const promotions = require('./promotions');
const settings = require('./settings');
const booking = require('./booking');
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
// Everything after this message happens in the thread: the AI collects a name
// and an address, and nothing else. Wash preferences keep their defaults and
// are changed by texting, because asking about detergent over SMS is the phone
// tree this product exists to avoid.
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

// What we say to somebody we have never spoken to.
//
// It offers the thing rather than demanding details for it. Asking a stranger
// for their name and home address in the first sentence is too forward; "tell
// us a day that works" makes the next step obvious and is still something they
// can ignore in favour of asking what we cost. The AI collects the rest in the
// thread when they answer.
//
// CLOSED IS A DIFFERENT MESSAGE and it must NOT offer a pickup. This goes out
// before the AI ever sees the conversation, so it is the one reply that cannot
// work out for itself that we are shut - and inviting somebody to book
// something that will then be refused is a worse first impression than saying
// so plainly.
// ---------------------------------------------------------------------------
// THE WHOLE OF ALL THREE FIRST MESSAGES, GIVEN ONE OPENING CLAUSE.
//
// Somebody hears from us first in one of three ways, and the only thing that
// differs between them is where we got their number:
//
//   the website form   "Hey, thanks for sending over your number."
//   a Facebook advert  "Hey, you left this number on our Facebook laundry form."
//   they texted first  "Hey, thanks for reaching out."      (sent by the AI)
//
// Everything after that clause is identical, so it is written once here. Three
// copies would disagree the first time one was edited and the one that
// disagreed would be the one nobody noticed - which is how the price ended up
// in two places once already, and how the AI was still reciting the old
// introduction an hour after the other two were rewritten.
//
// It returns the finished message rather than paragraphs to assemble, because
// the opening clause and the first paragraph are now the SAME sentence -
// "Hey, thanks for reaching out. It's LYNDRY, wash-and-fold pickup..." - and a
// caller joining an array with blank lines cannot produce that.
// ---------------------------------------------------------------------------
function introduction(opening, { promo = null, opensOn = null } = {}) {
  // THE OFFER IS THE PROMOTION'S OR IT IS NOT MADE. freeOfferLine() returns
  // null unless something genuinely free is live, so a 30% offer can never be
  // announced as free and a promise with a count in it can never carry a count
  // the code is not enforcing.
  // Three sentences in falling order of how good the news is: genuinely free,
  // then whatever a person wrote on the promotion's blurb, then the plain
  // price. The middle one is what a door-hanger scanner gets - freeOfferLine()
  // returns null for $10 off, and without offerLine() they were introduced to
  // LYNDRY without their discount being mentioned at all.
  const offer =
    promotions.freeOfferLine(promo) ||
    promotions.offerLine(promo) ||
    `It is ${site.pricePerLb} a pound, weighed after we pick it up.`;

  // THE ASK KNOWS WHEN A VAN CAN ACTUALLY COME. These messages go out before
  // the AI ever sees the conversation, so they are the ones that cannot work
  // out for themselves that we do not start until next week - and "this week"
  // to somebody who cannot be collected until Tuesday sets up a refusal on
  // their very next text. It disappears on its own once the date passes.
  const ask = opensOn
    ? `Want us to grab your laundry? First pickups are ${booking.readableDate(opensOn)}.`
    : `Want us to grab your laundry this week?`;

  return [
    `${opening} It's ${site.name}, wash-and-fold pickup and delivery in ` +
      `${site.serviceArea}. Picked up at your door, back the ${site.turnaround}.`,
    offer,
    ask,
  ].join('\n\n');
}

function welcomeMessage({
  open = true,
  promo = null,
  promoBlurb = null,
  opensOn = null,
  opening = null,
} = {}) {
  // TWO SEGMENTS NOW, DOWN FROM FOUR, AND NEIL WROTE BOTH.
  //
  // The four-segment version was itself a deliberate rewrite - it went long
  // once there was paid traffic behind the number, on the grounds that this is
  // the only thing a stranger reads before deciding whether to reply. What
  // changed is what it spends the length on. It now leads with the promotion
  // and ends on a question, because 34 people read the long one and one of
  // them ordered.
  //
  // What went: "no app to download", which costs a segment on every door and
  // answers itself the moment they reply, and the standalone "we pick your
  // laundry up at your door" paragraph, folded into the opening sentence.
  // The turnaround stayed - it is the strongest single fact we have and it is
  // now the only place a stranger hears it before booking.
  if (open) {
    // A door hanger passes its own opening clause - "thanks for scanning" is
    // true of somebody standing at their front door and false of somebody who
    // typed a number into the website.
    return introduction(opening || `Hey, thanks for sending over your number.`, {
      promo,
      opensOn,
    });
  }

  const what =
    `Hey, it's ${site.name}! We pick your laundry up, wash it, fold it and have ` +
    `it back to you the ${site.turnaround}, at ${site.pricePerLb} a pound. `;

  // CLOSED. Neil's words, and longer than the open version on purpose: this is
  // the only message somebody gets after handing over their number to an
  // advert, and it has three jobs at once - say what we do, say we cannot book
  // them yet without sounding like a dead end, and hand them the reason it was
  // worth signing up anyway.
  //
  // It runs to three segments. That is a real cost per signup and it is the
  // right trade here: the alternative is a terse message to somebody who just
  // cost money to acquire.
  //
  // The discount sentence comes from the promotion's own blurb rather than
  // being written in, so it stays true if the offer changes and disappears
  // entirely if there is no offer at all.
  const cannot =
    `I should mention we're not booking pickups at the moment, so I can't get ` +
    `one on the calendar just yet, but we'll let you know the second that changes.`;

  const good = promoBlurb ? ` Good news is ${promoBlurb} waiting for you.` : '';

  // trimmed: `what` ends with the space that separates it from the open
  // version's question, and left in it shows as a trailing space on the line.
  return `${what.trim()}

${cannot}${good} Happy to answer anything about how it all works in the meantime.`;
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
  opening = null,
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
            ? `Got it! ${promotions.offerLine(claimed)}${expiryNote(held)} ` +
                `Want us to grab your laundry this week?`
            : `Hey, good to hear from you again. That one is for a first order, ` +
                `and you have already had yours with us - so it would not come off ` +
                `anything. Want us to grab your laundry this week?`,
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

      await sendAndLog(phone, welcomeBackMessage(existing, { open, opensOn }), existing.id);
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

  // Only the web hero sends the canned welcome, because there the person
  // typed a number into a box and there is nothing to reply TO.
  //
  // Somebody who texted us first said something, and a canned welcome ignores
  // it. "Can you grab my laundry tomorrow?" answered with a script that asks
  // no question about laundry reads as a robot. Their message goes to the AI
  // instead, which knows they are brand new and answers what they said.
  if (sendWelcome) {
    const open = booking.alwaysAllowed(customer) || (await settings.takingOrders());
    const opensOn = booking.alwaysAllowed(customer) ? null : await settings.opensOn();

    await sendAndLog(
      phone,
      welcomeMessage({
        open,
        opensOn,
        opening,
        // Open: the message makes the offer itself, in Neil's words, and only
        // when it is genuinely free. Closed: it cannot offer a pickup at all,
        // so the most it can do is repeat the blurb somebody wrote.
        promo: open ? granted : null,
        promoBlurb: open ? null : granted && granted.blurb,
      }),
      customer.id
    );
  }

  return { ok: true, customer, created: true };
}

module.exports = {
  startConversation,
  welcomeMessage,
  welcomeBackMessage,
  introduction,
  CONSENT_SOURCES,
  expiryNote,
  firstOrderStillAhead,
};
