'use strict';
// The existing routing configuration supplies estimates, not courier availability.
function estimate(distanceMiles,routing,{pickupReadyAt=null,loadingBufferMinutes=10,now=Date.now()}={}) {
 const positive=['milesPerGallon','milesPerHour','roadFactor'];
 const nonnegative=['wagePerHour','gasPerGallon','wearPerMile','minutesPerPickup','minutesPerDelivery','minutesPerPartnerVisit'];
 if(!Number.isFinite(distanceMiles)||distanceMiles<0||positive.some(k=>!Number.isFinite(routing?.[k])||routing[k]<=0)||nonnegative.some(k=>!Number.isFinite(routing?.[k])||routing[k]<0)||!Number.isInteger(loadingBufferMinutes)||loadingBufferMinutes<0||loadingBufferMinutes>120) throw Error('Configure valid in-house routing cost and travel settings before quoting.');
 const roadMiles=distanceMiles*routing.roadFactor;
 const travelMinutes=Math.max(1,Math.ceil(roadMiles/routing.milesPerHour*60));
 const perMile=routing.gasPerGallon/routing.milesPerGallon+routing.wearPerMile+routing.wagePerHour/routing.milesPerHour;
 const cost=stopMinutes=>Math.ceil((roadMiles*perMile+(stopMinutes+routing.minutesPerPartnerVisit)/60*routing.wagePerHour)*100);
 const result={pickupCents:cost(routing.minutesPerPickup),returnCents:cost(routing.minutesPerDelivery),source:'IN_HOUSE',costBasis:'CONFIGURED_IN_HOUSE_ESTIMATE',travelMinutes,expiresAt:new Date(now+5*60000).toISOString()};
 if(pickupReadyAt){
  if(!Number.isFinite(Date.parse(pickupReadyAt)))throw Error('Choose a valid pickup time.');
  const ready=Math.max(Date.parse(pickupReadyAt),Math.floor(now/60000)*60000);
  result.arrivalMinutes=travelMinutes+routing.minutesPerPickup+loadingBufferMinutes;
  result.arrivalChecks=[new Date(ready+result.arrivalMinutes*60000).toISOString()];
 }
 return result;
}
module.exports={estimate};
