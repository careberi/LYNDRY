'use strict';

const express = require('express');

const db = require('../db');
const { config } = require('../config');
const sms = require('../providers/sms');
const compliance = require('../core/compliance');
const brain = require('../core/brain');
const actions = require('../core/actions');
const orders = require('../core/orders');
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

// Sending and logging in one step lives in src/core/notify.js, so the driver's
// status texts and these replies are recorded identically.
const reply = require('../core/notify').sendAndLog;

// ---------------------------------------------------------------------------
// Deciding what to say back
// ---------------------------------------------------------------------------

async function handleInbound(inbound) {
  const { from, text } = inbound;

  // The whole row, not a few columns: the brain needs the address and the
  // saved wash preferences to answer "laundry tomorrow" without asking
  // anything back.
  const { data: customer, error } = await db
    .from('customers')
    .select('*')
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
  // Claude reads the message and picks ONE action. Our code then carries it
  // out and writes the reply, so the price and the dates in a confirmation are
  // always real values from the database rather than something a model wrote.
  await answerWithBrain(customer, text, from);
}

async function answerWithBrain(customer, text, from) {
  // What we hand Claude: the customer's profile, their current order, and the
  // last few messages so "same as last time" and "yes" mean something.
  const [order, recentMessages] = await Promise.all([
    orders.findLatestInFlight(customer.id),
    recentConversation(customer.id),
  ]);

  let decision;
  try {
    decision = await brain.decide({ customer, order, recentMessages, message: text });
  } catch (err) {
    // The AI being unreachable must never look like LYNDRY ignoring someone.
    console.error('Claude call failed:', err.message);
    await reply(
      from,
      `Sorry — something went wrong on our end. Email ${site.email} and we'll pick it up from there.`,
      customer.id
    );
    return;
  }

  if (decision.type === 'text') {
    // Claude needs one detail before it can act.
    console.log(`ASK     ${from}: ${decision.text}`);
    await reply(from, decision.text, customer.id);
    return;
  }

  console.log(`ACTION  ${from}: ${decision.name} ${JSON.stringify(decision.input)}`);

  let message;
  try {
    message = await actions.run(decision.name, decision.input, customer, {
      // How an action reaches Neil when it needs a human. Passed in rather
      // than imported so nothing in core/ needs to know about SMS at all.
      notify: (to, body) => sms.sendMessage({ to, text: body }),
    });
  } catch (err) {
    console.error(`Action ${decision.name} failed:`, err.message);
    message = `Sorry — I couldn't do that. Email ${site.email} and we'll sort it out.`;
  }

  await reply(from, message, customer.id);
}

// The last few messages either way, oldest first. Enough for a follow-up like
// "make it Friday" to make sense, without sending the whole history.
async function recentConversation(customerId) {
  const { data, error } = await db
    .from('messages')
    .select('direction, body')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(6);

  if (error) {
    console.error('Could not read recent messages:', error.message);
    return [];
  }

  return (data || []).reverse();
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
