'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const express = require('express');

const db = require('../db');
const notify = require('../core/notify');
const onboarding = require('../core/onboarding');
const adAttribution = require('../core/ad-attribution');
const adConversions = require('../core/ad-conversions');
const signupCard = require('../core/signup-card');
const billing = require('../core/billing');
const wash = require('../core/wash');
const booking = require('../core/booking');

const throttle = require('../core/throttle');
const { config } = require('../config');
const { site, tokens, textUsQrSvg } = require('../web/site');
const { renderPage } = require('../web/layout');
const towns = require('../web/towns');
const structured = require('../web/schema');
const sitePopup = require('../core/site-popup');
const pitchLink = require('../core/pitch-link');
const popup = require('../web/popup');

// The hub path only, so the sitemap and the router cannot disagree about where
// it lives. Requiring the router itself would be circular; this will not.
const LOCATIONS_HUB = '/locations';
const bergen = require('../web/bergen');
const vcard = require('../web/vcard');

const router = express.Router();

const PAGES_DIR = path.join(__dirname, '..', '..', 'public', 'pages');

// ---------------------------------------------------------------------------
// The pages.
//
// Each entry maps a URL to a file in public/pages/. To add a page: write the
// HTML file, add a line here. The shared navigation and footer come from
// src/web/layout.js, so a page file only contains its own middle section.
// ---------------------------------------------------------------------------

const PAGES = [
  {
    path: '/',
    file: 'home.html',
    title: 'Home',
    fullTitle: 'Laundry Pickup & Delivery in Bergen County, NJ | LYNDRY',
    head: () => structured.tags([structured.localBusiness(), structured.service()]),
    description: `Wash and fold pickup in ${site.serviceArea}. ${site.subscriptionPricePerLb}/lb on a subscription, ${site.pricePerLb}/lb one-time, $25 minimum, next-day return. Text to book, no app.`,
  },
  {
    path: '/how-it-works',
    file: 'how-it-works.html',
    title: 'How it works',
    fullTitle: 'How Laundry Pickup Works in Bergen County | LYNDRY',
    head: () =>
      structured.tags([
        structured.faqPage([
          [
            'Do I need my own bag?',
            'Any bag works. Use whatever you have: a laundry sack, a duffel, a sturdy tote.',
          ],
          [
            'How do I pay?',
            `Before your first pickup we text you a secure link to save a card. It is handled by Stripe, our payment processor. The card number never touches this website. Saving it does not charge it: nothing is taken when you book. Your laundry is weighed after we collect it, and that is the moment your card is charged.`,
          ],
          [
            'What if I need to cancel?',
            'Text us. Canceling is free right up until your bag is picked up. Once it is with us it is already being processed, so it cannot be canceled after that.',
          ],
        ]),
      ]),
    description: `Text LYNDRY, leave the bag, get it back the ${site.turnaround}. ${site.subscriptionPricePerLb}/lb wash and fold on a subscription, ${site.pricePerLb}/lb one-time. Nobody needs to be home.`,
  },
  {
    path: '/pricing',
    file: 'pricing.html',
    title: 'Pricing',
    fullTitle: `Wash & Fold Pricing, ${site.subscriptionPricePerLb}/lb Pickup in ${site.serviceArea} | LYNDRY`,
    head: () =>
      structured.tags([
        structured.faqPage([
          [
            'When exactly am I charged?',
            'Once per pickup, after we weigh it, and you are told as it happens. Nothing is taken when you book. The text with the weight and the total arrives at the moment your card is charged. A subscription is charged the same way, per pickup after weighing, never on a cycle.',
          ],
          [
            'Do you charge for pickup or delivery?',
            'No. Both are included in the per-pound rate, whichever one you are on. There is no other fee.',
          ],
          [
            'Is there a subscription?',
            // A RATE, NOT A MEMBERSHIP, and the distinction is Neil's. There is
            // a cheaper per-pound rate for people who want pickups booked
            // automatically; there is still no club, no joining fee and no
            // minimum number of pickups, which is why "no membership" survives
            // everywhere else on the site.
            `Yes, and it is a rate rather than a membership. A one-time pickup is ` +
              `${site.pricePerLb} a pound. A subscription is ${site.subscriptionPricePerLb} a pound ` +
              `with pickups ${site.subscriptionFrequencies}. There is nothing to join, no joining fee ` +
              `and no minimum number of pickups, and you can change how often we come or cancel at any time.`,
          ],
        ]),
      ]),
    // CHARGED AFTER WE WEIGH IT, not on delivery. The brief this came from said
    // "charged once on delivery", which is the model that was replaced when the
    // charge point moved to the laundromat's scale - and the same brief says not
    // to change the charge rule. The rule wins over the sentence describing it.
    description: `${site.subscriptionPricePerLb} a pound on a subscription, or ${site.pricePerLb} a pound for a one-time pickup. $25 minimum. Weighed after pickup, charged once after we weigh it. No booking charge, no delivery fee, no membership.`,
  },
  {
    path: '/faq',
    file: 'faq.html',
    title: 'Questions',
    fullTitle: 'Laundry Pickup Questions in Bergen County, NJ | LYNDRY',

    // THE SAME WORDS THAT ARE ON THE PAGE, AND THE SAME TOKENS.
    //
    // Marking up an answer a visitor cannot see is against Google's own
    // guidelines and is how this feature gets abused, so every string below is
    // the copy out of public/pages/faq.html rather than a summary of it.
    //
    // THE TOKENS ARE LEFT UNRESOLVED ON PURPOSE. fillTokens() runs over the
    // whole document including the head, so {{PRICE_PER_LB}} is substituted at
    // render from the same value the paragraph below it gets. Resolving them
    // here would be a second copy of the price, free to disagree with the
    // visible answer the day somebody changes one - which is the precise thing
    // structured data must never do.
    head: () =>
      structured.tags([
        structured.faqPage([
          [
            'Do I need an app?',
            'No. There is nothing to download and no account to remember. You book by text message, or from your account on this website if you would rather tap than type. Both do the same thing.',
          ],
          [
            'Do I have to be home?',
            'No. Leave the bag where you tell us to leave it: the front door, a side gate, with a doorman. That is where we pick it up and where we bring it back. We text you when it has been picked up, and again with a photo when it is back at your door.',
          ],
          [
            'How does the price work?',
            '{{PRICE_PER_LB}} a pound for a one-time pickup, weighed after we pick it up, or {{SUBSCRIPTION_PRICE_PER_LB}} a pound on a subscription with pickups {{SUBSCRIPTION_FREQUENCIES}}. A subscription is a rate, not a membership: nothing to join and no minimum number of pickups. There is no delivery fee. Nothing is charged when you book. Before your first pickup we text you a secure link to save a card. Saving it takes nothing. Your laundry is weighed after we collect it, and that is the moment your card is charged. We text you the weight and the total at the same time, so you are told the figure every time. A typical bag is {{BAG_WEIGHT}}, which comes to about {{ESTIMATE_RANGE}}. There is a {{MINIMUM}} minimum on a paid order, and we take up to {{MAX_ORDER}} in one pickup.',
          ],
          [
            'What bags can I put it in?',
            'Any bag at all. A laundry sack, a duffel, a tote, a trash bag, whatever you have. You do not need to buy anything. It comes back to you in a fresh plastic bag, and anything reusable you sent it in comes back with it.',
          ],
          [
            'How long does it take?',
            'Back to you the {{TURNAROUND}}. Picked up one day, returned the next.',
          ],
          [
            'What if I need to cancel?',
            'Free, right up until your bag is picked up. Cancel by text, or from your account. Once it is with us it is already being washed, so it cannot be cancelled after that.',
          ],
          [
            'How is it washed?',
            'You choose the water temperature and whether you want fabric softener. We ask once, when you set up, and then never again. Every order uses the same until you tell us otherwise. Detergent is the same for everybody, so there is nothing to choose there, and everything is tumble dried. We wash, dry and fold only. No dry cleaning, pressing or alterations.',
          ],
          [
            'Do you serve my area?',
            'We cover {{SERVICE_AREA}}. Sign up even if you are just outside it and we will tell you when we reach you.',
          ],
          [
            'Can I have pickups booked automatically?',
            `Yes, that is a subscription, and it is ${site.subscriptionPricePerLb} a pound instead of ` +
              `${site.pricePerLb}. Pick the day that suits you and we come ${site.subscriptionFrequencies}, ` +
              `at the same time. We text you the evening before each one, and you can skip one, change how ` +
              `often we come, or cancel whenever you like.`,
          ],
        ]),
      ]),

    description:
      'Common questions about LYNDRY laundry pickup and delivery: no app, you do not need to be home, how the price works and what bags you can use.',
  },
  // /signup is a redirect now, not a page - see the route below. Creating an
  // account and signing in are one screen.
  // /signup/thanks is gone. Creating an account now ends on the code page and
  // then in the portal, so a confirmation screen in between was a page telling
  // somebody their account existed while the thing they came to do - book a
  // pickup - was still two clicks away and unmentioned.
  {
    path: '/start/sent',
    noindex: true,
    // NO POPUP. They have just given us a number, which is the only thing it
    // was going to ask for. The cookie set in POST /start already covers this;
    // saying so here covers the visitor whose browser refused the cookie.
    popup: false,
    // A LEAD PAGE. The home page form's POST marks a real new customer, and
    // this page counts it once. Every outcome of that form still lands here
    // identically; only a real save carries the marker. See
    // src/core/ad-attribution.js.
    leadPage: true,
    file: 'start-sent.html',
    title: 'Check your phone',
    description: 'We have texted you. Reply with your name and address and you are set up.',
  },
  {
    path: '/privacy',
    file: 'privacy.html',
    title: 'Privacy policy',
    description: 'How LYNDRY collects, uses and protects your personal information. We never sell or share your phone number.',
  },
  {
    path: '/terms',
    file: 'terms.html',
    title: 'Terms of service',
    description: 'The terms governing your use of LYNDRY.',
  },
  {
    path: '/sms-terms',
    file: 'sms-terms.html',
    // NO POPUP. This is the page a carrier reviewer opens to read the consent
    // wording, and a discount box over it is the worst possible first
    // impression at the worst possible moment.
    popup: false,
    title: 'Messaging terms',
    description: 'Terms for the LYNDRY text messaging program, including how to opt out.',
  },
  {
    path: '/contact',
    file: 'contact.html',
    title: 'Contact',
    fullTitle: `Contact LYNDRY, Text ${site.publicPhoneDisplay} | Bergen County Laundry`,
    description: `Book by text at ${site.publicPhoneDisplay}. Support call ${site.callPhoneDisplay}. Email ${site.email}.`,
  },
  {
    path: '/partners',
    file: 'partners.html',
    // NO POPUP. A laundromat owner reading our pitch is not somebody to offer
    // a consumer discount to, and a popup over a sales page is noise on top of
    // the argument it is making.
    popup: false,

    title: 'Partners',
    fullTitle: 'Partner with LYNDRY, Laundromats & Buildings in Bergen County',
    description:
      'Work with LYNDRY. Laundromats with spare capacity, and property managers who want laundry offered to their residents.',
  },
  {
    path: '/partners/thanks',
    noindex: true,
    // NO POPUP. A laundromat owner reading our pitch is not somebody to offer
    // a consumer discount to, and a popup over a sales page is noise on top of
    // the argument it is making.
    popup: false,

    file: 'partners-thanks.html',
    title: 'Thanks',
    description: 'We have your details and will come back to you.',
  },
];

