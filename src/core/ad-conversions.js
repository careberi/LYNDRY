'use strict';

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
// ---------------------------------------------------------------------------
// THE LAYOUT IS DATA MANAGER'S, AND IT REPLACED THE LEGACY ONE ON 23 SEPTEMBER.
//
// Google moved scheduled uploads to a screen called Data Manager and the old
// one no longer exists. The file this produced was written for the old screen
// and Data Manager could not read it at all: it takes THE FIRST LINE AS THE
// COLUMN HEADERS, and the first line was "Parameters:TimeZone=America/New_York"
// - so it saw a single column named after the time zone, found no conversions
// in it, and imported nothing. The credential was fine and the file downloaded
// cleanly; it was simply unreadable.
//
// Four things changed, and each is forced by that screen:
//
//   headers first        no Parameters line. It is not supported and it is
//                        actively harmful, because it is eaten as the header
//   the offset per row   the time zone used to live on the line that is gone,
//                        so every timestamp now carries its own -04:00 or
//                        -05:00 and the file cannot be misread in another zone
//   three id columns     GCLID, GBRAID and WBRAID are separate fields to Data
//                        Manager, not one "Google Click ID" column
//   click id or nothing  see below
//
// THE CONVERSION ACTION NAMES DID NOT CHANGE, and must not. "Booked first
// pickup" and "First paid order" match the actions in the account exactly, and
// a rename is rejected row by row with no partial credit.
//
// ---------------------------------------------------------------------------
// AND NOTHING PERSONAL LEAVES HERE AT ALL NOW, WHICH IS A CHANGE.
//
// There used to be a hashed-phone column for one case: somebody who tapped the
// message button on a search ad, never loaded the site, and therefore carries
// no click id at all. Data Manager will only accept those rows with ENHANCED
// CONVERSIONS switched on, and CLAUDE.md forbids enhanced conversions in as
// many words. So those rows are left out of the file entirely and the column
// has gone with them.
//
// WHICH MEANS THE OLD "never put a click id and a phone on the same row" RULE
// IS NOW STRUCTURAL rather than a thing to remember: there is no phone column
// to put one in. Nothing identifying is in this file - a click id, a fixed
// action name, a timestamp and an amount.
//
// THE COLUMN IS GONE, THE RECORD IS NOT. first_touch_source still marks those
// customers (migration 0098) and they still appear in any report read off the
// database. What they cannot do is be uploaded, and feed() says how many were
// left out rather than dropping them silently.
// ---------------------------------------------------------------------------
//
// WHO IS IN IT: anybody we can honestly attribute to a Google ad.
//
//   a click id          gclid, gbraid or wbraid off the landing URL (0085)
//   the starter text    they tapped the message button on a search ad and
//                       never loaded the site, so there is no click id at all
//                       (first_touch_source, 0098)
//
// THE STARTER-TEXT ROWS ARE COUNTED AND EXCLUDED - see the note above. They
// need enhanced conversions, which this codebase does not do.
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
// NO NAME, NO EMAIL, NO ADDRESS, NO PHONE. Nothing personal leaves here in any
// form, hashed or otherwise.
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

