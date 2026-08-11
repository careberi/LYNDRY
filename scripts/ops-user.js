'use strict';

// ---------------------------------------------------------------------------
// Add, list and switch off the people who can sign in to /ops.
//
// This exists for one reason: the very first person. Signing in needs an
// ops_users row, and adding a row needs somebody signed in — so the loop has
// to be broken from outside the browser, once. After that, use the Team page.
//
// USAGE
//   npm run ops:user                              list everyone
//   npm run ops:user -- add "Neil" +12015551234   add a person
//   npm run ops:user -- off +12015551234          switch someone off
//   npm run ops:user -- on  +12015551234          switch them back on
//
// It talks to the database directly, so the server does not need to be
// running — but SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY do need to be set.
// ---------------------------------------------------------------------------

const db = require('../src/db');
const { normalisePhone, formatPhone } = require('../src/core/phone');

function bail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function list() {
  const { data, error } = await db
    .from('ops_users')
    .select('name, phone, status, last_login_at')
    .order('created_at', { ascending: true });

  if (error) bail(`Could not read ops_users: ${error.message}`);

  if (!data.length) {
    console.log('\n  Nobody can sign in yet. Add the first person:');
    console.log('    npm run ops:user -- add "Your Name" +12015551234\n');
    return;
  }

  console.log('');
  for (const person of data) {
    const when = person.last_login_at
      ? new Date(person.last_login_at).toLocaleString()
      : 'never signed in';
    console.log(
      `  ${person.status === 'ACTIVE' ? '●' : '○'} ${person.name.padEnd(18)} ${formatPhone(
        person.phone
      ).padEnd(16)} ${person.status.padEnd(9)} ${when}`
    );
  }
  console.log('');
}

async function add(name, rawPhone) {
  if (!name || !rawPhone) bail('Usage: npm run ops:user -- add "Their Name" +12015551234');

  const phone = normalisePhone(rawPhone);
  if (!phone) bail(`"${rawPhone}" is not a usable US mobile number.`);

  const { error } = await db.from('ops_users').insert({ name, phone, status: 'ACTIVE' });

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      bail(`Somebody is already set up with ${formatPhone(phone)}.`);
    }
    bail(`Could not add them: ${error.message}`);
  }

  console.log(`\n  Added ${name} — ${formatPhone(phone)}.`);
  console.log('  They can now sign in at /ops with that number.\n');
}

async function setStatus(rawPhone, status) {
  const phone = normalisePhone(rawPhone);
  if (!phone) bail(`"${rawPhone}" is not a usable US mobile number.`);

  const { data, error } = await db
    .from('ops_users')
    .update({ status })
    .eq('phone', phone)
    .select('name');

  if (error) bail(`Could not update them: ${error.message}`);
  if (!data.length) bail(`Nobody is set up with ${formatPhone(phone)}.`);

  console.log(`\n  ${data[0].name} is now ${status}.\n`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case undefined:
    case 'list':
      return list();
    case 'add':
      return add(rest[0], rest[1]);
    case 'off':
      return setStatus(rest[0], 'DISABLED');
    case 'on':
      return setStatus(rest[0], 'ACTIVE');
    default:
      bail(`Unknown command "${command}". Try: list, add, off, on`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => bail(`Failed: ${err.message}`));
