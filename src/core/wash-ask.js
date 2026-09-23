'use strict';

// THE WASH QUESTION AFTER A BOOKING, ONCE.
//
// Neil, 21 September: book first, ask wash after. The booking is made and
// confirmed without it, and then this sends wash.QUESTION as its own message -
// once, ever, and only to somebody who has chosen nothing at all.
//
// TWO DOORS SEND IT, which is why it lives here rather than in a route:
//
// | | |
// |---|---|
// | `sms.js` | a pickup booked in the thread, with a card already on file |
// | `card-saved.js` | a pickup booked in the thread WITHOUT one - the card link went out instead of the confirmation, and saving the card is what confirms it |
//
// The second is every new customer who books by text while Stripe is live, so
// with only the first door the rule held for almost nobody. One gate for both,
// so "have we asked" cannot mean two different things.
//
// Somebody who has chosen HALF the wash is left to Lyn, who asks for just the
// missing half; this question would ask for both. A website booking chose the
// wash as a form step before the order existed, so it never reaches here.
//
// SYSTEM, so it is never chased: the wash is useful, never a reason to text
// somebody twice. Stamped asked_for 'water_temp' so the intake table shows it
// asked and waiting (one label fits one row; the softener row stays DEFAULT,
// which is true).

const db = require('../db');
const wash = require('./wash');
const { sendAndLog } = require('./notify');

// When we last asked this number how to wash it, or null for never. By the
// label a sent question carries, or by the question's own first line for
// anything asked before the label existed, or by Lyn in the prompt's words.
//
// A number, not a customer: a thread is read by phone everywhere else.
async function askedAt(phone) {
  const firstLine = wash.QUESTION.split('\n')[0];

  const [labelled, worded] = await Promise.all([
    db
      .from('messages')
      .select('created_at')
      .eq('phone', phone)
      .eq('direction', 'OUTBOUND')
      .in('asked_for', ['water_temp', 'fabric_softener'])
      .order('created_at', { ascending: false })
      .limit(1),
    db
      .from('messages')
      .select('created_at')
      .eq('phone', phone)
      .eq('direction', 'OUTBOUND')
      .ilike('body', `%${firstLine}%`)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  if (labelled.error) throw labelled.error;
  if (worded.error) throw worded.error;

  const times = [...(labelled.data || []), ...(worded.data || [])].map((m) => m.created_at).sort();
  return times.length ? times[times.length - 1] : null;
}

// Nothing at all chosen, read off the row as it is NOW. The customer object a
// caller holds was loaded before the booking, and a save_details in the same
// turn may have written a wash since.
async function nothingChosen(customer) {
  const { data: fresh, error } = await db.from('customers').select('preferences').eq('id', customer.id).maybeSingle();
  if (error) throw error;
  const prefs = (fresh || customer).preferences || {};
  return !wash.KEYS.some((key) => wash.isValid(key, prefs[key]));
}

// Ask, if it is owed. `send(body, options)` is how the caller texts - sms.js
// passes its say() wrapper so the introduction goes on one message only - and
// defaults to sendAndLog.
//
// NEVER THROWS. The booking is made and confirmed; a question that fails to go
// is a line in the log. Returns whether it was sent.
async function askAfterBooking(customer, { send = null } = {}) {
  try {
    if (!customer || !customer.phone) return false;
    if (!(await nothingChosen(customer))) return false;
    if (await askedAt(customer.phone)) return false;

    const options = { kind: 'SYSTEM', askedFor: 'water_temp' };
    console.log(`WASH    ${customer.phone}: booked with no wash chosen. Asking.`);
    if (send) await send(wash.QUESTION, options);
    else await sendAndLog(customer.phone, wash.QUESTION, customer.id, options);
    return true;
  } catch (err) {
    console.error(`Could not ask ${customer && customer.phone} about the wash after booking: ${err.message}`);
    return false;
  }
}

module.exports = { askAfterBooking, askedAt, nothingChosen };
