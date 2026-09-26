'use strict';

// ---------------------------------------------------------------------------
// WHICH ENVIRONMENT, DECIDED BEFORE ANYTHING IS READ.
//
// `.env` is DEVELOPMENT. That is the whole design: the default has to be the
// safe one, because the failure that actually happened - order #2073, a test
// Stripe key against a live card - was somebody getting production without
// meaning to. Production credentials live in Railway, which is where they
// actually run; `.env.production.local` is a local copy for the occasional
// deliberate read, and .gitignore already covers that name.
//
// `--live` ON THE COMMAND LINE IS THE ONLY WAY TO REACH PRODUCTION FROM HERE,
// and it is a command-line argument rather than a setting on purpose. A
// variable would end up pasted into .env "just for now" and left there, which
// undoes the whole thing silently and looks fine. An argument has to be typed
// every single time, and it is visible in the command afterwards - so the
// transcript says which database was touched without anybody having to
// remember to mention it.
// ---------------------------------------------------------------------------
const LIVE = process.argv.includes('--live');

require('dotenv').config({
  path: require('path').join(__dirname, '..', LIVE ? '.env.production.local' : '.env'),
  quiet: true,
});

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

// ---------------------------------------------------------------------------
// WHICH DATABASE THIS IS.
//
// Until 25 September nothing in the whole system knew. The startup banner named
// the environment, the AI model, the SMS driver and the payment mode, and never
// the one thing that decides whether a mistake costs a test row or a customer.
// So a laptop was a fully privileged production node that had been asked nicely
// not to act, and the asking failed once already - order #2073, where a test
// Stripe key met a live card and the customer was recorded as refused.
//
// A PROJECT REFERENCE IS NOT A SECRET. It is the subdomain of the Supabase URL,
// visible in every request the app makes. The service_role key is the secret and
// is not here. So the real one can be written down, which is what lets the
// connection recognise itself rather than be told.
//
// READ OFF THE URL, NEVER DECLARED SEPARATELY. A second field saying which
// environment this is would be a second copy of the same fact, free to disagree
// with the URL directly beneath it - and the copy that disagreed would be the
// one nobody checked.
// ---------------------------------------------------------------------------
const PRODUCTION_PROJECT_REF = 'pauaemlehenfrnjvgzmc';

// THE PROTOCOL IS OPTIONAL, AND THAT IS NOT TIDINESS. A hosting dashboard shows
// a Supabase URL without "https://" on the front, so it is easy to set the
// variable without one - normaliseBaseUrl() below exists because that already
// happened once with APP_BASE_URL. If this failed to recognise the production
// project for that reason, `isProduction` would read false ON PRODUCTION, and
// the development band would appear across the top of lyndry.com.
function projectRefOf(url) {
  const found = /^(?:https?:\/\/)?([a-z0-9-]+)\.supabase\./i.exec(String(url || '').trim());
  return found ? found[1].toLowerCase() : '';
}

const supabaseProjectRef = projectRefOf(supabaseUrl);

