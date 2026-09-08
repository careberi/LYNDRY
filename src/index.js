'use strict';

const path = require('path');
const express = require('express');
const pkg = require('../package.json');

// All environment settings are read and frozen in one place. See src/config.js.
const {
  config,
  warnAboutMissingEnvVars,
  warnAboutUnusableCredentials,
  warnIfNobodyCanAlwaysBook,
} = require('./config');

const assets = require('./web/assets');
// For the phone number on the error page below - the one thing somebody staring
// at a broken page actually needs.
const { site } = require('./web/site');
const web = require('./routes/web');
const sms = require('./routes/sms');
const ops = require('./routes/ops');
const admin = require('./routes/admin');
const account = require('./routes/account');
const bag = require('./routes/bag');
const paymentRoutes = require('./routes/payments');
const db = require('./db');
const burst = require('./core/burst');
const scheduler = require('./core/scheduler');
const issues = require('./core/issues');

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

const app = express();

// Railway and most hosts sit behind a proxy. This makes req.ip report the
// real visitor address instead of the proxy's — we need that to be correct,
// because we record the customer's IP as legal proof of SMS consent.
app.set('trust proxy', 1);

// Payment routes go on FIRST, before any body parser.
//
// The payment provider's webhook signature covers the exact bytes it sent, and
// that route needs to read them unparsed. Once express.json has run, the raw
// bytes are gone and every webhook would fail its signature check. Order of
// these two blocks is load-bearing — do not move it.
app.use('/', paymentRoutes.router);

// Keep the exact bytes of every JSON request body.
//
// The SMS provider signs those bytes too. Re-serialising the parsed object
// produces different bytes — a space in a different place is enough — and the
// signature would never match. So we stash the original before parsing.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Stylesheets. Only public/css is served — public/pages holds page templates
// with {{TOKEN}} holes in them, which must never be reachable directly.
//
// Served from a fingerprinted path (/css/<hash>/...). Because the hash changes
// whenever any stylesheet changes, a given URL's content can never change, so
// it is safe to cache forever — and a deploy is picked up instantly instead of
// a returning visitor being stuck with a week-old stylesheet. See
// src/web/assets.js for the full reasoning.
app.use(
  assets.CSS_BASE,
  express.static(assets.CSS_DIR, {
    maxAge: config.env === 'production' ? '1y' : 0,
    immutable: config.env === 'production',
  })
);

// Open Graph images. A separate mount from the stylesheets because these are
// fetched by Facebook's and Twitter's crawlers rather than by a browser
// following a fingerprinted link - the URL has to stay stable, or a share
// scraped last week shows a broken image today.
//
// Cached hard but NOT immutable, so a replaced image is picked up within the
// day rather than never.
app.use(
  '/og',
  express.static(path.join(__dirname, '..', 'public', 'og'), {
    maxAge: config.env === 'production' ? '1d' : 0,
  })
);

// The unfingerprinted path stays mounted so that a link from an older cached
// page, or a bookmark, still resolves. Deliberately NOT cached: this is the
// path that can go stale.
app.use(
  '/css',
  express.static(assets.CSS_DIR, {
    setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
  })
);

// Health check. Hosting platforms ping this to decide whether the app is
// alive; you can also just open it in a browser to confirm things work.
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'lyndry',
    version: pkg.version,
    env: config.env,
    model: config.anthropicModel,

    // Which SMS driver is live. Just a name — no secret — and it turns
    // "why did my text go nowhere" into something answerable from a browser
    // instead of a log dive. 'telnyx' means real texting is on; 'disabled'
    // means credentials are missing and every webhook is being refused.
    sms: require('./providers/sms').name,

    // IS ANYTHING GOING TO SEND TONIGHT'S TEXTS. Standing orders and the
    // day-before reminders both hang off the nightly pass, and its whole
    // failure mode is silence - it either runs or nothing happens and nobody
    // is told. Reported here so "did it run" is a question answerable from a
    // browser rather than a log dive, which is exactly the hole the cron
    // service left. A name and a date, no secret.
    scheduler: scheduler.enabled() ? 'on' : 'off',

    // 'off' means no payment credentials, 'test' means a sandbox key, 'live'
    // means real money. "Why did no money arrive" is usually answered by
    // finding 'test' here on the production server.
    payments: require('./providers/payments').mode,

    // Whether handoff_to_human has somewhere to go. A boolean, never the
    // number itself — this endpoint is public, and that is Neil's mobile.
    //
    // Worth reporting because an unset SUPPORT_PHONE fails silently: the AI
    // decides a customer needs a person, logs it, and nobody is told.
    supportPhone: Boolean(config.supportPhone),

    uptimeSeconds: Math.round(process.uptime()),
  });
});

