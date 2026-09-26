'use strict';

const { escapeHtml, icon } = require('./layout');
const { opsShell, opsNote } = require('./ops-shell');
const { site } = require('./site');
const format = require('../core/format');
const { translator } = require('./laundromat-es');

// ---------------------------------------------------------------------------
// The laundromat portal's pages.
//
// Neil's ask, 25 September: "I need an interface as to where the laundromat
// attendant can log into and see the current orders at her store... they will
// also need to enter the weight into the order of all the bags and then go back
// into that order to tell uber to come get it." And, the same day: "the style of
// the laundromat back end should be the exact same style as the /ops backend".
//
// SO IT RENDERS THROUGH `ops-shell.js`, THE SAME SHELL `/ops` USES. It had its
// own hand-rolled shell for a day, which looked like the marketing site - the
// ops look is `public/css/ops.css` plus `class="ops-terminal"` on the body, and
// nothing here was loading either. `terminal` and `touch` are both on: terminal
// is the style Neil asked for, and touch is what keeps buttons at 52px, which is
// what a counter needs.
//
// WHO IS HOLDING THIS: somebody on minimum wage, behind a counter, with a
// tablet, doing us a favour between customers. That is the design brief and most
// of what follows comes out of it.
//
//   NO JAVASCRIPT beyond the shell's own menu script. A borrowed device on
//   somebody else's wifi: a page either worked or it did not.
//
//   ONE THING TO DO PER ORDER, and the card says which. An attendant is not
//   learning our state machine.
//
//   BILINGUAL, LIKE THE BAG PAGES UNDER IT. Every visible string is an
//   { en, es } pair picked by `s()`, and the wash lines go through the shared
//   laundromat vocabulary.
//
// WHAT AN ATTENDANT MUST NEVER SEE, and it is enforced by what these functions
// are HANDED rather than by what they choose to render:
//
//   the customer's NAME, PHONE OR ADDRESS. They have no reason for any of it,
//   and holding it is a liability we would be handing to somebody else's
//   employee. The order number identifies the work.
//
//   ANY MONEY. Not the price, not the per-pound rate, and above all not what we
//   pay THEM per pound. The ops screens keep the wholesale rate behind
//   `money.view` so a driver cannot browse it; an attendant is further out.
//
//   FREE TEXT THE CUSTOMER TYPED. The allowlist rule from the bag page: a real
//   saved preference reads "Deliver to 16-51 Chandler Dr", and no regex catches
//   "the Bergen Pediatrics name tags". Wash fields are structured and go
//   through; instructions never do.
// ---------------------------------------------------------------------------

// --- language ---------------------------------------------------------------
//
// Plain ASCII in the Spanish, matching the sixty ES entries in the shared
// vocabulary and the processing guide.

