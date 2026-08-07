'use strict';

// ---------------------------------------------------------------------------
// Drive an order through the day, the way the driver will.
//
// There is no admin screen yet, so this is how you run and test the operations
// side. Every command below hits the same /ops endpoints a driver's phone
// would, using the same admin key.
//
// USAGE
//   npm run driver                          today's run sheet
//   npm run driver -- today                 same thing
//
//   npm run driver -- collected <order-id>  you have the bag
//   npm run driver -- weight <order-id> 18.5   record pounds, sets the price
//   npm run driver -- out <order-id>        out for delivery
//   npm run driver -- delivered <order-id>  delivered, with a photo
//
//   npm run driver -- delivered <order-id> ./porch.jpg   use your own photo
//
// The customer gets a text at every step. With no Telnyx credentials set,
// those print in the server's terminal instead of being sent.
// ---------------------------------------------------------------------------

const fs = require('fs');
const { config } = require('../src/config');

const SERVER = config.baseUrl;
const KEY = config.adminApiKey;

if (!KEY) {
  console.error('\n  ADMIN_API_KEY is not set in .env — the ops endpoints will refuse everything.\n');
  process.exit(1);
}

// --- Talking to the server --------------------------------------------------

async function call(method, path, { body, form } = {}) {
  const headers = { 'x-admin-key': KEY };
  let payload;

  if (form) {
    payload = form; // fetch sets the multipart boundary itself
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${SERVER}${path}`, { method, headers, body: payload });
  const text = await response.text();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 400) };
  }

  return { status: response.status, body: parsed };
}

function report(label, { status, body }) {
  const ok = status >= 200 && status < 300;
  console.log('');
  console.log(`  ${label}: HTTP ${status}${ok ? '' : '  <- refused'}`);
  for (const [k, v] of Object.entries(body)) {
    if (v === null || v === undefined || v === false) continue;
    console.log(`    ${k}: ${v}`);
  }
  console.log('');
  return ok;
}

// --- The run sheet ----------------------------------------------------------

function printGroup(title, list) {
  if (!list || list.length === 0) return;

  console.log(`  ${title.toUpperCase()}  (${list.length})`);
  console.log('  ' + '-'.repeat(66));

  for (const o of list) {
    console.log(`  ${o.name}   ${o.phone}`);
    console.log(`    ${o.address}`);
    const bits = [
      `pickup ${o.pickup_date}`,
      o.pickup_method === 'HAND_TO_DRIVER' ? 'hand to driver' : 'leave outside',
      o.bag_count ? `${o.bag_count} bag${o.bag_count > 1 ? 's' : ''}` : null,
      o.weight_lb ? `${o.weight_lb} lb` : null,
      o.price || null,
    ].filter(Boolean);
    console.log(`    ${bits.join('  |  ')}`);
    if (o.standing_instructions) console.log(`    note: ${o.standing_instructions}`);
    if (o.notes) console.log(`    this order: ${o.notes}`);
    console.log(`    id: ${o.order_id}`);
    console.log('');
  }
}

async function showToday() {
  const { status, body } = await call('GET', '/ops/today');

  if (status !== 200) {
    console.error(`\n  Could not load the run sheet: HTTP ${status}`);
    console.error(`  ${JSON.stringify(body)}\n`);
    return;
  }

  console.log('');
  console.log(`  LYNDRY — ${body.date}`);
  console.log('');

  printGroup('collect today', body.pickups);
  printGroup('needs weighing', body.awaiting_weight);
  printGroup('washing', body.washing);
  printGroup('deliver today', body.out_for_delivery);
  printGroup('booked for later', body.upcoming_pickups);

  const total =
    body.pickups.length +
    body.awaiting_weight.length +
    body.washing.length +
    body.out_for_delivery.length +
    body.upcoming_pickups.length;

  if (total === 0) console.log('  Nothing on. No open orders.\n');
}

// --- A placeholder photo, so delivery can be tested without a camera --------

// A 1x1 PNG. Enough to prove the upload, the storage bucket and the signed
// link all work; swap in a real photo by passing a path.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// --- Run --------------------------------------------------------------------

async function main() {
  const [command, orderId, extra] = process.argv.slice(2);

  if (!command || command === 'today') return showToday();

  if (!orderId) {
    console.error(`\n  Which order? Run "npm run driver" to see the ids.\n`);
    process.exit(1);
  }

  switch (command) {
    case 'collected':
      report('collected', await call('POST', '/ops/collected', { body: { order_id: orderId } }));
      break;

    case 'weight': {
      if (!extra) {
        console.error('\n  How many pounds? e.g. npm run driver -- weight <id> 18.5\n');
        process.exit(1);
      }
      report('weighed', await call('POST', '/ops/weight', { body: { order_id: orderId, weight_lb: Number(extra) } }));
      break;
    }

    case 'out':
      report('out for delivery', await call('POST', '/ops/out-for-delivery', { body: { order_id: orderId } }));
      break;

    case 'delivered': {
      const photo = extra ? fs.readFileSync(extra) : TINY_PNG;
      const name = extra || 'placeholder.png';

      const form = new FormData();
      form.append('order_id', orderId);
      form.append('photo', new Blob([photo], { type: extra ? 'image/jpeg' : 'image/png' }), name);

      report('delivered', await call('POST', '/ops/delivered', { form }));
      if (!extra) console.log('  (used a placeholder image — pass a file path to send a real one)\n');
      break;
    }

    default:
      console.error(`\n  Unknown command "${command}". Try: today, collected, weight, out, delivered\n`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('');
  console.error('  Failed:', err.message);
  console.error('  Is the server running? Start it with:  npm run dev');
  console.error('');
  process.exit(1);
});
