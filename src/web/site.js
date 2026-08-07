'use strict';

// ---------------------------------------------------------------------------
// Site-wide values.
//
// EVERYTHING that appears on more than one page lives here. Change the price
// once and it changes on every page. Nothing in public/pages/ should hardcode
// a price, a phone number or an email address — use a {{TOKEN}} instead.
// ---------------------------------------------------------------------------

const { config } = require('../config');

// TODO: replace with the exact legal name of the LLC once Neil confirms it,
// as it appears on the paperwork. Carriers compare the name registered for
// business texting against what is written on this website, so these have to
// match. Until then the site says LYNDRY, which is truthful.
const LEGAL_NAME = 'LYNDRY';

// TODO: replace with the LLC's real business address. This is published on
// the contact page and is also submitted during carrier registration.
const BUSINESS_ADDRESS = 'Jersey City, New Jersey';

// The public LYNDRY texting number — the one customers text to place an order.
//
// Neil's personal number is NOT published anywhere on this site. It lives only
// in .env and is used solely to reach him when the AI hands off a conversation.
//
// This is the business number from the LYNDRY messaging account. Note that it
// cannot actually receive customer texts until business messaging registration
// is approved. Blank both of these out to hide the number everywhere on the
// site — the pages fall back to "sign up and we'll text you" on their own.
const PUBLIC_PHONE_DISPLAY = '(201) 389-9218';
const PUBLIC_PHONE_LINK = '+12013899218';

const site = Object.freeze({
  name: 'LYNDRY',
  legalName: LEGAL_NAME,
  businessAddress: BUSINESS_ADDRESS,

  tagline: 'Laundry, handled.',

  email: 'neil@lyndry.com',

  publicPhoneDisplay: PUBLIC_PHONE_DISPLAY,
  publicPhoneLink: PUBLIC_PHONE_LINK,
  hasPublicPhone: Boolean(PUBLIC_PHONE_DISPLAY && PUBLIC_PHONE_LINK),

  serviceArea: 'Northern New Jersey, down to Jersey City',

  // Pricing comes from config so the website and the database agree.
  priceDisplay: `$${(config.pricing.bagPriceCents / 100).toFixed(0)}`,
  bagWeight: '15–18 lb',

  turnaround: '24 hours',

  legalUpdated: 'August 2026',
});

// Renders the phone number as a line of HTML, or nothing at all if we do not
// have a public number yet. Pages use {{PHONE_LINE}} and don't have to care.
function phoneLine() {
  if (!site.hasPublicPhone) return '';
  return `<a href="tel:${site.publicPhoneLink}" class="text-brand-700 underline underline-offset-2 hover:text-brand-900">${site.publicPhoneDisplay}</a>`;
}

// A sentence telling people how to reach us, which reads correctly whether or
// not the texting number exists yet.
function contactSentence() {
  if (site.hasPublicPhone) {
    return `Text us at ${site.publicPhoneDisplay} or email ${site.email}.`;
  }
  return `Email us at ${site.email}. Our texting number goes live once carrier registration is approved — sign up now and we'll text you the moment it does.`;
}

// The tokens available inside public/pages/*.html files. Write {{PRICE}} in
// the HTML and it becomes $39 when the page is served.
const tokens = Object.freeze({
  NAME: site.name,
  PHONE: site.publicPhoneDisplay,
  SMS_LINK: site.hasPublicPhone ? `sms:${site.publicPhoneLink}` : '/signup',
  LEGAL_NAME: site.legalName,
  BUSINESS_ADDRESS: site.businessAddress,
  TAGLINE: site.tagline,
  EMAIL: site.email,
  PHONE_LINE: phoneLine(),
  CONTACT_SENTENCE: contactSentence(),
  SERVICE_AREA: site.serviceArea,
  PRICE: site.priceDisplay,
  BAG_WEIGHT: site.bagWeight,
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
