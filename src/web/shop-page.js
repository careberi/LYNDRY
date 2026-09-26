'use strict';

const { escapeHtml, CSS_BASE, logo, icon, ICON_LINKS } = require('./layout');
const { site } = require('./site');
const { config } = require('../config');
const format = require('../core/format');
const { translator } = require('./laundromat-es');

// ---------------------------------------------------------------------------
// The laundromat portal's pages.
//
// Neil's ask, 25 September: "I need an interface as to where the laundromat
// attendant can log into and see the current orders at her store... they will
// also need to enter the weight into the order of all the bags and then go back
// into that order to tell uber to come get it."
//
// WHO IS HOLDING THIS: somebody on minimum wage, behind a counter, with a
// tablet, doing us a favour between customers. That is the whole design brief
// and every decision below comes out of it.
//
//   NO JAVASCRIPT, ANYWHERE. The same rule the driver's screens follow, for a
//   better reason: this is a borrowed device on somebody else's wifi. A page
//   either worked or it did not, rather than a spinner that lies.
//
//   ONE THING TO DO PER ORDER, and the card says which. An attendant is not
//   learning our state machine.
//
//   BIG CONTROLS. 56px, the same as the driver's, because it is the same
//   situation: standing up, hands full, in a hurry.
//
//   BILINGUAL, LIKE THE BAG PAGES UNDER IT. `/o/<code>` and `/processing`
//   already switch language, and a portal that did not would be an English
//   screen hanging off a Spanish one. Every visible string is an { en, es }
//   pair picked by `s()`.
//
// WHAT AN ATTENDANT MUST NEVER SEE, and it is enforced by what these functions
// are handed rather than by what they choose to render:
//
//   the customer's NAME, PHONE OR ADDRESS. They have no reason for any of it and
//   holding it is a liability we would be handing to somebody else's employee.
//   The order number identifies the work; that is the same argument
//   `/o/<code>` already makes for a bag tag
//
//   ANY MONEY. Not the price, not the per-pound rate, and above all not what we
//   pay THEM per pound, which is on the partner record two tables away. The ops
//   screens keep the wholesale rate behind `money.view` so a driver cannot
//   browse it; an attendant is further out than a driver
//
//   FREE TEXT THE CUSTOMER TYPED. The allowlist rule from the bag page, which
//   exists because a real saved preference reads "Deliver to 16-51 Chandler Dr"
//   and no regex catches "the Bergen Pediatrics name tags". Wash fields are
//   structured and go through; instructions never do.
// ---------------------------------------------------------------------------

// --- language ---------------------------------------------------------------
//
// Plain ASCII in the Spanish, matching the sixty ES entries in `bag.js` and the
// guide under it. Two conventions on one screen reads as a mistake.

