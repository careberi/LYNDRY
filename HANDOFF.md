## 2026-09-28: In-house return collection in development
Neil assigned implementation: Ready to return requests a real Shipday return trip from the laundromat to the customer, assigned to the single active/on-shift in-house driver. Existing ready simulated records offer Request return driver. Never book a third-party courier here. Require completed verified intake, readiness, and settled/waived payment. Preserve shop scope and administrator audit identity. Claims, stable references, saved remote IDs and readback prevent duplicate requests; uncertain mutations require review.

Ready rows show order, weight, driver/contact, collection status and pickup-location ETA, refreshed every 30 seconds. Do not substitute customer-arrival ETA. Original incoming delivery photo remains available on collection detail. Confirm picked up requires fresh matching Shipday order, endpoint and assigned-driver evidence of pickup, then atomically stamps collection and moves READY to OUT_FOR_DELIVERY. Replays are harmless. No customer information enters the portal. This supersedes the earlier simulated-return-only limitation for explicit development in-house requests. Production and third-party dispatch remain disabled. Independent review and Neil click-test pending.

Validation: 1,456 npm tests pass. Migration 0122 passed rolled-back database checks for shop/staff/admin scope, endpoint/driver/plan identity, fresh pickup evidence, payment state and idempotent audit before application only to development. Browser verified #9015’s incoming Shipday delivery image loads (including Shipday’s image/jpg alias), no intake checkbox, and the ready-order request control. No live return was dispatched or collected during verification. Independent review and Neil’s return-flow click-test are still pending.

## 2026-09-28: Shipday delivery photos on laundromat intake
Neil requested the driver's delivery photo on the order intake screen and removal of the handover checkbox and its sentence. Show the verified incoming leg's delivery photos beside the weight form, with full-size viewing and an explicit missing/unavailable state. Incoming rows show Delivered / Awaiting intake and a photo link when available. Keep the same incoming photos visible on the order after intake. Photos are served through the authenticated shop/order scope; do not expose vendor payloads, customer pickup photos, return-to-customer photos, addresses or tracking links. Validate remote order ID/reference and destination before exposing any photo. Only the weight form's explicit Accept laundry submission records receipt; a delivered status or photograph never auto-intakes or reveals instructions. Remove the separate handover confirmation requirement, retaining fresh delivery verification, CSRF, weight limits, actor checks and atomic receipt. This supersedes the checkbox requirement in earlier intake decisions. Development only; do not intake #9015 or alter payments/dispatch during verification.


## 2026-09-28: refresh the laundromat board every 30 seconds
The laundromat laundry board must fetch current order status, driver and ETA data every 30 seconds without reloading the page. Replace only the live board region so the search field and any attendant input outside it remain untouched. If refresh fails, label ETA data unavailable and disable intake links until a later successful refresh. Keep the manual Refresh orders control.
## 2026-09-28: dispatch return delivery from a ready order
Neil requested direct dispatch controls on a READY order when no driver is assigned. On the POS order page, show a prominent Return delivery card with separate third-party and active in-house driver choices. The action creates or reuses the durable Shipday TO_CUSTOMER plan and requests the chosen assignment through the existing dispatcher. Recheck order status, settled or waived payment, active in-house availability, existing assignment state, addresses, destination, card/payment eligibility and live-dispatch restrictions at action time. Never replace an assigned or uncertain driver from this shortcut; send those cases to Shipday assignments for review. Showing the card does not book a driver. Development simulation must say that no real driver is requested. No production activation, payment, SMS or automatic dispatch change.

## 2026-09-28: retire separate spending approvals in development
Neil explicitly chose “Retire the approval workflow throughout.” Remove spending-limit screens, proposals and approval holds from booking, intake, dispatch and payment. Checkout still confirms the displayed price; actual weight uses the saved rate, operational fee and inclusive minimum, with the existing 50 lb ceiling. Weight or courier-cost variance does not silently change the rate. An authorized POS destination change immediately saves the recalculated quote and updates the visible price; no separate customer approval is requested. Archive old pending proposals without recording fictional customer consent; preserve historical audit records. Existing pending proposals are archived; effective prices remain in place until an explicit destination change, without inventing weight or a final bill. Preserve authentication, card/hold checks, payment replay protection, settled-payment requirements, verified receipt and live-dispatch restrictions. No payments, messages or driver bookings as part of migration. This supersedes prior spending-limit and revised-price approval rules for this development flow. Main/production unchanged; independent review and user click-test pending.

