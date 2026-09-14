'use strict';

// ---------------------------------------------------------------------------
// WHICH MESSAGES ARE US TALKING TO OURSELVES.
//
// Neil, 14 September: filter the message view so ops noise is quieter, and do
// not delete anything that went to a customer.
//
// IT IS A VIEW, NOT A DELETE, AND NOT A FILTER ON THE STORE. Nothing here runs
// near a write. `messages` is the record of what actually reached a phone -
// CLAUDE.md is emphatic that a refused send writes no row precisely so that
// this table can be trusted - and a record you can tidy is not evidence of
// anything. What changes is what a screen puts first.
//
// WHAT THE NOISE ACTUALLY IS, found by reading the live rows rather than
// assuming. Every row in `messages` is a real text to or from a real phone, so
// there is no junk in there to strip. What there IS: issues.js and
// order-alerts.js page the team by calling sendAndLog(phone, body, null) - a
// null customer, sent to a TEAM member's own number. Those are alerts we send
// to ourselves, and because the conversations screen groups by phone number
// they turn a team member's number into a "conversation" with twenty-nine
// messages in it.
//
// THREE THINGS ARE NEVER NOISE, and the rule is drawn so it cannot touch them:
//
//   1. Anything with a customer on it. That is a customer's thread.
//   2. Anything INBOUND. Somebody typed it and sent it to us, including the
//      strangers with no customer row - and the conversations screen exists
//      largely to show exactly those people. Three of them are in the live data
//      right now with one message each.
//   3. Any outbound to a number that is not a team member's.
//
// So the test is all three at once: outbound, no customer, to one of our own.
// ---------------------------------------------------------------------------

// Digits only, and the last ten of them.
//
// The team table and the messages table are written by different paths and
// have never been guaranteed to agree on formatting: +12015551234,
// 12015551234 and 2015551234 are the same phone. Comparing raw digits made
// the first two different numbers, so a team member whose row was saved
// without the country code would have had their alerts read as a customer
// conversation.
//
// Ten, because this business is one county in New Jersey and every number in
// it is NANP. A shorter string is left alone rather than padded - 29283 is a
// real short code in the live data and is nobody's mobile.
function digits(phone) {
  const all = String(phone || '').replace(/\D/g, '');
  return all.length > 10 ? all.slice(-10) : all;
}

// A set of team numbers, in the shape the tests below can build by hand.
function teamPhoneSet(opsUsers = []) {
  return new Set((opsUsers || []).map((u) => digits(u && u.phone)).filter(Boolean));
}

// An alert we sent to ourselves.
function isOpsAlert(message, teamPhones) {
  if (!message) return false;
  if (message.direction !== 'OUTBOUND') return false;
  // A customer on the row means it is that customer's thread, whatever else it
  // looks like.
  if (message.customer_id || message.customers) return false;

  const set = teamPhones instanceof Set ? teamPhones : teamPhoneSet(teamPhones);
  return set.has(digits(message.phone));
}

// A WHOLE THREAD THAT IS NOTHING BUT US TALKING TO OURSELVES.
//
// Every message has to qualify. One inbound from a real person, or one message
// carrying a customer, and it is a conversation again - which is the failure
// worth guarding against, because a team member texting in about their own
// pickup would otherwise be filed as noise.
function isOpsAlertThread(thread, teamPhones) {
  if (!thread) return false;
  if (thread.customer) return false;
  if (thread.inbound > 0) return false;

  const set = teamPhones instanceof Set ? teamPhones : teamPhoneSet(teamPhones);
  if (!set.has(digits(thread.phone))) return false;

  // A thread the grouper built always has a last message; requiring one stops
  // an empty object reading as noise.
  return Boolean(thread.last) && thread.total > 0;
}

// WHAT A CUSTOMER WOULD HAVE SEEN, for the preview column and the default view
// of a thread.
//
// It removes only the alerts. On a real customer thread it removes nothing at
// all, which is worth stating plainly: every message on such a thread reached
// that customer, so there is nothing there to quieten.
function customerVisible(messages = [], teamPhones) {
  const set = teamPhones instanceof Set ? teamPhones : teamPhoneSet(teamPhones);
  return (messages || []).filter((m) => !isOpsAlert(m, set));
}

// Threads in the order a person wants them: real conversations first, the
// alerts we send ourselves last. Sorted, never dropped - the alerts are how
// anybody knows an issue was raised at three in the morning.
function conversationsFirst(threads = [], teamPhones) {
  const set = teamPhones instanceof Set ? teamPhones : teamPhoneSet(teamPhones);

  return [...(threads || [])].sort((a, b) => {
    const an = isOpsAlertThread(a, set) ? 1 : 0;
    const bn = isOpsAlertThread(b, set) ? 1 : 0;
    if (an !== bn) return an - bn;
    // Otherwise leave them as they came, which is newest first.
    return 0;
  });
}

module.exports = {
  digits,
  teamPhoneSet,
  isOpsAlert,
  isOpsAlertThread,
  customerVisible,
  conversationsFirst,
};
