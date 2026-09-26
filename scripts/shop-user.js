'use strict';

// ---------------------------------------------------------------------------
// Add, list and switch off the people at a laundromat who can sign in to /shop.
//
// The same shape as `ops-user.js` and for a related reason: a partner has no way
// to add their own staff and must not have one - who can see a shop's orders is
// our decision, not theirs. There is an ops screen for this too; this is the
// terminal version, which is what works when you are on the phone to a shop
// owner reading numbers out.
//
// USAGE
//   npm run shop:user                                             list everyone
//   npm run shop:user -- add "Riverside" "Maria" +12015551234      add a person
//   npm run shop:user -- off +12015551234                    switch someone off
//   npm run shop:user -- on  +12015551234                 switch them back on
//
// The laundromat is matched on any part of its name, case-insensitively, and an
// ambiguous match is refused rather than guessed at - adding somebody to the
// wrong shop gives them another shop's orders.
//
// It talks to the database directly, so the server does not need to be running.
// ---------------------------------------------------------------------------

const db = require('../src/db');
const { config } = require('../src/config');
const { normalisePhone, formatPhone } = require('../src/core/phone');

function bail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

// WHICH DATABASE, SAID OUT LOUD, EVERY TIME. The rule every script here follows
// since there were two of them: this one creates credentials, and doing it to the
// wrong database is not a thing to discover later.
function banner() {
  console.log(
    `\n  ${config.supabase.isProduction ? 'PRODUCTION' : 'development'} database (${config.supabase.projectRef})`
  );
}

async function list() {
  const { data, error } = await db
    .from('partner_users')
    .select('name, phone, status, last_login_at, partners(name)')
    .order('created_at', { ascending: true });

  if (error) bail(`Could not read partner_users: ${error.message}`);

  if (!data || !data.length) {
    console.log('\n  Nobody at any laundromat can sign in yet. Add somebody:');
    console.log('    npm run shop:user -- add "Riverside" "Maria" +12015551234\n');
    return;
  }

  console.log('');
  for (const row of data) {
    const shop = (row.partners && row.partners.name) || '(no laundromat)';
    const seen = row.last_login_at ? new Date(row.last_login_at).toISOString().slice(0, 10) : 'never';
    console.log(
      `  ${row.status === 'ACTIVE' ? 'on ' : 'off'}  ${String(shop).padEnd(24)} ${String(row.name).padEnd(18)} ${formatPhone(row.phone)}   last in: ${seen}`
    );
  }
  console.log('');
}

// AN AMBIGUOUS NAME IS REFUSED, NEVER RESOLVED BY PICKING THE FIRST. The cost of
// guessing here is an attendant reading another shop's orders.
async function findShop(nameOrId) {
  const asked = String(nameOrId || '').trim();
  if (!asked) bail('Which laundromat? Give part of its name, or its id.');

  const { data, error } = await db
    .from('partners')
    .select('id, name, status, type')
    .eq('type', 'LAUNDROMAT');

  if (error) bail(`Could not read partners: ${error.message}`);

  const byId = (data || []).find((p) => p.id === asked);
  if (byId) return byId;

  const needle = asked.toLowerCase();
  const hits = (data || []).filter((p) => String(p.name).toLowerCase().includes(needle));

  if (!hits.length) {
    console.error('\n  No laundromat matches that. The ones on the books:');
    for (const p of data || []) console.error(`    ${p.status.padEnd(9)} ${p.name}`);
    process.exit(1);
  }

  if (hits.length > 1) {
    console.error('\n  That matches more than one laundromat, so nothing was done:');
    for (const p of hits) console.error(`    ${p.name}`);
    console.error('');
    process.exit(1);
  }

  return hits[0];
}

async function add(shopName, name, rawPhone) {
  const phone = normalisePhone(rawPhone);
  if (!name || !phone) {
    bail('Usage: npm run shop:user -- add "Riverside" "Maria" +12015551234');
  }

  const shop = await findShop(shopName);

  if (shop.status !== 'ACTIVE') {
    // Not refused: a shop being set up before it goes live is ordinary, and the
    // portal itself refuses an inactive one on every request, so nothing is
    // reachable early. Said out loud so it is not a surprise.
    console.log(`\n  Note: ${shop.name} is ${shop.status}, so the portal will refuse them until it is ACTIVE.`);
  }

  const { data, error } = await db
    .from('partner_users')
    .insert({ partner_id: shop.id, name, phone })
    .select('id, name, phone')
    .maybeSingle();

  if (error) {
    // The phone column is unique across every laundromat, which is deliberate: a
    // number that signs in has to resolve to exactly one shop.
    if (String(error.message).includes('duplicate') || error.code === '23505') {
      bail(`${formatPhone(phone)} can already sign in somewhere. Switch that row off first, or use another number.`);
    }
    bail(`Could not add them: ${error.message}`);
  }

  console.log(`\n  Added ${data.name} at ${shop.name} - ${formatPhone(data.phone)}`);
  console.log('  They sign in at /shop with their mobile number.\n');
}

async function setStatus(rawPhone, status) {
  const phone = normalisePhone(rawPhone);
  if (!phone) bail(`Usage: npm run shop:user -- ${status === 'ACTIVE' ? 'on' : 'off'} +12015551234`);

  const { data, error } = await db
    .from('partner_users')
    .update({
      status,
      // SWITCHING SOMEBODY OFF ENDS THEIR SESSION NOW, not in eight hours.
      // `requirePartner` re-reads the row every request, so clearing the token
      // as well is belt and braces - but an attendant who has just been let go is
      // exactly the case where both belts matter.
      ...(status === 'ACTIVE' ? {} : { session_token: null }),
    })
    .eq('phone', phone)
    .select('name, phone, partners(name)')
    .maybeSingle();

  if (error) bail(`Could not change them: ${error.message}`);
  if (!data) bail(`Nobody at a laundromat has the number ${formatPhone(phone)}.`);

  const shop = (data.partners && data.partners.name) || 'their laundromat';
  console.log(`\n  ${data.name} at ${shop} is now ${status === 'ACTIVE' ? 'able' : 'unable'} to sign in.\n`);
}

(async () => {
  banner();

  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === 'list') return list();
  if (command === 'add') return add(rest[0], rest[1], rest[2]);
  if (command === 'off') return setStatus(rest[0], 'DISABLED');
  if (command === 'on') return setStatus(rest[0], 'ACTIVE');

  bail(`Don't know "${command}". Try: list, add, off, on.`);
})().catch((err) => bail(err.message));
