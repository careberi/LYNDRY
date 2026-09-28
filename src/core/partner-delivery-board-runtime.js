'use strict';
const db = require('../db');
const {config} = require('../config');
const {verify,destination} = require('./partner-delivery-gate');
const {verifyReturn} = require('./partner-return');
const provider = require('../providers/couriers/shipday').createClient({apiKey:config.shipday.apiKey,timeoutMs:6000});
provider.trackingInfo = require('../providers/couriers/shipday-tracking').createTracking();
const data = async q => { const {data,error}=await q; if(error)throw error; return data; };
const cache = new Map();
async function deliveryInfo(order, partnerId, leg) {
  try {
    const [shop,plan] = await Promise.all([
      data(db.from('partners').select('id,name,status,address_line1,address_line2,city,state,postal_code').eq('id',partnerId).single()),
      data(db.from('shipday_dispatch_plans').select('*').eq('order_id',order.id).eq('leg',leg).maybeSingle()),
    ]);
    if (shop.status!=='ACTIVE') return {ok:false,reason:'delivery_unverified'};
    // Includes destination, schedule and assignment so a changed order cannot reuse an old display.
    const row = leg==='TO_CUSTOMER' ? await data(db.from('orders').select('customers(name,address_line1,address_line2,city,state,postal_code)').eq('id',order.id).eq('partner_id',partnerId).maybeSingle()) : null;
    const customer=row?.customers;
    const key = JSON.stringify([partnerId,order.id,order.pickup_date,order.pickup_time,leg,plan,destination(shop),customer]);
    const old = cache.get(key);
    if(old && Date.now()-old.at<30000)return old.promise;
    if(cache.size>=500)cache.delete(cache.keys().next().value);
    const promise = read(order,shop,plan,leg,customer).catch(()=>({ok:false,reason:'delivery_unverified'}));
    cache.set(key,{at:Date.now(),promise});
    return await promise;
  } catch { return {ok:false,reason:'delivery_unverified'}; }
}
async function read(order,shop,plan,leg,customer) {
  if (leg==='TO_PARTNER') return verify({provider,order,shop,plan,telemetry:true});
  if(!customer)return {ok:false,reason:'delivery_unverified'};
  return verifyReturn({provider,order,shop,customer,plan,telemetry:true});
}
module.exports={deliveryInfo};
