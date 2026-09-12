'use strict';

const { site, tokens } = require('./site');
const { CSS_BASE } = require('./assets');
const { config } = require('../config');

// ---------------------------------------------------------------------------
// The page layout.
//
// Every page on the site is the same wrapper — head, navigation bar, footer —
// with a different middle. That wrapper lives here, once, so a change to the
// navigation or the footer happens in a single place instead of nine.
//
// Styling comes from three stylesheets, in this order:
//
//   css/ds/styles.css   the LYNDRY design system, vendored unmodified.
//                       Colours, type, spacing, borders, shadows, motion.
//                       Do not edit — replace it wholesale if it is updated.
//   css/icons.css       the Lucide glyphs the site uses, as CSS masks.
//   css/lyndry.css      ours. Buttons, cards, inputs, the scallop, the
//                       phone mock, page furniture, the responsive rules.
//
// There is no build step and no CSS framework. Everything is a plain class,
// which for a system this opinionated is far easier to read than forty
// characters of border-and-shadow utilities on every element.
// ---------------------------------------------------------------------------

// /account is deliberately NOT here.
//
// THE PORTAL IS LINKED NOW, AND IT DELIBERATELY WAS NOT BEFORE.
//
// The old note here said that putting a booking form in the nav "invites
// people to go and find a form instead, which is the opposite of the product",
// and left /account and /signup reachable only by anyone who already had the
// address. That was right while the text thread was the only way in.
//
// Neil's call, 8 September: there is a customer portal now, people are meant
// to use it, and a portal nobody can navigate to is not one. What has NOT
// changed is which door is the loud one - "Get started" is still the primary
// button and still goes to the phone box on the home page, because texting us
// is still how most people should start. Sign in is a quiet nav link, for
// somebody who already has an account and wants their own orders.
//
// ONE LINK FOR BOTH STATES. It points at /account/login, which redirects
// straight to /account for anybody already signed in - so the nav needs to
// know nothing about the session, and no page has to be rendered two ways.
const NAV_LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  // The county hub. Named for what somebody is looking for rather than for the
  // county, because half the people reading it will not know Bergen by name.
  { href: '/locations', label: 'Areas' },
  { href: '/faq', label: 'Questions' },
  { href: '/partners', label: 'Partners' },
  { href: '/contact', label: 'Contact' },

  // ALWAYS "ACCOUNT", SIGNED IN OR NOT. Neil's call. It briefly said "Sign in"
  // and swapped to "Account" once a session existed, which meant threading the
  // session through every page render to change one word. /account/login sends
  // anybody already signed in straight on to /account, so the one label is true
  // both ways: it is where your account is, whether or not you are in yet.
  { href: '/account/login', label: 'Account' },
];

// Replaces every {{TOKEN}} in a chunk of HTML with its value.
//
// Values come from site.js, plus any per-request extras — the signup page uses
// those to show an error message and to keep what you typed after a mistake.
//
// A token we don't recognise is left alone rather than silently deleted, so a
// typo shows up on the page instead of vanishing.
function fillTokens(html, extra = {}) {
  const all = { ...tokens, ...extra };
  return html.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(all, key) ? all[key] : whole
  );
}

// Turns text into something safe to put inside HTML. Without this, anything a
// visitor typed — or any customer name in the ops screens — could inject
// markup or script into a page.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// An icon. Always goes through here rather than inline SVG, so swapping icon
// sets stays a change to css/icons.css and nothing else.
function icon(name, size) {
  const sizeClass = size ? ` icon-${size}` : '';
  return `<span class="icon icon-${name}${sizeClass}" aria-hidden="true"></span>`;
}

