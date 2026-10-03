'use strict';
// No browser-supplied coordinates or validation flags are trusted.
const {houseNumber}=require('./address-street');
function accepted(result, submittedAddress = '') {
  const v = result?.verdict || {};
  const a = result?.address || {};
  const postal = a.postalAddress || {};
  const location = result?.geocode?.location;
  const components = a.addressComponents || [];
  if (!v.addressComplete || v.hasUnconfirmedComponents || v.hasReplacedComponents ||
      !['PREMISE','SUB_PREMISE'].includes(v.validationGranularity) ||
      postal.regionCode !== 'US' || postal.administrativeArea !== 'NJ' ||
      !location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
      (a.missingComponentTypes || []).length || (a.unresolvedTokens || []).length) return null;
  const component = type => components.find(c => c.componentType === type)?.componentName?.text || '';
  const number = component('street_number'), route = component('route');
  const zip = String(postal.postalCode || '').slice(0,5);
  const submittedNumber = houseNumber(submittedAddress);
  if (submittedNumber && submittedNumber !== houseNumber(number)) return null;
  if (!number || !route || !postal.locality || !/^\d{5}$/.test(zip)) return null;
  return {street:number+' '+route,town:postal.locality,zip,lat:location.latitude,lng:location.longitude};
}
async function validate(address, {key, fetchImpl=fetch}) {
  if (!key) throw Error('Address validation is not configured');
  const response = await fetchImpl('https://addressvalidation.googleapis.com/v1:validateAddress', {
    method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key},
    body:JSON.stringify({address:{regionCode:'US',addressLines:[address]},enableUspsCass:true}),
    signal:AbortSignal.timeout(8000),
  });
  if (!response.ok) throw Error('Address validation is unavailable');
  return accepted((await response.json()).result,address);
}
module.exports={accepted,validate};
