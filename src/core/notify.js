'use strict';

const db = require('../db');
const sms = require('../providers/sms');

// ---------------------------------------------------------------------------
// Sending a text to a customer, and recording that we sent it.
//
// One function so an outbound message can never be sent without being logged.
// Both the SMS replies and the driver's status updates go through here, which
// is what makes the messages table a complete record of the conversation
// rather than half of one.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// What a text costs to send
// ---------------------------------------------------------------------------
//
// SMS has two encodings. The basic GSM alphabet fits 160 characters per
// segment; anything outside it forces the ENTIRE message into UCS-2, where a
// segment is 70 characters. So one em dash, one curly apostrophe or one emoji
// can turn a single text into three, and carriers bill per segment.
//
// Worse than the money: heavy Unicode and emoji are a spam signal in 10DLC
// scoring, and a filtered message never reaches the customer at all.
//
// This is why every message in this codebase is written with plain hyphens and
// straight quotes. It is easy to undo by pasting in a nicely typeset sentence,
// so the check runs at the one point every outbound text passes through.

const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€';

function inGsmAlphabet(ch) {
  return GSM_BASIC.includes(ch) || GSM_EXTENDED.includes(ch);
}

// Returns { segments, encoding, offenders } for a message body.
function describeCost(text) {
  const offenders = [...new Set([...text].filter((ch) => !inGsmAlphabet(ch)))];

  // 153 and 67 rather than 160 and 70: a multi-part message spends the
  // difference on the header that tells the handset how to reassemble it.
  return offenders.length
    ? { segments: Math.ceil(text.length / 67), encoding: 'UCS-2', offenders }
    : { segments: Math.ceil(text.length / 153), encoding: 'GSM-7', offenders };
}

// Typographic characters that have an exact ASCII equivalent.
//
// Our own messages are written without these, but Claude writes the reply
// whenever a customer asks a question rather than requests an action, and it
// reaches for en dashes and curly quotes the way any decent writer does. The
// prompt asks it not to; this is what makes sure, because a model is not a
// guarantee and the difference is a doubled bill on every price question.
//
// Only ever swaps a character for its plain twin. Nothing here changes what a
// message says, which is why it is safe to do silently — and it runs before
// the message is logged, so the messages table records exactly what was sent.
const PLAIN_EQUIVALENT = {
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-',
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '…': '...', '•': '*', ' ': ' ', '′': "'", '″': '"',
  '«': '"', '»': '"', '‹': "'", '›': "'",
};

function toPlainText(text) {
  const ascii = String(text).replace(
    /[‐-―‘-‟…• ′″«»‹›]/g,
    (ch) => PLAIN_EQUIVALENT[ch] || ch
  );

  // No dashes in a LYNDRY text message, full stop.
  //
  // A dash between phrases is the tell that something was written rather than
  // said, and it is most of what makes a message read as machine-generated.
  // The prompt says so at length; Claude still reaches for one, because every
  // writer does. So the last word belongs here, at the point of sending.
  //
  // Only a hyphen with a space on BOTH sides is touched, which is the one
  // standing in for a comma. Hyphens inside a word (wash-and-fold), inside a
  // phone number and inside a URL have no spaces and are left alone.
  return ascii.replace(/ +- +/g, ", ");
}

function warnIfExpensive(text) {
  const cost = describeCost(text);
  if (!cost.offenders.length) return;

  console.warn('');
  console.warn(`  This text costs ${cost.segments} segments instead of ${Math.ceil(text.length / 153)}.`);
  console.warn(`    ${text.length} characters, forced to UCS-2 by: ${cost.offenders.join(' ')}`);
  console.warn('    Replace those with plain ASCII. See the note in src/core/notify.js.');
  console.warn('');
}

// The 555-0100 to 555-0199 range, reserved for fiction.
//
// Nothing real lives there, which is exactly why seed data and the demo use
// it. This is the guard that makes that safe: a number in that range is never
// handed to the carrier, whatever asks.
//
// It matters because there was no guard at all, and seeded orders go through
// the same fulfilment code as real ones - one demo run of "collected, weighed,
// delivered" would have queued four texts at whatever those numbers happen to
// route to. The message is still LOGGED, so the thread reads exactly as it
// would in front of a laundromat owner; it simply never leaves the building.
function isFictional(phone) {
  return /^\+1\d{3}555 ?01\d\d$/.test(String(phone || '').replace(/[()\-.]/g, ''));
}

