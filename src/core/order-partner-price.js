'use strict';
const checkout=require('./dev-checkout');
async function preview(order,partnerId){
 if(!order.pricing_snapshot)return null;
 const s=order.pricing_snapshot;
 const q=await checkout.previewQuote({...require('./order-address').customerFor(order,order.customers),pricing_category:s.category==='WHOLESALE'?'WHOLESALE':'ONE_TIME'},
 {pickup_date:order.pickup_date,pickup_time:order.pickup_time,plan:s.category==='SUBSCRIPTION'?'SUBSCRIPTION':'ONE_TIME'},
 {publicPreview:true,partnerId,policyOverride:s.policy});
 return q.snapshot;
}
async function change(order,partnerId,actor){
 checkout.guard();
 if(order.partner_id||!['REQUESTED','IN_PROCESS'].includes(order.status)||order.payment_status==='PAID')throw Error('The laundromat can only change before handover on an unpaid pickup.');
 const snapshot=await preview(order,partnerId);
 if(!snapshot)throw Error('This order has no saved quote to revise.');
 await checkout.data(require('../db').rpc('change_dev_order_partner',{p_order:order.id,p_partner:snapshot.partnerId,p_snapshot:snapshot,p_admin:actor.id,p_limit:null}));
}
module.exports={preview,change};
