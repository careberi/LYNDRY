'use strict';

const format = require('./format');

// ---------------------------------------------------------------------------
// Phone numbers are stored in exactly one format: +1 followed by ten digits.
//
// Everything else — brackets, dashes, spaces, a leading 1, a leading +1 — is
// normalised away, so the number someone typed on a form matches the number a
// text message arrives from. Every place that accepts a phone number uses
// this, which is the only reason those two ever line up.
//
// Returns null if it isn't a usable US number, so callers have to decide what
// to do rather than storing something that will never match.
// ---------------------------------------------------------------------------

function normalisePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;

  return null;
}

// For showing a number back to someone: +12015551234 -> 201-555-1234.
//
// ONE OWNER, IN src/core/format.js. Neil's decision lock, 14 September: every
// human-facing US number is XXX-XXX-XXXX. This used to write the brackets
// itself and src/web/site.js had a second copy doing the same thing, which is
// how a screen ends up showing two shapes of the same number.
//
// Storage is untouched: normalisePhone() above still writes +1 and ten digits,
// and that is still what goes to the carrier.
function formatPhone(stored) {
  return format.displayPhone(stored);
}

module.exports = { normalisePhone, formatPhone };
