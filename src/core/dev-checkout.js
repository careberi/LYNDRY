'use strict';
const db = require('../db');
const { config } = require('../config');
const economics = require('./pricing-economics');
const dynamic = require('./dynamic-order-pricing');
const { dispatchInstant } = require('./shipday-dispatch');
const {verifyRoundTrip} = require('./public-courier-availability');
const quoteClient = require('../providers/couriers/shipday').createClient({apiKey:config.shipday.apiKey,allowWrites:false});
const enabled = config.supabase.isDevelopment;
function guard() { if (!enabled) throw Error('Development checkout is unavailable.'); }
async function data(query) { const { data, error } = await query; if (error) throw error; return data; }
function address(customer) { return Object.fromEntries(['address_line1','address_line2','city','postal_code'].map(k => [k,customer[k] || null])); }
function courierAddress(row) { return [row.address_line1,row.address_line2,row.city,row.state,row.postal_code].filter(Boolean).join(', '); }
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

async function previewQuote(customer, form, { publicPreview = false, addressEstimate = false, partnerId = null, policyOverride = null, context = null, resolvedPickup = false } = {}) {
  guard();
  const booking = require('./booking'), partners = require('./partners'), geo = require('./geocode');
  if (addressEstimate && !publicPreview) throw Error('Address estimates cannot be booked.');
  let date = form.pickup_date || require('./booking-intents').firstDateFor({pickup_date:form.pickup_date,pickup_time:form.pickup_time,cadence:form.cadence,weekdays:form.weekdays});
  let time = booking.normaliseTime(form.pickup_time);
  if (!addressEstimate) {
  if(resolvedPickup)require('./pickup-timing').validateSavedPickup(dispatchInstant(date,time),{now:Date.now()});
  else {
  const resolved=require('./pickup-timing').resolvePickup({...form,pickup_date:date,pickup_time:time,pickup_mode:date&&time?'SCHEDULED':form.pickup_mode},{now:Date.now(),leadMinutes:config.shipday.pickupLeadMinutes??15});
  date=resolved.pickup_date;time=resolved.pickup_time;
  }
  const problem = booking.dateProblem(date) || booking.timeProblem(time);
  if (problem) throw Error(problem);
  }
  if (!publicPreview) {
    const checked = await booking.checkSlot(customer,{pickupDate:date,pickupTime:time,exactTime:true});
    if (!checked.ok) throw Error(checked.detail || checked.say || (checked.reason === 'already_booked' ? 'You already have a pickup booked. Move it rather than booking a second.' : 'This pickup cannot be booked.'));
  }
  const current = context?.current || policyOverride || await policy();
  const estimatedWeightLb = current.pricingMethod === require('./weight-based-pricing').METHOD ? require('./weight-based-pricing').estimatedWeight(form.estimated_weight_lb??30) : undefined;
  const category = customer.pricing_category === 'WHOLESALE' ? 'WHOLESALE' : form.plan === 'SUBSCRIPTION' ? 'SUBSCRIPTION' : 'ONE_TIME';
  const [home, shops, hours, loads, planned] = context ? [context.home,context.shops,context.hours,context.loads,context.planned] : await Promise.all([geo.locate(customer),partners.list({type:'LAUNDROMAT'}).then(rows=>rows.filter(p=>p.status==='ACTIVE')),partners.hoursForAll(),partners.loadByPartner(),partners.plannedByPartner(addressEstimate ? [] : [date])]);
  if (!home) throw Error('The pickup address could not be located. Check the street and ZIP.');
  const candidates = [];
  let timingRejected=false, courierUnavailable=false;
  for (const shop of shops) {
    if ((partnerId || form.alternative_partner_id) && shop.id !== (partnerId || form.alternative_partner_id)) continue;
    // Contact details do not determine price eligibility.
    if (!shop.address_line1) continue;
    if (shop.lat == null || shop.lng == null)continue;
    if (!Number.isSafeInteger(shop.wholesale_per_lb_cents) || shop.wholesale_per_lb_cents <= 0) continue;
    if (shop.customer_base_per_lb_cents != null && (!Number.isSafeInteger(shop.customer_base_per_lb_cents) || shop.customer_base_per_lb_cents <= 0)) continue;
    const onFloor=loads.get(shop.id)||{}, reserved=planned.get(shop.id)||{};
    const planningWeight=estimatedWeightLb!=null?50:current.referenceWeightLb;
    const used=(onFloor.pounds||0)+(reserved.pounds||0)+((onFloor.unweighed||0)+(reserved.unweighed||0))*planningWeight;
    const cap = partners.capacityOf(shop,{pounds:used});
    if (!addressEstimate && cap.remaining != null && cap.remaining < (estimatedWeightLb!=null?50:current.referenceWeightLb)) continue;
    const miles = geo.milesBetween(home,{lat:Number(shop.lat),lng:Number(shop.lng)});
    if (!Number.isFinite(miles) || miles > 15) continue;
    if(!addressEstimate&&!scheduleFits(shop,hours.get(shop.id)||[],date,time)){timingRejected=true;continue;}
    let verified;
    try {
      verified = await verifyRoundTrip(quoteClient,{
        customer:courierAddress(customer),partner:courierAddress(shop),
        loadingBufferMinutes:current.loadingBufferMinutes??10,
        ...(addressEstimate?{}:{pickupReadyAt:dispatchInstant(date,time),
          acceptArrival:at=>scheduleFits(shop,hours.get(shop.id)||[],date,time,at)}),
        onUnavailable:reason=>{if(reason==='arrival_hours'||reason==='arrival_estimate')timingRejected=true;else courierUnavailable=true;},
      });
    } catch (error) {
      if(error.code==='PICKUP_TIME_REJECTED')throw error;
      console.warn('Courier quote check failed:', /^Shipday |^A valid Shipday/.test(error.message)?error.message:'Quote validation failed.');
      courierUnavailable=true;
    }
    if(!verified)continue;
    candidates.push({id:shop.id,distanceMiles:miles,eligible:true,wholesaleCentsPerLb:shop.wholesale_per_lb_cents,
      customerBaseCentsPerLb:shop.customer_base_per_lb_cents ?? shop.wholesale_per_lb_cents,
      ...verified});
  }
  if(!candidates.length&&courierUnavailable)throw Error('Fresh delivery prices are unavailable. Please try again before booking.');
  if(!candidates.length&&timingRejected)throw Error('No eligible laundromat is available for this pickup: arrival, washing turnaround and next-day collection must fit opening hours. Choose an earlier pickup or another day.');
  // Public quotes and booking compare the same eligible offers by customer total.
  const selected = candidates;
  const categories = Object.fromEntries(['ONE_TIME','SUBSCRIPTION','WHOLESALE'].map(key => [key,dynamic.quoteCandidates(selected,{policy:current,category:key,estimatedWeightLb,now:Date.now()})]));
  // Public schedules contain prices only; never disclose partners or their costs.
  if(estimatedWeightLb!=null) for(const key of economics.CATEGORIES) {
    const totalAtWeight = weight => dynamic.quoteCandidates(selected, {policy:current, category:key, estimatedWeightLb:weight,now:Date.now()}).estimatedTotalCents;
    categories[key].weightTotalsCents=Array.from({length:50},(_,i)=>totalAtWeight(i+1));
    categories[key].minimumIncludedWeightLb=require('./weight-based-pricing').minimumIncludedWeight(categories[key], {totalAtWeight});
  }
  for (const snapshot of Object.values(categories)) {
    snapshot.selectionMethod = form.alternative_partner_id ? 'AVAILABLE_ALTERNATIVE_V1' : 'LOWEST_ESTIMATED_TOTAL_V1';
    snapshot.transportMode = 'IN_HOUSE';
    snapshot.costBasis = 'THIRD_PARTY_API_ESTIMATE';
    if(!addressEstimate){snapshot.pickupReadyAt=dispatchInstant(date,time);snapshot.pickupMode=form.pickup_mode||'SCHEDULED';snapshot.timingPolicyVersion='PICKUP_TIME_V1';}
  }
  const expiresAt = categories[category].expiresAt;
  const result = {pickup_date:date,pickup_time:time,address:address(customer),snapshot:categories[category],categories,expires_at:expiresAt};
  if(publicPreview && !addressEstimate) Object.defineProperty(result,'searchContext',{value:{current,home,shops,hours,loads,planned}});
  return result;
}
async function estimateAddress(customer,estimatedWeightLb=30) {
  guard();
  const geo = require('./geocode');
  const place = await geo.lookupOnce(geo.addressLine(customer));
  if (!place) throw Error('The pickup address could not be located.');
  return previewQuote({...customer,lat:place.lat,lng:place.lng},{estimated_weight_lb:estimatedWeightLb},{publicPreview:true,addressEstimate:true});
}
async function createQuote(customer, form, {resolvedPickup=false}={}) {
  const {categories, ...quote} = await previewQuote(customer,form,{resolvedPickup});
  return data(db.from('dev_order_quotes').insert({customer_id:customer.id,...quote}).select('*').single());
}
async function read(id,customerId) {
  guard(); if (!/^[a-f0-9-]{36}$/i.test(id||'')) throw Error('Request a new quote.');
  const quote = await data(db.from('dev_order_quotes').select('*').eq('id',id).eq('customer_id',customerId).single());
  if(!quote.order_id&&quote.snapshot?.source!=='SHIPDAY')throw Error('Refresh the delivery quote before booking.');
  return quote;
}
async function approve(id,customer) {
  const quote = await read(id,customer.id);
  if (quote.order_id) return quote;
  if(quote.snapshot?.source!=='SHIPDAY')throw Error('Refresh the delivery quote before booking.');
  if (Date.parse(quote.expires_at) <= Date.now() || JSON.stringify(quote.address)!==JSON.stringify(address(customer))) {
    // JSONB key order is not stable; compare individual values instead.
    if (Date.parse(quote.expires_at)<=Date.now() || Object.keys(address(customer)).some(k=>quote.address[k]!==address(customer)[k])) throw Error('Address or quote changed. Get a new estimate.');
  }
  return data(db.from('dev_order_quotes').update({approved_at:new Date().toISOString()}).eq('id',id).is('order_id',null).select('*').single());
}
async function validateQuote(id,customer,date,time) {
  const at=dispatchInstant(date,String(time).slice(0,5));
  require('./pickup-timing').validateSavedPickup(at,{now:Date.now()});
  const quote = await read(id,customer.id);
  if(quote.snapshot?.source!=='SHIPDAY')throw Error('Refresh the delivery quote before booking.');
  if(quote.snapshot.pickupReadyAt&&quote.snapshot.pickupReadyAt!==at)throw Error('Pickup time changed. Review a fresh quote.');
  if (!quote.approved_at || Date.parse(quote.expires_at)<=Date.now() || quote.pickup_date!==date || String(quote.pickup_time).slice(0,5)!==String(time).slice(0,5)) throw Error('Refresh and approve the quote before booking.');
  if(Object.keys(address(customer)).some(k=>quote.address?.[k]!==address(customer)[k]))throw Error('Address changed. Get a fresh delivery quote.');
  const partners = require('./partners');
  const [shop, hours] = await Promise.all([
    partners.find(quote.snapshot.partnerId), partners.hoursForAll(),
  ]);
  if (!shop || shop.status !== 'ACTIVE' || shop.type !== 'LAUNDROMAT' ||
      !scheduleFits(shop,hours.get(shop.id)||[],date,String(time).slice(0,5)) ||
      (quote.snapshot.arrivalChecks||[]).some(arrival=>!scheduleFits(shop,hours.get(shop.id)||[],date,String(time).slice(0,5),new Date(Math.max(Date.parse(arrival),Math.floor(Date.now()/60000)*60000+(Number.isFinite(quote.snapshot.inHouseArrivalMinutes)?quote.snapshot.inHouseArrivalMinutes*60000:Math.max(0,Date.parse(arrival)-Math.max(Date.parse(at),Date.parse(quote.created_at)||Date.parse(at)))))).toISOString()))) {
    throw Error('The laundromat is no longer available for this pickup and next-day return. Please choose another time and get a new quote.');
  }
  let fresh;
  try {
    fresh=await verifyRoundTrip(quoteClient,{customer:courierAddress(customer),partner:courierAddress(shop),
      pickupReadyAt:at,
      acceptArrival:arrival=>scheduleFits(shop,hours.get(shop.id)||[],date,String(time).slice(0,5),arrival)});
  } catch (error) { if(error.code==='PICKUP_TIME_REJECTED')throw error;throw Error('Fresh delivery prices are unavailable. Please try again before booking.'); }
  if(!fresh)throw Error('Fresh delivery prices are unavailable for this pickup. Get a new quote.');
  if(fresh.pickupCents!==quote.snapshot.pickupCents||fresh.returnCents!==quote.snapshot.returnCents)throw Error('Delivery prices changed. Review a fresh quote before booking.');
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
  const processingCents=require('./weight-based-pricing').isSnapshot(s)?require('./weight-based-pricing').processingCents(order.price_cents,s):Math.round(order.price_cents*s.policy.processingBps/10000)+s.policy.processingFixedCents;
  const otherCostCents=require('./weight-based-pricing').isSnapshot(s)?(s.policy.otherCostCents||0)+Math.ceil(Number(order.weight_lb)*(s.policy.otherCostPerLbCents||0)):0;
  return {otherCostCents,revenueCents:order.price_cents,washingCents,courierCents:s.pickupCents+s.returnCents,processingCents,
    ...economics.contribution({otherCostCents,revenueCents:order.price_cents,washingCents,courierCents:s.pickupCents+s.returnCents,processingCents})};
}
module.exports={enabled,guard,data,address,policy,scheduleFits,previewQuote,estimateAddress,createQuote,read,approve,validateQuote,evaluateWeight,report};
