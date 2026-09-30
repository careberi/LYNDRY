'use strict';
const { escapeHtml: e } = require('./layout');
const { page } = require('./shop-page');
const { opsNote } = require('./ops-shell');
const { translator } = require('./laundromat-es');
const { validIntake } = require('../core/partner-intake');
const { posIcon } = require('./pos-layout');
const { customerText } = require('./customer-copy');
const labels = {
  INCOMING: ['Incoming deliveries', 'Entregas por llegar'],
  WASH: ['Washing', 'En lavado'],
  READY: ['Outgoing deliveries', 'Entregas de salida'],
};
const messages = {
  'wash-complete':['Wash complete. Weigh the full order again to prepare its return.','Lavado completo. Vuelva a pesar el pedido para preparar la devolucion.'],
  wash_complete_first:['Mark the wash complete before entering the return weight.','Marque el lavado completo antes de ingresar el peso de devolucion.'],
  invalid_reference:['Use an optional reference up to 64 characters.','Use una referencia opcional de hasta 64 caracteres.'],
  return_weight_required:['Enter a fresh full-order weight before requesting a return driver.','Ingrese un peso nuevo antes de solicitar al conductor.'],
  return_weight_held:['Return blocked. Keep this order here and contact LYNDRY for a weight review.','Devolucion bloqueada. Guarde el pedido y contacte a LYNDRY para revisar el peso.'],
  return_requested: ['Return driver requested. Track collection below.', 'Conductor solicitado. Consulte la recogida abajo.'],
  return_pending: ['Laundry is ready, but the driver request needs attention. Refresh or contact LYNDRY.', 'La ropa esta lista, pero la solicitud necesita atencion. Actualice o contacte a LYNDRY.'],
  return_not_collected: ['Pickup by the assigned return driver has not been confirmed yet. Refresh before confirming.', 'Aun no se confirma la recogida por el conductor asignado. Actualice antes de confirmar.'],
  collected: ['Pickup confirmed. This order is now in Completed orders.', 'Recogida confirmada. El pedido esta en Pedidos completados.'],
  delivery_future: ['This pickup is scheduled for a future day. Delivery cannot be accepted yet.', 'La recogida esta programada para otro dia. Aun no puede aceptar la entrega.'],
  delivery_not_collected: ['Waiting for pickup confirmation. Assignment or a driver heading to pickup is not enough.', 'Esperando confirmacion de la recogida. La asignacion del conductor no basta.'],
  delivery_mismatch: ['The delivery does not match this order and laundromat. Contact LYNDRY.', 'La entrega no coincide con este pedido y lavanderia. Contacte a LYNDRY.'],
  delivery_unverified: ['Delivery cannot be verified right now. Refresh to check again or contact LYNDRY.', 'No se puede verificar la entrega ahora. Actualice o contacte a LYNDRY.'],
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
  return page({ ...ctx, signedIn: true, active: '/shop', showProcessingGuide: false, title, body: `<div class="shop-intake">${body}</div>`+require('./shop-deadline-clock').script+require('./shop-return-weight').script,
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
  const name = customerText(o.driver, o.assigned ? say(lang,'Assigned driver','Conductor asignado') : say(lang,'Not assigned','Sin asignar'));
  return `<strong>${e(name)}</strong>${contact?`<a class="shop-driver-call" href="tel:${e(contact)}">${e(say(lang,'Call driver','Llamar al conductor'))}</a>`:''}`;
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
function scheduledArrival(o,lang) {
  const value=o.scheduledArrivalAt||o.scheduledPickupAt;
  if(!value||!Number.isFinite(Date.parse(value)))return e(say(lang,'Schedule unavailable','Horario no disponible'));
  const label=o.scheduledArrivalAt?say(lang,'Scheduled arrival','Llegada programada'):say(lang,'Pickup scheduled','Recogida programada');
  return '<small>'+e(label)+'</small><strong>'+e(new Date(value).toLocaleString(lang==='es'?'es-US':'en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}))+'</strong><small>'+e(say(lang,'Eastern time · Live ETA:','Hora del este · ETA en vivo:'))+'</small>';
}
const stageIcon={INCOMING:'delivery',WASH:'tools',READY:'delivery'};
const badge=(lang,stage,washed=false)=>`<span class="shop-status shop-status--${stage.toLowerCase()}">${e(stage==='WASH'&&washed?say(lang,'Wash complete','Lavado completo'):label(lang,stage))}</span>`;
function boardUrl(lang,stage='',query='') {
  const params=new URLSearchParams({lang});if(stage)params.set('stage',stage);if(query)params.set('q',query);return '/shop?'+params;
}

function shopReference(o,lang) {
 return o.shopReference ? '<small class="shop-reference">'+e(say(lang,'Your reference: ','Su referencia: '))+e(o.shopReference)+'</small>' : '';
}
function turnaround(o,lang) {
 const c=require('../core/laundromat-countdown').countdown(o.returnDueAt,Date.now(),lang);
 const due=o.returnDueAt ? new Date(o.returnDueAt).toLocaleString(lang==='es'?'es-US':'en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '';
 return '<span class="shop-turnaround shop-turnaround--'+c.tone+'"'+(due?' data-shop-deadline="'+e(o.returnDueAt)+'" data-lang="'+lang+'"':'')+'>'+e(c.text)+'</span>';
}
function returnWeightField(o,lang) {
 if(!o.weightCheckEnabled || ['PASSED','RELEASED'].includes(o.returnCheckStatus))return '';
 return '<div class="field"><label class="field-label" for="return_weight">'+e(say(lang,'Weigh the full order again (lb)','Vuelva a pesar el pedido completo (lb)'))+'</label><input class="input" id="return_weight" name="weight_lb" type="number" min="0.01" max="50" step="0.01" required autocomplete="off"><p>'+e(say(lang,'Use a fresh scale reading. A difference outside the allowed range holds this order for LYNDRY review.','Use una lectura nueva. Una diferencia fuera del limite retiene el pedido para revision de LYNDRY.'))+'</p></div>';
}

function completedOrders(ctx) {
  const {lang}=ctx,history=ctx.history||{page:1,orders:[],hasNext:false};
  const date=value=>{
    const time=new Date(value);
    return Number.isFinite(time.getTime()) ? time.toLocaleString(lang==='es'?'es-US':'en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : '—';
  };
  const rows=history.orders.map(o=>`<tr><th scope="row">#${e(o.number)}${shopReference(o,lang)}</th><td>${o.weight?e(o.weight)+' lb':'—'}</td><td>${e(date(o.collectedAt))}</td></tr>`).join('');
  const link=(page,text)=>`<a class="btn btn-outline" href="/shop?lang=${lang}&amp;history_page=${page}#section-history">${e(text)}</a>`;
  return `<section id="section-history" class="card shop-orders-panel shop-delivery-section"><div class="shop-panel-heading"><div><h2>${e(say(lang,'Completed orders','Pedidos completados'))}</h2><p>${e(say(lang,'Your finished orders, handed to the return driver. Collection times are Eastern time.','Sus pedidos terminados y entregados al conductor de vuelta. Horas del este.'))}</p></div></div><div class="shop-delivery-scroll"><table class="shop-delivery-table"><thead><tr><th scope="col">${e(say(lang,'Order','Pedido'))}</th><th scope="col">${e(say(lang,'Weight','Peso'))}</th><th scope="col">${e(say(lang,'Collected','Recogido'))}</th></tr></thead><tbody>${rows||`<tr><td colspan="3" class="shop-section-empty">${e(say(lang,'No completed orders yet','Aun no hay pedidos completados'))}</td></tr>`}</tbody></table></div>${history.page>1||history.hasNext?`<nav class="shop-panel-heading" aria-label="${e(say(lang,'Completed order pages','Paginas de pedidos completados'))}">${history.page>1?link(history.page-1,say(lang,'Newer orders','Pedidos mas recientes')):''}<span>${e(say(lang,'Page','Pagina'))} ${history.page}</span>${history.hasNext?link(history.page+1,say(lang,'Older orders','Pedidos anteriores')):''}</nav>`:''}</section>`;
}
function pickupAction(o,ctx) {
  const enabled=o.canCollect===true && !o.officeReview;
  const hint=enabled?say(ctx.lang,'Driver reported pickup. Confirm the handoff.','El conductor informo la recogida. Confirme la entrega.'):
    say(ctx.lang,'Waiting for verified driver pickup.','Esperando la recogida verificada del conductor.');
  return '<form method="post" action="/shop/orders/'+o.number+'/collect"><input type="hidden" name="csrf" value="'+e(ctx.csrf)+'"><input type="hidden" name="lang" value="'+ctx.lang+'"><button id="order-action-'+o.number+'" data-collection-submit class="btn shop-pickup-confirm '+(enabled?'shop-pickup-confirm--needed':'shop-pickup-confirm--waiting')+'" type="submit"'+(enabled?'':' disabled')+'>'+e(say(ctx.lang,'Confirm Pickup','Confirmar recogida'))+'</button><small>'+e(hint)+'</small></form>';
}
function board(ctx) {
  const {lang,orders}=ctx,query=ctx.query||'',stage=ctx.stage||'';
  const counts=Object.fromEntries(Object.keys(labels).map(s=>[s,orders.filter(o=>o.stage===s).length]));
  const matching=orders.filter(o=>!query||String(o.number).includes(query.replace(/^#/,'')));
  const stats=Object.keys(labels).map(s=>`<a class="card shop-stat" href="#section-${s.toLowerCase()}"><span class="shop-stat-icon shop-status--${s.toLowerCase()}">${posIcon(stageIcon[s])}</span><span class="shop-stat-label">${e(label(lang,s))}</span><strong>${counts[s]}</strong><span class="shop-stat-arrow" aria-hidden="true">↓</span></a>`).join('');
  function section(s) {
    const list=matching.filter(o=>o.stage===s);
    const heading=s==='INCOMING'?[say(lang,'Order','Pedido'),say(lang,'Driver','Conductor'),say(lang,'Status','Estado'),say(lang,'Arrival','Llegada'),say(lang,'Action','Accion')]:s==='WASH'?[say(lang,'Order','Pedido'),say(lang,'Time left','Tiempo restante'),say(lang,'Status','Estado'),say(lang,'Action','Accion')]:[say(lang,'Order','Pedido'),say(lang,'Weight','Peso'),say(lang,'Time left','Tiempo restante'),say(lang,'Driver','Conductor'),say(lang,'Collection status','Estado de recogida'),say(lang,'Pickup ETA','ETA de recogida'),say(lang,'Action','Accion')];
    const rows=list.map(o=>{
      const href=`/shop/orders/${o.number}?lang=${lang}`;
      const identity=`<th scope="row"><a href="${href}">#${o.number}</a>${shopReference(o,lang)}${o.officeReview?`<small class="shop-review-flag">${e(say(lang,'Contact LYNDRY','Contacte a LYNDRY'))}</small>`:''}</th>`;
      const weight=`<td>${o.weight?e(o.weight)+' lb':'—'}</td>`;
      const link=(text)=>`<a id="order-action-${o.number}" class="btn btn-outline" href="${href}">${e(text)}</a>`;
      if(s==='INCOMING')return `<tr>${identity}<td>${driver(o,lang)}</td><td><span class="shop-delivery-status">${e(deliveryStatus(o,lang))}</span>${o.deliveryStatus==='ALREADY_DELIVERED'?`<small>${e(say(lang,'Awaiting intake','Pendiente de registro'))}</small>`:''}${o.deliveryPhotoCount?`<a href="${href}#delivery-photo">${e(say(lang,'View delivery photo','Ver foto de entrega'))}</a>`:''}</td><td>${scheduledArrival(o,lang)}<strong data-live-eta>${e(eta(o,lang))}</strong>${o.checkedAt?`<small>${e(say(lang,'Checked','Actualizado'))} ${e(new Date(o.checkedAt).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}))}</small>`:''}</td><td>${o.canAccept?`<a id="order-action-${o.number}" data-intake-link class="btn btn-primary" href="${href}">${e(say(lang,'Intake','Registrar'))}</a>`:`<button class="btn btn-outline" disabled>${e(say(lang,'Intake','Registrar'))}</button><small><a href="${href}">${e(say(lang,'View status','Ver estado'))}</a></small>`}</td></tr>`;
      if(s==='WASH')return `<tr>${identity}<td>${turnaround(o,lang)}</td><td>${badge(lang,s,Boolean(o.washCompletedAt))}</td><td>${link(o.washCompletedAt?say(lang,'Weigh for return','Pesar para devolver'):say(lang,'View wash instructions','Ver instrucciones de lavado'))}</td></tr>`;
      return `<tr>${identity}${weight}<td>${turnaround(o,lang)}</td><td>${driver(o,lang)}</td><td>${e(o.deliveryStatus?deliveryStatus(o,lang):say(lang,'Awaiting return driver','Esperando conductor de vuelta'))}</td><td><strong data-live-eta>${e(eta(o,lang))}</strong></td><td>${pickupAction(o,ctx)}</td></tr>`;
    }).join('');
    return `<section id="section-${s.toLowerCase()}" class="card shop-orders-panel shop-delivery-section"><div class="shop-panel-heading"><div><h2>${e(label(lang,s))} <span class="shop-section-count">${list.length}</span></h2><p>${e(s==='INCOMING'?say(lang,'Match the arriving order, then weigh and intake the laundry.','Identifique el pedido, pese y registre la ropa.'):s==='WASH'?say(lang,'Mark the wash complete, then weigh the full order for outtake.','Marque el lavado completo y pese el pedido para la salida.'):say(lang,'Keep each order ready until its return driver collects it.','Guarde cada pedido hasta que llegue su conductor.'))}</p></div></div><div class="shop-delivery-scroll"><table class="shop-delivery-table"><thead><tr>${heading.map(h=>`<th scope="col">${e(h)}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td class="shop-section-empty" colspan="${heading.length}">${e(say(lang,'No orders in this section','No hay pedidos en esta seccion'))}</td></tr>`}</tbody></table></div></section>`;
  }
  const time=new Date().toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',second:'2-digit'});
  return shell({...ctx,here:boardUrl(lang,stage,query)},say(lang,'Laundry board','Panel de pedidos'),`<header class="shop-workspace-heading"><div><p class="eyebrow">${e(ctx.shop.name)}</p><h1>${e(say(lang,'Laundry board','Panel de pedidos'))}</h1><p>${e(say(lang,'Receive. Wash. Return.','Recibir. Lavar. Devolver.'))}</p></div><a class="btn btn-outline" href="${e(boardUrl(lang,stage,query))}">${e(say(lang,'Refresh orders','Actualizar pedidos'))}</a></header>
    <div class="shop-board-toolbar"><p id="shop-sync-note" role="status" data-updated="${e(say(lang,'Updated','Actualizado'))}" data-unavailable="${e(say(lang,'Unavailable','No disponible'))}" data-failed="${e(say(lang,'Updates unavailable. Displayed details may be out of date. Refresh or sign in again.','No hay actualizaciones. Los datos pueden estar desactualizados. Actualice o inicie sesion.'))}">${e(say(lang,'Updates every 30 seconds','Actualiza cada 30 segundos'))} · ${e(time)}</p><form class="shop-search" method="get" action="/shop"><input type="hidden" name="lang" value="${lang}"><label class="shop-sr-only" for="order-search">${e(say(lang,'Search order','Buscar pedido'))}</label><input id="order-search" name="q" type="search" maxlength="64" value="${e(query)}" placeholder="${e(say(lang,'LYNDRY order #','Numero de pedido'))}"><button class="btn btn-outline" type="submit">${e(say(lang,'Search','Buscar'))}</button></form></div>
    <div id="shop-board-live"><section class="shop-stats shop-stats-three" aria-label="${e(say(lang,'Order overview','Resumen de pedidos'))}">${stats}</section>${Object.keys(labels).map(section).join('')}${completedOrders(ctx)}</div>${require('./shop-board-refresh').script}`);
}
function deliveryProof(o,lang) {
  const count=Number.isInteger(o.deliveryPhotoCount) ? Math.min(20,Math.max(0,o.deliveryPhotoCount)) : 0;
  const photos=Array.from({length:count},(_,i)=>{
    const url='/shop/orders/'+o.number+'/delivery-photos/'+i;
    const alt=say(lang,'Delivery photo','Foto de entrega')+' '+(i+1)+' · LYNDRY #'+o.number;
    return '<figure><a href="'+e(url)+'" target="_blank" rel="noopener" aria-label="'+e(alt)+'"><img src="'+e(url)+'" alt="'+e(alt)+'" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.parentElement.nextElementSibling.hidden=false"><span>'+e(say(lang,'View full-size photo','Ver foto completa'))+'</span></a><p hidden>'+e(say(lang,'Photo unavailable. Refresh to try again.','Foto no disponible. Actualice para intentar de nuevo.'))+'</p></figure>';
  }).join('');
  const empty=o.deliveryPhotoUnavailable?say(lang,'Delivery photo unavailable. Refresh to try again.','Foto de entrega no disponible. Actualice para intentar de nuevo.'):say(lang,'No delivery photo has been received yet.','Aun no se ha recibido una foto de entrega.');
  return '<section class="card shop-delivery-proof" id="delivery-photo"><h2>'+e(say(lang,'Delivery photo','Foto de entrega'))+'</h2><p>'+e(say(lang,'Original bags delivered to this laundromat. Match them to this order at intake and collection.','Bolsas originales entregadas a esta lavanderia. Verifique el pedido al recibir y devolver.'))+'</p>'+(photos||'<p class="muted">'+e(empty)+'</p>')+'</section>';
}
function detail(ctx) {
  const {order:o,lang}=ctx;
  const form=(action,contents)=>`<form method="post" action="/shop/orders/${o.number}/${action}" class="stack"><input type="hidden" name="csrf" value="${e(ctx.csrf)}"><input type="hidden" name="lang" value="${lang}">${contents}</form>`;
  const button=(text,disabled=false)=>`<button class="btn btn-primary btn-lg btn-full" type="submit"${disabled?' disabled data-return-submit':''}>${e(text)}</button>`;
  let content;
  if(o.stage==='INCOMING') {
    content=`<h2>${e(say(lang,'Intake laundry','Registrar ropa'))}</h2>${courier(o,lang)}<p>${e(say(lang,'Check the delivery photo and weigh all of this order’s laundry together.','Revise la foto de entrega y pese toda la ropa del pedido junta.'))}</p>`;
    if(o.canAccept)content+=form('intake',`<div class="field"><label class="field-label" for="shop_reference">${e(say(lang,'Your order reference (optional)','Su referencia (opcional)'))}</label><input class="input" id="shop_reference" name="shop_reference" maxlength="64" value="${e(ctx.draft?.shopReference||'')}"></div><div class="field"><label class="field-label" for="weight_lb">${e(say(lang,'Full-order weight (lb)','Peso total (lb)'))}</label><input class="input input-lg" id="weight_lb" name="weight_lb" type="number" inputmode="decimal" min="0.01" max="50" step="0.01" required value="${e(ctx.draft?.weight||'')}"></div><p class="shop-field-help">${e(say(lang,'Up to 50 lb. Contact LYNDRY if the full order is heavier.','Hasta 50 lb. Contacte a LYNDRY si el pedido pesa mas.'))}</p>${button(say(lang,'Accept laundry and show wash instructions','Aceptar ropa y ver instrucciones'))}`)+`<p class="muted">${e(say(lang,'Saves receipt and weight together. Wash instructions open after saving.','Guarda la recepcion y el peso juntos. Despues se muestran las instrucciones.'))}</p>`;
    else content+=`<div class="ops-note ops-note--warn" role="status">${e(messages[o.deliveryReason||'delivery_unverified']?.[lang==='es'?1:0]||messages.delivery_unverified[lang==='es'?1:0])}</div><button class="btn btn-primary btn-lg btn-full" disabled>${e(say(lang,'Awaiting confirmed pickup','Esperando recogida confirmada'))}</button><a class="btn btn-outline" href="/shop/orders/${o.number}?lang=${lang}">${e(say(lang,'Refresh delivery status','Actualizar entrega'))}</a>`;
  } else {
    const unlocked=o.intakeComplete || validIntake(String(o.weight)),translate=translator(lang);
    content=(o.stage==='READY' && ['PASSED','RELEASED'].includes(o.returnCheckStatus) && o.weight ? `<dl class="shop-intake-facts"><div><dt>${e(say(lang,'Verified return weight','Peso de devolucion verificado'))}</dt><dd>${e(o.weight)} lb</dd></div></dl>`:'')+
      `${unlocked?`<h2>${e(say(lang,'Wash instructions','Instrucciones de lavado'))}</h2><div class="ops-table-wrap"><table class="ops-table"><tbody>${(o.washLines||[]).map(([k,v])=>`<tr><th>${e(translate(k))}</th><td>${e(translate(v))}</td></tr>`).join('')}</tbody></table></div>`:''}`;
    if(o.returnCheckStatus==='HELD') {
      content+=`<p role="alert" class="shop-review-flag">${e(say(lang,'Return is on hold because the weights do not match within the allowed range. Keep this order here until LYNDRY resolves it.','La devolucion esta retenida por una diferencia de peso. Guarde el pedido hasta que LYNDRY lo resuelva.'))}</p>`;
    } else if(unlocked && o.stage==='WASH' && !o.washCompletedAt) {
      content+=`<p>${e(say(lang,'When washing and packing are finished, mark the wash complete. You will weigh the full order again next.','Al terminar de lavar y empacar, marque el lavado completo. Despues volvera a pesar el pedido.'))}</p>${form('wash-complete',button(say(lang,'Mark wash complete','Marcar lavado completo')))}`;
    } else if(unlocked && (o.stage==='WASH' || (o.weightCheckEnabled && !['PASSED','RELEASED'].includes(o.returnCheckStatus)))) {
      const weightField=returnWeightField(o,lang);
      content+=`<p>${e(say(lang,'Wash complete. Confirm the return weight before requesting your driver.','Lavado completo. Confirme el peso antes de solicitar al conductor.'))}</p>${form('ready',weightField+button(say(lang,'Outtake','Salida'),Boolean(weightField)))}`;
    } else {
      content+=`<h2>${e(say(lang,'Return collection','Recogida de vuelta'))}</h2>${o.assigned?courier(o,lang):`<p>${e(say(lang,'No return driver is assigned yet. Keep this order at the laundromat.','Aun no hay conductor asignado. Guarde el pedido en la lavanderia.'))}</p>`}<p>${e(say(lang,'Pickup ETA','ETA de recogida'))}: <strong>${e(eta(o,lang))}</strong></p>`;
      if(o.returnNeedsRequest)content+=form('request-return',button(say(lang,'Request return driver','Solicitar conductor')));
      else if(o.canCollect)content+=`<p>${e(say(lang,'Check the original delivery photo, then confirm the assigned driver collected this order.','Revise la foto original y confirme que el conductor asignado recogio este pedido.'))}</p>${pickupAction(o,ctx)}`;
      else content+=`<p>${e(say(lang,'Keep the bags here until the assigned driver collects them. Confirmation opens when pickup is verified.','Guarde las bolsas hasta que el conductor las recoja. La confirmacion se abre cuando se verifica la recogida.'))}</p><button class="btn btn-outline" disabled>${e(say(lang,'Awaiting confirmed pickup','Esperando recogida confirmada'))}</button>`;
      content+=`<a class="btn btn-outline" href="/shop/orders/${o.number}?lang=${lang}">${e(say(lang,'Refresh collection status','Actualizar recogida'))}</a>`;
    }
  }
  const names=[['Intake','Registro'],['Washing','En lavado'],['Outtake','Salida']],index=o.stage==='INCOMING'?0:o.stage==='READY'?2:1;
  const steps=names.map((n,i)=>`<li class="${i<index?'is-complete':i===index?'is-current':''}"${i===index?' aria-current="step"':''}><span>${i<index?'✓':i+1}</span><div><strong>${e(n[lang==='es'?1:0])}</strong><small>${e(i<index?say(lang,'Complete','Completado'):i===index?say(lang,'Current step','Paso actual'):say(lang,'Next','Siguiente'))}</small></div></li>`).join('');
  return shell({...ctx,here:`/shop/orders/${o.number}`},`LYNDRY #${o.number}`,`<div class="shop-intake-detail"><a class="shop-back" href="/shop?lang=${lang}">&larr; ${e(say(lang,'Laundry board','Panel de pedidos'))}</a><header class="shop-workspace-heading"><div><p class="eyebrow">${e(ctx.shop.name)}</p><h1>LYNDRY #${o.number}</h1>${shopReference(o,lang)}</div>${badge(lang,o.stage,Boolean(o.washCompletedAt))}</header><div class="shop-detail-grid"><section class="card shop-intake-panel">${o.stage!=='INCOMING'?`<div class="shop-deadline-detail">${turnaround(o,lang)}</div>`:''}${content}</section><aside class="shop-order-sidebar">${deliveryProof(o,lang)}<section class="card"><h2>${e(say(lang,'Order progress','Progreso del pedido'))}</h2><ol class="shop-progress">${steps}</ol></section>${o.stage==='INCOMING'?`<section class="card shop-handover"><h2>${e(say(lang,'Match the handover','Verifique la entrega'))}</h2><p class="shop-reference">${e(o.reference)}</p><p>${e(say(lang,'If the laundry or order reference does not match, contact LYNDRY before proceeding.','Si la ropa o referencia no coincide, contacte a LYNDRY antes de continuar.'))}</p><a href="tel:+12017712933">${e(say(lang,'Contact LYNDRY','Contacte a LYNDRY'))} &rarr;</a></section>`:''}</aside></div></div>`);
}
function missing(ctx){return shell(ctx,'LYNDRY',`<h1>${e(say(ctx.lang,'Order unavailable','Pedido no disponible'))}</h1><a href="/shop">${e(say(ctx.lang,'Back to your orders','Volver a sus pedidos'))}</a>`);}
module.exports={board,detail,missing};
