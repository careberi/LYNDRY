'use strict';

// ---------------------------------------------------------------------------
// ONE-OFF: book Francisco Perez a pickup today at 10am and send it to Fancy K.
//
// Neil asked for this on 26 September and the sandbox refused every attempt to
// write to production from the assistant's side, twice, so it is a script he runs
// himself. Delete it once it has been run - it is a one-off and a script that
// books one named customer is not something to keep.
//
// STRIPE IS SWITCHED OFF DELIBERATELY, AND THAT IS THE IMPORTANT LINE.
// `.env.production.local` carries the PRODUCTION Supabase project and a TEST
// Stripe key. `authorizeShowUp()` cannot tell a sandbox from a dead card and must
// not try, so a hold attempted with that pairing comes back "No such
// PaymentMethod" and is recorded as the CUSTOMER'S CARD REFUSING - which sets
// `authorization_refused_at`, and `collectable()` then takes the stop off the
// round. That is exactly what happened to order #2073 on 18 September.
//
// With no key at all, `authorizeShowUp()` returns `{ ok: true, skipped:
// 'payments_off' }`, writes nothing, and the order is left UNASKED - which
// CLAUDE.md is emphatic is collectable and must stay that way. No hold is placed;
// the card on file is still charged at the weigh-in.
//
// NOTHING IS TEXTED TO THE CUSTOMER. `bookPickup()` does not send the
// confirmation - every caller does that itself - and this one does not. The admin
// order alert inside `bookPickup()` still fires, and locally the SMS driver
// resolves to the fake one, so that prints rather than sends.
//
//   node scripts/book-francisco.js -- --live            (dry run, writes nothing)
//   node scripts/book-francisco.js -- --live --write    (books it)
// ---------------------------------------------------------------------------

// Before anything reads it. dotenv does not overwrite a key already present.
process.env.STRIPE_SECRET_KEY = '';

const { config } = require('../src/config');
const db = require('../src/db');
const booking = require('../src/core/booking');
const orderEvents = require('../src/core/order-events');

const WRITE = process.argv.includes('--write');

const PHONE = '+19733370078';
const FANCY_K = '4be3bca9-7897-40a1-adff-4460e4fc4528';

// THE TIME IS AN ARGUMENT, and it barely matters which one you pass: a named time
// is turned into the WINDOW it falls in, so 10:00 and 10:05 are both the 10am to
// 12pm run and produce an identical order. It is here so the time is not baked
// into a file nobody wants to edit.
//
//   node scripts/book-francisco.js -- --live --write --at=10:05
const AT = (process.argv.find((a) => a.startsWith('--at=')) || '--at=10:00').slice(5);

(async () => {
  console.log(config.describeTarget());
  console.log(`stripe: ${config.stripe.secretKey ? 'SET - STOP, a hold would be recorded as a refusal' : 'off (safe)'}`);
  console.log(`sms:    ${require('../src/providers/sms').name}`);
  console.log('');

  const { data: customer, error } = await db
    .from('customers')
    .select('*')
    .eq('phone', PHONE)
    .maybeSingle();

  if (error) throw error;
  if (!customer) return console.error(`No customer on ${PHONE}.`);

  const { data: me } = await db
    .from('ops_users')
    .select('id, name')
    .eq('role', 'ADMIN')
    .eq('status', 'ACTIVE')
    .limit(1)
    .maybeSingle();

  const today = booking.today();

  console.log(`${customer.name} - ${today} at ${AT}, placed by ${me ? me.name : 'nobody'}`);

  // THE SAME RULES THE AI AND THE WEBSITE RUN, asked first so a dry run can say
  // whether it would work. It writes nothing.
  const slot = await booking.checkSlot(customer, { pickupDate: today, pickupTime: AT });
  console.log('');
  console.log(slot.ok ? `slot: fine - ${slot.window.start}-${slot.window.end}` : `slot: REFUSED - ${slot.say || slot.reason}`);

  if (!WRITE) {
    console.log('');
    console.log('DRY RUN. Nothing was written. Run again with --write to book it.');
    return;
  }

  const result = await booking.bookPickup(customer, {
    pickupDate: today,
    pickupTime: AT,
    placedVia: booking.DOORS.PHONE,
    // The whole row, not the id: order_events needs a name to put on the change.
    placedBy: me || null,
  });

  if (!result.ok) {
    console.error('');
    console.error(`REFUSED: ${result.reason}${result.detail ? ` - ${result.detail}` : ''}`);
    return;
  }

  const order = result.order;
  console.log('');
  console.log(`BOOKED #${order.order_number}`);
  console.log(`  ${order.pickup_date}  ${order.pickup_window_start}-${order.pickup_window_end}`);
  console.log(`  status ${order.status} / ${order.payment_status}`);
  console.log(`  hold   ${order.authorization_intent_id ? 'placed' : 'none - UNASKED, which is collectable'}`);
  console.log(`  refused ${order.authorization_refused_at ? 'YES - SOMETHING IS WRONG' : 'no'}`);

  // PIN IT TO FANCY K. `intended_partner_id` alone is the booking-time PLAN and
  // goes stale; the two pinned columns are what tell `dispatch.dropoffGroups()` a
  // PERSON decided, so the pin beats the router's own choice.
  const { error: pinError } = await db
    .from('orders')
    .update({
      intended_partner_id: FANCY_K,
      partner_pinned_at: new Date().toISOString(),
      partner_pinned_by: me ? me.id : null,
    })
    .eq('id', order.id);

  console.log(`  Fancy K: ${pinError ? `FAILED - ${pinError.message}` : 'pinned'}`);

  await orderEvents
    .record(order.id, {
      kind: 'NOTE',
      summary: 'Routed to Fancy K Laundry by hand',
      became: 'Fancy K Laundry',
      by: { actor: me ? me.name : 'ops' },
      reason: 'Pinned at booking, so the router does not re-decide it',
    })
    .catch((err) => console.error(`  change log: ${err.message}`));

  console.log('');
  console.log(`  https://lyndry.com/ops/orders/${order.order_number}`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