const T = Object.freeze({
  portal: { en: 'Laundromat', es: 'Lavanderia' },
  signIn: { en: 'Sign in.', es: 'Iniciar sesion.' },
  signInIntro: {
    en: "Enter your mobile number and we'll text you a code.",
    es: 'Escriba su numero de movil y le enviaremos un codigo.',
  },
  mobile: { en: 'Mobile number', es: 'Numero de movil' },
  textMeACode: { en: 'Text me a code', es: 'Enviarme un codigo' },
  checkPhone: { en: 'Check your phone.', es: 'Revise su telefono.' },
  sixDigits: { en: 'Six-digit code', es: 'Codigo de seis digitos' },
  signInButton: { en: 'Sign in', es: 'Entrar' },
  sendAnother: { en: 'Send another code', es: 'Enviar otro codigo' },
  needsScript: {
    en: 'Signing in needs JavaScript switched on. Everything after that does not.',
    es: 'Para entrar hace falta JavaScript. Despues de eso no se necesita.',
  },

  today: { en: 'Your laundry today', es: 'Su ropa de hoy' },
  nothingHere: { en: 'Nothing here right now.', es: 'Nada por ahora.' },
  nothingHereMore: {
    en: 'When a courier brings us laundry, it will show up on this page.',
    es: 'Cuando un mensajero traiga ropa, aparecera en esta pagina.',
  },
  order: { en: 'Order', es: 'Pedido' },
  bags: { en: 'bags', es: 'bolsas' },
  oneBag: { en: 'bag', es: 'bolsa' },
  arrived: { en: 'Arrived', es: 'Llego' },
  dueBack: { en: 'Due back', es: 'Debe volver' },

  needsWeight: { en: 'Needs weighing', es: 'Falta pesar' },
  weighed: { en: 'Weighed', es: 'Pesado' },
  washing: { en: 'Being washed', es: 'Lavandose' },
  readyLabel: { en: 'Finished', es: 'Terminado' },

  open: { en: 'Open', es: 'Abrir' },
  back: { en: 'Back to the list', es: 'Volver a la lista' },
  signOut: { en: 'Sign out', es: 'Salir' },

  howToWash: { en: 'How to wash it', es: 'Como lavarla' },
  weightTitle: { en: 'What does it weigh?', es: 'Cuanto pesa?' },
  weightHelp: {
    en: 'The whole order on the scale, in pounds. One number for all the bags.',
    es: 'Todo el pedido en la balanza, en libras. Un solo numero para todas las bolsas.',
  },
  pounds: { en: 'Pounds', es: 'Libras' },
  saveWeight: { en: 'Save the weight', es: 'Guardar el peso' },
  weightSaved: { en: 'Weight saved. Thank you.', es: 'Peso guardado. Gracias.' },
  weightBad: {
    en: 'That weight does not look right. Pounds, as a number.',
    es: 'Ese peso no parece correcto. Libras, en numeros.',
  },
  weightEarly: {
    en: 'That order is not with you yet.',
    es: 'Ese pedido todavia no esta con usted.',
  },
  alreadyWeighed: { en: 'You weighed this at', es: 'Usted lo peso en' },

  processingLink: { en: 'Processing Instructions', es: 'Instrucciones de Procesamiento' },
  questions: { en: 'Any problem, ring us on', es: 'Cualquier problema, llamenos al' },

  signedOutElsewhere: {
    en: 'You signed in on another device, so this one was signed out.',
    es: 'Inicio sesion en otro dispositivo, asi que este se cerro.',
  },
  shopClosed: {
    en: 'This laundromat is not set up for pickups at the moment. Please ring us.',
    es: 'Esta lavanderia no esta activa por ahora. Por favor llamenos.',
  },
  signInAgain: { en: 'Please sign in again.', es: 'Por favor inicie sesion otra vez.' },
  badCode: {
    en: 'That code did not work. Check it, or send another.',
    es: 'Ese codigo no funciono. Revise, o pida otro.',
  },
  badPhone: {
    en: 'That does not look like a mobile number.',
    es: 'Eso no parece un numero de movil.',
  },
  tooMany: {
    en: 'Too many tries. Give it a few minutes.',
    es: 'Demasiados intentos. Espere unos minutos.',
  },
  tapToFinish: { en: 'Tap Sign in to finish', es: 'Toque Entrar para terminar' },
});

// Escaped text. The default is English, so a missing language falls back rather
// than rendering `undefined` into a page an attendant has to act on.
function s(key, lang) {
  const pair = T[key];
  if (!pair) return '';
  return escapeHtml(lang === 'es' && pair.es ? pair.es : pair.en);
}

// --- the shell --------------------------------------------------------------

