'use strict';
// An order edit must not move another pickup or overwrite the customer's home.
function customerFor(order,customer){const address=order.preferences?.pickup_address;return address?{...customer,...address,lat:null,lng:null,geocode_failed:false,order_address_override:true}:{...customer};}
module.exports={customerFor};
