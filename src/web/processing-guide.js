'use strict';

// ---------------------------------------------------------------------------
// THE LAUNDROMAT PROCESSING GUIDE, IN BOTH LANGUAGES.
//
// Neil's words, 15 September, and the decision lock is deliberately small:
// this is a plain hyperlink from the bag-tag page to one generic page. It is
// not a button, a modal, a workflow step or a confirmation, opening it changes
// no order state, and it needs no second scan and no sign-in.
//
// ONE PAGE FOR EVERY ORDER, WHICH IS THE POINT. The instructions are the same
// for every bag on the shelf, so there is one copy of them and every tag links
// to it. A per-order copy would be the same words rendered eighty times, and
// the eighty-first would be the one somebody edited.
//
// NOTHING PRIVATE IS ON IT, AND THAT IS A CONSTRAINT RATHER THAN A HAPPY
// ACCIDENT. A customer can open their own bag tag and will see the same link,
// so this page is written as though a stranger is reading it: no customer, no
// address, no order, no price, no wholesale rate. It takes nothing but a
// language, which is what makes that true by construction rather than by care.
//
// IT IS THE SAME SHELL AS THE BAG PAGE. Same stylesheets, no navigation, no
// footer, no advertising tag and noindex - all of which the bag page's own
// page() already does. A laundromat attendant is reading this on a phone next
// to a scale; the marketing header inviting them to book a pickup is noise.
//
// ---------------------------------------------------------------------------
// BOTH LANGUAGES SIT SIDE BY SIDE, AND THAT IS WHY THIS FILE LOOKS LIKE THIS.
//
// Neil, 15 September: the bag page already switches language, so the guide has
// to match. It would have been shorter to put the Spanish in bag.js's ES table,
// which is keyed on the English string - but that table is sixty short UI
// labels, a whole document would swamp it, and a lookup that MISSES silently
// returns the English. On a label that is a blemish; on a safety instruction
// about not mixing two customers' laundry it is a page that looks translated
// and is not.
//
// So every visible string here is an { en, es } pair and say() picks one. A
// missing translation renders as undefined rather than as quiet English, so it
// cannot hide.
//
// PLAIN ASCII SPANISH, NO ACCENTS, because that is what the sixty entries in
// bag.js already do and this link sits directly under them. Two conventions on
// one screen would read as a mistake.
// ---------------------------------------------------------------------------
//
// EVERY FIGURE COMES FROM THE RUNNING SYSTEM, the same rule /ops/process and
// /ops/journey follow. The sticker count is bags.STICKERS_PER_TAG, which
// CLAUDE.md is explicit about: it went from four to three, and it is a constant
// precisely so that a change reaches the sheet, the roll, the QR page and this
// guide together.
//
// ONE NUMBER ON THIS PAGE, AND IT IS THE BUSINESS LINE. Neil, 15 September:
// never the owner cell. The guide he wrote had it as an escalation for a
// laundromat that could not get through - but this page has no login on it and
// a customer can open their own bag tag and reach it, so putting his personal
// mobile here would publish it to anybody holding a sticker. That is the rule
// CLAUDE.md already keeps everywhere else, and site.opsPhoneDisplay stopped
// falling back to that number for exactly this reason.
//
// It does not read config.supportPhone at all, so no setting can put it back.
// ---------------------------------------------------------------------------

const bags = require('../core/bags');
const { site } = require('./site');

// THE TURNAROUND IS READ, NOT TYPED, and it still has to be sayable in Spanish.
// site.turnaround is the English phrase every other page uses; this maps it.
// An unmapped value falls through to the English, which is visible on the page
// rather than silently wrong - the same failure mode say() has.
const TURNAROUND_ES = Object.freeze({
  'next day': 'al dia siguiente',
  'same day': 'el mismo dia',
});