Validation: all 1,439 npm tests pass. Development migration 0121 applied after transaction tests for history preservation, disabled old RPCs, quote linking without a cap, immediate destination pricing, stale-price rejection, weight bounds and settled-payment replay. Fixtures rolled back; migration sent no messages, payments or courier bookings. Browser verified the account banner/texting removal, collapsed charge disclosure and reveal, equal contact-button baselines, centered pricing form and homepage button navigation. Screenshots saved. Independent review and Neil’s click-test remain pending.

## 2026-09-28: customer account and contact-page presentation
Neil requested removing the account spending-approval notice and texting prompt, making past-order charges less prominent, and aligning the three contact actions. Past charges stay available in a collapsed View charge disclosure. The presentation changes do not alter historical charges. The separately approved workflow retirement is documented above. Development only.

## 2026-09-28: center the pricing address form
Neil requested centering the address card on the development /pricing page. Add automatic inline margins to its existing bounded-width form; retain input alignment and responsive sizing. The homepage Check my price button links to /pricing, as requested. No pricing or submission behavior changes.

Validation: 1,445 npm tests pass. Migration 0120 applied only to development. Rolled-back database fixtures verified atomic receipt and weight, no partial writes on invalid/unverified/future deliveries, staff isolation, audit actors and replay protection. Browser verified all three tables, real #9015 locked pending pickup, and timed refresh on the signed-in Cedar Lane portal. A separate localhost-only fictional order exercised weight submission, wash reveal and both queue transitions; no real order was intaken. Temporary test server stopped. Public tracking feed verified read-only; driver contacts come from the official API, ETA fallback is display-only and fails to Unavailable. Main/production and live courier assignments unchanged. Independent review and Neil click-test remain pending.

## 2026-09-28: three-section laundry board and combined intake
Neil explicitly assigned development implementation. Show Incoming deliveries, Ready to wash and Ready to return as separate tables. Incoming rows show anonymous LYNDRY order number, driver/contact, status, destination ETA and Intake. Refresh the open board every 60 seconds without touching intake forms. Prefer documented Shipday driver fields; use its public tracking feed only for sanitized supplemental ETA/contact, never eligibility. Keep tracking/customer payloads and raw IDs out of the portal. Missing, failed or stale data is explicit and never authorizes receipt.
Intake submits full-order weight and physical handover confirmation together, rechecks the matching collected Shipday leg and current shop, then records receipt/weight atomically and reveals wash instructions. Remove the separate acceptance/awaiting-intake stage. Retain weight bounds, actor/shop checks, replay safety, customer privacy, payment and return-dispatch guards. Ready to return marks existing intent, not a driver booking promise. This supersedes the previous two-stage receipt flow. Development only; no main/production changes or live courier mutations. Review and user click-test pending.

Verified receipt validation: all 1,439 npm tests pass. Regression checks cover assignment/start versus collection, future dates, wrong remote ID/reference/destination, provider outage, third-party collection confirmation, stale or forged acceptance requests, all-role enforcement, and weight-only intake without wash-data leakage. Database transaction tests cover stale evidence, destination/schedule changes, shop isolation, verified receipt replay, weight bounds and intake replay; fixtures rolled back. Migration 0119 applied only to development. Order 9015 had an unweighed, unverified receipt while Shipday 53977334 remained NOT_ASSIGNED; restored it to REQUESTED with partner_id/at_partner_at cleared, preserving intended Cedar Lane destination and original intake/audit history. Browser verified disabled acceptance and no false success notice. Main/production unchanged; independent review and Neil click-test pending.
## 2026-09-28: verified laundromat receipt; weight-only intake
Neil requires a fresh Shipday collection confirmation for the exact linked pickup and current destination before receipt. Assignment/STARTED alone never qualifies. Future pickup dates, unknown/canceled/failed deliveries, provider outages and mismatched destination stay locked for every role including POS admins. Require attendant confirmation of physical laundry and matching anonymous reference. Persist short-lived server evidence and enforce it again atomically in the intake transaction. Remove internal ticket collection/search/display; keep historical values stored. Weight alone after verified receipt unlocks wash instructions. Correct only demonstrably premature, unweighed #9015 receipt with an audit event. No driver dispatch, charges, messages or production changes. This supersedes the earlier assigned-only acceptance and mandatory ticket rules.