// Page files are read from disk once and kept in memory. In development we
// re-read every time instead, so editing an HTML file and refreshing the
// browser is enough to see the change — no restart needed.
const cache = new Map();

function readPageBody(file) {
  if (config.env !== 'development' && cache.has(file)) {
    return cache.get(file);
  }
  const body = fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
  cache.set(file, body);
  return body;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Turns text into something safe to put inside HTML. Without this, anything a
// visitor typed into the form and got shown back to them could inject markup
// or script into the page.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Phone numbers are stored in exactly one format: +1 followed by ten digits.
// Everything else — brackets, dashes, spaces, a leading 1 — is normalised away
// so that the number a customer typed on the website matches the number their
// text message arrives from. Returns null if it isn't a usable US mobile.
// The visitor's address, taking the proxy header first because the app runs
// behind one in production and req.ip is then the proxy.
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
}

function normalisePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;

  return null;
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
}

// Renders an error banner above a form.
function errorBanner(message, heading = "We couldn't create your account") {
  // Stain red is the only red in the design system, and errors are the only
  // thing it is for.
  return `
  <section class="container" style="max-width:760px;padding-top:32px;">
    <div role="alert" class="card card-xl" style="padding:26px;background:var(--stain-100);box-shadow:6px 6px 0 var(--stain-500);">
      <p class="eyebrow" style="margin-bottom:8px;color:var(--stain-600);">${escapeHtml(heading)}</p>
      <p style="font-size:17px;line-height:1.5;color:var(--ink-900);margin:0;">${escapeHtml(message)}</p>
    </div>
  </section>`;
}

// The two values the signup form needs in order to keep what someone typed.
//
// It used to carry eight - an address, a town, a state, a ZIP, a spot - back
// when this form asked for all of it. Those are collected in the portal now,
// so the tokens went with the fields. FORM_ERROR stays for the case where
// somebody reaches /signup?phone=... with something unusable in it; a real
// validation failure is rendered by signupStep() in src/routes/account.js,
// which is where the handler lives.
// signupTokens() is gone with public/pages/signup.html. /signup is a redirect
// to /account/login now, and that page is rendered by src/routes/account.js.

// The values the partner form needs in order to redisplay what someone typed.
function partnerTokens(form = {}, errorMessage = '') {
  return {
    FORM_ERROR: errorMessage ? errorBanner(errorMessage, "We couldn't send that") : '',
    SEL_LAUNDROMAT: form.partner_type === 'LAUNDROMAT' ? 'checked' : '',
    SEL_PROPERTY: form.partner_type === 'PROPERTY' ? 'checked' : '',
    V_COMPANY: escapeHtml(form.company),
    V_CONTACT: escapeHtml(form.contact_name),
    V_PEMAIL: escapeHtml(form.email),
    V_PPHONE: escapeHtml(form.phone),
    V_PCITY: escapeHtml(form.city),
    V_SIZE: escapeHtml(form.size_note),
    V_PMESSAGE: escapeHtml(form.message),
  };
}

