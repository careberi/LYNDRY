# HANDOFF

## Current change — keep pickup bag actions on their order

Neil assigned implementation on 3 October after live orders 2090 and 2091
appeared to share a bag. Their stored assignments were correct. The route
returned to the first unfinished pickup, and the individual bag page rejected
the new scan-first flow because bag_count is not set until Finish Pickup.

Allow existing scanned bags and the next open slot using the derived pickup
tasks, preserve the selected unfinished pickup after a route action, show the
order number on its bag page, and do not list an optional unscanned bag as a
required weighing. A weighed bag is not called loaded before pickup finishes.
Do not alter bag ownership, payments, reminders, or card gates in this change.
Regression tests must cover two unfinished orders and a null bag count.
External review and Neil's click test are still outstanding.

Issue: Audit-fix — collect door, hold page, select lists  
Owner of the keyboard: Neil  
Status: implemented locally; branch `fix/audit-hold-doors` cut from current main. Apply the patch, then click-test. Do not merge to main yet.

## Goal

Close the eight holes from the 15 September repo audit. Do not touch QR, clips, CLEAN50, cash rules, or admin.js.

## What must land (patch in the Grok project: artifacts/fix-audit-hold-doors.patch)

1. `fulfilment.collect()` uses `dispatch.collectRefusal()` + `heldCustomerIds()` — sibling hold and refused show-up hold refuse at the mutation, not only on the board.
2. `issues.ensurePaymentHold()` + `billing.ensureExistingHolds()` so already-FAILED in-hand rows page once. `markFailed()` uses balance, not price.
3. `heldCustomerIds()` selects `amount_paid_cents`.
4. Board `inHand` includes `AT_PARTNER` so a plant-floor hold is named.
5. `chargeOrder()` comment no longer teaches deliver-and-chase for in-hand laundry.
6. Reminder skip log names `show-up hold refused` instead of `no card on file`.
7. `DECISIONS.md` live pricing line: $2.00 / $1.80. $39-bag notes stay historical.

## Must not happen

- Do not commit to main until Neil click-tests Collected on a sibling of a held order.
- Do not WAIVE #2060.
- Do not start QR, clips, CLEAN50, or $80 auth on this branch.

NEXT — apply `fix-audit-hold-doors.patch` onto this branch (or paste to Claude: implement HANDOFF on fix/audit-hold-doors). Then click-test and merge.
