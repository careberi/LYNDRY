 'use strict';
function eligible(order){
 if(order.status==='DELIVERED')return 'already';
 if(order.status!=='OUT_FOR_DELIVERY')throw Error('Only an order out for delivery can be completed.');
 if(!['PAID','WAIVED'].includes(order.payment_status))throw Error('Resolve payment before completing this order.');
}
function createRecovery({load,observe,savePhoto,complete,note,now=Date.now}){
 return async function recover(number,action,input={},actor){
  const context=await load(number),{order,plan}=context;
  if(action==='note'){
   const reason=String(input.reason||'').trim();if(reason.length<3||reason.length>1000)throw Error('Enter a note between 3 and 1000 characters.');
   await note(order,reason,actor);return 'Internal note saved.';
  }
  if(!['sync','deliver'].includes(action))throw Error('Unknown order action.');
  if(eligible(order)==='already')return 'This order is already delivered. No changes made.';
  let proof,reason,checkedAt,source;
  if(action==='sync'){
   if(!plan||plan.leg!=='TO_CUSTOMER'||plan.simulation)throw Error('There is no linked real Shipday return to synchronize.');
   const seen=await observe(context);
   if(!seen||!seen.terminal||seen.rank!==3||String(seen.remoteId)!==String(plan.shipday_order_id))throw Error('Could not verify a matching completed return. Check the Shipday trip, delivery address and driver against this order. If already delivered, use Mark delivered with proof and a reason. No status changed.');
   if(!seen.deliveryPhotos?.length)throw Error('Shipday confirms delivery but has no supported proof photo. Use Mark delivered with a photo and reason.');
   if(!Number.isFinite(Date.parse(seen.observedAt))||now()-Date.parse(seen.observedAt)>30000||Date.parse(seen.observedAt)>now()+5000)throw Error('Delivery evidence expired. Try syncing again.');
   proof={url:seen.deliveryPhotos[0]};checkedAt=seen.observedAt;source='SHIPDAY';reason='Reconciled verified Shipday return delivery';
  }else{
   reason=String(input.reason||'').trim();if(reason.length<10||reason.length>1000)throw Error('Explain the delivery correction in 10 to 1000 characters.');
   if(input.confirmed!=='yes')throw Error('Confirm that the customer has received the laundry.');
   if(!input.file?.buffer?.length)throw Error('Upload a delivery proof photo.');
   proof={file:input.file};source='MANUAL';checkedAt=new Date(now()).toISOString();
  }
  const path=await savePhoto(order,proof);
  const result=await complete({order,plan,actor,path,source,reason,checkedAt});
  if(!result?.ok)throw Error(result?.reason||'Order changed. Refresh and try again.');
  return result.already?'This order is already delivered. No changes made.':'Order completed. No payment was taken or customer message resent.';
 };
}
module.exports={eligible,createRecovery};
