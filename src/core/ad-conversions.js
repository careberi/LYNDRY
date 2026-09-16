'use strict';

const crypto = require('node:crypto');
const db = require('../db');
// ONE OWNER FOR THE SERVICE CLOCK. format.js already holds it and every screen
// in the system reads it from there; a second copy here would be the thing that
// disagrees the year the timezone database moves a boundary.
const { SERVICE_TZ } = require('./format');

// ---------------------------------------------------------------------------
// TELLING GOOGLE WHICH CLICKS BECAME PAYING CUSTOMERS.
//
// Neil, 11 September, after ringing a lead who had no idea what LYNDRY was:
// Google should optimise for customers who PAY, not for people who fill in a
// form. The website tag can only report the form - by the time somebody pays,
// days later, they are texting us and not browsing the site. This is the other
// half: two offline conversions, uploaded back to Google against the ad click
// that found them.
//
//   Booked first pickup   Qualified lead, fixed $20
//   First paid order      Purchase, the real amount collected
//
// ONCE PER CUSTOMER, EVER. Both are first-time events by definition, and
// Google's conversion actions are set to count One.
//
// NOTHING IS STORED SAYING "REPORTED". There is no uploaded_at column and no
// ledger of what has been sent, which looks careless and is the opposite - see
// IDEMPOTENCE below. It is the derived-not-stored rule the rest of this
// codebase follows: a second copy of "has Google been told" would go stale the
// first time an upload was re-run by hand.
//
// IDEMPOTENCE IS GOOGLE'S, AND IT IS FREE. A click conversion is identified by
// the click id, the conversion name and the CONVERSION TIME, so re-uploading a
// row Google already has is ignored as a duplicate. The times here are the
// times the thing actually happened - the booking, the payment - never "now".
// So the same file can be served every day for ever, each day's file is the
// whole history rather than a delta, and a missed day repairs itself on the
// next one. Using the upload time would make every re-run a new conversion and
// would inflate the count without limit.
//
// WHO IS IN IT: anybody we can honestly attribute to a Google ad.
//
//   a click id          gclid, gbraid or wbraid off the landing URL (0085)
//   the starter text    they tapped the message button on a search ad and
//                       never loaded the site, so there is no click id at all
//                       (first_touch_source, 0098)
//
// THE TWO ARE NEVER PUT ON THE SAME ROW, and that is not tidiness. Google's own
// guidance: uploading a click id alongside user-provided data "can cause
// matching conflicts if Google Ads prioritizes GCLID". So a row carries a click
// id and no phone, or a hashed phone and no click id. The phone column exists
// for the starter-text rows and is empty on every other line.
//
// WHAT IS NOT IN IT, deliberately:
//
//   a cancelled first pickup   it was booked and then was not. Counting it
//                              teaches Google to buy people who cancel, and
//                              half the Google orders so far were cancelled
//   a waived order             a favour is not revenue
//   a trip charge              payments.applies_to_wash is false on those - the
//                              $25 kept when a card fails at a door is real
//                              money and is not somebody buying a wash
//
// NO NAME, NO EMAIL, NO ADDRESS, EVER. The only personal thing that leaves here
// is a phone number that has been through SHA-256, which is what Google asks
// for and cannot be read back.
// ---------------------------------------------------------------------------

// The two conversion actions, named in Google Ads. THE STRINGS MUST MATCH the
// action names in the account exactly or the upload is rejected row by row with
// no partial credit.
const BOOKED = 'Booked first pickup';
const PAID = 'First paid order';

// What a booked first pickup is worth. Google needs a number to compare a lead
// against a sale; this is a stand-in for the gross margin on one order, not a
// measured figure, and it is here rather than typed into the account so the two
// halves of the model live together.
const BOOKED_VALUE = 20;

const CURRENCY = 'USD';

// Google's own words for the starter text on the message asset. A first inbound
// that is exactly this is a tap on that button.
const AD_STARTER_TEXT = "Hi, I'd like to book a laundry pickup.";
const GOOGLE_AD_TEXT = 'google_ad_text';

// A pickup that was called off was not a booked pickup. See above.
const CANCELLED = 'CANCELED';

// SHA-256 OF THE NUMBER IN E.164, lowercase hex - Google's stated format for a
// hashed phone. normalisePhone() already produces E.164, so there is no second
// idea of what a phone number looks like in here.
function hashPhone(phone) {
  const e164 = String(phone || '').trim();
  if (!/^\+[1-9]\d{6,14}$/.test(e164)) return null;
  return crypto.createHash('sha256').update(e164).digest('hex');
}

