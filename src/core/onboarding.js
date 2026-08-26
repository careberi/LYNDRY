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

const CONSENT_SOURCES = ['WEB_SIGNUP', 'WEB_HERO', 'INBOUND_TEXT'];

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
function welcomeMessage({ open = true, promoBlurb = null } = {}) {
  const what =
    `Hey, it's ${site.name}! We pick your laundry up, wash it, fold it and have ` +
    `it back to you the ${site.turnaround}, at ${site.pricePerLb} a pound. `;

  if (open) return `${what}Want to schedule a pickup?`;

  // DELIBERATELY SHORTER THAN THE OPEN VERSION. This one has to carry the
  // promotion's own sentence as well, and 160 characters is a segment - so the
  // half describing the service is cut back to make room rather than letting
  // the whole thing quietly cost double to every signup.
  // WITH A PROMOTION, THE SALES PITCH GOES. They typed their number into our
  // home page thirty seconds ago, so what we do and what it costs is the page
  // they are still looking at - and the promotion is the part they do not know
  // yet. Keeping both put it over a segment and doubled the cost of every
  // signup during exactly the period we are trying to collect numbers.
  if (promoBlurb) {
    return (
      `It's ${site.name}, and you're on the list. We're not booking pickups yet, ` +
      `but ${promoBlurb}. We'll text you the moment we open.`
    );
  }

  return (
    `It's ${site.name}. Laundry collected from your door and back the ${site.turnaround}, ` +
    `${site.pricePerLb} a pound. We're not booking yet but you're on the list. ` +
    `We'll text you when we open.`
  );
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
      const open = await settings.takingOrders();
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
    const open = await settings.takingOrders();
    await sendAndLog(
      phone,
      welcomeMessage({ open, promoBlurb: open ? null : grantedBlurb }),
      customer.id
    );
  }

  return { ok: true, customer, created: true };
}

module.exports = { startConversation, welcomeMessage, CONSENT_SOURCES };
