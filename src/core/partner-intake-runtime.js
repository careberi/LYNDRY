'use strict';
const db = require('../db');
const checkout = require('./dev-checkout');
const service = require('./partner-intake').createService({
  db,
  readDeliveryPhoto: require('../providers/couriers/shipday-proof').fetchPhoto,
  deliveryInfo: require('./partner-delivery-board-runtime').deliveryInfo,
  checkDelivery: require('./partner-delivery-gate-runtime').checkDelivery,
  async settleWeight(order, options) {
    checkout.guard();
    if (require('../providers/payments').mode !== 'test') throw Error('Test payments required.');
    if (order.dev_quote_id) {
      if (['PAID','WAIVED'].includes(order.payment_status)) return {ok:true};
      const assessed = await checkout.evaluateWeight(order, Number(order.partner_weight_lb));
      if (!assessed.ok) return assessed;
      const current = await checkout.data(db.from('orders').select('*,customers(*)').eq('id',order.id).single());
      return require('./billing').settleTotal(current,current.customers,{totalCents:current.price_cents});
    }
    const current = await checkout.data(db.from('orders').select('*,customers(*)').eq('id',order.id).single());
    return require('./fulfilment').settleWeight(current, options);
  },
  enrollReturn: (order,{partner,actor}) => require('./partner-return-runtime').request(order.id,partner,actor),
  confirmCollection: args => require('./partner-return-runtime').confirmCollection(args),
});
module.exports = service;
