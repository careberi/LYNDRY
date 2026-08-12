'use strict';

const Stripe = require('stripe');
const { config } = require('../../config');

// ---------------------------------------------------------------------------
// The Stripe driver.
//
// This is the only file in the codebase that imports the Stripe library or
// knows what a PaymentIntent is. Everything above it talks in LYNDRY's own
// words — "save a card", "charge this order".
//
// The two Stripe ideas worth understanding, once:
//
//   Checkout Session (mode: 'setup')
//     A page hosted by Stripe where the customer types their card. We never
//     see the number; Stripe hands us back a reference to it afterwards. In
//     "setup" mode it saves the card without charging anything.
//
//   PaymentIntent (off_session: true)
//     A charge made when the customer is not sitting in front of a browser.
//     That is exactly our case: we weigh the bag hours after they texted, and
//     charge the card they already authorised.
// ---------------------------------------------------------------------------

const stripe = Stripe(config.stripe.secretKey, {
  // Pin the API version. Stripe evolves theirs, and a silent change to how a
  // response is shaped is not something we want arriving on its own schedule.
  apiVersion: '2025-10-29.clover',

  // Named in the Stripe dashboard's logs, so a support conversation with them
  // can start from "which of your systems made this call".
  appInfo: { name: 'LYNDRY', version: '0.1.0' },

  // Stripe's own retry, for network blips only. It uses idempotency keys
  // internally, so a retried charge cannot become two charges.
  maxNetworkRetries: 2,
});

// ---------------------------------------------------------------------------

// Creates the Stripe-side record of a person, or returns the one we already
// made. The phone number goes on it so a Stripe dashboard search matches how
// we think about customers.
async function createCustomer({ name, email, phone, lyndryCustomerId }) {
  const customer = await stripe.customers.create({
    name: name || undefined,
    email: email || undefined,
    phone: phone || undefined,
    // Our own id, carried on Stripe's record. Makes a webhook traceable back
    // to a row here without a lookup table.
    metadata: { lyndry_customer_id: lyndryCustomerId },
  });

  return { id: customer.id };
}

// A Stripe-hosted page that saves a card without charging it.
//
// The consent sentence is the important part of this function. Stripe requires
// the customer to have agreed, in writing, that we may charge the saved card
// later while they are not present. Ours has to say the amount is set after
// weighing, because with per-pound pricing nobody knows it at this moment.
async function createSetupLink({ stripeCustomerId, lyndryCustomerId, returnUrl, consentText }) {
  const session = await stripe.checkout.sessions.create({
    // "setup" saves a card without taking any money. Leaving this out would
    // charge them on the spot, which is not what this link is for.
    mode: 'setup',
    customer: stripeCustomerId,
    currency: 'usd',

    // Deliberately not listing payment_method_types: left off, Stripe offers
    // whatever suits the customer's device — cards always, plus Apple Pay or
    // Google Pay where they are set up.

    setup_intent_data: {
      metadata: { lyndry_customer_id: lyndryCustomerId },
    },

    success_url: returnUrl,
    cancel_url: returnUrl,

    custom_text: {
      after_submit: { message: consentText },
    },

    // Stripe expires it after 24 hours regardless; being explicit means the
    // expiry we store matches the one Stripe enforces.
    expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  });

  return {
    sessionId: session.id,
    url: session.url,
    expiresAt: new Date(session.expires_at * 1000).toISOString(),
  };
}

// After the customer finishes the page, this reads back which card they saved.
async function getSavedPaymentMethod(sessionId) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['setup_intent'],
  });

  const setupIntent = session.setup_intent;
  const paymentMethodId =
    setupIntent && (typeof setupIntent === 'string' ? null : setupIntent.payment_method);

  if (!paymentMethodId) return null;

  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
  const card = paymentMethod.card || {};

  // Make this the card we charge from now on, so we never have to remember
  // which of several a customer meant.
  await stripe.customers.update(session.customer, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  return {
    paymentMethodId,
    // Display only — "Visa", "4242". Not enough to charge anything.
    brand: card.brand || null,
    last4: card.last4 || null,
  };
}

// Charge a saved card while the customer is nowhere near a browser.
//
// `idempotencyKey` is the safety catch: send the same key twice and Stripe
// returns the first result instead of charging again. A driver double-tapping
// the weight button cannot bill someone twice.
async function chargeOffSession({
  stripeCustomerId,
  paymentMethodId,
  amountCents,
  description,
  idempotencyKey,
  metadata,
}) {
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethodId,

        // "The customer is not here." Together these tell Stripe to charge
        // immediately rather than waiting for someone to press a button, and
        // to use the mandate the customer agreed to when they saved the card.
        off_session: true,
        confirm: true,

        description,
        metadata: metadata || {},
      },
      { idempotencyKey }
    );

    return { ok: true, paymentIntentId: intent.id, status: intent.status };
  } catch (err) {
    // A declined card arrives here as an exception, not as a return value.
    // It is an ordinary business outcome, not a broken system, so it gets
    // turned back into a plain result the caller can act on.
    const declineCode = err.decline_code || (err.raw && err.raw.decline_code) || null;

    return {
      ok: false,
      paymentIntentId: (err.raw && err.raw.payment_intent && err.raw.payment_intent.id) || null,
      // Stripe writes these for cardholders, so they are safe to show.
      reason: err.message || 'The card was declined.',
      declineCode,
      // True when the card needs the customer to approve it in their banking
      // app. Nothing we can do from here — they have to open a link.
      needsCustomerAction: err.code === 'authentication_required',
    };
  }
}

// Confirms a webhook really came from Stripe rather than from someone who
// found the URL. Same principle as the Telnyx signature check: an unsigned
// "payment succeeded" would otherwise be anyone's to send.
function verifyWebhook({ rawBody, signature }) {
  return stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
}

// Give money back.
//
// Used when a pickup is cancelled before the driver has collected, which the
// website promises is free. Note that the processing fee on the original
// charge is NOT returned by Stripe, so every refund costs us a little over a
// dollar. That is a known cost of keeping the promise, not a bug.
//
// Returns the same plain shape as chargeOffSession rather than throwing, so a
// failed refund never blocks the cancellation the customer asked for.
async function refund({ paymentIntentId, amountCents, idempotencyKey }) {
  try {
    const created = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        // Omitted means the whole thing, which is what we want when the
        // amount is not given.
        ...(amountCents ? { amount: amountCents } : {}),
      },
      { idempotencyKey }
    );

    return { ok: true, refundId: created.id, status: created.status };
  } catch (err) {
    return { ok: false, refundId: null, reason: err.message || 'The refund failed.' };
  }
}

module.exports = {
  name: 'stripe',
  createCustomer,
  createSetupLink,
  getSavedPaymentMethod,
  chargeOffSession,
  refund,
  verifyWebhook,
};