const T = Object.freeze({
  portal: { en: 'Laundromat', es: 'Lavanderia' },
  signIn: { en: 'Sign in.', es: 'Iniciar sesion.' },
  signInIntro: {
    en: 'Enter your mobile number and we will text you a code.',
    es: 'Escriba su numero de movil y le enviaremos un codigo.',
  },
  mobile: { en: 'Mobile number', es: 'Numero de movil' },
  textMeACode: { en: 'Text me a code', es: 'Enviarme un codigo' },
  checkPhone: { en: 'Check your phone.', es: 'Revise su telefono.' },
  sixDigits: { en: 'Six-digit code', es: 'Codigo de seis digitos' },
  signInButton: { en: 'Sign in', es: 'Entrar' },
  sendAnother: { en: 'Send another code', es: 'Enviar otro codigo' },

  expectedTitle: { en: 'Coming in', es: 'Por llegar' },
  expectedHelp: {
    en: 'A courier is bringing these. They will ask you for the code before they can hand the bags over.',
    es: 'Un mensajero trae estas. Le pedira el codigo antes de poder entregar las bolsas.',
  },
  theCode: { en: 'Code for the courier', es: 'Codigo para el mensajero' },
  noCodeYet: { en: 'No code yet', es: 'Aun sin codigo' },
  itsHere: { en: 'These bags are here', es: 'Estas bolsas ya llegaron' },
  arrived: { en: 'Added to your list.', es: 'Agregado a su lista.' },
  arrivedFailed: {
    en: 'We could not mark that as arrived. Ring us.',
    es: 'No pudimos marcarlo como llegado. Llamenos.',
  },
  nothingComing: { en: 'Nothing on the way right now.', es: 'Nada en camino ahora.' },
  today: { en: 'Your laundry today', es: 'Su ropa de hoy' },
  nothingHere: { en: 'Nothing here right now.', es: 'Nada por ahora.' },
  nothingHereMore: {
    en: 'When a courier brings us laundry, it will show up on this page.',
    es: 'Cuando un mensajero traiga ropa, aparecera en esta pagina.',
  },
  order: { en: 'Order', es: 'Pedido' },
  bags: { en: 'bags', es: 'bolsas' },
  oneBag: { en: 'bag', es: 'bolsa' },

  needsWeight: { en: 'Needs weighing', es: 'Falta pesar' },
  washing: { en: 'Being washed', es: 'Lavandose' },
  readyLabel: { en: 'Finished', es: 'Terminado' },
  onItsWay: { en: 'Courier on the way', es: 'Mensajero en camino' },

  back: { en: 'Back to the list', es: 'Volver a la lista' },
  signOut: { en: 'Sign out', es: 'Salir' },
  orders: { en: 'Orders', es: 'Pedidos' },
  staff: { en: 'Staff', es: 'Personal' },

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

  collectTitle: { en: 'Finished with it?', es: 'Ya termino?' },
  collectHelp: {
    en: 'We will send a courier to collect these bags and take them back to the customer.',
    es: 'Enviaremos un mensajero a recoger estas bolsas y llevarlas al cliente.',
  },
  collectButton: { en: 'Send a courier for these bags', es: 'Enviar un mensajero por estas bolsas' },
  collectSent: {
    en: 'A courier is on the way. Keep the bags by the counter.',
    es: 'Un mensajero viene en camino. Deje las bolsas cerca del mostrador.',
  },
  collectFailed: {
    en: 'We could not get a courier just now. Try again in a few minutes, or ring us.',
    es: 'No pudimos conseguir un mensajero ahora. Intente en unos minutos, o llamenos.',
  },
  oursToDrive: {
    en: 'One of our own drivers is collecting this one. Nothing to do.',
    es: 'Uno de nuestros conductores viene por este. No hay que hacer nada.',
  },
  drivingItOurselves: { en: 'We are collecting this one', es: 'Nosotros lo recogemos' },
  weighFirst: {
    en: 'Weigh every bag before we send a courier.',
    es: 'Pese todas las bolsas antes de enviar un mensajero.',
  },
  // A HELD ORDER, AND IT SAYS NOTHING ABOUT MONEY.
  //
  // An attendant sees no price, no rate and no payment state anywhere in this
  // portal - that is enforced by what the queries select - so "the card was
  // declined" would be the one place money leaked onto her screen, and it is
  // somebody else's business besides.
  //
  // IT ALSO MUST NOT SAY "WEIGH IT FIRST", which is what she was told before this
  // message existed: `mayBookReturnCourier()`'s reason was mapped with a ternary
  // that turned anything other than `ours_to_drive` into the weighing message. So
  // a held order sent her back to a scale she had already used, on bags she had
  // already weighed, with the real reason invisible.
  //
  // It names the office instead, because a person there can actually clear it.
  onHold: {
    en: 'We need to sort something out on this order before it goes back. Please ring us.',
    es: 'Tenemos que resolver algo en este pedido antes de que regrese. Por favor llamenos.',
  },

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

  staffTitle: { en: 'Who works here', es: 'Quien trabaja aqui' },
  staffHelp: {
    en: 'Anybody here can sign in, see these orders and enter weights. Remove somebody the day they leave.',
    es: 'Cualquiera de esta lista puede entrar, ver estos pedidos y anotar pesos. Quitelo el dia que se vaya.',
  },
  name: { en: 'Name', es: 'Nombre' },
  role: { en: 'Role', es: 'Puesto' },
  roleOwner: { en: 'Owner', es: 'Dueno' },
  roleAttendant: { en: 'Attendant', es: 'Empleado' },
  thatsYou: { en: 'That is you', es: 'Es usted' },
  removed: { en: 'Removed', es: 'Quitado' },
  removeButton: { en: 'Remove', es: 'Quitar' },
  restoreButton: { en: 'Put back', es: 'Reactivar' },
  nobodyYet: { en: 'Nobody yet.', es: 'Nadie todavia.' },
  addTitle: { en: 'Add somebody', es: 'Agregar a alguien' },
  addButton: { en: 'Add them', es: 'Agregar' },
  addHint: {
    en: 'They sign in with this mobile number and a code we text them. Use their own phone.',
    es: 'Entrara con este numero de movil y un codigo que le enviamos. Use su propio telefono.',
  },
  staffAdded: { en: 'Added. They can sign in now.', es: 'Agregado. Ya puede entrar.' },
  staffRemoved: { en: 'Removed. They cannot sign in any more.', es: 'Quitado. Ya no puede entrar.' },
  staffRestored: { en: 'Put back. They can sign in again.', es: 'Reactivado. Ya puede entrar otra vez.' },
  staffBadPhone: {
    en: 'That does not look like a mobile number.',
    es: 'Eso no parece un numero de movil.',
  },
  staffTaken: {
    en: 'That number can already sign in somewhere. Use another, or ring us.',
    es: 'Ese numero ya puede entrar en otro lugar. Use otro, o llamenos.',
  },
  staffNotYours: { en: 'That person does not work here.', es: 'Esa persona no trabaja aqui.' },
  staffNotYou: { en: 'You cannot remove yourself.', es: 'No puede quitarse a usted mismo.' },
});

