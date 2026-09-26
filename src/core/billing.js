'use strict';

const crypto = require('crypto');

const db = require('../db');
const payments = require('../providers/payments');

// THE LEDGER IS NOT THE PROVIDER, AND ONE NAME FOR BOTH COST US ORDER #2068.
//
// `payments` above is Stripe: it moves money and knows nothing about our rows.
// This one writes the `payments` TABLE. Both were called `payments` here - the
// provider at the top of the file, the ledger in a require() buried inside
// markFailed() - so every `payments.recordCard(...)` in this file was reaching
// for a function the Stripe provider does not have.
//
// That throws a TypeError SYNCHRONOUSLY, before the promise the `.catch()`
// beside it is attached to ever exists, so the "best effort" catch on every one
// of those calls never ran. The throw escaped settleTotal() and loadVan()
// read it as a refusal - on an order whose card had just paid in full. See
// settleFromHold() and fulfilment.declinedAtTheDoor().
const ledger = require('./payments');

const { config } = require('../config');
// The two rates the card page names. No loop: subscription.js requires only
// config.
const subscription = require('./subscription');
// What to hold, when the delivery costs more than the floor. No loop either:
// quote.js requires config and nothing else.
const quote = require('./quote');
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
  // REWRITTEN 21 SEPTEMBER, and three sentences in it were wrong. Neil: "Update
  // the card page. Charge after we weigh at the door. Subscription is $1.80/lb.
  // Do not say there is no subscription." It said the card was charged "when we
  // deliver your laundry back" - the charge moved to the doorstep on 12
  // September - and "There is no subscription", which stopped being true the
  // day subscriptions were sold at their own rate.
  //
  // THE $25 HOLD IS IN IT, and was not before. It is authorised on this card,
  // it shows as pending, and if the card will not take the rest of a total at
  // the door the $25 is kept for the trip. A charge somebody never agreed to is
  // a chargeback, and this page is what a card network reads in a dispute.
  //
  // TWO CHARGES WHEN THE TOTAL IS OVER THE HOLD, AND IT SAYS SO. The first
  // rewrite said "charge the card then, once" and "the hold becomes part of
  // that charge"; settleTotal() captures the $25 and charges the rest as a
  // second payment, so an $84.00 wash is two lines on a statement. A page a
  // card network reads in a dispute has to describe the statement.
  //
  // "Saving this card charges nothing", not "nothing is charged today": a
  // same-day pickup is charged today, at the door.
  //
  // Every figure is read, never typed: the two rates from subscription.js, the
  // minimum and the hold from config. Stripe caps this text at 1200 characters,
  // and a test holds it under that.
  const hold = money(showUpCents());
  return (
    // The trading name in brackets only when it differs from the legal one.
    `You're authorizing ${site.legalName}${
      site.legalName === site.name ? '' : ` (${site.name})`
    } to save this card and charge it for each pickup you book. Saving this card charges nothing. ` +
    `A one-time pickup is ${subscription.oneTimeRate()} and a subscription is ` +
    `${subscription.subscriptionRate()}, with a ${money(config.pricing.minimumCents)} minimum per pickup. ` +
    `We weigh your laundry at your door and charge the total then, before it leaves with us, ` +
    `and text you the weight and the total. Before a pickup we may hold ${hold} on the card to ` +
    `confirm it. At the door the ${hold} hold is taken first and anything over it is charged to ` +
    `the same card at the same time. If the card will not take the rest, we keep the ${hold} ` +
    `for the trip and leave your laundry where we found it. ` +
    `If you set up a subscription, this covers those pickups too: we text you the day before ` +
    `each one, and you can skip or stop any time. Cancel a pickup before we collect it and ` +
    `nothing is charged. Reply STOP any time.`
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
    // A comma, not a dash: no dashes in anything a customer reads.
    return `at ${site.domain}/account, and sign in with this number.`;
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

// CAN THIS SERVER TAKE MONEY AT ALL.
//
// A different question from needsCardOnFile(), and the distinction is the
// whole of audit finding #7. That one asks about a CUSTOMER and answers false
// with no Stripe key, deliberately, so a sandbox does not empty the round.
// This asks about the SERVER, so a caller that cares about the difference can
// see it rather than inferring it from a false.
//
// Nothing outside src/providers/payments knows what Stripe is, which is why
// this lives here rather than callers reading the provider directly.
function paymentsConfigured() {
  return Boolean(payments.isConfigured);
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
    // "Nothing recurring." came off 21 September: it read as "there is no
    // subscription", which Neil ruled out. The charge point is the door, and
    // both rates are named - the same prices on every channel, and a customer
    // who booked every 2 weeks is not quoted a rate they will not pay.
    `${subscription.oneTimeRate()} one-time, or ${subscription.subscriptionRate()} on a subscription, ` +
    `charged after we weigh it at your door.`
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
    : ` Update it at ${site.domain}/account, and sign in with this number.`;

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
    await ledger
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
  // THIS USED TO SAY "we deliver anyway and chase by text", AND IT IS THE
  // OPPOSITE OF THE RULE NOW. Neil reversed it on 14 September, on #2060 -
  // collected, weighed, charged $84.00, refused, and sitting washed at a
  // laundromat while nothing in the system would have stopped it being driven
  // to his door.
  //
  // The old sentence was written when the charge happened AT delivery, so
  // "deliver and chase" was the only option that did not strand somebody on a
  // doorstep. The charge moved to the door on 12 September, which is what
  // changed the argument: a customer whose card fails at their own step keeps
  // their bags and nothing has left the property. The only laundry that can
  // reach this line is laundry we took in good faith and then could not bill
  // for.
  //
  // SO: an in-hand decline is a PAYMENT HOLD. markFailed() below raises it and
  // rings the office, dispatch.paymentHold() keeps the bag out of the
  // customer's doorway, and the sibling block parks their other pickups.
  // Retrieval off a laundromat is still allowed; delivery is not.
  //
  // A DOORSTEP DECLINE IS STILL NOT A HOLD, and the difference is custody.
  // fulfilment.declinedAtTheDoor() leaves the bags where it found them and
  // puts the pickup back to tomorrow - we are not holding anything, so there
  // is nothing to hold up. Do not merge the two paths.

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
// WHAT THE OFFICE IS TOLD IS OWED, AND IT IS THE REMAINDER.
//
// This quoted order.price_cents, which is what the wash cost and not what is
// left to collect. Take $70 in cash against an $84 bill and the page still
// read "$84.00 outstanding" - so somebody rings a customer who has already
// paid most of it and asks for all of it again. The ledger had the right
// number the whole time.
//
// dispatch.balance() is the one owner of "what is still owed", and it is
// required INSIDE the function on purpose: dispatch requires this file at the
// top, so a top-level require here would close the cycle. The row is handed in
// as FAILED because that is the state it is being written into - balance()
// answers 0 for anything else, and at the moment this is called the update may
// not have landed yet.
function paymentHoldReason(order) {
  const dispatch = require('./dispatch');
  const owed = dispatch.balance({ ...order, payment_status: 'FAILED' });

  return (
    `Payment hold: ${money(owed)} outstanding on #${order.order_number} and we are ` +
    `holding the laundry. It will not go out for delivery until the balance is nothing. ` +
    `Ring them.`
  );
}

// THE ONES THAT WERE ALREADY FAILED WHEN THE RULE ARRIVED.
//
// markFailed() is the only line where an order BECOMES failed, which makes it
// the only honest place to call "the moment it entered hold" - and it is why
// every order that was already sitting there when the hold shipped has never
// been paged about. #2060 is the real one: failed on 12 September, the hold
// rule landed on the 14th, and the office was never told.
//
// SO THE BOARD SWEEPS THEM, once per draw, over the rows it has already got in
// its hand. Not a migration and not a backfill script: an order can enter this
// state at any time through a path that never calls markFailed - a cash
// payment that does not cover the bill, a row edited by hand - and a sweep on
// the screen that draws the red card cannot go stale.
//
// ensurePaymentHold() is what makes this safe to call every time: it pages
// once, writes the sentence once, and does nothing at all on every draw after
// that. Best effort throughout; drawing the board must never fail because the
// issue ledger did.
async function ensureExistingHolds(held = []) {
  const issues = require('./issues');

  for (const order of held || []) {
    const customer = order.customers || (order.customer_id ? { id: order.customer_id } : null);
    if (!customer) continue;

    await issues
      .ensurePaymentHold({ customer, order, reason: paymentHoldReason(order) })
      .catch((err) =>
        console.error(`Could not name the payment hold on #${order.order_number}: ${err.message}`)
      );
  }
}

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

  if (orders.IN_OUR_HANDS.includes(order.status)) {
    const issues = require('./issues');
    const customer = order.customers || (order.customer_id ? { id: order.customer_id } : null);
    if (customer) {
      await issues
        .ensurePaymentHold({ customer, order, reason: paymentHoldReason(order) })
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

// ---------------------------------------------------------------------------
// THE $25 SHOW-UP HOLD.
//
// Neil, 14 September: the card must accept a $25 hold before a pickup is
// confirmed, and at the door we charge the real total against it.
//
//   total is $25 or less   capture that much and no more; Stripe lets the rest
//                          of the hold go
//   total is more          capture the $25, charge the remainder on the same
//                          card
//   the remainder refused  KEEP the $25, leave the bags, wash nothing
//
// WHAT THE $25 BUYS IS THE TRIP, not credit towards a wash. A van leaving with
// a driver in it costs the same whether or not a bag ends up in it, and the
// last of those three outcomes is the one where that distinction is the entire
// point: the bags stay on the step, the pickup is rebooked, and tomorrow's wash
// is priced in full. payments.recordShowUp() is what enforces that.
//
// IT IS NOT THE PAYMENT HOLD, and the two never meet. That one is a state an
// order is IN - we are holding somebody's laundry and a charge failed - and is
// derived, never stored. This is a real authorization at Stripe with an id on
// the order, and it only exists before anything has been collected. A doorstep
// refusal leaves the bags where they were found, so there is no laundry to
// hold, no Payment Hold, and nothing for the cash button to recover.
// ---------------------------------------------------------------------------

// What we hold. Deliberately not config.pricing.minimumCents, which is the
// floor on what a wash COSTS - see the note beside it in config.js.
function showUpCents() {
  return Math.max(0, Math.round(config.pricing.authorizationCents || 0));
}

// ---------------------------------------------------------------------------
// WHAT TO HOLD ON THIS PARTICULAR ORDER.
//
// Neil, 25 September: "the hold shouls be at least the amount of the delivery."
// Under the van the trip cost us a driver's time and the flat $25 floor covered
// it. Under a courier the driving is a real invoice from somebody else, two legs
// of it, and on a long pair of legs it can be more than the floor - so a $25
// hold on an order whose delivery alone costs $31 holds less than the one thing
// we are certain to be out of pocket for.
//
// IT IS DECIDED HERE AND NOT AT THE CALL SITES, and that polarity is the whole
// reason this function exists. FOUR things place a hold - bookPickup(), the card
// being saved, the night-before pass and the admin retry button - and asking each
// to work the amount out would make "somebody forgot" the failure, silently, in
// the direction of holding too little. CLAUDE.md records exactly that shape
// costing four orders with `bookedByTheSystem`. The default has to be right.
//
// `amountCents` on authorizeShowUp() survives as a deliberate override for a
// caller that genuinely knows better. Nothing passes it today.
function holdFor(order) {
  return quote.holdCents({ deliveryFeeCents: order && order.delivery_fee_cents });
}

// A LIVE hold on this order, or null. Live means still sitting at Stripe
// uncaptured: the id is cleared the moment it is taken or let go, so "is there
// money held against this pickup" is one null check rather than a date
// comparison nobody would get right twice.
function showUpHold(order) {
  if (!order || !order.authorization_intent_id) return null;
  return {
    intentId: order.authorization_intent_id,
    cents: Math.max(0, Number(order.authorized_cents || 0)),
  };
}

// DID THE CARD CONFIRM THIS PICKUP? Three answers, and the third is the one
// that makes the other two safe:
//
//   HELD      the card accepted the hold. Still HELD after the money is taken,
//             because what this answers is whether the pickup was confirmed,
//             not whether money is still sitting there
//   REFUSED   we asked and the card said no
//   UNASKED   nobody asked. Payments switched off, a free order, or any of the
//             orders taken before this existed
//
// UNASKED IS NOT A PROBLEM AND MUST NEVER BECOME ONE. Every order on the board
// this morning is UNASKED, so a gate that read "no hold" as "not confirmed"
// would empty tomorrow's round - the same failure the card gate avoided by
// answering false wherever Stripe is switched off.
function showUpState(order) {
  if (!order) return 'UNASKED';
  // A REFUSAL IS ASKED FIRST because it is always the later fact. An order can
  // hold, be taken to a door, be refused the balance and go back on tomorrow's
  // board - and what matters then is the no, not the yes that came before it.
  // authorizeShowUp() clears the refusal when a fresh hold lands, so a fixed
  // card reads HELD again.
  if (order.authorization_refused_at) return 'REFUSED';
  if (order.authorization_intent_id || order.authorized_at) return 'HELD';
  return 'UNASKED';
}

// IS THE HOLD STILL GOING TO BE THERE AT THE DOOR?
//
// Stripe expires an uncaptured authorization on its own - usually at seven
// days, sometimes sooner - so a hold is not a thing that lasts until somebody
// uses it. An order with no hold at all is not fresh either, which is what
// makes this the single question the night-before pass asks.
//
// It is deliberately about the CLOCK and not about Stripe. Asking Stripe
// whether each of tomorrow's holds is still alive is a network call per order
// on a pass that has to finish inside an evening, and the answer would still be
// stale by morning. A date we hold ourselves is checkable, testable and cannot
// fail open.
function holdIsFresh(order, { days = null, now = null } = {}) {
  const hold = showUpHold(order);
  if (!hold || !order.authorized_at) return false;

  const placed = new Date(order.authorized_at).getTime();
  if (!Number.isFinite(placed)) return false;

  const limit = days == null ? config.pricing.authorizationFreshDays : days;
  const age = ((now ? now.getTime() : Date.now()) - placed) / 86_400_000;

  return age <= limit;
}

// IS THIS PICKUP CLOSE ENOUGH TO HOLD MONEY AGAINST YET?
//
// Neil, 14 September: only place the $25 on a booking a day in advance. A hold
// is a pending line on somebody's card, so a pickup booked a fortnight out
// would tie up real money for a fortnight - and Stripe would have expired it
// long before the driver arrived, so it would buy nothing in return.
//
// Anything further out is held by the night-before pass in
// src/core/show-up-holds.js instead. A pickup with no date at all is held now,
// because there is no later moment to defer it to.
//
// require() inside the function: booking.js requires this file, so a top-level
// import would be a cycle. Node caches it, so the cost is one lookup.
function holdDueNow(order, { today = null, leadDays = null } = {}) {
  if (!order || !order.pickup_date) return true;

  const booking = require('./booking');
  const days = leadDays == null ? config.pricing.authorizationLeadDays : leadDays;

  return order.pickup_date <= booking.addDays(today || booking.today(), days);
}

// PLACE THE HOLD. Money held, not taken.
//
// Called at booking, and again from the card-saved path for a pickup that was
// waiting on a card. Safe to call twice: an order that already has a live hold
// says so and asks Stripe for nothing.
async function authorizeShowUp(order, customer, { amountCents = null } = {}) {
  if (!order || !order.id) return { ok: false, skipped: 'no_order' };

  // NOTHING TO HOLD AGAINST. A waived order is collected as normal - CLAUDE.md
  // is emphatic that nothing to charge is not the same as cannot charge - and
  // holding $25 on somebody who has just been told "nothing to pay" is the
  // contradiction that rule exists to avoid.
  if (order.payment_status === 'WAIVED' || order.payment_status === 'PAID') {
    return { ok: true, skipped: 'nothing_to_hold' };
  }

  if (showUpHold(order)) return { ok: true, alreadyHeld: true };

  // Fails open, exactly like needsCardOnFile(): a sandbox with no Stripe key
  // must not quietly take every pickup off the round.
  if (!payments.isConfigured) return { ok: true, skipped: 'payments_off' };

  // NOT A REFUSAL. No card at all is the AWAITING CARD path, which already has
  // its own gate, its own badge and its own chase. Recording it here as a
  // refusal would say the card said no when there is no card to ask.
  if (!hasPaymentMethod(customer)) return { ok: false, needsCard: true };

  const amount = amountCents == null ? holdFor(order) : Math.round(Number(amountCents));
  if (!(amount > 0)) return { ok: true, skipped: 'nothing_to_hold' };

  const attempts = Number(order.authorization_attempts || 0);

  const result = await payments.authorize({
    stripeCustomerId: customer.stripe_customer_id,
    paymentMethodId: customer.default_payment_method_id,
    amountCents: amount,
    description: `LYNDRY pickup #${order.order_number} - held, not taken`,
    // The attempt number is in the key for the reason CLAUDE.md already gives
    // about charges: Stripe caches the RESULT of a key, refusals included, so
    // without it a customer who fixed their card would be handed yesterday's
    // no for ever.
    idempotencyKey: `showup_${order.id}_${amount}_${attempts}`,
    metadata: { lyndry_order_id: order.id, lyndry_customer_id: customer.id },
  });

  if (result.ok && result.held) {
    const { error } = await db
      .from('orders')
      .update({
        authorization_intent_id: result.paymentIntentId,
        authorized_cents: amount,
        authorized_at: new Date().toISOString(),
        authorization_refused_at: null,
        authorization_refused_reason: null,
        authorization_attempts: attempts + 1,
      })
      .eq('id', order.id);

    if (error) throw error;
    return { ok: true, held: true, amountCents: amount, paymentIntentId: result.paymentIntentId };
  }

  // THE CARD SAID NO, so the pickup is not confirmed. Written down rather than
  // only returned, because the thing that acts on it is a route being drawn
  // tomorrow morning by somebody who was not here when this happened.
  const reason = result.reason || 'That card would not accept the hold.';

  const { error } = await db
    .from('orders')
    .update({
      authorization_refused_at: new Date().toISOString(),
      authorization_refused_reason: String(reason).slice(0, 500),
      authorization_attempts: attempts + 1,
    })
    .eq('id', order.id);

  if (error) console.error(`Could not record a refused hold on ${order.id}: ${error.message}`);

  return { ok: false, refused: true, reason, declineCode: result.declineCode || null };
}

// TAKE SOME OR ALL OF THE HOLD. Never more than was held - Stripe would refuse
// it, and a hold is a promise about a ceiling.
async function captureShowUp(order, { amountCents }) {
  const hold = showUpHold(order);
  if (!hold) return { ok: false, reason: 'no_hold' };

  const amount = Math.min(hold.cents, Math.max(0, Math.round(Number(amountCents || 0))));
  if (!(amount > 0)) return { ok: false, reason: 'nothing_to_capture' };

  const result = await payments.capture({
    paymentIntentId: hold.intentId,
    amountCents: amount,
    idempotencyKey: `capture_${order.id}_${amount}`,
  });

  if (!result.ok) return { ok: false, reason: result.reason, paymentIntentId: hold.intentId };

  // THE ID IS CLEARED AND THE AMOUNT IS KEPT. There is no live hold any more,
  // so nothing may try to capture or release it again; what was taken stays on
  // the order because it is the record that the trip was paid for, and on the
  // one outcome where the bags were left behind it is the only such record.
  const { error } = await db
    .from('orders')
    .update({
      authorization_intent_id: null,
      captured_cents: amount,
      captured_at: new Date().toISOString(),
    })
    .eq('id', order.id);

  if (error) console.error(`Could not record the capture on ${order.id}: ${error.message}`);

  return { ok: true, capturedCents: amount, paymentIntentId: hold.intentId };
}

// LET IT GO WITHOUT TAKING ANYTHING.
//
// For a pickup called off before anybody drove to it. NOT for a refusal at the
// door: the trip happened there, and Neil's rule is that we keep the $25.
async function releaseShowUp(order) {
  const hold = showUpHold(order);
  if (!hold) return { ok: true, nothingHeld: true };

  const result = await payments.releaseAuthorization({ paymentIntentId: hold.intentId });

  // CLEARED EITHER WAY. A hold Stripe has already let go of - they expire on
  // their own - must not sit on the order looking capturable; and one we
  // genuinely failed to cancel expires within the week anyway. Leaving the id
  // there is the worse of the two, because the door would then try to capture
  // money that is not held.
  await db
    .from('orders')
    .update({ authorization_intent_id: null })
    .eq('id', order.id)
    .then(({ error }) => {
      if (error) console.error(`Could not clear the hold on ${order.id}: ${error.message}`);
    });

  return { ok: Boolean(result.ok), reason: result.reason || null };
}

// HOW A DOOR TOTAL IS SPLIT BETWEEN THE HOLD AND THE CARD. Pure, and the whole
// of Neil's arithmetic in three lines:
//
//   $18 against a $25 hold   capture $18, charge nothing; Stripe lets $7 go
//   $84 against a $25 hold   capture $25, charge $59
//   $25 against a $25 hold   capture $25, charge nothing
//
// It is a function rather than two inline comparisons because it is the rule,
// and a rule that only exists inside an async function wrapped around two Stripe
// calls is one nobody can check without a card.
function doorSplit(totalCents, heldCents) {
  const total = Math.max(0, Math.round(Number(totalCents || 0)));
  const held = Math.max(0, Math.round(Number(heldCents || 0)));
  const capture = Math.min(total, held);

  return { total, capture, charge: total - capture };
}

// ---------------------------------------------------------------------------
// THE BAGS ARE WEIGHED, THIS IS WHAT IT COMES TO, TAKE THE MONEY.
//
// IT WAS CALLED `chargeAtTheDoor()` AND THE NAME STOPPED BEING TRUE. Under the
// van the weighing and the money both happened on a customer's step, so the door
// was the only place this could be called from. Under a courier nobody of ours
// ever stands at that door - the bags are weighed at a laundromat counter, which
// is where settleWeight() now calls this from. Two callers, one act: settle a
// total against whatever is held.
//
// The door half is unchanged and still lives in loadVan(). What moved is only
// the name, because a function called "at the door" invoked from a laundromat is
// the kind of stale label that costs somebody an hour six months later - the
// same lesson CLAUDE.md records about the three customer-facing sentences that
// still said "when we deliver it back" long after the charge point moved.
//
// Neil's three outcomes, in his order: capture what fits, then charge whatever
// is left over, and if that is refused keep what was captured.
//
// CAPTURE FIRST, THEN THE REMAINDER, and that order is his. It is also the
// right one: the $25 is the money we are certain of, so taking it first means
// the trip is paid for whatever happens next.
//
// AN ORDER WITH NO LIVE HOLD FALLS STRAIGHT THROUGH to chargeOrder(), which is
// exactly what every order did before this existed. That is what keeps the
// orders already on the board working on the morning this deploys.
// ---------------------------------------------------------------------------
async function settleTotal(order, customer, { totalCents }) {
  if (order.payment_status === 'WAIVED') return { ok: true, waived: true };

  const hold = showUpHold(order);
  const { total, capture, charge } = doorSplit(totalCents, hold ? hold.cents : 0);

  // A FREE ORDER COMES TO NOTHING, AND NOTHING IS NOT A REFUSAL.
  //
  // FOUND WRITING THIS, AND IT PREDATES IT: chargeOrder() answers `{ ok: false,
  // reason: 'The order has no price yet.' }` for a price of zero, which is
  // right at a weigh-in where zero means unpriced and catastrophic at a door,
  // where loadVan() turns any `ok: false` into declinedAtTheDoor(). A customer
  // on the first-20-orders-free promotion with a load under the minimum prices
  // at exactly $0 - so they would have been texted that their card was refused
  // and had their bags left on the step, over an order we had told them was on
  // us.
  //
  // The door is the only caller that can tell the two zeroes apart, because it
  // is the one that worked the price out a line earlier. So it answers here
  // rather than loosening chargeOrder(), which every other caller relies on to
  // refuse an unpriced order.
  if (total === 0) return { ok: true, nothingToCharge: true };

  if (!hold) return chargeOrder({ ...order, price_cents: total }, customer);

  // --- It all fits inside the hold ----------------------------------------
  if (charge === 0) {
    const took = await captureShowUp(order, { amountCents: capture });

    // A hold that will not capture is not money. Fall back to charging the
    // card outright rather than treating an unusable authorization as payment.
    if (!took.ok) return chargeOrder({ ...order, price_cents: total }, customer);

    await settleFromHold(order, {
      capturedCents: took.capturedCents,
      paymentIntentId: took.paymentIntentId,
      total,
    });

    return {
      ok: true,
      fromHold: true,
      capturedCents: took.capturedCents,
      chargedCents: took.capturedCents,
    };
  }

  // --- More than the hold: take the hold, then the rest --------------------
  const took = await captureShowUp(order, { amountCents: capture });
  const kept = took.ok ? took.capturedCents : 0;

  // Off what was actually captured rather than off `charge`, so a hold that
  // would not capture leaves the whole total to be charged rather than a gap
  // nobody ever bills for.
  const rest = total - kept;

  const result = payments.isConfigured
    ? await payments.chargeOffSession({
        stripeCustomerId: customer && customer.stripe_customer_id,
        paymentMethodId: customer && customer.default_payment_method_id,
        amountCents: rest,
        description: `LYNDRY wash & fold - ${order.weight_lb} lb`,
        idempotencyKey: `order_${order.id}_${rest}_${order.payment_attempts || 0}`,
        metadata: { lyndry_order_id: order.id, lyndry_customer_id: customer && customer.id },
      })
    : { ok: false, reason: 'Payments are not switched on.' };

  if (result.ok) {
    await settleFromHold(order, {
      capturedCents: kept,
      paymentIntentId: took.paymentIntentId,
      remainderCents: rest,
      remainderIntentId: result.paymentIntentId,
      total,
    });

    return { ok: true, fromHold: true, capturedCents: kept, chargedCents: total };
  }

  // --- THE REMAINDER WAS REFUSED. We keep what was captured. ---------------
  //
  // The ledger row is written HERE rather than at the moment of capture,
  // because until this line nobody knew what the money was for: the same $25
  // is part of a wash when the rest clears and a trip charge when it does not,
  // and applies_to_wash is the difference. The window between the capture and
  // this row is milliseconds and a failure is logged loudly - the same
  // exposure recordCard() already carries, and for the same reason: the money
  // has moved and losing the row is a reporting problem.
  //
  // AND WHICH OF THE TWO IT IS DEPENDS ON WHETHER WE HAVE THE LAUNDRY.
  //
  // This wrote `recordShowUp()` unconditionally, which is `applies_to_wash:
  // false` and a note reading "the bags were left" - true at a doorstep, where
  // this was the only caller, and false at a laundromat counter, where the
  // weigh-in now calls it. A courier order refused here would have had $25 taken
  // off the customer's card, recorded as money for a trip, on bags sitting on a
  // shelf being washed. `balance()` would then still owe the whole total, so
  // `paymentHold()` holds the delivery over $25 the customer has already paid.
  //
  // CUSTODY IS THE DISTINGUISHING FACT and it already has a name. Neil's rule
  // for the kept money is that the trip charge is for laundry we NEVER TOOK -
  // the driver drove there, weighed, and left the bags. Once the laundry is
  // ours, anything we take is part of the wash. `orders.IN_OUR_HANDS` is that
  // line and is the same one `recordCash()` refuses on.
  //
  // DERIVED, NOT A FLAG THE CALLER PASSES. Two callers today and either could
  // forget, and the failure is silent money in the wrong column.
  if (kept > 0) {
    // Required inside the function, not at the top: orders.js reaches back for
    // billing.js, so this is a loop, and CLAUDE.md's rule for one is that the
    // module reads the other inside the function that needs it.
    const orderStates = require('./orders');
    const haveTheLaundry = orderStates.IN_OUR_HANDS.includes(order.status);

    await (haveTheLaundry
      ? ledger.recordCard(order, {
          amountCents: kept,
          paymentIntentId: took.paymentIntentId,
          note: 'Part payment: the hold was captured and the rest of the total was refused.',
        })
      : ledger.recordShowUp(order, {
          amountCents: kept,
          paymentIntentId: took.paymentIntentId,
          note: 'Kept for the trip: the extra charge was refused and the bags were left.',
        })
    ).catch((err) => console.error(`Could not record the captured hold: ${err.message}`));
  }

  await markFailed(order, result.reason, result.paymentIntentId, result.declineCode);

  const url = wantsPaymentLink(order) ? (await createSetupLink(customer)).url : null;

  return {
    ok: false,
    declined: true,
    setupUrl: url,
    // What we kept, so the doorstep can say so. Neil: the customer paid for the
    // trip, not for laundry we never took.
    keptCents: kept,
    owedCents: rest,
    message: null,
  };
}

// Everything that follows a door charge going through, however it was split.
// One place, because the ledger, the status and the intent id have to agree.
async function settleFromHold(
  order,
  {
    capturedCents = 0,
    paymentIntentId = null,
    remainderCents = 0,
    remainderIntentId = null,
    total = 0,
  }
) {
  await db
    .from('orders')
    .update({
      payment_status: 'PAID',
      stripe_payment_intent_id:
        remainderIntentId || paymentIntentId || order.stripe_payment_intent_id || null,
      paid_at: new Date().toISOString(),
      payment_failure_reason: null,
      payment_decline_code: null,
      authorization_refused_at: null,
      authorization_refused_reason: null,
      payment_attempts: (order.payment_attempts || 0) + (remainderCents > 0 ? 1 : 0),
    })
    .eq('id', order.id)
    .then(({ error }) => {
      if (error) console.error(`Could not settle ${order.id} at the door: ${error.message}`);
    });

  // TWO ROWS WHEN IT WAS TAKEN TWO WAYS, and both count towards the wash: the
  // laundry is going in the van, so every cent of it paid for a wash that is
  // actually happening. This is the branch where the $25 is ordinary money.
  const priced = { ...order, price_cents: total };

  if (capturedCents > 0) {
    await ledger
      .recordCard(priced, {
        amountCents: capturedCents,
        paymentIntentId,
        note: 'Taken from the hold placed when the pickup was booked.',
      })
      .catch((err) => console.error(`Could not record the captured hold: ${err.message}`));
  }

  if (remainderCents > 0) {
    await ledger
      .recordCard(priced, {
        amountCents: remainderCents,
        paymentIntentId: remainderIntentId,
        note: 'The balance over the hold, charged at the door.',
      })
      .catch((err) => console.error(`Could not record the balance at the door: ${err.message}`));
  }
}

module.exports = {
  refundDeposit,
  showUpCents,
  holdFor,
  showUpHold,
  holdIsFresh,
  holdDueNow,
  doorSplit,
  showUpState,
  authorizeShowUp,
  captureShowUp,
  releaseShowUp,
  settleTotal,
  hasPaymentMethod,
  needsCardOnFile,
  paymentsConfigured,
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
  paymentHoldReason,
  ensureExistingHolds,
  retryOutstanding,
  money,
};
