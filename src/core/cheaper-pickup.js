
'use strict';
const checkout = require('./dev-checkout');
const {dispatchInstant} = require('./shipday-dispatch');
const keys = ['SUBSCRIPTION','ONE_TIME'];
function total(snapshot) { return snapshot.estimatedTotalCents ?? snapshot.estimated30LbCents ?? snapshot.minimumTotalCents; }
function cheaper(candidate,current) {
  return keys.every(key=>total(candidate.categories[key])<=total(current.categories[key])) &&
    keys.some(key=>total(candidate.categories[key])<total(current.categories[key]));
}
// Search the following two weeks by minute. Prices are compared once per shop;
// only opening-hour checks run in the minute loop. Nothing is reserved here.
async function find(customer,form,current) {
  const context=current.searchContext;
  if(!context) return null;
  const partners=require('./partners');
  const start=Math.max(Date.parse(dispatchInstant(form.pickup_date,form.pickup_time)),Math.floor(Date.now()/60000)*60000);
  if(!Number.isFinite(start)) return null;
  const firstDate=require('./pickup-timing').localArrival(new Date(start).toISOString()).slice(0,10);
  let best=null;
  const plannedDays=new Map();
  for(const shop of context.shops) {
    let prices;
    try { prices=await checkout.previewQuote(customer,form,{publicPreview:true,addressEstimate:true,partnerId:shop.id,context}); }
    catch { continue; }
    if(!cheaper(prices,current))continue;
    let found=null;
    for(let day=0;day<14&&!found;day++) {
      const date=new Date(Date.parse(firstDate+'T12:00:00Z')+day*86400000).toISOString().slice(0,10);
      const firstMinute=day===0?Number(form.pickup_time.slice(0,2))*60+Number(form.pickup_time.slice(3,5)):0;
      for(let minute=firstMinute;minute<1440;minute++) {
        const time=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
        const at=dispatchInstant(date,time);
        if(Date.parse(at)<start||!checkout.scheduleFits(shop,context.hours.get(shop.id)||[],date,time))continue;
        if(!plannedDays.has(date))plannedDays.set(date,await partners.plannedByPartner([date]));
        try {
          found=await checkout.previewQuote(customer,{...form,pickup_date:date,pickup_time:time,alternative_partner_id:shop.id},{publicPreview:true,context:{...context,planned:plannedDays.get(date)}});
        } catch { /* Capacity or eligibility changed: try the next day. */ }
        break;
      }
    }
    if(!found||!cheaper(found,current))continue;
    const score=keys.reduce((sum,key)=>sum+total(found.categories[key]),0);
    if(!best||score<best.score||(score===best.score&&dispatchInstant(found.pickup_date,found.pickup_time)<dispatchInstant(best.pickup_date,best.pickup_time)))best={...found,score,alternative_partner_id:shop.id};
  }
  return best;
}
module.exports={find,cheaper,total};