// Escaped text. English is the fallback, so a missing Spanish string renders as
// readable English rather than as a hole. That is the opposite of the processing
// guide's rule, and deliberate: the guide is a fixed document where every line is
// known in advance, and this file grows.
function s(key, lang) {
  const pair = T[key];
  if (!pair) return '';
  return escapeHtml(lang === 'es' && pair.es ? pair.es : pair.en);
}

const en = (lang) => lang !== 'es';
const word = (key, lang) => (en(lang) ? T[key].en : T[key].es);

// --- the chrome -------------------------------------------------------------

// THE SHOP'S OWN NAME IN THE BAR, not LYNDRY's.
//
// The /ops bar says LYNDRY OPS because that is whose screen it is. This one is
// Riverside Wash Co's screen, and an attendant with three tabs open needs to
// know which shop she is looking at - especially somebody who works two of them,
// which `partner_users` allows.
//
// The STYLE is identical, which is what was asked for. The words are not the
// style.
function shopNav(lang, { active = '', isOwner = false } = {}) {
  const items = [{ href: '/shop', label: word('orders', lang) }];
  if (isOwner) items.push({ href: '/shop/staff', label: word('staff', lang) });

  // A MENU WITH ONE THING IN IT IS NOT A MENU - the same rule `opsNav()`
  // follows, and the same markup, so the bar behaves identically.
  return items
    .map(
      (i) =>
        `<a class="ops-menu-solo" href="${escapeHtml(i.href)}${lang === 'es' ? '?lang=es' : ''}"${
          i.href === active ? ' aria-current="page"' : ''
        }>${escapeHtml(i.label)}</a>`
    )
    .join('');
}

// The language toggle, in the slot where /ops puts the signed-in person's name.
// It keeps whatever else is on the query string, the way `langToggleHere()` does
// on the bag pages.
function langToggle(lang, here) {
  const other = lang === 'es' ? 'en' : 'es';
  const [path, query = ''] = String(here || '/shop').split('?');
  const params = new URLSearchParams(query);
  params.set('lang', other);

  return `<a class="btn btn-outline btn-sm" href="${escapeHtml(
    `${path}?${params.toString()}`
  )}" hreflang="${other}">${other === 'es' ? 'Espanol' : 'English'}</a>`;
}

function shopFooter(lang) {
  return `<footer class="container" style="padding-bottom:40px;">
    <p style="font-size:13px;line-height:1.6;margin:0 0 4px;">
      <a href="/processing?lang=${en(lang) ? 'en' : 'es'}">${s('processingLink', lang)}</a>
    </p>
    <p style="font-size:13px;line-height:1.6;margin:0;">
      ${s('questions', lang)} <strong>${escapeHtml(site.opsPhoneDisplay)}</strong>
    </p>
  </footer>`;
}

