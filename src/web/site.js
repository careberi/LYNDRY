'use strict';

const format = require('../core/format');
const subscription = require('../core/subscription');

// ---------------------------------------------------------------------------
// Site-wide values.
//
// EVERYTHING that appears on more than one page lives here. Change the price
// once and it changes on every page. Nothing in public/pages/ should hardcode
// a price, a phone number or an email address — use a {{TOKEN}} instead.
// ---------------------------------------------------------------------------

const { config } = require('../config');

// The legal entity behind LYNDRY, exactly as registered for business texting.
//
// THE LEGAL NAME MUST MATCH WHAT WAS SUBMITTED TO THE CARRIERS. During campaign
// review a person opens this website and checks that the company named in the
// registration actually appears on it. A mismatch is a rejection.
//
// LYNDRY is the trading name; napiii LLC is the company.
const LEGAL_NAME = 'napiii LLC';

// THE ADDRESS IS NO LONGER PUBLISHED. Neil's call. It is kept here rather than
// deleted because it is the registered address that went on the 10DLC
// application, and if a reviewer asks to see it on the site, putting it back is
// one line - add BUSINESS_ADDRESS to the token list below and it returns
// everywhere it used to be.
//
// WORTH KNOWING BEFORE THAT HAPPENS: this used to sit beside the legal name in
// the contact block on /contact, /privacy, /terms and /sms-terms precisely
// because carriers look. Registration is still pending, so removing it is a
// real, if small, risk to the campaign - taken deliberately, not by accident.
const BUSINESS_ADDRESS = '8 The Green, Dover, DE 19901';

// The public LYNDRY texting number — the one customers text to place an order.
//
// Neil's personal number is NOT published anywhere on this site. It lives only
// in .env and is used solely to reach him when the AI hands off a conversation.
//
// This is the business number from the LYNDRY messaging account. Note that it
// cannot actually receive customer texts until business messaging registration
// is approved. Unset LYNDRY_PHONE_NUMBER to hide the number everywhere on the
// site — the pages fall back to "sign up and we'll text you" on their own.
//
// READ FROM THE ENVIRONMENT, NOT TYPED HERE, AND THIS IS THE WHOLE POINT.
//
// It used to be written out twice: LYNDRY_PHONE_NUMBER, which is the number
// that actually sends and receives, and a pair of constants here, which is the
// number the website, the QR code and the contact card show. They agreed, and
// nothing kept them agreeing.
//
// The day that matters is the day the number changes - a port to another
// carrier, a lost account, a second number for a second county - and that is
// the worst possible day to find out the site is advertising a number that no
// longer answers, or that texts are going out from a number nobody can see.
// One value now, so a change is one value.
const PUBLIC_PHONE_LINK = String(config.telnyx.phoneNumber || '').trim();

// WHO A LAUNDROMAT CALLS, WHICH IS NOT WHO A CUSTOMER CALLS.
//
// The pages a partner sees - the bag tag page, the "this label isn't in use"
// page - said the public business number. That is the number customers text,
// it cannot receive calls until registration lands, and it is not the number
// somebody standing at a counter with a bag in their hand needs. They need a
// person.
//
// READ FROM THE ENVIRONMENT, NEVER TYPED HERE. It is Neil's own number, and the
// rule above holds: it lives in .env and does not go in the repo. Unset, these
// pages fall back to the public number and behave exactly as they did.
const OPS_PHONE = String(process.env.SUPPORT_PHONE || '').trim();

// +14437452665 -> 443-745-2665. A number a person reads aloud, not an E.164
// string. Anything that is not a plain US number is shown as it was given.
//
// DELEGATED, because this was the second copy of the same rule. See
// src/core/format.js - one owner, so every number on the site, in the ops
// screens and in a text reads the same way.
const displayPhone = (raw) => format.displayPhone(raw);
// Derived from the one number above, through the same formatter every other
// number on the site goes through. It was a second hand-typed constant.
const PUBLIC_PHONE_DISPLAY = PUBLIC_PHONE_LINK ? displayPhone(PUBLIC_PHONE_LINK) : '';

