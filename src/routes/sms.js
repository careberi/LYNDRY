'use strict';

const express = require('express');

const db = require('../db');
const { config } = require('../config');
const sms = require('../providers/sms');
const compliance = require('../core/compliance');
const reactions = require('../core/reactions');
const brain = require('../core/brain');
const actions = require('../core/actions');
const onboarding = require('../core/onboarding');
const promocodes = require('../core/promocodes');
const orders = require('../core/orders');
const issues = require('../core/issues');
const aiPause = require('../core/ai-pause');
const burst = require('../core/burst');
const recurring = require('../core/recurring');
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

// The same normaliser the send path uses, so "did we just say this?" compares
// the words that actually went out rather than the ones we composed.
const { toPlainText } = require('../core/notify');
const notify = require('../core/notify');

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

  // --- A MESSAGE WITH NOTHING IN IT ----------------------------------------
  //
  // A real customer's phone sent one - an empty body, most likely a reaction or
  // an attachment that carried no text - and it went to the AI, which threw,
  // and she was told "something went wrong on our end. Email us." She had just
  // given us her name and address. Nothing was wrong on our end and there was
  // nothing to email about.
  //
  // Neil's call: say it came through blank and repeat the last thing we said,
  // so the thread carries on from where it actually is.
  if (!String(text || '').trim()) {
    console.log(`BLANK   ${from}: nothing in the message.`);
    await replyToBlank(from, customer);
    return;
  }

  // --- A THUMBS-UP IS NOT A MESSAGE -----------------------------------------
  //
  // An iPhone tapback arrives as 'Loved "..."' and the AI answered two of them
  // in the first week - a billed segment saying "Glad that landed!" to somebody
  // who had only tapped a heart. Recognised in code, logged, and then nothing:
  // no reply, no AI call, and it does not touch the burst window, because a
  // heart on our last message is not them starting to type. See reactions.js.
  if (reactions.isReaction(text)) {
    console.log(`TAPBACK ${from}: ${text.slice(0, 40)} - not answered.`);
    return;
  }

  // --- Compliance keywords, before anything else ---------------------------
  // The customer is passed so that "yes" only counts as an opt-in from
  // somebody who actually opted out. STOP, START and HELP are unaffected.
  const keyword = compliance.classify(text, customer);

  if (keyword) {
    // A PENDING REPLY IS DROPPED. They asked us to stop between sending a
    // question and us getting round to answering it, and an AI reply landing
    // after STOP is exactly the thing STOP exists to prevent. HELP and START
    // cancel too: whatever they said a moment ago, this is the message to
    // answer now.
    burst.cancel(from);

    const newStatus = compliance.statusFor(keyword);

    if (customer && newStatus && newStatus !== customer.status) {
      // WHEN AND HOW, not just the flag. An audit asks how consent was
      // withdrawn the same way it asks how it was given, and until migration
      // 0076 the only trace was a status that appeared to change by itself.
      // Their own STOP is still the evidence; this says which door it came
      // through, because an admin can now record one by hand.
      const changes = { status: newStatus };

      if (newStatus === 'UNSUBSCRIBED') {
        changes.unsubscribed_at = new Date().toISOString();
        changes.unsubscribed_via = 'STOP';
        changes.unsubscribed_by = null;
        changes.unsubscribed_note = null;
      } else {
        // Opting back in clears it, so a stale withdrawal cannot be read as
        // current a year later - the same reason reopening clears the closed
        // sign's reason.
        changes.unsubscribed_at = null;
        changes.unsubscribed_via = null;
        changes.unsubscribed_by = null;
        changes.unsubscribed_note = null;
      }

      const { error: updateError } = await db
        .from('customers')
        .update(changes)
        .eq('id', customer.id);

      if (updateError) throw updateError;
      console.log(`${from} is now ${newStatus}`);
    }

    const body = compliance.replyFor(keyword, {
      supportEmail: site.email,
      signupUrl: `${config.baseUrl}/signup`,
    });

    // SYSTEM, not AI. Nobody owes us an answer to a STOP confirmation, and a
    // chase after one would be the exact opposite of what they asked for.
    //
    // compliance: true IS THE ONLY EXEMPTION FROM THE OPT-OUT GATE, and this is
    // the only place that passes it. notify.sendAndLog() refuses to text an
    // unsubscribed number - which is the whole point of it - and the reply to
    // STOP has to reach somebody who has, one line earlier, become exactly
    // that. It is the confirmation the law expects, and it goes because THEY
    // texted us. Nothing else may use this.
    await reply(from, body, customer ? customer.id : null, {
      kind: 'SYSTEM',
      compliance: true,
    });
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
    // A PROMO CODE OFF A DOOR HANGER, IF THERE IS ONE.
    //
    // Read BEFORE the customer row is created, because claiming a code has to
    // replace the automatic promotion rather than land on top of it - every new
    // number is granted whatever is on NEW_NUMBERS, and the free-orders offer
    // beats $10 off. Somebody scanning a card that says $10 would otherwise get
    // their whole order free, which is the one outcome Neil ruled out.
    //
    // Best effort. A promotions table having a bad day must never stop a
    // stranger being answered at all; they lose the $10, which can be put on by
    // hand, rather than being ignored.
    const scanned = await promocodes.findIn(text).catch((err) => {
      console.error(`Could not check ${from} for a promo code: ${err.message}`);
      return null;
    });

    if (scanned) console.log(`CODE    ${from} claimed "${scanned.promo.name}"`);

    // THE CANNED INTRODUCTION ONLY WHEN THERE IS NOTHING TO REPLY TO.
    //
    // The QR types the whole message, so "Hi LYNDRY - promo D00R10" carries no
    // question and a canned introduction is right - the same reasoning as the
    // website form. Anything they typed themselves on top of it goes to the AI
    // instead, because answering a script at somebody who asked a real question
    // is the robot behaviour this system exists to avoid.
    const canned = Boolean(scanned) && promocodes.isJustTheCode(text, scanned.code);

    const started = await onboarding.startConversation({
      phone: from,
      consentSource: scanned ? 'DOOR_HANGER' : 'INBOUND_TEXT',
      // No IP to record — this did not come through a browser. The evidence is
      // their own inbound message, not a form submission.
      consentIp: null,
      sendWelcome: canned,
      claimed: scanned ? scanned.promo : null,
      opening: canned ? `Hey, thanks for scanning.` : null,
    });

    if (!started.ok) {
      console.log(`Could not start a conversation with ${from}: ${started.reason}`);
      return;
    }

    // startConversation() has already said everything there is to say, so the AI
    // must not answer on top of it.
    if (canned) return;

    await burst.collect(from, text, (said) => answerWithBrain(started.customer, said, from));
    return;
  }

  // --- A real customer, with something to say ------------------------------
  //
  // Claude reads the message and picks ONE action. Our code then carries it
  // out and writes the reply, so the price and the dates in a confirmation are
  // always real values from the database rather than something a model wrote.
  // NOT ANSWERED YET - held for a few seconds in case they are still typing.
  // See src/core/burst.js. Everything downstream of this is unchanged; the AI
  // is simply handed what they said as one message instead of three.
  await burst.collect(from, text, (said) => answerWithBrain(customer, said, from));
}

