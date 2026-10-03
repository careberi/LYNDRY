'use strict';
const {deliveryPhotos}=require('../providers/couriers/shipday-proof');
const {matchesAddress,legacyNJReturn}=require('./delivery-address');
const stages=[{leg:'TO_PARTNER',title:'Laundromat drop-off',description:'Bags delivered to the laundromat.'},{leg:'TO_CUSTOMER',title:'Customer delivery',description:'Bags returned to the customer.'}];
function createService({load,provider,readPhoto}) {
 async function evidence(context,leg) {
  const {order,customer,shop,plans}=context;
  const linked=plans.filter(p=>p.leg===leg),plan=linked[0];
  if(!plan || plan.simulation || !plan.shipday_order_id)return {state:'missing',urls:[]};
  const reference='LYNDRY-DEV-'+order.order_number+'-'+(leg==='TO_PARTNER'?'PICKUP':'RETURN');
  if(linked.length!==1 || plan.order_id!==order.id || plan.external_reference!==reference || !shop || !customer)return {state:'unverified',urls:[]};
  try {
   const rows=await provider.findOrders(reference),remote=rows?.[0];
   const home=require('./order-address').customerFor(order,customer);
   const from=leg==='TO_PARTNER'?home:shop,to=leg==='TO_PARTNER'?shop:home;
   if(!Array.isArray(rows)||rows.length!==1||String(remote.orderId)!==String(plan.shipday_order_id)||remote.orderNumber!==reference||
      !matchesAddress(remote.restaurant?.address,from,legacyNJReturn(plan))||!matchesAddress(remote.customer?.address,to,legacyNJReturn(plan))||
      remote.orderStatus?.incomplete||remote.activityLog?.failedDeliveryTime)return {state:'unverified',urls:[]};
   const urls=deliveryPhotos(remote);
   return {state:urls.length?'available':'missing',urls};
  }catch{return {state:'unavailable',urls:[]};}
 }
 return {
  async gallery(number) {
   const context=await load(number);if(!context)return [];
   return Promise.all(stages.map(async stage=>{const result=await evidence(context,stage.leg);return {...stage,state:result.state,count:result.urls.length};}));
  },
  async photo(number,leg,index) {
   if(!/^[1-9]\d*$/.test(String(number))||!stages.some(s=>s.leg===leg)||!/^(?:[0-9]|1[0-9])$/.test(String(index)))return null;
   const context=await load(number);if(!context)return null;
   // Resolve the stored reference again for each authenticated image request.
   // Never accept a provider URL from a browser or trust an earlier page read.
   const result=await evidence(context,leg),url=result.urls[Number(index)];
   return url?readPhoto(url):null;
  }
 };
}
module.exports={createService};