// Inbound text messages from the SMS provider.
app.use('/', sms.router);

// The ops screens. Mounted BEFORE the ops API so that /ops/login is reachable
// without being signed in — the API router blocks everything under /ops.
app.use('/', admin.router);

// Driver and admin endpoints. Everything under /ops needs the shared secret.
app.use('/', ops.router);

// Where a customer signs in and books a pickup. Before the website router so
// /account/... is never mistaken for a marketing page.
app.use('/', account.router);

// The page behind the QR on a bag label. Deliberately short and deliberately
// public: a laundromat points a camera at a sticker and reads it, with no app,
// no login and nothing to install.
app.use('/', bag);

// The public website and the signup form.
app.use('/', web.router);

// Anything that matched nothing above.
app.use(web.notFound);

// LAST LINE OF DEFENCE. If any route throws, log the real error for ourselves
// and show the caller something that is not a stack trace.
//
// IT LOGS WHERE IT HAPPENED, WHICH IT DID NOT. This used to print "Unhandled
// error:" and the message, with nothing saying which page, which method or who
// was pressing the button - so an error reported as "it showed me a JSON thing"
// could not be traced to a route without guessing. Two of those were reported
// on the same morning and only one of them was ever found. The method, the
// path and the signed-in person now go in the same line as the stack.
//
// The query string is included because on this site it carries the argument -
// ?t= on a bag label, ?from=run on a driver's action, ?lang=es on a laundromat
// page - and a bug that only happens in one language is invisible without it.
app.use((err, req, res, next) => {
  const who =
    (req.opsUser && `${req.opsUser.name} (${req.opsUser.role})`) ||
    (req.get && req.get('x-admin-key') ? 'machine key' : 'signed out');

  console.error(
    `Unhandled error: ${req.method} ${req.originalUrl} [${who}]\n`,
    err && err.stack ? err.stack : err
  );

  if (res.headersSent) return next(err);

  // A PERSON GETS A PAGE, A SCRIPT GETS JSON. Everything used to get the JSON,
  // including a laundromat attendant holding somebody's laundry and a driver on
  // a doorstep - and {"error":"internal_error"} tells them nothing at all, not
  // even who to call. The JSON stays for the ops API and the simulators, which
  // are the only callers that can do anything with it.
  const wantsJson =
    req.xhr ||
    String(req.get('accept') || '').includes('application/json') ||
    !String(req.get('accept') || '').includes('text/html');

  if (wantsJson) return res.status(500).json({ error: 'internal_error' });

  return res
    .status(500)
    .type('html')
    .send(errorPage(site.opsPhoneDisplay));
});

