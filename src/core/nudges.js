'use strict';

const booking = require('./booking');
const billing = require('./billing');
const orders = require('./orders');
const settings = require('./settings');
const notify = require('./notify');
const { site } = require('../web/site');
const { config } = require('../config');

// ---------------------------------------------------------------------------
// MOVING A STALLED CUSTOMER ALONG, BY HAND.
//
// Neil's ask: an admin should be able to press a button at each step of getting
// an order started - their details, how they want it washed, where the bag
// goes, a card, and when they want collecting - and have a text go out asking
// for exactly that.
//
// WHAT THIS IS NOT: a second status on the order. He described these as stages
// an order moves through, and they are not - the order state machine is about
// where the BAG is (REQUESTED, IN_PROCESS, AT_PARTNER...), only orders.js may
// move it, and every step below happens before a bag exists. Worse, a stored
// "intake stage" would be a second copy of facts the database already holds,
// free to disagree with them the first time anybody did something by hand.
//
// So a gap is DERIVED, every time, from the same predicates bookPickup()
// refuses on. Same rule as BOOKED on the board, the driver's position and the
// partner load: if the answer can be worked out, never store it.
//
// THE MESSAGES ARE WRITTEN HERE, IN CODE, NOT BY THE AI. Neil's call, taken
// with the alternative in front of him. They are fixed sentences: the ops
// screen shows the exact words and what they cost to send BEFORE the button is
// pressed, they cannot wander, and they are the one thing the AI has never done
// - text somebody who has not just texted us.
//
// The AI still does the part that matters. The nudge lands in `messages` like
// any other outbound, the AI is handed the last ten before it replies, so it
// sees the question that was asked and handles whatever comes back - including
// "actually make it Friday" - exactly as it would in any other thread.
//
// AND A NUDGE IS NOT STAMPED sent_by. A person pressed the button but nobody
// typed the sentence, and stamping it would tell the AI a colleague is working
// the thread by hand and put it into the handover behaviour from brain.js.
// Same reason the text blast is not stamped.
// ---------------------------------------------------------------------------

// Ordered the way checkSlot() refuses, so the first gap on the screen is the
// first thing actually standing between this customer and a booking.
const GAPS = [
  {
    key: 'details',
    title: 'Ask for their name and address',
    blocks: true,
    missing: (c) => !booking.hasName(c) || !booking.hasAddress(c),
    why: (c) =>
      !booking.hasName(c) && !booking.hasAddress(c)
        ? 'We have a phone number and nothing else. A booking is refused without both.'
        : !booking.hasName(c)
        ? 'No name on the account, so the board reads "Unnamed customer" and a booking is refused.'
        : 'No address, so there is nowhere for the van to go and a booking is refused.',
    // ONE THING AT A TIME unless the two are genuinely one answer. Somebody
    // asked "what's your name and where should we collect from?" replies with
    // both in one message; somebody who only needs an address should not be
    // asked their name again.
    text: (c) => {
      const name = String(c.name || '').trim();
      const hasName = booking.hasName(c);
      const hasAddress = booking.hasAddress(c);

      if (!hasName && !hasAddress) {
        return `Hi, it's ${site.name}. To get you set up, what's your name and what address should we collect from?`;
      }
      if (!hasName) {
        return `Hi, it's ${site.name}. One thing missing from your setup - what name should we put on it?`;
      }
      return `Hi ${name}, it's ${site.name}. What address should we be collecting from?`;
    },
  },

  {
    key: 'wash',
    title: 'Ask how they want it washed',
    blocks: true,
    missing: (c) => !booking.hasPreferences(c),
    why: () =>
      'No wash preferences saved. There are no defaults on purpose, so a first booking is refused until they choose.',
    // ONE SHORT QUESTION. Temperature and softener are one decision to a
    // customer, which is the single stated exception to one question per
    // message - it must never grow back into a list of every combination.
    text: (c) => {
      const name = String(c.name || '').trim();
      return (
        `${name ? `Hi ${name}, it's` : `Hi, it's`} ${site.name}. Before your first pickup - ` +
        `how do you like it washed? Cold, warm or hot, and softener or not?`
      );
    },
  },

  {
    key: 'spot',
    title: 'Ask where the bag goes',
    // Not required by bookPickup(), so it does not block - but a driver at a
    // door with no idea where to leave a bag is a real problem, so it is worth
    // a button.
    blocks: false,
    missing: (c) => !String((c.preferences || {}).dropoff_spot || '').trim(),
    why: () => 'Nobody has said where the driver finds the bag, or where to leave it coming back.',
    // BOTH WAYS ROUND. One spot serves both legs, and asking only where to
    // FIND the bag leaves somebody expecting to be asked again about delivery.
    text: (c) => {
      const name = String(c.name || '').trim();
      return (
        `${name ? `Hi ${name}, it's` : `Hi, it's`} ${site.name}. Where should the driver ` +
        `pick your laundry up and drop it back off? Front porch, doorman, wherever suits.`
      );
    },
  },

  {
    key: 'card',
    title: 'Ask for a card',
    blocks: true,
    missing: (c) => billing.needsCardOnFile(c),
    why: () =>
      'No card on file, so nothing can be billed and any pickup they have shows as AWAITING CARD rather than booked.',
    // THE ONE MESSAGE NOT WRITTEN HERE. billing.setupLinkMessage() already owns
    // the wording and, more importantly, mints the /pay/<token> link that goes
    // in it - so this is the same sentence the AI and the website already send.
    // Two versions of "here is your card link" is exactly the drift CLAUDE.md
    // keeps warning about.
    //
    // The preview cannot call it: creating the real message creates a Stripe
    // session, and doing that on every page load would leave a trail of them
    // behind. So the screen shows the wording with the link stubbed and says
    // so, and the live link is minted when the button is pressed.
    text: () =>
      `Before your first pickup we need a card on file. It takes a minute and it's handled by our ` +
      `payment provider, we never see the number: ${config.baseUrl}/pay/...\n\n` +
      `${site.pricePerLb} a pound, charged when we deliver it back. Nothing recurring.`,
    send: (c) => billing.setupLinkMessage(c),
  },

  {
    key: 'pickup',
    title: 'Ask when they want collecting',
    blocks: false,
    // Nothing booked. Not "no order ever" - somebody whose last pickup was
    // delivered last week has nothing coming and is exactly who this is for.
    missing: (c, ctx) => !ctx.openPickup,
    why: () => 'Nothing booked. This is the one that starts an order.',
    // NEVER A LIST OF SLOTS. There are no fixed route days and no menu to
    // choose from - they say when suits and the code picks the band.
    //
    // AND IT HONOURS THE OPENING DATE. Asking somebody when they would like a
    // pickup, then refusing every date they can think of, is the exact bug the
    // opening date was added to stop.
    text: (c, ctx) => {
      const name = String(c.name || '').trim();
      const from = ctx.opensOnLabel ? ` We start collecting on ${ctx.opensOnLabel}.` : '';
      return (
        `${name ? `Hi ${name}, it's` : `Hi, it's`} ${site.name}.${from} ` +
        `When would suit for a pickup? Just say the day and roughly what time.`
      );
    },
  },
];