// ASYNC SINCE THE POPUP, and it takes the request as well as the response.
// Whether somebody gets the offer popup depends on a cookie they are carrying
// and on a promotion in the database, so this can no longer answer from the
// page definition alone.
async function render(req, res, page, extra = {}, status = 200, conversionId = null) {
  // VARY ON THE COOKIE, because the page is no longer the same for everybody.
  // Nothing caches these responses today; the day something does, a visitor who
  // dismissed the popup must not have their copy of the page handed to the next
  // person who arrives.
  res.set('Vary', 'Cookie');

  res.status(status).type('html').send(
    renderPage({
      title: page.title,
      description: page.description,
      path: page.path,
      body: readPageBody(page.file),
      extra,
      // A page may say it is not worth finding. The sitemap reads the same
      // flag, so a page can never be listed for crawling and told not to be
      // crawled at the same time.
      noindex: Boolean(page.noindex),
      // A page may add structured data. Built here rather than written into the
      // HTML file because every figure in it comes from config and site.js.
      head: page.head ? page.head() : '',
      // And a page may own its whole <title> rather than having the brand
      // appended, which is what the search-facing pages need: sixty
      // characters does not stretch to saying LYNDRY twice.
      fullTitle: page.fullTitle || null,
      // THE GOOGLE ADS TAG. On for everything in PAGES, because being in PAGES
      // is itself the opt-in: every entry is a public page whose address holds
      // no token, and an ad click lands on one of them. A page that ever needs
      // to stay out says `tracking: false`. See googleTag() in layout.js for
      // why the layout's own default is off.
      tracking: page.tracking !== false,
      conversionId,
      // THE OFFER POPUP, ON THE MARKETING PAGES AND NOWHERE ELSE. Being in
      // PAGES is the opt-in, exactly as it is for the Google tag: every entry
      // is a public page a stranger can land on. It is deliberately not on
      // /bergen, which is itself a page with one phone box on it, and it can
      // never reach /account, /pay or /ops, none of which render through here.
      popupHtml: page.popup === false ? '' : await popup.htmlFor(req),
    })
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Values that only certain pages need.
// The card step's markup. Written here rather than in the page file because it
// is conditional - the file has one token where this goes, and the page is
// exactly what it always was when the token is empty.
//
// IT IS THE SECOND THING ON THE PAGE, UNDER THE NUMBER WE TEXT FROM. The text
// handoff is still the product; this is the step that decides whether they ever
// order. Skipping it is a link rather than a hidden control, because a card
// nobody has to add is the honest description of what this is.
function signupCardBlock() {
  return `
    <div class="card card-xl" style="padding:26px;max-width:460px;margin:0 auto 34px;text-align:left;">
      <p class="eyebrow" style="margin:0 0 10px;">One more thing</p>
      <h2 style="font-family:var(--font-display);font-weight:800;font-size:23px;line-height:1.2;margin:0 0 10px;">
        Add a card and you are ready to book
      </h2>
      <p style="font-size:16px;line-height:1.55;color:var(--ink-700);margin:0 0 18px;">
        Nothing is charged now, and nothing is charged when you book. We weigh
        your laundry after we collect it, and that is the moment your card is
        charged. You need one on file before your first pickup, so it is easiest
        to do it here.
      </p>
      <form method="post" action="/start/card" style="margin:0;">
        <button type="submit" class="btn btn-ink btn-lg btn-full">Add a card</button>
      </form>
      <p style="font-size:14px;line-height:1.5;color:var(--ink-700);margin:14px 0 0;">
        Handled by Stripe. The card number never touches this website. You can
        also do it later from the text we just sent.
      </p>
    </div>`;
}

async function extraTokensFor(page, req) {
  // The home page's hero form hands the number over here, so someone who
  // typed it there doesn't have to type it again. It is only ever prefilled —
  // consent still has to be given on this page, with the unticked box.


  // THE CARD STEP ON THE SIGNUP THANK-YOU PAGE, and only for somebody who has
  // genuinely just signed up. The marker is set by POST /start on a real new
  // customer and nowhere else, so a refused number, a throttle, a bot and an
  // existing customer all get this page with the block empty - identical to
  // what they saw before any of this existed.
  //
  // WITH PAYMENTS OFF THERE IS NO BUTTON, because there is nothing behind it.
  // A card step that leads to an error is worse than no card step.
  if (page.path === '/start/sent') {
    const offer = Boolean(signupCard.recall(req)) && billing.paymentsConfigured();
    return { SIGNUP_CARD: offer ? signupCardBlock() : '' };
  }

  // The partner form needs empty values for its fields on a fresh visit.
  if (page.path === '/partners') return partnerTokens();

  // The home page shows a QR code that opens the customer's messaging app,
  // and says what went wrong when a submission bounced back.
  //
  // ONLY THE TWO PROBLEMS THAT ARE THE VISITOR'S OWN INPUT. Everything else
  // /start can refuse - an opted-out number, a throttle - answers with the
  // ordinary success page, because saying more would reveal something about a
  // NUMBER rather than about the form. An unticked box and an unreadable
  // number reveal nothing: the visitor is the one person who already knows.
  if (page.path === '/') {
    const problems = {
      consent: 'Tick the box to say we can text you, then try again.',
      phone: 'That does not look like a US mobile number. Ten digits, area code first.',
    };

    const said = problems[String(req.query.problem || '')] || null;

    return {
      QR_SVG: await textUsQrSvg(),
      START_PROBLEM: said
        ? `<p role="alert" style="margin:14px 0 0;padding:12px 15px;border:2px solid var(--ink-900);
                   border-radius:12px;background:var(--stain-500);color:var(--paper-050);
                   font-size:15px;font-weight:600;max-width:540px;">${escapeHtml(said)}</p>`
        : '',
    };
  }

  // EVERY PAGE GETS AN EMPTY CARD BLOCK BY DEFAULT. An unreplaced token renders
  // as the literal {{SIGNUP_CARD}} on the page, so the safe default is the
  // empty string rather than relying on only one path ever reaching the file.
  return { SIGNUP_CARD: '' };
}

for (const page of PAGES) {
  router.get(page.path, async (req, res, next) => {
    try {
      // A lead page counts a lead only if the form that led here saved one.
      const conversionId = page.leadPage ? adAttribution.takeLead(req, res, page.path) : null;
      await render(req, res, page, await extraTokensFor(page, req), 200, conversionId);
    } catch (err) {
      next(err);
    }
  });
}

// ---------------------------------------------------------------------------
// GET /p/:orderId — a customer's delivery photo
//
// Texted as https://lyndry.com/p/<id>. Two reasons it isn't a direct storage
// link: carriers distrust links to domains that aren't yours, which matters
// for business messaging registration; and a signed storage URL is enormous
// and stops working the day its signature expires.
//
// The order id is a random UUID, which is what makes the link private — it
// cannot realistically be guessed, and nothing else on the page reveals one.
// ---------------------------------------------------------------------------

const PHOTO_LINK_MINUTES = 60;

router.get('/p/:orderId', async (req, res, next) => {
  try {
    const { orderId } = req.params;

    // Anything that isn't a UUID can't be one of ours — don't touch the
    // database for it.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
      return notFound(req, res);
    }

    const { data: order, error } = await db
      .from('orders')
      .select('delivery_photo_path')
      .eq('id', orderId)
      .maybeSingle();

    if (error) throw error;
    if (!order || !order.delivery_photo_path) return notFound(req, res);

    // Signed fresh on every visit, so the link we texted never goes stale.
    const { data: signed, error: signError } = await db.storage
      .from('delivery-photos')
      .createSignedUrl(order.delivery_photo_path, PHOTO_LINK_MINUTES * 60);

    if (signError) throw signError;

    // Short-lived redirect. Never cached, so a shared or forwarded page can't
    // hand someone a working link after the signature has expired.
    res.set('Cache-Control', 'no-store, private');
    return res.redirect(302, signed.signedUrl);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// /bergen — the paid-advert landing page.
//
// KEPT OUT OF `PAGES` DELIBERATELY. Everything in that list is part of the
// website: it goes in the sitemap, it is linked from the navigation, and it is
// meant to be found. This page is none of those things. It exists at the end
// of an advert and nowhere else, it is noindex, it is disallowed in robots,
// and nothing on lyndry.com links to it.
//
// It also renders `bare`, which strips the navigation and the footer, because
// on traffic we are paying for every link is a way to leave without filling
// the form in.
// ---------------------------------------------------------------------------

const BERGEN_DESCRIPTION =
  'Laundry picked up tomorrow in Bergen County. 20% off your first order. ' +
  'Leave the bag at your door and it comes back the next day washed, dried ' +
  'and folded.';

// ---------------------------------------------------------------------------
// /for-laundromats/<token> - the pitch we SEND a laundromat owner.
//
// KEPT OUT OF `PAGES` DELIBERATELY, exactly as /bergen is. Everything in that
// list is part of the website: it goes in the sitemap, it is linked from the
// navigation, and it is meant to be found. This is none of those.
//
// Neil, 14 September: it should not be public, a guessed URL should not show
// the pitch, and the link should only work for about five minutes after it is
// texted to a person. So there is no bare path that renders it and nothing
// anywhere links to it - the only way a working URL exists is /ops/partners
// texting one. See src/core/pitch-link.js.
//
// THREE OUTCOMES, AND THE DIFFERENCE BETWEEN THE LAST TWO IS THE POINT:
//
//   a live token      the pitch
//   a real token,     a page saying the link has expired and to ask for
//   minted too long   another. With a five-minute window this is the common
//   ago               failure, and a silent redirect would read as broken
//   anything else     /partners, saying nothing. Somebody who guessed cannot
//                     tell an expired link from a path that does not exist
//
// It renders noindex and with no advertising tag, the same as it did as a
// page, and it is not in the sitemap because it is not in PAGES any more.
// ---------------------------------------------------------------------------
router.get('/for-laundromats/:token', (req, res) => {
  const check = pitchLink.verify(req.params.token);

  if (check.ok) {
    return res.type('html').send(
      renderPage({
        title: 'For laundromats',
        fullTitle: 'Laundromat Partners, Wash and Fold Work from LYNDRY',
        description:
          'How working with LYNDRY works if you run a laundromat: we pick up, ' +
          'you wash, we deliver and bill. No app, no drivers and no customer calls.',
        path: '/for-laundromats',
        body: readPageBody('for-laundromats.html'),
        noindex: true,
      })
    );
  }

  // A REAL LINK THAT HAS GONE COLD. Only reachable by somebody who actually
  // held one, because the signature is checked before the clock is.
  if (check.expired) {
    return res
      .status(410)
      .type('html')
      .send(
        renderPage({
          title: 'That link has expired',
          description: 'Links to our laundromat overview are good for a few minutes.',
          path: '/for-laundromats',
          noindex: true,
          body: `
  <section class="container section" style="max-width:640px;">
    <div class="card card-xl" style="padding:34px;">
      <p class="eyebrow" style="margin:0 0 10px;">Laundromat overview</p>
      <h1 style="font-family:var(--font-display);font-weight:900;font-size:clamp(28px,4vw,40px);line-height:1.05;margin:0 0 14px;">
        That link has expired.
      </h1>
      <p style="font-size:17px;line-height:1.6;color:var(--ink-700);margin:0 0 22px;">
        These links are only good for a few minutes after we send them. Text us
        and we will send you a fresh one.
      </p>
      <a href="sms:${escapeHtml(site.publicPhoneLink)}" class="btn btn-ink btn-lg">Text ${escapeHtml(
        site.publicPhoneDisplay
      )}</a>
    </div>
  </section>`,
        })
      );
  }

  // NOTHING WE EVER SENT. No page, no hint that one exists, no 404 to probe.
  return res.redirect(302, '/partners');
});

// The bare path is not a page. Anybody arriving at it typed it or followed
// something old, and /partners is the honest place for them: it is the form
// this page's readers would otherwise be sent to fill in anyway.
router.get('/for-laundromats', (req, res) => res.redirect(302, '/partners'));

// GET /lyndry.vcf - our contact card.
//
// Tapping this on a phone opens the Add Contact sheet with the name, the number
// and the logo already in it. It matters more than it sounds before launch: a
// text from an unsaved number reads as spam, and one that shows up as LYNDRY
// with a mark beside it does not.
//
// A LINK RATHER THAN AN ATTACHMENT, because sending the file itself is MMS and
// this system has never sent one - the Telnyx adapter takes { to, text } and
// nothing else, and MMS needs provisioning on the messaging profile on top of
// the 10DLC campaign. A texted link on our own domain is also the rule the rest
// of the system already follows, for exactly the carrier-trust reason the
// delivery photos do.
//
// Cached for a day rather than a year: it is small, it changes only when the
// number or the logo does, and a stale contact card is a wrong phone number in
// somebody's address book.
router.get('/lyndry.vcf', (req, res) => {
  res
    .type('text/vcard; charset=utf-8')
    // INLINE, NOT ATTACHMENT. Safari treats an attachment as a download and
    // treats an inline vCard as something to open - and opening is what puts
    // the "Create New Contact" sheet in front of somebody. The filename still
    // rides along for anything that does save it to disk.
    .set('Content-Disposition', 'inline; filename="LYNDRY.vcf"')
    .set('Cache-Control', 'public, max-age=86400')
    .send(vcard.card());
});

// /bergen/sent - where the advert's form lands.
//
// Bare and noindex like /bergen itself: same paid traffic, same reason not to
// give them a navigation to leave through, same reason not to have it turn up
// in a search result on its own.
router.get('/bergen/sent', (req, res) => {
  res.type('html').send(
    renderPage({
      title: 'Check your phone',
      description: BERGEN_DESCRIPTION,
      path: '/bergen/sent',
      body: readPageBody('bergen-sent.html'),
      bare: true,
      noindex: true,
      // Google Ads, Neil's brief: every public page. The lead counts here, once,
      // if /bergen/join just created a customer.
      tracking: true,
      conversionId: adAttribution.takeLead(req, res, '/bergen/sent'),
    })
  );
});

router.get('/bergen', (req, res) => {
  res.type('html').send(
    renderPage({
      title: 'Laundry pickup in Bergen County',
      description: BERGEN_DESCRIPTION,
      path: '/bergen',
      body: readPageBody('bergen.html'),
      bare: true,
      noindex: true,
      tracking: true,
      ogImage: '/og/bergen.png',
      head: bergen.pixel(),
      extra: { BERGEN_SCRIPT: bergen.script },
    })
  );
});

// POST /bergen/join — a customer, exactly like any other.
//
// THERE IS NO WAITLIST TABLE. There was one for an afternoon and Neil was
// right to take it out: somebody who gave us their number, ticked the consent
// box and is about to be texted is a customer, and this codebase already has
// one shape for that. A parallel table would have meant every count, every
// board and every "who have we got" answer quietly disagreed with itself
// depending on which one it read.
//
// So this does what the home page's hero form does: starts a conversation.
// That creates the row with its consent record, grants whatever promotion is
// on auto-grant, and sends the welcome - which knows the service is closed and
// says so. The only thing added here is where they came from.
//
// Answers JSON because the page submits with fetch and swaps the confirmation
// in without navigating, which is what keeps the Meta event on the same page
// view as the submit.
const JOIN_LIMIT = 8;
const JOIN_WINDOW_MS = 10 * 60 * 1000;

router.post('/bergen/join', async (req, res) => {
  const body = req.body || {};
  const ip = clientIp(req);

  // The shape a visitor gets whatever happened, short of us breaking. The
  // honeypot, an opted-out number and somebody we already know all land here:
  // none of them is the visitor's problem to be told about, and an opted-out
  // number being told anything different would turn this page into a way of
  // finding out who is a customer.
  const ok = () => res.json({ ok: true });

  try {
    if (String(body.website || '').trim()) {
      console.warn('Dropped a /bergen signup that filled the honeypot field.');
      return ok();
    }

    if (throttle.hit(`bergenjoin:${ip}`, JOIN_LIMIT, JOIN_WINDOW_MS)) {
      return res.status(429).json({ ok: false, error: 'Too many tries. Give it a minute.' });
    }

    const phone = normalisePhone(body.phone);

    if (!phone) {
      return res.status(400).json({ ok: false, error: 'That does not look like a US mobile number.' });
    }
    if (body.sms_consent !== 'yes') {
      return res.status(400).json({ ok: false, error: 'Please tick the box so we are allowed to text you.' });
    }

    // Somebody who signed up off the advert page is not shown the offer popup
    // when they come back to lyndry.com. Same cookie, same reasoning as
    // POST /start: they have given us a number, so there is nothing left to ask
    // them for. See src/core/site-popup.js.
    sitePopup.markSeen(res);

    const started = await onboarding.startConversation({
      phone,
      consentSource: 'WEB_BERGEN',
      consentIp: ip,
    });

    if (!started.ok) {
      // Almost always an opted-out number. Logged, not surfaced.
      console.log(`/bergen refused ${phone}: ${started.reason}`);
      return ok();
    }

    // WHERE THEY CAME FROM, and only on the way in.
    //
    // Stamped once, when the row is created, and never on somebody we already
    // knew. First touch is the honest answer to "which advert found this
    // person"; overwriting it would mean the last campaign they happened to
    // click always took the credit, including from campaigns that were only
    // ever shown to people we already had.
    if (started.created) {
      // The Google Ads lead and the click that found them. {ok: true} still goes
      // back for every outcome, so the page learns nothing it did not already.
      adAttribution.markLead(res, started.customer.id, '/bergen/sent');
      await adAttribution.recordAdClick(req, started.customer.id);

      const clean = (v) => {
        const s = String(v == null ? '' : v).trim().slice(0, 120);
        return s || null;
      };

      const utm = {
        utm_source: clean(body.utm_source),
        utm_medium: clean(body.utm_medium),
        utm_campaign: clean(body.utm_campaign),
        utm_content: clean(body.utm_content),
      };

      if (Object.values(utm).some(Boolean)) {
        await db
          .from('customers')
          .update(utm)
          .eq('id', started.customer.id)
          .then(({ error }) => {
            // Attribution failing must never fail a signup. The customer, the
            // consent and the text are the parts that matter and have already
            // happened by here.
            if (error) console.error(`/bergen: could not record UTMs: ${error.message}`);
          });
      }
    }

    console.log(`/bergen: ${phone} ${started.created ? 'signed up' : 'was already with us'}.`);
    return ok();
  } catch (err) {
    console.error('/bergen/join failed:', err.message);
    return res.status(500).json({ ok: false, error: 'That did not save. Try again in a moment.' });
  }
});

// ---------------------------------------------------------------------------
// APPLE PAY, AND WHY THIS FILE HAS TO BE HERE.
//
// Neil: "what happened to apple pay". It disappeared the day the card field
// moved onto our own page, and the reason is worth writing down because it is
// not obvious: a wallet button only appears on a domain Stripe has verified,
// and the only verified domain on this account was checkout.stripe.com. The
// hosted card page was ON that domain, so Apple Pay came free. lyndry.com is
// somebody else's domain as far as Apple is concerned.
//
// Verifying it means serving a file Apple gives us, at exactly this path, over
// https, with no redirect. Stripe fetches it, Apple checks it, and the wallet
// buttons start appearing in the Payment Element.
//
// THE FILE IS A PUBLIC CLAIM ABOUT WHO OWNS THIS DOMAIN, not a secret. It is
// fetched by Apple from every site that supports Apple Pay, so it lives in the
// repo like any other static asset rather than in an environment variable.
//
// Served explicitly rather than from a static directory because only
// public/css and public/og are mounted - see src/index.js - and a rule that
// exposes a whole new directory to reach one file is a worse trade than a
// route that serves exactly the one file.
//
// NO FILE, NO ROUTE. A 404 is the honest answer before it is set up, and it is
// what Stripe's verification will report, which is a much clearer failure than
// an empty 200 that Apple would silently reject.
// ---------------------------------------------------------------------------
router.get('/.well-known/apple-developer-merchantid-domain-association', (req, res) => {
  const file = path.join(__dirname, '..', '..', 'public', 'well-known', 'apple-developer-merchantid-domain-association');

  return res.sendFile(file, { headers: { 'Content-Type': 'text/plain' } }, (err) => {
    if (!err) return null;

    // Not there yet. Say so plainly in the log, because the only person who
    // will ever see this failing is somebody halfway through setting it up.
    console.warn('Apple Pay domain file requested but not present at public/well-known/');
    return res.status(404).type('text/plain').send('Not found');
  });
});

// ---------------------------------------------------------------------------
// THE ICONS, cut from Neil's logo. See ICON_LINKS in src/web/layout.js for why
// they replaced the hand-drawn one.
//
// AN ALLOWLIST, NOT A FOLDER. Only public/css is served statically, and that
// stays true: these are six named files, and anything else asked for under
// these names is a 404 rather than a directory somebody can walk.
//
// STABLE URLS, AND THAT IS WHY THEY ARE NOT FINGERPRINTED like the stylesheets.
// Google asks for a favicon URL that does not change, and /css/<hash>/ changes
// on every stylesheet edit - so an icon there would be a new URL to Google on
// every deploy.
//
// A DAY, AND REVALIDATED. /favicon.ico used to be sent for a year with
// `immutable`, on the grounds that the drawing would never change. It did
// change, and immutable meant no browser that had seen it would ever ask for
// the new one. A day costs almost nothing for six small files and means the
// next change reaches people by tomorrow rather than next September.
// ---------------------------------------------------------------------------
const ICON_FILES = Object.freeze({
  '/favicon.ico': 'image/x-icon',
  '/favicon-48.png': 'image/png',
  '/favicon-96.png': 'image/png',
  '/favicon-192.png': 'image/png',
  '/favicon-512.png': 'image/png',
  '/apple-touch-icon.png': 'image/png',
  // The installed ops app. Solid backgrounds, unlike the favicons above.
  '/app-icon-192.png': 'image/png',
  '/app-icon-512.png': 'image/png',
});

for (const [route, type] of Object.entries(ICON_FILES)) {
  router.get(route, (req, res) => {
    res.sendFile(
      path.join(__dirname, '..', '..', 'public', 'icons', path.basename(route)),
      { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400, must-revalidate' } },
      (err) => {
        if (!err) return;
        console.error(`Icon ${route} could not be served: ${err.message}`);
        if (!res.headersSent) res.status(404).end();
      }
    );
  });
}

// ---------------------------------------------------------------------------
// GET /llms.txt - the whole business on one page, in plain text.
//
// For an answer engine that wants the facts without walking eighty-one pages
// and parsing the markup out of them. It is the same information the site
// already states, written once, in the order somebody would ask for it.
//
// EVERY FIGURE COMES FROM site AND config. Nothing here is typed: the price,
// the minimum, the maximum, the turnaround, the service area and both phone
// numbers are the same values the pages render, so this file cannot quietly
// start disagreeing with the website it describes. That is the whole risk of a
// page like this and the only thing that makes it safe to publish.
//
// IT MAKES NO CLAIM THE SITE DOES NOT. No reviews, no ratings, no opening
// hours, no commercial terms for a laundromat - the same refusals the
// structured data keeps, for the same reason: we would be inventing them.
//
// text/plain, so nothing has to be stripped to read it.
// ---------------------------------------------------------------------------
router.get('/llms.txt', (req, res) => {
  const lines = [
    `# ${site.name}`,
    '',
    `> ${site.tagline}`,
    '',
    `${site.name} is a wash and fold laundry pickup and delivery service in ${site.serviceArea}, New Jersey.`,
    'We collect laundry from your door, wash, dry and fold it, and bring it back.',
    '',
    '## What it costs',
    '',
    `- ${site.pricePerLb} per pound for a one-time pickup, weighed after pickup`,
    `- ${site.subscriptionPricePerLb} per pound on a subscription, with pickups ${site.subscriptionFrequencies}`,
    `- ${tokens.MINIMUM} minimum on a paid order`,
    `- Up to ${site.maxOrder} in one pickup`,
    `- A typical bag is ${site.typicalBagWeight}, which comes to about ${site.estimateRange}`,
    '- No delivery fee',
    '- No membership. A subscription is a lower rate, not a club: nothing to join, no joining fee, no minimum number of pickups',
    '',
    '## How it works',
    '',
    `- Back to you the ${site.turnaround}`,
    '- There is no app to download',
    '- You do not need to be home. Leave the bag where you tell us to leave it, and that is where it comes back',
    '- Wash, dry and fold only. No dry cleaning, pressing or alterations',
    '- Nothing is charged when you book. Your laundry is weighed and that is when the card is charged',
    '',
    '## How to book',
    '',
    site.hasPublicPhone ? `- Text ${site.publicPhoneDisplay}` : null,
    `- Or book online at ${config.baseUrl}/account`,
    site.callPhoneDisplay ? `- To speak to somebody, call ${site.callPhoneDisplay}` : null,
    `- Email ${site.email}`,
    '',
    '## Pages',
    '',
    `- [How it works](${config.baseUrl}/how-it-works)`,
    `- [Pricing](${config.baseUrl}/pricing)`,
    `- [Questions](${config.baseUrl}/faq)`,
    `- [Areas we cover](${config.baseUrl}${LOCATIONS_HUB})`,
    `- [Contact](${config.baseUrl}/contact)`,
    '',
    '## Elsewhere',
    '',
    `- [Google Business Profile](${structured.GOOGLE_PROFILE})`,
    `- [Facebook](${structured.FACEBOOK_PAGE})`,
  ];

  res.type('text/plain').send(`${lines.filter((line) => line !== null).join('\n')}\n`);
});

// ---------------------------------------------------------------------------
// ONE STANZA PER CRAWLER, NOT ONE WILDCARD.
//
// Several of these ignore the `*` group entirely, so a site carrying only a
// wildcard is not reliably being read by them at all - which matters now that
// an answer engine is a way somebody finds a laundry service rather than a
// curiosity.
//
// The rules are identical in every group and are generated from the two arrays
// rather than written out eleven times. Eleven hand-written blocks is eleven
// places for a Disallow to go missing, and the one that went missing would be
// the one nobody checked.
//
// WHAT IS DISALLOWED IS UNCHANGED. /ops is the internal tool and /account is
// somebody's signed-in order history - both behind a sign-in anyway, but there
// is no reason for a crawler to be knocking. /bergen is a paid advert with a
// pixel on it rather than a page to be found by searching, and /health is a
// JSON health check.
//
// NOTE WHAT IS DELIBERATELY NOT HERE: /for-laundromats. It carries a noindex
// instead, because Disallow stops the crawl and a crawl is how a noindex gets
// read - see the note on its route above.
// ---------------------------------------------------------------------------
// WHEN THIS BUILD WENT UP, as a date with no time. Read once at startup rather
// than per request, so every URL in a given sitemap carries the same date and
// the file does not appear to change every time it is fetched.
//
// booking.today() rather than new Date().toISOString(), which is UTC and rolls
// over at 8pm here - the same trap that made "pickup today" impossible every
// evening.
const DEPLOYED_ON = booking.today();

const CRAWLERS = [
  '*',
  // Google's search crawler reads the wildcard; Google-Extended is the separate
  // opt-in that governs their AI answers.
  'Google-Extended',
  'OAI-SearchBot',
  'ChatGPT-User',
  'GPTBot',
  'ClaudeBot',
  'Claude-SearchBot',
  'PerplexityBot',
  'Bingbot',
  'Applebot',
  'Applebot-Extended',
];

const CRAWLER_DISALLOW = ['/ops', '/account', '/bergen', '/health', '/ads'];

// ---------------------------------------------------------------------------
// THE OFFLINE CONVERSION FEED, FOR GOOGLE ADS TO FETCH ON A SCHEDULE.
//
// Neil, 11 and 16 September: Google should optimise for customers who pay, not
// for people who fill in a form. src/core/ad-conversions.js works out what to
// say; this is the door it is served through.
//
// WHY A PASSWORD ON A URL, which is the weakest thing in this codebase. Google
// Ads' scheduled upload speaks HTTPS with Basic auth and nothing else - no
// signed token, no key header, no OAuth. So the shape is forced, and everything
// here is built around assuming the credential is the only protection:
//
//   nothing identifying     no name, no email, no address, no order number. A
//                           click id, a hashed phone, a date and an amount
//   blank means OFF         an unset password returns 404, never "no password
//                           needed". A default would be a published default
//   404, never 401          a wrong password gets the same answer as a path
//                           that does not exist, so the file cannot be found
//                           by probing. It is the pitch-link rule: only
//                           somebody who already holds the credential learns
//                           that there is anything here
//   constant time           the same comparison the admin key gets
//   never indexed           noindex, no-store, and /ads is disallowed in robots
//
// A GET THAT WRITES NOTHING. It is a report. Google fetching it twice, or
// fetching it a hundred times, changes nothing here and nothing at Google -
// see the idempotence note in ad-conversions.js.
// ---------------------------------------------------------------------------
function credentialsMatch(header) {
  const expected = config.googleAds.uploadPassword;
  if (!expected) return false;

  const raw = String(header || '');
  if (!/^Basic /i.test(raw)) return false;

  let decoded = '';
  try {
    decoded = Buffer.from(raw.slice(6).trim(), 'base64').toString('utf8');
  } catch (err) {
    return false;
  }

  // The password may itself contain a colon; the user name may not.
  const split = decoded.indexOf(':');
  if (split < 0) return false;

  const user = decoded.slice(0, split);
  const password = decoded.slice(split + 1);

  // CONSTANT TIME, and length-safe: timingSafeEqual throws on a length
  // mismatch, which would itself leak the length.
  const same = (a, b) => {
    const left = Buffer.from(String(a), 'utf8');
    const right = Buffer.from(String(b), 'utf8');
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  };

  return same(user, config.googleAds.uploadUser) && same(password, expected);
}

router.get('/ads/conversions.csv', async (req, res, next) => {
  try {
    if (!credentialsMatch(req.get('authorization'))) {
      // Deliberately not a 401 with a WWW-Authenticate challenge: that would
      // announce the file exists. Google's scheduled upload is configured with
      // the credential up front and never needs to be challenged for one.
      return res.status(404).type('text/plain').send('Not found');
    }

    const csv = await adConversions.feed();

    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
    res.set('Content-Disposition', 'attachment; filename="lyndry-conversions.csv"');
    return res.type('text/csv; charset=utf-8').send(csv);
  } catch (err) {
    return next(err);
  }
});

router.get('/robots.txt', (req, res) => {
  const groups = CRAWLERS.map((agent) =>
    [
      `User-agent: ${agent}`,
      'Allow: /',
      ...CRAWLER_DISALLOW.map((path) => `Disallow: ${path}`),
    ].join('\n')
  ).join('\n\n');

  res.type('text/plain').send(`${groups}\n\nSitemap: ${config.baseUrl}/sitemap.xml\n`);
});

// ---------------------------------------------------------------------------
// The sitemap: every public marketing page, plus the county hub and all 70
// town pages.
//
// WHAT IS DELIBERATELY NOT IN IT. /ops and /account are somebody's business and
// somebody's address and are Disallowed anyway. /bergen is a paid advert with a
// pixel on it, not a page to be found by searching. The thank-you screens have
// no content of their own and carry noindex, so listing them would be asking
// for a page to be indexed and telling it not to be in the same breath.
// ---------------------------------------------------------------------------
router.get('/sitemap.xml', (req, res) => {
  const paths = [
    ...PAGES.filter((p) => !p.noindex && p.path !== '/bergen').map((p) => p.path),
    LOCATIONS_HUB,
    ...towns.TOWNS.map((t) => `/${t.slug}`),
  ];

  // A DATE ON EVERY URL, SO THERE IS SOMETHING TO RECRAWL FOR. Without one
  // there is nothing in the sitemap that ever changes, and nothing telling
  // Google the site is not the same as it was last time it looked.
  //
  // DERIVED FROM WHEN THIS PROCESS STARTED, which is when the deploy happened -
  // the content ships with the code, so a deploy IS the change. It is honest
  // rather than precise: every page shares a date, and that date really is the
  // last time any of them could have changed.
  //
  // The alternative is a per-page timestamp, which would mean storing one, and
  // storing a fact about a file that git already records is the copy this
  // codebase refuses everywhere else.
  const urls = paths
    .map((path) => `  <url><loc>${config.baseUrl}${path}</loc><lastmod>${DEPLOYED_ON}</lastmod></url>`)
    .join('\n');

  res
    .type('application/xml')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

// ---------------------------------------------------------------------------
// POST /start — the phone field on the home page
//
// Takes a number and a ticked consent box, and texts that number. Everything
// after this happens in the customer's messages app.
//
// This is a public endpoint that causes an SMS to be sent to a number a
// stranger typed, which deserves stating plainly: whoever fills this in is not
// necessarily the person who owns the handset. That cannot be designed away,
// only contained, which is what the throttles and the opted-out check below
// are for. One message goes out and nothing more is sent until they reply.
// ---------------------------------------------------------------------------

// Per number: enough for a genuine retype, not enough to be a nuisance.
const START_PER_PHONE = 3;
// Per IP: a household or an office might legitimately sign up a few people.
const START_PER_IP = 10;
const START_WINDOW_MS = 60 * 60 * 1000;

// THE BOXES THAT POST HERE, and what each one is called in the consent record.
// A hidden field in a form is the visitor's to edit, so it chooses between
// doors we already know about; an unrecognised value is the hero, which is
// where the field did not exist at all.
const START_DOORS = Object.freeze({ popup: 'WEB_POPUP' });

router.post('/start', async (req, res, next) => {
  const form = req.body || {};

  // Send everyone to the same page whatever happened.
  //
  // A refusal must not tell the visitor anything about the number they typed.
  // "That number has opted out" would turn this form into a way of finding out
  // whether a given person is a LYNDRY customer, and "already registered" is
  // the same leak in a friendlier voice.
  const done = () => res.redirect(303, '/start/sent');

  // WHICH BOX THIS CAME FROM, and only from a list. The popup posts here with
  // from=popup so its customers are recorded as WEB_POPUP rather than sharing
  // the hero's source - what this column answers is HOW consent was obtained,
  // and "a popup over the page" is a different answer from "the form in the
  // middle of it". Anything else falls back to the hero, so a hand-edited field
  // can never invent a consent source.
  const source = START_DOORS[String(form.from || '').trim().toLowerCase()] || 'WEB_HERO';

  try {
    // The honeypot, same as the partners form. Anything that fills a field a
    // person cannot see gets the success page and is dropped.
    if (String(form.website || '').trim()) {
      console.warn('Dropped a /start submission that filled the honeypot field.');
      return done();
    }

    if (form.sms_consent !== 'yes') {
      // SAY SO, rather than showing the success page.
      //
      // Everything else here answers identically whatever happened, because a
      // refusal must not reveal anything about the NUMBER somebody typed -
      // "that number has opted out" would turn this form into a way to find out
      // who is a customer. An unticked box reveals nothing about anybody: it is
      // the visitor's own input, and they are the one person who already knows.
      //
      // The silent success page was the worst of both. Neil clicked Text me
      // without ticking it and got no error, no text and no explanation - and
      // a visitor who thinks they have signed up and never hears from us is
      // one we have simply lost.
      console.warn('Refused a /start submission with no consent box ticked.');
      return res.redirect(303, '/?problem=consent#start');
    }

    const phone = normalisePhone(form.phone);
    if (!phone) {
      // Also the visitor's own input, and also safe to say out loud: a number
      // that does not parse is not a number we could be revealing anything
      // about. Everything below this point IS about a real number and goes
      // back to answering identically.
      console.warn('Refused a /start submission with an unusable number.');
      return res.redirect(303, '/?problem=phone#start');
    }

    // THEY HAVE HAD THEIR TURN AT THE POPUP. Set here rather than on a real
    // save, and set for every outcome from this point on - an opted-out number,
    // a throttle, somebody already on the books - because a cookie that
    // appeared only for a genuine new customer would be a way to find out which
    // of those happened. The page can read it, so it says nothing the browser
    // did not already know: somebody typed a number into this form.
    sitePopup.markSeen(res);

    if (
      throttle.hit(`start:phone:${phone}`, START_PER_PHONE, START_WINDOW_MS) ||
      throttle.hit(`start:ip:${req.ip}`, START_PER_IP, START_WINDOW_MS)
    ) {
      console.warn(`Throttled a /start submission for ${phone}.`);
      return done();
    }

    // req.ip is the real visitor address because index.js sets 'trust proxy'.
    // It is half of the consent record, so it has to be the visitor's and not
    // the load balancer's.
    const result = await onboarding.startConversation({
      phone,
      consentSource: source,
      consentIp: req.ip,
    });

    if (!result.ok) console.log(`/start refused ${phone}: ${result.reason}`);

    // A REAL NEW CUSTOMER, AND ONLY THAT, IS A LEAD FOR GOOGLE ADS. The
    // redirect below is identical whatever happened; the marker is not, and it
    // is httpOnly, so the page cannot read which it was. See
    // src/core/ad-attribution.js.
    if (result.ok && result.created) {
      adAttribution.markLead(res, result.customer.id, '/start/sent');
      await adAttribution.recordAdClick(req, result.customer.id);

      // AND THE CARD STEP IS OFFERED ON THE NEXT PAGE. Six of six customers
      // with a card on file have ordered; none of the forty five without one
      // ever has. Same condition as the lead marker, and for the same reason:
      // a refusal, a throttle and an existing customer all get the identical
      // page with no marker, so the button cannot be used to find out which.
      signupCard.remember(res, result.customer.id);
    }

    return done();
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// THE CARD STEP, STRAIGHT AFTER SIGNING UP.
//
// Neil, 16 September: card on file is the whole funnel. This is the button on
// /start/sent, and all it does is take somebody to Stripe's own page.
//
// A POST, NOT A LINK, and not a session minted while the page renders. A Stripe
// setup session created on every page load is litter that expires in a day -
// the rule the nudge panel already follows - and it would be created for
// anybody who merely opened the page. Here the session exists only because
// somebody pressed the button.
//
// IT ENROLS NOBODY IN ANYTHING. createSetupLink() takes a customer and saves a
// payment method. No plan, no recurring schedule, no order and no booking
// appear anywhere in this path - which is Neil's "do not enrol them on a plan
// by accident", satisfied by there being no code here that could. A test
// refuses the words rather than trusting the reading.
//
// NOTHING IS CHARGED. Saving a card takes no money, and the page says so before
// the button rather than after it.
// ---------------------------------------------------------------------------
router.post('/start/card', async (req, res, next) => {
  try {
    const id = signupCard.recall(req);
    if (!id) return res.redirect(303, '/start/sent');

    const { data: customer, error } = await db
      .from('customers')
      .select('id, phone, name, stripe_customer_id, payment_method_id')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    // The marker outlived the customer, or somebody has already done this.
    // Either way there is nothing to do and nothing to say about it.
    if (!customer || customer.payment_method_id) {
      signupCard.forget(res);
      return res.redirect(303, '/start/sent');
    }

    const link = await billing.createSetupLink(customer);
    if (!link || !link.url) return res.redirect(303, '/start/sent');

    // One use. Coming back to the page afterwards should not re-offer a step
    // they have just done, and Stripe's own return page is where they land.
    signupCard.forget(res);
    return res.redirect(303, link.url);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// Creating an account lives in src/routes/account.js, on the same screen as
// signing in. /signup redirects there; see the route above.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The partner form.
//
// Laundromats with spare capacity, and property managers who want LYNDRY
// offered to their residents. Both land in the same table.
//
// The enquiry is saved first and Neil is texted second, on purpose: the row is
// the durable record, and the text is a best-effort nudge. If texting is down —
// which it is until carrier registration clears — the enquiry is still safe.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// /signup IS ONE DOOR WITH /account/login NOW.
//
// Neil's call. There were two screens and a person had to know which of the two
// they were before they could start - a stranger to /signup, a customer to
// sign-in. They do not care which they are; they want to place an order. The
// number decides now, on one screen.
//
// THE URL STAYS ALIVE because it is not only ours: it is in the HELP reply
// every carrier requires, on the messaging terms page, and in whatever anybody
// has already bookmarked or written down. A 301 keeps every one of those
// working and tells a search engine the page moved for good.
router.get('/signup', (req, res) => {
  const phone = String(req.query.phone || '').trim();
  return res.redirect(
    301,
    phone ? `/account/login?phone=${encodeURIComponent(phone)}` : '/account/login'
  );
});

const PARTNERS_PAGE = PAGES.find((p) => p.path === '/partners');

const PARTNER_TYPES = { LAUNDROMAT: 'a laundromat', PROPERTY: 'a property manager' };

router.post('/partners', async (req, res, next) => {
  const form = req.body || {};

  const fail = (message) => render(req, res, PARTNERS_PAGE, partnerTokens(form, message), 400);

  try {
    // The honeypot. A person never sees this field; something filling every
    // input in the form does. Answer 303 as though it worked, so whatever
    // submitted it has no signal that it was caught.
    if (String(form.website || '').trim()) {
      console.warn('Dropped a partner enquiry that filled the honeypot field.');
      return res.redirect(303, '/partners/thanks');
    }

    const partnerType = String(form.partner_type || '');
    if (!PARTNER_TYPES[partnerType]) {
      return fail('Please tell us whether you run a laundromat or manage a property.');
    }

    const company = String(form.company || '').trim();
    const contactName = String(form.contact_name || '').trim();
    const email = String(form.email || '').trim();

    if (!company) return fail('Please tell us the name of your company.');
    if (!contactName) return fail('Please tell us your name.');
    if (!looksLikeEmail(email)) return fail('That email address does not look right.');

    // Long enough to be a real message, short enough not to be an essay
    // someone pasted to fill the database.
    const message = String(form.message || '').trim().slice(0, 4000);

    const { error } = await db.from('partner_enquiries').insert({
      partner_type: partnerType,
      company,
      contact_name: contactName,
      email,
      phone: String(form.phone || '').trim() || null,
      city: String(form.city || '').trim() || null,
      size_note: String(form.size_note || '').trim().slice(0, 300) || null,
      message: message || null,
      // req.ip is the visitor's real address because index.js sets
      // 'trust proxy'. It is the only evidence of origin if this gets abused.
      source_ip: req.ip,
      status: 'NEW',
    });

    if (error) throw error;

    // Tell Neil. Best effort — a failure here must not lose the enquiry, so it
    // is caught and logged rather than thrown.
    if (config.supportPhone) {
      await notify
        .sendAndLog(
          config.supportPhone,
          `LYNDRY partner enquiry: ${company} (${PARTNER_TYPES[partnerType]}). ` +
            `${contactName}, ${email}. Check the partner_enquiries table.`,
          null
        )
        .catch((err) => console.error('Could not text the partner enquiry:', err.message));
    }

    // Redirect rather than rendering, so a refresh doesn't send it twice.
    return res.redirect(303, '/partners/thanks');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------

// Anything that didn't match a page above.
function notFound(req, res) {
  res.status(404).type('html').send(
    renderPage({
      title: 'Page not found',
      description: 'That page does not exist.',
      path: req.path,
      body: readPageBody('404.html'),
    })
  );
}

module.exports = { router, notFound };
