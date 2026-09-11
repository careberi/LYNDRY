'use strict';

// ---------------------------------------------------------------------------
// THE HUB AND THE 70 TOWN PAGES.
//
// Somebody in Tenafly types "laundry pickup tenafly", not "wash and fold
// bergen county". These pages exist to be the answer to the first question.
//
// WHY /locations AND NOT /bergen. Neil's brief offered either. /bergen is
// already the paid Facebook landing page - it carries the Meta pixel, records
// consent as WEB_BERGEN, and is deliberately Disallowed in robots.txt because
// it is an advert rather than a page anybody should find by searching.
// Overwriting it would have destroyed a page there is money going to. So the
// hub is /locations and /bergen is untouched.
//
// ONE ROUTE, NOT 70 FILES. The only thing that differs between these pages is
// the town's name and its lead paragraph, both of which live in
// src/web/towns.js. Seventy HTML files would be seventy places for the price,
// the phone number or the charge rule to drift, and the whole reason
// src/web/site.js exists is that they must not.
//
// WHAT KEEPS THEM FROM BEING DOORWAY PAGES is the lead: written once, by hand,
// per town, saying something truer of that town than of the others. See the
// long note at the top of towns.js for what those leads may and may not claim.
// The rest of each page is openly the same on all 70, because the price and the
// turnaround ARE the same in all 70 and pretending otherwise would be a lie
// dressed up as variety.
//
// SLUGS SIT AT THE ROOT - /tenafly, not /locations/tenafly - which is what the
// brief asked for and is the shorter thing to say out loud. That makes this a
// catch-all, so it is mounted LAST and calls next() for anything that is not a
// town, leaving every real route ahead of it untouched.
// ---------------------------------------------------------------------------

const express = require('express');

const { config } = require('../config');
const { site } = require('../web/site');
const { renderPage, escapeHtml, icon } = require('../web/layout');
const towns = require('../web/towns');
const structured = require('../web/schema');

// The minimum is derived from config.pricing rather than typed here, for the
// same reason the price per pound is: two copies of a figure disagree the day
// one of them is edited.
const MINIMUM = `$${(config.pricing.minimumCents / 100).toFixed(0)}`;
const SMS_LINK = `sms:${site.publicPhoneLink}`;

const router = express.Router();

const HUB_PATH = '/locations';
const COUNTY = 'Bergen County';

// ---------------------------------------------------------------------------
// The structured data. One LocalBusiness for the company, one Service for what
// it sells, and areaServed narrowed to the town on a town page.
//
// NO REVIEWS AND NO RATINGS. We have none, and marking up ones we do not have
// is the kind of thing that gets a site penalised rather than ranked.
// ---------------------------------------------------------------------------
// Both come from src/web/schema.js now, so the home page, the hub and the 70
// town pages cannot end up claiming three different prices.
function schema({ path, areaServed }) {
  return [
    structured.localBusiness({ path, town: areaServed }),
    structured.service({ town: areaServed }),
  ];
}

const jsonLd = structured.tags;

// JSON-LD goes in a script tag, and the one character that can break out of it
// is a closing tag inside a string. Nothing here is user input, but escaping it
// costs nothing and means it stays safe if that ever changes.

// ---------------------------------------------------------------------------
// The blocks every town page shares.
//
// They are shared because they are TRUE everywhere. The price is the price in
// all 70; rewording it per town to look unique would be writing 70 slightly
// different versions of a promise, which is how one of them ends up wrong.
// ---------------------------------------------------------------------------
function howItWorks() {
  return `
  <section class="container section" style="max-width:900px;">
    <p class="eyebrow eyebrow-brand">How it works</p>
    <h2 class="display-3">Three texts, clean clothes.</h2>
    <div class="grid-3" style="margin-top:34px;">
      <div class="card card-xl" style="padding:26px;">
        <span class="icon-tile icon-tile-52">${icon('message-circle', '26')}</span>
        <h3 style="font-family:var(--font-display);font-weight:800;font-size:20px;margin:18px 0 8px;">Text us</h3>
        <p style="font-size:15px;line-height:1.55;color:var(--ink-700);margin:0;">
          Say which day. We ask for your address and how you like it washed once,
          then never again.
        </p>
      </div>
      <div class="card card-xl" style="padding:26px;">
        <span class="icon-tile icon-tile-52">${icon('package', '26')}</span>
        <h3 style="font-family:var(--font-display);font-weight:800;font-size:20px;margin:18px 0 8px;">Leave it out</h3>
        <p style="font-size:15px;line-height:1.55;color:var(--ink-700);margin:0;">
          Put the bag where you told us. Nobody needs to be home, and any bag
          works, even a trash bag.
        </p>
      </div>
      <div class="card card-xl" style="padding:26px;">
        <span class="icon-tile icon-tile-52">${icon('package-check', '26')}</span>
        <h3 style="font-family:var(--font-display);font-weight:800;font-size:20px;margin:18px 0 8px;">Get it back</h3>
        <p style="font-size:15px;line-height:1.55;color:var(--ink-700);margin:0;">
          Washed, folded and back at the same spot the ${escapeHtml(site.turnaround)}.
          We text a photo when it is down.
        </p>
      </div>
    </div>
    <p style="margin-top:26px;font-size:16px;">
      <a href="/how-it-works">The longer version of how laundry pickup works</a>.
    </p>
  </section>`;
}

