Historical implementation record. Neil retired this workflow on 28 September 2026; see HANDOFF.md, DECISIONS.md and migration 0121. Old approvals remain audit history; they no longer gate dispatch, intake or charging.

# Spending approvals — development implementation

User-authorized scope: implement customer-approved order spending limits in
LYNDRY-dev on dev. Do not change main or enable production dispatch.

## Implemented

- `/ops/spending`, linked from Admin and the order console. Authorized staff
  enter an all-in estimate, proposed limit and separate courier trip estimates.
- `/account/orders/:id/spending`, restricted to the order's signed-in customer.
  Approval requires an unchecked consent box. Customer account lists pending
  approval requests. Saving a proposal does not send a message or take money.
- Database functions serialize proposals and approvals, check customer ownership
  and the displayed revision, and retain an approval history. Staff can propose
  but cannot approve on the customer's behalf. Paid/completed/canceled orders
  cannot receive or approve new proposals.
- Payment checks cover ordinary charges, settlement through a card hold, and
  direct hold capture. Unknown approval state fails closed. A free settlement
  remains free and does not attempt a payment.
- For orders with spending controls, both courier estimates are checked before
  pickup and the return estimate before return dispatch. Missing, expired or
  over-budget quotes pause dispatch. The checked quote reference goes to booking.
  Changed proposals are checked again after quoting. A spending hold is shown
  separately from a card decline.
- Existing orders without a proposal retain existing behavior. Proposals do not
  retroactively claim that a customer approved anything.

## Explicit implementation boundary

This is the staff-created order approval workflow. Automatic creation of a
proposal during website/SMS booking is NOT connected yet. It must show the full
quote before confirmation and must not silently treat a booking as approval.
Recurring orders do not yet inherit or receive a spending allowance.

The separate pricing-economics module implements the proposed calculations and
comparison tests. It is not wired into billing. Category targets are not
silently assigned example values. There is no admin policy activation control
yet. Live Shipday integration, date/capacity-based partner selection, automatic
cost recalculation and completed-order cost reconciliation remain outstanding.
The courier checks currently use the existing provider adapter (Uber test mode
in this development environment), not Shipday.

Courier costs above either recorded trip budget conservatively pause dispatch
even if the approved total has headroom. Staff must revise the complete estimate
and obtain approval. Never add a courier charge outside the approved total.

## Verification

- 1,362 tests pass, including 11 spending-control regressions.
- Development SQL transaction tests passed for proposal persistence, customer
  ownership, approval, duplicate submission and stale-revision rejection. All
  test writes rolled back.
- Authenticated POS form inspected on desktop and at 390px mobile width; no
  horizontal page overflow. Customer consent rendering and origin checks tested.
- Migrations 0108 and 0109 applied only to dev project psrphpgbiifvnlrgvbdg.
- No commit, push, main modification or production deployment.
- Independent review and Neil's complete customer-flow click test remain open.
