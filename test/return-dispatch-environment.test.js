'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
test('hosted development enables real returns even with NODE_ENV=production; live database stays disabled',()=>{
 for(const [ref,enabled] of [['psrphpgbiifvnlrgvbdg',true],['pauaemlehenfrnjvgzmc',false]]){
  const child=spawnSync(process.execPath,['-e',"const r=require('./src/core/partner-return-runtime'); console.log('RETURN_ENABLED='+r.enabled)"],{
   cwd:path.resolve(__dirname,'..'),encoding:'utf8',env:{...process.env,NODE_ENV:'production',SUPABASE_URL:`https://${ref}.supabase.co`,SUPABASE_SERVICE_ROLE_KEY:'test-key',ADMIN_API_KEY:'test-key',ANTHROPIC_API_KEY:'test-key',STRIPE_SECRET_KEY:'sk_test_placeholder'}});
  assert.equal(child.status,0,child.stderr);assert.match(child.stdout,new RegExp('RETURN_ENABLED='+enabled));
 }
});
