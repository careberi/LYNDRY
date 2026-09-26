'use strict';

const { escapeHtml, CSS_BASE, logo, ICON_LINKS } = require('./layout');
const { site } = require('./site');
const { config } = require('../config');

// ---------------------------------------------------------------------------
// THE SHELL EVERY STAFF-FACING SCREEN RENDERS THROUGH.
//
// It was `adminPage()` inside `src/routes/admin.js` and private to it. Neil, 25
// September: "the style of the laundromat back end should be the exact same
// style as the /ops backend". Two ways to do that - copy the shell into the
// portal, or have one shell. A copy is two chromes that drift the first time
// either is touched, which is the rule this codebase follows everywhere else.
//
// IT MAY NEVER IMPORT `roles.js` OR `db.js`, AND THAT CONSTRAINT IS THE DESIGN.
//
// `opsNav()` takes a USER and works the menu out from their permissions. Handed
// null it does not render nothing - `roles.roleOf(null)` falls back to DRIVER,
// which holds orders.view, orders.act and orders.drive. So a laundromat portal
// calling the old shell with `user: null` would have rendered a working
// internal nav: Your route, Orders, Routing, Bag tags. An attendant would have
// seen five LYNDRY screens, tapped one, and landed on our sign-in page.
//
// THE FAILURE MODE OF A MISSING USER IS A PERMISSIVE NAV, NOT AN EMPTY ONE.
// Which is why `nav` here is a STRING of already-rendered HTML. A shell that
// cannot see a user cannot derive a menu from one, and the trap is unreachable
// rather than remembered.
//
// WHAT STAYED IN admin.js: `OPS_MENUS` and `opsNav()`, because they know about
// roles and about /ops paths, and `adminPage()` as a thin wrapper so all of its
// call sites are untouched and produce byte-identical HTML.
// ---------------------------------------------------------------------------

// The red strip that says which database you are looking at.
//
// INLINE HEX RATHER THAN TOKENS, deliberately: it has to render before any
// stylesheet has loaded, because the thing it is warning about is somebody
// acting on the wrong data in the first second of a page.
function devBand() {
  if (config.supabase.isProduction) return '';

  return `<div role="status" style="background:#E8412F;color:#FFFDF7;font:700 12px/1.4 ui-monospace,monospace;
    letter-spacing:.06em;text-transform:uppercase;text-align:center;padding:7px 16px;border-bottom:2px solid #101210;">
    Development &middot; ${escapeHtml(config.supabase.projectRef)} &middot; these are not real orders
  </div>`;
}

// A banner. One implementation, because `test/ops-notices.test.js` refuses an
// inline-styled note anywhere in the ops screens and the portal is now held to
// the same rule.
function opsNote({
  tone = 'info',
  label = null,
  title = null,
  body = '',
  go = null,
  href = null,
  role = null,
} = {}) {
  const tones = { bad: ' ops-note--bad', warn: ' ops-note--warn', good: ' ops-note--good', info: '' };
  const cls = `ops-note${tones[tone] || ''}`;

  const inner =
    (label ? `<span class="ops-note__label">${escapeHtml(label)}</span>` : '') +
    (title ? `<span class="ops-note__title">${title}</span>` : '') +
    (body ? `<p class="ops-note__body">${body}</p>` : '');

  // A banner that is a link puts where it goes on the right, so the whole
  // panel is the target and the words still say what tapping it does.
  const content = go
    ? `<div class="ops-note__row"><div>${inner}</div><span class="ops-note__go">${escapeHtml(go)}</span></div>`
    : inner;

  const attrs = `class="${cls}"${role ? ` role="${role}"` : ''}`;

  return href
    ? `<a href="${escapeHtml(href)}" ${attrs}>${content}</a>`
    : `<div ${attrs}>${content}</div>`;
}

// ---------------------------------------------------------------------------

