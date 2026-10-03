 'use strict';
const {escapeHtml:e}=require('./layout');
function render({order,can,editHtml='',cancellationHtml='',deliveryHtml=''}) {
 const n=e(order.order_number);
 const closed=['DELIVERED','CANCELED'].includes(order.status);
 const actions=[],dialogs=[];
 function action(label,id,body,reason,danger=false){
  if(body){
   actions.push(`<button type="button" class="cbtn${danger?' danger':''}" commandfor="${id}" command="show-modal">${label}</button>`);
   dialogs.push(`<dialog class="order-action-dialog" id="${id}" aria-label="${label}"><form method="dialog" class="order-dialog-close"><button class="cbtn">Close</button></form><h2>${label}</h2>${body}</dialog>`);
  }else if(['update-order-dialog','cancel-pickup-dialog'].includes(id)) actions.push(`<button class="cbtn" type="button" disabled title="${e(reason)}">${label}</button>`);
  else actions.push(`<div class="order-action-unavailable"><button class="cbtn" type="button" disabled aria-describedby="${id}-reason">${label}</button><span id="${id}-reason">${e(reason)}</span></div>`);
 }
 if(can.override){
  if(order.dev_quote_id){
   action('Sync with Shipday','sync-status-dialog','<p>Verify the linked return delivery against Shipday. A completed trip with proof can close this order. This does not retry payment or resend a customer message.</p><form method="post" action="/ops/orders/'+n+'/recovery/sync"><button class="cbtn primary">Check delivery status</button></form>','');
   if(order.status==='OUT_FOR_DELIVERY')deliveryHtml='<p>Administrator recovery for laundry already received by the customer. This changes the LYNDRY record only; it does not complete a Shipday job, charge a card or send a text.</p><form class="ops-form-stack" method="post" action="/ops/orders/'+n+'/recovery/deliver" enctype="multipart/form-data"><label>Reason for correction<textarea name="reason" minlength="10" maxlength="1000" required></textarea></label><label><input name="confirmed" type="checkbox" value="yes" required> I confirm the customer has received the laundry.</label><button class="cbtn primary">Confirm delivered</button></form>';
   action('Add internal note','order-note-dialog','<form class="ops-form-stack" method="post" action="/ops/orders/'+n+'/recovery/note"><label>Internal note<textarea name="reason" minlength="3" maxlength="1000" required></textarea></label><button class="cbtn primary">Save note</button></form>','');
   actions.push('<a class="cbtn" href="/ops/shipday/assignments">Manage delivery</a>');
  }

  action('Update order','update-order-dialog',editHtml,closed?'This order is closed.':'Details can only change before collection and payment.');
  action('Cancel order','cancel-pickup-dialog',cancellationHtml,closed?'This order is closed.':'Already collected. Finish the return before closing the order.',true);
 }
 if(can.act||can.override)action('Mark delivered','deliver-order-dialog',deliveryHtml,closed?'This order is closed.':'Available when delivery is the next step and payment is settled or waived. A reason and receipt confirmation are required.');
 return actions.length?'<section class="order-header-actions" aria-label="Order actions">'+actions.join('')+'</section>'+dialogs.join(''):'';
}
module.exports={render};