// `sentBy` is the ops user who TYPED this, and only that. Null for everything
// else - the AI's own replies, status texts, booking confirmations, the text
// blast - because the one thing the AI needs to know is whether a colleague
// wrote a line or it did. See migration 0062.
// HAS THIS NUMBER ASKED US TO STOP.
//
// Read here, on the phone number, rather than trusted from a customer object a
// caller happened to load ten minutes ago. Somebody can text STOP between a
// board being drawn and a button being pressed.
async function hasOptedOut(phone) {
  const { data, error } = await db
    .from('customers')
    .select('status')
    .eq('phone', phone)
    .maybeSingle();

  // FAILS CLOSED. If we cannot tell whether somebody has opted out, we do not
  // text them. A message that should have gone and did not is a delay; a
  // message to somebody who said STOP is the one thing this system must never
  // do, and the database being down is not a defence anybody would accept.
  if (error) {
    console.error(`Could not check opt-out for ${phone}, refusing to send: ${error.message}`);
    return true;
  }

  return Boolean(data && data.status === 'UNSUBSCRIBED');
}

// How close together counts as the same send. Both real duplicates on
// Manpreet's thread were inside twenty seconds; thirty covers a slower pair
// without ever swallowing a genuine repeat, which in a real conversation is
// minutes apart at the least.
const DUPLICATE_SECONDS = 30;

// Did we just say exactly this to exactly this number?
//
// Keyed on the PHONE rather than the customer, like everything else in here -
// a message can go to a number with no customer row behind it.
async function alreadySaid(to, text) {
  try {
    const since = new Date(Date.now() - DUPLICATE_SECONDS * 1000).toISOString();

    const { data, error } = await db
      .from('messages')
      .select('id')
      .eq('phone', to)
      .eq('direction', 'OUTBOUND')
      .eq('body', text)
      .gt('created_at', since)
      .limit(1);

    if (error) throw error;
    return (data || []).length > 0;
  } catch (err) {
    console.error(`Could not check for a duplicate text to ${to}: ${err.message}`);
    return false;
  }
}

