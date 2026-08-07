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

// Sticky chrome on the cream ground, per the handoff: teal wordmark in Figtree
// 900, ghost pill links that fill with the palest teal on hover, and one solid
// pill for the action we actually want.
function navBar(currentPath) {
  const links = NAV_LINKS.map(({ href, label }) => {
    const active = href === currentPath;
    const base =
      'rounded-full px-3.5 py-2 text-[15px] font-semibold transition-colors hover:bg-brand-100 hover:text-brand-800';
    const classes = active ? `${base} bg-brand-100 text-brand-800` : `${base} text-neutral-800`;
    return `<a href="${href}" class="${classes}">${label}</a>`;
  }).join('\n            ');

  const mobileLinks = NAV_LINKS.map(
    ({ href, label }) =>
      `<a href="${href}" class="block px-4 py-3 text-neutral-800 hover:bg-brand-100">${label}</a>`
  ).join('\n            ');

  return `
    <header class="sticky top-0 z-40 border-b border-ink/[0.16] bg-paper/[0.92] backdrop-blur-[10px]">
      <nav class="mx-auto flex max-w-[1180px] items-center gap-7 px-5 py-3.5 sm:px-8">
        <!-- Set in the body face at its heaviest, tightly tracked — the handoff
             does not use the display face for the wordmark. -->
        <a href="/" class="text-[26px] font-black tracking-[-0.04em] text-brand-700">
          ${site.name}
        </a>

        <div class="ml-auto hidden items-center gap-1.5 sm:flex">
            ${links}
          <a href="/signup"
             class="ml-2.5 rounded-full bg-brand-500 px-5 py-2.5 text-[15px] font-extrabold text-white transition-colors hover:bg-brand-600">
            Get started
          </a>
        </div>

        <!-- Mobile menu. Uses the browser's own show/hide, so no JavaScript. -->
        <details class="relative ml-auto sm:hidden">
          <summary class="cursor-pointer list-none rounded-full border-2 border-brand-500 px-4 py-2 text-sm font-extrabold text-brand-800">
            Menu
          </summary>
          <div class="absolute right-0 mt-2 w-52 overflow-hidden rounded-2xl border border-ink/[0.16] bg-neutral-100 shadow-lg">
            ${mobileLinks}
            <a href="/signup" class="block bg-brand-500 px-4 py-3 font-extrabold text-white">Get started</a>
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
           <span class="h-2 w-2 shrink-0 rounded-full bg-brand-300" aria-hidden="true"></span>
         </span>`
    )
    .join('');

  return `
    <div class="marquee bg-brand-500 py-4" aria-hidden="true">
      <div class="marquee__track">${run}${run}</div>
    </div>`;
}

