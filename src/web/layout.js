'use strict';

const { site, tokens } = require('./site');
const { CSS_BASE } = require('./assets');

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
// Booking happens in the text thread; putting "Schedule online" in the nav
// invites people to go and find a form instead, which is the opposite of the
// product. The page still works for anyone who has the link, exactly like
// /signup — unlinked rather than removed, so it stays available as a fallback
// if texting is ever down.
const NAV_LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/partners', label: 'Partners' },
  { href: '/contact', label: 'Contact' },
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
  const links = NAV_LINKS.map(({ href, label }) => {
    const current = href === currentPath ? ' aria-current="page"' : '';
    return `<a href="${href}"${current}>${label}</a>`;
  }).join('\n          ');

  const mobileLinks = NAV_LINKS.map(
    ({ href, label }) => `<a href="${href}">${label}</a>`
  ).join('\n            ');

  return `
    <header class="site-header">
      <div class="container site-header-bar">
        ${logo('nav')}

        <nav class="site-nav">
          ${links}
        </nav>

        <a href="/#get-started" class="btn btn-primary btn-sm">Get started</a>

        <!-- Mobile menu. Built on <details> so it needs no JavaScript. -->
        <details class="nav-toggle">
          <summary class="btn btn-primary btn-sm" aria-label="Menu">Menu</summary>
          <div class="nav-panel">
            ${mobileLinks}
            <a href="/#get-started">Get started</a>
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
            <a href="/#get-started">Get started</a>
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
        <p class="footer-legal">
          ${site.name} is a service of ${site.legalName}, ${site.businessAddress}<br>
          &copy; ${year} ${site.legalName} &middot; Message and data rates may apply. Reply STOP to end.<br>
          We never sell or share your phone number with third parties for marketing.
        </p>
      </div>
    </footer>`;
}

// ---------------------------------------------------------------------------

function renderPage({ title, description, path, body, extra = {}, noindex = false }) {
  const fullTitle = path === '/' ? `${site.name} — ${site.tagline}` : `${title} — ${site.name}`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fullTitle}</title>
  <meta name="description" content="${description}">

  <meta property="og:title" content="${fullTitle}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <!-- Signed-in pages carry someone's address and order history. They are
       behind a sign-in, but there is no reason for a crawler to try. -->
  ${noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}

  <!-- Favicon: the bag-and-bubble silhouette, drawn inline so there is no
       image file to manage.
       IT IS NOT THE FULL LOGO, and that is deliberate. The wordmark inside the
       bag is about a fifth of the mark's height, so at 32px it renders as an
       illegible smear and at 16px as a grey band. What survives at that size
       is the SHAPE, so the favicon is the shape with no type in it.
       The tail is drawn first and the body painted over it, so the body's
       outline closes across the top of the tail rather than showing through. -->
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M9 22 L9.6 30.6 L16 24' fill='%230EA47A' stroke='%23101210' stroke-width='2.3' stroke-linejoin='round'/%3E%3Crect x='2.3' y='10' width='27.4' height='16' rx='7' fill='%230EA47A' stroke='%23101210' stroke-width='2.3'/%3E%3Cpath d='M9.6 10.6 C10.4 5.6 12 3 16 2.2 C20 3 21.6 5.6 22.4 10.6 Z' fill='%230EA47A' stroke='%23101210' stroke-width='2.3' stroke-linejoin='round'/%3E%3Cpath d='M12.4 6.6 C14.2 8.6 17.8 8.6 19.6 6.6' fill='none' stroke='%23101210' stroke-width='2.1' stroke-linecap='round'/%3E%3C/svg%3E">
  <meta name="theme-color" content="#101210">

  <!-- The design system's font file @imports Google Fonts, and an @import
       inside a stylesheet does not start resolving until that stylesheet has
       loaded. Opening the connections early takes a round trip off it. -->
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
</head>
<body>
${navBar(path)}
<main>
${body}
</main>
${footer()}

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

module.exports = { renderPage, fillTokens, icon, logo, avatar, escapeHtml, CSS_BASE };
