'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

function render(env, project, origin) {
  const script = `
    const {config}=require('./src/config');
    require.cache[require.resolve('./src/db')]={exports:{from(table){
      if(!['orders','shipday_dispatch_plans'].includes(table))throw Error('Unexpected database table '+table);
      const rows=table==='orders'?[{id:'order',order_number:9016,status:'REQUESTED',pickup_date:require('./src/core/booking').today(),pickup_time:'16:00',customers:{name:'Test customer'}}]:
        [{order_id:'order',state:'ASSIGNED',assigned_name:'Test driver',simulation:false}];
      const q={select(){return q;},order(){return q;},eq(){return q;},in(){return q;},then(resolve){return Promise.resolve({data:rows}).then(resolve);}};return q;
    }}};
    const checkout=require('./src/core/dev-checkout');
    const admin=require('./src/routes/admin');
    const shop=require('./src/web/shop-page');
    const html=admin.adminPage({title:'Orders',body:'',user:{id:'test',name:'Admin',role:'ADMIN',status:'ACTIVE',drives:true}});
    const portal=shop.page({title:'Laundry board',body:'',signedIn:true,shop:{id:'test',name:'Shop'}});
    const login=shop.phoneStep({shop:{id:'test',name:'Shop'}});
    const booking=require('./src/core/shipday-booking-runtime');
    (async()=>{
      let dashboard='';
      if(config.supabase.isDevelopment){
        const handler=admin.router.stack.find(layer=>layer.route?.path==='/ops'&&layer.route.methods.get).route.stack.at(-1).handle;
        const res={type(){return res;},send(value){dashboard=value;}};
        await handler({query:{},opsUser:{id:'test',name:'Admin',role:'ADMIN',status:'ACTIVE',drives:true}},res,error=>{throw error;});
      }
      console.log(JSON.stringify({development:config.supabase.isDevelopment,checkout:checkout.enabled,
        html,portal,login,dashboard,automaticDispatch:booking.enabled}));
    })().catch(error=>{console.error(error);process.exitCode=1;});
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', script], {
    cwd:path.join(__dirname,'..'), encoding:'utf8',
    env:{...process.env,NODE_ENV:env,SUPABASE_URL:'https://'+project+'.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only',APP_BASE_URL:origin,POS_HOST:'',SHIPDAY_API_KEY:'',PRICING_MODEL:'DYNAMIC'},
  }));
}

test('local and Railway development render the same POS navigation and enable the same checkout',()=>{
  const local=render('development','psrphpgbiifvnlrgvbdg','http://localhost:3000');
  const hosted=render('production','psrphpgbiifvnlrgvbdg','https://lyndry-production-de2c.up.railway.app');
  for(const result of [local,hosted]) {
    assert.equal(result.development,true);
    assert.equal(result.checkout,true);
    assert.doesNotMatch(result.html,/href="\/ops\/(?:run|couriers|process|journey)"/);
    assert.match(result.html,/href="\/ops\/shipday"/);
    assert.match(result.portal,/pos-sidebar/);
    assert.match(result.dashboard,/Pickup dispatch/);
    assert.match(result.dashboard,/Test driver/);
    assert.doesNotMatch(result.dashboard,/Driver progress|1 order with no driver/);
  }
  assert.match(local.login,/href="http:\/\/pos.localhost:3000\/partners\/test\/portal"/);
  assert.match(hosted.login,/href="https:\/\/pos-dev.lyndry.com\/partners\/test\/portal"/);
  assert.doesNotMatch(hosted.login,/pos.localhost/);
  assert.equal(hosted.automaticDispatch,false,'Presentation must not activate a hosted courier worker');
});

test('live and unrecognized databases do not acquire development POS capabilities',()=>{
  for(const project of ['pauaemlehenfrnjvgzmc','unrecognized']) {
    const result=render('production',project,'https://lyndry.com');
    assert.equal(result.development,false);
    assert.equal(result.checkout,false);
    assert.match(result.html,/href="\/ops\/run"/);
    assert.doesNotMatch(result.login,/Sign in as a LYNDRY administrator/);
    assert.equal(result.automaticDispatch,false);
  }
});