const WORDS = {
  en: ['no', 'one', 'two', 'three', 'four', 'five', 'six'],
  es: ['ninguna', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis'],
};

const inWords = (n, lang) => (WORDS[lang] || WORDS.en)[n] || String(n);
const capitalise = (word) => word.charAt(0).toUpperCase() + word.slice(1);

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- the shapes a section is built from -------------------------------------

function step(label, number, heading, body) {
  return `
  <section class="card" style="padding:24px;margin-bottom:16px;">
    <p class="eyebrow" style="margin:0 0 8px;">${esc(label)} ${number}</p>
    <h2 style="font-family:var(--font-display);font-weight:800;font-size:22px;line-height:1.2;margin:0 0 12px;">
      ${esc(heading)}
    </h2>
    ${body}
  </section>`;
}

// The boxes that say "this one matters". Sunbeam for a warning somebody has to
// read, stain for the one thing that must never happen.
function callout(words, tone = 'sunbeam') {
  const background = tone === 'stain' ? 'var(--stain-100)' : 'var(--sunbeam-100)';
  const edge = tone === 'stain' ? 'var(--stain-500)' : 'var(--sunbeam-500)';

  return `
  <p style="margin:14px 0 0;padding:12px 15px;border:2px solid ${edge};border-radius:10px;
            background:${background};font-size:15px;line-height:1.55;font-weight:600;">
    ${words}
  </p>`;
}

const list = (items) =>
  `<ul style="margin:10px 0 0;padding-left:20px;font-size:16px;line-height:1.65;color:var(--ink-800);">
    ${items.map((i) => `<li style="margin-bottom:5px;">${i}</li>`).join('')}
  </ul>`;

const para = (words) =>
  `<p style="margin:0 0 10px;font-size:16px;line-height:1.65;color:var(--ink-800);">${words}</p>`;

const checks = (items) =>
  `<ul style="margin:10px 0 0;padding-left:0;list-style:none;font-size:16px;line-height:1.7;color:var(--ink-800);">
    ${items
      .map(
        (i) =>
          `<li style="margin-bottom:5px;display:flex;gap:9px;"><span aria-hidden="true">&check;</span><span>${i}</span></li>`
      )
      .join('')}
  </ul>`;

// --- the guide --------------------------------------------------------------

function processingGuideBody(lang = 'en') {
  const spanish = lang === 'es';

  // One string out of a pair, escaped. Nothing here falls back to English: an
  // untranslated string shows as undefined rather than looking translated.
  const s = (pair) => esc(spanish ? pair.es : pair.en);

  // The same, for a string that carries its own markup.
  const r = (pair) => (spanish ? pair.es : pair.en);

  const stickers = bags.STICKERS_PER_TAG;

  const turnaround = spanish ? TURNAROUND_ES[site.turnaround] || site.turnaround : site.turnaround;
  const stepLabel = r({ en: 'Step', es: 'Paso' });

  // An example set of sticker ids, built from the real count so it cannot show
  // three when a tag carries four.
  const exampleCodes = Array.from({ length: stickers }, (_, i) => `FA5PP1-${i + 1}`);

  return `
  <div class="card" style="padding:28px;margin-bottom:22px;">
    <p class="eyebrow" style="margin:0 0 8px;">${s({
      en: 'For the laundromat',
      es: 'Para la lavanderia',
    })}</p>
    <h1 style="font-family:var(--font-display);font-weight:900;font-size:clamp(26px,6vw,34px);line-height:1.1;margin:0 0 14px;">
      ${s({ en: 'Processing guide', es: 'Guia de procesamiento' })}
    </h1>
    ${para(
      s({
        en: 'Please follow these steps for every LYNDRY order.',
        es: 'Siga estos pasos en cada pedido de LYNDRY.',
      })
    )}
    ${para(
      s({
        en: 'The LYNDRY bag tag and stickers keep each order identifiable from the time it arrives here until LYNDRY collects the finished laundry.',
        es: 'La etiqueta LYNDRY y sus calcomanias mantienen cada pedido identificable desde que llega aqui hasta que LYNDRY recoge la ropa terminada.',
      })
    )}
    ${para(
      r({
        en: `LYNDRY guarantees ${esc(
          turnaround
        )} delivery, so orders must be completed promptly and marked ready as soon as processing is finished.`,
        es: `LYNDRY garantiza entrega ${esc(
          turnaround
        )}, asi que los pedidos deben completarse pronto y marcarse como listos en cuanto termine el proceso.`,
      })
    )}
  </div>

  <section class="card" style="padding:24px;margin-bottom:16px;">
    <h2 style="font-family:var(--font-display);font-weight:800;font-size:22px;line-height:1.2;margin:0 0 12px;">
      ${s({ en: 'About the bag tag', es: 'Sobre la etiqueta' })}
    </h2>
    ${para(
      s({
        en: 'Every incoming laundry bag has a LYNDRY bag tag attached. Each tag has:',
        es: 'Cada bolsa que llega tiene una etiqueta LYNDRY. Cada etiqueta tiene:',
      })
    )}
    ${list([
      s({ en: 'A QR code that opens the order', es: 'Un codigo QR que abre el pedido' }),
      s({
        en: `${capitalise(inWords(stickers, 'en'))} detachable stickers`,
        es: `${capitalise(inWords(stickers, 'es'))} calcomanias desprendibles`,
      }),
      s({
        en: 'Each detachable sticker has its own QR code and sticker number',
        es: 'Cada calcomania tiene su propio codigo QR y su numero',
      }),
    ])}
    ${para(
      r({
        en: 'The bag tag identifies the <strong>order</strong>, not the customer.',
        es: 'La etiqueta identifica el <strong>pedido</strong>, no al cliente.',
      })
    )}
    ${para(
      s({
        en: 'The tag must stay with the laundry throughout processing. The detachable stickers keep separated portions identifiable, and identify the finished bags LYNDRY collects.',
        es: 'La etiqueta debe quedarse con la ropa durante todo el proceso. Las calcomanias sirven para identificar las partes separadas y las bolsas terminadas que LYNDRY recoge.',
      })
    )}
    ${callout(
      s({
        en: 'Do not throw away the bag tag or any unused stickers.',
        es: 'No tire la etiqueta ni las calcomanias que no use.',
      })
    )}
  </section>

  ${step(
    stepLabel,
    1,
    r({ en: 'Scan the QR code', es: 'Escanee el codigo QR' }),
    `${para(s({ en: 'Before processing the laundry:', es: 'Antes de procesar la ropa:' }))}
     ${list([
       s({
         en: 'Scan any QR code on the bag tag.',
         es: 'Escanee cualquier codigo QR de la etiqueta.',
       }),
       s({
         en: 'Wait for the order page to finish loading.',
         es: 'Espere a que la pagina del pedido termine de cargar.',
       }),
       s({
         en: 'Check that the code on the screen matches the code on the tag.',
         es: 'Confirme que el codigo en la pantalla es igual al de la etiqueta.',
       }),
     ])}
     ${callout(
       s({
         en: 'Do not begin processing until the correct order page has loaded.',
         es: 'No empiece a procesar hasta que se haya cargado la pagina correcta.',
       })
     )}
     ${para(
       r({
         en: 'If the screen says <strong>that bag is not with you yet</strong>, do not start the order. It has not been released for processing.',
         es: 'Si la pantalla dice <strong>esa bolsa todavia no esta con usted</strong>, no empiece el pedido. Todavia no ha sido liberado para procesar.',
       })
     )}`
  )}

  ${step(
    stepLabel,
    2,
    r({ en: 'Weigh the incoming laundry', es: 'Pese la ropa que llega' }),
    `${para(s({ en: 'Before washing:', es: 'Antes de lavar:' }))}
     ${list([
       s({
         en: 'Weigh the incoming laundry on your scale.',
         es: 'Pese la ropa que llega en su bascula.',
       }),
       s({
         en: 'Enter the weight on the order page.',
         es: 'Escriba el peso en la pagina del pedido.',
       }),
       s({ en: 'Tap Save.', es: 'Toque Guardar.' }),
     ])}
     ${callout(
       s({
         en: 'The wash instructions only appear after the weight has been saved. Do not begin washing before the incoming weight is entered and saved.',
         es: 'Las instrucciones de lavado solo aparecen despues de guardar el peso. No empiece a lavar antes de escribir y guardar el peso.',
       })
     )}`
  )}

  ${step(
    stepLabel,
    3,
    r({ en: 'Read the wash instructions', es: 'Lea las instrucciones de lavado' }),
    `${para(
      s({
        en: 'Once the weight is saved, the wash instructions for that order appear on the phone. Read them before starting the wash, including any:',
        es: 'Al guardar el peso, las instrucciones de ese pedido aparecen en el telefono. Lealas antes de empezar a lavar, incluyendo:',
      })
    )}
     ${list([
       s({ en: 'Water temperature', es: 'Temperatura del agua' }),
       s({ en: 'Detergent', es: 'Detergente' }),
       s({ en: 'Softener', es: 'Suavizante' }),
       s({ en: 'Fragrance preference', es: 'Preferencia de fragancia' }),
     ])}
     ${callout(
       s({
         en: 'Always follow the instructions on the phone. Never assume two LYNDRY orders have the same wash preferences.',
         es: 'Siga siempre las instrucciones del telefono. Nunca suponga que dos pedidos de LYNDRY tienen las mismas preferencias.',
       })
     )}`
  )}

  ${step(
    stepLabel,
    4,
    r({ en: 'Keep the tag with the order', es: 'Mantenga la etiqueta con el pedido' }),
    `${para(
      s({
        en: 'The bag tag stays with the laundry the whole way through:',
        es: 'La etiqueta se queda con la ropa durante todo el proceso:',
      })
    )}
     ${para(
       r({
         en: '<strong>Wash &rarr; Dry &rarr; Fold &rarr; Pack</strong>',
         es: '<strong>Lavar &rarr; Secar &rarr; Doblar &rarr; Empacar</strong>',
       })
     )}
     ${para(
       s({
         en: 'If the laundry moves between washers, dryers, carts, folding tables or work areas, the LYNDRY identification has to move with it.',
         es: 'Si la ropa pasa entre lavadoras, secadoras, carritos, mesas de doblar u otras areas, la identificacion de LYNDRY tiene que ir con ella.',
       })
     )}
     ${callout(
       s({
         en: 'Never mix two LYNDRY orders together. Do not throw away the bag tag.',
         es: 'Nunca mezcle dos pedidos de LYNDRY. No tire la etiqueta.',
       }),
       'stain'
     )}`
  )}

  ${step(
    stepLabel,
    5,
    r({
      en: 'If the laundry is split, use the stickers',
      es: 'Si la ropa se separa, use las calcomanias',
    }),
    `${para(
      s({
        en: 'Sometimes one order needs separating across several washers, dryers, carts or work areas. That is fine.',
        es: 'A veces un pedido se tiene que separar en varias lavadoras, secadoras, carritos o areas. Eso esta bien.',
      })
    )}
     ${para(
       s({
         en: `Each bag tag has ${inWords(
           stickers,
           'en'
         )} detachable QR stickers for exactly this. If part of the order is separated:`,
         es: `Cada etiqueta tiene ${inWords(
           stickers,
           'es'
         )} calcomanias con codigo QR para esto. Si separa una parte del pedido:`,
       })
     )}
     ${list([
       s({
         en: 'Take one detachable sticker off the tag.',
         es: 'Quite una calcomania de la etiqueta.',
       }),
       s({
         en: 'Attach it to your own tracking tag, receipt or identifier for that portion.',
         es: 'Peguela en su propio ticket, recibo o identificador de esa parte.',
       }),
       s({
         en: 'Keep it with that portion while it moves through processing.',
         es: 'Mantengala con esa parte durante todo el proceso.',
       }),
     ])}
     ${callout(
       s({
         en: 'Every part of the order must stay identifiable.',
         es: 'Cada parte del pedido debe quedar identificable.',
       })
     )}`
  )}

  ${step(
    stepLabel,
    6,
    r({ en: 'Wash, dry and fold', es: 'Lave, seque y doble' }),
    `${para(
      s({
        en: 'Complete the normal wash-and-fold process, following the instructions shown on the order page. Before packing, check:',
        es: 'Complete el lavado y doblado normal siguiendo las instrucciones de la pagina del pedido. Antes de empacar, confirme:',
      })
    )}
     ${checks([
       s({ en: 'Washing is complete', es: 'El lavado esta completo' }),
       s({ en: 'Drying is complete', es: 'El secado esta completo' }),
       s({ en: 'Folding is complete', es: 'El doblado esta completo' }),
       s({
         en: 'Every portion of the order is accounted for',
         es: 'Todas las partes del pedido estan completas',
       }),
       s({
         en: 'No laundry from another LYNDRY order has been mixed in',
         es: 'No se mezclo ropa de otro pedido de LYNDRY',
       }),
     ])}`
  )}

  ${step(
    stepLabel,
    7,
    r({ en: 'Pack the finished laundry', es: 'Empaque la ropa terminada' }),
    `${para(
      s({
        en: 'Pack the clean laundry into finished bags. The number of finished bags does not have to match the number that arrived: one bag in can be two or three bags out.',
        es: 'Empaque la ropa limpia en bolsas terminadas. El numero de bolsas terminadas no tiene que ser igual al que llego: una bolsa que llega puede salir como dos o tres.',
      })
    )}
     ${para(
       s({
         en: 'If the laundry arrived in a disposable bag, plastic, paper or a trash bag, pack the clean laundry into a LYNDRY bag if you have one, or a clean white laundry bag.',
         es: 'Si la ropa llego en una bolsa desechable, de plastico, de papel o de basura, empaque la ropa limpia en una bolsa de LYNDRY si tiene, o en una bolsa blanca limpia.',
       })
     )}
     ${callout(
       s({
         en: 'Never pack clean laundry back into the disposable bag it arrived in.',
         es: 'Nunca ponga la ropa limpia otra vez en la bolsa desechable en que llego.',
       }),
       'stain'
     )}`
  )}

  ${step(
    stepLabel,
    8,
    r({
      en: 'Put a sticker on every finished bag',
      es: 'Ponga una calcomania en cada bolsa terminada',
    }),
    `${para(
      s({
        en: 'Every finished bag needs one LYNDRY sticker. One finished bag is one sticker, two bags is two stickers, and so on.',
        es: 'Cada bolsa terminada necesita una calcomania de LYNDRY. Una bolsa es una calcomania, dos bolsas son dos calcomanias, y asi.',
      })
    )}
     ${para(
       s({
         en: 'The sticker tells LYNDRY which order that bag belongs to. Do not:',
         es: 'La calcomania le dice a LYNDRY a que pedido pertenece la bolsa. No:',
       })
     )}
     ${list([
       s({
         en: 'Leave a finished bag without a sticker',
         es: 'Deje una bolsa terminada sin calcomania',
       }),
       s({
         en: 'Mix two LYNDRY orders in one finished bag',
         es: 'Mezcle dos pedidos de LYNDRY en una bolsa',
       }),
       s({ en: 'Throw away unused stickers', es: 'Tire las calcomanias que no use' }),
       s({
         en: 'Assume the driver will know which bags belong together',
         es: 'Suponga que el conductor sabra cuales bolsas van juntas',
       }),
     ])}`
  )}

  ${step(
    stepLabel,
    9,
    r({
      en: 'Select only the stickers you used',
      es: 'Seleccione solo las calcomanias que uso',
    }),
    `${para(
      s({
        en: 'Go back to the order page. It lists the sticker numbers on that tag, for example:',
        es: 'Vuelva a la pagina del pedido. Ahi aparecen los numeros de las calcomanias de esa etiqueta, por ejemplo:',
      })
    )}
     ${para(
       `<span style="font-family:var(--font-mono);">${exampleCodes.map(esc).join('<br>')}</span>`
     )}
     ${para(
       s({
         en: 'Tap only the sticker numbers actually attached to finished bags.',
         es: 'Toque solo los numeros de las calcomanias que estan pegadas en bolsas terminadas.',
       })
     )}
     ${callout(
       s({
         en: 'The number of stickers you select tells the driver how many finished bags to collect. Tapped one by mistake? Tap it again to turn it off.',
         es: 'El numero de calcomanias que seleccione le dice al conductor cuantas bolsas debe recoger. Si toca una por error, toquela otra vez para quitarla.',
       })
     )}
     ${checks([
       s({ en: 'Every finished bag has a sticker', es: 'Cada bolsa terminada tiene calcomania' }),
       s({
         en: 'Every sticker on a finished bag is selected on the phone',
         es: 'Cada calcomania pegada esta seleccionada en el telefono',
       }),
       s({
         en: 'No unused sticker is selected',
         es: 'Ninguna calcomania sin usar esta seleccionada',
       }),
       s({
         en: 'Stickers selected = finished bags',
         es: 'Calcomanias seleccionadas = bolsas terminadas',
       }),
     ])}`
  )}

  ${step(
    stepLabel,
    10,
    r({ en: 'Tap ready for collection', es: 'Toque listo para recoger' }),
    `${para(s({ en: 'Only once all of this is true:', es: 'Solo cuando todo esto sea cierto:' }))}
     ${checks([
       s({
         en: 'Washing, drying and folding are complete',
         es: 'El lavado, el secado y el doblado estan completos',
       }),
       s({
         en: 'Every part of the order is accounted for',
         es: 'Todas las partes del pedido estan completas',
       }),
       s({ en: 'The laundry is packed correctly', es: 'La ropa esta empacada correctamente' }),
       s({ en: 'Every finished bag has a sticker', es: 'Cada bolsa terminada tiene calcomania' }),
       s({
         en: 'Only the stickers actually used are selected',
         es: 'Solo estan seleccionadas las calcomanias que uso',
       }),
     ])}
     ${para(
       r({
         en: 'The phone will say <strong>thanks, we are on our way</strong>. That means LYNDRY knows the order is finished and ready to collect.',
         es: 'El telefono dira <strong>gracias, vamos en camino</strong>. Eso significa que LYNDRY ya sabe que el pedido esta listo para recoger.',
       })
     )}`
  )}

  ${step(
    stepLabel,
    11,
    r({ en: 'Put the order in the pickup area', es: 'Ponga el pedido en el area de recoleccion' }),
    `${list([
      s({
        en: 'Keep all the finished bags for one order together.',
        es: 'Mantenga juntas todas las bolsas terminadas de un mismo pedido.',
      }),
      s({
        en: 'Put them in the LYNDRY pickup area or shelf.',
        es: 'Pongalas en el area o el estante de LYNDRY.',
      }),
      s({
        en: 'Make sure every bag has its sticker clearly attached.',
        es: 'Asegurese de que cada bolsa tenga su calcomania bien pegada.',
      }),
    ])}
     ${para(
       s({
         en: 'The driver uses the stickers selected in the system to know how many bags should be waiting. Two stickers selected means two finished bags waiting.',
         es: 'El conductor usa las calcomanias seleccionadas en el sistema para saber cuantas bolsas debe haber. Dos calcomanias seleccionadas significa dos bolsas esperando.',
       })
     )}`
  )}

  <section class="card" style="padding:24px;margin-bottom:16px;">
    <h2 style="font-family:var(--font-display);font-weight:800;font-size:22px;line-height:1.2;margin:0 0 12px;">
      ${s({ en: 'If something is wrong', es: 'Si algo esta mal' })}
    </h2>
    ${para(
      s({
        en: 'If the QR code will not open the order, the page is blank, the tag appears dead, or the order information is missing, do not guess and do not begin processing.',
        es: 'Si el codigo QR no abre el pedido, la pagina sale en blanco, la etiqueta no funciona o falta informacion, no adivine y no empiece a procesar.',
      })
    )}
    ${para(
      r({
        en: `Call LYNDRY on <strong>${esc(site.callPhoneDisplay)}</strong>.`,
        es: `Llame a LYNDRY al <strong>${esc(site.callPhoneDisplay)}</strong>.`,
      })
    )}
  </section>

  <section class="card" style="padding:24px;margin-bottom:16px;">
    <h2 style="font-family:var(--font-display);font-weight:800;font-size:22px;line-height:1.2;margin:0 0 12px;">
      ${s({ en: 'Four rules to remember', es: 'Cuatro reglas para recordar' })}
    </h2>
    ${list([
      s({ en: 'Never mix LYNDRY orders.', es: 'Nunca mezcle pedidos de LYNDRY.' }),
      s({
        en: 'Never send out a finished bag without a sticker.',
        es: 'Nunca entregue una bolsa terminada sin calcomania.',
      }),
      s({
        en: 'Never put clean laundry back into the disposable bag it arrived in.',
        es: 'Nunca ponga la ropa limpia en la bolsa desechable en que llego.',
      }),
      s({
        en: 'Stickers selected must equal finished bags.',
        es: 'Las calcomanias seleccionadas deben ser igual a las bolsas terminadas.',
      }),
    ])}
    ${callout(
      r({
        en: `LYNDRY guarantees ${esc(
          turnaround
        )} delivery. Mark each order ready for collection as soon as it is finished, packed and labelled.`,
        es: `LYNDRY garantiza entrega ${esc(
          turnaround
        )}. Marque cada pedido como listo para recoger en cuanto este terminado, empacado y con sus calcomanias.`,
      })
    )}
  </section>`;
}

module.exports = { processingGuideBody, TURNAROUND_ES };
