'use strict';
const {escapeHtml:e}=require('./layout');
function render(number,groups) {
 if(!groups?.length)return '';
 return '<section class="order-photo-section" aria-label="Order photos"><h2>Order photos</h2><p class="hint">Select a photo to open it full size.</p><div class="order-photo-gallery">'+groups.map(group=>{
  const images=Array.from({length:group.count},(_,i)=>{
   const url='/ops/orders/'+encodeURIComponent(number)+'/photos/'+encodeURIComponent(group.leg)+'/'+i;
   return '<a class="order-photo-link" href="'+url+'" target="_blank" rel="noopener noreferrer" aria-label="Open '+e(group.title)+' photo '+(i+1)+' full size"><img src="'+url+'" alt="'+e(group.title)+' photo '+(i+1)+'" loading="lazy" decoding="async"><span>View photo'+(group.count>1?' '+(i+1):'')+' <span aria-hidden="true">↗</span></span></a>';
  }).join('');
  const empty={missing:'No photo recorded.',unavailable:'Photos temporarily unavailable. Refresh to try again.',unverified:'These photos could not be verified for this order.'}[group.state]||'No photo recorded.';
  return '<section class="order-photo-stage"><h3>'+e(group.title)+'</h3><p class="hint">'+e(group.description)+'</p>'+(images||'<p class="order-photo-empty">'+e(empty)+'</p>')+'</section>';
 }).join('')+'</div></section>';
}
module.exports={render};
