'use strict';

// ---------------------------------------------------------------------------
// The laundromat demo.
//
//   npm run demo            set it up, and print the links
//   npm run demo -- --clear take it all away again
//
// WHAT IT IS FOR. Sitting with a laundromat owner and letting them point their
// OWN phone at a sticker. What they see is not a mock-up of the page - it is
// the page, served by the running system from real rows, because the argument
// being made is "this is all you ever have to do" and a screenshot does not
// prove that.
//
// WHY IT IS A SCRIPT AND NOT A SECOND DEPLOYMENT. CLAUDE.md rules out a second
// deployment target, and it is right to: a demo server drifts from production
// the first time somebody forgets to deploy it, and then the demo is of
// something that no longer exists. This lives in the real database for the
// twenty minutes you need it and is then removed.
//
// WHAT KEEPS IT SAFE, because it IS production:
//
//   The customer's number is in the 555-0100 range reserved for fiction, and
//   notify.js REFUSES to hand any number in that range to the carrier. Nothing
//   here can text a real person, however far the demo is driven.
//
//   Every name is prefixed DEMO, so an order on the board is unmistakable.
//
//   Nothing has a card, so nothing can be charged.
//
//   --clear removes every row it made, matched on the fictional number rather
//   than on anything it remembered, so it works even if the script is run
//   twice or a previous run died halfway.
// ---------------------------------------------------------------------------

const db = require('../src/db');
const bags = require('../src/core/bags');
const booking = require('../src/core/booking');
const { config } = require('../src/config');

// THE LINK MUST POINT AT THE PUBLIC SITE, NOT AT THIS LAPTOP.
//
// The script is run locally but writes to the production database, so
// config.baseUrl here is http://localhost:3000 while the person scanning the
// sticker is on their own phone. A localhost QR code in front of a laundromat
// owner is the whole demo failing at the first step.
//
// The signature does not care: it is keyed on ADMIN_API_KEY, which is the same
// on both, so a code signed here validates on lyndry.com.
const PUBLIC_BASE = /localhost|127\.0\.0\.1/.test(config.baseUrl)
  ? 'https://lyndry.com'
  : config.baseUrl;

function publicLabelUrl(code) {
  return `${PUBLIC_BASE}/o/${code}?t=${bags.signCode(code)}`;
}

const CLEAR = process.argv.includes('--clear');

// 555-0100..0199 is the range reserved for fiction, and notify.js will not send
// to it. Do not move this outside that range.
const PHONE = '+12015550170';

// Memorable, and still legal: Crockford base32 has no I, L, O or U, and folds
// O to 0 on the way in. DEM001 survives that untouched, which matters because
// a code that changes when it is typed is a code that will not scan.
const CODES = ['DEM001', 'DEM002', 'DEM003'];

async function clear() {
  const { data: customer } = await db
    .from('customers')
    .select('id')
    .eq('phone', PHONE)
    .maybeSingle();

  if (customer) {
    const { data: orders } = await db
      .from('orders')
      .select('id')
      .eq('customer_id', customer.id);

    for (const order of orders || []) {
      await db.from('bag_label_scans').delete().eq('order_id', order.id);
      await db.from('bag_labels').delete().eq('order_id', order.id);
      await db.from('order_events').delete().eq('order_id', order.id);
    }

    await db.from('orders').delete().eq('customer_id', customer.id);
    await db.from('customer_promotions').delete().eq('customer_id', customer.id);
    await db.from('messages').delete().eq('customer_id', customer.id);
    await db.from('customers').delete().eq('id', customer.id);
  }

  // The stickers go back to being BLANK rather than being deleted, so running
  // the demo again reuses the same three codes and any sticker printed last
  // time still works.
  await db
    .from('bag_labels')
    .update({
      order_id: null, position: null, bound_at: null, released_at: null,
      weight_lb: null, weighed_at: null, weight_photo_path: null,
      partner_weight_lb: null, partner_weight_at: null,
      clip_number: null, clipped_at: null, unclipped_at: null,
      loaded_at: null, delivered_at: null,
    })
    .in('code', CODES);

  console.log('  demo cleared. The three stickers are blank again.');
}

