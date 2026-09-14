# HANDOFF

Issue: Payment Hold — laundry we hold with money outstanding never reaches the doorstep
Owner of the keyboard: Neil
Status: spec

## Goal

`dispatch.collectable()` is already "one predicate, many doors", and it gates
only the **pickup** door. Order #2060 is long past that door: collected, weighed,
charged, declined, and sitting washed at Best Wash. Nothing looks at payment on
the later legs, so it can still be drawn as a delivery stop.

Widen the same idea to the legs that matter, derive Payment Hold rather than
storing it, block the customer's other pickups while it stands, and rewrite the
deliver-and-chase rule this reverses.

## What Payment Hold is

```
balance(order)     = price - card captured - cash recorded
paymentHold(order) = IN_OUR_HANDS.includes(status) && balance > 0
```

Derived, never stored. No `payment_hold` column, no `PART_PAID` on the enum.
Until the cash ledger exists there is no partial payment, so `balance > 0` is
exactly `payment_status === 'FAILED'` — **but write it as balance from the
start**, so the ledger drops in later without re-opening the rule.

## What it gates — Neil's lock, 14 September

Hold keeps the bag out of the customer's doorway, not off Best Wash's floor.

| Leg | |
|---|---|
| **Pickup** | `collectable()` as today, **plus the sibling block** |
| **Plant drop-off** | already blocked, and not by this work — `loadVan()` charges before it writes `van_confirmed_at`, and `board()` only promotes a stop to the drop-off leg once that stamp exists. New unpaid work cannot reach a laundromat by accident. **Do not add a clause for it** |
| **Retrieval** | **allowed even on hold**, so a laundromat's shelf is not our warehouse |
| **Delivery** | **refused while `paymentHold`** |

## Must happen

- The four rows above, and nothing more. The gate is delivery-only plus the
  sibling block.
- **The sibling block is customer-level**, so `collectable(order)` cannot answer
  it alone: a customer holding an in-hand order with a balance has their *other*
  pickups blocked. #2061 parks until #2060's balance is $0. One `in` query per
  board keyed by customer id — thirty orders must not mean thirty queries.
- **Entering hold rings the office immediately.** No 24-hour clock. It raises an
  issue and pages, the way a handoff does. This is an ops call, **not** a `tel:`
  on the driver's page and **not** masked Telnyx voice — neither exists and
  neither is in scope here.
- **Paused, not cancelled.** Status, bags and history are untouched. Nothing
  transitions.
- **It stays visible.** A held order comes off the delivery leg and is named on
  the screen, the way `uncollectable` is drawn in red on the routing board. A
  stop that silently vanishes reads as the board losing an order.
- **`DECISIONS.md` and `CLAUDE.md` both say the opposite today** and are rewritten
  in this branch:
  > A declined card never holds up a delivery. We deliver and chase by text.

  Until that sentence changes the next reader ships the clothes and chases.
- A `WAIVED` order stays routable everywhere. Nothing to charge is not cannot
  charge.

## Must not happen

- Do not store the flag. Do not add an enum value. Derive the word from the
  number.
- Do not gate the plant drop-off. `van_confirmed_at` already does it, and an
  `IN_PROCESS` order that has not been charged is a **doorstep** stop with the
  driver standing at it — gating it would take his current stop off his own
  screen.
- Do not gate retrieval. Neil's lock.
- Do not build the cash ledger here if it would stall the gate.
- Do not build the $80 authorization, capture, or overage. Still unlocked.
- Do not rebuild `loadVan()`. The door decline path is correct and finished.
- Do not waive #2060 to clear it. Cash handed over is not a waiver, and an
  `order_events` row is a note, not a tender.
- Do not cancel a held order.

## Edge cases

- **Retrieved bags wear clips, and the pool is finite.** A bag collected off a
  laundromat gets a van clip and keeps it until it is handed back at the door.
  Hold means that never happens, so #2060's three bags would hold three of the
  50 in `config.routing.vanClips` indefinitely. Decide what "held" bags do:
  unclip and store at base, or sit in the van wearing their numbers. This is the
  one operational consequence the retrieval lock creates and nothing currently
  answers it.
- **`IN_PROCESS` + `UNPAID`, mid-doorstep.** Real, transient, and *not* Payment
  Hold. Must stay on the driver's screen.
- **A held order is still overdue.** #2060 was collected Saturday and was due back
  end of Sunday. The turnaround badge keeps counting. Honest — do not suppress it.
- **Stripe switched off** (`needsCardOnFile()` false): nothing is ever `FAILED`,
  so nothing is ever held. Same fail-open the round already has.
- **The sibling block reaches across orders**, so a customer with one bad order
  loses service on every other. That is the lock; it should be obvious on the
  screen why a pickup is parked, naming the order that caused it.

## Files Claude expects to touch

- `src/core/dispatch.js` — `balance()`, `paymentHold()`, the delivery-leg refusal,
  the sibling look-up, and returning held orders the way `uncollectable` is.
- `src/core/fulfilment.js` — the matching refusal on the delivery step, so a
  screen that hides a stop is not the only guard.
- `src/core/issues.js` — raise and page on entering hold.
- `src/web/routing-board.js` — name what came off and why.
- `DECISIONS.md`, `CLAUDE.md` — the deliver-and-chase reversal.
- `test/` — a new file.
- `HANDOFF.md`

Not on this branch: the cash ledger, the $80 auth, QR, the order console, any
telephony.

## Grok review

(empty until Grok has seen a diff)

## Neil

Spec only. Nothing implemented — say go.

Two things true right now that this file does not fix:

1. **Neither PR is merged.** `origin/main` is still `3f191b1`, so the reminder
   gate is not live either. This branch is cut from `fix/reminder-collectable`
   and carries both it and the docs.
2. **#2060 can still be drawn as a delivery stop** until this ships. That is the
   live hole, and the only thing stopping it today is somebody knowing not to.
