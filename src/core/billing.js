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
    `You're authorizing ${site.legalName}${
      site.legalName === site.name ? '' : ` (${site.name})`
    } to save this card and charge it for ` +
    `each pickup you book. Nothing is taken today and nothing is taken when you book. ` +
    `Wash and fold is ${site.pricePerLb} a pound with a ${money(config.pricing.minimumCents)} minimum, ` +
    `and your card is charged once, when we deliver your laundry back. We weigh your bag ` +
    `after pickup and text you the weight and the total right away, so you always know ` +
    `the amount before it is taken. Cancel before we pick up and there is nothing to ` +
    `cancel: no money has moved. ` +
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

// WHAT A RETRY SAYS WHEN IT WORKS, and it is the only thing chargeOrder() ever
// texts anybody now.
//
// Neil's words, 12 September, on order #2060.
//
// IT DOES NOT RESTATE THE WEIGHT, and that is the whole point of rewriting it.
// The sentence here used to open "Your laundry weighed X lb, that's $Y at $2.00
// a pound" - written when the card was charged on the doorstep and this was the
// first the customer heard of either number. The charge moved to the laundromat
// weigh-in, which writes its own message, so this stopped being reached by
// anything except a manual retry and quietly went stale.
//
// On #2060 it would have gone out reading "Your laundry weighed 81.38 lb,
// that's $84.00 at $2.00 a pound": the wrong weight, because the customer was
// billed on the laundromat's 84 lb, and arithmetic that does not work, because
// 81.38 lb at $2.00 is $162.76 and the only thing making it $84.00 is a 50%
// promotion this sentence never mentioned.
//
// A retry is not a second announcement of the price. They were told the weight
// and the total at the weigh-in. The one new fact is that the money has moved.
// So this says that and nothing else, and having no figures in it besides the
// amount charged means it cannot contradict what they were already told.
function settledMessage(order, owedCents) {
  return `Good news, the ${money(owedCents)} for order #${order.order_number} has gone through. Thanks!`;
}

// HOW WE ASK SOMEBODY TO FIX A CARD, AND IT DEPENDS ON WHERE THEY CAME IN.
//
// Neil, 12 September, on order #2060: the customer placed the order on the
// website, saved a card on the website, and was then sent a text with a link
// asking him to update his card. His words: "we're switching between two
// platforms... this can just come off as spam."
//
// He is right, and it is worse than a feeling. An unsolicited text carrying a
// link that asks for card details is the exact shape of a phishing message. It
// teaches customers to tap payment links in texts, which is the habit we want
// them not to have; carriers score that pattern hard in 10DLC filtering; and a
// careful person ignores it, which may be exactly what happened here.
//
// So somebody who did their business on the website is sent back to the
// website. Not an opaque token they have to trust, but a page they have
// already used, which they can reach by typing the address themselves, and
// where signing in needs a code sent to their own phone - so intercepting the
// text gets nobody anything.
//
// THE LINK STAYS FOR EVERYONE ELSE, and that is not a hedge. Somebody who
// books by texting has a thread with us and no account they have ever signed
// into; for them a link in that thread IS the natural continuation, and being
// sent off to sign in somewhere is friction against a trust problem they do
// not have. Somebody who ordered over the phone has used neither, and a link
// is the shorter road.
//
// UNKNOWN FALLS BACK TO THE LINK, which is what every order did before this,
// so an order from before the column reads exactly as it always did.
//
// Same rule booking.DOORS already sets - which door an order came through
// decides how we talk about it - carried from the voice of a message to where
// it sends somebody.
// It returns the TAIL of a sentence rather than a whole one, so the caller can
// say what is actually wrong. "Your card was declined. Update it at
// lyndry.com/account" and "We don't have a card on file. Add one here: <link>"
// are the same destination reached from two different problems, and a helper
// that wrote the whole sentence would have to know which.
function cardDestination(order, setupUrl) {
  if (order && order.placed_via === 'WEB') {
    // No scheme and no token. A phone will probably still turn this into a
    // link, and that is fine: what matters is that it names a place they
    // recognise and can check, rather than characters only we can read.
    return `at ${site.domain}/account - sign in with this number.`;
  }

  return `here: ${setupUrl}`;
}

