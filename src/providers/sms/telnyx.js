'use strict';

const crypto = require('crypto');
const { config } = require('../../config');

// ---------------------------------------------------------------------------
// Telnyx driver.
//
// This is the ONLY file in the codebase that knows Telnyx exists. Everything
// else talks to the interface in ./index.js. Replacing Telnyx means writing
// one new file like this one and changing a single line there.
// ---------------------------------------------------------------------------

const API_URL = 'https://api.telnyx.com/v2/messages';

// ---------------------------------------------------------------------------
// A SEND IS TRIED THREE TIMES WHEN TELNYX IS THE ONE FAILING.
//
// 23 September, 9:22am: Telnyx had an incident - "Elevated API timeouts and 500
// errors affecting messaging endpoints", on their own status page - and every
// text we sent came back HTTP 504 from the Cloudflare page in front of
// api.telnyx.com. We tried each one ONCE and gave up. So for over an hour no
// customer text and no sign-in code reached a phone, and Neil was locked out of
// his own dashboard with a pickup due, while the API was answering other
// requests in a tenth of a second. The outage was intermittent; our give-up was
// not.
//
// WHAT IS RETRIED IS WHAT MIGHT SUCCEED A SECOND LATER:
//
//   5xx          their server, or the gateway in front of it, failed. Nothing
//                about our message was wrong
//   429          we were rate limited. Waiting is the whole instruction
//   no answer    a network error or our own timeout below
//
// EVERY OTHER 4xx IS FINAL, AND THAT LINE IS LOAD-BEARING. A 4xx is Telnyx
// telling us THIS message cannot go - a malformed number, a handset that has
// opted out at the carrier, a campaign rule. Sending it again changes nothing
// and, for the opted-out case, sending it again is the one thing we must not
// do.
//
// WHAT IT COSTS: A POSSIBLE DUPLICATE. A 504 means the gateway stopped waiting,
// not that Telnyx did nothing - it may have accepted the text and failed to say
// so, and the retry then sends a second copy. For a sign-in code that is
// harmless, since it is the same code. For a customer it is an occasional
// repeated text, set against the alternative this replaced, which was the text
// silently never arriving at all. notify.alreadySaid() still refuses a second
// identical send from anywhere else inside thirty seconds; this is the one door
// that can repeat, and only when Telnyx itself did not answer.
//
// BOUNDED, SO A HARD OUTAGE STILL ENDS. At most three tries, each abandoned
// after twelve seconds, with a pause between - about 40 seconds in the worst
// case, after which the caller gets the error exactly as before. That matters
// for the staff sign-in: when every try fails, the code still goes to the
// server log, just later.
// ---------------------------------------------------------------------------
const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 12_000;
const BACKOFF_MS = [1_000, 3_000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const retryable = (status) => status >= 500 || status === 429;

// ONE LINE, NOT A WEB PAGE. Telnyx's 504 arrives as Cloudflare's whole error
// page - two hundred lines of HTML - and it went into the server log verbatim.
// The one line anybody needed from that log, "Sign-in code for Neil Perry:
// 493606", was buried in the middle of it and split across entries by the log
// viewer. An HTML body is reduced to its <title>, which is where Cloudflare
// names the error; anything else is trimmed to a single line.
function summarise(body) {
  const text = String(body || '');
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  const line = (title ? title[1] : text).replace(/\s+/g, ' ').trim();
  return line.length > 200 ? `${line.slice(0, 200)}...` : line || '(no body)';
}

// A webhook older than this is rejected. Without a limit, someone who captured
// a valid request once could replay it forever.
const MAX_WEBHOOK_AGE_SECONDS = 300;

// ---------------------------------------------------------------------------
// Signature verification
//
// Telnyx signs every webhook so we can prove it really came from them and not
// from someone who found our URL. Without this check, anyone could pretend to
// be any customer and place orders in their name.
//
// The signature is Ed25519 over the exact bytes "timestamp|body". It has to be
// the RAW body — re-serialising the parsed JSON produces different bytes and
// the signature will not match.
// ---------------------------------------------------------------------------

let cachedKey = null;

// Telnyx gives us a bare 32-byte Ed25519 public key, base64 encoded. Node
// wants it wrapped in the standard DER envelope, so we prepend the fixed
// 12-byte header that identifies it as Ed25519.
function publicKey() {
  if (cachedKey) return cachedKey;

  const raw = Buffer.from(config.telnyx.publicKey, 'base64');
  if (raw.length !== 32) {
    throw new Error(
      `TELNYX_PUBLIC_KEY does not look like an Ed25519 key (got ${raw.length} bytes, expected 32). ` +
        'Copy it from the Telnyx portal under API Keys -> Public Key.'
    );
  }

  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
  cachedKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  return cachedKey;
}

function verifySignature({ rawBody, headers }) {
  const signature = headers['telnyx-signature-ed25519'];
  const timestamp = headers['telnyx-timestamp'];

  if (!signature || !timestamp || !rawBody) return false;

  // Reject anything too old to be a genuine live webhook.
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > MAX_WEBHOOK_AGE_SECONDS) return false;

  try {
    const signed = Buffer.concat([Buffer.from(`${timestamp}|`), Buffer.from(rawBody)]);
    return crypto.verify(null, signed, publicKey(), Buffer.from(signature, 'base64'));
  } catch (err) {
    console.error('Telnyx signature check failed:', err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reading an inbound message
//
// Telnyx posts several kinds of event to the same URL. We only care about a
// received message; delivery receipts and everything else return null and are
// quietly ignored.
// ---------------------------------------------------------------------------

function parseInbound(body) {
  const event = body && body.data;
  if (!event || event.event_type !== 'message.received') return null;

  const payload = event.payload || {};

  return {
    providerMessageId: payload.id,
    from: payload.from && payload.from.phone_number,
    to: Array.isArray(payload.to) && payload.to[0] ? payload.to[0].phone_number : null,
    text: (payload.text || '').trim(),
  };
}

// ---------------------------------------------------------------------------
// Reading a delivery receipt
//
// Telnyx accepting a message only means it was queued. What the receiving
// carrier did with it arrives later, as a separate webhook to the same URL.
// This is where blocked or filtered traffic actually shows up — an accepted
// message that never reaches a phone looks fine until you read one of these.
// ---------------------------------------------------------------------------

function parseDeliveryReceipt(body) {
  const event = body && body.data;
  if (!event) return null;
  if (!['message.sent', 'message.finalized'].includes(event.event_type)) return null;

  const payload = event.payload || {};
  const recipient = Array.isArray(payload.to) ? payload.to[0] : null;

  // Errors can arrive at either level depending on where the failure happened.
  const errors = [...(payload.errors || []), ...((recipient && recipient.errors) || [])];

  const reason = errors
    .map((e) => [e.code, e.title, e.detail].filter(Boolean).join(' — '))
    .join('; ');

  return {
    providerMessageId: payload.id,
    status: (recipient && recipient.status) || null,
    error: reason || null,
  };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

// `from` is optional. Left off, everything sends from the main LYNDRY number,
// which is what a two-way conversation needs. Passed in, it overrides the
// sender for that one message — that is how sign-in codes can come from a
// short code or a second number while the conversation stays where it is.
async function sendMessage({ to, text, from }) {
  const sender = from || config.telnyx.phoneNumber;

  const body = {
    to,
    text,
    // Prefer the messaging profile if we have one — it is what carrier
    // registration is attached to. Otherwise send from the number directly.
    ...(config.telnyx.messagingProfileId
      ? { messaging_profile_id: config.telnyx.messagingProfileId, from: sender }
      : { from: sender }),
  };

  let lastError = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    let response;

    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.telnyx.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        // Our own limit, so a gateway that simply hangs cannot hold a reply -
        // or a sign-in code - open for minutes.
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = new Error(
        `Telnyx did not answer (try ${attempt} of ${ATTEMPTS}): ${err.message}`
      );
      if (attempt < ATTEMPTS) {
        console.warn(`${lastError.message} - trying again.`);
        await sleep(BACKOFF_MS[attempt - 1]);
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      const result = await response.json();
      if (attempt > 1) console.log(`Telnyx accepted a text to ${to} on try ${attempt}.`);
      return { providerMessageId: result.data && result.data.id };
    }

    const detail = summarise(await response.text());
    lastError = new Error(
      `Telnyx refused the message (HTTP ${response.status}, try ${attempt} of ${ATTEMPTS}): ${detail}`
    );

    if (!retryable(response.status) || attempt === ATTEMPTS) throw lastError;

    console.warn(`${lastError.message} - trying again.`);
    await sleep(BACKOFF_MS[attempt - 1]);
  }

  throw lastError;
}

module.exports = {
  name: 'telnyx',
  // Exposed for the tests, which pin what is retried and what is final.
  summarise,
  retryable,
  ATTEMPTS,
  verifySignature,
  parseInbound,
  parseDeliveryReceipt,
  sendMessage,
};