// WHAT TO SAY WHEN THEIR MESSAGE ARRIVED EMPTY.
//
// The AI is not asked. There is nothing to answer, and the one useful thing to
// do is put the last question back in front of them - so this is written here,
// in code, like every other sentence nobody asked for.
//
// The repeat is dropped when it would cost more than a couple of segments. A
// blank text is somebody's phone misfiring; sending three segments of an old
// answer back at them is a worse reply than a short one.
async function replyToBlank(from, customer) {
  const { data } = await db
    .from('messages')
    .select('body')
    .eq('phone', from)
    .eq('direction', 'OUTBOUND')
    .order('created_at', { ascending: false })
    .limit(1);

  const last = ((data || [])[0] || {}).body || '';
  const lead = "Sorry, that came through blank on our end.";

  const withRepeat = `${lead} Here's my last message again: ${last}`;
  const body =
    last && notify.describeCost(notify.toPlainText(withRepeat)).segments <= 2
      ? withRepeat
      : `${lead} What were you going to say?`;

  await reply(from, body, customer ? customer.id : null, { kind: 'AI' });
}

async function answerWithBrain(customer, text, from) {
  // --- HAS SOMEBODY SWITCHED THE AI OFF FOR THIS NUMBER? -------------------
  //
  // The toggle on the conversation screen. An admin dealing with a customer
  // themselves turns it off, and the AI says NOTHING until they turn it back
  // on - not a holding line, not an apology, nothing. To the customer that is
  // simply a conversation with the person they were already talking to.
  //
  // Checked before the automatic hold below and never lifted here, because
  // this one is a person's decision and only a person reverses it. Their
  // message is already logged by the caller, so the admin sees it in the
  // thread and answers it there.
  if (await aiPause.isPaused(from)) {
    console.warn(`PAUSED  ${from}: a person is handling this conversation. Saying nothing.`);
    return;
  }

  // --- IS A PERSON HANDLING THIS CONVERSATION? -----------------------------
  //
  // NEIL'S CALL. When the AI repeats itself it has run out of road, and
  // everything it says after that makes things worse: it says the same thing a
  // third time, or it apologises, and either way the customer now knows
  // something is broken. So it says NOTHING and a person writes the next
  // message. To the customer that is a pause and then a reply from LYNDRY,
  // which is what happens at any small business when somebody goes to check.
  //
  // The hold lifts on both halves and neither alone: a person has actually
  // sent something, AND the customer has answered it - which is this message.
  // A draft nobody sent is not a reply, and a reply nobody responded to is not
  // a conversation that has resumed.
  const hold = await issues.holdFor(customer.id).catch(() => null);

  if (hold) {
    const answered = await issues.personHasReplied(customer.id, hold.created_at).catch(() => false);

    if (!answered) {
      // Their message is already logged by the caller. Silence is the whole
      // point - an auto-reply here would tell them a machine is still on it.
      console.warn(
        `HOLD    ${from}: a person owes them the next message. Saying nothing.`
      );
      return;
    }

    // A person spoke and the customer has come back. Pick the thread up.
    // Resolved by nobody in particular - no ops user did this, the customer
    // coming back did. The resolution line says so.
    await issues
      .resolve(hold.id, null, 'The customer replied after a person did, so the AI picked it back up.')
      .catch((err) => console.error(`Could not lift the AI hold: ${err.message}`));
    console.log(`HOLD    ${from}: lifted, the customer replied after a person did.`);
  }

  // What we hand Claude: the customer's profile, their current order, and the
  // last few messages so "same as last time" and "yes" mean something.
  const [order, recentMessages, recentOrders, openIssue] = await Promise.all([
    orders.findLatestInFlight(customer.id),
    recentConversation(customer.id),
    // Their own order numbers, so a complaint can be tied to the right one and
    // the AI can name it rather than asking blind.
    recentOrdersFor(customer.id),
    // Anything already with a manager, so somebody chasing a problem gets an
    // answer rather than their place in a queue read back to them.
    openIssueFor(customer.id),
  ]);

  let decision;
  try {
    // The AI's context mentions their standing orders, and a customer can have
    // more than one, so they come from their own table rather than the row.
    customer.schedules = await recurring.forCustomer(customer.id);

    // EVERY pickup they are waiting on, not just the latest. A customer can
    // have one booked per day, so "move it" and "cancel it" are ambiguous the
    // moment there are two - and the AI cannot ask which without knowing the
    // days.
    customer.openPickups = await orders.findAllAwaitingCollection(customer.id);

    decision = await brain.decide({ customer, order, recentMessages, recentOrders, openIssue, message: text });
  } catch (err) {
    // The AI being unreachable must never look like LYNDRY ignoring someone.
    console.error('Claude call failed:', err.message);
    // NEVER SEND A CUSTOMER TO EMAIL. Neil's call, and it is the whole point of
    // the product: they texted, so they get an answer in the thread. Pointing
    // somebody at an inbox is asking them to start again somewhere nobody is
    // watching - and this exact sentence went to a real customer who had just
    // given us her address, because her phone sent a blank message.
    //
    // Instead a person is told. issues.raise() texts every admin and puts the
    // thread in the queue, so "somebody will pick this up" is a promise the
    // system actually keeps rather than a sentence.
    await issues
      .raise({
        customer,
        reason: 'The AI could not be reached, so this customer got no real answer.',
        customerSaid: text,
        aiHold: true,
      })
      .catch((err) => console.error(`Could not raise an issue for the AI outage: ${err.message}`));

    await reply(
      from,
      `Sorry, I'm having trouble on my end. Someone here will pick this up shortly.`,
      customer.id,
      // An apology is not a question. Chasing somebody about our own outage a
      // day later would be worse than the outage.
      { kind: 'SYSTEM' }
    );
    return;
  }

  if (decision.type === 'text') {
    // Claude needs one detail before it can act.
    console.log(`ASK     ${from}: ${decision.text}`);
    // THE ONE THAT EARNS A FOLLOW-UP. This is the AI needing one more detail
    // before it can act, which is exactly the message somebody goes quiet on.
    await reply(from, decision.text, customer.id, { kind: 'AI' });
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
    // Again, no email address. A person is told and answers in the thread.
    await issues
      .raise({
        customer,
        reason: `The action "${decision.name}" failed, so this customer got no real answer.`,
        customerSaid: text,
        aiHold: true,
      })
      .catch((err) => console.error(`Could not raise an issue for a failed action: ${err.message}`));

    await reply(from, `Sorry, I couldn't do that just now. Someone here will pick this up shortly.`, customer.id, {
      kind: 'SYSTEM',
    });
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

  // A LOOKUP ANSWERS US, NOT THE CUSTOMER.
  //
  // check_slot returns facts - is that day possible, which window, what to say
  // instead - so it has no reply of its own. It MUST be followed by a second
  // pass that turns those facts into a sentence, or the customer receives a
  // JSON object. Which is exactly what would have happened: the follow-up below
  // was written for setup actions only, and every other action's return value
  // goes straight to the phone.
  const LOOKUP_ACTIONS = ['check_slot'];

  // Kept because `message` is about to be replaced by the model's sentence, and
  // if that second call fails we still have the facts to fall back on.
  const lookupFacts = LOOKUP_ACTIONS.includes(decision.name) ? message : null;

  if (SETUP_ACTIONS.includes(decision.name) || LOOKUP_ACTIONS.includes(decision.name)) {
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
        followUp: {
          name: decision.name,
          reply: typeof message === 'string' ? message : JSON.stringify(message),
          lookup: LOOKUP_ACTIONS.includes(decision.name),
        },
      });

      // AFTER A LOOKUP, A SETUP ACTION IS A PERFECTLY GOOD NEXT STEP.
      //
      // SETUP_ACTIONS are excluded after a setup action, to stop setup looping
      // into setup. After a LOOKUP there is no such loop to worry about, and
      // excluding them cost a real one: told "cold and no softner" the model
      // checked the slot and then reached for update_profile, which this refused
      // to run and then treated as "no reply" - so the preference was dropped
      // and the customer was told something had gone wrong.
      const isSetup = SETUP_ACTIONS.includes(followOn.name);
      const isLookup = LOOKUP_ACTIONS.includes(followOn.name);
      const setupIsFine = LOOKUP_ACTIONS.includes(decision.name);

      if (followOn.type === 'tool' && !isLookup && (!isSetup || setupIsFine)) {
        console.log(`ACTION+ ${from}: ${followOn.name} ${JSON.stringify(followOn.input)}`);
        message = await actions.run(followOn.name, followOn.input, freshCustomer || customer, helpers);
      } else if (LOOKUP_ACTIONS.includes(decision.name)) {
        // The lookup had nothing to say on its own, so the model's sentence IS
        // the reply. "OK" means it thought the previous action had already
        // answered the customer - true for a setup action, never for a lookup -
        // so that counts as nothing and the fallback below covers it.
        const written = String(followOn.text || '').trim();
        message = written && written !== 'OK' ? written : null;
      }
      // Any text answer — "OK" or otherwise — means nothing more to do, and
      // the setup action's own message is the reply.
    } catch (err) {
      // The follow-up is best effort. The setup succeeded and its message is
      // true, so that is what gets sent if deciding the next step fails.
      console.error('Follow-up decision failed:', err.message);
    }
  }

  // A LOOKUP MUST NEVER LEAVE US WITH NOTHING TO SEND. If that second pass
  // failed or came back empty, the facts themselves carry a sentence for every
  // refusal that has one - and anything else gets an honest holding line rather
  // than silence on a customer's phone.
  if (lookupFacts && (typeof message !== 'string' || !message.trim())) {
    // NEVER PROMISE TO COME BACK. The old line here was "Let me check that and
    // come straight back to you", which is a promise nothing in this system
    // keeps - a customer said "good" to a recap, got that, and asked "what are
    // you checking?". Nothing was. The yes was lost and no order existed.
    //
    // A refusal has its own wording from the booking code. Anything else is a
    // failure on our side, so it goes to a person rather than being papered
    // over with a sentence that sounds like progress.
    message =
      lookupFacts.say ||
      `Sorry - something went wrong my end. Text ${site.opsPhoneDisplay} or try that again and I'll sort it.`;

    if (!lookupFacts.say) {
      console.error(`Lookup produced no reply for ${from} - the customer was told we failed.`);
    }
  }

  // SAYING THE SAME THING TWICE MEANS WE ARE STUCK.
  //
  // A customer answered "what?", "I don't understand" and "i am confused" and
  // got the identical sentence back four times. Whatever the cause, a reply
  // that repeats the last one word for word is never the right answer: either
  // the customer did not understand it, or we did not understand them.
  //
  // So the repeat is treated as what it is - a conversation the AI cannot
  // move - and handed to a person, which is the whole point of having a
  // handoff. Checked on the words actually sent, after normalising, so a
  // stray space does not defeat it.
  const lastFromUs = [...(recentMessages || [])].reverse().find((m) => m.direction === 'OUTBOUND');
  const same = (a, b) => toPlainText(String(a || '')).trim() === toPlainText(String(b || '')).trim();

  if (lastFromUs && same(lastFromUs.body, message)) {
    // SEND NOTHING. Not the repeat, and not a handoff line either - "let me
    // get someone to help you with that" is still the machine announcing that
    // it has failed. The customer sees a pause; a person writes the next
    // message from the conversations screen.
    console.warn(`LOOP    ${from}: about to repeat the last reply. Going quiet.`);

    await issues
      .raise({
        customer,
        order: null,
        reason: 'The AI repeated itself and could not move the conversation on. It has stopped replying - send them a message yourself.',
        customerSaid: text,
        aiHold: true,
      })
      .catch((err) => console.error(`Could not raise the AI hold: ${err.message}`));

    return;
  }

  // The sentence an action produced. Marked AI because plenty of them are
  // still questions - a refused slot asks for another day, a lookup asks for an
  // address - and those are exactly the ones people go quiet on. The ones that
  // are conclusions rather than questions are filtered out anyway: a booked
  // customer is never chased.
  await reply(from, message, customer.id, { kind: 'AI' });
}

// Whatever is already with a manager for this customer, or null.
async function openIssueFor(customerId) {
  const { data, error } = await db
    .from('issues')
    .select('reason, created_at, order_id')
    .eq('customer_id', customerId)
    .eq('status', 'OPEN')
    .maybeSingle();

  if (error) {
    console.error('Could not read the open issue:', error.message);
    return null;
  }

  return data;
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
    .select('direction, body, created_at, sent_by')
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
