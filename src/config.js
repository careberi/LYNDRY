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

  // NUMBERS THAT CAN ALWAYS BOOK, whatever the service is doing.
  //
  // Neil's own. He has to be able to put an order through while the service is
  // shut and from an address outside Bergen County, because that is how he
  // tests the thing end to end and how he takes a favour for somebody he
  // knows. Nobody else gets this, and it is a list rather than a flag so a
  // second person can be added without a code change.
  //
  // IT DOES NOT SKIP ANY CHECK THAT PROTECTS THE CUSTOMER. An address, wash
  // preferences, a card and a real date are still required - the two things it
  // waives are the closed sign and the county boundary, which are business
  // rules about who we choose to serve rather than facts a booking needs.
  //
  // THERE IS NO BYPASS UNLESS ONE IS ASKED FOR BY NAME. Neil's call, after an
  // afternoon lost to it: this used to fall back to SUPPORT_PHONE, so his own
  // phone was silently exempt from the closed sign, the opening date and the
  // county. He tested the new opening date from it, was told "I'd love to grab
  // that for you today", and could not tell a working exemption from a broken
  // rule - because a bypass that announces itself nowhere looks exactly like a
  // bug.
  //
  // Comma separated, and empty is now the ordinary state. Setting
  // ALWAYS_BOOK_NUMBERS deliberately is the only way to get one back.
  alwaysBookNumbers: Object.freeze(
    String(process.env.ALWAYS_BOOK_NUMBERS || '')
      .split(',')
      .map((n) => n.replace(/\D/g, ''))
      .filter(Boolean)
      // Stored as ten digits so a number typed with or without the country
      // code, with dashes or without, all compare the same.
      .map((n) => (n.length === 11 && n.startsWith('1') ? n.slice(1) : n))
      .filter((n) => n.length === 10)
  ),

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

  // Meta's advertising pixel, used only on the /bergen advert page.
  //
  // THE ID IS IN THE CODE ON PURPOSE. A pixel id is not a secret - it is in the
  // page source of every site that uses one, and anybody can read ours by
  // viewing /bergen. Putting it here rather than in Railway means the advert
  // page works the moment it deploys, with nothing for Neil to go and set.
  //
  // META_PIXEL_ID still overrides it, for a second pixel or a test one.
  metaPixelId: (process.env.META_PIXEL_ID || '1014591328609412').trim(),

  // What it costs to run the van for a mile, and how long a stop takes.
  //
  // Used to answer one question: an order has just come in, does it fit into
  // what the driver is already doing today, and what does taking it cost?
  //
  // ROUGHLY 70% OF A MILE IS THE DRIVER'S TIME, not fuel. At these numbers a
  // mile is about $1.17 and only 15c of that is petrol. Which is why every
  // answer this produces is in minutes first and miles second - minutes are
  // what actually run out.
  //
  // Environment variables so they can be changed without a code edit, with
  // defaults that are honest starting points rather than measurements. When
  // Neil starts tuning these regularly they want a settings screen and a
  // config table; until then a redeploy is the cheaper mechanism.
  routing: Object.freeze({
    wagePerHour: Number(process.env.ROUTING_WAGE_PER_HOUR || 20),
    gasPerGallon: Number(process.env.ROUTING_GAS_PER_GALLON || 3.4),
    milesPerGallon: Number(process.env.ROUTING_MPG || 22),
    wearPerMile: Number(process.env.ROUTING_WEAR_PER_MILE || 0.18),

    // Average door-to-door speed on residential streets, not a speed limit.
    milesPerHour: Number(process.env.ROUTING_SPEED_MPH || 24),

    // Straight-line distance times this approximates a road. Only used when
    // there are no real driving distances - the planner page gets those from a
    // routing service, this does not, because a driver waiting on a network
    // call to find out whether to take an order is worse than a rough answer.
    roadFactor: Number(process.env.ROUTING_ROAD_FACTOR || 1.3),

    // Minutes on the ground per stop.
    minutesPerPickup: Number(process.env.ROUTING_MIN_PER_PICKUP || 4),
    minutesPerDelivery: Number(process.env.ROUTING_MIN_PER_DELIVERY || 4),
    minutesPerPartnerVisit: Number(process.env.ROUTING_MIN_PER_PARTNER || 10),

    // How long the van is out. Not a promise to anybody - the yardstick for
    // "is today already full".
    workingDayMinutes: Number(process.env.ROUTING_DAY_MINUTES || 480),

    // WHAT THE CARD PROCESSOR TAKES. Stripe's standard US card rate. It is a
    // real cost per order and belongs in any margin figure - on a $50 order it
    // is $1.75, which is not nothing when the whole margin is $8.
    cardFeePercent: Number(process.env.CARD_FEE_PERCENT || 2.9),
    cardFeeFixedCents: Number(process.env.CARD_FEE_FIXED_CENTS || 30),

    // How many numbered clips are in a van. They are physical stock: the
    // system hands out the free ones and takes them back when a bag is dropped
    // at the laundromat, so this is how many exist, not how many to invent.
    // Running out is a real thing that can happen on a heavy day and the run
    // says so rather than making a number up.
    vanClips: Number(process.env.ROUTING_VAN_CLIPS || 50),

    // THE ONE KNOB THAT DECIDES HOW MUCH THE SYSTEM DECIDES ON ITS OWN.
    //
    // A pickup that adds less than this to the run is worth taking without
    // asking anybody. Above it, a person looks. Set it to 0 and every order
    // waits for Neil.
    autoAcceptUnderMinutes: Number(process.env.ROUTING_AUTO_ACCEPT_MIN || 8),
  }),

  // Wash & fold is priced by weight, so the real price of an order is not
  // known until a driver has weighed it. Everything a customer is told before
  // that point is an estimate, and must be described as one.
  pricing: Object.freeze({
    perPoundCents: 200,

    // The minimum order, charged when a pickup is booked.
    //
    // 12.5 lb at the rate above. A genuine MINIMUM, not a deposit: an
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
    estimateLowCents: 3000, // 15 lb
    estimateHighCents: 3600, // 18 lb

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

// NOBODY CAN ALWAYS BOOK. Said out loud at startup, because this is a setting
// whose absence is completely silent: everything keeps working, and the one
// person who is supposed to be exempt from the closed sign is quietly not.
// He would only find out by trying to book on a day the service is shut, which
// is exactly the day it matters.
// NOW THE OTHER WAY ROUND. No exemption is the ordinary state and needs no
// warning; an exemption that EXISTS is the surprising thing, because it books
// on days nobody else can and says nothing about it in the thread.
function warnIfNobodyCanAlwaysBook() {
  if (!config.alwaysBookNumbers.length) return;

  console.warn('');
  console.warn(`  ${config.alwaysBookNumbers.length} number(s) can book past the closed sign,`);
  console.warn('    the opening date and the service area. Set by ALWAYS_BOOK_NUMBERS.');
  console.warn('    Testing from one of them will not show you the ordinary rules.');
  console.warn('');
}

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

module.exports = {
  config,
  warnAboutMissingEnvVars,
  warnAboutUnusableCredentials,
  warnIfNobodyCanAlwaysBook,
};
