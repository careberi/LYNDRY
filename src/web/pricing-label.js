'use strict';
module.exports = snapshot => snapshot?.pricingMethod === 'COST_PLUS_MARGIN_15' ? 'Delivery + fees' : 'Operational fee';
