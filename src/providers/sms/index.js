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
// DEFAULT: A REAL CARRIER KEY ONLY SENDS FROM PRODUCTION.
// The explicit hosted-development exception is defined below.
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
  sendMessage: async ({ to, text, from, mediaPath }) => {
    if(mediaPath)console.log("  [SIMULATED delivery photo attachment]");
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
// is "nothing texts a customer unless it IS the business", and that deserves
// better than being four ifs nobody can reach.
//
// `realData` IS THE THIRD QUESTION, AND IT IS NOT `production`. The deployed
// development site runs with NODE_ENV=production on purpose, so that it behaves
// like production - which means an environment check alone would have let it
// send real texts the moment somebody pasted carrier keys into it to "test
// properly". There is nobody real in the development database to text, so the
// honest test is whose rows these are.
function pick({ configured, production, realData, development = false }) {
  // Preserve production and local behavior. The opted-in development service
  // uses the same carrier through a wrapper that labels every message.
  if (configured) {
    if (production && realData) return 'telnyx';
    if (production && development) return 'telnyx-development';
    return 'telnyx-grounded';
  }

  // The fake driver accepts unsigned webhooks. Harmless where the data is
  // invented, and on the real public server it would let anybody impersonate a
  // customer - so that one case refuses all SMS rather than trusting anything.
  if (production && realData) return 'disabled';

  return 'fake';
}

// A development database alone must never authorize a real send. Neil opted
// in to this hosted site on 2 October. Recipient selection stays with callers.
function developmentAllowed({ enabled, railway, production, projectRef, baseUrl }) {
  return Boolean(enabled && railway && production &&
    projectRef === 'psrphpgbiifvnlrgvbdg' &&
    baseUrl === 'https://lyndry-production-de2c.up.railway.app');
}

function developmentText(text) {
  const body = String(text == null ? '' : text);
  return body.startsWith('DEVELOPMENT\n') ? body : `DEVELOPMENT\n${body}`;
}

function createDevelopmentDriver(carrier, sender, baseUrl) {
  return {
    ...carrier,
    name: 'telnyx-development',
    prepareText: developmentText,
    sendMessage: async (args) => {
      return carrier.sendMessage({ ...args, text: developmentText(args.text), from: sender,
        // Only delivery receipts change destination. Incoming replies still
        // use the live number's existing messaging profile and webhook.
        ...(baseUrl ? { webhookUrl: `${baseUrl}/sms` } : {}),
      });
    },
  };
}

const development = createDevelopmentDriver(telnyx, config.telnyx.phoneNumber, config.baseUrl);
const DRIVERS = { telnyx, 'telnyx-development': development, 'telnyx-grounded': grounded, disabled, fake };

function chooseDriver() {
  const configured = Boolean(config.telnyx.apiKey && config.telnyx.publicKey);
  const production = config.env === 'production';
  const name = pick({ configured, production, realData: config.supabase.isProduction,
    development: developmentAllowed({ enabled: config.telnyx.developmentEnabled,
      railway: config.telnyx.railway, production, projectRef: config.supabase.projectRef,
      baseUrl: config.baseUrl }),
  });

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
  // Both carrier-backed drivers reach real phones, including development.
  // Media attachments and send results must not label those sends simulated.
  isFake: driver !== telnyx && driver !== development,
  // Exposed for the test that pins which driver each situation gets.
  pick,
  developmentAllowed,
  createDevelopmentDriver,
  prepareText: driver.prepareText || ((text) => text),
  verifySignature: driver.verifySignature,
  parseInbound: driver.parseInbound,
  parseDeliveryReceipt: driver.parseDeliveryReceipt || (() => null),
  sendMessage: driver.sendMessage,
};
