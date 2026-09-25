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

// ---------------------------------------------------------------------------
// A REAL CARRIER KEY ONLY EVER SENDS FROM PRODUCTION.
//
// 25 September. The laptop's .env held a real Telnyx API key, and the ONLY
// thing stopping it texting real customers was that TELNYX_PUBLIC_KEY happened
// to be blank, because the test below needs both. That public key verifies
// INBOUND webhooks - so it is precisely the value somebody adds in order to
// test the /sms webhook properly, and adding it would have turned a laptop into
// a live sender aimed at the production customer list. A safety property held
// up by an accident is not one.
//
// SO THE TWO HALVES ARE SEPARATED. Outside production, real keys still verify
// and parse, because that is the half a developer genuinely needs and it cannot
// reach anybody. They do not send. The text is printed instead, exactly as the
// fake driver prints it, and the line says why rather than claiming there are
// no credentials - which would send the reader looking for a missing key.
// ---------------------------------------------------------------------------
const grounded = {
  name: 'telnyx-grounded',
  verifySignature: telnyx.verifySignature,
  parseInbound: telnyx.parseInbound,
  parseDeliveryReceipt: telnyx.parseDeliveryReceipt,
  sendMessage: async ({ to, text, from }) => {
    console.log('');
    console.log('  ┌─ TEXT TO ' + to + (from ? `  (from ${from})` : ''));
    for (const line of String(text == null ? '' : text).split('\n')) console.log('  │  ' + line);
    console.log('  └─ NOT SENT: Telnyx keys are present but this is not production.');
    console.log('');
    return { providerMessageId: `grounded-out-${Date.now()}` };
  },
};

// WHICH ONE, as a rule with nothing behind it.
//
// Pure and exported so a test can hold every square of it without setting
// environment variables and re-requiring this file. The thing being protected
// is "a laptop never texts a customer", and that deserves better than being
// four ifs nobody can reach.
function pick({ configured, production }) {
  if (configured) return production ? 'telnyx' : 'telnyx-grounded';
  // The fake driver accepts unsigned webhooks. Harmless on a laptop, and on a
  // public server it would let anyone impersonate a customer. So in production
  // we fall back to refusing all SMS rather than to trusting everything.
  return production ? 'disabled' : 'fake';
}

const DRIVERS = { telnyx, 'telnyx-grounded': grounded, disabled, fake };

function chooseDriver() {
  const configured = Boolean(config.telnyx.apiKey && config.telnyx.publicKey);
  const production = config.env === 'production';
  const name = pick({ configured, production });

  if (name === 'telnyx-grounded') {
    console.warn(
      'Telnyx keys are set but this is not production: texts will be PRINTED, not sent. ' +
        'Inbound webhook signatures are still checked for real.'
    );
  }

  if (name === 'disabled') {
    console.warn(
      'SMS is DISABLED: TELNYX_API_KEY and/or TELNYX_PUBLIC_KEY are not set. ' +
        'The website works; inbound texts will be rejected until both are configured.'
    );
  }

  return DRIVERS[name];
}

const driver = chooseDriver();

module.exports = {
  name: driver.name,
  // "Nothing this sends reaches a real phone." True of the fake driver, of the
  // grounded one above, and of the refusing one - everything except Telnyx
  // itself. Asked as "is it Telnyx" so a driver added later is assumed live
  // until it says otherwise, which is the safe direction for a question whose
  // wrong answer is a text somebody did not expect.
  isFake: driver !== telnyx,
  // Exposed for the test that pins which driver each situation gets.
  pick,
  verifySignature: driver.verifySignature,
  parseInbound: driver.parseInbound,
  parseDeliveryReceipt: driver.parseDeliveryReceipt || (() => null),
  sendMessage: driver.sendMessage,
};
