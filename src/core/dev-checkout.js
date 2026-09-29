'use strict';
const db = require('../db');
const { config } = require('../config');
const economics = require('./pricing-economics');
const dynamic = require('./dynamic-order-pricing');
const { dispatchInstant } = require('./shipday-dispatch');
const { createClient: createShipdayClient } = require('../providers/couriers/shipday');
const courierAvailability = require('./public-courier-availability');
const enabled = config.supabase.isDevelopment;
const shipday = createShipdayClient({ apiKey: config.shipday.apiKey, allowWrites: false });
function guard() { if (!enabled) throw Error('Development checkout is unavailable.'); }
async function data(query) { const { data, error } = await query; if (error) throw error; return data; }
function address(customer) { return Object.fromEntries(['address_line1','address_line2','city','postal_code'].map(k => [k,customer[k] || null])); }
async function policy() {
  guard(); const rows = await data(db.from('dev_pricing_policies').select('*').lte('effective_at',new Date().toISOString()).order('effective_at',{ascending:false}).limit(1));
  if (!rows.length) throw Error('Configure contribution targets before quoting.');
  return { ...rows[0].policy, version: rows[0].id };
}
// Both handovers must fit this shop's hours on consecutive local calendar days.
function scheduleFits(shop, rows, date, time, arrivalAt = null) {
  const partners = require('./partners');
  if(arrivalAt) {
    const local=require('./pickup-timing').localArrival(arrivalAt);
    if(!local||local.slice(0,10)!==date||Date.parse(arrivalAt)<Date.parse(dispatchInstant(date,time)))return false;
    time=local.slice(11,16);
  }
  const weekday = new Date(date+'T12:00:00Z').getUTCDay();
  if (!partners.isOpenAt(rows, weekday, time)) return false;
  if (shop.dropoff_cutoff && time >= String(shop.dropoff_cutoff).slice(0,5)) return false;
  const minutes = Number(time.slice(0,2))*60+Number(time.slice(3));
  const turnaround = Number(shop.turnaround_minutes) || 1440;
  return partners.canCollectOn(rows, (weekday+1)%7, Math.max(0,minutes+turnaround-1440));
}

