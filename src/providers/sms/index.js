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

function chooseDriver() {
  const configured = Boolean(config.telnyx.apiKey && config.telnyx.publicKey);

  if (configured) return telnyx;

  // The fake driver accepts unsigned webhooks. That is fine on a laptop and
  // catastrophic on a public server, so refuse to start rather than run
  // insecurely by accident.
  if (config.env === 'production') {
    throw new Error(
      'No SMS provider configured. Set TELNYX_API_KEY and TELNYX_PUBLIC_KEY. ' +
        'The fake driver skips signature checks and must never run in production.'
    );
  }

  return fake;
}

const driver = chooseDriver();

module.exports = {
  name: driver.name,
  isFake: driver.name === 'fake',
  verifySignature: driver.verifySignature,
  parseInbound: driver.parseInbound,
  sendMessage: driver.sendMessage,
};
