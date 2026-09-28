'use strict';

// Persist PROCESSING before vendor writes. An interrupted attempt requires
// reconciliation; a timer must never blindly repeat a potentially paid request.
function createDispatcher({ store, provider, validate, now = Date.now }) {
  async function run(id, override = null, actor = 'scheduler') {
    const before = await store.get(id);
    if (!before || !['PLANNED', 'BLOCKED', 'ASSIGNED'].includes(before.state)) return { ok: false, reason: 'Busy or requires reconciliation.' };
    if (!override && before.state === 'ASSIGNED') return { ok: true, already: true };
    if (!override && Date.parse(before.dispatch_at) > now()) return { ok: false, reason: 'Not due.' };
    if (override && (!['IN_HOUSE', 'THIRD_PARTY'].includes(override.mode) || (override.mode === 'IN_HOUSE' && !override.driverId))) return { ok: false, reason: 'Choose a driver.' };
    if (override && before.state === 'ASSIGNED' && before.mode === override.mode &&
        (before.mode === 'THIRD_PARTY' || String(before.driver_id) === String(override.driverId))) return {ok:true,already:true};
    const plan = await store.claim(before);
    if (!plan) return { ok: false, reason: 'Another action is processing this assignment.' };
    let mutation = false;
    let current = plan;
    async function save(patch, event) {
      current = await store.save(current, patch, { actor, event, at: new Date(now()).toISOString() });
    }
    async function block(reason) { await save({ state: before.state === 'ASSIGNED' ? 'ASSIGNED' : 'BLOCKED', problem: reason }, 'BLOCKED'); return { ok: false, reason }; }
    try {
      const checked = await validate(plan);
      if (!checked.ok) return await block(checked.reason);
      const mode = override?.mode || plan.mode;
      const driverId = override?.driverId || plan.driver_id;
      if (mode === 'IN_HOUSE') {
        const drivers = await provider.drivers();
        if (!drivers.some(d => String(d.id) === String(driverId) && d.isActive === true && d.isOnShift === true)) return await block('The selected driver is inactive or offline.');
      }
      if (before.state === 'ASSIGNED') {
        if (!override) return await block('Already assigned.');
        const live = await provider.status(plan.shipday_order_id, plan);
        if (!['pending','REQUESTED','ASSIGNED','STARTED','NOT_ASSIGNED','unassigned'].includes(live.status)) return await block('Collection may have started. Resolve the handover with dispatch; reassignment is blocked.');
        if (plan.mode === 'THIRD_PARTY') {
          if (!override.acceptCancellationFee) return await block('Confirm possible cancellation charges before replacing this courier.');
          mutation = true;
          const canceled = await provider.cancel(plan.shipday_order_id);
          if (!canceled?.ok) throw new Error('Cancellation is unconfirmed. Reconcile before assigning another driver.');
          await save({ assigned_name: null, state: 'PROCESSING' }, 'THIRD_PARTY_CANCELLED');
        } else {
          mutation = true;
          const canceled = await provider.unassign(plan.shipday_order_id);
          if (!canceled?.ok) throw new Error('Driver release is unconfirmed. Reconcile before reassignment.');
          await save({ assigned_name: null }, 'IN_HOUSE_RELEASED');
        }
      }
      await save({ mode, driver_id: mode === 'IN_HOUSE' ? String(driverId) : null }, 'ASSIGNMENT_SELECTED');
      if (Date.parse(plan.dispatch_at) > now() && before.state !== 'ASSIGNED') {
        await save({ state: 'PLANNED', problem: null }, 'PLANNED');
        return { ok: true, planned: true };
      }
      if (!current.shipday_order_id) {
        mutation = true;
        const reference = checked.trip.externalId || `LYNDRY-${plan.order_id}-${plan.leg}`;
      const created = await provider.createOrder({ ...checked.trip, externalId: reference });
        await save({ shipday_order_id: String(created.id), external_reference: reference }, 'SHIPDAY_ORDER_CREATED');
      }
      // Recheck payment and order eligibility immediately before assignment,
      // including after cancellation or order creation.
      const latest = await validate(current);
      if (!latest.ok) { await save({state:'BLOCKED',problem:latest.reason},'BLOCKED'); return {ok:false,reason:latest.reason}; }
      mutation = true;
      const assigned = mode === 'IN_HOUSE'
        ? await provider.assignDriver(current.shipday_order_id, driverId)
        : await provider.assign(current.shipday_order_id, { maxFeeCents: latest.budgetCents, requirePin: false, leaveAtDoor: plan.leg === 'TO_CUSTOMER' });
      if (!assigned?.ok) { await save({ state: 'BLOCKED', problem: assigned?.reason || 'Assignment refused.' }, 'ASSIGNMENT_REFUSED'); return assigned || {ok:false}; }
      await save({ state: 'ASSIGNED', problem: null, assigned_name: assigned.courier?.name || assigned.service || (mode === 'IN_HOUSE' ? `Driver ${driverId}` : 'Third-party courier'), tracking_url: assigned.trackingUrl || null }, 'ASSIGNED');
      return { ok: true };
    } catch (err) {
      const reason = mutation ? 'Assignment outcome needs reconciliation. Automatic retries are paused.' : 'Dispatch checks failed. No driver was requested.';
      await save({ state: mutation ? 'REVIEW' : (before.state === 'ASSIGNED' ? 'ASSIGNED' : 'BLOCKED'), problem: reason }, 'REVIEW_REQUIRED').catch(() => {});
      return { ok: false, reason };
    }
  }
  return { run };
}

// A local wall clock can occur twice or never at a daylight-saving change.
// Refuse those times instead of silently shifting the customer's selection.
function dispatchInstant(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return null;
  const base = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(base)) return null;
  const format = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const matches = [4,5].map(h=>new Date(base+h*3600000)).filter(d=>format.format(d)===`${date} ${time}`);
  return matches.length === 1 ? matches[0].toISOString() : null;
}
module.exports = { createDispatcher, dispatchInstant };
