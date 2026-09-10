'use strict';

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

// +14437452665 -> (443) 745-2665. A number a person reads aloud, not an E.164
// string. Anything that is not a plain US number is shown as it was given.
function displayPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return String(raw || '');
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
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

const site = Object.freeze({
  name: 'LYNDRY',
  legalName: LEGAL_NAME,
  businessAddress: BUSINESS_ADDRESS,

  tagline: 'Laundry, handled.',

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

  serviceArea: 'Bergen County',

  // Pricing comes from config so the website, the database and the AI all
  // quote the same numbers.
  //
  // Wash & fold is priced by weight, which means we CANNOT tell a customer
  // what their order costs before we have collected and weighed it. Anything
  // shown before that point is an estimate and has to say so — quoting a firm
  // price we then change is the fastest way to lose someone's trust.
  pricePerLb: `$${(config.pricing.perPoundCents / 100).toFixed(2)}`,
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
  maxOrder: `${config.pricing.maxOrderLb} lb`,
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
  // THE NAME IS WIDER THAN THE PROMISE, and that is worth knowing rather than
  // fixing quietly. "Satisfaction guarantee" is ordinarily heard as "if you
  // are not happy you do not pay", where this covers damage and loss. Neil
  // named it; the sentence is the thing that is actually promised, and the
  // sentence is what the AI says. If the promise ever widens to cover somebody
  // who simply did not like the fold, it widens HERE and nowhere else.
  //
  // ONE COPY, HERE, because it is a promise. The AI repeats it, and if it
  // ever goes on the website or into the card ask those read it from here.
  // Two copies of a guarantee is how a customer ends up quoting back a
  // version we stopped offering.
  //
  // PLAIN ASCII, like everything else in this object that reaches a text
  // message: straight apostrophes, no dashes. See the note on estimateRange.
  guarantee:
    "If anything comes back damaged or missing, you don't pay for that order. " +
    "Just tell us and we'll sort it out.",

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
  MINIMUM: `$${(config.pricing.minimumCents / 100).toFixed(0)}`,
  MINIMUM_LB: `${config.pricing.minimumCents / config.pricing.perPoundCents} lb`,
  ESTIMATE_RANGE: site.estimateRange,
  MAX_ORDER: site.maxOrder,
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
