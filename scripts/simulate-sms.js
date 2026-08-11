'use strict';

// ---------------------------------------------------------------------------
// Pretend a customer texted us.
//
// This is how you test the whole system without a working phone number.
// It builds the exact webhook our SMS provider would send, posts it to the
// running server, then shows you the conversation that resulted.
//
// USAGE
//   npm run sms                          send the DEFAULT_MESSAGE below
//   npm run sms -- "laundry tomorrow"    send your own text
//   npm run sms -- STOP                  test opting out
//   npm run sms -- START                 test opting back in
//   npm run sms -- HELP                  test the help reply
//
//   npm run sms -- --from +15551234567 "hello"   text from another number
//   npm run sms -- --repeat "laundry tomorrow"   send it twice, to prove
//                                                duplicates are ignored
//
// The server needs to be running (npm run dev) in another terminal.
// ---------------------------------------------------------------------------

// ---- Edit these freely ----------------------------------------------------

// What gets sent when you don't pass a message.
const DEFAULT_MESSAGE = 'laundry tomorrow';

// Who it appears to come from. This is Neil from the seed script — change it
// to any number to test how we treat someone we don't recognise.
const DEFAULT_FROM = '+14437452665';

// ---------------------------------------------------------------------------

const { config } = require('../src/config');
const db = require('../src/db');

const SERVER = config.baseUrl;
const TO = config.telnyx.phoneNumber || '+12013899218';

// --- Read the command line -------------------------------------------------

function parseArgs(argv) {
  const options = { from: DEFAULT_FROM, repeat: false, words: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--from') {
      i += 1;
      options.from = argv[i];
    } else if (arg === '--repeat') {
      options.repeat = true;
    } else {
      options.words.push(arg);
    }
  }

  options.message = options.words.join(' ') || DEFAULT_MESSAGE;
  return options;
}

// --- Build the webhook -----------------------------------------------------

// Shaped exactly like a real inbound message webhook, so the simulated text
// travels through identical code to a real one. Nothing is special-cased.
function buildWebhook({ from, text, messageId }) {
  return {
    data: {
      event_type: 'message.received',
      id: `evt-${messageId}`,
      occurred_at: new Date().toISOString(),
      record_type: 'event',
      payload: {
        id: messageId,
        direction: 'inbound',
        from: { phone_number: from, carrier: 'Simulator', line_type: 'Wireless' },
        to: [{ phone_number: TO, status: 'delivered' }],
        text,
        received_at: new Date().toISOString(),
      },
    },
  };
}

async function post(webhook) {
  const response = await fetch(`${SERVER}/sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhook),
  });

  return response.status;
}

// --- Show what happened ----------------------------------------------------

// Has the server finished with our message yet? It is recorded before any
// reply is sent, so once the inbound row exists the work is under way.
async function hasReplyTo(messageId) {
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('provider_message_id', messageId)
    .maybeSingle();

  return Boolean(data);
}

async function showConversation(phone) {
  const { data: customer } = await db
    .from('customers')
    .select('id, name, status')
    .eq('phone', phone)
    .maybeSingle();

  let query = db.from('messages').select('direction, body, created_at').order('created_at', { ascending: false }).limit(6);

  // Messages from an unknown number have no customer attached, so fall back to
  // simply showing the most recent traffic.
  if (customer) query = query.eq('customer_id', customer.id);

  const { data: messages, error } = await query;
  if (error) {
    console.error('Could not read the message log:', error.message);
    return;
  }

  console.log('');
  console.log(`  Conversation with ${phone}${customer ? ` (${customer.name})` : ' — not a customer'}`);
  if (customer) console.log(`  Account status: ${customer.status}`);
  console.log('  ' + '-'.repeat(60));

  for (const message of (messages || []).reverse()) {
    const who = message.direction === 'INBOUND' ? 'THEM' : 'US  ';
    console.log(`  ${who} | ${message.body}`);
  }

  console.log('  ' + '-'.repeat(60));
  console.log('');
}

// --- Run -------------------------------------------------------------------

async function main() {
  const { from, message, repeat } = parseArgs(process.argv.slice(2));
  const messageId = `sim-${Date.now()}`;

  console.log('');
  console.log(`  Sending to ${SERVER}/sms`);
  console.log(`  From: ${from}`);
  console.log(`  Text: ${message}`);
  console.log('');

  const webhook = buildWebhook({ from, text: message, messageId });

  const status = await post(webhook);
  console.log(`  Server replied HTTP ${status}`);

  if (status === 403) {
    console.log('');
    console.log('  Rejected for a bad signature. That means the server is running');
    console.log('  against real Telnyx credentials, and this simulator cannot forge');
    console.log('  a valid signature — which is exactly the protection working.');
    console.log('  Clear TELNYX_API_KEY and TELNYX_PUBLIC_KEY in .env to simulate.');
    console.log('');
    return;
  }

  if (repeat) {
    // Same message id — this is what a carrier retry looks like. The server
    // should log it as a duplicate and do nothing.
    const again = await post(webhook);
    console.log(`  Sent the identical message again: HTTP ${again}`);
    console.log('  (the server should ignore it as a duplicate)');
  }

  // The server answers the webhook immediately and does the real work
  // afterwards, so wait for the reply to actually land before showing the
  // conversation. Checking a few times beats one fixed pause — a cold start
  // or a restart can otherwise make it look like nothing happened.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (await hasReplyTo(messageId)) break;
  }

  await showConversation(from);
}

main().catch((err) => {
  console.error('');
  console.error('  Simulation failed:', err.message);
  console.error('  Is the server running? Start it with:  npm run dev');
  console.error('');
  process.exit(1);
});
