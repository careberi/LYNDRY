'use strict';

const db = require('../db');
const { config } = require('../config');
const { site } = require('../web/site');
const { normalisePhone } = require('./phone');
const onboarding = require('./onboarding');
const settings = require('./settings');
const promotions = require('./promotions');
const { sendAndLog } = require('./notify');

// ---------------------------------------------------------------------------
// LEADS FROM THE FACEBOOK INSTANT FORM.
//
// Neil runs ads on Facebook with a Meta instant form on them - somebody taps
// the advert, their number is filled in for them, they tap send. Meta writes
// the lead into a Google Sheet. This reads that sheet and texts anybody new.
//
// Neil's ask: "if a new number appears that is not already a customer, a
// message needs to be sent to them immediately".
//
// WHY A GOOGLE SHEET AND NOT META'S API. The sheet is already there, Meta
// already writes to it, and it needs no app review, no access token and no
// second thing to renew. It is published to the web as CSV, so reading it is
// one HTTP GET with no credentials at all - which also means there is nothing
// here to leak. If Meta ever stops writing to it, this stops finding leads and
// says so, rather than texting the wrong people.
//
// THE MESSAGE IS WRITTEN HERE, IN CODE, NOT BY THE AI. Same rule as the nudges
// and for the same two reasons: these words go to somebody who has not texted
// us, so they should be words a person has read and approved; and the segment
// count is knowable before anything is sent. The AI takes over the moment they
// reply, which is where it is good.
//
// ONLY THE OPENING LINE IS ITS OWN. Neil's point: everything in this sheet came
// off an advert, so the first sentence says so - "you filled out the laundry
// pickup form on our Facebook ad" - where the canned welcome in onboarding.js
// opens with "thanks for sending over your number", which would be the wrong
// sentence to somebody who has never been on our website. Everything after that
// is the same in both, and comes from onboarding.whatWeDo() so it stays that
// way.
// ---------------------------------------------------------------------------

// --- Consent ---------------------------------------------------------------
//
// THE TICK BOX IS RECORDED AND DOES NOT GATE THE TEXT. Neil's call, taken with
// the alternative in front of him: "if they provided the number we text them".
//
// It was a gate first, and the argument for that is worth keeping because the
// obvious instinct on reading this file is to put it back. Three of the first
// four leads left the box false; Meta's field is optional, so a false covers
// both somebody who read it and declined and somebody who never noticed it, and
// nothing in the data tells those apart. What is true either way is that an
// unticked box is not express written consent, which is what a carrier asks
// about during 10DLC registration and what a TCPA complaint turns on.
//
// Against that: they typed their number into a laundry company's form asking
// about laundry pickup, which is an enquiry by any ordinary reading of it, and
// the alternative is throwing away most of what the adverts are paying for.
//
// SO `consented` IS STILL STORED ON EVERY ROW, exactly as before. It is the
// evidence, and it has to survive whether or not it decides anything - "which
// of these people actually ticked it" is the first question anybody would ask
// if this is ever challenged, and the answer must not be lost because the
// policy changed.
//
// WHAT STILL REFUSES, and is not Neil's to waive: a number that has texted STOP.
// That is the law rather than a preference, it is checked below, and it must
// never become configurable here.
const CONSENT_COLUMN = 'i_agree_to_receive_text_messages_from_lyndry';

const yes = (value) => ['true', 'yes', '1', 'y'].includes(String(value || '').trim().toLowerCase());

// --- The sheet -------------------------------------------------------------

// The published CSV of the first tab. Not a secret - the sheet is readable by
// anybody with the link, which is what makes this work without credentials.
function sheetUrl() {
  const id = config.leads.sheetId;
  return id ? `https://docs.google.com/spreadsheets/d/${id}/export?format=csv` : null;
}

// A small CSV reader, because the fields are quoted and contain commas: one
// campaign is called "Text me first (all ads, Sep 2026)". Handles quoted
// fields, doubled quotes inside them, and CRLF line endings. That is the whole
// grammar Google emits, and a dependency for it would be a dependency to keep
// up to date for one file.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((h) => h.trim());

  return rows
    .slice(1)
    .filter((r) => r.some((cell) => String(cell).trim()))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
}