// The tail of the speech bubble, shared by the logo and the avatar.
//
// An OPEN path — the two diagonals are stroked, the top edge is not, so no
// square corners poke out either side of the join. `vector-effect` keeps the
// stroke a constant width even though preserveAspectRatio="none" is squashing
// the viewBox to whatever the variant asked for.
// The logo: a laundry bag that is also a speech bubble, with the wordmark
// inside it. Variant is 'nav', 'footer', 'compact' or 'offset'.
//
// It is a single piece of artwork now rather than a bubble assembled from CSS.
// The old version built a rounded box, set the wordmark in it and hand-made a
// tail out of an inline SVG; the mark it was standing in for draws the bag,
// the bubble and the type as one shape, so there is nothing left to assemble.
//
// The image is a background rather than an <img> so that its URL comes from
// the fingerprinted stylesheet directory - see the note in lyndry.css. That
// leaves the mark with no text of its own, so the accessible name is put on
// whichever element wraps it: the link's aria-label when it is a link, and
// role="img" on the mark itself when it is not.
function logo(variant, { href = '/', label = 'LYNDRY — home' } = {}) {
  const tag = href ? 'a' : 'span';
  const attrs = href ? ` href="${href}" aria-label="${label}"` : '';
  const markAttrs = href ? ' aria-hidden="true"' : ` role="img" aria-label="${site.name}"`;

  return `<${tag}${attrs} class="ly-logo ly-logo--${variant}">
          <span class="ly-logo__mark"${markAttrs}></span>
        </${tag}>`;
}

// The avatar's own tail. It used to share one constant with the logo; the logo
// is artwork now, so this is the only thing left that needs the shape.
const AVATAR_TAIL =
  '<svg viewBox="0 0 44 26" preserveAspectRatio="none" aria-hidden="true">' +
  '<path d="M0 0 L22 26 L44 0" vector-effect="non-scaling-stroke"></path></svg>';

// The avatar variant — the L in a Suds bubble. Used in the phone mock.
function avatar(size) {
  const style = size ? ` style="--ly-av:${size}px"` : '';
  return `<span class="ly-avatar"${style} aria-hidden="true">
            <span class="ly-avatar__box">L</span>
            <span class="ly-avatar__tail">${AVATAR_TAIL}</span>
          </span>`;
}

// The glyphs page files can drop in. Anything new goes here and in
// public/css/icons.css, and nowhere else.
const ICON_TOKENS = Object.freeze({
  ICON_ARROW: icon('arrow-right', '22'),
  ICON_ARROW_SM: icon('arrow-right', '16'),
  ICON_CHECK: icon('check', '16'),
  ICON_MESSAGE: icon('message-circle', '26'),
  ICON_PACKAGE: icon('package', '26'),
  ICON_PACKAGE_CHECK: icon('package-check', '26'),
  ICON_TRUCK: icon('truck', '26'),
  ICON_MAP_PIN: icon('map-pin', '26'),
  ICON_SHIRT: icon('shirt', '26'),
  ICON_DROPLETS: icon('droplets', '26'),
  ICON_CLOCK: icon('clock', '26'),
  ICON_CARD: icon('credit-card', '26'),
  ICON_CALENDAR: icon('calendar', '26'),
  ICON_USER: icon('user', '26'),

  // The logo's avatar variant, for the phone mock's conversation header.
  AVATAR: avatar(52),
});

// Sticky ink header. The design system pins exactly one thing on the site and
// this is it — 68px of ink, and the hero is sized to fill what's left.
function navBar(currentPath) {
  const links = NAV_LINKS
    .map(({ href, label }) => {
      const current = href === currentPath ? ' aria-current="page"' : '';
      return `<a href="${href}"${current}>${label}</a>`;
    })
    .join('\n          ');

  const mobileLinks = NAV_LINKS
    .map(({ href, label }) => `<a href="${href}">${label}</a>`)
    .join('\n            ');

  return `
    <header class="site-header">
      <div class="container site-header-bar">
        ${logo('nav')}

        <nav class="site-nav">
          ${links}
        </nav>

        <!-- THE SAME DOOR AS THE PURPLE BUTTON ON THE HOME PAGE. Neil's call.
             It used to point at /#get-started, the phone-number box in the hero,
             which is the door for somebody who would rather text. The button in
             the bar is the one people press when they have decided, and what
             they have decided to do is book a pickup.

             ITS TWIN IN THE MOBILE MENU BELOW MOVES WITH IT. The header button
             is hidden under 900px and the hamburger takes over, so leaving one
             behind would mean a phone and a laptop sending the same person to
             two different places. -->
        <a href="/account/login" class="btn btn-primary btn-sm">Book a Pickup</a>

        <!-- Mobile menu. Built on <details> so it needs no JavaScript. -->
        <details class="nav-toggle">
          <summary class="btn btn-primary btn-sm" aria-label="Menu">Menu</summary>
          <div class="nav-panel">
            ${mobileLinks}
            <a href="/account/login">Book a Pickup</a>
          </div>
        </details>
      </div>
    </header>`;
}