// New Jersey time, ISO 8601, CARRYING ITS OWN UTC OFFSET - "2026-09-14T20:05:25-04:00".
//
// THE OFFSET IS IN EVERY ROW BECAUSE THE LINE THAT USED TO HOLD IT IS GONE.
// The legacy format put "Parameters:TimeZone=America/New_York" at the top of
// the file and left every timestamp bare; Data Manager has no such line, and a
// bare timestamp is read in whatever fallback zone the connection happens to be
// configured with. An hour or four out would not fail loudly - it would quietly
// attribute conversions to the wrong day.
//
// IT IS READ, NOT ASSUMED. -04:00 in summer and -05:00 in winter, taken from
// the same Intl data everything else here uses, so the March and November
// changeovers need nobody to remember them.
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
    // "GMT-04:00" - the only part of this that is new, and the whole reason
    // the row can stand on its own without a time zone declared elsewhere.
    timeZoneName: 'longOffset',
  })
    .formatToParts(at)
    .reduce((acc, p) => Object.assign(acc, { [p.type]: p.value }), {});

  // Intl gives 24 for midnight in some runtimes; Google wants 00.
  const hour = parts.hour === '24' ? '00' : parts.hour;

  // Intl says "GMT-04:00", and at an offset of zero just "GMT". New Jersey is
  // never the second, but a bare offset would be a silently wrong timestamp
  // rather than a visible one, so it is spelled out either way.
  const offset = String(parts.timeZoneName || '').replace(/^GMT/, '') || '+00:00';

  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}${offset}`;
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

// WHICH CLICK ID THIS CUSTOMER CARRIES, in the column Data Manager wants it in.
//
// GCLID is an ordinary web click. GBRAID and WBRAID are the iOS pair, where
// Apple's rules mean Google cannot hand back a per-click id - they arrive on
// different journeys and Data Manager keeps them in separate fields. One
// customer has at most one, and gclid wins if a row somehow carries two.
//
// NULL MEANS THE ROW IS NOT IN THE FILE. That covers everybody with no click id
// at all, including the starter-text customers who need enhanced conversions -
// see the note at the top. Nothing is uploaded blank and nothing is guessed.
function identify(customer) {
  if (customer.gclid) return { gclid: customer.gclid, gbraid: '', wbraid: '' };
  if (customer.gbraid) return { gclid: '', gbraid: customer.gbraid, wbraid: '' };
  if (customer.wbraid) return { gclid: '', gbraid: '', wbraid: customer.wbraid };
  return null;
}

// How many customers we can genuinely attribute to a Google ad but may not
// upload. Reported rather than silently dropped: it is the size of what
// refusing enhanced conversions costs, and it belongs in front of whoever reads
// the numbers rather than buried here.
function excludedForNoClickId(customers) {
  return (customers || []).filter(
    (c) => !identify(c) && c.first_touch_source === GOOGLE_AD_TEXT
  ).length;
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
        rows.push({ ...who, name: BOOKED, at, value: BOOKED_VALUE.toFixed(2) });
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
          ...who,
          name: PAID,
          at,
          value: (Number(paid.amount_paid_cents) / 100).toFixed(2),
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

// DATA MANAGER'S OWN FIELD NAMES, SPELLED ITS WAY.
//
// The mapping step will let you point any column at any field by hand, and
// these are the names that make it map itself. They are not ours to prettify:
// "Conversion action" and "Conversion date and time" are what that screen
// looks for, and "Conversion Name" - the legacy spelling that was here - is
// not.
const HEADER = [
  'GCLID',
  'GBRAID',
  'WBRAID',
  'Conversion action',
  'Conversion date and time',
  'Conversion value',
  'Conversion currency',
];

// THE FIRST LINE IS THE HEADERS, AND NOTHING MAY COME BEFORE IT.
//
// This is the whole of what broke the first connection. Data Manager reads line
// one as the column names, so the legacy "Parameters:TimeZone=" line was taken
// as a single column called Parameters_TimeZone_America_New_York, and a file
// full of conversions imported nothing at all. The time zone lives in each
// timestamp now; see conversionTime() above.
function csv(rows) {
  const lines = [HEADER.join(',')];

  for (const row of rows) {
    lines.push(
      [row.gclid, row.gbraid, row.wbraid, row.name, row.at, row.value, CURRENCY]
        .map(field)
        .join(',')
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
  const customers = await attributedCustomers();

  // SAID OUT LOUD, ONCE PER FETCH. A customer we can name as a Google ad click
  // and may not upload is a real cost of refusing enhanced conversions, and a
  // silent exclusion is how a number nobody can explain turns up in a report
  // three months later.
  const left = excludedForNoClickId(customers);
  if (left) {
    console.log(
      `Conversion feed: ${left} customer(s) came from a Google message ad and carry no ` +
        `click id, so they are not in the file. Uploading them needs enhanced conversions, ` +
        `which this codebase does not do.`
    );
  }

  return csv(rowsFor(customers));
}

module.exports = {
  feed,
  isAdStarterText,
  csv,
  rowsFor,
  conversionTime,
  identify,
  excludedForNoClickId,
  HEADER,
  BOOKED,
  PAID,
  BOOKED_VALUE,
  AD_STARTER_TEXT,
  GOOGLE_AD_TEXT,
};
