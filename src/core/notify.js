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

async function sendAndLog(to, body, customerId) {
  let providerMessageId = null;

  // Swap typographic characters for their plain twins first, then warn about
  // anything genuinely un-plainable that is left (an emoji, say). Sending and
  // logging both use the cleaned text so the record matches the message.
  const text = toPlainText(body);
  warnIfExpensive(text);

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
  });

  if (error) console.error('Failed to log outbound message:', error.message);
}

module.exports = {
  isFictional, sendAndLog, describeCost, toPlainText };
