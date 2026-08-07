'use strict';

const express = require('express');

const db = require('../db');
const { config } = require('../config');
const sms = require('../providers/sms');
const compliance = require('../core/compliance');
const { site } = require('../web/site');

const router = express.Router();

// Postgres reports a broken unique constraint with this code. It is how we
// detect that a message has already been processed.
const UNIQUE_VIOLATION = '23505';

// ---------------------------------------------------------------------------
// Logging every message, both directions
// ---------------------------------------------------------------------------

// Records an inbound message. Returns false if we have already seen it.
//
// This is the whole reason provider_message_id is UNIQUE. Carriers retry
// webhooks — a slow response, a blip, and the same text arrives twice. Without
// this check a customer saying "laundry tomorrow" could get two orders.
async function recordInbound({ providerMessageId, text }, customerId) {
  const { error } = await db.from('messages').insert({
    customer_id: customerId,
    direction: 'INBOUND',
    body: text,
    provider_message_id: providerMessageId,
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return false;
    throw error;
  }

  return true;
}

// Sends a text and writes it to the message log. One function so an outbound
// message can never be sent without being recorded.
async function reply(to, text, customerId) {
  let providerMessageId = null;

  try {
    const result = await sms.sendMessage({ to, text });
    providerMessageId = result && result.providerMessageId;
  } catch (err) {
    // Log the attempt anyway. A message we failed to send is exactly the kind
    // of thing worth being able to look up afterwards.
    console.error(`Failed to send SMS to ${to}:`, err.message);
  }

  const { error } = await db.from('messages').insert({
    customer_id: customerId,
    direction: 'OUTBOUND',
    body: text,
    provider_message_id: providerMessageId,
  });

  if (error) console.error('Failed to log outbound message:', error.message);
}

// ---------------------------------------------------------------------------
// Deciding what to say back
// ---------------------------------------------------------------------------

async function handleInbound(inbound) {
  const { from, text } = inbound;

  const { data: customer, error } = await db
    .from('customers')
    .select('id, name, phone, status')
    .eq('phone', from)
    .maybeSingle();

  if (error) throw error;

  const isNew = await recordInbound(inbound, customer ? customer.id : null);
  if (!isNew) {
    console.log(`Duplicate webhook for message ${inbound.providerMessageId} — ignored.`);
    return;
  }

  console.log(`SMS in  ${from}: ${text}`);

  // --- Compliance keywords, before anything else ---------------------------
  const keyword = compliance.classify(text);

  if (keyword) {
    const newStatus = compliance.statusFor(keyword);

    if (customer && newStatus && newStatus !== customer.status) {
      const { error: updateError } = await db
        .from('customers')
        .update({ status: newStatus })
        .eq('id', customer.id);

      if (updateError) throw updateError;
      console.log(`${from} is now ${newStatus}`);
    }

    const body = compliance.replyFor(keyword, {
      supportEmail: site.email,
      signupUrl: `${config.baseUrl}/signup`,
    });

    await reply(from, body, customer ? customer.id : null);
    return;
  }

  // --- Someone who has opted out -------------------------------------------
  //
  // They asked us to stop, so we stop. The only thing that gets them back is
  // texting START, which is handled above.
  if (customer && customer.status === 'UNSUBSCRIBED') {
    console.log(`${from} has opted out — no reply sent.`);
    return;
  }

  // --- A number we don't recognise -----------------------------------------
  //
  // We do not try to sign people up over text. Too much to collect, and the
  // consent record has to come from the website.
  if (!customer) {
    await reply(
      from,
      `Thanks for texting LYNDRY. We don't have an account for this number yet — ` +
        `sign up at ${config.baseUrl}/signup and we'll take it from there.`,
      null
    );
    return;
  }

  // --- A real customer, with something to say ------------------------------
  //
  // PHASE 3 PLACEHOLDER. In phase 4 this is where Claude reads the message and
  // returns one structured action. For now it is a fixed reply, so we can
  // prove the pipe works before adding an AI to it.
  await reply(
    from,
    `Thanks ${customer.name ? customer.name.split(' ')[0] : ''}, we got your message. ` +
      `Booking by text is being switched on shortly. In the meantime email ${site.email} ` +
      `and we'll arrange your pickup.`.replace(/\s+/g, ' '),
    customer.id
  );
}

// ---------------------------------------------------------------------------
// The webhook
// ---------------------------------------------------------------------------

router.post('/sms', (req, res) => {
  // 1. Prove it came from our provider. Anything unsigned is rejected — without
  //    this, whoever finds this URL can impersonate any customer.
  if (!sms.verifySignature({ rawBody: req.rawBody, headers: req.headers })) {
    console.warn('Rejected an SMS webhook with a bad or missing signature.');
    return res.sendStatus(403);
  }

  // 2. Is this an actual inbound message? Delivery receipts and other events
  //    arrive at the same URL and are ignored.
  const inbound = sms.parseInbound(req.body);
  if (!inbound || !inbound.from || !inbound.providerMessageId) {
    return res.sendStatus(200);
  }

  // 3. Answer the carrier immediately. Everything after this happens on our
  //    own time — making a carrier wait on a database write and an AI call is
  //    what causes the retries that create duplicate orders.
  res.sendStatus(200);

  // 4. Now do the work.
  handleInbound(inbound).catch((err) => {
    console.error('Failed handling inbound SMS:', err);
  });
});

module.exports = { router };
