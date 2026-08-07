'use strict';

const { config } = require('../../config');

// ---------------------------------------------------------------------------
// The SMS provider interface.
//
// Nothing outside this folder knows which company actually delivers our text
// messages. Everything else imports this file and calls these three functions:
//
//   verifySignature({ rawBody, headers })  is this webhook genuinely from them?
//   parseInbound(body)                     turn their webhook into our shape
//   sendMessage({ to, text })              send a text
//
// Swapping provider means writing one new file alongside telnyx.js and
// changing the line below. That is the entire point of this arrangement.
// ---------------------------------------------------------------------------

const telnyx = require('./telnyx');
const fake = require('./fake');

// Used in production when Telnyx isn't configured yet. It refuses every
// webhook and refuses to send, but it lets the server boot — so the website
// can go live for carrier review before messaging credentials exist.
const disabled = {
  name: 'disabled',
  verifySignature: () => false,
  parseInbound: () => null,
  parseDeliveryReceipt: () => null,
  sendMessage: async () => {
    throw new Error('SMS is not configured: TELNYX_API_KEY and TELNYX_PUBLIC_KEY are missing.');
  },
};

function chooseDriver() {
  if (config.telnyx.apiKey && config.telnyx.publicKey) return telnyx;

  // The fake driver accepts unsigned webhooks. Harmless on a laptop, and on a
  // public server it would let anyone impersonate a customer. So in production
  // we fall back to refusing all SMS rather than to trusting everything.
  if (config.env === 'production') {
    console.warn(
      'SMS is DISABLED: TELNYX_API_KEY and/or TELNYX_PUBLIC_KEY are not set. ' +
        'The website works; inbound texts will be rejected until both are configured.'
    );
    return disabled;
  }

  return fake;
}

const driver = chooseDriver();

module.exports = {
  name: driver.name,
  isFake: driver.name === 'fake',
  verifySignature: driver.verifySignature,
  parseInbound: driver.parseInbound,
  parseDeliveryReceipt: driver.parseDeliveryReceipt || (() => null),
  sendMessage: driver.sendMessage,
};
