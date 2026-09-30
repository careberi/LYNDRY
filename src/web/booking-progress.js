'use strict';
const { escapeHtml } = require('./quote-result');
// Stable stages: saved wash preferences may skip a form, never renumber stages.
function render(step, customer = {}) {
  const active = ['repeat', 'when'].includes(step) ? 'pickup' : step;
  const stages = [['address', 'Address'], ['wash', 'Wash'], ['pickup', 'Pickup'], ['review', 'Review']];
  const address = [customer.address_line1, customer.address_line2, customer.city, customer.postal_code].filter(v => typeof v === 'string' && v.trim()).join(', ');
  return '<nav class="booking-progress" aria-label="Booking progress"><ol>' + stages.map(([key, label]) => '<li' + (key === active ? ' aria-current="step"' : '') + '>' + label + '</li>').join('') + '</ol></nav>' + (step !== 'address' && address ? '<p class="booking-address">Pickup: ' + escapeHtml(address) + '</p>' : '');
}
module.exports = { render };