async function sendAndLog(
  to,
  body,
  customerId,
  { sentBy = null, kind = null, compliance = false, askedFor = null } = {}
) {
  let providerMessageId = null;

  // ---------------------------------------------------------------------
  // THE LAST GATE ON AN OPTED-OUT NUMBER, AND THE ONLY ONE THAT CATCHES
  // EVERYTHING.
  //
  // STOP was already refused at four separate doors - the website form, an
  // inbound conversation, the text blast's query, the Facebook lead sweep -
  // and missed at the one place every outbound text actually passes through.
  // So a status text, a pickup reminder, a price, a nudge, or an admin
  // cancelling somebody's order would all have gone to a number that had
  // said STOP. Every one of those is the violation the four doors exist to
  // prevent.
  //
  // It is one indexed lookup per message. That is a fair price for the rule
  // being enforced in one place instead of remembered in twenty.
  //
  // THE EXCEPTION IS COMPLIANCE ITSELF. The reply to STOP, START and HELP has
  // to reach somebody who has just opted out - it is the confirmation the law
  // expects and it is sent because THEY texted us. Only src/routes/sms.js
  // passes this, and only for those keywords.
  //
  // NOTHING IS WRITTEN TO `messages` when a send is refused. That table is the
  // record of what reached a phone, and a row there would show in the thread
  // as though we had texted them. The refusal goes to the server log instead.
  // ---------------------------------------------------------------------
  if (!compliance && (await hasOptedOut(to))) {
    console.warn(
      `REFUSED to text ${to}: they have opted out. Message was: ${toPlainText(body).slice(0, 120)}`
    );
    return { sent: false, refused: 'opted_out' };
  }

  // Swap typographic characters for their plain twins first, then warn about
  // anything genuinely un-plainable that is left (an emoji, say). Sending and
  // logging both use the cleaned text so the record matches the message.
  const text = toPlainText(body);
  warnIfExpensive(text);

  // ---------------------------------------------------------------------
  // THE SAME TEXT TWICE IN THIRTY SECONDS IS ONE TEXT.
  //
  // Neil's rule, 16 September, off Manpreet Singh's thread. He got the
  // one-time-vs-subscription question at 09:57:12 and again at 09:57:27, and
  // word-for-word identical "Our 12 to 2pm run is already out..." at 12:15:42
  // and 12:16:00. Two replies to one burst of messages, fifteen seconds apart,
  // saying the same thing.
  //
  // Every one of those is a billed segment and, worse, it reads as a machine
  // stuck in a loop at the exact moment the customer is already confused.
  //
  // COMPARED AFTER toPlainText(), so two spellings that reach the phone
  // identically are caught, and EXACTLY - "the earliest we can get to you is
  // between 10 and 12" and "...between 12 and 2" are different answers and both
  // must go.
  //
  // IT IS HERE BECAUSE EVERY TEXT PASSES THROUGH HERE. The same reasoning as
  // the opted-out gate above: one place, rather than remembered in twenty.
  //
  // IT FAILS OPEN. If the lookup breaks we send, because a duplicate is a
  // blemish and a missing message can strand somebody mid-booking.
  //
  // NOTHING IS WRITTEN TO `messages` when a send is refused, exactly as above:
  // that table is what reached a phone.
  if (await alreadySaid(to, text)) {
    console.warn(
      `REFUSED to text ${to}: identical message inside ${DUPLICATE_SECONDS}s. ` +
        `Was: ${text.slice(0, 120)}`
    );
    return { sent: false, refused: 'duplicate' };
  }

  // FICTIONAL NUMBERS NEVER REACH THE CARRIER. Logged, so the conversation
  // looks right on the screen, but not sent.
  if (isFictional(to)) {
    console.log(`[fictional] would have texted ${to}: ${text}`);
  } else try {
    const result = await sms.sendMessage({ to, text });
    providerMessageId = result && result.providerMessageId;
  } catch (err) {
    // Log the attempt anyway. A message we failed to send is exactly the kind
    // of thing worth being able to look up afterwards.
    console.error(`Failed to send SMS to ${to}:`, err.message);
  }

  const { error } = await db.from('messages').insert({
    customer_id: customerId || null,
    // Recorded even when there is no customer row, so a conversation with
    // someone who never signed up is still traceable to a number.
    phone: to,
    direction: 'OUTBOUND',
    body: text,
    provider_message_id: providerMessageId,
    sent_by: sentBy || null,
    // What kind of message this was. Null is honest for everything that has
    // not been classified - see migration 0065. Only 'AI' earns a follow-up.
    kind: kind || null,
    // WHICH INTAKE FIELD THIS ASKED FOR, and null for everything that asked for
    // nothing - which is almost every message. It is what lets the intake table
    // say "asked, awaiting reply" instead of inviting the same question again
    // an hour later. See src/core/intake.js and migration 0099.
    asked_for: askedFor || null,
  });

  if (error) console.error('Failed to log outbound message:', error.message);

  // WHAT ACTUALLY HAPPENED, FOR CALLERS THAT HAVE TO SAY SO.
  //
  // This returned nothing on the way out, so the only thing a caller could
  // learn was a refusal - and "the row was written" and "the carrier took it"
  // are different facts. An audit line reading "told them we are here" when the
  // provider threw is a record of something that did not happen.
  //
  // `sent` KEEPS ITS OLD MEANING, which is what makes this safe to add: it is
  // true whenever a messages row exists, false only for a refusal. card-chase
  // reads `sent === false` and payment-chase reads `.refused`, and neither
  // changes. What is new is providerMessageId, which is null when the carrier
  // would not take it - the same thing that distinguishes those two rows in the
  // table.
  return { sent: true, providerMessageId, text };
}

module.exports = {
  isFictional, sendAndLog, describeCost, toPlainText };
