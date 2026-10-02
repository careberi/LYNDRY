'use strict';
const normalize = value => String(value || '').toLowerCase().replace(/\b(usa|united states)\b/g,'').replace(/[^a-z0-9]/g,'');
const address = row => [row.address_line1,row.address_line2,row.city,row.state,row.postal_code].filter(Boolean).join(', ');
// Old in-house development returns inserted NJ into blank states. Accept only
// that exact historical form, never discard an explicit state or other field.
const legacyNJReturn = plan => plan?.leg==='TO_CUSTOMER' && plan.mode==='IN_HOUSE' && plan.simulation===false && /^LYNDRY-DEV-[1-9]\d*-RETURN$/.test(plan.external_reference||'');
function matchesAddress(remote,row,legacyNJ=false) {
  if(normalize(remote)===normalize(address(row)))return true;
  return legacyNJ && !String(row.state||'').trim() && normalize(remote)===normalize(address({...row,state:'NJ'}));
}
module.exports={address,normalize,legacyNJReturn,matchesAddress};