// New Jersey time, written the way Google's importer reads it, to match the
// TimeZone line at the top of the file. Everything else in this codebase that
// shows a time to a person uses the service clock; an upload is no different,
// and UTC here would land every evening's conversion on the wrong day.
function conversionTime(value) {
  // FALSY FIRST, AND THAT GUARD IS LOAD-BEARING. `new Date(null)` is not an
  // invalid date - it is the epoch - so a null paid_at would sail through the
  // NaN check below and upload a conversion dated 1969 to Google. Caught by a
  // test rather than by reading the code.
  if (value === null || value === undefined || value === '') return null;

  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SERVICE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(at)
    .reduce((acc, p) => Object.assign(acc, { [p.type]: p.value }), {});

  // Intl gives 24 for midnight in some runtimes; Google wants 00.
  const hour = parts.hour === '24' ? '00' : parts.hour;

  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}`;
}

// IS THIS THE STARTER TEXT GOOGLE TYPES?
//
// Compared loosely on purpose, and only loosely. What varies between handsets
// is punctuation and spacing - a curly apostrophe for the straight one in
// "I'd", a missing full stop, a trailing space, different capitalisation - and
// none of those means somebody typed a different sentence. What is NOT allowed
// to vary is the words: anything with extra words in it is a person writing
// their own message, which is the thing this must not claim credit for.
//
// It is an exact match after normalising, never a "contains". "Hi, I'd like to
// book a laundry pickup. Tomorrow if you can?" is somebody talking to us, and
// crediting Google for it would inflate the only number this feature produces.
function isAdStarterText(message) {
  const flatten = (text) =>
    String(text || '')
      // Every apostrophe and quote mark a phone might substitute.
      .toLowerCase()
      // Apostrophes are DELETED rather than turned into a space, so "I'd",
      // "I’d" and a handset that drops it altogether all flatten to "id".
      // Turning them into spaces would split one word into two and make those
      // three spellings three different sentences.
      .replace(/[‘’‛ʼ`´']/g, '')
      // Everything else punctuation carries no meaning here; the words do.
      .replace(/[^a-z]+/g, ' ')
      .trim();

  const said = flatten(message);
  return Boolean(said) && said === flatten(AD_STARTER_TEXT);
}

// WHICH IDENTIFIER THIS ROW CARRIES, and only ever one of them.
function identify(customer) {
  const click = customer.gclid || customer.gbraid || customer.wbraid || null;
  if (click) return { click, phone: '' };

  if (customer.first_touch_source === GOOGLE_AD_TEXT) {
    const hashed = hashPhone(customer.phone);
    if (hashed) return { click: '', phone: hashed };
  }

  return null;
}

// The earliest order that counts, or undefined. Orders arrive oldest first.
const firstWhere = (orders, test) => (orders || []).find(test);

// THE DERIVATION, SEPARATE FROM THE QUERY so it can be tested without a
// database. Give it customers each carrying their own orders.
function rowsFor(customers) {
  const rows = [];

  for (const customer of customers || []) {
    const who = identify(customer);
    if (!who) continue;

    const orders = [...(customer.orders || [])].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    // 1. BOOKED FIRST PICKUP - their earliest pickup that was not called off.
    const booked = firstWhere(orders, (o) => o.status !== CANCELLED);
    if (booked) {
      const at = conversionTime(booked.created_at);
      if (at) {
        rows.push({
          click: who.click,
          name: BOOKED,
          at,
          value: BOOKED_VALUE.toFixed(2),
          phone: who.phone,
        });
      }
    }

    // 2. FIRST PAID ORDER - the earliest one that actually took money, valued
    //    at what was actually collected rather than what it was priced at. A
    //    part-paid order is worth what cleared.
    const paid = firstWhere(
      orders,
      (o) =>
        o.payment_status !== 'WAIVED' &&
        Number(o.amount_paid_cents) > 0 &&
        (o.paid_at || o.delivered_at || o.created_at)
    );
    if (paid) {
      const at = conversionTime(paid.paid_at || paid.delivered_at || paid.created_at);
      if (at) {
        rows.push({
          click: who.click,
          name: PAID,
          at,
          value: (Number(paid.amount_paid_cents) / 100).toFixed(2),
          phone: who.phone,
        });
      }
    }
  }

  // Oldest first, so the file reads like a history and a diff between two days
  // is an append.
  return rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// A CSV field, quoted only when it has to be. Nothing here can legitimately
// contain a comma or a quote - a click id, a hex hash, a fixed name, a date and
// a number - so anything that does is corrupt and is quoted rather than allowed
// to shift every later column.
function field(value) {
  const text = String(value == null ? '' : value);
  return /[",\n\r]/.test(text) ? `"${text.split('"').join('""')}"` : text;
}

const HEADER = [
  'Google Click ID',
  'Conversion Name',
  'Conversion Time',
  'Conversion Value',
  'Conversion Currency',
  'Phone Number',
];

// THE PARAMETERS LINE COMES FIRST and is not a comment - Google's importer
// reads the time zone from it, and without it the times are read as the
// account's zone and land hours out.
function csv(rows) {
  const lines = [
    `Parameters:TimeZone=${SERVICE_TZ}`,
    HEADER.join(','),
  ];

  for (const row of rows) {
    lines.push(
      [row.click, row.name, row.at, row.value, CURRENCY, row.phone].map(field).join(',')
    );
  }

  // A trailing newline: some importers drop a last line without one.
  return `${lines.join('\n')}\n`;
}

// Every customer we can attribute, with their orders. One query, not one per
// customer - the same shape as promotions.expectedForMany().
async function attributedCustomers() {
  const { data, error } = await db
    .from('customers')
    .select(
      'id, phone, gclid, gbraid, wbraid, first_touch_source, ' +
        'orders (id, created_at, status, payment_status, amount_paid_cents, paid_at, delivered_at)'
    )
    .or(
      'gclid.not.is.null,gbraid.not.is.null,wbraid.not.is.null,' +
        `first_touch_source.eq.${GOOGLE_AD_TEXT}`
    );

  if (error) throw error;
  return data || [];
}

async function feed() {
  return csv(rowsFor(await attributedCustomers()));
}

module.exports = {
  feed,
  isAdStarterText,
  csv,
  rowsFor,
  hashPhone,
  conversionTime,
  identify,
  HEADER,
  BOOKED,
  PAID,
  BOOKED_VALUE,
  AD_STARTER_TEXT,
  GOOGLE_AD_TEXT,
};