// A plain apology with a phone number on it. No layout, no stylesheet lookup
// and nothing from the database - this renders when something has already gone
// wrong, so it must not be able to go wrong itself.
function errorPage(phone) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Something went wrong - LYNDRY</title>
  <meta name="robots" content="noindex">
  <style>
    body { margin:0; background:#FFF8EC; color:#101210;
           font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .box { max-width:32rem; margin:12vh auto; padding:28px; background:#FFFDF7;
           border:2px solid #101210; border-radius:14px; box-shadow:6px 6px 0 #101210; }
    h1 { font-size:26px; line-height:1.15; margin:0 0 14px; }
    p { font-size:17px; line-height:1.6; margin:0 0 12px; }
    a { color:#101210; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Something went wrong at our end.</h1>
    <p>Nothing you just did was lost, but this page could not finish. Please go
       back and try it again.</p>
    <p>If it keeps happening, call us${phone ? ` on <a href="tel:${phone}">${phone}</a>` : ''}
       and say what you were doing - it is already logged our side.</p>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// Actually talk to the database once, at startup.
//
// Having SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set is not the same as
// them being correct. A truncated key or a wrong URL lets the server start
// perfectly happily and then fails on the first customer who tries to sign up.
// This turns that into an obvious line in the deploy log instead.
async function checkDatabase() {
  try {
    const { error } = await db.from('customers').select('id', { head: true, count: 'exact' });
    if (error) throw new Error(error.message);
    console.log('  database    : connected');
  } catch (err) {
    console.error('');
    console.error('  database    : CANNOT CONNECT');
    console.error(`                ${err.message}`);
    console.error('                Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    console.error('                Signup and SMS will fail until this is fixed.');
    console.error('');
  }
}

// SOMEBODY HAS TO BE ON THE OTHER END OF A HANDOFF.
//
// When the AI hands a customer to a manager it texts every active admin with a
// phone number, plus SUPPORT_PHONE. On 5 September there were none of either,
// so a customer was promised a person and the promise went to a console.error
// in a deploy log. The Issues screen now shows an unpaged issue in red and the
// scheduler retries, but the cheapest fix is to say so the moment the server
// starts, beside the other warnings about things that are set up wrong.
async function warnIfNobodyCanBePaged() {
  try {
    const numbers = await issues.alertRecipients();
    if (numbers.length) return;

    console.error('');
    console.error('  NOBODY CAN BE PAGED. When the AI hands a customer to a manager, the');
    console.error('  text goes to every active team member with a phone number who can');
    console.error('  manage issues, plus SUPPORT_PHONE - and right now that is nobody.');
    console.error('  Add a phone number on /ops/team, or set SUPPORT_PHONE.');
    console.error('');
  } catch (err) {
    console.error(`  Could not check who can be paged: ${err.message}`);
  }
}

const server = app.listen(config.port, () => {
  console.log(`LYNDRY v${pkg.version} listening on port ${config.port}`);
  console.log(`  environment : ${config.env}`);
  console.log(`  base url    : ${config.baseUrl}`);
  console.log(`  ai model    : ${config.anthropicModel}`);
  console.log(`  sms provider: ${require('./providers/sms').name}`);
  console.log(`  payments    : ${require('./providers/payments').mode}`);
  warnAboutMissingEnvVars();
  warnAboutUnusableCredentials();
  warnIfNobodyCanAlwaysBook();
  checkDatabase().then(warnIfNobodyCanBePaged);

  // WATCH THE CLOCK OURSELVES rather than depending on a cron service somebody
  // has to remember to set up in a dashboard. Standing orders, the day-before
  // reminders and the follow-up chases all hang off this; without it they
  // simply never happen, and nothing anywhere says so. Off outside production -
  // see src/core/scheduler.js for why a dev server doing this would be a
  // disaster.
  scheduler.start();
});

// When the host wants to stop or redeploy us it sends SIGTERM. Finish the
// requests already in flight, then exit, rather than dropping them.
function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);

  // ANSWER WHOEVER IS WAITING FIRST. Replies are held in memory for a few
  // seconds in case the customer is still typing (src/core/burst.js), so a
  // deploy landing inside that window would otherwise leave somebody with no
  // reply at all. Best effort: if it does not finish inside the grace period
  // below, the process goes anyway.
  burst
    .flushAll()
    .catch((err) => console.error(`Could not flush pending replies: ${err.message}`))
    .finally(() => server.close(() => process.exit(0)));
  // If something hangs, don't wait forever. Raised from ten seconds when the
  // flush above was added: answering a held message means a call to the AI and
  // a call to the carrier, and cutting that off at ten would defeat the point
  // of flushing at all. Still inside the host's grace period, and unref'd, so
  // a clean shutdown still exits the moment it is actually done.
  setTimeout(() => process.exit(1), 25_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, config };
