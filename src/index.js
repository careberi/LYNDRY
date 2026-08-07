'use strict';

// Load variables from the .env file into process.env before anything else runs.
require('dotenv').config({ quiet: true });

const express = require('express');
const pkg = require('../package.json');

// ---------------------------------------------------------------------------
// Configuration
//
// Everything this app needs from the environment is read ONCE, here, at boot,
// and then frozen so nothing can change it later. No other file should read
// process.env directly — they import this config instead.
//
// This is deliberate. The AI model in particular is resolved a single time at
// startup rather than being guessed at on every customer message.
// ---------------------------------------------------------------------------

const port = Number(process.env.PORT) || 3000;

const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port,
  baseUrl: process.env.APP_BASE_URL || `http://localhost:${port}`,
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
});

// Variables that aren't used yet but will be, phase by phase. We warn about
// them rather than crashing, so the server still boots on a fresh checkout.
const UPCOMING_ENV_VARS = [
  ['SUPABASE_URL', 'phase 2 - database'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'phase 2 - database'],
  ['TELNYX_API_KEY', 'phase 3 - sms'],
  ['TELNYX_PUBLIC_KEY', 'phase 3 - sms'],
  ['TELNYX_MESSAGING_PROFILE_ID', 'phase 3 - sms'],
  ['LYNDRY_PHONE_NUMBER', 'phase 3 - sms'],
  ['ANTHROPIC_API_KEY', 'phase 4 - the brain'],
  ['ADMIN_API_KEY', 'phase 6 - ops endpoints'],
  ['SHELLY_SERVER_URI', 'phase 7 - lockers'],
  ['SHELLY_AUTH_KEY', 'phase 7 - lockers'],
];

function warnAboutMissingEnvVars() {
  const missing = UPCOMING_ENV_VARS.filter(([name]) => !process.env[name]);
  if (missing.length === 0) return;

  console.warn('Not set yet in .env (fine for now):');
  for (const [name, why] of missing) {
    console.warn(`  - ${name}  (${why})`);
  }
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

const app = express();

// Railway and most hosts sit behind a proxy. This makes req.ip report the
// real visitor address instead of the proxy's — we need that to be correct,
// because we record the customer's IP as legal proof of SMS consent.
app.set('trust proxy', 1);

app.use(express.json());
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

// The real website arrives in phase 5. Until then, a plain placeholder.
app.get('/', (req, res) => {
  res.type('text/plain').send('LYNDRY — laundry pickup and delivery. Site coming soon.');
});

// Anything else is a 404.
app.use((req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Last line of defence. If any route throws, we log the real error for
// ourselves and return something generic to the caller.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const server = app.listen(config.port, () => {
  console.log(`LYNDRY v${pkg.version} listening on port ${config.port}`);
  console.log(`  environment : ${config.env}`);
  console.log(`  base url    : ${config.baseUrl}`);
  console.log(`  ai model    : ${config.anthropicModel}`);
  warnAboutMissingEnvVars();
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
