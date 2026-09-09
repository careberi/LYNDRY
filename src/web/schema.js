'use strict';

// ---------------------------------------------------------------------------
// STRUCTURED DATA, IN ONE PLACE.
//
// The markup a search engine reads rather than the page a person reads. Three
// pages want it - the home page, the county hub and each of the 70 town pages -
// and if each built its own, the price or the phone number would eventually
// differ between them, which is exactly the disagreement structured data exists
// to avoid.
//
// EVERY FIGURE COMES FROM THE SAME PLACE THE PAGE GETS IT. The price is
// config.pricing, the numbers are site.js. Nothing here is typed twice.
//
// NO REVIEWS, NO RATINGS, NO OPENING HOURS. We have no reviews, so marking any
// up would be inventing them. We have no shopfront hours either: the van runs
// windows, not a counter, and an openingHours claim would be a promise nobody
// made.
// ---------------------------------------------------------------------------

const { config } = require('../config');
const { site } = require('./site');

const COUNTY = 'Bergen County';
const STATE = 'New Jersey';

function county() {
  return {
    '@type': 'AdministrativeArea',
    name: COUNTY,
    containedInPlace: { '@type': 'State', name: STATE },
  };
}

function area(town) {
  return town ? { '@type': 'City', name: town, containedInPlace: county() } : county();
}

// The business itself.
function localBusiness({ path = '/', town = null } = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: site.name,
    legalName: site.legalName,
    url: `${config.baseUrl}${path}`,
    telephone: site.publicPhoneLink,
    email: site.email,
    priceRange: `${site.pricePerLb}/lb`,
    areaServed: area(town),
    address: { '@type': 'PostalAddress', addressRegion: 'NJ', addressCountry: 'US' },
    description: `Wash and fold laundry pickup and delivery in ${
      town ? `${town}, ${COUNTY}` : COUNTY
    }, ${STATE}.`,
  };
}

// What it sells, and for how much.
function service({ town = null } = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: 'Wash and fold laundry pickup and delivery',
    provider: { '@type': 'LocalBusiness', name: site.name, url: `${config.baseUrl}/` },
    areaServed: area(town),
    offers: {
      '@type': 'Offer',
      priceCurrency: 'USD',
      price: (config.pricing.perPoundCents / 100).toFixed(2),
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        priceCurrency: 'USD',
        price: (config.pricing.perPoundCents / 100).toFixed(2),
        unitCode: 'LBR',
        unitText: 'pound',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// A FAQPage, built from questions and answers that are ALSO ON THE PAGE.
//
// That is not a style preference: marking up an answer a visitor cannot see is
// against Google's own guidelines and is the way this feature gets abused. So
// the caller passes the same text the page renders.
// ---------------------------------------------------------------------------
function faqPage(pairs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

// ---------------------------------------------------------------------------
// Into script tags.
//
// The one character that can break out of a JSON string inside <script> is the
// opening angle bracket of a closing tag. Nothing here is user input today, but
// escaping costs nothing and keeps it safe if that ever changes.
// ---------------------------------------------------------------------------
function tags(objects) {
  return objects
    .map(
      (o) =>
        `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`
    )
    .join('\n  ');
}

module.exports = { localBusiness, service, faqPage, tags, COUNTY };
