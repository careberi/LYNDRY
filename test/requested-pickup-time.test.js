const test=require('node:test');
const assert=require('node:assert/strict');
const booking=require('../src/core/booking');
test('POS displays the selected minute, not a calculated route window',()=>{
 const order={pickup_time:'15:17:00',pickup_window_start:'14:00:00',pickup_window_end:'16:00:00'};
 assert.equal(booking.requestedPickupLabel(order),'3:17pm ET');
 assert.equal(booking.arrivalWindow(order),'between 2 and 4pm');
});
test('old orders without a selected time retain an explicitly labelled window',()=>{
 assert.equal(booking.requestedPickupLabel({pickup_window_start:'10:00',pickup_window_end:'12:00'}),'between 10am and 12pm (legacy window)');
 assert.equal(booking.requestedPickupLabel({}),null);
 assert.equal(booking.requestedPickupLabel(null),null);
});