Validation (development, 27 September): 1,434 npm tests pass. Transaction tests verified order/customer/partner update triggers, changes arriving during an in-flight synchronization, explicit reconciliation after failure, and exclusion of simulated trips; fixtures rolled back. Shipday order 53977334 (LYNDRY-DEV-9015-PICKUP) was updated in place and read back: 25 Windham Pl, Glen Rock to Meadowlands Wash, 900 Paterson Plank Rd, Carlstadt; 9am Eastern pickup; laundromat phone +12017712933; front-door note in deliveryInstruction. It remains unassigned, as found; no driver booked/canceled, no new order, no fee/payment change. Shipday ignores pickupInstruction on edit and geocodes address coordinates; verify the documented deliveryInstruction and returned addresses. Dev migration 0118 applied. Sync status verified in POS. Earlier order overview/pricing changes passed 1,428 tests plus transactional approval tests (no invented weight/final bill); customer field actions verified on profile. Main/production unchanged. Independent review and Neil click-test remain pending.
## 2026-09-27: synchronize existing Shipday delivery details
Neil requested that delivery-affecting POS changes update the linked Shipday order, including correcting #9015. Queue changed order destination, pickup time/location and customer/partner contact/address data durably. Update and read back the same remote ID; never create a duplicate, assign a courier, cancel or change provider. Development permits only linked LYNDRY-DEV references. Pre-start in-house/unassigned edits may sync; active third-party trips or started/closed trips require visible dispatch review. Failures remain visible and require reconciliation. Supersedes the earlier no-external-assignment-update limitation for delivery details only. Existing customer price approval remains separate. Main/production unchanged.

## 2026-09-27: order overview and destination pricing
Neil assigned implementation: show pickup/order details, destination and customer pricing prominently; keep customer field actions on the customer profile. Destination changes on unpaid pre-handover development orders create a revised price proposal using the approved quote policy/category and current eligible shop costs. Preserve approved terms until customer approval. Approval must not invent an actual weight or final bill. No automatic change to existing third-party dispatches. No messages sent by this change. Main unchanged; review/click-test pending.

## 2026-09-27: keep portal staff management inside the portal
Neil requested no portal navigation into the LYNDRY backend for any role. Replace the admin Staff redirect with the same shop-scoped staff screen and attendant management used by owners. Remove the Back to laundromat POS link. Logout returns to the shop sign-in, not POS. Keep authorization, CSRF, and shop scope enforced; no role promotion from the portal.

## 2026-09-27: POS administrators can open every laundromat portal
Neil explicitly assigned implementation. Active POS ADMIN accounts, including his 443-745-2665 account, can open each shop from its partner page using their verified POS session. Do not hardcode a phone bypass, create partner-owner records, impersonate an attendant, or broaden sales/driver access. Shop URLs scope each tab and all order actions. Preserve staff-only access to their own shop, existing intake/payment/dispatch rules and audit each admin action as that administrator. This supersedes the earlier instruction to add yourself as a shop owner. Development only; main is unchanged. Review and Neil click-test pending.

## Current: retire obsolete development POS screens
Neil explicitly assigned implementation. Hide Your route, Couriers, How it all works, and What happens to a bag, omit empty navigation groups and the legacy Driver progress section. Authenticated old route/courier screens redirect to Shipday; resource screens redirect to Orders. Preserve delivery backend handlers, payment and reminder behavior. Development only; no main changes or deployment. Review and Neil click-test remain pending.

# Current work — laundromat receipt and intake (27 September 2026)

Neil explicitly requested implementation in development. The laundromat knows no customer identity/contact/address/payment details. A signed-in attendant identifies the incoming order by an anonymous LYNDRY reference, accepts physical delivery, then later saves the laundromat's own internal ticket number and measured full-order weight. The driver need not wait for weighing. Wash instructions must be absent from responses until both intake fields are saved. No bag labels, bag counts or courier PIN requirements in this flow. Courier completion never substitutes for attendant receipt.