// THE LINE SOMEBODY CALLS WHEN SOMETHING IS WRONG.
//
// A second public number, and a second job. The one above is texted and is how
// orders happen; this one rings and is for a person who wants a person - a
// customer with a problem, a laundromat holding a bag, a driver stuck.
//
// Written here rather than read from the environment, which is the opposite of
// the rule directly above and is deliberate. That number has to be the one the
// carrier actually sends from, so it lives in one place and everything derives
// from it. Nothing in this system ever dials this one - it is only ever printed
// - so there is no second copy anywhere for it to drift from.
//
// Blank it and every "call us" on the site disappears rather than showing an
// empty space, the same way the texting number behaves.
const CALL_PHONE_LINK = '+12017712933';
const CALL_PHONE_DISPLAY = CALL_PHONE_LINK ? displayPhone(CALL_PHONE_LINK) : '';

// THE CONSENT SENTENCE, AND THERE IS ONLY ONE OF IT.
//
// It sits under every box on this site that takes a phone number, and a carrier
// comparing two of those boxes expects to read the same sentence twice. They
// drifted apart once already: /sms-terms quoted wording no form had ever shown.
//
// WRITTEN HERE AND ONLY HERE FROM NOW ON. Four copies of it already exist in
// markup - the home page hero, the /bergen advert page, the blockquote on
// /sms-terms and consentTick() in src/routes/account.js - and test/consent.test.js
// holds all of them against this one, so a change to any of them fails the
// suite rather than reaching a carrier. Anything new that asks for a number
// renders this instead of typing a fifth copy.
//
// Plain text, no markup. The two links that follow it on a form are part of the
// form's own markup, because the blockquote on /sms-terms deliberately does not
// carry them: it is already on the page they point at.
const SMS_CONSENT =
  'By checking this box you agree to receive text messages from lyndry at the ' +
  'number provided, including messages sent by autodialer. Consent is not a ' +
  'condition of purchase. Message and data rates may apply. Message frequency ' +
  'varies. Reply HELP for help, STOP to cancel.';

