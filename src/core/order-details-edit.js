'use strict';
const {dispatchInstant}=require('./shipday-dispatch');
const wash=require('./wash');
function expectedFor(order){return {pickup_date:order.pickup_date,pickup_time:order.pickup_time,preferences:order.preferences??null,pricing_snapshot:order.pricing_snapshot??null};}
function prepare(order,body,now=Date.now()){
 if(order.status!=='REQUESTED'||order.partner_id||order.payment_status==='PAID')throw Error('Order details can only change before collection.');
 const field=(name,max,required=true)=>{const value=String(body[name]||'').trim();if((required&&!value)||value.length>max)throw Error('Enter a valid '+name.replaceAll('_',' ')+'.');return value;};
 const address={address_line1:field('address_line1',200),address_line2:field('address_line2',100,false),city:field('city',100),state:field('state',2).toUpperCase(),postal_code:field('postal_code',5)};
 if(address.state!=='NJ'||!/^\d{5}$/.test(address.postal_code))throw Error('Enter a New Jersey address and five-digit ZIP code.');
 const date=field('pickup_date',10),time=field('pickup_time',5),at=dispatchInstant(date,time);
 if(!at||Date.parse(at)<=now)throw Error('Choose a future pickup date and time (Eastern).');
 if(!['ONE_TIME','SUBSCRIPTION'].includes(body.service))throw Error('Choose a service for this pickup.');
 const preferences={...(order.preferences||order.customers?.preferences||{}),pickup_address:address,dropoff_spot:field('dropoff_spot',300)};
 for(const key of wash.KEYS){if(!wash.isValid(key,body[key]))throw Error('Choose a valid '+wash.OPTIONS[key].label+'.');preferences[key]=body[key];}
 return {pickup_date:date,pickup_time:time,preferences,service:body.service};
}
async function save(order,body,actor){
 const checkout=require('./dev-checkout');checkout.guard();
 let expected;try{expected=JSON.parse(body.expected);}catch{throw Error('Refresh the order before editing.');}
 if(!require('node:util').isDeepStrictEqual(expected,expectedFor(order)))throw Error('Order changed. Refresh before editing.');
 const change=prepare(order,body);
 const customer={...require('./order-address').customerFor({...order,preferences:change.preferences},order.customers)};
 // Preserve wholesale classification; changing this order does not create a subscription.
 if(order.pricing_snapshot?.category==='WHOLESALE')customer.pricing_category='WHOLESALE';
 const quote=await checkout.previewQuote(customer,{...change,plan:change.service,estimated_weight_lb:order.pricing_snapshot?.estimatedWeightLb},{publicPreview:true,partnerId:order.intended_partner_id,policyOverride:order.pricing_snapshot?.policy});
 await require('./pickup-edit-sync').saveWithSync({order,change,quote,actor,expected,customer});
}
module.exports={prepare,save,expectedFor};