function footer() {
  const year = new Date().getFullYear();

  return `
    <footer class="site-footer">
      <!-- The columns align at the TOP, not the bottom. Bottom-aligning made
           each heading sit at a height decided by how many links happened to be
           under it, so Service and Company never lined up. -->
      <div class="container" style="display:flex;align-items:flex-start;justify-content:space-between;gap:40px;flex-wrap:wrap;padding-top:72px;padding-bottom:44px;">

        <div style="max-width:32ch;">
          <div style="margin-bottom:22px;">${logo('footer')}</div>
          <p style="margin:16px 0 0;font-size:15px;line-height:1.55;color:var(--paper-300);">
            Laundry that runs on text messages. Picked up from your door, back
            the ${site.turnaround}.
          </p>
          <p style="margin:10px 0 0;font-size:15px;line-height:1.55;color:var(--ink-400);">
            Serving ${site.serviceArea}.
          </p>
        </div>

        <div>
          <p class="footer-head">Service</p>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <a href="/how-it-works">How it works</a>
            <a href="/pricing">Pricing</a>
            <a href="/locations">Areas</a>
            <a href="/faq">Questions</a>
            <a href="/#get-started">Get started</a>
          </div>
        </div>

        <!-- BOTH DOORS, NAMED. The header carries one quiet "Sign in"; this is
             where somebody who has not signed up yet is told the account exists
             at all. /signup had no link anywhere on the site. -->
        <!-- ONE ENTRY, because there is one screen. It used to offer "Sign in"
             and "Create an account" side by side, which is a choice nobody can
             make before they have typed a number. -->
        <div>
          <p class="footer-head">Your account</p>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <a href="/account/login">Sign in or sign up</a>
          </div>
        </div>

        <div>
          <p class="footer-head">Company</p>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <a href="/partners">Partners</a>
            <a href="/contact">Contact</a>
            <a href="/privacy">Privacy policy</a>
            <a href="/terms">Terms of service</a>
            <a href="/sms-terms">Messaging terms</a>
          </div>
        </div>

        <!-- Centred rather than pulled to the top with the columns. It is one
             control against three blocks of text, and sitting it on the same
             line as the headings leaves it stranded above a lot of nothing. -->
        <a href="/#get-started" class="btn btn-primary btn-lg" style="align-self:center;">
          Get started ${icon('arrow-right', '22')}
        </a>

      </div>

      <div class="container" style="padding-bottom:40px;">
        <!-- Naming the operating company here is not decoration. During
             carrier review for business texting, someone opens this page and
             checks that the company on the registration appears on the site.
             If it doesn't, the campaign is rejected. -->
        <!-- NAME, ADDRESS, PHONE - the three things every local directory and
             every search engine cross-checks against a listing, in one place and
             the same on every page. The address is the county rather than a
             street, because there is no shopfront and inventing one would be
             worse than saying where the van actually goes. -->
        <p class="footer-legal" style="margin-bottom:14px;">
          <strong>${site.name}</strong><br>
          ${site.serviceArea}, New Jersey<br>
          Text <a href="${site.publicPhoneLink ? 'sms:' + site.publicPhoneLink : '#'}">${site.publicPhoneDisplay}</a>
          &middot; Call <a href="tel:${site.callPhoneLink}">${site.callPhoneDisplay}</a><br>
          <a href="mailto:${site.email}">${site.email}</a>
        </p>

        <p class="footer-legal">
          ${site.name} is a service of ${site.legalName}<br>
          &copy; ${year} ${site.legalName} &middot; Message and data rates may apply. Reply STOP to end.<br>
          We never sell or share your phone number with third parties for marketing.
        </p>
      </div>
    </footer>`;
}

// ---------------------------------------------------------------------------

