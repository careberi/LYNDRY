'use strict';
const {validPath}=require('../core/delivery-photo');
function attachment(message) {
 if(!validPath(message.media_path,message.customer_id) || !/^[0-9a-f-]{36}$/i.test(message.id||''))return '';
 const url='/ops/message-photos/'+message.id;
 return '<a href="'+url+'" target="_blank" rel="noopener"><img src="'+url+'" alt="Customer delivery photo" loading="lazy" style="max-width:280px;max-height:280px;border-radius:8px;display:block;margin-top:8px"></a>';
}
module.exports={attachment};
