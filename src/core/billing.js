'use strict';

const crypto = require('crypto');

const db = require('../db');
const payments = require('../providers/payments');
const { config } = require('../config');
const { site } = require('../web/site');

// ---------------------------------------------------------------------------
// Money.
//
// Everything that decides WHEN a card is charged lives here. The provider
// folder knows how to charge; this file knows whether we should.
//
// Two rules the whole file exists to hold:
//
//   1. Claude never decides anything in here. The AI works out that someone
//      wants a pickup; code works out whether they have a card and whether to
//      charge it. No amount of clever texting can move a charge, in the same
//      way that no amount of clever texting can open a locker.
//
//   2. A charge is attempted exactly once per order unless a person asks for a
//      retry. The idempotency key is built from the order id and the amount,
//      so a driver tapping the weight button twice cannot bill twice.
// ---------------------------------------------------------------------------

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// What the customer agrees to on the Stripe page.
//
// This wording is doing legal work, so read it before changing it. It has to
// cover a charge whose amount is not known at the moment of agreement —
// wash and fold is priced by weight, so the figure does not exist until the
// bag is on the scale. "Each order you confirm by text" is what ties an
// individual charge back to a specific YES in the message log.
function consentText() {
  return (
    `You're authorising ${site.legalName} (LYNDRY) to save this card and charge it for ` +
    `each pickup you book. We take a ${money(config.pricing.minimumCents)} minimum when you book. ` +
    `Wash and fold is ${site.pricePerLb} a pound, so once we weigh your bag we charge the ` +
    `difference if it comes to more. If it comes to less, the ${money(config.pricing.minimumCents)} ` +
    `minimum is the price and nothing is refunded. We text you the weight and the total every ` +
    `time. Cancel before we collect and the minimum comes back. No subscription and no ` +
    `recurring charge. Reply STOP any time.`
  );
}

// --- Does this customer have a usable card? --------------------------------

function hasPaymentMethod(customer) {
  return Boolean(customer.stripe_customer_id && customer.default_payment_method_id);
}

// How the saved card is described in a text message. "Visa ending 4242".
function describeCard(customer) {
  if (!hasPaymentMethod(customer)) return null;

  const brand = customer.card_brand
    ? customer.card_brand.charAt(0).toUpperCase() + customer.card_brand.slice(1)
    : 'card';

  return customer.card_last4 ? `${brand} ending ${customer.card_last4}` : brand;
}

// ---------------------------------------------------------------------------
// The setup link
// ---------------------------------------------------------------------------

// Makes sure the customer exists at the payment provider, and remembers their
// id so we only ever create one.
async function ensureProviderCustomer(customer) {
  if (customer.stripe_customer_id) return customer.stripe_customer_id;

  const created = await payments.createCustomer({
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    lyndryCustomerId: customer.id,
  });

  const { error } = await db
    .from('customers')
    .update({ stripe_customer_id: created.id })
    .eq('id', customer.id);

  if (error) throw error;

  customer.stripe_customer_id = created.id;
  return created.id;
}

// Builds the link we actually text: lyndry.com/pay/<token>.
//
// The token is 24 random bytes. Nothing but its unguessability protects the
// page, because there is no login here — so it must not be short, sequential,
// or derived from anything about the customer.
async function createSetupLink(customer) {
  const stripeCustomerId = await ensureProviderCustomer(customer);
  const token = crypto.randomBytes(18).toString('base64url');

  const session = await payments.createSetupLink({
    stripeCustomerId,
    lyndryCustomerId: customer.id,
    // Where the provider sends them when they're done. Our own page, so we
    // control what they read after typing their card in.
    returnUrl: `${config.baseUrl}/pay/${token}/done`,
    consentText: consentText(),
  });

  const { error } = await db.from('payment_links').insert({
    token,
    customer_id: customer.id,
    stripe_session_id: session.sessionId,
    url: session.url,
    expires_at: session.expiresAt,
  });

  if (error) throw error;

  return {
    // What we text: our own domain.
    url: `${config.baseUrl}/pay/${token}`,
    token,
    // Where that link forwards to. Only the redirect route uses this.
    providerUrl: session.url,
  };
}

// The sentence texted to someone who needs to add a card before we can book.
async function setupLinkMessage(customer) {
  const { url } = await createSetupLink(customer);

  return (
    `Before your first pickup we need a card on file. It takes a minute and it's ` +
    `handled by our payment provider, we never see the number: ${url}\n\n` +
    `${site.pricePerLb} a pound, charged after we weigh your bag. Nothing recurring.`
  );
}

// ---------------------------------------------------------------------------
// Recording that a card was saved
// ---------------------------------------------------------------------------

