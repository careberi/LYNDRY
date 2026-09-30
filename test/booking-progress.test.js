const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/web/booking-progress');
test('booking progress keeps stable stages when saved preferences skip wash', () => {
 for (const step of ['address', 'wash', 'repeat', 'when', 'review']) {
  const html = render(step);
  assert.equal((html.match(/<li/g) || []).length, 4);
  assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
 }
 assert.match(render('repeat'), /aria-current="step">Pickup/);
 assert.match(render('when'), /aria-current="step">Pickup/);
});
test('address context is escaped and hidden on address entry', () => {
 const customer = {address_line1:'<script>alert(1)</script>',city:'Fair Lawn',postal_code:'07410'};
 assert.doesNotMatch(render('address',customer), /Pickup:/);
 assert.match(render('when',customer), /&lt;script&gt;/);
 assert.doesNotMatch(render('when',customer), /<script>/);
});

test('navigation recognizes customers and booking preserves its destination', () => {
 const {renderPage} = require('../src/web/layout');
 const signed = renderPage({title:'Home',path:'/',body:'',signedIn:true});
 const guest = renderPage({title:'Home',path:'/',body:''});
 assert.ok(signed.includes('href="/account">My account'));
 assert.ok(guest.includes('href="/account/login">Log in'));
 assert.ok(signed.includes('href="/account/login?next=%2Faccount%2Fbook"'));
 assert.ok(!signed.split('</header>')[0].includes('href="/partners"'));
});
