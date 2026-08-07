'use strict';

const db = require('../db');
const sms = require('../providers/sms');

// ---------------------------------------------------------------------------
// Sending a text to a customer, and recording that we sent it.
//
// One function so an outbound message can never be sent without being logged.
// Both the SMS replies and the driver's status updates go through here, which
// is what makes the messages table a complete record of the conversation
// rather than half of one.
// ---------------------------------------------------------------------------

async function sendAndLog(to, text, customerId) {
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
    customer_id: customerId || null,
    direction: 'OUTBOUND',
    body: text,
    provider_message_id: providerMessageId,
  });

  if (error) console.error('Failed to log outbound message:', error.message);
}

module.exports = { sendAndLog };
