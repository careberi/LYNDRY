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

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.telnyx.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Telnyx refused the message (HTTP ${response.status}): ${detail}`);
  }

  const result = await response.json();
  return { providerMessageId: result.data && result.data.id };
}

module.exports = {
  name: 'telnyx',
  verifySignature,
  parseInbound,
  parseDeliveryReceipt,
  sendMessage,
};