// ONE SHELL, LIKE THE BAG PAGE'S. Every state - signed out, the list, one order,
// an error - renders through this, which is what makes the language toggle and
// the processing link true on all of them without a branch for any.
function shell({ lang, title, inner, shopName = null, showSignOut = false, here = '/shop' }) {
  const other = lang === 'es' ? 'en' : 'es';
  const toggleHref = `${here}${here.includes('?') ? '&' : '?'}lang=${other}`;

  return `<!doctype html>
<html lang="${lang === 'es' ? 'es' : 'en'}" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} | LYNDRY</title>
${ICON_LINKS}
<link rel="stylesheet" href="${CSS_BASE}/ds/styles.css">
<link rel="stylesheet" href="${CSS_BASE}/icons.css">
<link rel="stylesheet" href="${CSS_BASE}/lyndry.css">
</head>
<body>
  ${devBand()}
  <header class="container" style="padding-top:20px;padding-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
    <div style="display:flex;align-items:center;gap:14px;">
      ${logo('compact', { href: null })}
      <div>
        <p class="eyebrow" style="margin:0;">${s('portal', lang)}</p>
        ${shopName ? `<p style="margin:2px 0 0;font-size:15px;font-weight:700;color:var(--ink-900);">${escapeHtml(shopName)}</p>` : ''}
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      <a class="btn btn-ghost" href="${escapeHtml(toggleHref)}" hreflang="${other}">${other === 'es' ? 'Espanol' : 'English'}</a>
      ${
        showSignOut
          ? `<form method="post" action="/shop/logout" style="margin:0;">
               <button type="submit" class="btn btn-ghost">${s('signOut', lang)}</button>
             </form>`
          : ''
      }
    </div>
  </header>

  <main class="container" style="padding-bottom:56px;">
    ${inner}
  </main>

  <footer class="container" style="padding-bottom:40px;">
    <p style="font-size:14px;line-height:1.6;color:var(--ink-600);margin:0 0 6px;">
      <a href="/processing?lang=${lang === 'es' ? 'es' : 'en'}">${s('processingLink', lang)}</a>
    </p>
    <p style="font-size:14px;line-height:1.6;color:var(--ink-600);margin:0;">
      ${s('questions', lang)} <strong>${escapeHtml(site.opsPhoneDisplay)}</strong>
    </p>
  </footer>
</body>
</html>`;
}

// The same band the ops screens carry, so nobody weighs a real order on the
// development site by accident.
function devBand() {
  if (config.supabase.isProduction) return '';
  return `<div style="background:var(--sunbeam-500);border-bottom:2px solid var(--ink-900);padding:6px 16px;text-align:center;">
    <span style="font-family:var(--font-mono);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--ink-900);">
      Development - nothing here is real
    </span>
  </div>`;
}

// --- signing in -------------------------------------------------------------

function signInShell({ lang, heading, intro, error, form, here }) {
  return shell({
    lang,
    here,
    title: heading,
    inner: `
      <div style="max-width:440px;">
        <h1 class="display-4" style="margin:18px 0 10px;">${escapeHtml(heading)}</h1>
        <p style="font-size:17px;line-height:1.5;color:var(--ink-800);margin:0 0 24px;">${intro}</p>
        ${
          error
            ? `<div role="alert" class="card" style="border-color:var(--stain-500);padding:14px 16px;margin-bottom:20px;">
                 <p style="margin:0;font-size:16px;line-height:1.5;color:var(--ink-900);">${escapeHtml(error)}</p>
               </div>`
            : ''
        }
        ${form}
      </div>`,
  });
}

function phoneStep({ lang = 'en', error = '', phone = '', next = '/shop' } = {}) {
  return signInShell({
    lang,
    here: '/shop/login',
    heading: T.signIn[lang === 'es' ? 'es' : 'en'],
    intro: s('signInIntro', lang),
    error,
    form: `
      <form method="post" action="/shop/login" class="card card-xl" style="padding:24px;">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <input type="hidden" name="lang" value="${lang === 'es' ? 'es' : 'en'}">
        <div class="field">
          <label class="field-label" for="phone">${s('mobile', lang)}</label>
          <input class="input input-lg" type="tel" id="phone" name="phone" required
                 autocomplete="tel" inputmode="tel" placeholder="201-555-0142"
                 value="${escapeHtml(phone)}" autofocus>
        </div>
        <button type="submit" class="btn btn-ink btn-lg btn-full" style="margin-top:18px;">
          ${s('textMeACode', lang)} ${icon('arrow-right', '22')}
        </button>
      </form>`,
  });
}

