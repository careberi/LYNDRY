'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const db = require('../db');
const { config } = require('../config');
const { site, textUsQrSvg } = require('../web/site');
const { renderPage } = require('../web/layout');

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
    description: `Laundry pickup and delivery in ${site.serviceArea}. Wash, dry and fold, ${site.priceDisplay} a bag, back at your door within ${site.turnaround}.`,
  },
  {
    path: '/how-it-works',
    file: 'how-it-works.html',
    title: 'How it works',
    description: `How LYNDRY works: text us, leave your bag out, and it comes back washed and folded within ${site.turnaround}. You never need to be home.`,
  },
  {
    path: '/pricing',
    file: 'pricing.html',
    title: 'Pricing',
    description: `${site.priceDisplay} per bag for wash, dry and fold. No subscription, no minimum, pickup and delivery included.`,
  },
  {
    path: '/signup',
    file: 'signup.html',
    title: 'Get started',
    description: 'Set up your LYNDRY account once, then book laundry pickups by text message.',
  },
  {
    path: '/signup/thanks',
    file: 'signup-thanks.html',
    title: "You're all set",
    description: 'Your LYNDRY account is ready.',
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
    title: 'Messaging terms',
    description: 'Terms for the LYNDRY text messaging programme, including how to opt out.',
  },
  {
    path: '/contact',
    file: 'contact.html',
    title: 'Contact',
    description: `Get in touch with LYNDRY. Email ${site.email}, or ask about smart lockers for your building.`,
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
function normalisePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;

  return null;
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
}

// Renders an error banner above the signup form.
function errorBanner(message) {
  return `
  <section class="mx-auto max-w-2xl px-5 pt-4">
    <div role="alert" class="rounded-xl border border-red-200 bg-red-50 p-5">
      <p class="font-medium text-red-900">We couldn't create your account</p>
      <p class="mt-1 text-red-800">${escapeHtml(message)}</p>
    </div>
  </section>`;
}

// The values the signup form needs in order to redisplay what someone typed.
function signupTokens(form = {}, errorMessage = '') {
  return {
    FORM_ERROR: errorMessage ? errorBanner(errorMessage) : '',
    V_NAME: escapeHtml(form.name),
    V_PHONE: escapeHtml(form.phone),
    V_EMAIL: escapeHtml(form.email),
    V_ADDRESS1: escapeHtml(form.address_line1),
    V_ADDRESS2: escapeHtml(form.address_line2),
    V_CITY: escapeHtml(form.city),
    V_STATE: escapeHtml(form.state || 'NJ'),
    V_ZIP: escapeHtml(form.postal_code),
    V_INSTRUCTIONS: escapeHtml(form.special_instructions),
  };
}

function render(res, page, extra = {}, status = 200) {
  res.status(status).type('html').send(
    renderPage({
      title: page.title,
      description: page.description,
      path: page.path,
      body: readPageBody(page.file),
      extra,
    })
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Values that only certain pages need.
async function extraTokensFor(page) {
  // The signup form needs empty values for its fields on a fresh visit.
  if (page.path === '/signup') return signupTokens();

  // The home page shows a QR code that opens the customer's messaging app.
  if (page.path === '/') return { QR_SVG: await textUsQrSvg() };

  return {};
}

for (const page of PAGES) {
  router.get(page.path, async (req, res, next) => {
    try {
      render(res, page, await extraTokensFor(page));
    } catch (err) {
      next(err);
    }
  });
}

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${config.baseUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', (req, res) => {
  const urls = PAGES.filter((p) => p.path !== '/signup/thanks')
    .map((p) => `  <url><loc>${config.baseUrl}${p.path}</loc></url>`)
    .join('\n');

  res
    .type('application/xml')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

// ---------------------------------------------------------------------------
// The signup form handler.
//
// Two jobs, both of which matter:
//   1. Save the customer profile, so SMS never has to ask about preferences
//   2. Record consent to be texted — the timestamp and the IP address are our
//      legal proof that this person opted in, and carriers ask to see it
// ---------------------------------------------------------------------------

const SIGNUP_PAGE = PAGES.find((p) => p.path === '/signup');

router.post('/signup', async (req, res, next) => {
  const form = req.body || {};

  const fail = (message) =>
    render(res, SIGNUP_PAGE, signupTokens(form, message), 400);

  try {
    // --- Consent. Checked first, because nothing else matters without it. ---
    if (form.sms_consent !== 'yes') {
      return fail(
        'Please tick the box agreeing to receive text messages. LYNDRY works over ' +
          'text, so we cannot set up an account without it.'
      );
    }

    // --- Required fields ---
    const name = String(form.name || '').trim();
    const email = String(form.email || '').trim();
    const addressLine1 = String(form.address_line1 || '').trim();
    const city = String(form.city || '').trim();
    const state = String(form.state || '').trim().toUpperCase();
    const postalCode = String(form.postal_code || '').trim();

    if (!name) return fail('Please tell us your name.');
    if (!looksLikeEmail(email)) return fail('That email address does not look right.');
    if (!addressLine1 || !city || !state || !postalCode) {
      return fail('Please give us a full pickup address, including city, state and ZIP code.');
    }
    if (!/^\d{5}$/.test(postalCode)) return fail('Please enter a five-digit ZIP code.');
    if (!/^[A-Z]{2}$/.test(state)) return fail('Please enter a two-letter state, for example NJ.');

    const phone = normalisePhone(form.phone);
    if (!phone) {
      return fail('Please enter a valid 10-digit US mobile number, for example (201) 555-0142.');
    }

    // --- Is this number already registered? ---
    //
    // We deliberately do NOT overwrite an existing record. Anyone can type any
    // phone number into this form, so allowing an update here would let a
    // stranger change a real customer's delivery address.
    const { data: existing, error: lookupError } = await db
      .from('customers')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (existing) {
      return fail(
        `That mobile number is already registered with LYNDRY. If it's yours and you ` +
          `need to change something, email ${site.email} and we'll sort it out.`
      );
    }

    // --- Save ---
    const { error: insertError } = await db.from('customers').insert({
      phone,
      name,
      email,
      address_line1: addressLine1,
      address_line2: String(form.address_line2 || '').trim() || null,
      city,
      state,
      postal_code: postalCode,

      preferences: {
        water_temp: ['COLD', 'WARM', 'HOT'].includes(form.water_temp) ? form.water_temp : 'COLD',
        detergent: ['STANDARD', 'HYPOALLERGENIC', 'CUSTOMER_PROVIDED'].includes(form.detergent)
          ? form.detergent
          : 'STANDARD',
        fabric_softener: form.fabric_softener === 'yes',
        default_pickup_method:
          form.default_pickup_method === 'HAND_TO_DRIVER' ? 'HAND_TO_DRIVER' : 'LEAVE_OUTSIDE',
        special_instructions: String(form.special_instructions || '').trim(),
      },

      // Legal proof of opt-in. req.ip is the visitor's real address because
      // index.js sets 'trust proxy' — without that we would record the
      // hosting platform's proxy instead, which would be worthless.
      sms_consent_at: new Date().toISOString(),
      sms_consent_ip: req.ip,

      status: 'ACTIVE',
    });

    if (insertError) throw insertError;

    // Redirect rather than rendering directly, so refreshing the confirmation
    // page doesn't try to sign the customer up a second time.
    return res.redirect(303, '/signup/thanks');
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
