# Booked order walkthrough: 2026-10-02

**Result: completed through final delivery, with failures and recovery. Not a clean golden-path PASS, independent review, pilot approval or production sign-off.**

## Scope and evidence

Run QA-9025-20261002 used synthetic order #9025 on local development POS, development database PSRPHPGBIIFVNLRGVBDG, Stripe test payments, fake SMS/MMS and only the authorized LYNDRY in-house driver. Pickup 54193647; return 54194241; driver 559952. No Uber or DoorDash request. No physical bags or real customer texts. Neil advanced the return in the driver app and uploaded a keyboard test photo. That proves the software attachment path, not physical bag delivery or a carrier receipt.

Address fix 2cb7d08 was pushed to dev. The integrated walkthrough ran on codex/order-detail-actions at that commit plus other existing uncommitted changes. Those changes are not represented by the address commit. The adjacent fingerprint identifies relevant source at final capture; it is not a frozen deployed build or proof of migration parity. Main was not modified. No application code was changed during this final test leg.

Evidence classes are kept separate: actual browser/SQL/Shipday/test-Stripe observations; isolated provider/store contract tests; read-only message previews. Unit/mock passes do not make an unexecuted live variant pass.

## Executed walkthrough

| Check | Result | Evidence and limits |
|---|---|---|
| Fresh quoted booked order | PASS at service boundary | #9025 accepted a saved dynamic quote and a test hold. Initial setup used the normal quote/booking services, not a full first-time customer browser checkout. |
| Pickup assignment and POS edit | PASS | LYNDRY assigned to the original pickup; changed pickup instruction read back on the same trip. No replacement. |
| Pickup completion to shop intake UI | FAIL | Dispatcher completion cleared the carrier. The portal hid the incoming order despite normal receipt verification succeeding. The normal intake service was used to continue; this is a workaround, not a passing portal intake test. |
| Intake and test settlement | PASS at service boundary | 30 lb intake; settled inclusive total $59.16. Ledger contains two test card payment entries totaling $59.16. |
| Wash and return-weight hold | PASS for mismatch variant | 33 lb return weight triggered hold; shop retained bags; admin resolution released the order and resumed return request. Passing-tolerance live variant was not exercised. |
| Return creation/address verification | FAIL, fixed and retested | Creator added NJ to a blank saved state; strict verification used the state-free saved address. Existing trip became REVIEW and collection/message observation failed. Address repair preserves saved fields and accepts only the exact historical NJ addition for eligible existing development returns. Seven regressions and actual same-trip recheck passed. No replacement/reassignment during repair. |
| Driver-app pickup and shop handoff | PASS after repair | Exact return/driver recognized. Portal Confirm Pickup recorded handoff, shop history showed completed collection and POS moved OUT_FOR_DELIVERY. Old detail URL then became unavailable, preventing another UI confirmation. Direct stale handoff POST was not tested live. |
| Out-for-delivery and ETA updates | PASS in fake sender | One milestone and two subsequent ETA-change messages appeared in the conversation. Actual rows were SIMULATED. No claim of pickup-leg intermediate messages: dispatcher completion lost the driver and that leg stayed rank 0. |
| Premature final sync | PASS | Before remote delivery, Sync with Shipday refused matching completed return and said No status changed. Order stayed OUT_FOR_DELIVERY. A server-restart interruption was retried after recovery. |
| Driver completion/proof | PASS in approved provider test | Shipday readback: one exact return, ALREADY_DELIVERED, matching assigned LYNDRY driver, one supported proof photo. Initial READY_TO_DELIVER/no-photo readback cleared once app completion finished. |
| Delivered text and picture | PASS in fake sender | One delivered text followed by one photo caption/attachment in the same QA customer conversation. Photo opened and displayed the submitted keyboard test image. Outbox photo path matched the message path, recipient and TO_CUSTOMER remote ID. Anonymous photo request returned 404 and no image. Carrier delivery remains untested. |
| POS final completion | PASS with explicit sync | Before sync, provider and message worker reported delivery while POS remained OUT_FOR_DELIVERY. Sync with Shipday saved proof and set DELIVERED/PAID, with one reconciliation event. Current behavior requires explicit sync; automatic lifecycle completion is not proven. |
| Final sync replay | PASS | UI said already delivered, no changes. SQL comparison preserved two payment IDs/total, five #9025 message IDs, linked trip IDs/plan versions and the single completion event. Exactly one delivered text and one photo caption. This was a repeated request, not a multi-process race. |
| Terminal controls | PASS in browser | Update, Cancel and Mark delivered disabled after completion. No new dispatch or payment was requested. |
| Customer price and wording audit | FAIL | See defects below. Correct-snapshot preview was generated without calling a sender. |

