'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { customerText } = require('../src/web/customer-copy');
const quote = require('../src/web/quote-result');
const portal = require('../src/web/shop-intake-page');
const economics = require('../src/core/pricing-economics');
const vendors = /\b(?:Shipday|Uber|Door\s*Dash|Stripe|Twilio|Telnyx|Supabase|Anthropic|OpenAI|Google|Railway)\b/i;
const visible = html => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ');

test('public informational pages do not name third-party vendors', () => {
  const directory = path.join(__dirname, '../public/pages');
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.html'))) {
    assert.doesNotMatch(visible(fs.readFileSync(path.join(directory, file), 'utf8')), vendors, file);
  }
});

test('live quote explanation is vendor-neutral and preserves availability caveats', () => {
  const categories = Object.fromEntries(['ONE_TIME', 'SUBSCRIPTION'].map(category => [category,
    economics.preview({wholesaleCentsPerLb:100,pickupCents:750,returnCents:750,category,
      policy:{marginBps:{ONE_TIME:2000,SUBSCRIPTION:1000},processingBps:290,processingFixedCents:30,operationalFeeBps:2500,referenceWeightLb:33}})]));
  const html = quote.render({quote:{ok:true,dynamic:true,categories},address:'Fair Lawn'});
  assert.doesNotMatch(visible(html), vendors);
  assert.match(html, /Availability is checked again when you book/);
  assert.match(html, /No driver is requested and no payment is collected here/);
});

test('portal status, photos and live driver labels remain vendor-neutral in both languages', () => {
  for (const lang of ['en','es']) for (const stage of ['INCOMING','WASH','READY']) {
    for (const notice of ['return_not_collected','delivery_not_collected','delivery_mismatch','delivery_unverified',null]) {
      const order = {number:9018,stage,reference:'LYNDRY-9018',assigned:true,driver:'Uber Direct',driverPhone:'+12015550123',deliveryStatus:'PICKED_UP'};
      const ctx = {lang,shop:{id:'shop',name:'Test laundry'},csrf:'test',order,orders:[order],notice};
      for (const html of [portal.detail(ctx),portal.board(ctx)]) {
        assert.doesNotMatch(visible(html), vendors);
        if (stage !== 'WASH') assert.match(html, /tel:\+12015550123/);
      }
    }
  }
});

test('vendor-origin labels and errors are hidden without rewriting ordinary names or useful errors', () => {
  for (const name of ['Shipday HTTP 503','DoorDash','Uber Direct','STRIPE timeout','Telnyx unavailable']) {
    assert.equal(customerText(name,'Please contact LYNDRY.'),'Please contact LYNDRY.');
  }
  assert.equal(customerText('Maria','Assigned driver'),'Maria');
  assert.equal(customerText('Choose a later pickup time.','Try again.'),'Choose a later pickup time.');
});
