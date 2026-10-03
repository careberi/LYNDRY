'use strict';
function createCompletion({load,observe,savePhoto,complete,now=Date.now}) {
 const busy=new Set();
 async function reconcile(number) {
  if(busy.has(number))return {skipped:true};busy.add(number);
  try {
   const context=await load(number);if(!context)return {skipped:true};
   const {order,plan}=context;
   if(!order?.dev_quote_id || !plan || plan.leg!=='TO_CUSTOMER' || plan.mode!=='IN_HOUSE' || plan.simulation || !/^[1-9]\d*$/.test(String(plan.shipday_order_id)) || !plan.driver_id || plan.external_reference!=='LYNDRY-DEV-'+order.order_number+'-RETURN')return {skipped:true};
   if(!['OUT_FOR_DELIVERY','DELIVERED'].includes(order.status) || !['PAID','WAIVED'].includes(order.payment_status))return {skipped:true};
   if(order.status==='DELIVERED' && (order.delivery_notifications_suppressed || plan.state==='COMPLETED'))return {ok:true,already:true};
   const seen=await observe({...context,forCompletion:true});
   const stamp=Date.parse(seen?.observedAt);
   if(!seen?.terminal || seen.rank!==3 || String(seen.remoteId)!==String(plan.shipday_order_id) || !seen.deliveryPhotos?.length || !Number.isFinite(stamp) || now()-stamp>30000 || stamp>now()+5000)return {skipped:true};
   const stored=order.delivery_photo_path;
   const path=typeof stored==='string' && stored.startsWith(order.id+'/recovery-') && stored.endsWith('.jpg') ? stored : await savePhoto(order,{url:seen.deliveryPhotos[0]},plan);
   const result=await complete({order,plan,shop:context.shop,path,checkedAt:seen.observedAt});
   if(!result?.ok)throw Error(result?.reason||'Delivery changed during reconciliation.');return result;
  }finally{busy.delete(number);}
 }
 return {reconcile};
}
module.exports={createCompletion};