// Called by the provider's webhook, and again if the customer lands back on
// our page first. Writing the same thing twice is harmless; missing it is not,
// so both paths call this rather than trusting one of them to happen.
async function recordSavedCard(paymentLink) {
  const saved = await payments.getSavedPaymentMethod(paymentLink.stripe_session_id);
  if (!saved) return null;

  const { data: customer, error } = await db
    .from('customers')
    .update({
      default_payment_method_id: saved.paymentMethodId,
      card_brand: saved.brand,
      card_last4: saved.last4,
      // The moment they agreed we may charge this card later. Our record if
      // anyone ever asks whether the charge was authorised.
      payment_authorised_at: new Date().toISOString(),
    })
    .eq('id', paymentLink.customer_id)
    .select('*')
    .single();

  if (error) throw error;

  // A used link stops working, so a forwarded text cannot let someone else put
  // a card on this account.
  await db
    .from('payment_links')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', paymentLink.id);

  return customer;
}

// ---------------------------------------------------------------------------
// Charging an order
// ---------------------------------------------------------------------------

// Charges the saved card for an order that has been weighed and priced.
//
// Returns { ok, message } — the message is what to text the customer, written
// here rather than by the AI so the figure in it is always the real one from
// the database.
// ---------------------------------------------------------------------------
// The minimum, taken at booking
// ---------------------------------------------------------------------------
//
// Until this cleared, nothing had been paid for anything. Now a pickup is not
// confirmed until it has: deposit_paid_at is what keeps an unpaid booking off
// the driver's run sheet.
//
// Returns { ok, order, message } where message is what the customer should be
// told, or null when there is nothing to say.

async function chargeDeposit(order, customer) {
  if (order.deposit_paid_at) return { ok: true, order, message: null };

  // Payments switched off entirely, which is how this runs before Stripe keys
  // are set. The booking still stands; there is simply nothing to collect.
  if (!payments.isConfigured) {
    return { ok: true, order, message: null, skipped: 'payments off' };
  }

  if (!hasPaymentMethod(customer)) {
    return { ok: false, needsCard: true, order, message: null };
  }

  const amount = config.pricing.minimumCents;

  const result = await payments.chargeOffSession({
    stripeCustomerId: customer.stripe_customer_id,
    paymentMethodId: customer.default_payment_method_id,
    amountCents: amount,
    description: `${site.name} order #${order.order_number} minimum`,
    // The attempt number is in here for the same reason it is on the final
    // charge: the provider caches the result of a key, including a decline,
    // so a fixed key would replay "declined" at somebody who has since fixed
    // their card.
    idempotencyKey: `deposit-${order.id}-${amount}-${order.deposit_intent_id ? 'retry' : 'first'}`,
    metadata: { lyndry_order_id: order.id, lyndry_kind: 'deposit' },
  });

  if (!result.ok) {
    return {
      ok: false,
      declined: true,
      order,
      message:
        `That card was declined, so the pickup isn't booked yet. ` +
        `Try another one here and it'll go straight through: ${(await createSetupLink(customer)).url}`,
    };
  }

  const { data: updated, error } = await db
    .from('orders')
    .update({
      deposit_cents: amount,
      deposit_paid_at: new Date().toISOString(),
      deposit_intent_id: result.paymentIntentId || null,
    })
    .eq('id', order.id)
    .select('*')
    .single();

  if (error) throw error;

  return { ok: true, order: updated, message: null };
}

// Give the minimum back. Cancelling is free until the driver collects, and
// that promise is already on the website and in the AI's replies.
async function refundDeposit(order) {
  if (!order.deposit_paid_at || order.deposit_refunded_at) return { ok: true, refunded: false };
  if (!payments.isConfigured || !order.deposit_intent_id) return { ok: true, refunded: false };

  const result = await payments.refund({
    paymentIntentId: order.deposit_intent_id,
    amountCents: order.deposit_cents,
    idempotencyKey: `refund-${order.id}`,
  });

  if (!result.ok) {
    // Do not block the cancellation on this. The customer asked to cancel and
    // is entitled to; a refund that failed is our problem to chase, and it is
    // visible on the order because deposit_refunded_at stays null.
    console.error(`Could not refund the minimum on order ${order.order_number}: ${result.reason}`);
    return { ok: false, refunded: false, reason: result.reason };
  }

  await db
    .from('orders')
    .update({ deposit_refunded_at: new Date().toISOString() })
    .eq('id', order.id);

  return { ok: true, refunded: true, amountCents: order.deposit_cents };
}