## Addressed

The saved-address creation/verification disagreement was implemented, regression tested, retested on the original linked return and pushed as 2cb7d08. It unblocked verified collection and return notifications without relaxing order, driver, uniqueness or other address checks. No other issue below is claimed fixed by that commit.

## What broke the flow and remains outstanding

| ID | Severity | Observed failure / next action |
|---|---|---|
| FLOW-01 | P1 | Completed pickup with carrier removed disappears from incoming portal even though intake verification succeeds. Align list and guarded intake eligibility; retest the ordinary browser intake path. |
| FLOW-02 | P1, repaired | Missing saved state versus inserted NJ caused REVIEW, disabled collection and empty return messages. Repaired locally and pushed. Independent review and Neil acceptance still required. |
| PRICE-01 | P1 | Newly created test orders #9022/#9024 lack dynamic snapshots; #9022 card-saved confirmation fell back to $2/lb and $45 minimum. #9025 current snapshot preview correctly quoted $59.16 at 30 lb and $43.59 minimum. Require accepted quotes on every new development entry/resumption; preserve historical accepted prices/messages. New booking paths were changed by other work and need their own retest. |
| COPY-01 | P1 | Both legacy visible confirmation and current-snapshot preview unconditionally promise next-day return. Use the approved conditional promise across entry paths. |
| COPY-02 | P1 | Legacy confirmation says payment is taken at the customer door; current quoted QA order settled after shop intake. Make wording describe the applicable saved pricing/payment model without changing payment timing. |
| COPY-03 | P2 | Pickup movement text lacks bag-out instructions; collected text lacks conditional turnaround expectation. These were message previews/code observations, not a live pickup-leg pass. |
| STATUS-01 | P1 | Return plan remains REVIEW/version 4 even after verified handoff and final DELIVERED order. Reconcile only the same verified trip; never request a second driver merely to clear review. |
| STATUS-02 | P2 | Detail-sync warning calls completed in-house pickup automatic courier dispatch. After final delivery the return warning says closed/review manually. Distinguish lifecycle verification from editing metadata and show useful terminal state. |
| STATUS-03 | P2 | Paid and finally DELIVERED order still shows Billable weight Not finalized despite the measured 30 lb bill. Determine the authoritative field before changing display or billing. |
| SMS-01 | P2 | Conversation labels fake SMS and photo messages Sent. Display simulation honestly; actual outbox states are SIMULATED. |
| LIFECYCLE-01 | P1 readiness gap | Remote delivery and delivered/photo messages do not automatically advance POS. Explicit verified sync works. Decide and test the required automatic/operational completion contract before launch. |

## Remaining test coverage

The booked-order walkthrough is finished. The broader tracker remains open for a clean browser booking-to-intake path, actual attendant/owner/driver/sales/customer sessions and cross-shop authorization, passing-tolerance return weights, physical bag/photo checks, driver offline/lost-response recovery, true concurrent submissions/workers, STOP racing queued delivery/photo, late proof and controlled provider failures, cancellation races, hosted development parity and the one-shop pilot. Existing isolated tests cover several contracts but are not substitutes for these live variants.

The public pricing page was observed with a disabled empty-address submit. Its Google address component uses a closed shadow root and the browser tool could not enter it; quote selection was not completed or classified as an application defect. No new customer consent/account or order was submitted in that side check.

## Automated validation

Final npm test with test/helpers/no-external-network.cjs inherited by test processes: **1738 passed, zero failed**, 2026-10-02. Focused lifecycle/role/hold/recovery/SMS/photo tests: **95 passed, zero failed**. That focused set contains an isolated suite wrapper and provider/store mocks; it is not 95 external journeys. Earlier address-focused run: 43 passed, including seven new regressions after three pre-fix failures.

## Final checkpoint and next owner

#9025 DELIVERED and PAID. Test ledger total unchanged. Pickup 54193647 COMPLETED. Return 54194241 delivered remotely but local plan REVIEW remains. Weight check RELEASED and shop handoff retained. One delivered text and one photo message, both simulated. One POS reconciliation event. Keep historical test evidence and original trip IDs. Do not delete/recreate the order to hide failures.

Neil assigns the bounded issue drafts; implementation and regression retests follow separately. Grok review, Neil acceptance, pilot and production gates remain open. These notes are development evidence, not shipped main.