// ARE THESE REAL CUSTOMERS? Asked in several places below, and deliberately not
// the same question as NODE_ENV: the deployed development site runs as
// production so that it behaves like production, which means every advertising
// and outreach default keyed on the environment would have switched itself on
// over a database full of invented people.
const supabaseIsProduction = Boolean(supabaseProjectRef) && supabaseProjectRef === PRODUCTION_PROJECT_REF;

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

  // Did somebody deliberately ask for production from a machine that is not
  // production? Read once here so db.js can refuse everything else.
  live: LIVE,
  port,
  baseUrl: normaliseBaseUrl(process.env.APP_BASE_URL, port),

  // The AI model is resolved a single time, at startup. Never try one model,
  // catch an error, and fall back to another per message.
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  supabase: Object.freeze({
    url: supabaseUrl,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

    // The project this connection points at, and whether it is the real one.
    //
    // `isProduction` is deliberately NOT "am I in production" - that is
    // config.env, and the two disagreeing is the entire failure this exists to
    // catch. This one answers "are these rows real customers".
    projectRef: supabaseProjectRef,
    isProduction: supabaseIsProduction,
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

  // HOW LONG THE AI WAITS BEFORE ANSWERING.
  //
  // Neil's call. People text a business the way they text a friend: "hey",
  // then the actual question, then the time, three messages in fifteen
  // seconds. Answering each as it lands gives them three replies and the first
  // two answer half a sentence. So a reply waits, every new message restarts
  // the wait, and the AI is then handed the lot as one message.
  //
  // TEN SECONDS, down from twenty. Neil's call after living with it: the cost
  // of the window is paid by somebody who sends ONE message and then waits the
  // whole thing for an answer, and twenty seconds of nothing reads as broken.
  // Ten still catches the common burst - "hey", then the actual question - and
  // the clock restarts on each message either way, so a real burst is still
  // answered once.
  //
  // Set SMS_REPLY_WAIT_SECONDS to 0 to switch it off entirely - which is what
  // the tests run with, so they are not ten seconds a message.
  replies: Object.freeze({
    // HOW LONG LYN WAITS BEFORE ANSWERING, as a RANGE rather than a number.
    //
    // Neil, 16 September: 20 to 30 seconds, randomised. It was a flat 10.
    //
    // Two reasons for the range over a fixed 25. The stated goal is that the
    // conversation should not feel instantaneous, and a constant gap is the
    // opposite - text twice and the second reply lands exactly as far behind
    // the first, which reads as a machine rather than somebody getting to
    // their phone. And the wait is also the window a person has to step in,
    // which is more useful when it is not a number anybody has learned.
    //
    // ZERO STILL SWITCHES IT OFF ENTIRELY, which is what the tests run with -
    // otherwise every one of them waits half a minute per message. A floor of
    // zero collapses the range, so there is one way to disable it rather than
    // two knobs that have to agree.
    burstSeconds: Number(process.env.SMS_REPLY_WAIT_SECONDS ?? 20),

    // The top of the range. Never below the floor: a ceiling somebody has set
    // lower than the floor is a typo, not an instruction, and the honest
    // reading is that they wanted a fixed wait.
    burstUpToSeconds: Number(process.env.SMS_REPLY_WAIT_MAX_SECONDS ?? 30),

    // The longest a reply can be put off, measured from the FIRST message of
    // the burst. Without it somebody texting every fifteen seconds resets the
    // clock for ever and is never answered at all, which is a worse failure
    // than answering mid-thought.
    burstMaxSeconds: Number(process.env.SMS_REPLY_MAX_SECONDS || 90),
  }),

  // HOW LONG A SIGN-IN CODE WAITS BEFORE IT IS TEXTED, on BOTH sign-ins - staff
  // at /ops/login and customers at /account/login. Zero sends at once, which is
  // what the tests use. It used to be read inside customer-auth.js alone, and
  // the staff sign-in did not wait at all. See src/core/code-sender.js.
  //
  // THREE SECONDS. Neil, 23 September, down from ten.
  //
  // THE DELAY IS NOT A FEATURE OF THE SIGN-IN, and that is why shortening it
  // costs nothing. It exists so the page can answer immediately instead of
  // waiting on the carrier inside the request - the row is written first and
  // the send is handed to a timer, so the screen is up before the text leaves.
  // Ten seconds was simply the first number chosen for that; the work it has
  // to cover is one API call.
  //
  // WHAT IT DOES COST IS REAL AND IS THE REASON IT WAS EVER LONGER THAN ZERO.
  // The code page says the code is ON ITS WAY rather than that it has been
  // sent, because for the length of this delay the page is up and the message
  // is not - and "we texted you a code" is a sentence the phone contradicts,
  // which reads as broken and starts somebody tapping. Three seconds is a
  // shorter lie to have to tell than ten.
  //
  // THE OTHER TWO PROPERTIES ARE UNAFFECTED. One pending send per number, so a
  // second request replaces the first and a burst of taps is still one text
  // carrying the code that will actually be accepted; and flushPendingCodes()
  // still runs in shutdown(), so a deploy inside the window cannot swallow one.
  // Both matter less at three seconds and neither is removed.
  signIn: Object.freeze({
    codeDelayMs: Number(process.env.LOGIN_CODE_DELAY_MS ?? 3_000),
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
  // The PUBLISHABLE key is the exception to "nothing outside the provider may
  // read these", and it is not really an exception: it is not a secret. It goes
  // into the page source of every site that draws a Stripe card field, it can
  // only create a payment attempt, and it cannot read, charge or refund
  // anything. Its prefix follows the secret key's - pk_test_ beside sk_test_.
  //
  // Without it there is no card field on our own page, only the hosted one we
  // send people away to.
  // ---------------------------------------------------------------------------
  // GOOGLE ADS. The tag that tells Google which ad clicks became leads.
  //
  // NOT SECRETS. Both values sit in the page source of every page that carries
  // the tag, which is how Google's tag works; neither can read or change
  // anything in the Ads account. So they have sensible defaults here, and the
  // environment variables exist only to override them.
  //
  // PRODUCTION ONLY. The dev server shares the production database and a
  // laptop full of test page loads would otherwise count as ad traffic, the
  // same trap the nightly pass and the lead sweep are guarded against.
  //
  // leadLabel is the half after the slash in Google Ads' "event snippet" for
  // the Submit lead form conversion (account 719-154-3966, value $1, counted
  // once). Blank would mean the tag loads and reports no conversions, which is
  // the safe way to be missing it.
  //
  // leadValue is what each lead is worth to Google's bidding - a nominal $1,
  // Neil's setting in the conversion action. It is not revenue and nothing here
  // treats it as such.
  // ---------------------------------------------------------------------------
  googleAds: Object.freeze({
    id: process.env.GOOGLE_ADS_ID || 'AW-18438272002',
    leadLabel: process.env.GOOGLE_ADS_LEAD_LABEL || 'n0sjCK-C1_McEILohthE',
    leadValue: 1,
    currency: 'USD',
    // OFF UNLESS THESE ARE REAL CUSTOMERS, whatever the environment says.
    //
    // The deployed development site runs with NODE_ENV=production so that it
    // behaves like production, which is exactly what would have switched the
    // advertising tag on over a database full of invented people - reporting
    // fake conversions into a real ad account that a real bidding algorithm
    // then learns from. Being told to set GOOGLE_ADS_ENABLED=false in a
    // dashboard is not a guard: it is a thing to forget once.
    enabled:
      supabaseIsProduction &&
      (process.env.GOOGLE_ADS_ENABLED === 'true' ||
        (process.env.NODE_ENV === 'production' && process.env.GOOGLE_ADS_ENABLED !== 'false')),

    // THE OFFLINE CONVERSION FEED. Google Ads fetches this on a schedule over
    // HTTPS with Basic auth, which is the only kind of credential its scheduled
    // upload understands - so it is a password on a URL rather than a signed
    // token, and everything about the route is built around that being weak.
    //
    // BLANK SWITCHES THE ROUTE OFF ENTIRELY. A default password would be a
    // published one, and this file is in the repo; an unset credential must
    // never mean "no credential required".
    uploadUser: process.env.ADS_UPLOAD_USER || 'google',
    uploadPassword: process.env.ADS_UPLOAD_PASSWORD || '',
  }),

  stripe: Object.freeze({
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
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
  //
  // AND IT IS BLANK WHERE THE PEOPLE ARE NOT REAL. Same reason as the Google
  // tag above: the development site runs as production on purpose, and a pixel
  // firing Lead events off invented signups teaches a real ad account to look
  // for the wrong people.
  metaPixelId: supabaseIsProduction
    ? (process.env.META_PIXEL_ID || '1014591328609412').trim()
    : '',

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

  // LEADS OFF THE FACEBOOK ADVERTS.
  //
  // Meta's instant form writes every lead into a Google Sheet, and src/core/
  // leads.js reads that sheet and texts anybody new. The id is not a secret -
  // the sheet is readable by anybody with the link, which is exactly what lets
  // this run with no Meta account, no access token and nothing to renew.
  //
  // Blank switches the whole thing off, which is what a fork of this codebase
  // with no adverts running should have.
  leads: Object.freeze({
    // OFF WHERE THE DATABASE IS NOT THE REAL ONE, and this one defaults to the
    // REAL SHEET when the variable is merely absent - `??` only falls back on
    // undefined, so forgetting it in a dashboard is not a blank, it is the live
    // lead list. A development site reading that sheet would take real people
    // who just tapped a real advert, write them into a database nobody watches,
    // and mark them dealt with in its own copy of the table.
    sheetId: supabaseIsProduction
      ? process.env.LEADS_SHEET_ID ?? '1t3IuoMGREVgQR08lJLxwIsqDQj6GVIJ3MQgdhDyXm94'
      : '',

    // How often the sheet is checked, in minutes. Neil asked for "immediately";
    // a lead who has just tapped an advert is the hottest we will ever have
    // them, so this is faster than the ten-minute tick the nightly pass runs
    // on. Quiet hours still apply - see src/core/scheduler.js.
    pollMinutes: Number(process.env.LEADS_POLL_MINUTES || 3),
  }),

  // THE LAUNDROMAT PITCH PAGE, WHICH IS NOT A PUBLIC PAGE.
  //
  // Neil, 14 September: it opens only with the token we text, and only for
  // about five minutes after it goes out.
  //
  // Five minutes is short for a sales page and that is the point - it is sent
  // to somebody he is standing in front of or already on the phone to, and it
  // is meant to be opened there and then. The cost is real and worth knowing:
  // an owner who puts the phone down and comes back an hour later gets an
  // expired link and has to be sent another. That is why the expired page says
  // so in as many words rather than quietly showing nothing.
  partners: Object.freeze({
    pitchLinkMinutes: Number(process.env.PITCH_LINK_MINUTES || 5),
  }),

  // ---------------------------------------------------------------------------
  // THE COURIER MODEL, WHICH IS A DIFFERENT BUSINESS AND IS OFF BY DEFAULT.
  //
  // Neil, 25 September: couriers instead of the van, a per-pound rate derived
  // from what the laundromat charges, a delivery fee that carries no margin,
  // and a flat $30 minimum. Being built in development first, so this is a
  // SETTING rather than a replacement - production keeps today's flat $2.00
  // until he decides to switch, both branches carry the same code, and going
  // live is one variable rather than a merge nobody can review.
  //
  // WHY A SETTING RATHER THAN A BRANCH THAT DIVERGES. The dev branch is merged
  // with main regularly; a pricing change living only in dev would either block
  // those merges or arrive in production by accident on the first one that went
  // through unread.
  // ---------------------------------------------------------------------------
  // WHO ACTUALLY DRIVES. Nothing outside src/providers/couriers/ may read these
  // - the same rule Telnyx and Stripe already follow.
  //
  // ALL FOUR BLANK IS THE ORDINARY STATE while this is being built: the fake
  // courier takes over and the whole flow can be walked without an account.
  // Test mode is forced wherever the data is invented, so a simulated courier
  // is the most that can ever happen against a seeded address.
  uber: Object.freeze({
    customerId: process.env.UBER_CUSTOMER_ID || '',
    clientId: process.env.UBER_CLIENT_ID || '',
    clientSecret: process.env.UBER_CLIENT_SECRET || '',
    webhookSecret: process.env.UBER_WEBHOOK_SECRET || '',
    testMode: process.env.UBER_TEST_MODE === 'true' || !supabaseIsProduction,
  }),

  courier: Object.freeze({
    model: process.env.PRICING_MODEL === 'DYNAMIC' ? 'DYNAMIC' : 'FLAT',

    // Uber Direct's published bands, one LEG, in cents. From their own pricing
    // panel: flat rates by routed distance, 0% commission. An order is two legs
    // - out to the laundromat and back - so every fee below is doubled.
    //
    // THE BANDS ARE THEIRS AND ARE NOT OURS TO INTERPOLATE. A customer at 5.1
    // miles is in the 5-6 band, not 2% into it.
    //
    // THE MILES IN THIS TABLE ARE UBER'S ROUTED MILES, NOT A STRAIGHT LINE, and
    // the two are not convertible. Measured from the Carlstadt laundromat:
    // Hackensack is 4.6 miles across the map and bills $10.99, which is their
    // 7-10 band, because the road goes around the Meadowlands and over the
    // river. Glen Rock is 9.4 miles across the map - twice as far - and bills
    // the SAME $10.99, because it is a straight run up Route 17. So the implied
    // road factor ranges from about 1.0 to over 2.2 within one county.
    //
    // WHICH IS THE WHOLE REASON THE FEE COMES FROM THE COURIER. `quote.js` uses
    // this table only to decide which laundromats are worth asking about, and
    // in development where there is nobody to ask.
    bands: Object.freeze([
      Object.freeze({ upToMiles: 5, legCents: 799 }),
      Object.freeze({ upToMiles: 6, legCents: 899 }),
      Object.freeze({ upToMiles: 7, legCents: 999 }),
      Object.freeze({ upToMiles: 10, legCents: 1099 }),
    ]),

    // UBER DIRECT STOPS AT TEN ROUTED MILES. Their published table has no band
    // past 7-10, and anything longer comes back `address_undeliverable` - which
    // reads like a coverage refusal and is not one. Every town tested prices a
    // short trip inside itself, Manhattan included.
    //
    // OURS IS MEASURED AS THE CROW FLIES, SO THIS NUMBER IS MORE GENEROUS THAN
    // THEIRS, which is the wrong direction: a customer 9.4 miles across the map
    // can be twelve by road and be refused. It is a pre-filter for deciding
    // which laundromats to ASK about, never a promise - Neil, 25 September:
    // "we should always check with uber to see if we can deliver to a location
    // before we tell someone we can".
    maxMiles: 10,

    // WHAT A METRO COSTS ON TOP, per trip, from Uber's own fee panel. New York
    // City is the only one that can reach this business; California and Seattle
    // are on the same list and are somebody else's problem.
    //
    // IT IS ALREADY INSIDE THE QUOTE - a Manhattan trip came back $12.99, which
    // is exactly $7.99 plus this - so nothing has to add it. It is recorded
    // because an order is TWO legs, so serving New York costs $10 an order
    // before a single pound is washed, and that is a decision rather than a
    // detail.
    nycSurchargeCents: 500,

    // WHAT NEIL KEEPS, per category, as a share of the laundry charge. The
    // delivery fee carries none of it: it is passed through at cost, so a
    // customer further away pays more for the driving and not for the wash.
    margins: Object.freeze({ ONE_TIME: 0.2, SUBSCRIPTION: 0.1, WHOLESALE: 0.05 }),

    // Stripe's cut, taken off the top of everything the customer is charged, so
    // both the rate and the fee have to be grossed up by it or the margin is
    // short by exactly this much.
    stripePercent: 0.029,
    stripeFixedCents: 30,

    // THE LEAST AN ORDER CAN COST, flat, whatever the distance or category.
    // Neil's call, 25 September, replacing a minimum that moved with the band
    // and the tier - four numbers a customer would have had to be told. It
    // binds below roughly ten pounds and is invisible above it.
    minimumCents: 3000,

    // A quote is compared between laundromats at one weight, because "which is
    // cheapest" depends on how much laundry there is: a cheap laundromat far
    // away wins on a big load and loses on a small one. Twenty pounds is about
    // a full machine and sits near the point where the two effects balance.
    compareAtLb: 20,
  }),

  // Wash & fold is priced by weight, so the real price of an order is not
  // known until a driver has weighed it. Everything a customer is told before
  // that point is an estimate, and must be described as one.
  pricing: Object.freeze({
    perPoundCents: 200,

    // WHAT A SUBSCRIBER PAYS INSTEAD. Neil's decision lock, 15 September:
    // $1.80 a pound on a subscription, $2.00 for a one-time pickup.
    //
    // A SEPARATE NUMBER, NEVER A DISCOUNT OFF THE OTHER ONE. It is a rate, and
    // the two rates are set independently - deriving it as "10% off" would make
    // every future move of either price silently move the other, and would put
    // a second copy of the subscription price in whatever did the arithmetic.
    //
    // IT IS ALSO NOT A PROMOTION. Promotions come off a price that has already
    // been worked out, they are granted per customer, they expire, and they are
    // counted. This decides which price is worked out in the first place, so
    // the two stack exactly as Neil asked: a subscriber holding a 50% offer
    // pays half of $1.80, not half of $2.00.
    //
    // WHAT MAKES CANCELLING SAFE is not here at all - it is that
    // orders.price_per_lb_cents snapshots whichever of these two applied at the
    // moment the pickup was booked. Cancelling a subscription cannot re-price a
    // pickup already taken, because there is nothing left to re-price.
    subscriptionPerPoundCents: Number(process.env.SUBSCRIPTION_PER_POUND_CENTS || 180),

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

    // THE SHOW-UP CHARGE, HELD ON THE CARD BEFORE A PICKUP IS CONFIRMED.
    //
    // Neil, 14 September: $25, down from the $50 and $80 that were discussed
    // and never built. It is an AUTHORIZATION - the money is held, not taken -
    // and what it buys is the trip: a van leaving with a driver in it costs the
    // same whether or not there is a bag on the step.
    //
    // At the door the real total is worked out and this is what happens:
    //
    //   total is $25 or less   capture that much of the hold, and no more
    //   total is more          capture the $25 and charge the rest on the
    //                          same card
    //   the rest is refused    KEEP the $25, leave the bags, wash nothing
    //
    // THE LAST LINE IS THE POINT. The customer paid for the trip, not for
    // laundry we never took, so the $25 is not a credit against a future wash
    // and must never be treated as one.
    //
    // It happens to equal minimumCents today and that is a coincidence of
    // arithmetic, not a relationship. The minimum is the floor on what a wash
    // COSTS; this is what a doorstep visit is worth if no wash happens. Do not
    // collapse them into one constant.
    authorizationCents: Number(process.env.AUTHORIZATION_CENTS || 2500),

    // HOW LONG A HOLD IS TRUSTED FOR, in days.
    //
    // Stripe lets an uncaptured card authorization expire on its own, usually
    // at seven days and sometimes sooner depending on the issuer. A pickup
    // booked a fortnight out would therefore reach the doorstep with a hold
    // that had quietly lapsed - the driver weighs the bags, the capture fails,
    // and the card has to be charged the whole amount cold, which is the one
    // thing holding the $25 was meant to have already tested.
    //
    // Five rather than seven: the night-before pass is the only chance to
    // replace one, so the margin has to cover a hold placed the morning before
    // that pass and used the evening after it.
    authorizationFreshDays: Number(process.env.AUTHORIZATION_FRESH_DAYS || 5),

    // HOW CLOSE A PICKUP HAS TO BE BEFORE WE HOLD ANYTHING. Neil, 14 September:
    // only place the $25 on a booking a day in advance.
    //
    // He is right, and the reason is whose money it is. A hold is a pending
    // line on somebody's card - real money they cannot spend - and a pickup
    // booked a fortnight out would carry one for a fortnight, for a trip nobody
    // is making yet. It would also have expired by the time it mattered, so it
    // would be a fortnight of held money buying nothing at all.
    //
    // Anything further out is held by the night-before pass instead, which is
    // the last honest moment to find out a card will fund the trip and the
    // first moment the money is about to be worth holding.
    authorizationLeadDays: Number(process.env.AUTHORIZATION_LEAD_DAYS || 1),

    // The range quoted to someone asking "roughly what will this cost?".
    // Derived from the rate above and a typical 15–18 lb bag, so if the rate
    // changes these have to change with it or the site quotes a range the
    // arithmetic doesn't support.
    estimateLowCents: 3000, // 15 lb
    estimateHighCents: 3600, // 18 lb

    // THERE IS NO MAXIMUM ON A PICKUP, AND `maxOrderLb` IS GONE. It was 50, and
    // nothing in the system ever enforced it: it set a flag the ops JSON API
    // echoed and no screen read. What it DID do was get recited. It reached the
    // AI's prompt as "Maximum 50 lb per pickup" and five public pages as "we
    // take up to 50 lb", so on 25 September a customer asking about 70 lb was
    // told to split it across two pickups. Neil: we can do more than that,
    // never say it.
    //
    // It is deleted rather than raised, because any number here is a number
    // somebody will publish. If a real ceiling ever exists it belongs to the
    // van and the laundromat, which already have capacities of their own.

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

// ---------------------------------------------------------------------------
// ONE LINE SAYING WHERE YOU ARE, FOR ANYTHING THAT IS ABOUT TO ACT.
//
// The server prints it at boot and every script that touches data prints it
// first. It is written once, here, so a script cannot describe the target
// differently from the server - and it names the DATABASE, which is the fact
// that decides whether a mistake costs a test row or a customer.
//
// It shouts only for the real one. A dev line that looked like a warning would
// be read past within a day, and then the production line would be too.
// ---------------------------------------------------------------------------
function describeTarget() {
  const where = config.supabase.isProduction
    ? '** PRODUCTION **'
    : `dev (${config.supabase.projectRef || 'no database configured'})`;

  const sms = require('./providers/sms').name;
  const pay = require('./providers/payments').mode;

  return `${where}  ·  env ${config.env}  ·  sms ${sms}  ·  payments ${pay}`;
}

module.exports = {
  config,
  describeTarget,
  // Exported so the rule can be tested directly rather than through whatever
  // happens to be in .env when the suite runs.
  projectRefOf,
  PRODUCTION_PROJECT_REF,
  warnAboutMissingEnvVars,
  warnAboutUnusableCredentials,
  warnIfNobodyCanAlwaysBook,
};
