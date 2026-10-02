'use strict';
const {escapeHtml}=require('./layout');
module.exports=function deliveryNote(m) {
 if(m.direction!=='OUTBOUND')return '';
 if(m.delivery_error || /fail|undeliver|reject|expired/i.test(m.delivery_status||''))return '<span class="badge">Not delivered'+(m.delivery_error?': '+escapeHtml(m.delivery_error):'')+'</span>';
 if(/^\+1\d{3}555 ?01\d\d$/.test(String(m.phone||'').replace(/[()\-.]/g,'')) || m.delivery_status==='simulated' || /^(fake-out-|grounded-out-)/.test(m.provider_message_id||''))return '<span class="badge">Simulated</span>';
 if(m.delivery_status==='delivered')return '<span style="font-size:12px;">Delivered</span>';
 return '<span style="font-size:12px;">Sent'+(m.delivery_status?' &middot; '+escapeHtml(m.delivery_status):'')+'</span>';
};