function priceBlock() {
  return `
  <section class="dotfield">
    <div class="container section" style="max-width:900px;">
      <p class="eyebrow eyebrow-brand">Pricing</p>
      <h2 class="display-3">${escapeHtml(site.pricePerLb)} a pound.</h2>
      <p style="font-size:18px;line-height:1.6;color:var(--ink-800);max-width:52ch;">
        ${escapeHtml(MINIMUM)} minimum per pickup. Your laundry is weighed
        after we pick it up, and your card is charged once, after we weigh it.
        Nothing is charged when you book. No delivery fee and no membership.
      </p>
      <p style="margin-top:22px;font-size:16px;">
        <a href="/pricing">See the full wash and fold pricing</a>.
      </p>
    </div>
  </section>`;
}

function cta(town) {
  const where = town ? `in ${town.name}` : `across ${COUNTY}`;

  return `
  <section class="container section" style="max-width:900px;">
    <div class="card card-xl card-brand" style="padding:34px;">
      <h2 style="font-family:var(--font-display);font-weight:900;font-size:clamp(26px,3.4vw,38px);line-height:1.05;margin:0 0 12px;">
        Book a pickup ${escapeHtml(where)}.
      </h2>
      <p style="font-size:17px;line-height:1.55;margin:0 0 24px;max-width:48ch;">
        Text <strong>${escapeHtml(site.publicPhoneDisplay)}</strong>, or place your
        first order online in about a minute.
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:14px;">
        <a href="/account/login" class="btn btn-ink btn-lg">Book a Pickup ${icon('arrow-right', '22')}</a>
        <a href="${escapeHtml(SMS_LINK)}" class="btn btn-outline btn-lg">Text ${escapeHtml(site.publicPhoneDisplay)}</a>
      </div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// GET /locations — the hub.
// ---------------------------------------------------------------------------
router.get(HUB_PATH, (req, res) => {
  const index = towns
    .byLetter()
    .map(
      ([letter, group]) => `
      <div style="break-inside:avoid;margin-bottom:26px;">
        <p class="eyebrow" style="margin-bottom:10px;">${letter}</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${group
            .map(
              (t) =>
                `<a href="/${t.slug}" style="font-size:16px;">${escapeHtml(t.name)}</a>`
            )
            .join('')}
        </div>
      </div>`
    )
    .join('');

  const body = `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="padding-top:70px;padding-bottom:60px;max-width:900px;">
    <p class="eyebrow eyebrow-brand">Areas we cover</p>
    <h1 class="display-2" style="margin-bottom:14px;">Laundry pickup in ${COUNTY}</h1>
    <p style="font-size:19px;line-height:1.5;color:var(--ink-800);max-width:50ch;margin:0;">
      Wash and fold pickup and delivery across ${COUNTY}. Text to book.
      ${escapeHtml(site.pricePerLb)} a pound, ${escapeHtml(MINIMUM)} minimum.
      Next day back at the door.
    </p>
  </div>
</section>

${howItWorks()}
${priceBlock()}

<section class="container section" style="max-width:900px;">
  <p class="eyebrow eyebrow-brand">Every town</p>
  <h2 class="display-3">All 70 municipalities.</h2>
  <p style="font-size:17px;line-height:1.6;color:var(--ink-700);max-width:52ch;margin:0 0 34px;">
    We pick up from houses and apartments alike. If you are in an apartment, put
    the unit number on your address once and the driver comes to your door.
  </p>

  <div style="column-width:200px;column-gap:34px;">
    ${index}
  </div>
</section>

${cta(null)}`;

  return res
    .type('html')
    .send(
      renderPage({
        title: `Laundry Pickup in ${COUNTY}, NJ`,
        fullTitle: `Laundry Pickup in ${COUNTY}, NJ | ${site.name}`,
        description: `Wash and fold laundry pickup across all 70 ${COUNTY} towns. ${site.pricePerLb} a pound, ${MINIMUM} minimum, next-day return. Text to book, no app.`,
        path: HUB_PATH,
        body,
        head: jsonLd(schema({ path: HUB_PATH, areaServed: null })),
        // The Google Ads tag. These pages exist to be found in search, so they
        // are where an ad click is most likely to land. See googleTag().
        tracking: true,
      })
    );
});

// ---------------------------------------------------------------------------
// GET /:slug — one town.
//
// LAST ROUTE IN THE APPLICATION, and it hands anything it does not recognise
// straight back with next(). A catch-all at the root that answered for every
// path would swallow the 404 page and every route added after it.
// ---------------------------------------------------------------------------
router.get('/:slug', (req, res, next) => {
  const town = towns.bySlug(req.params.slug);
  if (!town) return next();

  const path = `/${town.slug}`;
  const name = escapeHtml(town.name);

  // The three questions somebody actually types, answered in the town's own
  // name so the page reads as being about that town rather than about a county.
  const faq = [
    {
      q: `Do you pick up laundry in ${town.name}?`,
      a:
        `Yes. ${town.name} is inside our service area and is picked up on the same ` +
        `terms as the rest of ${COUNTY}: any day you choose, no fixed route day, and ` +
        `your laundry back the ${site.turnaround}.`,
    },
    {
      q: `How much is wash and fold in ${town.name}?`,
      a:
        `${site.pricePerLb} a pound with a ${MINIMUM} minimum per pickup. We weigh ` +
        `your laundry after we pick it up and charge your card once, after we weigh it. ` +
        `Nothing is charged when you book, and there is no delivery fee.`,
    },
    {
      q: 'Do I need to be home?',
      a:
        'No. Leave the bag where you told us to look, and that is where we bring it ' +
        'back. We text you when it has been picked up and send a photo when it is back ' +
        'at your door.',
    },
  ];

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  const body = `
<section class="hero" style="border-bottom:3px solid var(--ink-900);">
  <div class="container" style="padding-top:70px;padding-bottom:60px;max-width:900px;">
    <p class="eyebrow eyebrow-brand">
      <a href="${HUB_PATH}">${COUNTY}</a>
    </p>
    <h1 class="display-2" style="margin-bottom:14px;">Laundry pickup in ${name}</h1>
    <p style="font-size:19px;line-height:1.5;color:var(--ink-800);max-width:52ch;margin:0;">
      ${escapeHtml(town.lead)}
    </p>
  </div>
</section>

${howItWorks()}
${priceBlock()}

<section class="container section" style="max-width:900px;">
  <p class="eyebrow eyebrow-brand">Who we pick up from</p>
  <h2 class="display-3">Houses and apartments in ${name}.</h2>
  <p style="font-size:17px;line-height:1.6;color:var(--ink-700);max-width:56ch;">
    Both, on the same terms. If you are in an apartment, put the unit number on
    your address once and the driver comes to your door rather than a lobby.
    Leave the bag out or hand it to the driver, whichever suits. Nobody has to be
    home at either end.
  </p>
</section>

<section class="container section" style="max-width:900px;padding-top:0;">
  <h2 class="display-3">Questions</h2>
  <div style="margin-top:26px;">
    ${faq
      .map(
        (f) => `
    <div class="qa">
      <h3>${escapeHtml(f.q)}</h3>
      <p>${escapeHtml(f.a)}</p>
    </div>`
      )
      .join('')}
  </div>
</section>

${cta(town)}

<section class="container" style="max-width:900px;padding-bottom:80px;">
  <p style="font-size:16px;color:var(--ink-600);margin:0;">
    <a href="${HUB_PATH}">All ${COUNTY} towns</a> &middot;
    <a href="/how-it-works">How it works</a> &middot;
    <a href="/pricing">Pricing</a>
  </p>
</section>`;

  return res
    .type('html')
    .send(
      renderPage({
        title: `Laundry Pickup in ${town.name}, NJ`,
        fullTitle: `Laundry Pickup in ${town.name}, NJ | ${site.name}`,
        description: `Wash and fold pickup in ${town.name}, ${COUNTY}. ${site.pricePerLb}/lb, ${MINIMUM} minimum, next-day return. Text ${site.name} to book, no app.`,
        path,
        body,
        head: jsonLd([...schema({ path, areaServed: town.name }), faqSchema]),
        tracking: true,
      })
    );
});

module.exports = { router, HUB_PATH };
