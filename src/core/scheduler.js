'use strict';

const { config } = require('../config');
const booking = require('./booking');
const nightly = require('./nightly');
const followups = require('./followups');
const cardChase = require('./card-chase');
const leads = require('./leads');
const issues = require('./issues');

// ---------------------------------------------------------------------------
// THE ONE CLOCK. Everything that happens without somebody pressing a button.
//
// Three jobs on two timers:
//
//   the nightly pass   once an evening: book tomorrow's standing orders, then
//                      remind everybody whose pickup is tomorrow.
//   follow-ups         all day: chase anybody the AI asked a question and
//                      never got an answer - once a couple of hours into a
//                      stalled setup, and once a day later.
//   the re-page        all day: an open issue a quarter of an hour old that no
//                      person has written to the customer about gets every
//                      admin texted once more. See issues.repageStale().
//   Facebook leads     every few minutes: text anybody new off the advert form.
//
// TWO TIMERS RATHER THAN ONE, and the second one is only worth it because of
// what it is waiting for. The first two are waiting for the clock - an evening,
// or a day since somebody was asked something - and ten minutes either way
// changes nothing. A Facebook lead has just tapped an advert and is holding
// their phone, so the gap between filling the form in and hearing from us is
// the whole difference between a reply and being ignored.
//
// They are both here because "what runs by itself" should still be a question
// somebody can answer by opening one file.
//
// They are separate modules because they are separate decisions; the timer is
// here because there should be one, and because "what runs by itself" is a
// question somebody should be able to answer by opening a single file.
//
// This replaced a Railway cron service, at Neil's prompting. A cron is a second
// thing to configure by hand in a dashboard, and the one this system had was
// never actually set up - so the work simply never happened and nothing said
// so. The web app is already running every minute of every day, because an
// inbound text has to be answered, so it can watch the clock for free.
//
// QUIET HOURS ARE A HARD FLOOR ON THE NIGHTLY PASS AND THE FOLLOW-UPS. Federal
// rules put texts inside 8am to 9pm in the recipient's own time, and both of
// those are genuinely unprompted - the customer is asleep and nobody is waiting
// on us. Late is not a reason to send at midnight.
//
// THE LEAD SWEEP IS THE EXCEPTION, and deliberately so: somebody who has just
// filled in a form asking a laundry company to contact them is owed a reply, not
// a solicitation held until morning. See sweepLeads() below for the whole
// argument, which is Neil's.
//
// A NOTE ON THE DIFFERENCE BETWEEN THEM, because it matters:
//
//   The nightly pass SKIPS a night it missed. Its message says "tomorrow", so
//   sending it at 6am the next day would be a lie.
//   A follow-up DEFERS. It is simply "a day or so later", so one that came due
//   at 3am goes out at 8am and is still exactly right.
// ---------------------------------------------------------------------------

// The earliest and latest a customer may be texted, in New Jersey. Not
// configurable: this is the law, not a preference.
const QUIET_START = 8;
const QUIET_END = 21;

const POLL_MS = Number(process.env.SCHEDULER_POLL_MINUTES || 10) * 60 * 1000;
const LEADS_MS = Math.max(1, config.leads.pollMinutes) * 60 * 1000;

let timer = null;
let leadTimer = null;
let ticking = false;
let sweeping = false;

// Whether this process should be the one watching the clock.
//
// NOT IN DEVELOPMENT, and this is the important half. The dev server shares the
// production database, so a laptop left running in the evening would do the
// whole nightly pass, stamp every order as reminded, and send the texts through
// the fake provider - meaning nothing reaches a phone and production then finds
// nothing left to do. Everybody's reminder would vanish, silently, because
// somebody had a terminal open.
function enabled() {
  const forced = String(process.env.NIGHTLY_ENABLED || '').toLowerCase();
  if (forced === 'true') return true;
  if (forced === 'false') return false;
  return config.env === 'production';
}

function inQuietHours(when) {
  const hour = Number(when.time.slice(0, 2));
  return hour < QUIET_START || hour >= QUIET_END;
}

