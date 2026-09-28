'use strict';

// Keep backend delivery handlers intact while retiring their old POS screens.
const destinations = {
  '/ops/run': '/ops/shipday',
  '/ops/couriers': '/ops/shipday',
  '/ops/process': '/ops',
  '/ops/journey': '/ops',
};
function destination(path) {
  const clean = path.replace(/\/+$/, '');
  const key = Object.keys(destinations).find(base => clean === base || clean.startsWith(base + '/'));
  return key ? destinations[key] : null;
}
module.exports = { destination };