// `bare` strips the navigation and the footer and puts a single unclickable
// logo at the top left. It exists for paid-advert landing pages, where every
// link is a way to leave without filling the form in - including the logo,
// which on every other page goes home.
//
// `head` is raw markup injected into <head>, for the one thing an advert page
// needs that no other page does: a tracking pixel.
// The whole header on an advert page: the mark, and nowhere to click.
//
// Uses the SAME two classes as the real navigation - .site-header for the ink
// bar and .site-header-bar for the row inside it - so it is the same 68px band
// of ink the rest of the site has. The first version put .site-nav on the
// header, which is the class for the row of LINKS inside the bar and carries
// no background at all, so the header rendered transparent over the page.
function bareHeader() {
  return `
    <header class="site-header">
      <div class="container site-header-bar site-header-bar-center">
        ${logo('nav', { href: null, label: site.name })}
      </div>
    </header>`;
}

function renderPage({
  title,
  description,
  path,
  body,
  extra = {},
  noindex = false,
  bare = false,
  head = '',
  ogImage = null,
  // A PAGE MAY OWN ITS WHOLE TITLE. Most pages want "Pricing — LYNDRY" built
  // for them, which is why that is still the default; the search-facing pages
  // want a sentence with the county in it and no room left for a suffix, and
  // pinning those to a pattern is how a 60-character budget gets spent on the
  // brand name twice.
  fullTitle: ownTitle = null,
  // THE GOOGLE ADS TAG, OPT-IN. See googleTag() at the foot of this file for
  // why it is off unless a page asks for it.
  tracking = false,
  // The customer or order id of a real save, on the page that save leads to.
  // Becomes Google's transaction_id. See src/core/ad-attribution.js.
  conversionId = null,
  // Report no query string at all. For a page whose URL carries answers.
  stripQuery = false,
  // THE OFFER POPUP, ALREADY DRAWN. A string, never a decision: whether a
  // visitor gets one is src/core/site-popup.js's business and reading it
  // needs the database, which this function has never touched. Empty for
  // every page that does not ask, which is every page by default - the same
  // shape as `tracking` and for the same reason. See src/web/popup.js.
  popupHtml = '',
}) {
  const fullTitle =
    ownTitle || (path === '/' ? `${site.name} — ${site.tagline}` : `${title} — ${site.name}`);

  // CANONICAL ON EVERY PAGE, ALWAYS THE PATH WITHOUT A QUERY STRING. The same
  // page is reachable with ?saved=, ?error=, utm tags off an advert and a
  // trailing slash, and each of those is a separate URL to a crawler. One of
  // them is the real one and this says which.
  const canonical = `${config.baseUrl}${path}`;

  const html = `<!doctype html>
<html lang="en">
<head>
  ${tracking ? googleTag({ conversionId, stripQuery }) : ''}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fullTitle}</title>
  <meta name="description" content="${description}">

  <meta property="og:title" content="${fullTitle}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <link rel="canonical" href="${canonical}">
  ${
    (ogImage || site.ogImage)
      ? `<meta property="og:image" content="${config.baseUrl}${ogImage || site.ogImage}">
  <meta name="twitter:image" content="${config.baseUrl}${ogImage || site.ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">`
      : ''
  }
  <!-- Signed-in pages carry someone's address and order history. They are
       behind a sign-in, but there is no reason for a crawler to try. -->
  ${noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}

  ${ICON_LINKS}
  <meta name="theme-color" content="#101210">

  <!-- The design system's font file @imports Google Fonts, and an @import
       inside a stylesheet does not start resolving until that stylesheet has
       loaded. Opening the connections early takes a route trip off it. -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>

  <!-- Grandstander. It used to set the logo's wordmark; the logo is artwork
       now and the only thing left using it is the avatar's "L" in the phone
       mock, which is why the loader stays. It is loaded here rather than added
       to css/ds/tokens/fonts.css because that folder is the design system
       vendored unmodified — editing it would be lost the next time the system
       is replaced. -->
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Grandstander:wght@900&display=swap">

  <!-- The /css/<hash>/ path is a fingerprint of the stylesheets. It changes
       whenever any of them changes, which is what makes a deploy visible
       immediately instead of a returning visitor keeping a week-old cached
       copy. See src/web/assets.js. -->
  <link rel="stylesheet" href="${CSS_BASE}/ds/styles.css">
  <link rel="stylesheet" href="${CSS_BASE}/icons.css">
  <link rel="stylesheet" href="${CSS_BASE}/lyndry.css">
${head}
</head>
<body>
${bare ? bareHeader() : navBar(path)}
<main>
${body}
</main>
${bare ? '' : footer()}
${popupHtml}

<script>
  // ---------------------------------------------------------------------
  // Motion. Two systems, both off entirely under prefers-reduced-motion.
  // ---------------------------------------------------------------------
  (function () {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    // --- Scroll reveal ---------------------------------------------------
    //
    // The hiding class goes on from JavaScript, never from plain CSS. A
    // browser that never runs this — or a script that fails to load — then
    // shows the whole page normally instead of a page of invisible sections.
    if ('IntersectionObserver' in window) {
      document.documentElement.classList.add('js-anim');

      var hidden = [];
      var reveal = document.querySelectorAll('[data-reveal]');

      // Anything already on screen at load is shown immediately. Only what is
      // below the fold gets hidden and waits for its turn.
      for (var i = 0; i < reveal.length; i++) {
        if (reveal[i].getBoundingClientRect().top < window.innerHeight * 0.9) {
          reveal[i].classList.add('is-in');
        } else {
          hidden.push(reveal[i]);
        }
      }

      var watcher = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          watcher.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

      hidden.forEach(function (el) { watcher.observe(el); });

      // A fast scroll or a jump to an anchor can carry an element past the
      // viewport without the observer ever firing, which would strand it
      // dimmed and 26px out of place. This sweep is what stops that.
      var sweep = function () {
        for (var i = hidden.length - 1; i >= 0; i--) {
          var el = hidden[i];
          if (el.classList.contains('is-in')) { hidden.splice(i, 1); continue; }
          if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
            el.classList.add('is-in');
            watcher.unobserve(el);
            hidden.splice(i, 1);
          }
        }
      };
      window.addEventListener('scroll', sweep, { passive: true });
    }

    // --- Parallax --------------------------------------------------------
    //
    // Each element's untransformed document position is measured once, then
    // displacement accumulates only from the moment it enters the viewport —
    // so nothing is shifted at page load, only as you scroll past it.
    //
    // An element never carries both data-parallax and data-reveal: they both
    // write transform and would fight over it.
    // Parallax is a desktop effect. On a narrow screen the layout is a single
    // column with no room for anything to drift, and moving blocks around
    // under a thumb is just noise.
    if (window.innerWidth < 900) return;

    var items = [].slice.call(document.querySelectorAll('[data-parallax],[data-parallax-x]'));
    if (!items.length) return;

    var measure = function () {
      items.forEach(function (el) {
        el.style.transform = 'none';
        el.__base = el.getBoundingClientRect().top + window.scrollY;
      });
    };

    var frame = null;
    var apply = function () {
      frame = null;
      var y = window.scrollY;
      items.forEach(function (el) {
        // The scroll position at which this element first entered the
        // viewport. Clamped at zero: an element that is already on screen when
        // the page loads has a threshold of 0, so it starts undisplaced and
        // moves only once you actually scroll. Without the clamp, everything
        // above the fold is thrown out of place before you touch anything.
        var threshold = Math.max(0, el.__base - window.innerHeight);
        var d = Math.max(0, y - threshold);
        var sy = parseFloat(el.getAttribute('data-parallax')) || 0;
        var sx = parseFloat(el.getAttribute('data-parallax-x')) || 0;
        el.style.transform = 'translate3d(' + (-d * sx).toFixed(1) + 'px,' + (d * sy).toFixed(1) + 'px,0)';
      });
    };

    var onScroll = function () {
      if (frame === null) frame = window.requestAnimationFrame(apply);
    };

    measure();
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () { measure(); apply(); });
  })();
</script>
</body>
</html>`;

  // Icons are offered to every page as tokens, so a page file never has to
  // know how a glyph is built — it writes {{ICON_ARROW}} and gets one.
  return fillTokens(html, { ...ICON_TOKENS, ...extra });
}

