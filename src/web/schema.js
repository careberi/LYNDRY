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

// ---------------------------------------------------------------------------
// THE LINE THAT TELLS GOOGLE THE WEBSITE AND THE BUSINESS PROFILE ARE ONE
// COMPANY.
//
// Searching "LYNDRY" was being read as a misspelling of "laundry", and Google
// surfaced other businesses entirely - LNDRY in San Diego among them - because
// nothing on this site said, in a way a machine could read, that lyndry.com and
// the LYNDRY Google Business Profile are the same thing. sameAs is that
// statement, and hasMap points at the profile as the place it is on a map.
const GOOGLE_PROFILE = 'https://www.google.com/maps?cid=17593275115380235469';
const FACEBOOK_PAGE = 'https://www.facebook.com/61592886882434';

// ONE ID FOR ONE BUSINESS, ACROSS EIGHTY-ONE PAGES. Without a stable @id every
// page declares a separate company that happens to share a name, which is the
// opposite of what this markup is for. Everything else that needs to credit the
// business points at this rather than describing it again.
const BUSINESS_ID = `${config.baseUrl}/#business`;

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
  const image = `${config.baseUrl}${site.ogImage}`;

  return {
    '@context': 'https://schema.org',
    // THE SPECIFIC TYPE, NOT THE GENERAL ONE. DryCleaningOrLaundry is what
    // Google matches against the Business Profile's own category;
    // LocalBusiness is true of a hardware shop as well.
    '@type': 'DryCleaningOrLaundry',
    '@id': BUSINESS_ID,
    name: site.name,
    legalName: site.legalName,
    url: `${config.baseUrl}${path}`,
    // THE LINE SOMEBODY CALLS, where there is one. The other number is texted
    // and cannot take a call, and a telephone property is read as a number to
    // ring. Falls back to the texted line so this is never empty.
    telephone: site.callPhoneLink || site.publicPhoneLink,
    email: site.email,
    image,
    logo: image,
    // THIS IS THE ACTUAL FIX. Two links that say the website, the Google
    // Business Profile and the Facebook page are the same company.
    sameAs: [GOOGLE_PROFILE, FACEBOOK_PAGE],
    hasMap: GOOGLE_PROFILE,
    priceRange: `${site.pricePerLb}/lb`,
    areaServed: area(town),
    address: { '@type': 'PostalAddress', addressRegion: 'NJ', addressCountry: 'US' },
    // TWO WAYS IN, AND THEY DO DIFFERENT JOBS. One number is texted and is how
    // every order is placed; the other rings and is for somebody who wants a
    // person. Saying so in the markup is the difference between a search engine
    // offering the right one and offering whichever it found first.
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'reservations',
        telephone: site.publicPhoneLink,
        description: 'Text to book a pickup',
      },
      {
        '@type': 'ContactPoint',
        contactType: 'customer service',
        telephone: site.callPhoneLink,
        email: site.email,
      },
    ],
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
    // A REFERENCE, NOT A SECOND DESCRIPTION. This used to declare its own
    // business inline, so every page carrying a Service also announced a
    // company with no id - one more thing for a search engine to decide was or
    // was not the same LYNDRY. It credits the one above by id instead.
    provider: { '@id': BUSINESS_ID },
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

module.exports = {
  localBusiness,
  service,
  faqPage,
  tags,
  COUNTY,
  GOOGLE_PROFILE,
  FACEBOOK_PAGE,
  BUSINESS_ID,
};
