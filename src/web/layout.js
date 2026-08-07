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

function navBar(currentPath) {
  const links = NAV_LINKS.map(({ href, label }) => {
    const active = href === currentPath;
    const classes = active
      ? 'text-ink font-medium'
      : 'text-ink/70 hover:text-brand-700 transition-colors';
    return `<a href="${href}" class="${classes}">${label}</a>`;
  }).join('\n            ');

  const mobileLinks = NAV_LINKS.map(
    ({ href, label }) =>
      `<a href="${href}" class="block px-4 py-3 text-ink/80 hover:bg-paperdark">${label}</a>`
  ).join('\n            ');

  return `
    <header class="sticky top-0 z-40 border-b border-ink/10 bg-paper/90 backdrop-blur">
      <nav class="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <!-- The wordmark matches the locker: white LYNDRY on brand teal. -->
        <a href="/" class="rounded-md bg-brand-600 px-2.5 py-1.5 text-lg font-bold uppercase tracking-tight text-white">
          ${site.name}
        </a>

        <div class="hidden items-center gap-8 text-sm sm:flex">
            ${links}
          <a href="/signup"
             class="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white transition-colors hover:bg-brand-700">
            Get started
          </a>
        </div>

        <!-- Mobile menu. Uses the browser's own show/hide, so no JavaScript. -->
        <details class="relative sm:hidden">
          <summary class="cursor-pointer list-none rounded-lg border border-ink/20 px-3 py-2 text-sm text-ink/80">
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
            // The page itself: warm off-white with near-black type, taken
            // from telnyx.com. Not pure white — the warmth is the point.
            paper: '#fefdf5',
            paperdark: '#eceadd',
            ink: '#0a0a0a',
            // Taken from the physical LYNDRY locker. brand-600 is the colour
            // of the locker doors and the sign; everything else is a lighter
            // or darker version of it, so the site and the hardware match.
            brand: {
              50:  '#f0fafb',
              100: '#d5f2f4',
              200: '#a9e4e9',
              300: '#71cdd6',
              400: '#39afbb',
              500: '#1d939f',
              600: '#178a94',
              700: '#15767f',
              800: '#146068',
              900: '#0f4249',
              950: '#092c31',
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
  </style>
</head>
<body class="min-h-screen bg-paper font-sans text-ink antialiased">
${navBar(path)}
<main>
${body}
</main>
${footer()}
</body>
</html>`;

  return fillTokens(html, extra);
}

module.exports = { renderPage, fillTokens };
