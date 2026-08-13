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
    // The trading name in brackets only when it differs from the legal one.
    // No legal entity has been formed yet, so both are "LYNDRY" today and
    // "LYNDRY (LYNDRY)" on a payment page reads like a bug.
    `You're authorising ${site.legalName}${
      site.legalName === site.name ? '' : ` (${site.name})`
    } to save this card and charge it for ` +
    `each pickup you book. Nothing is taken today and nothing is taken when you book. ` +
    `Wash and fold is ${site.pricePerLb} a pound with a ${money(config.pricing.minimumCents)} minimum, ` +
    `and your card is charged once, after we weigh your bag - that is the first moment the ` +
    `amount exists. We text you the weight and the total every time. Cancel before we ` +
    `collect and there is nothing to cancel: no money has moved. ` +
    // A standing order takes the minimum on a repeating basis, so the old
    // "no recurring charge" was about to become false. It is not a
    // subscription - there is no fee for having one and every pickup is still
    // priced by weight - but a repeating charge has to be disclosed on the
    // page the customer authorises it from, because that page is what card
    // networks read in a dispute.
    `If you set up a repeating pickup, this covers those too: we text you the day ` +
    `before each one and you can skip or stop any time. There is no subscription ` +
    `and no fee for having a schedule. Reply STOP any time.`
  );
}

// --- Does this customer have a usable card? --------------------------------

function hasPaymentMethod(customer) {
  return Boolean(customer.stripe_customer_id && customer.default_payment_method_id);
}

// Whether a booking should stop and ask for a card before it is confirmed.
//
// Separate from hasPaymentMethod because of the case where Stripe is switched
// off entirely, which is how this ran for months before the keys existed. With
// no payment provider there is no card to ask for and no charge to make, so a
// booking is confirmed on the spot rather than waiting forever for a link that
// would never work.
function needsCardOnFile(customer) {
  if (!payments.isConfigured) return false;
  return !hasPaymentMethod(customer);
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
// The deposit that no longer exists
// ---------------------------------------------------------------------------
//
// There was briefly a $25 minimum taken at booking, with the balance collected
// on delivery. Two charges per order, two things to reconcile, two things to
// refund, and a customer who saw money leave before anybody had touched their
// laundry.
//
// It is gone. A card is saved at booking and charged exactly once, at the
// scale, for the whole amount. The minimum survives as a FLOOR ON THE PRICE,
// not as a payment: an 8 lb load still costs $25, it is simply billed in one
// go with everything else.
//
// The deposit_* columns and refundDeposit stay because two real orders were
// taken under the old rules and their money has to be refundable. Nothing
// writes a new deposit; if you find yourself adding one back, the thing to
// change is when chargeOrder runs, not how many times it runs.

// Give back a minimum taken under the old rules. Only ever fires on those
// orders - a booking made today has nothing to refund, because nothing moved.
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
  // On any order booked today this is the whole price: nothing was taken at
  // booking. The subtraction is here for the handful of orders taken while a
  // minimum was collected up front, which would otherwise be billed twice.
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
        `We'll have it back to you the ${site.turnaround}.`,
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
      setupUrl: url,
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
      chargedCents: owed,
      message:
        `Your laundry weighed ${order.weight_lb} lb, that's ${money(order.price_cents)} at ` +
        `${site.pricePerLb} a pound, charged to your ${describeCard(customer)}. ` +
        `Back with you the ${site.turnaround}.`,
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
    setupUrl: url,
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
  refundDeposit,
  hasPaymentMethod,
  needsCardOnFile,
  describeCard,
  consentText,
  createSetupLink,
  setupLinkMessage,
  recordSavedCard,
  chargeOrder,
  retryOutstanding,
  money,
};