function opsShell({
  title,
  // What follows the em dash in the browser tab. 'ops' for the internal
  // screens, the laundromat's own name for the portal - because the tab is read
  // by somebody who has several open and needs to know whose screen this is.
  titleSuffix = 'ops',

  // The ops screens are English only. The portal is bilingual, and this was
  // hardcoded `en` in the old shell with no way to pass anything else.
  lang = 'en',

  body,
  head = '',

  // THE BAR
  //
  // A WORD, NOT THE ARTWORK. CLAUDE.md records that the compact logo at 38px is
  // the smallest the wordmark stays readable at; the bar is 40px tall, so the
  // mark would have to go below its own documented floor and LYNDRY becomes a
  // smear. The artwork is untouched on the public site, the bag tag page and
  // the driver's bare route screen.
  mark = { text: 'LYNDRY OPS', href: '/ops', label: 'LYNDRY ops' },

  // ALREADY-RENDERED HTML, NEVER A USER. See the note at the top of this file.
  nav = '',

  // Whatever sits to the right of the nav - the signed-in person's name and
  // role on ops, a language toggle on the portal.
  aside = '',

  // `{ action, label }`, or null for no button at all. The old shell rendered
  // Sign out unconditionally even with no user, and posted a hardcoded
  // /ops/logout.
  signOut = null,

  // Scoped to the section it belongs to. Sharing /ops/app.webmanifest would
  // give a laundromat's tablet a home-screen app scoped to /ops that opens on
  // the driver's route and bounces to a sign-in they can never pass.
  manifest = null,

  // ALREADY-RENDERED `opsNote()` strings, in the order they should appear. The
  // old shell built two specific banners itself - unresolved issues and the
  // closed sign - which are LYNDRY's internal state and have no business on a
  // laundromat's screen.
  notes = [],

  // Outside `<main>`. The ops screens have none; the portal needs one for the
  // processing link and the number to ring.
  footer = '',

  bare = false,
  terminal = false,
  touch = false,
} = {}) {
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${config.supabase.isProduction ? '' : '[DEV] '}${escapeHtml(title)} — ${escapeHtml(titleSuffix)}</title>
  <!-- Internal, and full of customer addresses. Never index it. -->
  <meta name="robots" content="noindex, nofollow">

  <!-- ADDED TO THE HOME SCREEN, THIS IS THE APP. Neil runs the ops site as a
       home-screen bookmark and said it does not feel like one - and it did not,
       because nothing here ever told the phone it was an app. Every tap ran
       inside full Safari with its chrome and its reload spinner.

       standalone drops the browser furniture. black-translucent puts the page
       under the status bar so the top of the screen is ours. The theme colour
       is the ops bar's ink, so the status bar matches it instead of flashing
       white on every navigation. -->
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="${escapeHtml(site.name)}">
  <meta name="theme-color" content="#101210">${
    manifest ? `\n  <link rel="manifest" href="${escapeHtml(manifest)}">` : ''
  }
  <!-- The same icons as the public site, from the same list. -->
  ${ICON_LINKS}
  <meta name="theme-color" content="#101210">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Grandstander:wght@900&display=swap">
  <link rel="stylesheet" href="${CSS_BASE}/ds/styles.css">
  <link rel="stylesheet" href="${CSS_BASE}/icons.css">
  <link rel="stylesheet" href="${CSS_BASE}/lyndry.css">
  <!-- THE OPS SKIN, LAST, SO IT WINS. Every screen rendered through this shell
       gets it - which is the point: they inherit the bar and the ground before
       their bodies are touched.

       NEVER ADD IT TO THE PUBLIC LAYOUT. It names the body element, so it would
       repaint the marketing site - and the bag tag page at /o/<code>, which a
       laundromat scans and which is deliberately the public look. -->
  <link rel="stylesheet" href="${CSS_BASE}/ops.css">
${head}
</head>
<body${terminal ? ` class="ops-terminal${touch ? ' ops-touch' : ''}"` : ''}>
  ${devBand()}
  ${
    // A BARE PAGE IS JUST THE MARK. Neil's call for the driver's route: it
    // should look like the bag tag page - the logo and nothing else.
    //
    // The reason is what that screen is for. It shows ONE stop and ONE thing to
    // do, and a nav offering nine other places to be is an invitation to read
    // ahead - which is the thing that screen was built not to allow.
    bare
      ? `<div class="container" style="padding-top:22px;text-align:center;">
           ${logo('compact', { href: mark.href, label: mark.label })}
         </div>`
      : `<header class="site-header">
    <div class="container site-header-bar ops-bar">
      <a class="ops-mark" href="${escapeHtml(mark.href)}" aria-label="${escapeHtml(mark.label)}">${escapeHtml(
          mark.text
        )}</a>
      <!-- Only the tabs this person may actually open. -->
      <nav class="site-nav">
        ${nav}
      </nav>
      ${
        signOut
          ? `<form method="post" action="${escapeHtml(
              signOut.action
            )}" style="margin:0;display:flex;align-items:center;gap:12px;">
        ${aside}
        <button type="submit" class="btn btn-outline btn-sm">${escapeHtml(signOut.label || 'Sign out')}</button>
      </form>`
          : aside
            ? `<div style="margin:0;display:flex;align-items:center;gap:12px;">${aside}</div>`
            : ''
      }
    </div>
  </header>`
  }

  <!-- Less air above the content on a bare page: the logo is already sitting
       in its own padding. -->
  <main class="container" style="padding-top:${bare ? '18px' : '36px'};padding-bottom:96px;">
${notes.filter(Boolean).join('\n')}
${body}
  </main>${footer ? `\n  ${footer}` : ''}
  <script>
  // One menu open at a time.
  //
  // <details> has no idea its siblings exist, so opening a second panel leaves
  // the first one hanging underneath it. Closing the others is the one thing
  // the markup cannot do by itself.
  //
  // ENHANCEMENT ONLY. Without this the menus still open, still close, and still
  // navigate; they just overlap.
  (function () {
    var menus = [].slice.call(document.querySelectorAll('.ops-menu'));
    if (!menus.length) return;

    function closeAll(except) {
      menus.forEach(function (m) { if (m !== except) m.open = false; });
    }

    menus.forEach(function (menu) {
      menu.addEventListener('toggle', function () {
        if (menu.open) closeAll(menu);
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.ops-menu')) closeAll(null);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll(null);
    });
  })();
  </script>
</body>
</html>`;
}

module.exports = {
  opsShell,
  devBand,
  opsNote,
};
