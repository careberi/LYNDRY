'use strict';

const express = require('express');

const db = require('../db');
const billing = require('../core/billing');
const booking = require('../core/booking');
const orders = require('../core/orders');
const payments = require('../providers/payments');
const { sendAndLog } = require('../core/notify');
const { renderPage } = require('../web/layout');
const { site } = require('../web/site');

const router = express.Router();

// ---------------------------------------------------------------------------
// Payment routes.
//
// Two of them:
//
//   GET  /pay/:token          send the customer to the card page
//   POST /webhooks/stripe     the provider telling us what happened
//
// The customer only ever sees the first. It lives on lyndry.com rather than
// texting the provider's own URL for the same reason delivery photos do:
// carriers score a texted link partly by its domain, and every link we send
// should be on the domain registered to the brand.
// ---------------------------------------------------------------------------

// Tokens are base64url, so this is the full set of characters one can contain.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

// A plain page for the handful of cases where there is nothing to redirect to.
function simplePage(res, { status, title, heading, body }) {
  res.status(status).type('html').send(
    renderPage({
      title,
      description: 'LYNDRY payment.',
      path: '/pay',
      body: `
<section class="container" style="max-width:760px;padding-top:96px;padding-bottom:112px;">
  <p class="eyebrow eyebrow-brand">Payment</p>
  <h1 class="display-2">${heading}</h1>
  <div style="font-size:19px;line-height:1.55;color:var(--ink-800);max-width:46ch;">${body}</div>
  <a href="/" class="btn btn-primary btn-lg" style="margin-top:36px;">Back to LYNDRY</a>
</section>`,
    })
  );
}

// ---------------------------------------------------------------------------
// GET /pay/:token — the link we text
//
// Looks the token up and forwards to the provider's hosted card page. If the
// provider's session has expired — they only last a day — a fresh one is made
// rather than showing the customer a dead end. Somebody opening a two-day-old
// text should still be able to pay us.
// ---------------------------------------------------------------------------

router.get('/pay/:token', async (req, res, next) => {
  try {
    const { token } = req.params;

    if (!TOKEN_PATTERN.test(token)) return notAPaymentLink(res);

    const { data: link, error } = await db
      .from('payment_links')
      .select('*, customers(*)')
      .eq('token', token)
      .maybeSingle();

    if (error) throw error;
    if (!link) return notAPaymentLink(res);

    if (link.completed_at) {
      const card = billing.describeCard(link.customers);
      return simplePage(res, {
        status: 200,
        title: 'Card already added',
        heading: 'That card is already on file.',
        body: `<p>You added ${card || 'a card'} to your LYNDRY account, so there's nothing to do here.</p>
               <p>Text us whenever you want a pickup.</p>`,
      });
    }

    const expired = link.expires_at && new Date(link.expires_at) < new Date();

    // Provider sessions only last a day. Somebody opening a two-day-old text
    // should still be able to pay us, so mint a fresh one rather than showing
    // them a dead end.
    const destination = expired
      ? (await billing.createSetupLink(link.customers)).providerUrl
      : link.url;

    // Never cached. A shared browser should not be able to reopen the page
    // for someone else's account out of history.
    res.set('Cache-Control', 'no-store, private');
    return res.redirect(302, destination);
  } catch (err) {
    return next(err);
  }
});

function notAPaymentLink(res) {
  return simplePage(res, {
    status: 404,
    title: 'Payment link not found',
    heading: "That link doesn't work.",
    body: `<p>It may have been mistyped, or it belongs to an account that no longer exists.</p>
           <p>Text us and we'll send you a new one, or email <a href="mailto:${site.email}" class="font-semibold text-brand-800 underline underline-offset-2">${site.email}</a>.</p>`,
  });
}

// ---------------------------------------------------------------------------
// GET /pay/:token/done — where the provider sends them afterwards
//
// The webhook is what actually records the card; this page exists so the
// customer sees a LYNDRY page rather than being dumped somewhere generic. It
// also reads the card back itself, because a webhook can arrive seconds late
// and this page should never say "not done yet" about something that is.
// ---------------------------------------------------------------------------

