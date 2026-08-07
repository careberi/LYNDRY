'use strict';

// Load variables from the .env file into process.env before anything reads them.
require('dotenv').config({ quiet: true });

// ---------------------------------------------------------------------------
// Configuration
//
// Everything this app needs from the environment is read ONCE, here, and then
// frozen so nothing can change it later. No other file reads process.env
// directly — they require this file instead.
//
// This lives in its own file rather than in index.js because the scripts in
// scripts/ need it too, and they run without starting the web server.
// ---------------------------------------------------------------------------

const port = Number(process.env.PORT) || 3000;

// A trailing slash on the Supabase URL breaks request paths, so strip it.
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');

const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port,
  baseUrl: (process.env.APP_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),

  // The AI model is resolved a single time, at startup. Never try one model,
  // catch an error, and fall back to another per message.
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  supabase: Object.freeze({
    url: supabaseUrl,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  }),

  telnyx: Object.freeze({
    apiKey: process.env.TELNYX_API_KEY || '',
    publicKey: process.env.TELNYX_PUBLIC_KEY || '',
    messagingProfileId: process.env.TELNYX_MESSAGING_PROFILE_ID || '',
    phoneNumber: process.env.LYNDRY_PHONE_NUMBER || '',
  }),

  shelly: Object.freeze({
    serverUri: process.env.SHELLY_SERVER_URI || '',
    authKey: process.env.SHELLY_AUTH_KEY || '',
  }),

  adminApiKey: process.env.ADMIN_API_KEY || '',

  // Pricing is hardcoded on purpose — there is no payment processing yet.
  // If this changes, change the default on orders.price_cents to match.
  pricing: Object.freeze({
    bagPriceCents: 3900,
  }),
});

// Variables that aren't used yet but will be, phase by phase. We warn rather
// than crash so the server still boots on a fresh checkout.
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

module.exports = { config, warnAboutMissingEnvVars };
