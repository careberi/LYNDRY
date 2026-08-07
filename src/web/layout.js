'use strict';

const { site, tokens } = require('./site');

// ---------------------------------------------------------------------------
// The page layout.
//
// Every page on the site is the same wrapper — head, navigation bar, footer —
// with a different middle. That wrapper lives here, once, so a change to the
// navigation or the footer happens in a single place instead of eight.
//
// Tailwind is loaded from a CDN, which means there is nothing to build or
// compile. Editing a page is: save the file, refresh the browser.
// ---------------------------------------------------------------------------

const NAV_LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
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

// The navigation bar sits on brand teal, so everything inside it is white or
// near-white. A teal chip or navy link would disappear against it.
function navBar(currentPath) {
  const links = NAV_LINKS.map(({ href, label }) => {
    const active = href === currentPath;
    const classes = active
      ? 'font-semibold text-white'
      : 'text-white/80 transition-colors hover:text-white';
    return `<a href="${href}" class="${classes}">${label}</a>`;
  }).join('\n            ');

  const mobileLinks = NAV_LINKS.map(
    ({ href, label }) =>
      `<a href="${href}" class="block px-4 py-3 text-ink/80 hover:bg-paperdark">${label}</a>`
  ).join('\n            ');

  return `
    <header class="sticky top-0 z-40 border-b border-brand-700/40 bg-brand-600/95 backdrop-blur">
      <nav class="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <!-- White on teal, the same treatment as the side of the locker. -->
        <a href="/" class="text-xl font-bold uppercase tracking-tight text-white">
          ${site.name}
        </a>

        <div class="hidden items-center gap-8 text-sm sm:flex">
            ${links}
          <!-- Inverted: white button on the teal bar, so the one thing we want
               people to click is the highest-contrast element up here. -->
          <a href="/signup"
             class="rounded-full bg-white px-5 py-2 font-semibold text-brand-700 transition-colors hover:bg-sky-100">
            Get started
          </a>
        </div>

        <!-- Mobile menu. Uses the browser's own show/hide, so no JavaScript.
             The panel itself stays white with navy text — a teal dropdown on a
             teal bar would have no edge. -->
        <details class="relative sm:hidden">
          <summary class="cursor-pointer list-none rounded-full border border-white/50 px-4 py-2 text-sm font-medium text-white">
            Menu
          </summary>
          <div class="absolute right-0 mt-2 w-52 overflow-hidden rounded-xl border border-ink/10 bg-white shadow-lg">
            ${mobileLinks}
            <a href="/signup" class="block bg-brand-600 px-4 py-3 font-medium text-white">Get started</a>
          </div>
        </details>
      </nav>
    </header>`;
}

// The repeating band: the same line that's printed on the bags, scrolling.
//
// The list is rendered twice because the animation slides the track by
// exactly half its width — with one copy the loop would jump.
function marqueeBand() {
  const words = ['Wash', 'Fold', 'Deliver'];
  const run = Array.from({ length: 6 }, () => words)
    .flat()
    .map(
      (word) =>
        `<span class="flex items-center gap-6 px-6">
           <span class="text-xl font-bold uppercase tracking-[0.2em] text-white sm:text-2xl">${word}</span>
           <span class="h-2 w-2 shrink-0 rounded-full bg-sky-300" aria-hidden="true"></span>
         </span>`
    )
    .join('');

  return `
    <div class="marquee bg-brand-600 py-4" aria-hidden="true">
      <div class="marquee__track">${run}${run}</div>
    </div>`;
}

function footer() {
  const year = new Date().getFullYear();

  return `
    <footer class="mt-24 border-t border-ink/10 bg-paperdark">
      <div class="mx-auto max-w-6xl px-5 py-14">
        <div class="grid gap-10 sm:grid-cols-3">

          <div>
            <div class="text-lg font-semibold tracking-tight text-ink">${site.name}</div>
            <p class="mt-3 text-sm leading-relaxed text-ink/70">
              Wash, dry and fold, picked up from your door and back within ${site.turnaround}.
            </p>
            <p class="mt-3 text-sm text-ink/70">Serving ${site.serviceArea}.</p>
          </div>

          <div>
            <div class="text-sm font-semibold text-ink">Service</div>
            <ul class="mt-3 space-y-2 text-sm text-ink/70">
              <li><a href="/how-it-works" class="hover:text-brand-700">How it works</a></li>
              <li><a href="/pricing" class="hover:text-brand-700">Pricing</a></li>
              <li><a href="/signup" class="hover:text-brand-700">Sign up</a></li>
              <li><a href="/contact" class="hover:text-brand-700">Contact</a></li>
            </ul>
          </div>

          <div>
            <div class="text-sm font-semibold text-ink">Legal</div>
            <ul class="mt-3 space-y-2 text-sm text-ink/70">
              <li><a href="/privacy" class="hover:text-brand-700">Privacy policy</a></li>
              <li><a href="/terms" class="hover:text-brand-700">Terms of service</a></li>
              <li><a href="/sms-terms" class="hover:text-brand-700">Messaging terms</a></li>
            </ul>
          </div>

        </div>

        <div class="mt-12 border-t border-ink/10 pt-6 text-sm text-ink/55">
          <!-- Naming the operating company here is not decoration. During
               carrier review for business texting, someone opens this page and
               checks that the company on the registration appears on the site.
               If it doesn't, the campaign is rejected. -->
          <p>
            ${site.name} is a service of ${site.legalName},
            ${site.businessAddress}.
          </p>
          <p class="mt-2">&copy; ${year} ${site.legalName}. All rights reserved.</p>
          <p class="mt-2">
            We never sell or share your phone number with third parties for marketing.
          </p>
        </div>
      </div>
    </footer>`;
}

