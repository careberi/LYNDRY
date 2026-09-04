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
const CONSENT_SOURCES = ['WEB_SIGNUP', 'WEB_HERO', 'WEB_BERGEN', 'INBOUND_TEXT'];

// What we say to somebody we have never spoken to.
//
// One message, and it asks for both things we need at once. Two questions in
// two texts would be a form with extra steps.
// The canned welcome. Takes what the service is currently doing, because the
// two situations need different last sentences.
//
// OPEN: offers the thing rather than demanding details for it. Asking a
// stranger for their name and home address in the first sentence is too
// forward; "want to schedule a pickup?" makes the next step obvious and is
// still a question they can ignore in favour of asking what we cost.
//
// CLOSED: it must NOT offer a pickup. This message goes out before the AI ever
// sees the conversation, so it is the one reply that cannot work out for itself
// that we are shut - and inviting somebody to book something that will then be
// refused is a worse first impression than saying so plainly.
function welcomeMessage({ open = true, promoBlurb = null, opensOn = null } = {}) {
  const what =
    `Hey, it's ${site.name}! We pick your laundry up, wash it, fold it and have ` +
    `it back to you the ${site.turnaround}, at ${site.pricePerLb} a pound. `;

  // OPEN FOR BOOKINGS, VAN NOT RUNNING YET. This is the fourth place the
  // service's state is written in code rather than left to the AI, and it is
  // here for the same reason the closed sign is: this reply goes out before the
  // model ever sees the conversation, so it is the one message that cannot work
  // anything out for itself. Inviting somebody to "schedule a pickup" when the
  // earliest we can come is four days away sets up a refusal on their next text.
  //
  // KEPT TO ONE SEGMENT. The obvious wording ran to 183 characters, which is two
  // segments on every single signup - a real bill, and this is the message that
  // goes to everybody. The day and the invitation both survive; the words around
  // them were the ones doing no work.
  if (open && opensOn) {
    return `${what}First pickups ${booking.readableDate(opensOn)}. Want a slot?`;
  }

  if (open) return `${what}Want to schedule a pickup?`;

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
function welcomeBackMessage(customer, { open = true } = {}) {
  if (!open) return `Welcome back. We're not booking pickups yet, but we'll text you the moment we are.`;

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

async function startConversation({ phone, consentSource, consentIp = null, sendWelcome = true }) {
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
      await sendAndLog(phone, welcomeBackMessage(existing, { open }), existing.id);
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
  let grantedBlurb = null;

  try {
    const promo = await promotions.autoGrant();
    if (promo) {
      await promotions.grant(customer.id, promo.id);
      grantedBlurb = promo.blurb;
      console.log(`  granted "${promo.name}" to ${phone}`);
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
      welcomeMessage({ open, opensOn, promoBlurb: open ? null : grantedBlurb }),
      customer.id
    );
  }

  return { ok: true, customer, created: true };
}

module.exports = { startConversation, welcomeMessage, CONSENT_SOURCES };