// ONE DOOR ONTO THE SHELL, so every portal screen gets the same bar, the same
// footer and the same language handling without a branch for any of them.
// `signedIn` DECIDES THE BAR, NOT WHETHER A SHOP IS KNOWN. The sign-in page at
// `/shop/<slug>` knows perfectly well which laundromat it is - that is the whole
// point of the URL - and putting a Sign out button and a nav on a page nobody
// has signed into yet would be nonsense.
function page({
  lang = 'en',
  title,
  body,
  shop = null,
  signedIn = false,
  here = '/shop',
  active = '',
  isOwner = false,
  notes = [],
}) {
  return opsShell({
    title,
    titleSuffix: shop ? shop.name : site.name,
    lang: en(lang) ? 'en' : 'es',
    body,
    mark: shop
      ? { text: shop.name, href: '/shop', label: shop.name }
      : { text: site.name, href: '/shop', label: site.name },
    nav: signedIn ? shopNav(lang, { active, isOwner }) : '',
    aside: langToggle(lang, here),
    signOut: signedIn ? { action: '/shop/logout', label: word('signOut', lang) } : null,
    // ITS OWN, SCOPED TO /shop. Sharing the ops one would give a laundromat's
    // tablet a home-screen app scoped to /ops that opens on the driver's route
    // and bounces to a sign-in they can never pass.
    manifest: '/shop/app.webmanifest',
    notes,
    footer: shopFooter(lang),
    terminal: true,
    // A COUNTER IS A DOORSTEP. 52px controls and real input targets, the same
    // reason the driver's screens set it.
    touch: true,
  });
}

// --- signing in -------------------------------------------------------------

function signInShell({ lang, heading, intro, error, form, here, shop = null }) {
  return page({
    lang,
    here,
    shop,
    title: heading,
    notes: error ? [opsNote({ tone: 'bad', title: escapeHtml(error) })] : [],
    body: `
      <div style="max-width:440px;">
        <h1>${escapeHtml(heading)}</h1>
        <p>${intro}</p>
        ${form}
      </div>`,
  });
}

function phoneStep({ lang = 'en', error = '', phone = '', next = '/shop', shop = null } = {}) {
  return signInShell({
    lang,
    shop,
    here: shop && shop.slug ? `/shop/${shop.slug}` : '/shop/login',
    heading: word('signIn', lang),
    intro: s('signInIntro', lang),
    error,
    form: `
      <form method="post" action="/shop/login" class="card" style="margin-top:14px;">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <input type="hidden" name="lang" value="${en(lang) ? 'en' : 'es'}">
        <div class="field">
          <label class="field-label" for="phone">${s('mobile', lang)}</label>
          <input class="input input-lg" type="tel" id="phone" name="phone" required
                 autocomplete="tel" inputmode="tel" placeholder="201-555-0142"
                 value="${escapeHtml(phone)}" autofocus>
        </div>
        <button type="submit" class="btn btn-primary btn-lg btn-full" style="margin-top:14px;">
          ${s('textMeACode', lang)} ${icon('arrow-right', '22')}
        </button>
      </form>`,
  });
}

function codeStep({ lang = 'en', error = '', phone = '', code = '', next = '/shop', ttlMinutes = 5, tapGate = '' } = {}) {
  return signInShell({
    lang,
    here: '/shop/login/code',
    heading: word('checkPhone', lang),
    // ON ITS WAY, NOT ALREADY SENT. The text goes a few seconds after the number
    // is entered, so "we texted you a code" is a sentence the phone contradicts
    // for the first moment - which reads as broken and starts somebody tapping.
    intro: en(lang)
      ? `A six-digit code is on its way to <strong>${escapeHtml(
          format.displayPhone(phone)
        )}</strong>. Give it a few seconds. It expires ${ttlMinutes} minutes after it lands.`
      : `Un codigo de seis digitos va en camino a <strong>${escapeHtml(
          format.displayPhone(phone)
        )}</strong>. Espere unos segundos. Vence ${ttlMinutes} minutos despues de llegar.`,
    error,
    form: `
      <form method="post" action="/shop/login/code" class="card" style="margin-top:14px;">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <input type="hidden" name="phone" value="${escapeHtml(phone)}">
        <input type="hidden" name="lang" value="${en(lang) ? 'en' : 'es'}">
        <div class="field">
          <label class="field-label" for="code">${s('sixDigits', lang)}</label>
          <input class="input input-lg" type="text" id="code" name="code" required
                 inputmode="numeric" pattern="[0-9]*" maxlength="6"
                 autocomplete="one-time-code" autofocus value="${escapeHtml(code)}"
                 style="letter-spacing:0.4em;text-align:center;">
        </div>
        <button type="submit" data-sign-in class="btn btn-primary btn-lg btn-full" style="margin-top:14px;">
          ${s('signInButton', lang)} ${icon('arrow-right', '22')}
        </button>
        ${tapGate}
      </form>

      <form method="post" action="/shop/login" style="margin-top:14px;">
        <input type="hidden" name="phone" value="${escapeHtml(phone)}">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <input type="hidden" name="lang" value="${en(lang) ? 'en' : 'es'}">
        <button type="submit" class="btn btn-outline">${s('sendAnother', lang)}</button>
      </form>`,
  });
}

