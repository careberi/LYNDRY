'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const db = require('../db');
const notify = require('../core/notify');
const onboarding = require('../core/onboarding');
const throttle = require('../core/throttle');
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
    description: `Laundry pickup and delivery in ${site.serviceArea}. Wash, dry and fold at ${site.pricePerLb} a pound, back at your door within ${site.turnaround}.`,
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
    description: `${site.pricePerLb} per pound for wash, dry and fold. No subscription, no minimum, pickup and delivery included.`,
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
    path: '/start/sent',
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
    title: 'Messaging terms',
    description: 'Terms for the LYNDRY text messaging programme, including how to opt out.',
  },
  {
    path: '/contact',
    file: 'contact.html',
    title: 'Contact',
    description: `Get in touch with LYNDRY. Email ${site.email}, or ask about offering LYNDRY in your building.`,
  },
  {
    path: '/partners',
    file: 'partners.html',
    title: 'Partners',
    description:
      'Work with LYNDRY. Laundromats with spare capacity, and property managers who want laundry offered to their residents.',
  },
  {
    path: '/partners/thanks',
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
async function extraTokensFor(page, req) {
  // The home page's hero form hands the number over here, so someone who
  // typed it there doesn't have to type it again. It is only ever prefilled —
  // consent still has to be given on this page, with the unticked box.
  if (page.path === '/signup') return signupTokens({ phone: req.query.phone });

  // The partner form needs empty values for its fields on a fresh visit.
  if (page.path === '/partners') return partnerTokens();

  // The home page shows a QR code that opens the customer's messaging app.
  if (page.path === '/') return { QR_SVG: await textUsQrSvg() };

  return {};
}

for (const page of PAGES) {
  router.get(page.path, async (req, res, next) => {
    try {
      render(res, page, await extraTokensFor(page, req));
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

router.get('/robots.txt', (req, res) => {
  // /ops is the internal tool. It is behind a sign-in anyway, but there is no
  // reason for a crawler to be knocking on it.
  // /ops is the internal tool; /account is somebody's signed-in order history.
  // Both are behind a sign-in anyway, but there is no reason for a crawler to
  // be knocking on either.
  res
    .type('text/plain')
    .send(
      `User-agent: *\nAllow: /\nDisallow: /ops\nDisallow: /account\nSitemap: ${config.baseUrl}/sitemap.xml\n`
    );
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

router.post('/start', async (req, res, next) => {
  const form = req.body || {};

  // Send everyone to the same page whatever happened.
  //
  // A refusal must not tell the visitor anything about the number they typed.
  // "That number has opted out" would turn this form into a way of finding out
  // whether a given person is a LYNDRY customer, and "already registered" is
  // the same leak in a friendlier voice.
  const done = () => res.redirect(303, '/start/sent');

  try {
    // The honeypot, same as the partners form. Anything that fills a field a
    // person cannot see gets the success page and is dropped.
    if (String(form.website || '').trim()) {
      console.warn('Dropped a /start submission that filled the honeypot field.');
      return done();
    }

    if (form.sms_consent !== 'yes') {
      // The box is `required` in the markup, so reaching here means the form
      // was posted by something other than the page. No text is sent.
      console.warn('Refused a /start submission with no consent box ticked.');
      return done();
    }

    const phone = normalisePhone(form.phone);
    if (!phone) {
      console.warn('Refused a /start submission with an unusable number.');
      return done();
    }

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
      consentSource: 'WEB_HERO',
      consentIp: req.ip,
    });

    if (!result.ok) console.log(`/start refused ${phone}: ${result.reason}`);

    return done();
  } catch (err) {
    return next(err);
  }
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
      // Which door they came through. See migration 0012 — an audit asks how
      // consent was obtained, not just whether it was.
      sms_consent_source: 'WEB_SIGNUP',

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
// The partner form.
//
// Laundromats with spare capacity, and property managers who want LYNDRY
// offered to their residents. Both land in the same table.
//
// The enquiry is saved first and Neil is texted second, on purpose: the row is
// the durable record, and the text is a best-effort nudge. If texting is down —
// which it is until carrier registration clears — the enquiry is still safe.
// ---------------------------------------------------------------------------

const PARTNERS_PAGE = PAGES.find((p) => p.path === '/partners');

const PARTNER_TYPES = { LAUNDROMAT: 'a laundromat', PROPERTY: 'a property manager' };

router.post('/partners', async (req, res, next) => {
  const form = req.body || {};

  const fail = (message) => render(res, PARTNERS_PAGE, partnerTokens(form, message), 400);

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