const site = Object.freeze({
  name: 'LYNDRY',
  legalName: LEGAL_NAME,
  businessAddress: BUSINESS_ADDRESS,

  tagline: 'Laundry, handled.',

  // The bare domain, for the places a message names where to go rather than
  // handing over a link: "lyndry.com/account" reads as somewhere you already
  // know and can type yourself, which a token cannot. Derived from baseUrl so
  // there is still one copy of where this site lives.
  domain: String(config.baseUrl || '').split('//').pop().split('/')[0],

  // See SMS_CONSENT above. One sentence, held to by a test.
  smsConsent: SMS_CONSENT,

  // THE PICTURE THAT SHOWS WHEN A LINK IS PASTED ANYWHERE - iMessage, Slack,
  // Facebook. Without one a shared link is a line of grey text, which is what
  // every link to this site was until now.
  //
  // It lives in public/og rather than public/css because it must NOT be
  // fingerprinted: a share card is cached by Facebook and Apple for a long
  // time against the URL they first saw, so a URL that changes whenever a
  // stylesheet changes would leave half of them pointing at nothing.
  ogImage: '/og/lyndry-bergen.png',

  // PUBLISHED AGAIN, and it is a different address from the one that was here.
  // It came off the site when nobody was reading the inbox, on the grounds that
  // a dead address is worse than none; clean@lyndry.com is watched, so the
  // {{EMAIL}} token is back and the legal pages carry it.
  //
  // It is also what the HELP reply uses, which is legally required to carry a
  // contact method and is one of the things a carrier checks.
  email: 'clean@lyndry.com',

  publicPhoneDisplay: PUBLIC_PHONE_DISPLAY,
  publicPhoneLink: PUBLIC_PHONE_LINK,
  hasPublicPhone: Boolean(PUBLIC_PHONE_DISPLAY && PUBLIC_PHONE_LINK),

  // THE NUMBER YOU CALL, WHICH IS NOT THE NUMBER YOU TEXT.
  //
  // Two public numbers doing two jobs. The one above takes texts and is how
  // every order is placed, moved and cancelled; this one is a phone somebody
  // answers when something has gone wrong and a customer wants a person rather
  // than a thread.
  //
  // TYPED HERE, unlike the texting number, and the difference is the point:
  // that one has to match what the carrier sends from, so it is read from the
  // environment and there is one copy of it. Nothing in this system ever dials
  // this one, so there is no second copy for it to disagree with - it belongs
  // with the legal name and the tagline, which are also facts about the
  // business rather than settings.
  callPhoneDisplay: CALL_PHONE_DISPLAY,
  callPhoneLink: CALL_PHONE_LINK,

  // The number on partner-facing pages - the bag tag a laundromat scans, the
  // driver's run screen, the error page.
  //
  // IT IS THE BUSINESS LINE NOW, NOT NEIL'S MOBILE. It used to fall back to
  // SUPPORT_PHONE, which is his personal number and was never meant to be read
  // off a sticker by a stranger at a counter. SUPPORT_PHONE still exists and is
  // still where handoff_to_human reaches him; it is simply no longer what an
  // attendant is told to ring.
  opsPhoneDisplay: CALL_PHONE_DISPLAY || (OPS_PHONE ? displayPhone(OPS_PHONE) : PUBLIC_PHONE_DISPLAY),

  // WHERE WE SAY WE WORK, read by the AI, the website, the town pages and both
  // "we do not reach you yet" messages - 26 places, in a dozen different
  // sentence shapes. One line, deliberately.
  //
  // IT MOVED WITH THE MODEL, NOT WITH A COPY DECISION. Under the van the round
  // starts in Fair Lawn and the county is the boundary. Under a courier the
  // driving is door-to-laundromat, so the boundary is a radius - Neil, 25
  // September: within ten miles of a laundromat "wherever that reaches", and
  // "just keep it inside of new jersey and outside of new york city". Newark is
  // 8.4 miles from the Carlstadt laundromat and Uber will drive it, so Bergen
  // County had become a smaller claim than the truth.
  //
  // "NEW JERSEY", AND IT WAS "NORTHERN NEW JERSEY" UNTIL 26 SEPTEMBER. Neil:
  // "we are not just in northern NJ anymore, our distance depends on our
  // laundromat partners". He is right, and the old string was a promise about
  // geography that a new partner falsified the day it was signed.
  //
  // THE COVERAGE CLAIMS BUILT ON IT ARE GONE - the footer, Contact, the FAQ,
  // How it works and Partners no longer say "we cover ___" at all, because the
  // only honest answer is per-address and the quote page is what gives it.
  // What is left are the places that need a REGION rather than a claim: the
  // page titles and meta descriptions Google matches on, the schema.org
  // areaServed, and the terms.
  //
  // So this is now the outer bound the code actually enforces. `inNewJersey()`
  // refuses anything outside the state, and inside it the real limit is
  // distance to a laundromat, which no fixed string can express. It reads
  // properly in "laundry pickup and delivery in ___", it cannot go stale as
  // partners are added, and the precise form still lives in
  // `booking.serviceAreaWords()` for a refusal or an ops screen to quote.
  // CLAUDE.md's own rule: a vague claim that is TRUE beats a precise one that
  // drifts.
  serviceArea: config.courier.model === 'DYNAMIC' ? 'New Jersey' : 'Bergen County',

  // Pricing comes from config so the website, the database and the AI all
  // quote the same numbers.
  //
  // Wash & fold is priced by weight, which means we CANNOT tell a customer
  // what their order costs before we have collected and weighed it. Anything
  // shown before that point is an estimate and has to say so — quoting a firm
  // price we then change is the fastest way to lose someone's trust.
  pricePerLb: `$${(config.pricing.perPoundCents / 100).toFixed(2)}`,

  // THE ORDER MINIMUM, FOR PROSE THAT IS NOT A PAGE. The {{MINIMUM}} token
  // below covers page files; this is the same figure for the places that build
  // a sentence in JavaScript - the meta descriptions, mainly. It exists because
  // the home page's description carried a typed "$25 minimum" long after the
  // courier model moved it to $45, which is exactly the drift a second copy
  // causes and exactly what Google had indexed.
  minimumDisplay: `$${(config.pricing.minimumCents / 100).toFixed(0)}`,

  // THE OTHER RATE, BECAUSE THERE ARE TWO AND THE SITE ONLY EVER SHOWED ONE.
  //
  // Neil, 15 September: the marketing site contradicted the live checkout. The
  // checkout offers $2.00 or $1.80 and every public page said $2.00 was the
  // price, so somebody read the site, chose from a menu of one, and met a
  // cheaper option at the till.
  //
  // IT IS A RATE, NOT A MEMBERSHIP, and that distinction is the whole of Neil's
  // rule here. There is no club to join, no joining fee, no minimum number of
  // pickups and nothing charged for having one. "No membership" on the pricing
  // page is still TRUE and still has to be there - what was false was "is there
  // a subscription? no".
  //
  // Read from src/core/subscription.js so the website, the checkout, the AI and
  // the confirmation text cannot quote four different numbers.
  subscriptionPricePerLb: subscription.subscriptionRate().replace('/lb', ''),

  // "weekly, every 2 weeks, or every month" - Neil's words, built from the same
  // list the checkout renders its radios from, so a frequency cannot appear on
  // the website that the booking screen does not offer.
  subscriptionFrequencies: (() => {
    const labels = subscription.FREQUENCIES.map((f) => f.label.replace(/^every week$/, 'weekly'));
    return `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`;
  })(),
  // "to" rather than an en dash, in both of these.
  //
  // They are used on web pages, where a dash would be house style, AND inside
  // the AI's prompt and its replies, where any dash is banned because one
  // character outside the basic GSM alphabet triples what a text costs to
  // send. A prompt containing en dashes also teaches the model to write them,
  // however firmly the same prompt says not to. One value, no drift.
  estimateRange: `$${Math.round(config.pricing.estimateLowCents / 100)} to $${Math.round(
    config.pricing.estimateHighCents / 100
  )}`,
  // NO `maxOrder` HERE, AND NO {{MAX_ORDER}} TOKEN. There is no limit on a
  // pickup; see the note in config.js. A typical bag is not a ceiling and must
  // never be rendered as one.
  typicalBagWeight: '15 to 18 lb',

  turnaround: 'next day',

  // ---------------------------------------------------------------------
  // THE SATISFACTION GUARANTEE. Neil's name for it.
  //
  // Neil's ask, and it answers the exact sentence that lost the only two
  // customers who ever reached the card. Kellie: "I never heard of stripe
  // checkout I'll pass but thank you". Trisha: "just not enough info to make
  // me feel confident". Both walked at the moment of handing over a card and
  // a home address, and neither was refusing the price.
  //
  // WHAT IT COVERS IS THE WASH, CAPPED AT THE ORDER, and that scope is
  // deliberate rather than vague. Neil's call, taken with the alternatives in
  // front of him. "You get a full refund" is heard one way by somebody
  // missing a sock and another way by somebody holding a ruined coat, and the
  // second reading is an unbounded promise made by a business with no entity
  // and no insurance behind it yet. So the sentence says what it means: you
  // do not pay for that order.
  //
  // "we'll sort it out" is the deliberate second half. It is warm, it invites
  // them to say something, and it promises a conversation rather than a sum -
  // which is honest, because a person decides what happens next, not the AI
  // and not this string.
  //
  // IT COVERS BEING UNHAPPY, NOT JUST DAMAGE, and Neil widened it deliberately
  // on 10 September having been shown the narrower version first. The earlier
  // wording named damaged or missing items; this one asks nothing about why.
  //
  // WHAT "NO QUESTIONS ASKED" ACTUALLY COMMITS US TO, because it is the part
  // that will be tested: we do not get to decide whether somebody's
  // disappointment is reasonable. Somebody who says the fold was sloppy gets
  // the same answer as somebody whose shirt came back torn. That is the whole
  // value of the sentence to a first-time customer, and it stops being worth
  // anything the first time we argue with one.
  //
  // WHAT IT IS STILL NOT: the value of their clothes. A full refund is the
  // money they paid us for that pickup. It is not a jacket. The prompt says so
  // separately, because "full refund" is exactly the phrase somebody holding a
  // ruined coat will read as covering the coat.
  //
  // ONE COPY, HERE, because it is a promise. The AI repeats it, and if it
  // ever goes on the website or into the card ask those read it from here.
  // Two copies of a guarantee is how a customer ends up quoting back a
  // version we stopped offering.
  //
  // PLAIN ASCII, like everything else in this object that reaches a text
  // message: straight apostrophes, no dashes. See the note on estimateRange.
  guarantee:
    "If you're not happy with the service, we have a satisfaction guarantee: " +
    'full refund, no questions asked.',

  legalUpdated: 'August 2026',
});

