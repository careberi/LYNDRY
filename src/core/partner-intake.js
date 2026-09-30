'use strict';

const OPEN = ['REQUESTED', 'IN_PROCESS', 'AT_PARTNER', 'READY'];
const FIELDS = 'id,order_number,status,partner_id,intended_partner_id,at_partner_at,pickup_date,pickup_time';
const validReference = value => typeof value==='string' && value.trim().length<=64 && !/[\x00-\x1f\x7f]/.test(value);
const validNumber = value => /^[1-9]\d{0,9}$/.test(String(value || ''));
function validIntake(weight) {
  return /^\d+(\.\d{1,2})?$/.test(String(weight)) && Number(weight) > 0 && Number(weight) <= 50;
}
function complete(intake) {
  return Boolean(intake?.received_at && intake.received_verified_at && intake.completed_at && (intake.completed_by || intake.completed_by_admin) &&
    validIntake(String(intake.weight_lb)));
}
async function data(query) { const { data: value, error } = await query; if (error) throw error; return value; }

function createService({ db, settleWeight, enrollReturn, confirmCollection, deliveryInfo, readDeliveryPhoto, checkDelivery = async()=>({ok:false,reason:'delivery_unverified'}) }) {
  const scope = partner => `partner_id.eq.${partner},and(partner_id.is.null,intended_partner_id.eq.${partner})`;
  async function find(partner, number, includeCollected=false) {
    if (!validNumber(number)) return null;
    return data(db.from('orders').select(FIELDS).or(scope(partner)).eq('order_number', Number(number))
      .in('status', includeCollected ? [...OPEN,'OUT_FOR_DELIVERY'] : OPEN).maybeSingle());
  }
  async function list(partner) {
    const orders = await data(db.from('orders').select(FIELDS).or(scope(partner)).in('status', OPEN).order('order_number'));
    if (!orders.length) return [];
    const ids = orders.map(o => o.id);
    const policy=await data(db.from('laundromat_workflow_settings').select('weight_tolerance_lb').eq('id',true).maybeSingle());
    const [intakes, plans, legs] = await Promise.all([
      data(db.from('partner_order_intakes').select('*').eq('partner_id', partner).in('order_id', ids)),
      data(db.from('shipday_dispatch_plans').select('order_id,leg,state,mode,assigned_name,shipday_order_id,external_reference,simulation').in('order_id', ids)),
      data(db.from('courier_deliveries').select('order_id,leg,status,delivery_id').in('order_id', ids)),
    ]);
    const views = [];
    // Bound concurrent lookups across a busy board.
    for(let start=0;start<orders.length;start+=4) views.push(...await Promise.all(orders.slice(start,start+4).map(async order => {
      const intake = intakes.find(i => i.order_id === order.id);
      const stage = complete(intake) ? (intake.ready_at ? 'READY' : 'WASH') : 'INCOMING';
      const leg = stage === 'READY' ? 'TO_CUSTOMER' : 'TO_PARTNER';
      const live = deliveryInfo && stage !== 'WASH' ? await deliveryInfo(order,partner,leg) : null;
      const plan = plans.find(p => p.order_id === order.id && p.leg === leg);
      const courier = legs.find(p => p.order_id === order.id && p.leg === leg && p.delivery_id &&
        !['canceled','cancelled','failed'].includes(String(p.status).toLowerCase()));
      const assigned = plan?.state === 'ASSIGNED' && Boolean(plan.shipday_order_id);
      if(stage==='INCOMING' && live?.assignmentVerified!==true)return null;
      return {
        // Only anonymous operational fields leave this service for a template.
        number: order.order_number,
        stage,
        reference: plan?.external_reference || `LYNDRY #${order.order_number}`,
        courier: plan ? (plan.mode === 'IN_HOUSE' ? 'LYNDRY' : plan.simulation ? 'Development courier' : 'Third-party courier') : courier ? 'Courier' : 'LYNDRY',
        driver: live ? live.driver || null : assigned ? plan.assigned_name : null,
        driverPhone: live?.driverPhone || null,
        deliveryStatus: live?.provider_status || null,
        deliveryReason: live?.reason || null,
        etaMinutes: live?.etaMinutes ?? null,
        scheduledArrivalAt:live?.scheduledArrivalAt||null,
        scheduledPickupAt:live?.scheduledPickupAt||null,
        checkedAt: live?.checked_at || null,
        deliveryPhotoCount: live?.ok ? (live.deliveryPhotos || []).length : 0,
        assigned: live ? Boolean(live.driver) : Boolean(assigned || courier),
        canAccept: stage === 'INCOMING' && live?.ok === true,
        canCollect: stage === 'READY' && plan?.state === 'ASSIGNED' && live?.canCollect === true,
        returnNeedsRequest: stage === 'READY' && !courier && (!plan || (!['PROCESSING','REVIEW'].includes(plan.state) && (plan.simulation || ['PLANNED','BLOCKED'].includes(plan.state)))),
        receivedVerified: Boolean(intake?.received_verified_at),
        intakeComplete: complete(intake),
        washCompletedAt: intake?.wash_completed_at || null,
        washStartedAt: intake?.wash_started_at || null,
        shopReference: intake?.shop_reference || null,
        weightCheckEnabled: policy?.weight_tolerance_lb != null,
        returnCheckStatus: intake?.return_check_status || 'PENDING',
        returnDueAt: intake?.return_due_at || null,
        weight: stage==='READY' && ['PASSED','RELEASED'].includes(intake?.return_check_status) ? intake.return_weight_lb : null,
        receivedAt: intake?.received_at || null,
        officeReview: intake?.needs_review === true || intake?.return_check_status === 'HELD',
      };
    })));
    return views.filter(Boolean);
  }
  async function history(partner, requestedPage=1) {
    const page=/^[1-9]\d{0,4}$/.test(String(requestedPage)) ? Number(requestedPage) : 1;
    const size=10, start=(page-1)*size;
    // Completion here means this shop confirmed handoff, not customer delivery.
    const rows=await data(db.from('partner_order_intakes')
      .select('return_weight_lb,shop_reference,collected_at,orders!inner(order_number)')
      .eq('partner_id',partner).not('collected_at','is',null)
      .order('collected_at',{ascending:false}).order('order_id',{ascending:false})
      .range(start,start+size));
    return {page,hasNext:rows.length>size,orders:rows.slice(0,size).map(row=>({
      number:row.orders.order_number,weight:row.return_weight_lb,shopReference:row.shop_reference,collectedAt:row.collected_at,
    }))};
  }
  async function detail(partner, number) {
    if (!validNumber(number)) return null;
    const view = (await list(partner)).find(o => String(o.number) === String(number));
    if (!view) return null;
    if(view.stage==='INCOMING'){
      const order=await find(partner,number);
      const checked=await checkDelivery(order,partner);
      view.canAccept=checked.ok;view.deliveryReason=checked.reason;
      view.driver=checked.driver||null;view.driverPhone=checked.driverPhone||null;view.assigned=Boolean(checked.driver);
      view.deliveryStatus=checked.provider_status||null;
      view.deliveryPhotoCount=checked.ok ? (checked.deliveryPhotos || []).length : 0;
      view.deliveryPhotoUnavailable=!checked.ok;
    }
    if (['WASH','READY'].includes(view.stage)) {
      const order=await find(partner,number);
      const proof=order && deliveryInfo ? await deliveryInfo(order,partner,'TO_PARTNER') : null;
      view.deliveryPhotoCount=proof?.ok ? (proof.deliveryPhotos || []).length : 0;
      view.deliveryPhotoUnavailable=!proof?.ok;
      // Fetch preferences only after saved intake; structured wash choices only.
      const row = await data(db.from('orders').select('preferences,customers(preferences)')
        .eq('order_number', Number(number)).eq('partner_id', partner).in('status', OPEN).maybeSingle());
      if (!row) return null;
      const prefs = row.preferences && Object.keys(row.preferences).length ? row.preferences : row.customers?.preferences;
      view.washLines = require('./wash').washLines(prefs);
    }
    return view;
  }
  // Resolve photos only through the signed-in shop and the verified incoming leg.
  // Raw vendor URLs, customer addresses and pickup proof never reach the template.
  async function deliveryPhoto(partner,number,index) {
    if (!/^(0|[1-9]\d?)$/.test(String(index)) || Number(index)>=20) return null;
    const order=await find(partner,number);
    if (!order || !deliveryInfo || !readDeliveryPhoto) return null;
    const proof=await deliveryInfo(order,partner,'TO_PARTNER');
    const url=proof?.ok ? proof.deliveryPhotos?.[Number(index)] : null;
    return url ? readDeliveryPhoto(url) : null;
  }
  const working = new Set();
  async function act({ partner, staff, number, action, weight, shopReference='' }) {
    const order = await find(partner, number, action==='collect');
    if (!order) return { ok: false, reason: 'unavailable' };
    if (action === 'intake' && !validReference(shopReference)) return {ok:false,reason:'invalid_reference'};
    if (action === 'intake' && !validIntake(weight)) return { ok: false, reason: 'invalid_intake' };
    if (!['intake','wash-complete','ready','request-return','collect'].includes(action)) return { ok: false, reason: 'unavailable' };
    if (working.has(order.id)) return { ok: false, reason: 'busy' };
    working.add(order.id);
    try {
      if(action==='collect')return confirmCollection ? await confirmCollection({order,partner,staff}) : {ok:false,reason:'unavailable'};
      if(action==='request-return') {
        if(order.status!=='READY')return {ok:false,reason:'unavailable'};
        const requested=await enrollReturn(order,{partner,actor:staff.name}).catch(()=>null);
        return requested?.ok ? {ok:true,notice:'return_requested'} : {ok:false,reason:'return_pending'};
      }
      if(action==='intake'){
        const verified=await checkDelivery(order,partner);
        if(!verified.ok)return {ok:false,reason:verified.reason};
      }
      const result = await data(db.rpc(staff.isOpsAdmin ? 'record_partner_intake_admin' : 'record_partner_intake', {
        p_order: order.id, p_partner: partner, [staff.isOpsAdmin ? 'p_admin' : 'p_staff']: staff.id, p_action: action,
        p_tracking: action === 'intake' ? shopReference.trim() || null : null,
        p_weight: ['intake','ready'].includes(action) && validIntake(weight) ? Number(weight) : null,
      }));
      if (!result.ok) return result;
      if (result.already && action === 'intake') return {ok:true,notice:'intake'};
      if (action === 'intake') {
        // Existing pricing/payment rules run only after the atomic intake save.
        // Failure keeps the receipt and measured weight; no customer data reaches the shop.
        const current = await data(db.from('orders').select('*').eq('id', order.id).eq('partner_id', partner).single());
        try {
          const settled = await settleWeight(current, { by: { actor: staff.name + ' (laundromat intake)' } });
          await data(db.from('partner_order_intakes').update({needs_review: !settled?.ok}).eq('order_id',order.id).eq('partner_id',partner));
          if (!settled?.ok) return { ok: true, notice: 'office_review' };
        } catch {
          await data(db.from('partner_order_intakes').update({needs_review:true}).eq('order_id',order.id).eq('partner_id',partner));
          return { ok: true, notice: 'office_review' };
        }
      }
      if (action === 'ready') {
        // Readiness survives a failed request; the board exposes a safe retry.
        const requested=await enrollReturn(order,{partner,actor:staff.name}).catch(()=>null);
        return {ok:true,notice:requested?.ok?'return_requested':'return_pending'};
      }
      return { ok: true, notice: action };
    } finally { working.delete(order.id); }
  }
  return { list, history, detail, deliveryPhoto, act };
}
module.exports = { createService, validIntake, validReference, validNumber, complete };
