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

// The public address of this app.
//
// Hosting dashboards show a domain without the "https://" on the front, so it
// is easy to paste one in without it. That produces links like
// "lyndry.com/signup", which a browser reads as a folder on the current site
// rather than an address — quietly broken in every text message we send. So
// we put the protocol back if it is missing, and drop any trailing slash.
function normaliseBaseUrl(value, fallbackPort) {
  const raw = String(value || '').trim();
  if (!raw) return `http://localhost:${fallbackPort}`;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, '');
}

const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port,
  baseUrl: normaliseBaseUrl(process.env.APP_BASE_URL, port),

  // The AI model is resolved a single time, at startup. Never try one model,
  // catch an error, and fall back to another per message.
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  supabase: Object.freeze({
    url: supabaseUrl,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  }),

  // Telnyx sends and receives the text messages. Nothing outside
  // src/providers/sms/ should read these — see that folder for why.
  telnyx: Object.freeze({
    apiKey: process.env.TELNYX_API_KEY || '',
    publicKey: process.env.TELNYX_PUBLIC_KEY || '',
    messagingProfileId: process.env.TELNYX_MESSAGING_PROFILE_ID || '',
    phoneNumber: process.env.LYNDRY_PHONE_NUMBER || '',
  }),

  // Where handoff_to_human reaches Neil. His personal number, never published.
  supportPhone: process.env.SUPPORT_PHONE || '',

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

// Catch credentials that were copied from a masked field.
//
// Dashboards hide secrets behind dots. Copying one of those gives you a value
// full of bullet characters (•) that looks vaguely right and fails deep inside
// an HTTP library with a message about ByteStrings that means nothing to
// anyone. This says what actually happened instead.
const CREDENTIALS_TO_CHECK = [
  ['SUPABASE_SERVICE_ROLE_KEY', config.supabase.serviceRoleKey],
  ['TELNYX_API_KEY', config.telnyx.apiKey],
  ['TELNYX_PUBLIC_KEY', config.telnyx.publicKey],
  ['ANTHROPIC_API_KEY', config.anthropicApiKey],
  ['ADMIN_API_KEY', config.adminApiKey],
];

function warnAboutUnusableCredentials() {
  for (const [name, value] of CREDENTIALS_TO_CHECK) {
    if (!value) continue;

    // Anything outside plain ASCII cannot go in an HTTP header, and has no
    // business being in an API key.
    const bad = [...value].find((ch) => ch.charCodeAt(0) > 126 || ch.charCodeAt(0) < 32);
    if (!bad) continue;

    const isBullet = bad === '•' || bad === '·' || bad === '*';
    console.error('');
    console.error(`  ${name} is not a usable value.`);
    console.error(
      isBullet
        ? '    It contains bullet characters, which means it was copied from a'
        : `    It contains the character ${JSON.stringify(bad)}, which cannot be sent in a request.`
    );
    if (isBullet) console.error('    masked field. Reveal the real value first, then copy it.');
    console.error('');
  }
}

function warnAboutMissingEnvVars() {
  const missing = UPCOMING_ENV_VARS.filter(([name]) => !process.env[name]);
  if (missing.length === 0) return;

  console.warn('Not set yet in .env (fine for now):');
  for (const [name, why] of missing) {
    console.warn(`  - ${name}  (${why})`);
  }
}

module.exports = { config, warnAboutMissingEnvVars, warnAboutUnusableCredentials };