// Renders the phone number as a line of HTML, or nothing at all if we do not
// have a public number yet. Pages use {{PHONE_LINE}} and don't have to care.
function phoneLine() {
  if (!site.hasPublicPhone) return '';
  return `<a href="tel:${site.publicPhoneLink}" class="text-brand-700 underline underline-offset-2 hover:text-brand-800">${site.publicPhoneDisplay}</a>`;
}

// A sentence telling people how to reach us, which reads correctly whether or
// not the texting number exists yet.
function contactSentence() {
  if (site.hasPublicPhone) {
    return `Text us at ${site.publicPhoneDisplay}.`;
  }
  return `Sign up below and we'll text you the moment our number goes live. Carrier registration is still being approved.`;
}

// The tokens available inside public/pages/*.html files. Write
// {{PRICE_PER_LB}} in the HTML and it becomes the real rate when the page is served.
const tokens = Object.freeze({
  NAME: site.name,
  PHONE: site.publicPhoneDisplay,
  SMS_LINK: site.hasPublicPhone ? `sms:${site.publicPhoneLink}` : '/#get-started',

  // THE OTHER NUMBER, and the one a page has to label clearly. A visitor shown
  // two phone numbers with no explanation will use the wrong one - so every
  // page that prints these says which is for what.
  CALL_PHONE: site.callPhoneDisplay,
  CALL_LINK: site.callPhoneLink ? `tel:${site.callPhoneLink}` : '',

  // Back on the site. See site.email for why it left and why it has returned.
  EMAIL: site.email,
  EMAIL_LINK: `mailto:${site.email}`,
  LEGAL_NAME: site.legalName,
  TAGLINE: site.tagline,
  PHONE_LINE: phoneLine(),
  CONTACT_SENTENCE: contactSentence(),
  SERVICE_AREA: site.serviceArea,
  PRICE_PER_LB: site.pricePerLb,
  SUBSCRIPTION_PRICE_PER_LB: site.subscriptionPricePerLb,
  SUBSCRIPTION_FREQUENCIES: site.subscriptionFrequencies,
  MINIMUM: site.minimumDisplay,
  MINIMUM_LB: `${config.pricing.minimumCents / config.pricing.perPoundCents} lb`,
  ESTIMATE_RANGE: site.estimateRange,
  BAG_WEIGHT: site.typicalBagWeight,
  TURNAROUND: site.turnaround,
  LEGAL_UPDATED: site.legalUpdated,
  BASE_URL: config.baseUrl,
});

// ---------------------------------------------------------------------------
// The QR code on the home page.
//
// Scanning it opens the phone's messaging app with the LYNDRY number already
// filled in, so someone standing in front of a locker — or looking at a
// flyer — can start without typing anything.
//
// It is drawn as an SVG in memory the first time it's needed and then reused.
// No image file to manage, no external QR service, nothing to go stale.
// ---------------------------------------------------------------------------

const QRCode = require('qrcode');

let qrPromise = null;

function textUsQrSvg() {
  if (!site.hasPublicPhone) return Promise.resolve('');

  if (!qrPromise) {
    qrPromise = QRCode.toString(`sms:${site.publicPhoneLink}`, {
      type: 'svg',
      width: 168,
      // A quiet border around the code. Scanners need it; without one the
      // code is noticeably harder to read.
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f4249', light: '#ffffff' },
    }).catch((err) => {
      // A missing QR code should never take the home page down.
      console.error('QR code generation failed:', err.message);
      return '';
    });
  }

  return qrPromise;
}

module.exports = { site, tokens, textUsQrSvg };
