'use strict';

// ---------------------------------------------------------------------------
// THE SPANISH A LAUNDROMAT READS.
//
// One vocabulary for every screen an attendant sees: the bag tag at /o/<code>,
// the portal at /shop, and anything after them. It lived in `routes/bag.js`
// while the bag tag was the only one; the portal then rendered its own chrome in
// Spanish with the WASH INSTRUCTIONS still in English - which is the one part
// she actually acts on, and exactly the failure CLAUDE.md records for the
// processing guide shipping without its own language buttons.
//
// PLAIN ASCII, DELIBERATELY. Sixty entries here have no accents and neither does
// the processing guide. Two conventions on one screen reads as a mistake, and
// these screens sit one tap apart.
//
// A MISSING ENTRY FALLS BACK TO THE ENGLISH, which is the opposite of the rule
// the processing guide follows - there, a missing string renders as `undefined`
// so it is loud. The difference is who writes the string: the guide is a fixed
// document where every line is known in advance, and this translates values that
// come out of the database and the clock, where a new wash option or a partner's
// name has no entry and never will. Visible English is the right failure for
// those; a hole in the page is not.
// ---------------------------------------------------------------------------

const ES = Object.freeze({
  'Bag tag': 'Etiqueta de bolsa',
  // The link under every bag screen. The guide behind it is English only
  // for now - one entry here is not a translated document, and promising
  // one in the label would be worse than the label being plain.
  'Processing Instructions': 'Instrucciones de procesamiento',
  'Processing guide': 'Guia de procesamiento',
  'Order': 'Pedido',
  'Questions about this bag': 'Preguntas sobre esta bolsa',

  // Stages
  'Not on a bag yet': 'Todavia sin bolsa',
  'Being collected': 'En recogida',
  'In the van': 'En la furgoneta',
  'Just arrived': 'Recien llegada',
  'Being washed': 'En lavado',
  'Ready for collection': 'Lista para recoger',
  'Back in the van': 'De vuelta en la furgoneta',
  'Delivered': 'Entregada',

  // Weighing
  'Pounds': 'Libras',
  'Save': 'Guardar',
  'That did not look like a weight. Pounds, as a number.':
    'Eso no parece un peso. Libras, en numero.',

  // Washing
  'Keep the tag with the laundry': 'Deje la etiqueta con la ropa',
  'How to wash it': 'Como lavarla',
  'How everything is sorted': 'Como se separa la ropa',
  'Time to turn it around': 'Tiempo para terminarla',
  // The weight cards, which are the first thing an attendant does.
  'Van clip': 'Pinza de camioneta',
  'With our driver.': 'Con nuestro conductor.',
  'In our van, on its way to be washed.': 'En nuestra camioneta, camino al lavado.',
  'Back in our van, on its way to the customer.': 'De vuelta en nuestra camioneta, camino al cliente.',
  'Delivered. This tag is finished with.': 'Entregada. Esta etiqueta ya termino.',
  'Nothing to do with this one right now.': 'Nada que hacer con esta por ahora.',
  'Weigh it': 'Pesela',
  'The wash instructions appear once the weight is in.':
    'Las instrucciones de lavado aparecen al ingresar el peso.',

  // The card somebody sees when a label is not on a bag. It has its own toggle
  // now, so every line of it has to exist in both languages.
  'Nothing here': 'Nada aqui',
  'Bag label': 'Etiqueta de bolsa',
  "This label isn't in use.": 'Esta etiqueta no esta en uso.',
  'If this label is on a bag, call us at': 'Si esta etiqueta esta en una bolsa, llamenos al',

  'Not picked up yet': 'Aun no recogida',
  'When an order is finished': 'Cuando termine el pedido',
  'Waiting for collection': 'Esperando recogida',
  'Our driver has been told.': 'Nuestro conductor ya lo sabe.',
  'Bags to hand over for this order': 'Bolsas para entregar de este pedido',
  'When the order is finished, tap the stickers you used. A button will then appear to tell us it is ready for collection.':
    'Cuando termine el pedido, toque las pegatinas que uso. Luego aparecera un boton para avisarnos que esta lista para recoger.',
  'Keep the Bag Tag with the laundry through wash and fold. If you split the laundry into multiple loads or bags, place a sticker from the Bag Tag on the in-house receipt for each one.':
    'Mantenga la etiqueta de bolsa con la ropa durante el lavado y el doblado. Si divide la ropa en varias cargas o bolsas, pegue una pegatina de la etiqueta en el recibo interno de cada una.',
  'Tapped one by mistake? Tap it again to turn it off.': 'Toco uno por error? Sigalo tocando.',
  'This order is done': 'Este pedido esta terminado',
  'Not yet - another bag from this order is still open.':
    'Todavia no - otra bolsa de este pedido sigue abierta.',
  'Still waiting on': 'Falta',
  'Weigh every bag first.': 'Pese cada bolsa primero.',
  'Tap a sticker number first.': 'Toque primero el numero de una pegatina.',
  'Only when every bag is packed and done. We will come and collect it.':
    'Solo cuando todas esten empacadas y listas. Pasaremos a recogerlo.',
  'Not in use': 'Sin usar',
  'In use': 'En uso',
  'Done': 'Terminada',

  // Wash fields, so the instructions themselves are readable
  'Detergent': 'Detergente',
  'Fabric softener': 'Suavizante',
  'Water temperature': 'Temperatura del agua',
  'Standard scented': 'Con aroma normal',
  // The detergent line is a STANDARD now, not a choice, so its value is the
  // bare word rather than one of the old option labels.
  'Standard': 'Normal',
  'Free & clear, fragrance-free': 'Sin fragancia',
  'No softener': 'Sin suavizante',
  'Fragrance-free': 'Sin fragancia',
  'Cold': 'Fria',
  'Warm': 'Tibia',
  'Hot': 'Caliente',

  // Sorting standard
  'Sort into whites/lights and colours/darks when practical.':
    'Separe blancos/claros de colores/oscuros cuando sea posible.',
  'Separate obvious delicates, heavily soiled items, and anything needing special care.':
    'Aparte las prendas delicadas, las muy sucias y todo lo que necesite cuidado especial.',
  "Never combine different customers' laundry.":
    'Nunca mezcle la ropa de clientes distintos.',
});

function translator(lang) {
  if (lang !== 'es') return (text) => text;

  return (text) => {
    const exact = ES[text];
    if (exact) return exact;

    // THE COUNTDOWN IS BUILT, NOT WRITTEN, so it can never be in the table:
    // fulfilment.turnaround() composes "1d 8h left" and "40m overdue" out of a
    // number and a word. Only the word needs translating, and doing it here
    // keeps the clock itself in one place rather than teaching fulfilment.js
    // about languages it has no other reason to know about.
    if (/\bleft$/.test(text)) return `quedan ${text.replace(/\s*left$/, '')}`;
    if (/\boverdue$/.test(text)) return `${text.replace(/\s*overdue$/, '')} de retraso`;

    return text;
  };
}

module.exports = { ES, translator };
