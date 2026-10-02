# Order Flow Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Repair the recorded customer messaging, intake and completion defects without changing payment timing or dispatch eligibility.
**Architecture:** Reuse saved quote formatting and provider observers. Add bounded completion reconciliation beside the existing message workers; atomic database checks protect races and replay.
**Tech Stack:** CommonJS, Express, node:test, Supabase PostgreSQL, existing browser automation.
**Spec:** ../specs/2026-10-02-order-flow-fixes-design.md

## Global Constraints
Development only; main untouched. No Uber or DoorDash requests; approved in house driver only. Fake SMS and test payments. Preserve historical prices, no card safeguards, uncertain dispatch and weight holds.

## Review Focus
Missing quote cannot create a hold or route. Suppressed or opted out messages do not prevent operational delivery reconciliation. A terminal status never bypasses wrong driver or endpoint checks. Replay and concurrent completion cannot duplicate status events. Partial wash/intake and unpaid deliveries never complete.

### Task 1: Saved pricing, truthful messages and simulated labels
**Files:** src/core/booking.js, orders.js, booking-intents.js, delivery-sms.js, notify.js; src/web/message-delivery-note.js; src/routes/admin.js; test/order-flow-messages.test.js.
**Interfaces:** Existing bookPickup/customer/order and intent save options retain signatures; new messageDeliveryNote(message) returns escaped HTML.
- [ ] Write and run regressions for missing development quotes at order and intent boundaries, frozen dynamic confirmation/hold, conditional turnaround, card gated bag reminders and collected update, historical simulation labels and logged simulated status.
- [ ] Add minimal guards and copy using saved snapshots; leave historical actual messages and prices intact.
- [ ] Run focused tests and full isolated suite. Correct the two baseline stale portal assertions to current existing UI without changing that UI.
- [ ] Commit only this logical change on codex/order-flow-customer-messages.

### Task 2: Portal intake and verified final lifecycle
**Files:** src/core/partner-intake.js, delivery-sms-runtime.js, delivery-sms-worker.js, delivery-sms.js, dev-checkout.js, shipday-order-sync-runtime.js; src/core/delivery-completion.js and delivery-completion-runtime.js; src/web/order-overview.js; supabase/migrations/0142_verified_delivery_completion.sql; focused regression tests.
**Interfaces:** createCompletion({load,observe,savePhoto,complete,now}).reconcile(orderNumber) uses existing observe evidence and returns changed/already/skipped; store completion hook runs independently of notification eligibility. Database complete_verified_dev_delivery checks exact plan version, remote and endpoints, with proof and payment in one transaction.
- [ ] Write and watch regressions fail for carrierless verified intake, malformed/future/failed trips, delivered proof completion, missing proof/unpaid/stale/changed trip refusal, suppression independence and harmless replay; test persisted billable weight and terminal sync presentation.
- [ ] Implement minimal service and atomic migration without any provider writes.
- [ ] Run focused tests, full isolated suite, and development database parity/replay checks in rolled back transactions before controlled migration activation.
- [ ] Commit independently on codex/order-flow-lifecycle.

### Task 3: Review, publish and browser retest
**Files:** dated testing followup report, scoped HANDOFF/DECISIONS/TESTING sections, project knowledge notes.
- [ ] Review the complete branch diff with a fresh reviewer; fix material findings with regressions and repeat full tests.
- [ ] Push the verified commits to dev without force or main merge. Preserve the original dirty checkout.
- [ ] Retest actual development UI with the candidate build; use deterministic intercepted Shipday fixtures for new lifecycle cases and read only original provider proof. Do not fabricate actual driver handovers. Confirm customer pricing and copy, portal intake visibility, billable weight, terminal state and message labels.
- [ ] Record actual results, remaining physical/role variants and development commit; update required knowledge notes.
