'use strict';

const express = require('express');

const db = require('../db');
const { config } = require('../config');
const sms = require('../providers/sms');
const compliance = require('../core/compliance');
const brain = require('../core/brain');
const actions = require('../core/actions');
const onboarding = require('../core/onboarding');
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
async function recordInbound({ providerMessageId, text, from }, customerId) {
  const { error } = await db.from('messages').insert({
    customer_id: customerId,
    // Always recorded, even for a number we don't recognise. Someone who
    // texted once and never signed up is the warmest lead the business gets;
    // losing their number loses them.
    phone: from,
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

// Writes the carrier's verdict onto the message we sent.
//
// A failure here is the single most useful line in the logs when someone says
// they never got a text, so it is shouted rather than whispered.
async function recordDelivery({ providerMessageId, status, error }) {
  const failed = status && /fail|undeliver|reject|expired/i.test(status);

  if (failed || error) {
    console.error('');
    console.error(`  MESSAGE NOT DELIVERED  (${providerMessageId})`);
    console.error(`    carrier status: ${status || 'unknown'}`);
    if (error) console.error(`    carrier said  : ${error}`);
    console.error('');
  } else {
    console.log(`Delivery receipt: ${providerMessageId} -> ${status}`);
  }

  const changes = { delivery_status: status || null, delivery_error: error || null };
  if (status === 'delivered') changes.delivered_at = new Date().toISOString();

  const { error: dbError } = await db
    .from('messages')
    .update(changes)
    .eq('provider_message_id', providerMessageId);

  if (dbError) throw dbError;
}

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
  // They get onboarded right here in the thread rather than sent to a form.
  //
  // Somebody texting us first is the strongest consent there is — they started
  // the conversation, and their message is sitting in the messages table as the
  // record of it. That is recorded as INBOUND_TEXT so it can be told apart
  // from a ticked box later, because the two are different kinds of evidence.
  //
  // No canned welcome. They said something, so the AI answers THAT — it can
  // see they are brand new and introduces LYNDRY as part of the reply. A
  // scripted "what's your name and where should we collect from?" in response
  // to "hello" was the first thing a real tester noticed.
  if (!customer) {
    const started = await onboarding.startConversation({
      phone: from,
      consentSource: 'INBOUND_TEXT',
      // No IP to record — this did not come through a browser. The evidence is
      // their own inbound message, not a form submission.
      consentIp: null,
      sendWelcome: false,
    });

    if (!started.ok) {
      console.log(`Could not start a conversation with ${from}: ${started.reason}`);
      return;
    }

    await answerWithBrain(started.customer, text, from);
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
  const [order, recentMessages, recentOrders] = await Promise.all([
    orders.findLatestInFlight(customer.id),
    recentConversation(customer.id),
    // Their own order numbers, so a complaint can be tied to the right one and
    // the AI can name it rather than asking blind.
    recentOrdersFor(customer.id),
  ]);

  let decision;
  try {
    decision = await brain.decide({ customer, order, recentMessages, recentOrders, message: text });
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

  const helpers = {
    // How an action reaches Neil when it needs a human. Passed in rather
    // than imported so nothing in core/ needs to know about SMS at all.
    notify: (to, body) => sms.sendMessage({ to, text: body }),
    // What they actually said, kept on an issue alongside the AI's summary,
    // because their own words matter when somebody is upset.
    customerSaid: text,
  };

  let message;
  try {
    message = await actions.run(decision.name, decision.input, customer, helpers);
  } catch (err) {
    console.error(`Action ${decision.name} failed:`, err.message);
    await reply(from, `Sorry — I couldn't do that. Email ${site.email} and we'll sort it out.`, customer.id);
    return;
  }

  // One message can carry two jobs. "good to go" at a booking recap that also
  // corrects a preference has to save the correction AND book the pickup, and
  // with strictly one action per message the model picked one and dropped the
  // other — a real customer approved a recap and got "I'll use that from your
  // next pickup" with nothing booked.
  //
  // So after a SETUP action (saving details or preferences), the model is
  // asked once: anything left? If it names a follow-on action, that runs and
  // ITS message is what the customer receives. If it says no, the setup
  // message stands. One extra step, never more, so it cannot loop.
  const SETUP_ACTIONS = ['save_details', 'update_profile'];

  if (SETUP_ACTIONS.includes(decision.name)) {
    try {
      // Fresh rows: the setup action just changed them, and the follow-up
      // decision has to see the world it created.
      const { data: freshCustomer } = await db
        .from('customers')
        .select('*')
        .eq('id', customer.id)
        .single();

      const freshOrder = await orders.findLatestInFlight(customer.id);

      const followOn = await brain.decide({
        customer: freshCustomer || customer,
        order: freshOrder,
        recentMessages: await recentConversation(customer.id),
        message: text,
        followUp: { name: decision.name, reply: message },
      });

      if (followOn.type === 'tool' && !SETUP_ACTIONS.includes(followOn.name)) {
        console.log(`ACTION+ ${from}: ${followOn.name} ${JSON.stringify(followOn.input)}`);
        message = await actions.run(followOn.name, followOn.input, freshCustomer || customer, helpers);
      }
      // Any text answer — "OK" or otherwise — means nothing more to do, and
      // the setup action's own message is the reply.
    } catch (err) {
      // The follow-up is best effort. The setup succeeded and its message is
      // true, so that is what gets sent if deciding the next step fails.
      console.error('Follow-up decision failed:', err.message);
    }
  }

  await reply(from, message, customer.id);
}

// The order numbers a customer might refer to. Enough to answer "which one
// is it about?" without sending their whole history.
async function recentOrdersFor(customerId) {
  const { data, error } = await db
    .from('orders')
    .select('order_number, status, pickup_date, weight_lb')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Could not read recent orders:', error.message);
    return [];
  }

  return data || [];
}

// The last few messages either way, oldest first. Enough for a follow-up like
// "make it Friday" to make sense, without sending the whole history.
//
// Ten rather than six because a first booking is a longer exchange now: hello,
// onboarding, address, a window, the card link, "done". With six, the start of
// that conversation had already scrolled out of view by the time the customer
// said "done", and the AI lost the thread it was in the middle of.
async function recentConversation(customerId) {
  const { data, error } = await db
    .from('messages')
    .select('direction, body, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(10);

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

  // 2. A delivery receipt tells us what the receiving carrier did with a
  //    message we sent. This is the only place a blocked or filtered message
  //    announces itself — the send looked fine at the time.
  const receipt = sms.parseDeliveryReceipt(req.body);
  if (receipt && receipt.providerMessageId) {
    res.sendStatus(200);
    recordDelivery(receipt).catch((err) =>
      console.error('Failed to record a delivery receipt:', err.message)
    );
    return;
  }

  // 3. Is this an actual inbound message? Anything else is ignored.
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
