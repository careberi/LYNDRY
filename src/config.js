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

    // Optional. Where sign-in codes are sent FROM — a short code, or a second
    // number kept separate from the conversation. Left blank, codes go from
    // LYNDRY_PHONE_NUMBER like everything else, which is the sensible default:
    // one number, one thread.
    //
    // Only sign-in codes use this. Order confirmations and the AI's replies
    // must keep coming from the main number, because a customer replies to
    // those and a short code is not where that conversation lives.
    codeNumber: process.env.LYNDRY_CODE_NUMBER || '',
  }),

  // Where handoff_to_human reaches Neil. His personal number, never published.
  supportPhone: process.env.SUPPORT_PHONE || '',

  // Stripe holds the cards. Nothing outside src/providers/payments/ should
  // read these — same rule as Telnyx, for the same reason.
  //
  // The secret key starts sk_test_ in test mode and sk_live_ in live mode, and
  // that prefix is the ONLY thing that decides whether real money moves. There
  // is no separate switch to forget to flip.
  stripe: Object.freeze({
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  }),

  shelly: Object.freeze({
    serverUri: process.env.SHELLY_SERVER_URI || '',
    authKey: process.env.SHELLY_AUTH_KEY || '',
  }),

  adminApiKey: process.env.ADMIN_API_KEY || '',

  // Wash & fold is priced by weight, so the real price of an order is not
  // known until a driver has weighed it. Everything a customer is told before
  // that point is an estimate, and must be described as one.
  pricing: Object.freeze({
    perPoundCents: 250,

    // The minimum order, charged when a pickup is booked.
    //
    // Exactly 10 lb at the rate above. A genuine MINIMUM, not a deposit: an
    // 8 lb load costs this and nothing comes back, because a small load still
    // costs a full pickup and a full delivery. At weigh-in we charge the
    // difference between this and the real total, and nothing more when the
    // real total is smaller.
    //
    // Change this and the website copy has to change with it, because a
    // minimum has to be stated before a card is charged, not after.
    minimumCents: 2500,

    // The range quoted to someone asking "roughly what will this cost?".
    // Derived from the rate above and a typical 15–18 lb bag, so if the rate
    // changes these have to change with it or the site quotes a range the
    // arithmetic doesn't support.
    estimateLowCents: 3750, // 15 lb
    estimateHighCents: 4500, // 18 lb

    // The most we will take in a single pickup.
    maxOrderLb: 50,

    // A typical bag, used to turn a bag count into a rough estimate.
    typicalBagLb: 17,
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
  ['STRIPE_SECRET_KEY', 'phase 8 - payments'],
  ['STRIPE_WEBHOOK_SECRET', 'phase 8 - payments'],
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
  ['STRIPE_SECRET_KEY', config.stripe.secretKey],
  ['STRIPE_WEBHOOK_SECRET', config.stripe.webhookSecret],
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
