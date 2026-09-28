'use strict';
const { escapeHtml: e } = require('./layout');
const { page } = require('./shop-page');
const { opsNote } = require('./ops-shell');
const { translator } = require('./laundromat-es');
const { validIntake } = require('../core/partner-intake');
const { posIcon } = require('./pos-layout');
const labels = {
  INCOMING: ['Incoming deliveries', 'Entregas por llegar'],
  WASH: ['Ready to wash', 'Lista para lavar'],
  READY: ['Ready to return', 'Lista para devolver'],
};
const messages = {
  return_requested: ['Return driver requested. Track collection below.', 'Conductor solicitado. Consulte la recogida abajo.'],
  return_pending: ['Laundry is ready, but the driver request needs attention. Refresh or contact LYNDRY.', 'La ropa esta lista, pero la solicitud necesita atencion. Actualice o contacte a LYNDRY.'],
  return_not_collected: ['Shipday has not confirmed pickup by the assigned return driver yet. Refresh before confirming.', 'Shipday aun no confirma la recogida por el conductor asignado. Actualice antes de confirmar.'],
  collected: ['Pickup confirmed. This order is now out for delivery.', 'Recogida confirmada. El pedido esta en reparto.'],
  delivery_future: ['This pickup is scheduled for a future day. Delivery cannot be accepted yet.', 'La recogida esta programada para otro dia. Aun no puede aceptar la entrega.'],
  delivery_not_collected: ['Waiting for Shipday to confirm collection. Assignment or a driver heading to pickup is not enough.', 'Esperando que Shipday confirme la recogida. La asignacion del conductor no basta.'],
  delivery_mismatch: ['The Shipday delivery does not match this order and laundromat. Contact LYNDRY.', 'La entrega de Shipday no coincide con este pedido y lavanderia. Contacte a LYNDRY.'],
  delivery_unverified: ['Delivery cannot be verified with Shipday right now. Refresh to check again or contact LYNDRY.', 'No se puede verificar la entrega con Shipday. Actualice o contacte a LYNDRY.'],
  intake: ['Intake saved. Your wash instructions are below.', 'Registro guardado. Las instrucciones aparecen abajo.'],
  ready: ['Marked ready. LYNDRY will arrange the return collection.', 'Marcado como listo. LYNDRY organizara la recogida.'],
  office_review: ['Your intake is saved. Contact LYNDRY before releasing this order.', 'Su registro esta guardado. Contacte a LYNDRY antes de entregar este pedido.'],
  invalid_intake: ['Enter the full-order weight, greater than 0 and no more than 50 lb, with at most two decimal places.', 'Escriba el peso total mayor que 0 y hasta 50 lb, con dos decimales como maximo.'],
  already_saved: ['Intake is already saved. Contact LYNDRY to correct the weight.', 'El registro ya esta guardado. Contacte a LYNDRY para corregirlo.'],
  receive_first: ['Refresh to verify this delivery before intake.', 'Actualice para verificar esta entrega.'],
  intake_first: ['Save the full-order weight first.', 'Guarde primero el peso total.'],
  unassigned: ['The delivery assignment has changed. Contact LYNDRY to identify this order.', 'La asignacion cambio. Contacte a LYNDRY para identificar el pedido.'],
  unavailable: ['This order is no longer available for that action.', 'Esa accion ya no esta disponible.'],
  busy: ['This order is being saved. Refresh before trying again.', 'Se esta guardando el pedido. Actualice antes de intentar de nuevo.'],
};
const say = (lang, en, es) => lang === 'es' ? es : en;
const label = (lang, stage) => labels[stage][lang === 'es' ? 1 : 0];
function shell(ctx, title, body) {
  const notice = ctx.order?.officeReview ? 'office_review' : ctx.notice;
  const validNotice = notice === 'accept' ? false : notice === 'intake' ? ['WASH','READY'].includes(ctx.order?.stage) : notice === 'ready' ? ctx.order?.stage === 'READY' : true;
  const message = validNotice ? messages[notice] : null;
  const adminNote = ctx.portalAdmin ? opsNote({label:say(ctx.lang,'Administrator access','Acceso de administrador'),
    title:e(ctx.portalAdmin.name)+' · '+e(ctx.shop.name),
    body:say(ctx.lang,'Actions are recorded under your LYNDRY admin account.','Las acciones se registran con su cuenta de administrador.'),
    // The portal has no navigation back into POS, even for LYNDRY admins.
}) : '';
  return page({ ...ctx, signedIn: true, active: '/shop', showProcessingGuide: false, title, body: `<div class="shop-intake">${body}</div>`,
    notes: [adminNote, message ? opsNote({ tone: ['accept','intake','ready','return_requested','collected'].includes(notice) ? 'good' : 'bad', title: e(message[ctx.lang === 'es' ? 1 : 0]) }) : ''].filter(Boolean) });
}
const {phone} = require('../providers/couriers/shipday-tracking');
const statusNames = {
  NOT_ASSIGNED:['Awaiting driver','Esperando conductor'], NOT_ACCEPTED:['Driver assigned','Conductor asignado'],
  NOT_STARTED_YET:['Driver assigned','Conductor asignado'], STARTED:['Heading to pickup','Camino a recoger'],
  PICKED_UP:['On the way','En camino'], READY_TO_DELIVER:['On the way','En camino'],
  ALREADY_DELIVERED:['Delivered','Entregado'], INCOMPLETE:['Needs attention','Necesita atencion'],
  FAILED_DELIVERY:['Delivery failed','Entrega fallida'], CANCELLED:['Canceled','Cancelado'], CANCELED:['Canceled','Cancelado'],
};
function deliveryStatus(o,lang) {
  if(o.stage==='READY' && o.canCollect)return say(lang,'Picked up · Confirm handoff','Recogido · Confirme entrega');
  if(o.deliveryReason==='return_unassigned')return say(lang,'Awaiting return driver','Esperando conductor de vuelta');
  if(o.deliveryReason==='delivery_mismatch')return say(lang,'Delivery mismatch','Entrega no coincide');
  if(o.deliveryReason==='delivery_unverified')return say(lang,'Status unavailable','Estado no disponible');
  if(o.deliveryReason==='delivery_future')return say(lang,'Scheduled','Programado');
  return (statusNames[o.deliveryStatus]||[say(lang,'Awaiting confirmation','Esperando confirmacion')])[lang==='es'?1:0] || say(lang,'Awaiting confirmation','Esperando confirmacion');
}
function driver(o,lang) {
  const contact=phone(o.driverPhone);
  return `<strong>${e(o.driver||say(lang,'Not assigned','Sin asignar'))}</strong>${contact?`<a class="shop-driver-call" href="tel:${e(contact)}">${e(say(lang,'Call driver','Llamar al conductor'))}</a>`:''}`;
}
function eta(o,lang) {
  if(o.stage==='READY') {
    if(o.canCollect)return say(lang,'Collected','Recogido');
    if(o.etaMinutes!=null && Number.isFinite(o.etaMinutes) && o.etaMinutes>=0)return Math.ceil(o.etaMinutes)+' min';
    return say(lang,'Unavailable','No disponible');
  }
  if(['delivery_unverified','delivery_mismatch'].includes(o.deliveryReason))return say(lang,'Unavailable','No disponible');
  if(o.deliveryStatus==='ALREADY_DELIVERED')return say(lang,'Arrived','Llego');
  if(!o.canAccept || !['PICKED_UP','READY_TO_DELIVER'].includes(o.deliveryStatus))return say(lang,'Awaiting pickup','Esperando recogida');
  if(typeof o.etaMinutes==='number' && Number.isFinite(o.etaMinutes) && o.etaMinutes>=0)return o.etaMinutes===0?say(lang,'Arriving now','Llegando ahora'):Math.ceil(o.etaMinutes)+' min';
  return say(lang,'Unavailable','No disponible');
}
function courier(o,lang) {
  return `<div class="shop-courier"><span class="shop-icon">${posIcon('delivery')}</span><div>${driver(o,lang)}<p>${e(deliveryStatus(o,lang))}</p></div></div><p class="shop-reference">${e(o.reference)}</p>`;
}
const stageIcon={INCOMING:'delivery',WASH:'tools',READY:'delivery'};
const badge=(lang,stage)=>`<span class="shop-status shop-status--${stage.toLowerCase()}">${e(label(lang,stage))}</span>`;
function boardUrl(lang,stage='',query='') {
  const params=new URLSearchParams({lang});if(stage)params.set('stage',stage);if(query)params.set('q',query);return '/shop?'+params;
}
function board(ctx) {
  const {lang,orders}=ctx,query=ctx.query||'',stage=ctx.stage||'';
  const counts=Object.fromEntries(Object.keys(labels).map(s=>[s,orders.filter(o=>o.stage===s).length]));
  const matching=orders.filter(o=>!query||String(o.number).includes(query.replace(/^#/,'')));
  const stats=Object.keys(labels).map(s=>`<a class="card shop-stat" href="#section-${s.toLowerCase()}"><span class="shop-stat-icon shop-status--${s.toLowerCase()}">${posIcon(stageIcon[s])}</span><span class="shop-stat-label">${e(label(lang,s))}</span><strong>${counts[s]}</strong><span class="shop-stat-arrow" aria-hidden="true">↓</span></a>`).join('');
  function section(s) {
    const list=matching.filter(o=>o.stage===s);
    const heading=s==='INCOMING'?[say(lang,'Order','Pedido'),say(lang,'Driver','Conductor'),say(lang,'Status','Estado'),'ETA',say(lang,'Action','Accion')]:s==='WASH'?[say(lang,'Order','Pedido'),say(lang,'Weight','Peso'),say(lang,'Status','Estado'),say(lang,'Action','Accion')]:[say(lang,'Order','Pedido'),say(lang,'Weight','Peso'),say(lang,'Driver','Conductor'),say(lang,'Collection status','Estado de recogida'),say(lang,'Pickup ETA','ETA de recogida'),say(lang,'Action','Accion')];
    const rows=list.map(o=>{
      const href=`/shop/orders/${o.number}?lang=${lang}`;
      const identity=`<th scope="row"><a href="${href}">#${o.number}</a>${o.officeReview?`<small class="shop-review-flag">${e(say(lang,'Contact LYNDRY','Contacte a LYNDRY'))}</small>`:''}</th>`;
      const weight=`<td>${o.weight?e(o.weight)+' lb':'—'}</td>`;
      const link=(text)=>`<a id="order-action-${o.number}" class="btn btn-outline" href="${href}">${e(text)}</a>`;
      if(s==='INCOMING')return `<tr>${identity}<td>${driver(o,lang)}</td><td><span class="shop-delivery-status">${e(deliveryStatus(o,lang))}</span>${o.deliveryStatus==='ALREADY_DELIVERED'?`<small>${e(say(lang,'Awaiting intake','Pendiente de registro'))}</small>`:''}${o.deliveryPhotoCount?`<a href="${href}#delivery-photo">${e(say(lang,'View delivery photo','Ver foto de entrega'))}</a>`:''}</td><td><strong data-live-eta>${e(eta(o,lang))}</strong>${o.checkedAt?`<small>${e(say(lang,'Checked','Actualizado'))} ${e(new Date(o.checkedAt).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}))}</small>`:''}</td><td>${o.canAccept?`<a id="order-action-${o.number}" data-intake-link class="btn btn-primary" href="${href}">${e(say(lang,'Intake','Registrar'))}</a>`:`<button class="btn btn-outline" disabled>${e(say(lang,'Intake','Registrar'))}</button><small><a href="${href}">${e(say(lang,'View status','Ver estado'))}</a></small>`}</td></tr>`;
      if(s==='WASH')return `<tr>${identity}${weight}<td>${badge(lang,s)}</td><td>${link(say(lang,'View wash instructions','Ver instrucciones de lavado'))}</td></tr>`;
      return `<tr>${identity}${weight}<td>${driver(o,lang)}</td><td>${e(o.deliveryStatus?deliveryStatus(o,lang):say(lang,'Awaiting return driver','Esperando conductor de vuelta'))}</td><td><strong data-live-eta>${e(eta(o,lang))}</strong></td><td>${link(o.canCollect?say(lang,'Confirm pickup','Confirmar recogida'):say(lang,'View collection','Ver recogida'))}</td></tr>`;
    }).join('');
    return `<section id="section-${s.toLowerCase()}" class="card shop-orders-panel shop-delivery-section"><div class="shop-panel-heading"><div><h2>${e(label(lang,s))} <span class="shop-section-count">${list.length}</span></h2><p>${e(s==='INCOMING'?say(lang,'Match the arriving order, then weigh and intake the laundry.','Identifique el pedido, pese y registre la ropa.'):s==='WASH'?say(lang,'Open the wash instructions. Mark ready when washing and packing are finished.','Abra las instrucciones. Marque listo al terminar de lavar y empacar.'):say(lang,'Keep each order ready until its return driver collects it.','Guarde cada pedido hasta que llegue su conductor.'))}</p></div></div><div class="shop-delivery-scroll"><table class="shop-delivery-table"><thead><tr>${heading.map(h=>`<th scope="col">${e(h)}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td class="shop-section-empty" colspan="${heading.length}">${e(say(lang,'No orders in this section','No hay pedidos en esta seccion'))}</td></tr>`}</tbody></table></div></section>`;
  }
  const time=new Date().toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',second:'2-digit'});
  return shell({...ctx,here:boardUrl(lang,stage,query)},say(lang,'Laundry board','Panel de pedidos'),`<header class="shop-workspace-heading"><div><p class="eyebrow">${e(ctx.shop.name)}</p><h1>${e(say(lang,'Laundry board','Panel de pedidos'))}</h1><p>${e(say(lang,'Receive. Wash. Return.','Recibir. Lavar. Devolver.'))}</p></div><a class="btn btn-outline" href="${e(boardUrl(lang,stage,query))}">${e(say(lang,'Refresh orders','Actualizar pedidos'))}</a></header>
    <div class="shop-board-toolbar"><p id="shop-sync-note" role="status" data-updated="${e(say(lang,'Updated','Actualizado'))}" data-unavailable="${e(say(lang,'Unavailable','No disponible'))}" data-failed="${e(say(lang,'Updates unavailable. Displayed details may be out of date. Refresh or sign in again.','No hay actualizaciones. Los datos pueden estar desactualizados. Actualice o inicie sesion.'))}">${e(say(lang,'Updates every 30 seconds','Actualiza cada 30 segundos'))} · ${e(time)}</p><form class="shop-search" method="get" action="/shop"><input type="hidden" name="lang" value="${lang}"><label class="shop-sr-only" for="order-search">${e(say(lang,'Search order','Buscar pedido'))}</label><input id="order-search" name="q" type="search" maxlength="64" value="${e(query)}" placeholder="${e(say(lang,'LYNDRY order #','Numero de pedido'))}"><button class="btn btn-outline" type="submit">${e(say(lang,'Search','Buscar'))}</button></form></div>
    <div id="shop-board-live"><section class="shop-stats shop-stats-three" aria-label="${e(say(lang,'Order overview','Resumen de pedidos'))}">${stats}</section>${Object.keys(labels).map(section).join('')}</div>${require('./shop-board-refresh').script}`);
}
function deliveryProof(o,lang) {
  const count=Number.isInteger(o.deliveryPhotoCount) ? Math.min(20,Math.max(0,o.deliveryPhotoCount)) : 0;
  const photos=Array.from({length:count},(_,i)=>{
    const url='/shop/orders/'+o.number+'/delivery-photos/'+i;
    const alt=say(lang,'Delivery photo','Foto de entrega')+' '+(i+1)+' · LYNDRY #'+o.number;
    return '<figure><a href="'+e(url)+'" target="_blank" rel="noopener" aria-label="'+e(alt)+'"><img src="'+e(url)+'" alt="'+e(alt)+'" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.parentElement.nextElementSibling.hidden=false"><span>'+e(say(lang,'View full-size photo','Ver foto completa'))+'</span></a><p hidden>'+e(say(lang,'Photo unavailable. Refresh to try again.','Foto no disponible. Actualice para intentar de nuevo.'))+'</p></figure>';
  }).join('');
  const empty=o.deliveryPhotoUnavailable?say(lang,'Delivery photo unavailable. Refresh to try again.','Foto de entrega no disponible. Actualice para intentar de nuevo.'):say(lang,'No delivery photo has been received from Shipday yet.','Aun no se ha recibido una foto de entrega de Shipday.');
  return '<section class="card shop-delivery-proof" id="delivery-photo"><h2>'+e(say(lang,'Delivery photo','Foto de entrega'))+'</h2><p>'+e(say(lang,'Original bags delivered to this laundromat. Match them to this order at intake and collection.','Bolsas originales entregadas a esta lavanderia. Verifique el pedido al recibir y devolver.'))+'</p>'+(photos||'<p class="muted">'+e(empty)+'</p>')+'</section>';
}
function detail(ctx) {
  const {order:o,lang}=ctx;
  const form=(action,contents)=>`<form method="post" action="/shop/orders/${o.number}/${action}" class="stack"><input type="hidden" name="csrf" value="${e(ctx.csrf)}"><input type="hidden" name="lang" value="${lang}">${contents}</form>`;
  const button=text=>`<button class="btn btn-primary btn-lg btn-full" type="submit">${e(text)}</button>`;
  let content;
  if(o.stage==='INCOMING') {
    content=`<h2>${e(say(lang,'Intake laundry','Registrar ropa'))}</h2>${courier(o,lang)}<p>${e(say(lang,'Check the delivery photo and weigh all of this order’s laundry together.','Revise la foto de entrega y pese toda la ropa del pedido junta.'))}</p>`;
    if(o.canAccept)content+=form('intake',`<div class="field"><label class="field-label" for="weight_lb">${e(say(lang,'Full-order weight (lb)','Peso total (lb)'))}</label><input class="input input-lg" id="weight_lb" name="weight_lb" type="number" inputmode="decimal" min="0.01" max="50" step="0.01" required value="${e(ctx.draft?.weight||'')}"></div><p class="shop-field-help">${e(say(lang,'Up to 50 lb. Contact LYNDRY if the full order is heavier.','Hasta 50 lb. Contacte a LYNDRY si el pedido pesa mas.'))}</p>${button(say(lang,'Accept laundry and show wash instructions','Aceptar ropa y ver instrucciones'))}`)+`<p class="muted">${e(say(lang,'Saves receipt and weight together. Wash instructions open after saving.','Guarda la recepcion y el peso juntos. Despues se muestran las instrucciones.'))}</p>`;
    else content+=`<div class="ops-note ops-note--warn" role="status">${e(messages[o.deliveryReason||'delivery_unverified']?.[lang==='es'?1:0]||messages.delivery_unverified[lang==='es'?1:0])}</div><button class="btn btn-primary btn-lg btn-full" disabled>${e(say(lang,'Awaiting confirmed pickup','Esperando recogida confirmada'))}</button><a class="btn btn-outline" href="/shop/orders/${o.number}?lang=${lang}">${e(say(lang,'Refresh delivery status','Actualizar entrega'))}</a>`;
  } else {
    const unlocked=validIntake(String(o.weight)),translate=translator(lang);
    content=`<dl class="shop-intake-facts"><div><dt>${e(say(lang,'Full-order weight','Peso total'))}</dt><dd>${e(o.weight)} lb</dd></div></dl>${unlocked?`<h2>${e(say(lang,'Wash instructions','Instrucciones de lavado'))}</h2><div class="ops-table-wrap"><table class="ops-table"><tbody>${(o.washLines||[]).map(([k,v])=>`<tr><th>${e(translate(k))}</th><td>${e(translate(v))}</td></tr>`).join('')}</tbody></table></div>`:''}`;
    if(o.stage==='WASH'&&unlocked)content+=`<p>${e(say(lang,'When washing and packing are finished, mark ready to return to request your LYNDRY driver.','Al terminar de lavar y empacar, marque listo para solicitar el conductor de LYNDRY.'))}</p>${form('ready',button(say(lang,'Ready to return','Listo para devolver')))}`;
    else {
      content+=`<h2>${e(say(lang,'Return collection','Recogida de vuelta'))}</h2>${o.assigned?courier(o,lang):`<p>${e(say(lang,'No return driver is assigned yet. Keep this order at the laundromat.','Aun no hay conductor asignado. Guarde el pedido en la lavanderia.'))}</p>`}<p>${e(say(lang,'Pickup ETA','ETA de recogida'))}: <strong>${e(eta(o,lang))}</strong></p>`;
      if(o.returnNeedsRequest)content+=form('request-return',button(say(lang,'Request return driver','Solicitar conductor')));
      else if(o.canCollect)content+=`<p>${e(say(lang,'Check the original delivery photo, then confirm the assigned driver collected this order.','Revise la foto original y confirme que el conductor asignado recogio este pedido.'))}</p>${form('collect',button(say(lang,'Confirm picked up','Confirmar recogida')))}`;
      else content+=`<p>${e(say(lang,'Keep the bags here until the assigned driver collects them. Confirmation opens when Shipday records pickup.','Guarde las bolsas hasta que el conductor las recoja. La confirmacion se abre cuando Shipday registra la recogida.'))}</p><button class="btn btn-outline" disabled>${e(say(lang,'Awaiting confirmed pickup','Esperando recogida confirmada'))}</button>`;
      content+=`<a class="btn btn-outline" href="/shop/orders/${o.number}?lang=${lang}">${e(say(lang,'Refresh collection status','Actualizar recogida'))}</a>`;
    }
  }
  const names=[['Intake','Registro'],['Ready to wash','Lista para lavar'],['Ready to return','Lista para devolver']],index=Object.keys(labels).indexOf(o.stage);
  const steps=names.map((n,i)=>`<li class="${i<index?'is-complete':i===index?'is-current':''}"${i===index?' aria-current="step"':''}><span>${i<index?'✓':i+1}</span><div><strong>${e(n[lang==='es'?1:0])}</strong><small>${e(i<index?say(lang,'Complete','Completado'):i===index?say(lang,'Current step','Paso actual'):say(lang,'Next','Siguiente'))}</small></div></li>`).join('');
  return shell({...ctx,here:`/shop/orders/${o.number}`},`LYNDRY #${o.number}`,`<div class="shop-intake-detail"><a class="shop-back" href="/shop?lang=${lang}">&larr; ${e(say(lang,'Laundry board','Panel de pedidos'))}</a><header class="shop-workspace-heading"><div><p class="eyebrow">${e(ctx.shop.name)}</p><h1>LYNDRY #${o.number}</h1></div>${badge(lang,o.stage)}</header><div class="shop-detail-grid"><section class="card shop-intake-panel">${content}</section><aside class="shop-order-sidebar">${deliveryProof(o,lang)}<section class="card"><h2>${e(say(lang,'Order progress','Progreso del pedido'))}</h2><ol class="shop-progress">${steps}</ol></section><section class="card shop-handover"><h2>${e(say(lang,'Match the handover','Verifique la entrega'))}</h2><p class="shop-reference">${e(o.reference)}</p><p>${e(say(lang,'If the laundry or order reference does not match, contact LYNDRY before proceeding.','Si la ropa o referencia no coincide, contacte a LYNDRY antes de continuar.'))}</p><a href="tel:+12017712933">${e(say(lang,'Contact LYNDRY','Contacte a LYNDRY'))} &rarr;</a></section></aside></div></div>`);
}
function missing(ctx){return shell(ctx,'LYNDRY',`<h1>${e(say(ctx.lang,'Order unavailable','Pedido no disponible'))}</h1><a href="/shop">${e(say(ctx.lang,'Back to your orders','Volver a sus pedidos'))}</a>`);}
module.exports={board,detail,missing};