// ---------------------------------------------------------------------------

function renderPage({ title, description, path, body, extra = {} }) {
  const fullTitle = path === '/' ? `${site.name} — ${site.tagline}` : `${title} — ${site.name}`;

  const html = `<!doctype html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fullTitle}</title>
  <meta name="description" content="${description}">

  <meta property="og:title" content="${fullTitle}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">

  <!-- Favicon drawn inline so there is no image file to manage. -->
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23178a94'/%3E%3Ctext x='16' y='23' font-family='sans-serif' font-size='19' font-weight='700' fill='white' text-anchor='middle'%3EL%3C/text%3E%3C/svg%3E">
  <meta name="theme-color" content="#178a94">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <!-- Two typefaces, following telnyx.com's pairing: a bold geometric face for
       display, Inter for everything you actually read.

       Telnyx uses PP Formula, which is a commercial licence. Outfit is the
       closest free equivalent — same wide geometric bones. If the exact
       Telnyx face is ever licensed, swap the name here and in the Tailwind
       config below and the whole site follows. -->
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">

  <!-- Tailwind straight from a CDN, with the typography plugin for the long
       text on the legal pages. Nothing to build, nothing to compile. -->
  <script src="https://cdn.tailwindcss.com?plugins=typography"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
            display: ['Outfit', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
          },
          colors: {
            // The palette comes from the LYNDRY bags: teal, white, deep navy
            // and a light blue that blends into the teal.
            //
            // The names are kept from the earlier scheme on purpose — every
            // page already uses them, so the whole site re-skins by changing
            // the values here rather than editing nine HTML files.
            paper: '#ffffff', // clean white, the default page
            paperdark: '#eaf6f9', // light blue tint, for alternating sections
            ink: '#10314f', // deep navy: all body text and dark panels
            // Teal — the primary brand colour, from the lockers. brand-600 is
            // the anchor; everything else is a lighter or darker version.
            brand: {
              50:  '#effbfc',
              100: '#d3f4f7',
              200: '#a7e8ee',
              300: '#6ed6e0',
              400: '#33bccb',
              500: '#189daf',
              600: '#178a94',
              700: '#16717a',
              800: '#175c65',
              900: '#174d55',
              950: '#083339',
            },

            // Deep navy — the supporting contrast colour, taken from the
            // lettering on the bags.
            navy: {
              50:  '#f2f6fa',
              100: '#e2ebf3',
              200: '#c0d5e8',
              300: '#8fb4d5',
              400: '#578dbd',
              500: '#356fa3',
              600: '#265888',
              700: '#20476e',
              800: '#1c3d5c',
              900: '#10314f',
              950: '#0a2038',
            },

            // Light blue — the secondary accent, sitting between the teal and
            // the navy so the two never clash.
            sky: {
              50:  '#f0f8fe',
              100: '#ddeffc',
              200: '#c3e4fa',
              300: '#94d2f5',
              400: '#5fb9ec',
              500: '#399cdd',
              600: '#247ec0',
            },
          },
        },
      },
    };
  </script>

  <style>
    /* Every heading uses the display face. Doing it here means pages don't
       have to repeat a font class on every single heading. */
    h1, h2, h3, h4 {
      font-family: 'Outfit', Inter, ui-sans-serif, system-ui, sans-serif;
      letter-spacing: -0.025em;
    }
    /* Long-form legal pages: keep the body text comfortable to read. */
    .prose :where(p, li) { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }

    /* ---- The repeating band -------------------------------------------
       WASH · FOLD · DELIVER, the line printed on the bags, scrolling
       forever. The track holds the same list twice and slides exactly half
       its width, so the loop has no visible seam. */
    .marquee { overflow: hidden; }
    .marquee__track {
      display: flex;
      width: max-content;
      animation: marquee 38s linear infinite;
    }
    .marquee:hover .marquee__track { animation-play-state: paused; }
    @keyframes marquee { to { transform: translateX(-50%); } }

    /* ---- Reveal on scroll ----------------------------------------------
       Sections fade up as they come into view. The hiding is applied only
       once JavaScript has confirmed it can un-hide them again — without
       that, a failed script would leave a blank page. */
    .js-anim .reveal {
      opacity: 0;
      transform: translateY(18px);
      transition: opacity .7s ease, transform .7s ease;
    }
    .js-anim .reveal.is-visible { opacity: 1; transform: none; }

    /* Anyone whose device asks for less motion gets none of it. */
    @media (prefers-reduced-motion: reduce) {
      .marquee__track { animation: none; }
      .js-anim .reveal { opacity: 1; transform: none; transition: none; }
      html { scroll-behavior: auto; }
    }
  </style>
</head>
<body class="min-h-screen bg-paper font-sans text-ink antialiased">
${navBar(path)}
<main>
${body}
</main>
${footer()}

<script>
  // Reveal sections as they scroll into view.
  //
  // The hiding class goes on only now, from JavaScript, so a browser that
  // never runs this — or a script that fails to load — shows the whole page
  // normally instead of a blank one.
  (function () {
    if (!('IntersectionObserver' in window)) return;

    document.documentElement.classList.add('js-anim');

    var watcher = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        watcher.unobserve(entry.target); // reveal once, then stop watching
      });
    }, { rootMargin: '0px 0px -10% 0px' });

    document.querySelectorAll('.reveal').forEach(function (el) { watcher.observe(el); });
  })();
</script>
</body>
</html>`;

  // MARQUEE is offered to every page so the repeating band can be dropped in
  // wherever it suits, without a page having to know how it is built.
  return fillTokens(html, { MARQUEE: marqueeBand(), ...extra });
}

module.exports = { renderPage, fillTokens };