// Deep teal footer, per the handoff: brand-900 ground, brand-200 text.
function footer() {
  const year = new Date().getFullYear();

  const link = (href, label) =>
    `<a href="${href}" class="text-[16px] text-brand-200 transition-colors hover:text-white">${label}</a>`;

  return `
    <footer class="bg-brand-900 text-brand-200">
      <div class="mx-auto grid max-w-[1180px] gap-10 px-5 pb-11 pt-16 sm:grid-cols-[1.4fr_1fr_1fr] sm:px-8">

        <div>
          <div class="text-[30px] font-black tracking-[-0.04em] text-white">${site.name}</div>
          <p class="mt-3.5 max-w-[30ch] text-[17px] leading-relaxed">
            Laundry that runs on text messages. Picked up from your door,
            back within ${site.turnaround}.
          </p>
          <p class="mt-3 text-[16px] text-brand-300">Serving ${site.serviceArea}.</p>
        </div>

        <div class="flex flex-col items-start gap-2.5">
          ${link('/how-it-works', 'How it works')}
          ${link('/pricing', 'Pricing')}
          ${link('/signup', 'Sign up')}
          ${link('/contact', 'Contact')}
        </div>

        <div class="flex flex-col items-start gap-2.5">
          ${link('/privacy', 'Privacy policy')}
          ${link('/terms', 'Terms of service')}
          ${link('/sms-terms', 'Messaging terms')}
          ${site.hasPublicPhone ? `<span class="text-[16px]">Text ${site.publicPhoneDisplay}</span>` : ''}
        </div>

      </div>

      <div class="mx-auto max-w-[1180px] px-5 pb-10 text-[14px] text-brand-400 sm:px-8">
        <!-- Naming the operating company here is not decoration. During carrier
             review for business texting, someone opens this page and checks
             that the company on the registration appears on the site. If it
             doesn't, the campaign is rejected. -->
        <p>${site.name} is a service of ${site.legalName}, ${site.businessAddress}.</p>
        <p class="mt-2">
          &copy; ${year} ${site.legalName}. Message and data rates may apply. Reply STOP to end.
        </p>
        <p class="mt-2">We never sell or share your phone number with third parties for marketing.</p>
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
  <!-- Caprasimo for headings, Figtree for everything you read. Both from the
       LYNDRY design system handoff. Caprasimo ships at weight 400 only —
       never apply a bold class to a heading, or the browser fakes it. -->
  <link href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;500;600;800;900&display=swap" rel="stylesheet">

  <!-- Tailwind straight from a CDN, with the typography plugin for the long
       text on the legal pages. Nothing to build, nothing to compile. -->
  <script src="https://cdn.tailwindcss.com?plugins=typography"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Figtree', 'system-ui', 'sans-serif'],
            display: ['Caprasimo', 'Figtree', 'system-ui', 'sans-serif'],
          },

          // The handoff's radii. Cards are 28px, panels 16px, controls pills.
          borderRadius: {
            md: '8px',
            lg: '16px',
            xl: '16px',
            '2xl': '28px',
            '3xl': '28px',
          },

          boxShadow: {
            sm: '0 1px 2px rgba(46,43,37,.14)',
            DEFAULT: '0 3px 10px rgba(46,43,37,.16)',
            md: '0 3px 10px rgba(46,43,37,.16)',
            lg: '0 12px 32px rgba(46,43,37,.22)',
          },
          colors: {
            // Straight from the LYNDRY design system handoff. Warm cream
            // ground, a deeper cream for panels, near-black ink for type.
            //
            // The names are kept from the earlier scheme on purpose — every
            // page already uses them, so the whole site re-skins by changing
            // the values here rather than editing nine HTML files.
            paper: '#f5ead8', // --color-bg
            paperdark: '#ebddc5', // --color-surface
            ink: '#201e1d', // --color-text
            // Teal — the brand accent. The handoff's ramp, unchanged.
            //
            // Contrast note from the handoff: teal on cream only clears 3:1.
            // Fine for large text, icons and chrome — NOT for paragraph copy.
            // Use brand-700 or darker for any accent-coloured body text.
            brand: {
              100: '#e8f7f8',
              200: '#c9eaed',
              300: '#9bd8dd',
              400: '#5cbcc4',
              500: '#17919b',
              600: '#0f7a84',
              700: '#0b606a',
              800: '#08454c',
              900: '#062e33',
            },

            // Sage — the second voice, used for the quote panel.
            sage: {
              100: '#f0fae1',
              200: '#e1eecc',
              300: '#ccdbb2',
              400: '#aebf92',
              600: '#728157',
              800: '#3d472b',
            },

            // The warm neutral ramp the handoff uses for secondary text.
            neutral: {
              100: '#f9f4ed',
              200: '#eee7db',
              300: '#dcd3c4',
              400: '#c0b6a5',
              500: '#a19786',
              600: '#82796a',
              700: '#645c50',
              800: '#474238',
              900: '#2e2b25',
            },
          },
        },
      },
    };
  </script>

  <style>
    /* Headings are Caprasimo, which ships at weight 400 only. Forcing 400 here
       stops the browser synthesising a fake bold if a weight class slips onto
       a heading — faux-bold on a display face looks smeared. */
    h1, h2, h3, h4 {
      font-family: 'Caprasimo', Figtree, system-ui, sans-serif;
      font-weight: 400;
      letter-spacing: -0.015em;
    }
    /* Long-form legal pages: keep the body text comfortable to read. */
    .prose :where(p, li) { font-family: Figtree, system-ui, sans-serif; }

    /* The handoff replaces the browser's default focus ring everywhere. */
    :focus { outline: none; }
    :focus-visible { outline: 2px solid #17919b; outline-offset: 2px; }
    ::selection { background: #c9eaed; }

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
