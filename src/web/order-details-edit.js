'use strict';
const {escapeHtml:e}=require('./layout');
const wash=require('../core/wash');
function editor(order,customer){
 const c=require('../core/order-address').customerFor(order,customer),prefs=order.preferences||customer.preferences||{};
 const input=(name,label,value,type='text',max=200)=>'<label>'+label+'<input class="input" name="'+name+'" type="'+type+'" value="'+e(value||'')+'" maxlength="'+max+'" '+(name==='address_line2'?'':'required')+'></label>';
 const service=order.pricing_snapshot?.category==='SUBSCRIPTION'?'SUBSCRIPTION':'ONE_TIME';
 return '<details class="card" style="padding:16px;margin-top:16px"><summary>Edit order details</summary><form method="post" action="/ops/orders/'+e(order.order_number)+'/details" class="ops-form-stack">'+
 '<input type="hidden" name="expected" value="'+e(JSON.stringify(require('../core/order-details-edit').expectedFor(order)))+'">'+
 input('address_line1','Street address',c.address_line1)+input('address_line2','Apartment / unit',c.address_line2)+input('city','Town',c.city)+input('state','State',c.state||'NJ','text',2)+input('postal_code','ZIP code',c.postal_code,'text',5)+
 input('pickup_date','Pickup date',order.pickup_date,'date')+input('pickup_time','Pickup time (Eastern)',String(order.pickup_time||'').slice(0,5),'time')+input('dropoff_spot','Pickup location',prefs.dropoff_spot||prefs.special_instructions||'Front door','text',300)+
 '<label>Service for this order<select name="service"><option value="ONE_TIME" '+(service==='ONE_TIME'?'selected':'')+'>One-time pickup</option><option value="SUBSCRIPTION" '+(service==='SUBSCRIPTION'?'selected':'')+'>Subscription pricing</option></select></label><p class="hint">Applies to this order only; does not create or cancel recurring pickups. Wholesale customers keep their wholesale rate.</p>'+
 wash.KEYS.map(key=>'<label>'+e(wash.OPTIONS[key].label)+'<select name="'+key+'">'+wash.OPTIONS[key].choices.map(choice=>'<option value="'+choice.value+'" '+((prefs[key]||wash.OPTIONS[key].default)===choice.value?'selected':'')+'>'+e(choice.label)+'</option>').join('')+'</select></label>').join('')+
 '<p>Detergent: Standard. Changes apply only to this pickup. Coverage, laundromat hours and pricing are checked before saving. Existing courier jobs must be resolved before editing.</p><button class="btn btn-primary" type="submit">Save order details and refresh price</button></form></details>';
}
module.exports={editor};