(async () => {
  if (CLEAR) {
    console.log('\nRemoving the demo:\n');
    await clear();
    process.exit(0);
  }

  // Always start clean, so running it twice is safe and one command resets
  // between two meetings.
  await clear();
  console.log('');

  const { data: customer, error: cErr } = await db
    .from('customers')
    .insert({
      phone: PHONE,
      name: 'DEMO Customer',
      address_line1: '14 Demo Street',
      city: 'Fair Lawn',
      state: 'NJ',
      postal_code: '07410',
      status: 'ACTIVE',
      sms_consent_source: 'INBOUND_TEXT',
      sms_consent_at: new Date().toISOString(),
      // The five fields their page actually shows, chosen so the screen is not
      // all defaults - a page reading "cold, standard, no" tells an owner
      // nothing about whether it can carry a real instruction.
      preferences: {
        water_temp: 'COLD',
        detergent: 'HYPOALLERGENIC',
        fabric_softener: false,
        hang_dry: true,
        separate_darks: true,
        dropoff_spot: 'Side door under the awning',
      },
    })
    .select('*')
    .single();

  if (cErr) throw cErr;

  // Collected this morning, so the countdown reads like a real one rather than
  // a full day or an expired one.
  const collected = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

  const { data: order, error: oErr } = await db
    .from('orders')
    .insert({
      customer_id: customer.id,
      status: 'AT_PARTNER', // the one status where their weight box appears
      pickup_date: booking.today(),
      collected_at: collected,
      bag_count: 3,
      price_per_lb_cents: 200,
      minimum_cents: 2500,
    })
    .select('*')
    .single();

  if (oErr) throw oErr;

  // Three stickers, each already weighed by our driver - which is what makes
  // their own weight a cross-check rather than the first number anybody has.
  const OURS = [12.4, 9.8, 15.2];

  for (let i = 0; i < CODES.length; i += 1) {
    const code = CODES[i];

    const row = {
      code,
      order_id: order.id,
      leg: 'PICKUP',
      position: i + 1,
      bound_at: collected,
      weight_lb: OURS[i],
      weighed_at: collected,
    };

    // Upsert on the fixed code, so a sticker printed for an earlier demo keeps
    // working for ever.
    const { data: existing } = await db
      .from('bag_labels')
      .select('id')
      .eq('code', code)
      .maybeSingle();

    if (existing) {
      const { error } = await db.from('bag_labels').update(row).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await db.from('bag_labels').insert(row);
      if (error) throw error;
    }
  }

  const total = OURS.reduce((a, b) => a + b, 0);

  const { error: wErr } = await db
    .from('orders')
    .update({
      weight_lb: total,
      price_cents: Math.max(Math.round(total * 200), 2500),
    })
    .eq('id', order.id);

  if (wErr) throw wErr;

  console.log(`Demo ready. Order #${order.order_number}, 3 bags, ${total.toFixed(1)} lb on our scale.\n`);
  console.log('Point a phone camera at any of these, or just open them:\n');
  for (const code of CODES) console.log(`  ${code}   ${publicLabelUrl(code)}`);

  if (PUBLIC_BASE !== config.baseUrl) {
    console.log(`
  (Links point at ${PUBLIC_BASE}, not this laptop, so they work on their phone.)`);
  }

  console.log(`
What they see, which is their whole job:

  the wash settings, five fields and no free text
  which bag of how many, and the order number
  a countdown to when it is due back
  a box to type their own weight
  a button to say it is ready

What they do NOT see, and it is worth saying out loud in the meeting:

  no name, no address, no phone number, no price
  no login, no app, no account

Print the stickers from /ops/labels, or just open a link on their phone.

When you are done:  npm run demo -- --clear
`);

  process.exit(0);
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