Record receipt/intake/ready actors and timestamps; scope every read and mutation to the current shop; prevent duplicate acceptance and active internal-ticket reuse. Permit up to 50 lb, with larger loads referred to LYNDRY. Ready for return creates intent through existing dispatch/payment/spending checks and does not itself mean a driver is coming. Production and previously created external courier assignments remain unchanged. Verify anonymous reference visibility with Uber and DoorDash before live rollout; no public tracking links in the laundromat interface.

Follow-up: Neil requested a modern POS design inspired by the LYNDRY backend. The development laundromat portal now shares its blue-and-white POS shell, scoped sidebar, status totals and filters, anonymous order/internal-ticket search, and responsive task/progress panels. No customer lookup is exposed. Owners retain staff management; attendants retain only their shop's operational actions. Production keeps its current portal.

Validation: 1,424 tests pass. Development migrations 0114 and 0115 applied only to psrphpgbiifvnlrgvbdg. Real database transaction checks cover shop/staff isolation, inactive staff, acceptance without weighing, complete intake gating, replay, duplicate active tickets, weight precision/50 lb ceiling, already-ready legacy intake and audit events; all fixture changes rolled back. Browser verification covered sign-in, anonymous delivery acceptance, ticket and weight entry, instruction reveal, ready-for-return state, ticket search, 390px and 1440px layouts, and responsive navigation. Temporary browser orders #990101–990103, test staff/customer/shops were removed. The existing order #9015 and its live in-house Shipday assignment were not changed.

Limitations: return dispatch remains development simulation and uses the existing payment/spending guards. The portal does not prove a physical handover; staff must match the reference and contact LYNDRY if uncertain. Verify reference visibility through real Uber and DoorDash apps before live rollout. Changes are uncommitted on dev; main and production untouched. Independent review and Neil click-test pending.

---

Development price confirmation simplification: Neil removed the separate editable spending-limit panel. Show one price summary and confirmation button. Confirmation accepts the displayed 50 lb maximum, calculated on the server from the saved quote rather than a submitted amount. Existing controls for changed pricing, overweight orders, and customer ownership remain. The selected plan is named on review.

Validation: 1,410 tests pass. Rendered weekly subscription Sunday 9 a.m. now advances to review for October 4; subscription price matches preliminary $1.54/lb + $4.00. Weekday controls are a required radio group with server enforcement. Next-day partner availability fixes the $1.76 versus $1.82 one-time mismatch for the reported Monday pickup. Dev only; no booking confirmation, payment, message or dispatch performed during this verification.

Development subscription booking clarification: select exactly one weekday on the web booking form, with server validation. When the selected weekday is today but its time has passed, the first development subscription pickup uses the next occurrence. Invalid one-time dates still require correction; approved quotes are revalidated and never silently moved.

Development standard-return correction: evaluate return collection on the day after pickup, after processing is complete. Finishing after closing on drop-off day does not exclude an otherwise available next-day partner. Closed next-day partners and work not ready before next-day closing remain ineligible. This corrects the development checkout day calculation only; existing approved quotes and legacy routing remain unchanged.

Development quote eligibility clarification — 27 September 2026: Neil requires active laundromats to compete on lowest estimated customer total without a phone-number requirement. Scheduled quotes check availability for laundry drop-off and return collection. Address-only estimates remain preliminary until dates are selected. Pricing still requires a usable location and wholesale cost. Contact details must not filter pricing candidates. Existing confirmed quotes remain unchanged.

# Current: development booking price presentation

Show address-based preliminary one-time and subscription estimates on /quote and /account/book plan selection using the checkout economics. Label schedule-dependent estimates and simulated courier costs. Recalculate eligibility after date/time selection. Show one operational fee, inclusive minimum and 30–40 lb total; no separate delivery charge. Center public quote headings. Redesign price approval with a 50 lb limit and maximum at the quoted terms (minimum inclusive), retaining explicit approval for changed prices or spending limits. Reject development order weights above 50 lb before charging. Main/live unchanged.