// One pass of everything. Exported so it can be run by hand and tested.
async function tick({ now = null } = {}) {
  if (ticking) return { skipped: 'already ticking' };
  ticking = true;

  const when = now || booking.nowInService();
  const done = {};

  try {
    // Nothing unprompted goes out at night. Both jobs are silent until 8am.
    if (inQuietHours(when)) return { quiet: true };

    done.nightly = await nightly
      .runIfDue({ now: when })
      .catch((err) => ({ ran: false, reason: err.message }));

    done.followups = await followups
      .sendDue()
      .catch((err) => ({ sent: [], skipped: [{ reason: err.message }] }));

    // The card link for a booking that still has no card on it. It rides this
    // tick rather than a timer of its own for the same reason everything else
    // here does: the web app is already running every minute of every day, so
    // it can watch the clock for free, and quiet hours are the right floor on
    // a message nobody just asked for.
    done.cardChase = await cardChase
      .sendDue()
      .catch((err) => ({ sent: [], skipped: [{ reason: err.message }] }));

    // Admins, not customers, but on this tick for the same reason the other
    // two are: it is a thing that has to happen without anybody pressing a
    // button, and quiet hours are a reasonable floor on paging a person twice.
    done.issues = await issues
      .repageStale()
      .catch((err) => ({ paged: [], reason: err.message }));

    return done;
  } finally {
    ticking = false;
  }
}

// The Facebook lead sweep, on its own faster timer.
//
// QUIET HOURS DO NOT APPLY TO THIS ONE, and it is the only thing on either timer
// that they do not apply to. Neil's call, and the reasoning is the reason the
// rule exists rather than an exception to it: "a new lead in the database is a
// prompt".
//
// The quiet-hours rule is about telephone SOLICITATION - somebody being
// contacted who did not ask to be. A lead here has, seconds earlier, filled in a
// form on an advert asking a laundry company to get in touch. That is an
// invitation, and answering an invitation is a reply rather than a solicitation.
// Every other job on these timers is genuinely unprompted - the customer is
// asleep and nobody is waiting on us - which is why they all still stop at 9pm.
//
// The practical half is that this is the whole value of the thing: somebody who
// has just tapped an advert is holding their phone, and eight and a half hours
// later they have forgotten the advert existed.
//
// WHAT THIS COSTS, so nobody is surprised by it: a form filled in at three in
// the morning is answered at three in the morning. If that ever wants a floor,
// it is one line here - and it should be a floor rather than a return to
// deferring until eight.
async function sweepLeads() {
  if (sweeping) return { skipped: 'already sweeping' };
  sweeping = true;

  try {
    return await leads.sweep();
  } finally {
    sweeping = false;
  }
}

function start() {
  if (!enabled()) {
    console.log(`  scheduler  : off in ${config.env} (set NIGHTLY_ENABLED=true to override)`);
    return null;
  }

  console.log(
    `  scheduler  : on, every ${Math.round(POLL_MS / 60000)}m between ` +
      `${QUIET_START}:00 and ${QUIET_END}:00 NJ`
  );

  timer = setInterval(() => {
    tick().catch((err) => console.error(`Scheduler tick threw: ${err.message}`));
  }, POLL_MS);

  // Must not be the reason the process stays alive; the HTTP server is.
  if (timer.unref) timer.unref();

  // One pass on the way up, so a deploy in the middle of the evening does not
  // wait ten minutes before doing the night's work.
  tick().catch((err) => console.error(`Scheduler startup tick threw: ${err.message}`));

  if (config.leads.sheetId) {
    console.log(`  leads      : Facebook form, every ${config.leads.pollMinutes}m`);

    leadTimer = setInterval(() => {
      sweepLeads().catch((err) => console.error(`Lead sweep threw: ${err.message}`));
    }, LEADS_MS);

    if (leadTimer.unref) leadTimer.unref();

    sweepLeads().catch((err) => console.error(`Lead startup sweep threw: ${err.message}`));
  } else {
    console.log('  leads      : off (no LEADS_SHEET_ID)');
  }

  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  if (leadTimer) clearInterval(leadTimer);
  timer = null;
  leadTimer = null;
}

module.exports = {
  start,
  stop,
  tick,
  sweepLeads,
  enabled,
  inQuietHours,
  QUIET_START,
  QUIET_END,
};