// --- the board --------------------------------------------------------------

// WHAT AN ATTENDANT HAS TO DO ABOUT THIS ORDER, IN ONE PHRASE.
//
// Derived from the order, never stored. A "portal stage" column would be a
// second copy of facts the order already holds and would go stale the first time
// anybody moved an order from the ops screens.
//
// THE STATUSES ARE THE SYSTEM'S AND THE WORDS ARE NOT. `AT_PARTNER` means
// nothing behind a counter; "needs weighing" does.
function jobOf(order) {
  // A COURIER ON THE WAY IS THE LOUDEST FACT ABOUT AN ORDER, whatever its status
  // says. The status does not move when one is booked - that would text the
  // customer that their laundry is travelling before anybody collected it - so
  // this is the only thing on the screen that can say so.
  if (order.courierBooked) return 'GONE';

  if (order.status === 'AT_PARTNER' && order.partner_weight_lb == null) return 'WEIGH';
  if (order.status === 'AT_PARTNER') return 'WASH';
  if (order.status === 'READY') return 'DONE';
  if (order.status === 'OUT_FOR_DELIVERY') return 'GONE';
  return 'OTHER';
}

const JOB_LABEL = Object.freeze({
  WEIGH: 'needsWeight',
  WASH: 'washing',
  DONE: 'readyLabel',
  GONE: 'onItsWay',
  OTHER: 'washing',
});

// The ops chip vocabulary, so a status here reads the way a status does on the
// board Neil looks at.
const JOB_CHIP = Object.freeze({
  WEIGH: 'chip warn',
  WASH: 'chip',
  DONE: 'chip ok',
  GONE: 'chip ok',
  OTHER: 'chip',
});