// Does this order's customer get a texted payment link at all. Asked before
// minting one, because a Stripe session and a payment_links row for somebody
// who is being pointed at their account is litter that expires in a day.
function wantsPaymentLink(order) {
  return !(order && order.placed_via === 'WEB');
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
// WHERE THEY LAND AFTERWARDS DEPENDS ON WHERE THEY STARTED. Somebody who
// followed a texted link has no session and belongs on the standalone "card
// saved" page; somebody who pressed a button inside their own account belongs
// back in their account. Both still record the card the same way.
//
// The placeholder is filled in here because the token does not exist until
// this function makes it, so a caller cannot build the URL itself.
async function createSetupLink(customer, { returnTo = '/pay/{token}/done' } = {}) {
  const stripeCustomerId = await ensureProviderCustomer(customer);
  const token = crypto.randomBytes(18).toString('base64url');

  const session = await payments.createSetupLink({
    stripeCustomerId,
    lyndryCustomerId: customer.id,
    // Where the provider sends them when they're done. Our own page, so we
    // control what they read after typing their card in.
    returnUrl: `${config.baseUrl}${returnTo.replace('{token}', token)}`,
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

// THE SAME THING WITHOUT THE HOSTED PAGE. Neil: "Don't make add a card its
// own page. That's why it feels like a surprise bill."
//
// createSetupLink() above mints a page of Stripe's and a lyndry.com link to
// send somebody to. This mints the ticket for a card field drawn INSIDE our
// own page. Everything else is identical - the same payment_links row, the
// same webhook, the same code that records the card and finishes the booking -
// because it is the same act.
//
// A ROW IS WRITTEN EITHER WAY, and it has to be: the webhook arrives knowing
// only Stripe's id, and this row is the only thing that turns that id back
// into a customer of ours.
async function createInlineCardSetup(customer) {
  const stripeCustomerId = await ensureProviderCustomer(customer);
  const token = crypto.randomBytes(18).toString('base64url');

  const intent = await payments.createSetupIntent({
    stripeCustomerId,
    lyndryCustomerId: customer.id,
  });

  const { error } = await db.from('payment_links').insert({
    token,
    customer_id: customer.id,
    stripe_setup_intent_id: intent.setupIntentId,
  });

  if (error) throw error;

  // The client secret is what the page needs and is safe to put in it: it
  // authorises attaching a card to this one intent and nothing else. It cannot
  // charge, read a card, or reach another customer.
  return { clientSecret: intent.clientSecret, token };
}

// The sentence texted to someone who needs to add a card before we can book.
// CHARGED AFTER WE WEIGH IT, NOT ON DELIVERY. This said "when we deliver it
// back", which was true while the charge point was the doorstep and has been
// false since it moved to the laundromat's scale. It is the sentence somebody
// reads while deciding whether to hand over a card, so when their money moves
// is the one fact in it that cannot be wrong. The same correction was made to
// the card sentence in src/core/actions.js: three doors, one promise.
async function setupLinkMessage(customer) {
  const { url } = await createSetupLink(customer);

  return (
    `Before your first pickup we need a card on file. It takes a minute and it's ` +
    `handled by our payment provider, we never see the number: ${url}\n\n` +
    `${site.pricePerLb} a pound, charged after we weigh it. Nothing recurring.`
  );
}

// ---------------------------------------------------------------------------
// ASKING SOMEBODY TO REPLACE A CARD THAT DOES NOT WORK.
//
// Neil, 13 September: "I should have a button in the order page - to send a
// text message link to update their payment method. or a text message link
// with instructions on how to update their payment method online."
//
// NOT setupLinkMessage(), WHICH IS A DIFFERENT CONVERSATION. That one opens
// "Before your first pickup we need a card on file" and goes to somebody who
// has never given us one. Sending it to a customer whose card was refused
// reads as though we have lost track of them, and it is the last thing to say
// to somebody already annoyed that a payment failed.
//
// IT NAMES THE ORDER AND THE AMOUNT, because the one question it has to answer
// before anything else is "what is this about". A text asking for card details
// that does not say what it is for is indistinguishable from a phishing message,
// which is the whole reason cardDestination() exists.
//
// AND IT SAYS NOTHING HAS BEEN TAKEN. That is the second question, and leaving
// it out turns a request into an accusation.
//
// BOTH ROUTES, AND THIS ONE MESSAGE IS THE EXCEPTION TO THE DOOR RULE.
//
// cardDestination() sends a web customer to their own account rather than
// handing them a link, because an unsolicited text carrying a payment link is
// the shape of a phishing message. That still governs every message the system
// sends ON ITS OWN - the weigh-in decline, the doorstep decline, the chase.
//
// This one is different in the way that matters: a person pressed a button,
// usually with the customer on the phone or a voicemail already left. Neil, 13
// September, after Shamar's phone went to voicemail: "give me the link to just
// update it in the text as well." He is right. Signing in with a texted code is
// real friction for somebody you are already chasing, and the message names the
// order, the amount and the reason, which is what makes it checkable. So it
// carries the tap-once link AND the address they can type themselves, and the
// cautious reader still has the safe route.
//
// IT SAYS WHY IT MATTERS WHEN THE LAUNDRY IS STILL OURS. Neil's rule, same day:
// "we just need the payment method updated before we make delivery." Saying so
// is the difference between a request and a mystery - and it is left OUT once
// the laundry is back with them, because by then it would be a threat about
// nothing.
function updateCardText({ orderNumber, priceCents, url, holding = false }) {
  const owed = Number(priceCents) > 0;

  const opening = owed
    ? `Order #${orderNumber} came to ${money(priceCents)} and the payment didn't go through, so nothing has been taken.`
    : `We need a new payment method for order #${orderNumber}. Nothing has been taken.`;

  // Asked for, never threatened. "We need a payment method before it can go
  // out" is a thing they can act on; "we are keeping your laundry" is a
  // standoff.
  //
  // IT SAYS PAYMENT METHOD, NOT CARD, and that is not only tidier wording.
  // Shamar never saved a card - he saved a Link wallet, which is why we hold no
  // brand and no last four for him - so "your card" names something he does not
  // have. The same is true of anybody paying by wallet.
  const why = holding
    ? ` We need a working payment method before your laundry can go out for delivery.`
    : '';

  const where = url
    ? ` Update it here: ${url} or at ${site.domain}/account.`
    : ` Update it at ${site.domain}/account - sign in with this number.`;

  return `${opening}${why}${where}`;
}

// The statuses where "before your laundry can go out for delivery" is a true
// sentence: we have it, and it has not set off back yet. Derived from
// IN_OUR_HANDS so a status added there is still considered here, and required
// lazily for the same reason the caller below did.
function holdingItBack(status) {
  const { IN_OUR_HANDS } = require('./orders');
  return IN_OUR_HANDS.includes(status) && status !== 'OUT_FOR_DELIVERY';
}

// The whole message, with a link minted only for the people who are being sent
// one. Async because that mint is a call to the payment provider.
async function updateCardMessage(order, customer) {
  // Always minted here, whichever door the order came through - see the note on
  // updateCardText() for why this message is the one exception.
  const { url } = await createSetupLink(customer);

  return updateCardText({
    orderNumber: order.order_number,
    priceCents: order.price_cents,
    url,
    // ONLY WHILE IT CAN STILL BE TRUE, WHICH IS NOT EVERY STATUS WE HOLD IT IN.
    // IN_OUR_HANDS counts OUT_FOR_DELIVERY, and on that one the sentence would
    // promise to withhold laundry that is already in the van on its way back -
    // both a contradiction and against the standing rule that a declined card
    // never holds up a delivery. Derived from IN_OUR_HANDS rather than typed
    // out, so a status added there is still considered here.
    holding: holdingItBack(order.status),
  });
}

// ---------------------------------------------------------------------------
// Recording that a card was saved
// ---------------------------------------------------------------------------

// Called by the provider's webhook, and again if the customer lands back on
// our page first. Writing the same thing twice is harmless; missing it is not,
// so both paths call this rather than trusting one of them to happen.
// TWO WAYS IN, ONE WAY THROUGH. A card saved on the hosted page and a card
// saved in our own page are the same card on the same account, so everything
// after this line - the record, the authorisation timestamp, killing the link,
// confirming the booking, the text - happens once, here, for both.
//
// The row says which it was: a hosted checkout leaves a session id, our own
// page leaves a setup intent id.
async function recordSavedCard(paymentLink) {
  const saved = paymentLink.stripe_setup_intent_id
    ? await payments.getSavedPaymentMethodFromSetup(paymentLink.stripe_setup_intent_id)
    : await payments.getSavedPaymentMethod(paymentLink.stripe_session_id);

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
  //
  // AND WHATEVER THE LEDGER SAYS HAS BEEN PAID, which is how a retry after
  // part-cash charges only the remainder. Without it, somebody who handed over
  // $70 in cash and then fixed their card would be charged the whole $84
  // again.
  const alreadyPaid =
    (order.deposit_refunded_at ? 0 : order.deposit_cents || 0) +
    Number(order.amount_paid_cents || 0);
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
    // ONLY WHEN A LINK IS ACTUALLY GOING TO BE SENT. A web customer is pointed
    // at their own account instead, so minting a session for them leaves a
    // Stripe object and a payment_links row that nobody will ever open and
    // that expires in a day. See cardDestination().
    const url = wantsPaymentLink(order) ? (await createSetupLink(customer)).url : null;
    await markFailed(order, 'No card on file.');

    return {
      ok: false,
      needsCard: true,
      setupUrl: url,
      // NOTHING IS SAID. See the declined branch below: a retry that does not
      // work is Neil's to handle, not the system's. `setupUrl` is still
      // returned because fulfilment.deliver() builds its own sentence from it.
      message: null,
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
        payment_decline_code: null,
        payment_attempts: (order.payment_attempts || 0) + 1,
      })
      .eq('id', order.id);

    // THE LEDGER GETS THE CARD SIDE TOO, or the split on the order page would
    // read Card $0 / Cash $15 on an order that was mostly paid by card. This
    // is the one line in the system where a card charge succeeds, so it is the
    // only honest place to write it.
    //
    // AFTER the order is marked paid, and best effort: the money has already
    // moved, so failing to write this row is a reporting problem and undoing
    // the charge over it would be a real one.
    await payments
      .recordCard(order, { amountCents: owed, paymentIntentId: result.paymentIntentId })
      .catch((err) => console.error(`Could not record the card payment: ${err.message}`));

    return {
      ok: true,
      chargedCents: owed,
      message: settledMessage(order, owed),
    };
  }

  // --- The card was refused ------------------------------------------------
  //
  // We deliver anyway and chase by text. Holding someone's clothes over a
  // declined card is a bad look and legally murky; the exposure is one order's
  // revenue. That was a deliberate business decision, not an oversight.

  await markFailed(order, result.reason, result.paymentIntentId, result.declineCode);

  // Same rule as the no-card branch above.
  const url = wantsPaymentLink(order) ? (await createSetupLink(customer)).url : null;

  return {
    ok: false,
    declined: true,
    setupUrl: url,
    // A RETRY THAT FAILS SAYS NOTHING TO THE CUSTOMER. Neil, 12 September:
    // "dont mention anything if it fails. If it fails, ill give him a call
    // tomorrow."
    //
    // He is right, and the reason is who is standing there. Every other charge
    // in this system happens with nobody watching - at the weigh-in, at the
    // door - so a decline has to reach the customer somehow or nobody finds
    // out. A retry is a person pressing a button because they already know
    // about the problem, usually with the customer on the phone. A text saying
    // "it failed again" arrives into a conversation that is already happening.
    //
    // The sentence that used to be here was worse than redundant: written for
    // the doorstep-charge era, it promised "We'll still deliver today" on a
    // retry that might be run two days after the delivery.
    //
    // THE AUTOMATIC PATHS ARE UNTOUCHED and still tell the customer everything.
    // fulfilment.settleWeight() and fulfilment.deliver() each write their own
    // wording from the `declined` and `setupUrl` flags rather than from this
    // message, which is exactly why this can go quiet without a decline ever
    // going unmentioned.
    message: null,
  };
}

// WRITE DOWN WHY, NOT JUST THAT.
//
// `reason` is Stripe's sentence for cardholders - safe to show a customer and
// often useless to us: order #2060's card was refused and the sentence stored
// was "The payment failed.", which is exactly what the issuer said and exactly
// nothing. `declineCode` is the machine answer behind it, which the provider
// has always read off the error and this has always discarded.
//
// It is evidence and a hint, never a rule. Nothing branches on it - an issuer's
// code is not a thing to build behaviour on - but it is the difference between
// a person knowing to tell somebody "there is no money in the account today"
// and knowing to tell them "this one cannot be charged unless you are there".
async function markFailed(order, reason, paymentIntentId, declineCode = null) {
  const { error } = await db
    .from('orders')
    .update({
      payment_status: 'FAILED',
      payment_failure_reason: reason ? String(reason).slice(0, 500) : null,
      payment_decline_code: declineCode ? String(declineCode).slice(0, 100) : null,
      stripe_payment_intent_id: paymentIntentId || order.stripe_payment_intent_id || null,
      payment_attempts: (order.payment_attempts || 0) + 1,
    })
    .eq('id', order.id);

  if (error) console.error('Could not record the failed payment:', error.message);

  // ENTERING PAYMENT HOLD RINGS THE OFFICE, IMMEDIATELY. Neil's lock, 14
  // September: no 24-hour clock, no waiting for a sweep to notice.
  //
  // This is the one line in the system where an order becomes FAILED, so it is
  // the only honest place to call it "the moment it entered hold" - the hold
  // itself is derived and therefore has no moment of its own.
  //
  // ONLY WHILE THE LAUNDRY IS OURS. A card refused at a doorstep is not a hold:
  // declinedAtTheDoor() leaves the bags on the step and uncollects the order, so
  // nothing is being held and nobody needs paging.
  //
  // issues.raise() already refuses to open a second issue for a customer who has
  // one open, so a retry that fails again does not raise a second.
  //
  // BEST EFFORT AND LAST. Recording the failure is the thing that must not fail;
  // paging about it is not allowed to throw away the record.
  const orders = require('./orders');
const payments = require('./payments');
  if (orders.IN_OUR_HANDS.includes(order.status)) {
    const issues = require('./issues');
    const customer = order.customers || (order.customer_id ? { id: order.customer_id } : null);
    if (customer) {
      await issues
        .raise({
          customer,
          order,
          reason:
            `Payment hold: ${money(order.price_cents)} outstanding on #${order.order_number} and we are ` +
            `holding the laundry. It will not go out for delivery until the balance is nothing. ` +
            `Ring them.`,
        })
        .catch((err) => console.error(`Could not raise the payment hold issue: ${err.message}`));
    }
  }
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
  cardDestination,
  wantsPaymentLink,
  settledMessage,
  consentText,
  createSetupLink,
  createInlineCardSetup,
  setupLinkMessage,
  updateCardText,
  holdingItBack,
  updateCardMessage,
  recordSavedCard,
  chargeOrder,
  retryOutstanding,
  money,
};
