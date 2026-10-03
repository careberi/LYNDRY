 'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {orderOverview}=require('../src/web/order-overview');
const {orderConsoleBody}=require('../src/web/order-console');
const {render}=require('../src/web/order-header-actions');
const saved={rateCentsPerLb:130,operationalFeeCents:1748,minimumTotalCents:1500,category:'ONE_TIME'};
test('saved quote accompanies order facts, not payment economics',()=>{
 const html=orderOverview({order:{order_number:1,pricing_snapshot:saved},customer:{},shop:{name:'Test shop',address_line1:'Test street'},canMoney:true});
 assert.ok(html.indexOf('Destination laundromat')<html.indexOf('Saved quote'));
 assert.ok(html.indexOf('Saved quote')<html.indexOf('Payment and pricing'));
 assert.equal((html.match(/Saved quote/g)||[]).length,1);
 assert.match(html,/<dt>Destination laundromat<\/dt><dd>Test shop/);
 assert.doesNotMatch(orderOverview({order:{pricing_snapshot:saved},customer:{},canMoney:false}),/Saved quote|Payment and pricing|\$/);
});
test('header actions respect role and unavailable states',()=>{
 assert.equal(render({order:{status:'READY'},can:{}}),'');
 const html=render({order:{status:'READY'},can:{override:true,act:true}});
 assert.equal((html.match(/ disabled /g)||[]).length,3);
 assert.match(html,/Already collected/);assert.doesNotMatch(html,/<form/);
 const ready=render({order:{status:'REQUESTED'},can:{override:true},editHtml:'<form>Editor</form>',cancellationHtml:'<form>Cancellation</form>'});
 assert.match(ready,/commandfor="update-order-dialog"/);assert.match(ready,/commandfor="cancel-pickup-dialog"/);
});
function page(status,tasks,can={override:true,act:true}){
 return orderConsoleBody({order:{id:'o',order_number:1,status,payment_status:'PAID'},customer:{},events:[],labels:[],messages:[],tasks,team:[],laundromats:[],limits:null,can,view:'human',money:n=>'$'+n,shortDate:String,labelState:()=>'',shipdayWorkspace:true});
}
test('delivery action requires the eligible next task and retains required photo',()=>{
 const html=page('OUT_FOR_DELIVERY',[{key:'delivered',done:false}]);
 assert.match(html,/commandfor="deliver-order-dialog"/);assert.match(html,/name="photo"[^>]*required/);
 assert.equal((html.match(/action="\/ops\/orders\/1\/delivered/g)||[]).length,1);
 for(const [status,tasks] of [['READY',[{key:'delivered'}]],['DELIVERED',[]],['CANCELED',[]],['OUT_FOR_DELIVERY',[{key:'scan'},{key:'delivered'}]],['OUT_FOR_DELIVERY',[{key:'delivered',blockedBy:'payment'}]]])assert.doesNotMatch(page(status,tasks),/commandfor="deliver-order-dialog"/);
 assert.doesNotMatch(page('OUT_FOR_DELIVERY',[{key:'delivered'}],{}),/commandfor="deliver-order-dialog"/);
});

test('update and cancel explanations no longer occupy toolbar lines',()=>{
 const html=render({order:{status:'READY'},can:{override:true,act:true}});
 assert.doesNotMatch(html,/<span id="(?:update-order-dialog|cancel-pickup-dialog)-reason"/);
 assert.match(html,/disabled title="Details can only change/);
 assert.match(html,/disabled title="Already collected/);
});

test('manual completion hint describes receipt attestation rather than requiring a photo',()=>{
 const html=render({order:{status:'REQUESTED',order_number:1},can:{override:true}});
 assert.doesNotMatch(html,/A photo is required/);
 assert.match(html,/reason.*receipt/i);
});
