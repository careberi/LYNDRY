"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const filename=require.resolve('../src/routes/account'),load=createRequire(filename),source=fs.readFileSync(filename,'utf8');
const model=require('../src/core/weight-based-pricing'),dynamic=require('../src/core/dynamic-order-pricing');
const policy={pricingMethod:model.METHOD,minimumTotalCents:2800,marginBps:{SUBSCRIPTION:1000,ONE_TIME:2000,WHOLESALE:500},processingBps:290,processingFixedCents:30,referenceWeightLb:33,operationalFeeBps:2500,otherCostCents:0,otherCostPerLbCents:0};
const shop={id:'test',eligible:true,wholesaleCentsPerLb:70,customerBaseCentsPerLb:100,pickupCents:699,returnCents:699,source:'SHIPDAY',expiresAt:'2099-01-01'};
function render(category='ONE_TIME') {
 const categories=Object.fromEntries(['SUBSCRIPTION','ONE_TIME','WHOLESALE'].map(key=>[key,dynamic.quoteCandidates([shop],{policy,category:key,estimatedWeightLb:30})]));
 const context={require:load,config:{supabase:{isDevelopment:true}},subscription:load('../core/subscription'),escapeHtml:load('../web/layout').escapeHtml,carried:()=>''};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function planChoice('),source.indexOf('const WEEKDAY_LABELS'))+';this.render=repeatForm;',context);
 return context.render({}, {snapshot:categories[category],categories});
}
test('frequency is inside subscription card before its submit action and absent from one-time',()=>{
 const html=render(),cards=html.match(/<section class="weight-plan booking-weight-option">[\s\S]*?<\/section>/g);
 assert.equal(cards.length,2);assert.match(cards[0],/How often/);assert.ok(cards[0].indexOf('How often')<cards[0].indexOf('Choose subscription'));
 assert.match(cards[0],/type="submit" name="plan" value="SUBSCRIPTION"/);assert.match(cards[1],/type="submit" name="plan" value="ONE_TIME"/);assert.doesNotMatch(cards[1],/How often/);assert.doesNotMatch(html,/MONTHLY|Continue/);
});
test('wholesale customer sees actual wholesale rates under both pricing method headings',()=>{
 const html=render('WHOLESALE');assert.equal((html.match(/data-category="WHOLESALE"/g)||[]).length,2);assert.match(html,/<h2>Subscription<\/h2>/);assert.match(html,/<h2>One-time pickup<\/h2>/);
});
