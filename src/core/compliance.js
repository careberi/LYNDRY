'use strict';

// ---------------------------------------------------------------------------
// STOP / START / HELP.
//
// These are legally required and are handled here, in plain code, BEFORE the
// AI ever sees the message. They must never depend on a model interpreting
// them correctly — getting an opt-out wrong is a regulatory problem, not a
// customer service one.
//
// Matching is deliberately strict: the whole message must be the keyword and
// nothing else. "STOP" opts out. "stop by at 5" is a normal message about a
// pickup time and must not silently unsubscribe someone.
// ---------------------------------------------------------------------------

const OPT_OUT = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'END', 'QUIT'];

// The real opt-in keywords. Always honoured, whoever sends them.
const OPT_IN = ['START', 'UNSTOP'];

// YES is on the carrier list too, but it is ALSO the most common word in this
// entire product: it confirms a booking recap, an address, a schedule.
//
// Treated as an opt-in ONLY from somebody who is actually unsubscribed. For
// everyone else it is an ordinary word and goes to the AI. Without this, a
// customer answering "yes" to "Good to go?" got "You are subscribed to LYNDRY
// order updates again" and their booking never happened - which is exactly
// what a real customer saw.
const OPT_IN_IF_UNSUBSCRIBED = ['YES', 'UNSTOP ALL', 'RESUME'];

const HELP = ['HELP', 'INFO'];

// Note the absence of CANCEL.
//
// CANCEL appears on the standard carrier opt-out list, but for a laundry
// service a customer texting "cancel" overwhelmingly means "cancel my order",
// not "never text me again". Treating it as an opt-out would silently break
// the product for anyone using the word naturally. STOP — the keyword that is
// actually required — is handled, and Telnyx also enforces opt-out keywords at
// the platform level as a second line of defence.

function normalise(text) {
  // Strip punctuation and collapse whitespace so "STOP." and " stop " match.
  return String(text || '')
    .trim()
    .toUpperCase()
    .replace(/[.!,?;:]+$/, '')
    .trim();
}

// Returns the keyword this message is, or null if it's an ordinary message.
//
// `customer` is optional and only affects the soft opt-in words: pass it and
// "yes" is treated as consent ONLY when they are actually unsubscribed. The
// legally required keywords do not depend on it and never will.
function classify(text, customer = null) {
  const word = normalise(text);

  if (OPT_OUT.includes(word)) return 'OPT_OUT';
  if (OPT_IN.includes(word)) return 'OPT_IN';

  // Only somebody who has opted out can opt back in, so only they can mean
  // "yes" that way. An active customer saying "yes" is answering a question.
  if (OPT_IN_IF_UNSUBSCRIBED.includes(word)) {
    const unsubscribed = !customer || customer.status === 'UNSUBSCRIBED';
    if (unsubscribed) return 'OPT_IN';
  }

  if (HELP.includes(word)) return 'HELP';

  return null;
}

// The reply to send for each keyword. Short, plain, no emoji — these are read
// by carriers during compliance review as well as by customers.
function replyFor(keyword, { supportEmail, signupUrl }) {
  switch (keyword) {
    case 'OPT_OUT':
      return (
        'You have been unsubscribed from LYNDRY and will not receive further messages. ' +
        'Reply START to opt back in.'
      );

    case 'OPT_IN':
      return (
        'You are subscribed to LYNDRY order updates again. ' +
        'Message and data rates may apply. Reply STOP to opt out.'
      );

    case 'HELP':
      return (
        'LYNDRY laundry pickup and delivery. Text us to book a pickup. ' +
        `Help: ${supportEmail} or ${signupUrl}. ` +
        'Message and data rates may apply. Reply STOP to opt out.'
      );

    default:
      return null;
  }
}

// What the keyword does to the customer's record. null means no change.
function statusFor(keyword) {
  if (keyword === 'OPT_OUT') return 'UNSUBSCRIBED';
  if (keyword === 'OPT_IN') return 'ACTIVE';
  return null;
}

module.exports = { classify, replyFor, statusFor };