// Everything this customer is missing, in the order it should be asked for.
//
// The context is read ONCE here rather than by each gap, so the page makes one
// pass at the database however many buttons come back.
async function gapsFor(customer) {
  const [openPickup, takingOrders, opensOn] = await Promise.all([
    orders.findAwaitingCollection(customer.id).catch(() => null),
    settings.takingOrders().catch(() => true),
    settings.opensOn().catch(() => null),
  ]);

  // A date that has passed counts as no date, the same way it does everywhere
  // else - nobody has to remember to clear it.
  const opening = opensOn && opensOn > booking.today() ? opensOn : null;

  const ctx = {
    openPickup,
    opensOnLabel: opening ? booking.readableDate(opening) : null,
  };

  return GAPS.filter((g) => g.missing(customer, ctx))
    .filter((g) => {
      // WITH THE SHOP SHUT, DO NOT ASK SOMEBODY WHEN THEY WANT COLLECTING.
      // bookPickup() would refuse whatever they answered, and inviting a
      // customer to book something that is then refused is the mistake the
      // closed sign has already caused once, in onboarding.js.
      if (g.key === 'pickup' && !takingOrders && !booking.alwaysAllowed(customer)) return false;
      return true;
    })
    .map((g) => ({
      key: g.key,
      title: g.title,
      blocks: g.blocks,
      why: g.why(customer, ctx),
      text: g.text(customer, ctx),
      // What it costs to send, so the screen can say "2 segments" beside a
      // button rather than leaving somebody to count characters.
      cost: notify.describeCost(notify.toPlainText(g.text(customer, ctx))),
      // True when the words above are an illustration rather than the message
      // that will actually go - only the card link, which is minted on send.
      approximate: g.key === 'card',
    }));
}

// Send one. Returns { ok, text } or { ok: false, reason }.
//
// It re-derives the gap rather than trusting the button: a page open in another
// tab since this morning would otherwise ask a customer for a card they saved
// an hour ago. Same reason the fulfilment steps re-check the status instead of
// believing the form that was submitted.
async function send(key, customer) {
  const gap = GAPS.find((g) => g.key === key);
  if (!gap) return { ok: false, reason: 'unknown' };

  if (customer.status === 'UNSUBSCRIBED') return { ok: false, reason: 'unsubscribed' };

  const open = await gapsFor(customer);
  const still = open.find((g) => g.key === key);
  if (!still) return { ok: false, reason: 'already_done' };

  // The card gap mints a live link; everything else is the sentence gapsFor()
  // already built - NOT a fresh gap.text(customer, {}), which would lose the
  // context and quietly drop "we start collecting on the 8th" out of the one
  // message that has to carry it.
  const text = gap.send ? await gap.send(customer) : still.text;

  // Through notify like every other outbound, and NOT stamped sent_by - see
  // the note at the top of this file.
  await notify.sendAndLog(customer.phone, text, customer.id);

  return { ok: true, text };
}

module.exports = { gapsFor, send, GAPS };
