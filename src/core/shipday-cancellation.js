'use strict';
// Never confuse an API error with evidence that the scheduled job is gone.
async function cancelLinked({provider,plan,assertCanceled}) {
 await assertCanceled();
 if(plan.simulation || !plan.shipday_order_id)return {ok:true};
 if(!plan.external_reference)throw Error('Linked reference is missing. Review cancellation.');
 const lookup=async()=>{const rows=await provider.findOrders(plan.external_reference);if(!Array.isArray(rows))throw Error('Invalid cancellation readback');if(rows.length && (rows.length!==1 || String(rows[0].orderId)!==String(plan.shipday_order_id) || rows[0].orderNumber!==plan.external_reference))throw Error('Conflicting delivery identity');return rows[0];};
 const remote=await lookup();if(!remote)return {ok:true,already:true};
 if(['CANCELED','CANCELLED'].includes(remote.orderStatus?.orderState))return {ok:true,already:true};
 const blocked=require('./shipday-order-sync').editable(remote);
 if(blocked)throw Error(blocked);
 if(plan.mode!=='IN_HOUSE')throw Error('Third party cancellation requires provider review.');
 await assertCanceled();
 await provider.removeOrder(plan.shipday_order_id);
 if(await lookup())throw Error('Shipday removal has not been confirmed');
 return {ok:true};
}
module.exports={cancelLinked};
