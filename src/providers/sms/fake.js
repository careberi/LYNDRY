'use strict';

// ---------------------------------------------------------------------------
// Fake SMS driver.
//
// Used automatically when Telnyx credentials are missing, so the whole system
// can be built and tested long before carrier registration is approved.
//
// It accepts any webhook without checking a signature and prints outbound
// messages to the terminal instead of sending them. That is obviously unsafe,
// which is why ./index.js refuses to load this driver in production.
// ---------------------------------------------------------------------------

let counter = 0;

function verifySignature() {
  return true;
}

// Mirrors the shape of a real Telnyx inbound webhook so the simulator and the
// real thing travel through identical code.
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

// Same shape as the real one, so delivery-receipt handling can be tested
// without waiting for a carrier.
function parseDeliveryReceipt(body) {
  const event = body && body.data;
  if (!event) return null;
  if (!['message.sent', 'message.finalized'].includes(event.event_type)) return null;

  const payload = event.payload || {};
  const recipient = Array.isArray(payload.to) ? payload.to[0] : null;
  const errors = [...(payload.errors || []), ...((recipient && recipient.errors) || [])];

  return {
    providerMessageId: payload.id,
    status: (recipient && recipient.status) || null,
    error: errors.map((e) => [e.code, e.title, e.detail].filter(Boolean).join(' — ')).join('; ') || null,
  };
}

async function sendMessage({ to, text }) {
  counter += 1;

  console.log('');
  console.log('  ┌─ TEXT TO ' + to);
  for (const line of text.split('\n')) {
    console.log('  │  ' + line);
  }
  console.log('  └─ (not really sent — no Telnyx credentials configured)');
  console.log('');

  return { providerMessageId: `fake-out-${Date.now()}-${counter}` };
}

module.exports = {
  name: 'fake',
  verifySignature,
  parseInbound,
  parseDeliveryReceipt,
  sendMessage,
};