function codeStep({ lang = 'en', error = '', phone = '', code = '', next = '/shop', ttlMinutes = 5, tapGate = '' } = {}) {
  const en = lang !== 'es';

  return signInShell({
    lang,
    here: '/shop/login/code',
    heading: T.checkPhone[en ? 'en' : 'es'],
    // ON ITS WAY, NOT ALREADY SENT. The text goes a few seconds after the number
    // is entered, so "we texted you a code" is a sentence the phone contradicts
    // for the first moment - which reads as broken and starts somebody tapping.
    intro: en
      ? `A six-digit code is on its way to <strong>${escapeHtml(format.displayPhone(phone))}</strong>. Give it a few seconds. It expires ${ttlMinutes} minutes after it lands.`
      : `Un codigo de seis digitos va en camino a <strong>${escapeHtml(format.displayPhone(phone))}</strong>. Espere unos segundos. Vence ${ttlMinutes} minutos despues de llegar.`,
    error,
    form: `
      <form method="post" action="/shop/login/code" class="card card-xl" style="padding:24px;">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <input type="hidden" name="phone" value="${escapeHtml(phone)}">
        <input type="hidden" name="lang" value="${en ? 'en' : 'es'}">
        <div class="field">
          <label class="field-label" for="code">${s('sixDigits', lang)}</label>
          <input class="input input-lg" type="text" id="code" name="code" required
                 inputmode="numeric" pattern="[0-9]*" maxlength="6"
                 autocomplete="one-time-code" autofocus value="${escapeHtml(code)}"
                 style="letter-spacing:0.4em;font-size:24px;text-align:center;">
        </div>
        <button type="submit" data-sign-in class="btn btn-ink btn-lg btn-full" style="margin-top:18px;">
          ${s('signInButton', lang)} ${icon('arrow-right', '22')}
        </button>
        ${tapGate}
      </form>

      <form method="post" action="/shop/login" style="margin-top:16px;">
        <input type="hidden" name="phone" value="${escapeHtml(phone)}">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <input type="hidden" name="lang" value="${en ? 'en' : 'es'}">
        <button type="submit" class="btn btn-ghost">${s('sendAnother', lang)}</button>
      </form>`,
  });
}

// --- the board --------------------------------------------------------------

// WHAT AN ATTENDANT HAS TO DO ABOUT THIS ORDER, IN ONE PHRASE.
//
// It is derived from the order, never stored. A "portal stage" column would be a
// second copy of facts the order already holds, and would go stale the first time
// anybody moved an order from the ops screens - the rule the intake table and the
// guided run both follow.
//
// THE STATUSES ARE THE SYSTEM'S AND THE WORDS ARE NOT. `AT_PARTNER` means
// nothing to somebody behind a counter; "needs weighing" does.
function jobOf(order) {
  if (order.status === 'AT_PARTNER' && order.partner_weight_lb == null) return 'WEIGH';
  if (order.status === 'AT_PARTNER') return 'WASH';
  if (order.status === 'READY') return 'DONE';
  return 'OTHER';
}

const JOB_LABEL = Object.freeze({
  WEIGH: 'needsWeight',
  WASH: 'washing',
  DONE: 'readyLabel',
  OTHER: 'washing',
});

// Sunbeam for the one that needs doing, plain for the rest. One colour carrying
// one meaning, which is the whole reason the palette has a "good news" yellow.
const JOB_TONE = Object.freeze({
  WEIGH: 'card card-brand',
  WASH: 'card',
  DONE: 'card',
  OTHER: 'card',
});