Validation: 1,402 tests pass. Rendered address estimates and price review verified on localhost; price review stacks at 390px without horizontal overflow. At the verified scheduled terms, $1.82/lb + $5.50 operational fee gives a $30.00 minimum, $60.10–$78.30 estimate, and $96.50 maximum at 50 lb. Courier costs are simulated. All edits remain uncommitted on dev; main untouched. Independent review and Neil click-test pending.

# Current work — public dynamic quote correction

Use the approved checkout pricing calculation on the development public /quote page. Show preliminary address estimates before scheduling; require pickup date/time for final eligible laundromat comparisons; show per-pound rate, one operational fee, inclusive minimum and 30–40 lb estimate for one-time and subscription separately. Remove the separate delivery charge. Center the introductory and rate text. Preview must create no customer/order/approval, charge no payment, and never request a live driver. Preserve existing accepted quotes and main.

---

# Current work — complete development order journey

Neil requested implementation of the gaps identified in the theoretical order walkthrough. Connect address and exact pickup time to eligible laundromat comparison, dynamic quote, explicit customer price/spending approval, saved test card, automatic third-party assignment with in-house override, simulated pickup and return events, actual weight, test payment, completion and contribution reporting. Use approved direct-cost targets 20%/10%/5%, 25% operational allocation, inclusive one-pound minimum. Preserve price snapshots, stop on changed terms/over-limit costs, and require a fresh approved quote for recurring occurrences. No live courier mutations, live charges, main changes or production deployment. Tests and a development end-to-end verification required. Not independently reviewed.

Validation: development orders #9011 (33 lb) and #9012 (10 lb with revised customer approval) reached DELIVERED/PAID through the simulator and Stripe test payments. Wrong-customer approval and payment-before-approval rejected. #9013 booked through the rendered customer flow and left awaiting pickup for Neil. No messages actually sent. Migration 0111–0113 applied only to dev. Development order sequence was behind demo seeds and aligned to existing maximum. Historical migration checksum discrepancies remain unchanged.

Development controls: /dev-orders on pos.localhost:3000. Live Shipday dispatch remains disabled; quote costs and delivery events are simulated. New recurring occurrences and reschedules require fresh pricing approval; automatic recurring re-quote and reschedule replacement workflows remain unfinished. Non-standard paid wash options and promotions have not been verified with dynamic pricing. Independent review and Neil click-test remain pending.

---

# Current work — 27 September 2026

Neil explicitly requested implementation in LYNDRY-dev/dev. Default third-party assignment at the selected pickup dispatch time, with an in-house override. Do not silently reassign collected laundry. Cancel/release the previous courier before reassignment, block ambiguous results, preserve card and customer spending approval checks, and audit changes. Development must not dispatch a real driver. Historical orders retain existing behavior unless explicitly enrolled. Live rollout remains disabled; do not commit, push or merge main.

Follow-up: collect/confirm the customer address before the booking plan screen, remove the fixed pre-quote prices. Existing billing rules are not replaced by a UI change.

Validation: 1,387 tests pass (`npm test`); `git diff --check` passes. Rendered address-first booking checked at desktop and 390px mobile width with no horizontal overflow. Driver assignments page renders at pos.localhost:3000/shipday/assignments. Migration 0110 applied to the development database only. All work remains uncommitted on dev. External review and Neil’s flow review remain pending.

Limitations: dispatch uses a labeled development simulator; live writes remain disabled. Uncertain assignments remain blocked for reconciliation. This booking change collects the address before plan selection and removes premature fixed prices; it does not replace existing billing with the proposed dynamic-pricing formula.

---

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

Validation: npm test passed (1,424 tests). Browser verified all four redirects, retired links and Resources absent, and Driver progress absent. Local development server restarted; no commit, deployment or main changes.

Admin portal validation: all 1,426 tests pass. Database transactions verified active admin access, denied sales/driver/disabled and cross-shop requests, audited admin identity, staff compatibility and replay safety; all test data rolled back. Browser opened Fold & Fluff Bergen using Neil's existing POS session. No real order changes, no messages, no deployment.

Portal Staff validation: 1,426 tests pass. Browser verified Cedar Lane Staff renders inside the portal without POS navigation. Covered scoped add/status actions, CSRF rejection, no role injection and portal logout. Fixed the pre-existing partner-staff field mismatch (last_login_at). No staff records or real orders changed.