// Meta prefixes its ids: a lead is "l:1385400376502562" and a phone number
// arrives as "p:+12014068616". normalisePhone throws away everything that is
// not a digit anyway, so the phone needs no special handling - the lead id
// does, and is kept exactly as Meta wrote it because it is their id, not ours.
async function fetchLeads() {
  const url = sheetUrl();
  if (!url) return { ok: false, reason: 'no sheet configured', rows: [] };

  const res = await fetch(url, {
    // A hanging request must never wedge the tick it is running on.
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });

  if (!res.ok) return { ok: false, reason: `sheet returned ${res.status}`, rows: [] };

  const rows = parseCsv(await res.text());
  if (!rows.length) return { ok: true, rows: [] };

  // A sheet that has stopped being shared returns a sign-in PAGE with a 200 on
  // it, so the status code alone proves nothing. If the consent column is not
  // in the header this is not our sheet, and nobody is getting texted off it.
  if (!(CONSENT_COLUMN in rows[0])) {
    return {
      ok: false,
      reason: 'the sheet has no consent column - check it is still shared',
      rows: [],
    };
  }

  return { ok: true, rows };
}

// --- What we say -----------------------------------------------------------

// Neil's words. Four paragraphs: who this is and why we have their number, then
// the two that every first message shares, then the way out.
//
// ONLY THE FIRST PARAGRAPH IS WRITTEN HERE. The middle two come from
// onboarding.whatWeDo(), which is what the canned website welcome uses too -
// Neil wrote the two messages separately and then wrote them identically from
// the second paragraph on, so two copies would only be two things to edit and
// one of them would be the one nobody remembered. The free-orders sentence and
// the opening date both come from there, which is why neither can say something
// different here.
//
// It runs to four segments, which is a real cost on every lead. That is the
// right trade: this number cost money to acquire, and a terse text to somebody
// who has never heard of us is how that money gets wasted.
function leadMessage({ promo = null, opensOn = null } = {}) {
  return [
    `Hi, this is ${site.name}. You filled out the laundry pickup form on our ` +
      `Facebook ad and left this number, so we wanted to follow up. We are a ` +
      `wash and fold pickup and delivery laundry service in ${site.serviceArea}.`,

    ...onboarding.whatWeDo({ promo, opensOn }),

    // THE OPT-OUT LINE IS ON EVERY VERSION. This is the one message in the
    // system that reaches somebody who has never texted us, so it is the one
    // that has to carry the way out - and a carrier reviewing the campaign
    // looks for exactly this sentence on exactly this kind of message. STOP is
    // handled in code in src/core/compliance.js whether we mention it or not;
    // saying so is what makes it findable.
    `Text STOP to opt out.`,
  ].join('\n\n');
}

// --- The sweep -------------------------------------------------------------

// One pass. Returns what it did, so the caller can log it and a test can read
// it. Never throws for one bad row: a lead with a broken number must not stop
// the lead behind it being texted.
async function sweep({ limit = 25 } = {}) {
  const done = { texted: [], skipped: [], problem: null };

  const { ok, reason, rows } = await fetchLeads().catch((err) => ({
    ok: false,
    reason: err.name === 'TimeoutError' ? 'the sheet timed out' : err.message,
    rows: [],
  }));

  if (!ok) {
    done.problem = reason;
    console.error(`Facebook leads: ${reason}`);
    return done;
  }

  if (!rows.length) return done;

  // WHICH ONES HAVE WE SEEN. One query rather than one per row, and keyed on
  // Meta's lead id: the same person filling the form twice is two leads, and
  // both are recorded honestly even though only the first is texted.
  const ids = rows.map((r) => String(r.id || '').trim()).filter(Boolean);

  const { data: known, error } = await db
    .from('facebook_leads')
    .select('lead_id')
    .in('lead_id', ids);

  if (error) throw error;

  const seen = new Set((known || []).map((r) => r.lead_id));

  // OLDEST FIRST, so a backlog is worked through in the order people actually
  // filled the form in. Meta writes newest first.
  const fresh = rows
    .filter((r) => String(r.id || '').trim() && !seen.has(String(r.id).trim()))
    .reverse()
    .slice(0, limit);

  for (const row of fresh) {
    try {
      const outcome = await handle(row);
      if (outcome.texted) done.texted.push(outcome);
      else done.skipped.push(outcome);
    } catch (err) {
      console.error(`Facebook lead ${row.id} threw: ${err.message}`);
      done.skipped.push({ leadId: row.id, reason: err.message });
    }
  }

  return done;
}