async function previewQuote(customer, form, { publicPreview = false, addressEstimate = false, partnerId = null, policyOverride = null } = {}) {
  guard();
  const booking = require('./booking'), partners = require('./partners'), geo = require('./geocode');
  if (addressEstimate && !publicPreview) throw Error('Address estimates cannot be booked.');
  const date = require('./booking-intents').firstDateFor({pickup_date:form.pickup_date,pickup_time:form.pickup_time,cadence:form.cadence,weekdays:form.weekdays});
  const time = booking.normaliseTime(form.pickup_time);
  if (!addressEstimate) {
  const at = dispatchInstant(date,time);
  if (!at) throw Error('Choose a valid pickup date and time.');
  if (Date.parse(at) <= Date.now()) throw Error('That pickup time has already passed. Choose a later time or another day.');
  const problem = booking.dateProblem(date) || booking.timeProblem(time);
  if (problem) throw Error(problem);
  }
  if (!publicPreview) {
    const checked = await booking.checkSlot(customer,{pickupDate:date,pickupTime:time,exactTime:true});
    if (!checked.ok) throw Error(checked.detail || checked.say || 'This pickup cannot be booked.');
  }
  const current = policyOverride || await policy();
  const category = customer.pricing_category === 'WHOLESALE' ? 'WHOLESALE' : form.plan === 'SUBSCRIPTION' ? 'SUBSCRIPTION' : 'ONE_TIME';
  const [home, shops, hours, loads, planned] = await Promise.all([publicPreview ? geo.locate(customer) : geo.lookupOnce(geo.addressLine(customer)),partners.list({type:'LAUNDROMAT'}).then(rows=>rows.filter(p=>p.status==='ACTIVE')),partners.hoursForAll(),partners.loadByPartner(),partners.plannedByPartner(addressEstimate ? [] : [date])]);
  if (!home) throw Error('The pickup address could not be located. Check the street and ZIP.');
  const candidates = [];
  let timingRejected=false;
  for (const shop of shops) {
    if (partnerId && shop.id !== partnerId) continue;
    // Contact details do not determine price eligibility.
    if (!shop.address_line1) continue;
    if (shop.lat == null || shop.lng == null)continue;
    if(!addressEstimate&&!scheduleFits(shop,hours.get(shop.id)||[],date,time)){timingRejected=true;continue;}
    const onFloor=loads.get(shop.id)||{}, reserved=planned.get(shop.id)||{};
    const used=(onFloor.pounds||0)+(reserved.pounds||0)+((onFloor.unweighed||0)+(reserved.unweighed||0))*current.referenceWeightLb;
    const cap = partners.capacityOf(shop,{pounds:used});
    if (cap.remaining != null && cap.remaining < current.referenceWeightLb) continue;
    const miles = geo.milesBetween(home,{lat:Number(shop.lat),lng:Number(shop.lng)});
    if (!Number.isFinite(miles) || miles > 15) continue;
    const verified = await courierAvailability.verifyRoundTrip(shipday, {
      ...(addressEstimate?{}:{pickupReadyAt:dispatchInstant(date,time),loadingBufferMinutes:current.loadingBufferMinutes??10,
        acceptArrival:at=>{const fits=scheduleFits(shop,hours.get(shop.id)||[],date,time,at);if(!fits)timingRejected=true;return fits;}}),
      customer: { line1: customer.address_line1, line2: customer.address_line2,
        city: customer.city, state: customer.state || 'NJ', postalCode: customer.postal_code },
      partner: { line1: shop.address_line1, line2: shop.address_line2,
        city: shop.city, state: shop.state || 'NJ', postalCode: shop.postal_code },
    });
    if (!verified) continue;
    candidates.push({id:shop.id,eligible:true,wholesaleCentsPerLb:shop.wholesale_per_lb_cents,
      ...verified});
  }
  if(!candidates.length&&timingRejected)throw Error('No eligible laundromat is available for this pickup: arrival, washing turnaround and next-day collection must fit opening hours. Choose an earlier pickup or another day.');
  const categories = Object.fromEntries(['ONE_TIME','SUBSCRIPTION','WHOLESALE'].map(key => [key,dynamic.quoteCandidates(candidates,{policy:current,category:key})]));
  const expiresAt = categories[category].expiresAt;
  return {pickup_date:date,pickup_time:time,address:address(customer),snapshot:categories[category],categories,expires_at:expiresAt};
}
async function estimateAddress(customer) {
  guard();
  const geo = require('./geocode');
  const place = await geo.lookupOnce(geo.addressLine(customer));
  if (!place) throw Error('The pickup address could not be located.');
  return previewQuote({...customer,lat:place.lat,lng:place.lng},{},{publicPreview:true,addressEstimate:true});
}
async function createQuote(customer, form) {
  const {categories, ...quote} = await previewQuote(customer,form);
  return data(db.from('dev_order_quotes').insert({customer_id:customer.id,...quote}).select('*').single());
}
async function read(id,customerId) {
  guard(); if (!/^[a-f0-9-]{36}$/i.test(id||'')) throw Error('Request a new quote.');
  const quote = await data(db.from('dev_order_quotes').select('*').eq('id',id).eq('customer_id',customerId).single());
  return quote;
}
async function approve(id,customer) {
  const quote = await read(id,customer.id);
  if (quote.order_id) return quote;
  if (Date.parse(quote.expires_at) <= Date.now() || JSON.stringify(quote.address)!==JSON.stringify(address(customer))) {
    // JSONB key order is not stable; compare individual values instead.
    if (Date.parse(quote.expires_at)<=Date.now() || Object.keys(address(customer)).some(k=>quote.address[k]!==address(customer)[k])) throw Error('Address or quote changed. Get a new estimate.');
  }
  return data(db.from('dev_order_quotes').update({approved_at:new Date().toISOString()}).eq('id',id).is('order_id',null).select('*').single());
}
async function validateQuote(id,customer,date,time) {
  const quote = await read(id,customer.id);
  if (!quote.approved_at || Date.parse(quote.expires_at)<=Date.now() || quote.pickup_date!==date || String(quote.pickup_time).slice(0,5)!==String(time).slice(0,5)) throw Error('Refresh and approve the quote before booking.');
  const partners = require('./partners');
  const [shop, hours] = await Promise.all([
    partners.find(quote.snapshot.partnerId), partners.hoursForAll(),
  ]);
  if (!shop || shop.status !== 'ACTIVE' || shop.type !== 'LAUNDROMAT' ||
      !scheduleFits(shop,hours.get(shop.id)||[],date,String(time).slice(0,5)) ||
      (quote.snapshot.arrivalChecks||[]).some(at=>!scheduleFits(shop,hours.get(shop.id)||[],date,String(time).slice(0,5),at))) {
    throw Error('The laundromat is no longer available for this pickup and next-day return. Please choose another time and get a new quote.');
  }
  return quote;
}
async function evaluateWeight(order,weightLb) {
  guard();
  if (weightLb > 50) throw Error('Orders are limited to 50 lb. Resolve the excess weight before charging or dispatching.');
  if (!order.pricing_snapshot) throw Error('This order has no saved quote.');
  const result=dynamic.assessWeight(order.pricing_snapshot,{weightLb,pickupCents:order.pricing_snapshot.pickupCents,returnCents:order.pricing_snapshot.returnCents});
  const saved=await data(db.rpc('record_dev_order_weight',{p_order:order.id,p_weight:weightLb,p_expected_snapshot:order.pricing_snapshot}));
  return {...result,totalCents:saved.price_cents,ok:true};
}
function report(order) {
  if (!order.pricing_snapshot || !order.weight_lb || order.payment_status!=='PAID') return null;
  const s=order.pricing_snapshot;
  const washingCents=Math.ceil(Number(order.weight_lb)*s.wholesaleCentsPerLb);
  const processingCents=Math.round(order.price_cents*s.policy.processingBps/10000)+s.policy.processingFixedCents;
  return {revenueCents:order.price_cents,washingCents,courierCents:s.pickupCents+s.returnCents,processingCents,
    ...economics.contribution({revenueCents:order.price_cents,washingCents,courierCents:s.pickupCents+s.returnCents,processingCents})};
}
module.exports={enabled,guard,data,address,policy,scheduleFits,previewQuote,estimateAddress,createQuote,read,approve,validateQuote,evaluateWeight,report};
