'use strict';

// ---------------------------------------------------------------------------
// PUT AN ORDER BACK AT THE START OF THE ROUTE.
//
// Testing the guided run means driving the same order through the same day
// several times over, and there was no way to do that without hand-writing a
// database update every time. This is that update, written down once.
//
// IT WRITES DIRECTLY AND DELIBERATELY DOES NOT GO THROUGH fulfilment.js. That
// module texts customers and charges cards on the way past; a reset must do
// neither. Same rule the seed scripts follow.
//
// WHAT SURVIVES: who the order is for, where, when, which driver, the rate and
// minimum it was quoted at, and the change log - which is append only, so the
// reset is written ON to it rather than through it. What goes is everything the
// day put on the order: the bags, the weights, the price, the laundromat, the
// payment and every timestamp.
//
//   npm run reset:order -- 1940            what it would do
//   npm run reset:order -- 1940 --write    do it
// ---------------------------------------------------------------------------

require('dotenv').config();

const db = require('../src/db');
const orderEvents = require('../src/core/order-events');

const args = process.argv.slice(2);
const write = args.includes('--write');
const wanted = args.find((a) => /^\d+$/.test(a));

// Everything the day writes on to an order. Listed rather than computed,
// because a column added later should have to be thought about here rather
// than being silently cleared or silently missed.
const CLEARED = {
  status: 'REQUESTED',

  // Where the driver is and what he has done. arrived_at and navigating_at go
  // too, so the route starts with driving there rather than at the door.
  collected_at: null,
  van_confirmed_at: null,
  at_partner_at: null,
  ready_at: null,
  delivered_at: null,
  arrived_at: null,
  navigating_at: null,
  stop_number: null,

  // The bags and what everybody's scale said.
  bag_count: null,
  weight_lb: null,
  price_cents: null,
  partner_id: null,
  partner_weight_lb: null,
  partner_weight_at: null,
  billable_weight_lb: null,
  weight_settled_at: null,
  weight_held_at: null,
  weight_band: null,
  partner_bill_lb: null,
  partner_bill_settled_at: null,
  return_bag_count: null,
  return_weight_lb: null,

  delivery_photo_path: null,
  delivery_photo_url: null,

  payment_status: 'UNPAID',
  paid_at: null,
  payment_attempts: 0,
  payment_failure_reason: null,
  discount_cents: 0,
  promotion_id: null,
};

// A bag tag goes back to being blank stock in the van, and its clip back in the
// bag of clips. The row survives - the tags are physical stock and there are
// only so many of them.
const FREED = {
  order_id: null,
  position: null,
  bound_at: null,
  bound_by: null,
  released_at: null,
  clip_number: null,
  clipped_at: null,
  unclipped_at: null,
  clip_returned_at: null,
  loaded_at: null,
  unloaded_at: null,
  collected_at: null,
  delivered_at: null,
  weight_lb: null,
  weighed_at: null,
  weight_photo_path: null,
  partner_weight_lb: null,
  partner_weight_at: null,
  finished_at: null,
  stickers_off_at: null,
  tag_off_at: null,
  intended_partner_id: null,
  partner_locked: false,
};

async function main() {
  if (!wanted) {
    console.log('');
    console.log('  Which order? Give it an order number.');
    console.log('');
    console.log('    npm run reset:order -- 1940            what it would do');
    console.log('    npm run reset:order -- 1940 --write    do it');
    console.log('');
    process.exit(1);
  }

  const { data: order, error } = await db
    .from('orders')
    .select('*')
    .eq('order_number', Number(wanted))
    .maybeSingle();

  if (error) throw error;
  if (!order) {
    console.log(`  No order #${wanted}.`);
    process.exit(1);
  }

  const labels = (await db.from('bag_labels').select('*').eq('order_id', order.id)).data || [];

  // A row with a sticker number is a bag the LAUNDROMAT packed. It did not
  // exist at the start of the day, so it is deleted rather than freed - unlike
  // the tag itself, which is a physical thing in the van.
  const packed = labels.filter((l) => l.sticker_seq != null);
  const tags = labels.filter((l) => l.sticker_seq == null);

  const spent =
    (await db.from('customer_promotions').select('id').eq('order_id', order.id)).data || [];

  const open =
    (await db.from('issues').select('id').eq('order_id', order.id).eq('status', 'OPEN')).data || [];

  const was =
    `${order.status}, ` +
    `${order.weight_lb == null ? 'unweighed' : `${order.weight_lb} lb`}, ` +
    `${order.price_cents == null ? 'no price' : `$${(order.price_cents / 100).toFixed(2)}`}, ` +
    `${order.payment_status}`;

  console.log('');
  console.log(`  Order #${order.order_number}`);
  console.log(`    now             ${was}`);
  console.log(`    back to         REQUESTED, not collected, nothing weighed`);
  console.log(`    tags freed      ${tags.map((t) => t.code).join(', ') || 'none'}`);
  console.log(
    `    rows deleted    ${
      packed.map((b) => `${b.code}-${b.sticker_seq}`).join(', ') || 'none'
    }  (bags the laundromat packed)`
  );
  console.log(`    promotions      ${spent.length ? `${spent.length} handed back` : 'none spent'}`);
  console.log(`    issues closed   ${open.length}`);

  if (!write) {
    console.log('');
    console.log('  Nothing was changed. Add --write to do it.');
    console.log('');
    return;
  }

  const { error: updateError } = await db.from('orders').update(CLEARED).eq('id', order.id);
  if (updateError) throw updateError;

  for (const bag of packed) await db.from('bag_labels').delete().eq('id', bag.id);
  for (const tag of tags) await db.from('bag_labels').update(FREED).eq('id', tag.id);

  for (const grant of spent) {
    await db
      .from('customer_promotions')
      .update({ redeemed_at: null, order_id: null })
      .eq('id', grant.id);
  }

  for (const issue of open) {
    await db
      .from('issues')
      .update({
        status: 'RESOLVED',
        resolved_at: new Date().toISOString(),
        resolution: 'Order reset for testing',
      })
      .eq('id', issue.id);
  }

  await orderEvents.record(order.id, {
    kind: 'NOTE',
    summary: 'Order reset to the start of the route for testing',
    was,
    became: 'REQUESTED, not collected, nothing weighed',
    by: { actor: 'system' },
    reason: 'npm run reset:order',
  });

  console.log('');
  console.log('  Done. The run starts with driving there again.');
  console.log('');
}

main().catch((err) => {
  console.error(`  Failed: ${err.message}`);
  process.exit(1);
});
