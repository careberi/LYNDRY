'use strict';

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

// For showing a number back to someone: +12015551234 -> (201) 555-1234.
function formatPhone(stored) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(String(stored || ''));
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(stored || '');
}

module.exports = { normalisePhone, formatPhone };
