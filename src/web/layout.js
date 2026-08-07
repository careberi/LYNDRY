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
      ? 'text-brand-900 font-medium'
      : 'text-slate-600 hover:text-brand-900 transition-colors';
    return `<a href="${href}" class="${classes}">${label}</a>`;
  }).join('\n            ');

  const mobileLinks = NAV_LINKS.map(
    ({ href, label }) =>
      `<a href="${href}" class="block px-4 py-3 text-slate-700 hover:bg-slate-50">${label}</a>`
  ).join('\n            ');

  return `
    <header class="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
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
          <summary class="cursor-pointer list-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
            Menu
          </summary>
          <div class="absolute right-0 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
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
    <footer class="mt-24 border-t border-slate-200 bg-slate-50">
      <div class="mx-auto max-w-6xl px-5 py-14">
        <div class="grid gap-10 sm:grid-cols-3">

          <div>
            <div class="text-lg font-semibold tracking-tight text-brand-900">${site.name}</div>
            <p class="mt-3 text-sm leading-relaxed text-slate-600">
              Wash, dry and fold, picked up from your door and back within ${site.turnaround}.
            </p>
            <p class="mt-3 text-sm text-slate-600">Serving ${site.serviceArea}.</p>
          </div>

          <div>
            <div class="text-sm font-semibold text-brand-900">Service</div>
            <ul class="mt-3 space-y-2 text-sm text-slate-600">
              <li><a href="/how-it-works" class="hover:text-brand-900">How it works</a></li>
              <li><a href="/pricing" class="hover:text-brand-900">Pricing</a></li>
              <li><a href="/signup" class="hover:text-brand-900">Sign up</a></li>
              <li><a href="/contact" class="hover:text-brand-900">Contact</a></li>
            </ul>
          </div>

          <div>
            <div class="text-sm font-semibold text-brand-900">Legal</div>
            <ul class="mt-3 space-y-2 text-sm text-slate-600">
              <li><a href="/privacy" class="hover:text-brand-900">Privacy policy</a></li>
              <li><a href="/terms" class="hover:text-brand-900">Terms of service</a></li>
              <li><a href="/sms-terms" class="hover:text-brand-900">Messaging terms</a></li>
            </ul>
          </div>

        </div>

        <div class="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
          <p>&copy; ${year} ${site.legalName}. All rights reserved.</p>
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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

  <!-- Tailwind straight from a CDN, with the typography plugin for the long
       text on the legal pages. Nothing to build, nothing to compile. -->
  <script src="https://cdn.tailwindcss.com?plugins=typography"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
          },
          colors: {
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
</head>
<body class="min-h-screen bg-white font-sans text-slate-800 antialiased">
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
