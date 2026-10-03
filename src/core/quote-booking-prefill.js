'use strict';
// Temporary editable form defaults only. Never authentication or verified address data.
const {config}=require('../config');
const COOKIE_NAME='lyndry_quote_address';
const MAX_AGE=30*60*1000;
function fields(value) {
 const part=(key,max)=>typeof value?.[key]==='string'?value[key].trim().slice(0,max):'';
 const street=part('street',120),unit=part('unit',60),town=part('town',80),zip=part('zip',5);
 if(!street||!town||!/^\d{5}$/.test(zip))return null;
 return {street,unit,town,zip};
}
function remember(res,value) {
 if(!config.supabase.isDevelopment)return;
 const address=fields(value);if(!address)return;
 res.cookie(COOKIE_NAME,Buffer.from(JSON.stringify({...address,issuedAt:Date.now()})).toString('base64url'),{
  httpOnly:true,sameSite:'lax',secure:config.env==='production',path:'/account',maxAge:MAX_AGE
 });
}
function read(req) {
 if(!config.supabase.isDevelopment)return null;
 try {
  const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE_NAME+'='));
  if(!cookie||cookie.length>1500)return null;
  const value=JSON.parse(Buffer.from(decodeURIComponent(cookie.slice(COOKIE_NAME.length+1)),'base64url').toString('utf8'));
  const age=Date.now()-value.issuedAt;
  if(!Number.isFinite(age)||age<0||age>MAX_AGE)return null;
  const address=fields(value);if(!address)return null;
  return {address_line1:address.street,address_line2:address.unit,city:address.town,postal_code:address.zip};
 }catch{return null;}
}
function clear(res){res.clearCookie(COOKIE_NAME,{path:'/account',httpOnly:true,sameSite:'lax',secure:config.env==='production'});}
module.exports={COOKIE_NAME,remember,read,clear};
