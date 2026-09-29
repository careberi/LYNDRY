'use strict';
const db=require('../db');
const {config}=require('../config');
const {dispatchInstant}=require('./shipday-dispatch');
const {createBookingDispatcher}=require('./shipday-booking-dispatch');
const shared=require('./shipday-dispatch-runtime');
const enabled=config.env==='development'&&config.supabase.projectRef==='psrphpgbiifvnlrgvbdg';
const provider=require('../providers/couriers/shipday').createClient({apiKey:config.shipday.apiKey,allowWrites:enabled});
const data=shared.result;
const find=id=>data(db.from('orders').select('*,customers(*)').eq('id',id).single());
function eligible(order,setting) {
  return enabled && setting.enabled && setting.automatic_pickups_from && order.dev_quote_id &&
    Date.parse(order.created_at)>=Date.parse(setting.automatic_pickups_from);
}
async function enqueue(order,{recover=false,manual=false}={}) {
  if(!enabled)return null;
  const setting=manual?null:await shared.settings();
  if(!manual&&!eligible(order,setting)&&!(recover&&setting.enabled&&order.order_number===9016))return null;
  // Manual preparation is scoped to the requested order, never a historical backfill.
  if(manual){
    const checked=await validate({order_id:order.id},{manual:true});
    if(!checked.ok||!checked.canAssign)throw Error(checked.reason||'Payment checks must pass before assignment.');
  }
  const at=dispatchInstant(order.pickup_date,String(order.pickup_time||'').slice(0,5));
  if(!at||order.status!=='REQUESTED')return null;
  await data(db.from('shipday_dispatch_plans').upsert({order_id:order.id,leg:'TO_PARTNER',mode:'THIRD_PARTY',simulation:false,booking_dispatch:true,dispatch_at:at},{onConflict:'order_id,leg',ignoreDuplicates:true}));
  let plan=await data(db.from('shipday_dispatch_plans').select('*').eq('order_id',order.id).eq('leg','TO_PARTNER').single());
  if(manual && plan.state==='CANCELED' && !plan.shipday_order_id && !plan.assignment_requested_at) {
    plan=await shared.store.save(plan,{state:'PLANNED',problem:null,next_attempt_at:null},{event:'MANUAL_DISPATCH_AFTER_REMOVAL',actor:'manual-enrollment',at:new Date().toISOString()});
  }
  if(plan.simulation && ['PLANNED','BLOCKED'].includes(plan.state) && !plan.shipday_order_id && plan.mode==='THIRD_PARTY') {
    plan=await data(db.from('shipday_dispatch_plans').update({simulation:false,booking_dispatch:true,state:'PLANNED',problem:null,version:plan.version+1}).eq('id',plan.id).eq('version',plan.version).eq('state',plan.state).is('shipday_order_id',null).select('*').maybeSingle());
  }
  if(plan?.booking_dispatch && !plan.shipday_order_id && !plan.trip_snapshot && ['PLANNED','BLOCKED'].includes(plan.state) && Date.parse(plan.dispatch_at)!==Date.parse(at)) {
    plan=await shared.store.save(plan,{dispatch_at:at,state:'PLANNED',problem:null,next_attempt_at:null},{event:'PICKUP_RESCHEDULED',actor:'booking-dispatch',at:new Date().toISOString()});
  }
  return plan?.booking_dispatch?plan:null;
}
async function validate(plan,{manual=false}={}) {
  if(!enabled)return {ok:false,reason:'Automatic pickup dispatch is unavailable.'};
  if(!manual&&!(await shared.settings()).enabled)return {ok:false,reason:'Automatic dispatch is paused.'};
  const order=await find(plan.order_id),customer=require('./order-address').customerFor(order,order.customers);
  if(order.status!=='REQUESTED')return {ok:false,reason:'Pickup is canceled or already in progress. Review the Shipday job.'};
  const at=dispatchInstant(order.pickup_date,String(order.pickup_time||'').slice(0,5));
  if(!at||Date.parse(at)<=Date.now())return {ok:false,reason:'The requested pickup time has passed. Choose a new pickup time before requesting a driver.'};
  if(!customer?.default_payment_method_id)return {ok:false,reason:'Save a payment method before dispatch.'};
  const billing=require('./billing'),dispatch=require('./dispatch');
  const refusal=dispatch.collectRefusal(order,await dispatch.heldCustomerIds([order.customer_id]));
  if(refusal)return {ok:false,reason:refusal.detail};
  const paymentsOk=order.payment_status==='WAIVED'||billing.holdIsFresh(order);
  if(!paymentsOk)return {ok:false,reason:billing.holdDueNow(order)?'A current payment authorization is required before scheduling the courier.':'Waiting for the existing payment authorization window before scheduling the courier.'};
  const partnerId=order.partner_id||order.intended_partner_id;
  if(!order.dev_quote_id||order.pricing_snapshot?.source!=='SHIPDAY'||!partnerId)return {ok:false,reason:'A confirmed Shipday-backed quote and laundromat are required.'};
  const shop=await require('./partners').find(partnerId);
  if(!shop||shop.status!=='ACTIVE')return {ok:false,reason:'The selected laundromat is inactive.'};
  const hours=await require('./partners').hoursForAll();
  if(!require('./dev-checkout').scheduleFits(shop,hours.get(shop.id)||[],order.pickup_date,String(order.pickup_time).slice(0,5)))return {ok:false,reason:'The pickup no longer fits the laundromat operating hours.'};
  const other=await data(db.from('courier_deliveries').select('status').eq('order_id',order.id).eq('leg','TO_PARTNER').not('delivery_id','is',null));
  if(other.some(d=>!['canceled','cancelled'].includes(String(d.status).toLowerCase())))return {ok:false,reason:'Another courier booking exists. Reconcile it before dispatch.'};
  const budgetCents=order.pricing_snapshot.pickupCents;
  if(!Number.isSafeInteger(budgetCents)||budgetCents<0)return {ok:false,reason:'The saved pickup courier budget is missing.'};
  const prefs=order.preferences||customer.preferences||{};
  const addressOf=require('./courier-legs').addressOf;
  const from=addressOf(customer,{name:customer.name,phone:customer.phone,notes:prefs.dropoff_spot||prefs.special_instructions||'Collect the laundry bag at the requested pickup location.'});
  const to=addressOf(shop,{name:shop.name,phone:'+12017712933',notes:'Deliver laundry to the attendant. Match LYNDRY order #'+order.order_number+'. Photo proof only; no signature.'});
  // The initial placeholder is replaced with the scheduled courier estimate
  // before creation. Subsequent validations retain the saved arrival target.
  const trip={externalId:'LYNDRY-DEV-'+order.order_number+'-PICKUP',from,to,pickupReadyAt:at,
    dropoffDeadlineAt:plan.trip_snapshot?.dropoffDeadlineAt||new Date(Date.parse(at)+3600000).toISOString(),manifest:[{name:'LYNDRY laundry pickup #'+order.order_number,quantity:1}]};
  const acceptEstimate=row=>{
    const date=new Date(row.deliveryTime);
    if(!Number.isFinite(date.getTime()))return false;
    const local=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
    return local.slice(0,10)===order.pickup_date && require('./partners').isOpenAt(hours.get(shop.id)||[],new Date(order.pickup_date+'T12:00:00Z').getUTCDay(),local.slice(11,16));
  };
  return {ok:true,canAssign:paymentsOk,reason:paymentsOk?null:'Waiting for the existing payment authorization window before requesting a courier.',trip,budgetCents,acceptEstimate};
}
const dispatcher=createBookingDispatcher({store:shared.store,provider,validate});
// Per-request validation avoids changing the global scheduler switch, including
// when an automatic tick and an administrator's request overlap.
const manualDispatcher=createBookingDispatcher({store:shared.store,provider,validate:plan=>validate(plan,{manual:true})});
function run(id,override=null,actor){return (override?manualDispatcher:dispatcher).run(id,override,actor);}
let busy=false,timer;
async function tick() {
  if(!enabled||busy||!config.shipday.apiKey)return;
  busy=true;
  try {
    const setting=await shared.settings();
    if(setting.enabled&&setting.automatic_pickups_from){
    const rows=await data(db.from('orders').select('*').eq('status','REQUESTED').not('dev_quote_id','is',null).gte('created_at',setting.automatic_pickups_from));
    for(const order of rows)await enqueue(order);
    }
    const stale=await data(db.from('shipday_dispatch_plans').select('id,version').eq('booking_dispatch',true).eq('state','PROCESSING').lt('updated_at',new Date(Date.now()-180000).toISOString()));
    for(const p of stale)await data(db.from('shipday_dispatch_plans').update({state:'REVIEW',version:p.version+1,problem:'Dispatch was interrupted. Reconcile the existing Shipday reference before retrying.'}).eq('id',p.id).eq('version',p.version).eq('state','PROCESSING'));
    // Pausing new automatic requests must not stop observing accepted manual jobs.
    const states=setting.enabled&&setting.automatic_pickups_from?['PLANNED','BLOCKED','REQUESTED','ASSIGNED']:['REQUESTED','ASSIGNED'];
    const plans=await data(db.from('shipday_dispatch_plans').select('id').eq('booking_dispatch',true).eq('simulation',false).in('state',states).order('updated_at').limit(50));
    for(const plan of plans)await dispatcher.run(plan.id);
  } finally {busy=false;}
}
function start(){if(!enabled||timer)return;timer=setInterval(()=>tick().catch(e=>console.error('Scheduled pickup dispatch:',e.message)),30000);timer.unref();tick().catch(e=>console.error('Scheduled pickup dispatch:',e.message));}
async function booked(order){const plan=await enqueue(order);if(plan)dispatcher.run(plan.id).catch(e=>console.error('Booked pickup dispatch:',e.message));}
module.exports={enabled,provider,eligible,enqueue,validate,booked,run,tick,start};