function bagCount(order, lang) {
  const n = Number(order.bag_count);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${n} ${n === 1 ? s('oneBag', lang) : s('bags', lang)}`;
}

function orderRow(order, lang) {
  const job = jobOf(order);
  const count = bagCount(order, lang);

  return `<a class="${JOB_TONE[job]}" href="/shop/orders/${encodeURIComponent(order.order_number)}?lang=${lang === 'es' ? 'es' : 'en'}"
     style="display:block;padding:18px 20px;margin-bottom:14px;text-decoration:none;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap;">
      <span style="font-family:var(--font-display);font-weight:900;font-size:24px;color:var(--ink-900);">
        ${s('order', lang)} ${escapeHtml(String(order.order_number))}
      </span>
      <span class="eyebrow" style="margin:0;">${s(JOB_LABEL[job], lang)}</span>
    </div>
    <p style="margin:6px 0 0;font-size:15px;color:var(--ink-700);">
      ${escapeHtml(count)}${
        order.partner_weight_lb != null
          ? ` &middot; ${escapeHtml(Number(order.partner_weight_lb).toFixed(1))} lb`
          : ''
      }
    </p>
  </a>`;
}

// THE ONES NEEDING SOMETHING FIRST. Not by arrival time: the question the page
// answers is "what do I do next", and an order waiting to be weighed is that
// whatever time it came in.
function board({ lang = 'en', shopName, orders = [], flash = null } = {}) {
  const sorted = [...orders].sort((a, b) => {
    const rank = { WEIGH: 0, WASH: 1, OTHER: 2, DONE: 3 };
    const byJob = rank[jobOf(a)] - rank[jobOf(b)];
    if (byJob !== 0) return byJob;
    return String(a.at_partner_at || '').localeCompare(String(b.at_partner_at || ''));
  });

  const inner = `
    ${flash ? flashNote(flash, lang) : ''}
    <h1 class="display-4" style="margin:18px 0 20px;">${s('today', lang)}</h1>
    ${
      sorted.length
        ? sorted.map((o) => orderRow(o, lang)).join('')
        : `<div class="card card-xl" style="padding:26px;">
             <p style="margin:0 0 8px;font-family:var(--font-display);font-weight:800;font-size:20px;color:var(--ink-900);">
               ${s('nothingHere', lang)}</p>
             <p style="margin:0;font-size:16px;line-height:1.6;color:var(--ink-700);">
               ${s('nothingHereMore', lang)}</p>
           </div>`
    }`;

  return shell({ lang, here: '/shop', title: T.today[lang === 'es' ? 'es' : 'en'], inner, shopName, showSignOut: true });
}

// --- one order --------------------------------------------------------------

function flashNote(flash, lang) {
  const good = flash === 'weightSaved';
  return `<div role="status" class="card" style="padding:14px 16px;margin:16px 0 0;border-color:${
    good ? 'var(--suds-500)' : 'var(--stain-500)'
  };">
    <p style="margin:0;font-size:16px;line-height:1.5;color:var(--ink-900);">${s(flash, lang)}</p>
  </div>`;
}

// ONE ORDER, AND EVERYTHING AN ATTENDANT NEEDS TO DO WITH IT.
//
// `washLines` comes from `wash.washLines()`, which is the allowlist - the same
// five structured fields the bag page shows, and nothing the customer typed. The
// rule is on the bag page for a page with no login at all, and it holds here for
// the same reason: a real saved preference reads "Deliver to 16-51 Chandler Dr",
// and no regex catches "the Bergen Pediatrics name tags", so the fix is an
// allowlist rather than redaction.
function orderPage({ lang = 'en', shopName, order, washLines = [], flash = null } = {}) {
  const en = lang !== 'es';
  const job = jobOf(order);

  // THE WASH LINES GO THROUGH THE SHARED LAUNDROMAT VOCABULARY.
  //
  // They come out of `wash.washLines()` in English - it is the one definition
  // shared with the AI's tool schema, the pricing and the account page, and it
  // has no business knowing about languages. So it is translated here, by the
  // same table the bag tag under this page uses.
  //
  // IT SHIPPED WITHOUT THIS and the result was a Spanish page whose wash
  // instructions were in English - the one part of it an attendant actually acts
  // on. The same shape as the processing guide shipping without its own language
  // buttons: the translation existed and the screen could not reach it.
  const say = translator(lang);

  const wash = `
    <h2 style="font-family:var(--font-display);font-weight:800;font-size:20px;margin:26px 0 12px;">
      ${s('howToWash', lang)}</h2>
    <div class="card card-xl" style="padding:4px 20px;">
      ${washLines
        .map(
          ([label, value]) => `
        <div style="display:flex;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--ink-100);">
          <span style="font-size:16px;color:var(--ink-700);">${escapeHtml(say(label))}</span>
          <span style="font-size:16px;font-weight:700;color:var(--ink-900);">${escapeHtml(say(value))}</span>
        </div>`
        )
        .join('')}
    </div>`;

  // THE FORM IS ABSENT UNLESS IT IS THEIRS TO FILL IN, not disabled. The same
  // doctrine as the driver's screens - a disabled control invites somebody to
  // find the way round it - and the route refuses independently, because markup
  // guards nothing.
  const weight =
    job === 'WEIGH'
      ? `
    <h2 style="font-family:var(--font-display);font-weight:800;font-size:20px;margin:26px 0 8px;">
      ${s('weightTitle', lang)}</h2>
    <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:0 0 14px;">${s('weightHelp', lang)}</p>
    <form method="post" action="/shop/orders/${encodeURIComponent(order.order_number)}/weight" class="card card-xl" style="padding:22px;">
      <input type="hidden" name="lang" value="${en ? 'en' : 'es'}">
      <div class="field">
        <label class="field-label" for="weight_lb">${s('pounds', lang)}</label>
        <input class="input input-lg" type="text" id="weight_lb" name="weight_lb" required
               inputmode="decimal" autocomplete="off" placeholder="24.5" autofocus
               style="font-size:26px;text-align:center;">
      </div>
      <button type="submit" class="btn btn-ink btn-lg btn-full" style="margin-top:18px;">
        ${s('saveWeight', lang)} ${icon('arrow-right', '22')}
      </button>
    </form>`
      : order.partner_weight_lb != null
        ? `
    <div class="card card-xl" style="padding:20px;margin-top:26px;">
      <p style="margin:0;font-size:16px;line-height:1.6;color:var(--ink-700);">
        ${s('alreadyWeighed', lang)}
        <strong style="color:var(--ink-900);">${escapeHtml(Number(order.partner_weight_lb).toFixed(1))} lb</strong>${
          order.partner_weight_at
            ? ` &middot; ${escapeHtml(format.displayDateTime(order.partner_weight_at))}`
            : ''
        }
      </p>
    </div>`
        : '';

  const inner = `
    ${flash ? flashNote(flash, lang) : ''}
    <p style="margin:18px 0 0;">
      <a class="btn btn-ghost" href="/shop?lang=${en ? 'en' : 'es'}">${icon('arrow-left', '16')} ${s('back', lang)}</a>
    </p>

    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:14px 0 0;">
      <h1 class="display-4" style="margin:0;">${s('order', lang)} ${escapeHtml(String(order.order_number))}</h1>
      <span class="eyebrow" style="margin:0;">${s(JOB_LABEL[job], lang)}</span>
    </div>
    <p style="margin:6px 0 0;font-size:16px;color:var(--ink-700);">${escapeHtml(bagCount(order, lang))}</p>

    ${wash}
    ${weight}`;

  return shell({
    lang,
    here: `/shop/orders/${encodeURIComponent(order.order_number)}`,
    title: `${T.order[en ? 'en' : 'es']} ${order.order_number}`,
    inner,
    shopName,
    showSignOut: true,
  });
}

module.exports = {
  T,
  s,
  shell,
  phoneStep,
  codeStep,
  board,
  orderPage,
  jobOf,
};