function bagCount(order, lang) {
  const n = Number(order.bag_count);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${n} ${n === 1 ? s('oneBag', lang) : s('bags', lang)}`;
}

function orderRow(order, lang) {
  const job = jobOf(order);
  const weighed =
    order.partner_weight_lb != null
      ? ` &middot; ${escapeHtml(Number(order.partner_weight_lb).toFixed(1))} lb`
      : '';

  return `<a class="card" href="/shop/orders/${encodeURIComponent(order.order_number)}?lang=${
    en(lang) ? 'en' : 'es'
  }" style="display:block;margin-bottom:10px;text-decoration:none;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <strong style="font-size:17px;">${s('order', lang)} ${escapeHtml(String(order.order_number))}</strong>
      <span class="${JOB_CHIP[job]}">${s(JOB_LABEL[job], lang)}</span>
    </div>
    <p style="margin:4px 0 0;">${escapeHtml(bagCount(order, lang))}${weighed}</p>
  </a>`;
}

// ONE ORDER A COURIER IS BRINGING, AND THE CODE THEY WILL ASK FOR.
//
// THE CODE IS THE POINT OF THIS ROW. Uber texts it to the shop as well, and this
// is what saves an attendant when that text has not arrived or the phone is in
// somebody's pocket - which on a counter is most of the time.
//
// IT IS NOT TYPED BACK IN. The courier enters it in their own app and Uber will
// not let them complete without it, so asking the attendant to re-type a number
// we have just shown her would be theatre. What the button records is the one
// thing only she knows: the bags are physically here.
function expectedRow(e, lang) {
  const bags = Number(e.bagCount);

  return `<div class="card" style="margin-bottom:10px;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <strong style="font-size:17px;">${s('order', lang)} ${escapeHtml(String(e.orderNumber))}</strong>
      ${Number.isFinite(bags) && bags > 0 ? `<span>${bags} ${bags === 1 ? s('oneBag', lang) : s('bags', lang)}</span>` : ''}
    </div>

    <div style="margin:10px 0;">
      <div class="eyebrow" style="margin:0 0 2px;">${s('theCode', lang)}</div>
      <div style="font-family:var(--c-mono,ui-monospace,monospace);font-size:30px;font-weight:700;letter-spacing:0.12em;">
        ${e.pin ? escapeHtml(e.pin) : s('noCodeYet', lang)}
      </div>
    </div>

    <form method="post" action="/shop/expected/${encodeURIComponent(e.orderNumber)}/arrived" style="margin:0;">
      <input type="hidden" name="lang" value="${en(lang) ? 'en' : 'es'}">
      <button type="submit" class="btn btn-primary btn-lg btn-full">${s('itsHere', lang)}</button>
    </form>
  </div>`;
}

// THROUGH `opsNote()`, NEVER AN INLINE-STYLED BOX. `test/ops-notices.test.js`
// refuses a hand-styled banner anywhere in the ops screens, and this file is held
// to the same rule now that it renders through the same shell.
function flashNotes(flash, lang) {
  if (!flash) return [];

  const good = ['weightSaved', 'collectSent', 'arrived'].includes(flash);
  return [opsNote({ tone: good ? 'good' : 'bad', title: s(flash, lang) })];
}

// THE ONES NEEDING SOMETHING FIRST. Not by arrival time: the question the page
// answers is "what do I do next", and an order waiting to be weighed is that
// whatever time it came in.
function board({ lang = 'en', shop, orders = [], expected = [], flash = null, isOwner = false } = {}) {
  const rank = { WEIGH: 0, WASH: 1, OTHER: 2, DONE: 3, GONE: 4 };
  const sorted = [...orders].sort(
    (a, b) =>
      rank[jobOf(a)] - rank[jobOf(b)] ||
      String(a.at_partner_at || '').localeCompare(String(b.at_partner_at || ''))
  );

  // WHAT IS ON ITS WAY, ABOVE WHAT IS ALREADY HERE. An attendant's first
  // question walking up to the tablet is "is anything coming", and the code a
  // courier will ask for is the one thing on this screen she cannot look up
  // anywhere else.
  const incoming = expected.length
    ? `
    <h2>${s('expectedTitle', lang)}</h2>
    <p>${s('expectedHelp', lang)}</p>
    ${expected.map((e) => expectedRow(e, lang)).join('')}
    <h2 style="margin-top:22px;">${s('today', lang)}</h2>`
    : `<h1>${s('today', lang)}</h1>`;

  const body = `
    ${incoming}
    ${
      sorted.length
        ? sorted.map((o) => orderRow(o, lang)).join('')
        : `<div class="card">
             <strong>${s('nothingHere', lang)}</strong>
             <p style="margin:4px 0 0;">${s('nothingHereMore', lang)}</p>
           </div>`
    }`;

  return page({
    lang,
    shop,
    signedIn: true,
    isOwner,
    active: '/shop',
    here: '/shop',
    title: word('today', lang),
    notes: flashNotes(flash, lang),
    body,
  });
}

// --- one order --------------------------------------------------------------

// ONE ORDER, AND EVERYTHING AN ATTENDANT NEEDS TO DO WITH IT.
//
// `washLines` comes from `wash.washLines()`, which is the allowlist - the same
// five structured fields the bag page shows, and nothing the customer typed.
function orderPage({
  lang = 'en',
  shop,
  order,
  washLines = [],
  flash = null,
  isOwner = false,
  canSendCourier = false,
} = {}) {
  const job = jobOf(order);

  // THE WASH LINES GO THROUGH THE SHARED LAUNDROMAT VOCABULARY. They come out of
  // `wash.washLines()` in English - it is the one definition shared with the AI's
  // tool schema, the pricing and the account page, and it has no business knowing
  // about languages.
  const say = translator(lang);

  // `.ops-table`, NOT `.kv`. Both are in ops.css and only one of them works
  // here: `table.kv` is written as `.console table.kv`, scoped to the order
  // console's own layout, so outside it the rows get no styling at all and the
  // wash instructions rendered as bare text. Neil found it on screen.
  //
  // `.ops-table-wrap` / `.ops-table` are the shared helper's classes and are
  // deliberately unscoped - they are what `table()` emits on the orders board,
  // and what the Staff page here already uses.
  const rows = washLines
    .map(([label, value]) => `<tr><th>${escapeHtml(say(label))}</th><td>${escapeHtml(say(value))}</td></tr>`)
    .join('');

  const wash = `
    <h2 style="margin-top:18px;">${s('howToWash', lang)}</h2>
    <div class="ops-table-wrap">
      <table class="ops-table"><tbody>${rows}</tbody></table>
    </div>`;

  // THE FORM IS ABSENT UNLESS IT IS THEIRS TO FILL IN, not disabled. The same
  // doctrine as the driver's screens - a disabled control invites somebody to
  // find the way round it - and the route refuses independently, because markup
  // guards nothing.
  const weighed = `
    <div class="card" style="margin-top:14px;">
      <p style="margin:0;">
        ${s('alreadyWeighed', lang)}
        <strong>${
          order.partner_weight_lb == null ? '' : escapeHtml(Number(order.partner_weight_lb).toFixed(1))
        } lb</strong>${
          order.partner_weight_at ? ` &middot; ${escapeHtml(format.displayDateTime(order.partner_weight_at))}` : ''
        }
      </p>
    </div>`;

  const weighForm = `
    <h2>${s('weightTitle', lang)}</h2>
    <p>${s('weightHelp', lang)}</p>
    <form method="post" action="/shop/orders/${encodeURIComponent(
      order.order_number
    )}/weight" class="card">
      <input type="hidden" name="lang" value="${en(lang) ? 'en' : 'es'}">
      <div class="field">
        <label class="field-label" for="weight_lb">${s('pounds', lang)}</label>
        <input class="input input-lg" type="text" id="weight_lb" name="weight_lb" required
               inputmode="decimal" autocomplete="off" placeholder="24.5" autofocus
               style="text-align:center;">
      </div>
      <button type="submit" class="btn btn-primary btn-lg btn-full" style="margin-top:14px;">
        ${s('saveWeight', lang)} ${icon('arrow-right', '22')}
      </button>
    </form>`;

  const weight = job === 'WEIGH' ? weighForm : order.partner_weight_lb != null ? weighed : '';

  // THE COURIER BUTTON. Neil: "in the order screen, there should be a button of
  // the attendant to tell the uber driver to come get the bags."
  //
  // IT ONLY EXISTS ONCE THE WORK IS WEIGHED AND FINISHED. The route refuses
  // independently on both counts - a button that is merely absent guards nothing
  // - and the attendant never sees where the bags are going: the courier is told
  // the address, this page is not.
  const courier = canSendCourier
    ? `
    <h2>${s('collectTitle', lang)}</h2>
    <p>${s('collectHelp', lang)}</p>
    <form method="post" action="/shop/orders/${encodeURIComponent(
      order.order_number
    )}/collect" class="card">
      <input type="hidden" name="lang" value="${en(lang) ? 'en' : 'es'}">
      <button type="submit" class="btn btn-primary btn-lg btn-full">
        ${s('collectButton', lang)} ${icon('truck', '22')}
      </button>
    </form>`
    : '';

  const body = `
    <p style="margin:0 0 10px;">
      <a class="btn btn-outline btn-sm" href="/shop?lang=${en(lang) ? 'en' : 'es'}">${icon(
        'arrow-left',
        '16'
      )} ${s('back', lang)}</a>
    </p>

    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <h1 style="margin:0;">${s('order', lang)} ${escapeHtml(String(order.order_number))}</h1>
      <span class="${JOB_CHIP[job]}">${s(JOB_LABEL[job], lang)}</span>
    </div>
    <p style="margin:4px 0 0;">${escapeHtml(bagCount(order, lang))}</p>

    ${wash}
    ${weight}
    ${courier}`;

  return page({
    lang,
    shop,
    signedIn: true,
    isOwner,
    here: `/shop/orders/${order.order_number}`,
    title: `${word('order', lang)} ${order.order_number}`,
    notes: flashNotes(flash, lang),
    body,
  });
}


// --- the shop's own staff ---------------------------------------------------
//
// Neil, 25 September: "i should be able to assign the owner of the laundromat to
// be the admin of that account. the owner should be able to add and remove
// attendants."
//
// SO THERE ARE TWO LADDERS AND THEY DO NOT MEET. LYNDRY says who owns a shop;
// the owner says who works there. An owner cannot promote anybody, which is the
// whole point of the split: a shop manages its own staff and cannot grow its own
// admin rights, so the worst an owner can do is add and remove people at the
// shop they already run.
//
// REMOVING KEEPS THE ROW. `partner_users.status` goes to DISABLED and the record
// of who weighed which bag survives - the same rule `ops_users` follows, and for
// the same reason: deleting people loses the history.
function staffPage({ lang = 'en', shop, staff = [], me, flash = null } = {}) {
  const rows = staff.map((person) => {
    const isMe = person.id === me.id;
    const active = person.status === 'ACTIVE';

    // NOBODY CAN REMOVE THEMSELVES. The same rule the ops Team page follows, and
    // here it is the one action that can leave a shop with no owner and no way
    // to add one - which would need a phone call to us to undo.
    const action = isMe
      ? `<span class="chip">${s('thatsYou', lang)}</span>`
      : `<form method="post" action="/shop/staff/${encodeURIComponent(person.id)}" style="margin:0;">
           <input type="hidden" name="lang" value="${en(lang) ? 'en' : 'es'}">
           <input type="hidden" name="status" value="${active ? 'DISABLED' : 'ACTIVE'}">
           <button type="submit" class="btn ${active ? 'btn-outline' : 'btn-primary'} btn-sm">${
             active ? s('removeButton', lang) : s('restoreButton', lang)
           }</button>
         </form>`;

    return [
      escapeHtml(person.name),
      escapeHtml(format.displayPhone(person.phone)),
      `<span class="chip${person.role === 'OWNER' ? ' ok' : ''}">${
        person.role === 'OWNER' ? s('roleOwner', lang) : s('roleAttendant', lang)
      }</span>`,
      active ? '' : `<span class="chip warn">${s('removed', lang)}</span>`,
      action,
    ];
  });

  const body = `
    <h1>${s('staffTitle', lang)}</h1>
    <p>${s('staffHelp', lang)}</p>

    ${
      rows.length
        ? `<div class="ops-table-wrap">
             <table class="ops-table">
               <thead><tr>
                 <th>${s('name', lang)}</th>
                 <th>${s('mobile', lang)}</th>
                 <th>${s('role', lang)}</th>
                 <th></th>
                 <th></th>
               </tr></thead>
               <tbody>${rows
                 .map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`)
                 .join('')}</tbody>
             </table>
           </div>`
        : `<p class="ops-empty">${s('nobodyYet', lang)}</p>`
    }

    <h2>${s('addTitle', lang)}</h2>
    <form method="post" action="/shop/staff" class="card">
      <input type="hidden" name="lang" value="${en(lang) ? 'en' : 'es'}">
      <div class="field">
        <label class="field-label" for="name">${s('name', lang)}</label>
        <input class="input input-lg" type="text" id="name" name="name" required
               autocomplete="off" maxlength="60">
      </div>
      <div class="field" style="margin-top:10px;">
        <label class="field-label" for="phone">${s('mobile', lang)}</label>
        <input class="input input-lg" type="tel" id="phone" name="phone" required
               autocomplete="off" inputmode="tel" placeholder="201-555-0142">
      </div>
      <p class="field-hint" style="margin-top:8px;">${s('addHint', lang)}</p>
      <button type="submit" class="btn btn-primary btn-lg btn-full" style="margin-top:14px;">
        ${s('addButton', lang)} ${icon('arrow-right', '22')}
      </button>
    </form>`;

  return page({
    lang,
    shop,
    signedIn: true,
    isOwner: true,
    active: '/shop/staff',
    here: '/shop/staff',
    title: word('staffTitle', lang),
    notes: flashNotes(flash, lang),
    body,
  });
}

module.exports = {
  T,
  s,
  page,
  phoneStep,
  codeStep,
  board,
  orderPage,
  staffPage,
  jobOf,
  shopNav,
};
