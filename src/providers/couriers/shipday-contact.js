'use strict';
// Keep endpoint phones for drivers. Account switches disable notifications.
const BUSINESS_PHONE = '+12017712933';
function contactFields(body) { return {...body,customerEmail:''}; }
module.exports={BUSINESS_PHONE,contactFields};
