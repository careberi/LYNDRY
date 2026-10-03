'use strict';
const {dispatchInstant}=require('./shipday-dispatch');
function bufferMinutes(value=10) {
  const n=Number(value);
  if(!Number.isInteger(n)||n<0||n>120)throw Error('Loading buffer must be a whole number from 0 to 120 minutes.');
  return n;
}
// Use the travel segment of Shipday's estimates, excluding courier wait time.
// These are estimates, not a claim that an in-house driver has been dispatched.
function inHouseArrival(quote,pickupReadyAt,buffer=10) {
  const durations=(quote?.options||[]).filter(r=>/uber|doordash/i.test(r.service||''))
    .map(r=>Date.parse(r.deliveryTime)-Date.parse(r.pickupTime)).filter(n=>Number.isFinite(n)&&n>0&&n<=6*3600000);
  if(!durations.length||!Number.isFinite(Date.parse(pickupReadyAt)))return null;
  return new Date(Date.parse(pickupReadyAt)+Math.max(...durations)+bufferMinutes(buffer)*60000).toISOString();
}
function manualArrival(value,pickupReadyAt) {
  if(!value)return null;
  const match=/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  const at=match&&dispatchInstant(match[1],match[2]);
  if(!at||!Number.isFinite(Date.parse(pickupReadyAt))||Date.parse(at)<=Date.parse(pickupReadyAt))throw Error('Enter an arrival after pickup, in Eastern time.');
  return at;
}
function localArrival(at) {
  if(!Number.isFinite(Date.parse(at)))return null;
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));
}
function resolvePickup(form,{now=Date.now(),leadMinutes=15}={}) {
  if(!Number.isInteger(leadMinutes)||leadMinutes<15||leadMinutes>120)throw Error('Pickup preparation time must be between 15 and 120 minutes.');
  const mode=form.pickup_mode||'SCHEDULED';
  if(!['EARLIEST','SCHEDULED'].includes(mode))throw Error('Choose earliest available or schedule for later.');
  const earliest=Math.ceil((now+leadMinutes*60000)/(15*60000))*15*60000;
  const at=mode==='EARLIEST'?new Date(earliest).toISOString():dispatchInstant(form.pickup_date,form.pickup_time);
  if(!at)throw Error('Choose a valid, unambiguous pickup date and time.');
  if(Date.parse(at)<now+leadMinutes*60000)throw Error('Choose a later pickup, at least '+leadMinutes+' minutes ahead, or choose earliest available.');
  const local=localArrival(at);
  return {pickup_mode:mode,pickup_date:local.slice(0,10),pickup_time:local.slice(11,16),pickupReadyAt:at};
}
function validateSavedPickup(at,{now=Date.now()}={}) {
  if(!Number.isFinite(Date.parse(at))||Date.parse(at)<now+5*60000)throw Error('This pickup time is too close. Refresh your pickup time and price before confirming.');
  return at;
}
module.exports={bufferMinutes,inHouseArrival,manualArrival,localArrival,resolvePickup,validateSavedPickup};
