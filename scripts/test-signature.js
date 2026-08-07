'use strict';

// ---------------------------------------------------------------------------
// Proves that webhook signature checking actually works.
//
//   npm run test:signature
//
// Why this exists: signature verification is the only thing stopping a
// stranger who finds our /sms URL from impersonating a customer. In normal
// development we run without Telnyx credentials, so that code never executes
// and a mistake in it would sit there unnoticed until launch day.
//
// This script makes its own Ed25519 key pair, signs a message the same way
// Telnyx does, and checks that a good signature is accepted and every kind of
// bad one is refused.
// ---------------------------------------------------------------------------

const crypto = require('crypto');

// Generate a key pair and hand the public half to the config before anything
// reads it, so the Telnyx driver verifies against a key we control.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

// Telnyx publishes a bare 32-byte key in base64. Strip the DER envelope to get
// the same shape they would give us.
const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
process.env.TELNYX_PUBLIC_KEY = rawPublic.toString('base64');
process.env.TELNYX_API_KEY = 'test-key-not-used-for-signing';

const telnyx = require('../src/providers/sms/telnyx');

const body = JSON.stringify({
  data: { event_type: 'message.received', payload: { id: 'msg-1', text: 'laundry tomorrow' } },
});

function sign(timestamp, payload) {
  return crypto
    .sign(null, Buffer.concat([Buffer.from(`${timestamp}|`), Buffer.from(payload)]), privateKey)
    .toString('base64');
}

const now = Math.floor(Date.now() / 1000);

const checks = [
  {
    name: 'a genuine, correctly signed webhook is accepted',
    expected: true,
    headers: { 'telnyx-timestamp': String(now), 'telnyx-signature-ed25519': sign(now, body) },
    rawBody: body,
  },
  {
    name: 'a tampered body is rejected',
    expected: false,
    headers: { 'telnyx-timestamp': String(now), 'telnyx-signature-ed25519': sign(now, body) },
    rawBody: body.replace('laundry tomorrow', 'open my locker'),
  },
  {
    name: 'a signature from a different key is rejected',
    expected: false,
    headers: {
      'telnyx-timestamp': String(now),
      'telnyx-signature-ed25519': crypto
        .sign(
          null,
          Buffer.concat([Buffer.from(`${now}|`), Buffer.from(body)]),
          crypto.generateKeyPairSync('ed25519').privateKey
        )
        .toString('base64'),
    },
    rawBody: body,
  },
  {
    name: 'a missing signature is rejected',
    expected: false,
    headers: { 'telnyx-timestamp': String(now) },
    rawBody: body,
  },
  {
    name: 'an old webhook is rejected, so a captured one cannot be replayed',
    expected: false,
    headers: {
      'telnyx-timestamp': String(now - 3600),
      'telnyx-signature-ed25519': sign(now - 3600, body),
    },
    rawBody: body,
  },
  {
    name: 'a reused signature with a fresh timestamp is rejected',
    expected: false,
    headers: { 'telnyx-timestamp': String(now + 5), 'telnyx-signature-ed25519': sign(now, body) },
    rawBody: body,
  },
];

console.log('');
console.log('  Webhook signature verification');
console.log('  ' + '-'.repeat(62));

let failures = 0;

for (const check of checks) {
  const actual = telnyx.verifySignature({
    rawBody: Buffer.from(check.rawBody),
    headers: check.headers,
  });

  const passed = actual === check.expected;
  if (!passed) failures += 1;

  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${check.name}`);
  if (!passed) console.log(`        expected ${check.expected}, got ${actual}`);
}

console.log('  ' + '-'.repeat(62));

if (failures > 0) {
  console.log(`  ${failures} check(s) FAILED. Do not deploy this.`);
  console.log('');
  process.exit(1);
}

console.log('  All checks passed.');
console.log('');