router.get('/pay/:token/done', async (req, res, next) => {
  try {
    const { token } = req.params;

    if (!TOKEN_PATTERN.test(token)) return notAPaymentLink(res);

    const { data: link, error } = await db
      .from('payment_links')
      .select('*, customers(*)')
      .eq('token', token)
      .maybeSingle();

    if (error) throw error;
    if (!link) return notAPaymentLink(res);

    let customer = link.customers;

    if (!link.completed_at) {
      // They may have cancelled rather than finished, in which case there is
      // no card to read and this quietly returns null.
      const updated = await billing.recordSavedCard(link).catch((err) => {
        console.error('Could not read back the saved card:', err.message);
        return null;
      });
      if (updated) customer = updated;
    }

    if (!billing.hasPaymentMethod(customer)) {
      return simplePage(res, {
        status: 200,
        title: 'Card not added',
        heading: 'No card was saved.',
        body: `<p>Nothing was charged and nothing was stored. If you changed your mind, that's fine.</p>
               <p>Open the link from your text message again whenever you're ready.</p>`,
      });
    }

    return simplePage(res, {
      status: 200,
      title: "You're all set",
      heading: "Card saved.",
      body: `<p>${billing.describeCard(customer)} is on your LYNDRY account. We'll charge it after we weigh each bag — never before, and never without telling you the figure.</p>
             <p>Text us to book your pickup. That's the whole thing.</p>`,
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /webhooks/stripe
//
// The provider telling us something happened. Verified by signature first —
// an unsigned "payment succeeded" would otherwise be anyone's to send, and
// this endpoint marks orders as paid.
//
// express.raw is deliberate: the signature covers the exact bytes sent, and
// parsing then re-serialising the JSON produces different bytes.
// ---------------------------------------------------------------------------

router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;

  try {
    event = payments.verifyWebhook({
      rawBody: req.body,
      signature: req.get('stripe-signature') || '',
    });
  } catch (err) {
    console.warn('Rejected a payment webhook with a bad signature:', err.message);
    return res.status(400).json({ error: 'bad_signature' });
  }

  // Answer immediately, then do the work. The provider retries anything that
  // doesn't reply quickly, and a retry of something we already handled is
  // wasted effort at best.
  res.json({ received: true });

  try {
    await handleEvent(event);
  } catch (err) {
    console.error(`Payment webhook ${event.type} failed:`, err.message);
  }
});

async function handleEvent(event) {
  switch (event.type) {
    // The customer finished the card page.
    case 'checkout.session.completed': {
      const sessionId = event.data.object.id;

      const { data: link, error } = await db
        .from('payment_links')
        .select('*, customers(*)')
        .eq('stripe_session_id', sessionId)
        .maybeSingle();

      if (error) throw error;
      if (!link) {
        console.warn(`Payment webhook for an unknown session: ${sessionId}`);
        return;
      }
      if (link.completed_at) return; // Already handled by the return page.

      const customer = await billing.recordSavedCard(link);
      if (!customer) return;

      const card = billing.describeCard(customer);

      // Anything they already owe gets settled now, without them having to
      // do anything else.
      const settled = await billing.retryOutstanding(customer);

      if (settled.length > 0) {
        await sendAndLog(
          customer.phone,
          `Card saved: ${card}. We've settled the ${billing.money(
            settled.reduce((sum, s) => sum + s.order.price_cents, 0)
          )} outstanding. Thanks.`,
          customer.id
        );
        return;
      }

      // Finish the booking they were in the middle of.
      //
      // Somebody adding a card is almost always partway through arranging a
      // pickup. Before this, they got "card saved" and nothing else, and the
      // pickup they had just asked for was left unconfirmed with no sign that
      // anything was missing. That happened to a real customer.
      const pending = await orders.findAwaitingCollection(customer.id);

      if (pending && !pending.deposit_paid_at) {
        const deposit = await billing.chargeDeposit(pending, customer);

        if (deposit.ok) {
          // The confirmation names the card itself when the minimum is taken,
          // so the opener must not name it again.
          await sendAndLog(
            customer.phone,
            booking.confirmationMessage(customer, deposit.order || pending, { opener: 'Card saved' }),
            customer.id
          );
          return;
        }

        await sendAndLog(
          customer.phone,
          deposit.message || `Card saved: ${card}, but the minimum didn't go through. Try another card.`,
          customer.id
        );
        return;
      }

      await sendAndLog(
        customer.phone,
        `Card saved: ${card}. Text us whenever you want a pickup.`,
        customer.id
      );
      return;
    }

    // A charge succeeded or failed somewhere other than in our own code —
    // most often a retry the provider made on its own. Keep our record in
    // step rather than letting the two drift apart.
    case 'payment_intent.succeeded': {
      const meta = event.data.object.metadata || {};
      const orderId = meta.lyndry_order_id;
      if (!orderId) return;

      // The $25 minimum carries the order id too, and its success must NOT
      // mark the order paid — the balance has not been charged yet. Exactly
      // that happened on a real order: the deposit webhook stamped it PAID at
      // booking, delivery then skipped the balance charge as "already paid",
      // and the customer was told $87.50 was charged when only $25 ever was.
      if (meta.lyndry_kind === 'deposit') return;

      await db
        .from('orders')
        .update({
          payment_status: 'PAID',
          paid_at: new Date().toISOString(),
          stripe_payment_intent_id: event.data.object.id,
          payment_failure_reason: null,
        })
        .eq('id', orderId)
        .neq('payment_status', 'PAID');
      return;
    }

    case 'payment_intent.payment_failed': {
      const failedMeta = event.data.object.metadata || {};
      const orderId = failedMeta.lyndry_order_id;
      if (!orderId) return;

      // Same rule as success: a failed DEPOSIT must not mark the whole order's
      // payment as failed. The deposit's own path already handles its decline.
      if (failedMeta.lyndry_kind === 'deposit') return;

      const failure = event.data.object.last_payment_error || {};

      await db
        .from('orders')
        .update({
          payment_status: 'FAILED',
          payment_failure_reason: (failure.message || 'The card was declined.').slice(0, 500),
          stripe_payment_intent_id: event.data.object.id,
        })
        .eq('id', orderId)
        .neq('payment_status', 'PAID');
      return;
    }

    default:
      // Everything else the provider sends is of no interest to us.
      return;
  }
}

module.exports = { router };