// One lead. Recorded either way - a lead we decided not to text is exactly the
// row somebody will want to look at later, and "we never saw it" and "we saw it
// and left it alone" are different answers to the same question.
async function handle(row) {
  const leadId = String(row.id || '').trim();
  const phone = normalisePhone(String(row.phone || '').replace(/^p:/i, ''));
  const consented = yes(row[CONSENT_COLUMN]);

  const record = async (fields) => {
    const { error } = await db.from('facebook_leads').upsert(
      {
        lead_id: leadId,
        phone: phone || String(row.phone || '').slice(0, 40),
        created_time: row.created_time || null,
        consented,
        form_name: row.form_name || null,
        campaign: row.campaign_name || null,
        ...fields,
      },
      { onConflict: 'lead_id' }
    );
    if (error) throw error;
  };

  const stop = async (reason) => {
    await record({ skipped: reason });
    console.log(`Facebook lead ${leadId}: ${reason}`);
    return { leadId, phone, texted: false, reason };
  };

  // ALREADY TEXTED IS THE END OF IT. The sweep filters seen leads out before it
  // gets here, so this only fires when handle() is called directly - and then it
  // matters, because everything below would find them on the books and write
  // "already a customer" over the record of the text we actually sent. A row
  // that says both is not evidence of anything.
  const { data: before } = await db
    .from('facebook_leads')
    .select('texted_at')
    .eq('lead_id', leadId)
    .maybeSingle();

  if (before && before.texted_at) {
    return { leadId, phone, texted: false, reason: 'already texted' };
  }

  if (!phone) return stop('the number on the form is not usable');

  // The tick box is recorded above and deliberately does not stop the send -
  // see the note at the top of the file for why, and for what does.

  const { data: existing } = await db
    .from('customers')
    .select('id, status')
    .eq('phone', phone)
    .maybeSingle();

  // STOP is a legal instruction and outranks a form filled in afterwards.
  if (existing && existing.status === 'UNSUBSCRIBED') {
    await record({ customer_id: existing.id });
    return stop('that number has opted out');
  }

  // Neil's rule: only numbers that are not already customers. Somebody already
  // on the books is mid-conversation with us, and an advert introduction on top
  // of that reads as though nobody is paying attention.
  if (existing) {
    await record({ customer_id: existing.id });
    return stop('already a customer');
  }

  // Creates the row with its consent record and hands out whatever promotion is
  // on auto-grant. sendWelcome is false because the welcome in onboarding.js is
  // written for somebody who typed their number into our own website; this lead
  // gets the Facebook wording above instead.
  const started = await onboarding.startConversation({
    phone,
    consentSource: 'FACEBOOK_FORM',
    sendWelcome: false,
  });

  if (!started.ok) return stop(started.reason);

  // WHAT THEY ACTUALLY ENDED UP HOLDING decides what the message may promise -
  // not what the offer is meant to be. If the twenty are gone, startConversation
  // granted nothing and the free sentence is left out.
  // heldBy() flattens the promotion onto the grant, so a row IS the promotion
  // plus the grant's own expiry and limit. There is nothing to reach into.
  const held = await promotions.heldBy(started.customer.id).catch(() => []);
  const promo = held[0] || null;

  // WHEN THE VAN ACTUALLY STARTS. Read here rather than left out, because this
  // message asks them to name a day and the earliest one we can take may be
  // next week - the same rule the canned welcome follows. A date in the past
  // comes back null, so nobody has to remember to clear it.
  const opensOn = await settings.opensOn().catch(() => null);

  await sendAndLog(phone, leadMessage({ promo, opensOn }), started.customer.id, {
    kind: 'SYSTEM',
  });

  await record({ customer_id: started.customer.id, texted_at: new Date().toISOString() });

  console.log(`Facebook lead ${leadId}: texted ${phone}${promo ? ' (holding an offer)' : ''}`);

  return { leadId, phone, texted: true, customerId: started.customer.id };
}

module.exports = { sweep, handle, fetchLeads, parseCsv, leadMessage, sheetUrl };
