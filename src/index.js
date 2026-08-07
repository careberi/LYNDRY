'use strict';

const express = require('express');
const pkg = require('../package.json');

// All environment settings are read and frozen in one place. See src/config.js.
const { config, warnAboutMissingEnvVars, warnAboutUnusableCredentials } = require('./config');

const web = require('./routes/web');
const sms = require('./routes/sms');
const db = require('./db');

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

const app = express();

// Railway and most hosts sit behind a proxy. This makes req.ip report the
// real visitor address instead of the proxy's — we need that to be correct,
// because we record the customer's IP as legal proof of SMS consent.
app.set('trust proxy', 1);

// Keep the exact bytes of every JSON request body.
//
// The SMS provider signs those bytes. Re-serialising the parsed object
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

// Health check. Hosting platforms ping this to decide whether the app is
// alive; you can also just open it in a browser to confirm things work.
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'lyndry',
    version: pkg.version,
    env: config.env,
    model: config.anthropicModel,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// Inbound text messages from the SMS provider.
app.use('/', sms.router);

// The public website and the signup form.
app.use('/', web.router);

// Anything that matched nothing above.
app.use(web.notFound);

// Last line of defence. If any route throws, we log the real error for
// ourselves and return something generic to the caller.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

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

const server = app.listen(config.port, () => {
  console.log(`LYNDRY v${pkg.version} listening on port ${config.port}`);
  console.log(`  environment : ${config.env}`);
  console.log(`  base url    : ${config.baseUrl}`);
  console.log(`  ai model    : ${config.anthropicModel}`);
  console.log(`  sms provider: ${require('./providers/sms').name}`);
  warnAboutMissingEnvVars();
  warnAboutUnusableCredentials();
  checkDatabase();
});

// When the host wants to stop or redeploy us it sends SIGTERM. Finish the
// requests already in flight, then exit, rather than dropping them.
function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(() => process.exit(0));
  // If something hangs, don't wait forever.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, config };
