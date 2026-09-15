'use strict';

// ---------------------------------------------------------------------------
// HOW A DATE AND A PHONE NUMBER ARE WRITTEN FOR A PERSON TO READ.
//
// Neil's decision lock, 14 September: every human-facing date is MM/DD/YYYY and
// every human-facing US phone number is XXX-XXX-XXXX. Internal storage and
// integration formats do not move.
//
// DISPLAY ONLY. Dates are still stored as ISO date strings and timestamptz;
// phone numbers are still stored as +1 followed by ten digits, which is what
// normalisePhone() writes and what the carrier sends from. Nothing here is ever
// written to a row or handed to a provider - passing a dashed number to Telnyx
// or Stripe is the one way this change could break something real, which is why
// the formatting lives in its own file rather than anywhere near the ones that
// send.
//
// ONE OWNER, BECAUSE THE WHOLE POINT IS CONSISTENCY. There were three phone
// formatters and four date formatters before this, all producing something
// slightly different, which is exactly how a screen ends up showing
// "(201) 554-1877" beside "+12015541877". A rule with four copies is four
// rules.
//
// THE UTC MIDNIGHT TRAP IS THE REASON THE TWO DATE FUNCTIONS ARE SEPARATE.
// A date-only string like "2026-09-15" parsed as a Date is UTC midnight, which
// is the evening of the 14th in New Jersey - so it renders as the previous day
// for everybody who matters. Those are read off the string and never parsed.
// A real timestamp genuinely needs converting, and is converted to New Jersey
// rather than to the server's clock, which Railway runs in UTC.
// ---------------------------------------------------------------------------

const SERVICE_TZ = 'America/New_York';

// For a timestamp, which has a moment in it and therefore a timezone question.
//
// TWO CLOCKS, BECAUSE THE TIME FORMAT IS NOT WHAT CHANGED. Neil's rule: when a
// time is shown as well, the date becomes MM/DD/YYYY and the time keeps the
// format it already had. Most of ops reads 10:31 PM and the order console's
// stage rail reads 22:31; both were already true and neither is this lock's
// business, so both survive it.
const CLOCKS = {
  h12: new Intl.DateTimeFormat('en-US', {
    timeZone: SERVICE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  }),
  h23: new Intl.DateTimeFormat('en-US', {
    timeZone: SERVICE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }),
};

function partsOf(value, hour12 = true) {
  const out = {};
  for (const p of CLOCKS[hour12 ? 'h12' : 'h23'].formatToParts(value)) out[p.type] = p.value;
  return out;
}

// What an empty date looks like. A missing date shows the existing not-set
// state and never invents one - Neil's rule, and the reason this is a constant
// rather than an empty string is that a blank table cell reads as a bug.
const NO_DATE = '—';

// Is this a date-only string, "2026-09-15"? Those are read off the string.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// 2026-09-15 -> 09/15/2026.
//
// Takes a date-only string, a full timestamp, or a Date. A date-only string is
// sliced rather than parsed, for the UTC midnight reason above; anything with a
// time in it is converted to New Jersey's calendar day first, so a text logged
// at 8pm Eastern does not display as tomorrow.
function displayDate(value, { empty = NO_DATE } = {}) {
  if (value == null || value === '') return empty;

  const raw = typeof value === 'string' ? value : null;

  if (raw && DATE_ONLY.test(raw)) {
    const [y, m, d] = raw.split('-');
    return `${m}/${d}/${y}`;
  }

  const when = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(when.getTime())) {
    // Not a date we can read. Show what we were given rather than a wrong one -
    // the same rule displayPhone() follows for a number that will not parse.
    return raw ? raw : empty;
  }

  const p = partsOf(when);
  return `${p.month}/${p.day}/${p.year}`;
}

// 09/15/2026 · 8:30 AM.
//
// The date keeps its format and the time is shown separately beside it, which
// is Neil's rule. The separator is a middle dot rather than a comma so the two
// read as two facts rather than one run-on string.
function displayDateTime(value, { empty = NO_DATE, hour12 = true } = {}) {
  if (value == null || value === '') return empty;

  const when = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(when.getTime())) return empty;

  const p = partsOf(when, hour12);
  const time = hour12 ? `${p.hour}:${p.minute} ${p.dayPeriod}` : `${p.hour}:${p.minute}`;

  return `${p.month}/${p.day}/${p.year} · ${time}`;
}

// Just the clock part, for a screen that already says which day it is.
function displayTime(value, { empty = NO_DATE, hour12 = true } = {}) {
  if (value == null || value === '') return empty;

  const when = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(when.getTime())) return empty;

  const p = partsOf(when, hour12);
  return hour12 ? `${p.hour}:${p.minute} ${p.dayPeriod}` : `${p.hour}:${p.minute}`;
}

// +12015541877 -> 201-554-1877. Also 2015541877, (201) 554-1877, and anything
// else carrying ten digits with an optional leading 1.
//
// ANYTHING THAT IS NOT A US NUMBER COMES BACK AS IT WAS GIVEN. Neil's rule:
// do not force an invalid or incomplete number into the shape. A half-typed
// number displayed as though it were whole is worse than an obviously odd one,
// because somebody will read it out.
function displayPhone(raw) {
  const text = String(raw == null ? '' : raw);
  const digits = text.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;

  if (ten.length !== 10) return text;

  return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
}

module.exports = {
  displayDate,
  displayDateTime,
  displayTime,
  displayPhone,
  NO_DATE,
  SERVICE_TZ,
};