async function chargeOrder(order, customer) {
  if (order.payment_status === 'PAID') {
    return { ok: true, alreadyPaid: true, message: null };
  }

  if (order.payment_status === 'WAIVED') {
    return { ok: true, waived: true, message: null };
  }

  if (!order.price_cents) {
    return { ok: false, message: null, reason: 'The order has no price yet.' };
  }

  // What is actually still owed.
  //
  // The minimum was taken at booking, so only the difference is charged now.
  // A light load whose real total is below the minimum owes nothing further:
  // the minimum IS the price, and no money comes back.
  const alreadyPaid = order.deposit_refunded_at ? 0 : order.deposit_cents || 0;
  const owed = Math.max(0, order.price_cents - alreadyPaid);

  if (owed === 0) {
    const { data: settled } = await db
      .from('orders')
      .update({ payment_status: 'PAID', paid_at: new Date().toISOString() })
      .eq('id', order.id)
      .select('*')
      .maybeSingle();

    // Below the minimum, so the $25 already taken covers it. Say what they
    // paid, not what the weight would have come to, or it reads like a
    // mistake.
    return {
      ok: true,
      order: settled || order,
      coveredByMinimum: true,
      message:
        `Your laundry weighed ${order.weight_lb} lb. That's under our ` +
        `${money(config.pricing.minimumCents)} minimum, so it's ` +
        `${money(alreadyPaid)} and nothing more to pay. ` +
        `We'll have it back to you within ${site.turnaround}.`,
    };
  }

  // Payments switched off entirely, which is how the service runs before
  // Stripe keys are set. Weighing must still work and the customer must still
  // be told what it came to; the money is simply not collected yet.
  //
  // Without this, recording a weight throws "Payments are not configured"
  // deep inside the setup-link code and the driver gets a 500 at the one
  // moment they most need the screen to work.
  if (!payments.isConfigured) {
    return { ok: false, message: null, reason: 'Payments are not switched on.' };
  }

  if (!hasPaymentMethod(customer)) {
    const { url } = await createSetupLink(customer);
    await markFailed(order, 'No card on file.');

    return {
      ok: false,
      needsCard: true,
      message:
        `Your laundry weighed ${order.weight_lb} lb, so that's ${money(order.price_cents)}. ` +
        `We don't have a card on file. Add one here and we'll settle it: ${url}`,
    };
  }

  const result = await payments.chargeOffSession({
    stripeCustomerId: customer.stripe_customer_id,
    paymentMethodId: customer.default_payment_method_id,
    amountCents: owed,
    description: `LYNDRY wash & fold — ${order.weight_lb} lb`,
    // Same order, same amount, same attempt number, same key — so two clicks
    // of the weight button produce one charge, not two.
    //
    // The attempt number has to be in there. Stripe caches the *result* of a
    // key, including a decline. Without it, a customer who fixed their card
    // would get the old "declined" answer replayed at them forever.
    idempotencyKey: `order_${order.id}_${owed}_${order.payment_attempts || 0}`,
    metadata: { lyndry_order_id: order.id, lyndry_customer_id: customer.id },
  });

  if (result.ok) {
    await db
      .from('orders')
      .update({
        payment_status: 'PAID',
        stripe_payment_intent_id: result.paymentIntentId,
        paid_at: new Date().toISOString(),
        payment_failure_reason: null,
        payment_attempts: (order.payment_attempts || 0) + 1,
      })
      .eq('id', order.id);

    return {
      ok: true,
      message:
        `Your laundry weighed ${order.weight_lb} lb, that's ${money(order.price_cents)} at ` +
        `${site.pricePerLb} a pound, charged to your ${describeCard(customer)}. ` +
        `Back with you within ${site.turnaround}.`,
    };
  }

  // --- The card was refused ------------------------------------------------
  //
  // We deliver anyway and chase by text. Holding someone's clothes over a
  // declined card is a bad look and legally murky; the exposure is one order's
  // revenue. That was a deliberate business decision, not an oversight.

  const card = describeCard(customer);
  await markFailed(order, result.reason, result.paymentIntentId);

  const { url } = await createSetupLink(customer);

  return {
    ok: false,
    declined: true,
    message:
      `Your laundry weighed ${order.weight_lb} lb, that's ${money(order.price_cents)}. ` +
      `Your ${card} was declined, so nothing has been taken. ` +
      `We'll still deliver today. Update your card here and we'll settle it: ${url}`,
  };
}

async function markFailed(order, reason, paymentIntentId) {
  const { error } = await db
    .from('orders')
    .update({
      payment_status: 'FAILED',
      payment_failure_reason: reason ? String(reason).slice(0, 500) : null,
      stripe_payment_intent_id: paymentIntentId || order.stripe_payment_intent_id || null,
      payment_attempts: (order.payment_attempts || 0) + 1,
    })
    .eq('id', order.id);

  if (error) console.error('Could not record the failed payment:', error.message);
}

// Retries every unpaid order for a customer who has just fixed their card.
// Called from the webhook, so settling up needs nothing from the customer
// beyond typing a new card number.
async function retryOutstanding(customer) {
  const { data: unpaid, error } = await db
    .from('orders')
    .select('*')
    .eq('customer_id', customer.id)
    .eq('payment_status', 'FAILED')
    .not('price_cents', 'is', null);

  if (error) throw error;

  const settled = [];

  for (const order of unpaid || []) {
    const result = await chargeOrder(order, customer);
    if (result.ok && !result.alreadyPaid) settled.push({ order, result });
  }

  return settled;
}

module.exports = {
  chargeDeposit,
  refundDeposit,
  hasPaymentMethod,
  describeCard,
  consentText,
  createSetupLink,
  setupLinkMessage,
  recordSavedCard,
  chargeOrder,
  retryOutstanding,
  money,
};