// ---------------------------------------------------------------------------
// THE ICONS: Neil's logo, not a drawing of it.
//
// The favicon used to be a hand-drawn SVG, inline in this file, meant to be the
// bag-and-bubble silhouette without the wordmark. It came out green, as a plain
// rounded rectangle with a dome on top - nothing like the cream bag with a tied
// bow that the artwork is. Neil saw it beside the site in a Google result on 10
// September: "That is not my logo."
//
// THE LESSON IS THE SAME ONE THE LOGO ITSELF ALREADY TAUGHT. CLAUDE.md says do
// not re-derive the mark in CSS, because a hand copy is only ever a worse
// version of a file we already have. The favicon was exactly that hand copy,
// and it drifted. These files are cut from public/css/logo.png, so they cannot.
//
// THE FULL LOGO, WORDMARK INCLUDED, and that reverses an earlier call on
// purpose. The old reasoning was that LYNDRY smears at 16px, which is true in a
// browser tab. It is not true where the icon actually matters: Google shows it
// in a circle, fetched at 48px or more, and at that size the word reads. Neil
// was shown both versions side by side and chose this one.
//
// REAL URLS, NOT A data: URL. Google cannot crawl a data: URL, so it fell back
// to /favicon.ico. And these are NEW paths on purpose: /favicon.ico was served
// with a one-year immutable cache, which tells a browser never to ask again,
// so anybody who had visited would have kept the green one for up to a year.
// A browser follows the href in these tags, and none of them has ever cached
// these URLs. See src/routes/web.js for how they are served.
//
// sizes="any" on the .ico is the pattern that stops browsers preferring a
// small bitmap from inside it over the PNGs listed above it.
// ---------------------------------------------------------------------------
const ICON_LINKS = [
  '<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">',
  '<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96.png">',
  '<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">',
  '<link rel="icon" href="/favicon.ico" sizes="any">',
  '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
].join('\n  ');

