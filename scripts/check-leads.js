'use strict';

require('dotenv').config();

const db = require('../src/db');
const leads = require('../src/core/leads');
const promotions = require('../src/core/promotions');
const { normalisePhone, formatPhone } = require('../src/core/phone');
const { toPlainText } = require('../src/core/notify');

// ---------------------------------------------------------------------------
// WHO IS ON THE FACEBOOK LEAD SHEET, AND WHAT WOULD HAPPEN TO THEM.
//
//   npm run leads
//
// READS ONLY. It writes nothing, texts nobody, and creates no customers - it
// runs the same gate the sweep runs and prints the answer instead of acting on
// it. That matters more here than anywhere else in this codebase: the dev
// server shares the production database, so a script that "just tested" the
// sweep would mark real leads as texted while the fake provider swallowed the
// message, and production would then never text them again.
//
// It exists because a lead that is deliberately not texted looks exactly like
// one the system missed. Three of the first four people who filled the form in
// left the consent box unticked, so most of the sheet is skipped on purpose,
// and this is the screen that says so out loud.
// ---------------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);

async function main() {
  const url = leads.sheetUrl();

  if (!url) {
    console.log('No sheet configured. Set LEADS_SHEET_ID.');
    return;
  }

  console.log(`\nReading ${url}\n`);

  const { ok, reason, rows } = await leads.fetchLeads();

  if (!ok) {
    console.log(`Could not read it: ${reason}`);
    return;
  }

  if (!rows.length) {
    console.log('The sheet is empty - no leads yet.');
    return;
  }

  const { data: recorded } = await db.from('facebook_leads').select('lead_id, texted_at, skipped');
  const known = new Map((recorded || []).map((r) => [r.lead_id, r]));

  // What a brand new number would be given right now. Read once, because it is
  // the same answer for everybody on the sheet.
  const promo = await promotions.autoGrant();
  const left = await promotions.ordersLeft(promo);

  const counts = { texted: 0, would: 0, skipped: 0 };

  console.log(pad('NUMBER', 16) + pad('TICKED', 8) + pad('AD', 22) + 'WHAT HAPPENS');
  console.log('-'.repeat(94));

  // Oldest first, the order the sweep works in.
  for (const row of rows.slice().reverse()) {
    const phone = normalisePhone(String(row.phone || '').replace(/^p:/i, ''));
    const consented = String(row.i_agree_to_receive_text_messages_from_lyndry || '')
      .trim()
      .toLowerCase();

    let verdict;

    const seen = known.get(String(row.id || '').trim());

    if (seen && seen.texted_at) {
      verdict = `already texted ${new Date(seen.texted_at).toLocaleString()}`;
      counts.texted += 1;
    } else if (seen) {
      verdict = `already dealt with - ${seen.skipped || 'no reason recorded'}`;
      counts.skipped += 1;
    } else if (!phone) {
      verdict = 'SKIP - the number on the form is not usable';
      counts.skipped += 1;
    } else if (consented !== 'true') {
      verdict = 'SKIP - they did not tick the box to be texted';
      counts.skipped += 1;
    } else {
      const { data: customer } = await db
        .from('customers')
        .select('id, name, status')
        .eq('phone', phone)
        .maybeSingle();

      if (customer && customer.status === 'UNSUBSCRIBED') {
        verdict = 'SKIP - that number has opted out';
        counts.skipped += 1;
      } else if (customer) {
        verdict = `SKIP - already a customer${customer.name ? ` (${customer.name})` : ''}`;
        counts.skipped += 1;
      } else {
        verdict = 'WOULD TEXT on the next sweep';
        counts.would += 1;
      }
    }

    console.log(
      pad(phone ? formatPhone(phone) : row.phone, 16) +
        pad(consented === 'true' ? 'yes' : 'NO', 8) +
        pad(String(row.ad_name || '').slice(0, 20), 22) +
        verdict
    );
  }

  console.log('-'.repeat(94));
  console.log(
    `${rows.length} on the sheet: ${counts.would} waiting to be texted, ` +
      `${counts.texted} already texted, ${counts.skipped} skipped.\n`
  );

  // --- The offer -----------------------------------------------------------
  if (!promo) {
    console.log('No promotion is being given to new numbers, so nothing is promised.\n');
  } else {
    console.log(
      `New numbers are being given "${promo.name}"` +
        (left === null ? ' (no limit).' : ` - ${left} of ${promo.max_orders} free orders left.`)
    );
    if (left === 0) {
      console.log('It has run out, so the message goes out WITHOUT the offer in it.');
    }
    console.log();
  }

  // --- The message ---------------------------------------------------------
  const text = toPlainText(leads.leadMessage({ promo: left === 0 ? null : promo }));
  const segments = text.length <= 160 ? 1 : Math.ceil(text.length / 153);

  console.log(`What they get (${text.length} characters, ${segments} segments):\n`);
  console.log(
    text
      .split('\n')
      .map((line) => `   ${line}`)
      .join('\n')
  );
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
