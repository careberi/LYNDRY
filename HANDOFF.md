# HANDOFF

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