// ---------------------------------------------------------------------------
// THE GOOGLE ADS TAG.
//
// Neil's ask, 10 September, pasting Google's own snippet: measure which ad
// clicks become leads. The markup below is that snippet, with the id read from
// config rather than typed twice.
//
// OPT-IN PER PAGE, AND THAT IS THE WHOLE DESIGN. Google's tag reports the full
// address of every page it runs on, query string and all, to Google. This
// layout is also used by pages whose address IS the secret - /pay/<token>,
// /account/booked/<token>, /account/card/done/<token> - and by some of the ops
// screens. A tag on by default would hand those tokens to an advertising
// platform the first time somebody opened a payment link. Off unless a page
// says otherwise means a page added next year cannot leak by accident; the
// cost is naming the pages that want it, which is a short list.
//
// WHICH PAGES: the public marketing pages and town pages, because an ad click
// lands on one of those and the tag has to be there to catch it - a click that
// lands on an untagged page is a lead Google can never attribute to the ad.
// And the two number forms Neil chose to count, plus the pages after them.
//
// WHERE THE CONVERSION FIRES, and what that honestly measures. The two forms
// are different and so are their answers:
//
//   the home page form   /start/sent. Shown IDENTICALLY whatever was submitted -
//                        a bad number, a throttled one, an existing customer -
//                        because telling them apart would let anybody find out
//                        who uses us. So this counts SUBMISSIONS, not confirmed
//                        new leads, and cannot be made conditional without
//                        reopening that hole in the page source.
//
//   /account/login       the first arrival at /account/book after a NEW number.
//                        It is NOT /account/login/code, which it briefly was:
//                        only an existing customer is ever sent a code, so that
//                        page counted returning customers and missed every new
//                        lead. Found by submitting a new number for real. This
//                        form already sends new and existing numbers to
//                        different pages, so counting only new ones reveals
//                        nothing it does not already. See LEAD_COOKIE in
//                        src/routes/account.js.
//
// Set the conversion to count once per click in Google Ads, so a refresh on
// /start/sent does not count twice.
//
// NO PHONE NUMBER IS SENT. The addresses these pages carry are checked:
// /account/login/code carries only ?next=/account. Enhanced conversions, which
// would send a hashed phone or email, are deliberately not used.
// ---------------------------------------------------------------------------
function googleTag({ conversionId = null, stripQuery = false, ads = config.googleAds } = {}) {
  // `ads` defaults to config and is a parameter only so the tests can exercise
  // the on, off and malformed cases without restarting the process.
  if (!ads || !ads.enabled || !ads.id) return '';

  // An id reaches the page source verbatim, so refuse anything that is not
  // shaped like one rather than trusting an environment variable into a script.
  if (!/^AW-\d+$/.test(ads.id)) return '';

  const label = /^[A-Za-z0-9_-]+$/.test(ads.leadLabel || '') ? ads.leadLabel : '';
  const sendTo = label ? `${ads.id}/${label}` : '';
  const value = Number.isFinite(Number(ads.leadValue)) ? Number(ads.leadValue) : 1;
  const currency = /^[A-Z]{3}$/.test(ads.currency || '') ? ads.currency : 'USD';

  // A LEAD, FIRED ONCE, WITH ITS OWN ID AS THE TRANSACTION. Only on the page a
  // real save leads to - see src/core/ad-attribution.js for how that page is
  // told. The id is a customer or order UUID; anything else is dropped rather
  // than written into a script.
  const txn = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(conversionId || '')
  )
    ? conversionId
    : '';

  const fire =
    txn && sendTo
      ? `\n  gtag('event', 'conversion', {send_to: '${sendTo}', value: ${value}, currency: '${currency}', transaction_id: '${txn}'});`
      : '';

  // A TAP ON A TEXT OR CALL LINK COUNTS AS A LEAD TOO, Neil's brief. Somebody
  // who taps "text us" off an advert has done the same thing as filling in a
  // form, just faster. It sends the same conversion, with no transaction id -
  // there is no record yet to name - plus sms_click or call_click, so the two
  // can be told apart in reports from each other and from the forms.
  //
  // DELEGATED, so it catches every link however it was built: the footer, the
  // town pages, /bergen, anything added later. NEVER preventDefault - the link
  // does exactly what it did before, and this only watches it go. sms: and tel:
  // open another app rather than leaving the page, so the request completes.
  //
  // Google counts a tap as one conversion per ad click (the conversion is set
  // to count once), so a nervous double tap is not two leads.
  const taps = sendTo
    ? `
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="sms:"], a[href^="tel:"]') : null;
    if (!a) return;
    gtag('event', a.getAttribute('href').indexOf('sms:') === 0 ? 'sms_click' : 'call_click');
    gtag('event', 'conversion', {send_to: '${sendTo}', value: ${value}, currency: '${currency}'});
  });`
    : '';

  // WHAT THE TAG IS ALLOWED TO REPORT ABOUT WHERE THE VISITOR IS AND WAS.
  //
  // Google's snippet reports the page's full address and the previous page's
  // full address. Keeping the tag off token pages was not enough, and both
  // leaks were found by loading real pages rather than by reading the code:
  //
  //   1. A signed-out customer opening /account/booked/<token> is redirected to
  //      /account/login?next=/account/booked/<token> - a TAGGED page with the
  //      token in its query string. So `next` is removed before reporting.
  //
  //   2. Referrer-Policy is strict-origin-when-cross-origin, which sends the
  //      FULL address on a same-site click. A signed-in customer on a token page
  //      who clicks Pricing in the nav arrives with the token in
  //      document.referrer. So the previous page is reported as its origin only.
  //
  // ONLY `next` COMES OUT OF THE ADDRESS, NOT THE WHOLE QUERY STRING. Google's
  // ad-click id (gclid) and the utm tags ride in the query string of the page
  // an ad lands on, and they are what lets a conversion be credited to the ad
  // at all. Stripping everything would make every lead unattributable, which is
  // a failure nobody would see: the tag would load and report nothing useful.
  //
  // Wrapped so a malformed address can never stop the tag loading.
  return `<!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${ads.id}"></script>
  <script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  var lyPage = {};
  try {
    var lyHere = new URL(location.href);
    ${
      // THE WHOLE QUERY STRING, on a page whose query string carries answers.
      // /account/book reads the order wizard's answers out of its URL - name,
      // street address, zip - so anything short of dropping all of it would
      // report a customer's home address to Google. No ad-click id is lost:
      // ads land on marketing pages, where gclid is stored before anybody
      // reaches the wizard.
      stripQuery ? "lyHere.search = '';" : "lyHere.searchParams.delete('next');"
    }
    lyPage.page_location = lyHere.toString();
    lyPage.page_referrer = document.referrer ? new URL(document.referrer).origin + '/' : '';
  } catch (e) {}
  gtag('config', '${ads.id}', lyPage);${fire}${taps}
  </script>`;
}

module.exports = {
  ICON_LINKS, renderPage, fillTokens, icon, logo, avatar, escapeHtml, CSS_BASE, googleTag };
