'use strict';

const { config } = require('../../config');

// ---------------------------------------------------------------------------
// The payments provider interface.
//
// Nothing outside this folder knows that Stripe is who holds the cards.
// Everything else imports this file and calls these five functions:
//
//   createCustomer({...})            make their record at the card vault
//   createSetupLink({...})           a hosted page where they add a card
//   getSavedPaymentMethod(sessionId) read back which card they saved
//   chargeOffSession({...})          charge a saved card, customer not present
//   verifyWebhook({...})             is this webhook genuinely from them?
//
// Swapping provider means writing one new file alongside stripe.js and
// changing the line below — the same arrangement as src/providers/sms/.
// ---------------------------------------------------------------------------

// Note the driver is required inside chooseDriver(), not up here. The Stripe
// library builds its client the moment the file loads and throws if there is
// no key — which would stop the server booting on a fresh checkout. The whole
// point of the disabled driver below is that it doesn't.

// Used before Stripe credentials exist, and in tests.
//
// It refuses everything rather than pretending, because the failure mode of a
// payments driver that silently succeeds is an order marked paid that nobody
// ever charged for. A loud refusal is the safe direction.
const disabled = {
  name: 'disabled',
  isConfigured: false,

  createCustomer: async () => {
    throw new Error('Payments are not configured: STRIPE_SECRET_KEY is missing.');
  },
  createSetupLink: async () => {
    throw new Error('Payments are not configured: STRIPE_SECRET_KEY is missing.');
  },
  getSavedPaymentMethod: async () => {
    throw new Error('Payments are not configured: STRIPE_SECRET_KEY is missing.');
  },
  chargeOffSession: async () => ({
    ok: false,
    reason: 'Payments are not configured.',
    declineCode: null,
    needsCustomerAction: false,
    paymentIntentId: null,
  }),
  refund: async () => ({
    ok: false,
    refundId: null,
    reason: 'Payments are not configured.',
  }),
  verifyWebhook: () => {
    throw new Error('Payments are not configured: STRIPE_WEBHOOK_SECRET is missing.');
  },
};

function chooseDriver() {
  if (!config.stripe.secretKey) {
    if (config.env === 'production') {
      console.warn(
        'PAYMENTS ARE DISABLED: STRIPE_SECRET_KEY is not set. Orders can still be ' +
          'booked and delivered; nothing will be charged.'
      );
    }
    return disabled;
  }

  return require('./stripe');
}

const driver = chooseDriver();

// Which mode the keys put us in. Worth surfacing on /health: "why did no money
// arrive" is usually answered by "the test key is still in Railway".
const isLive = config.stripe.secretKey.startsWith('sk_live_');

module.exports = {
  name: driver.name,
  isConfigured: driver !== disabled,
  mode: driver === disabled ? 'off' : isLive ? 'live' : 'test',

  createCustomer: driver.createCustomer,
  createSetupLink: driver.createSetupLink,
  getSavedPaymentMethod: driver.getSavedPaymentMethod,
  chargeOffSession: driver.chargeOffSession,
  verifyWebhook: driver.verifyWebhook,
};
