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
module.exports={bufferMinutes,inHouseArrival,manualArrival,localArrival};
