# Current change: real development texts

Neil explicitly assigned Codex implementation. Enable outbound SMS only on the
known hosted Railway development site, with explicit opt-in. Neil explicitly
authorized real texts to any recipient selected by the app, with no additional
recipient or link restriction. Use the live Telnyx sender and credentials. Prefix
every development text with DEVELOPMENT on its own line, including direct login
codes. Log the prefixed body
and truthful send outcomes. Route development delivery receipts to development
without changing the live number's incoming-reply webhook. Preserve production,
local send blocking, Stripe test mode, and separate development data. No payment,
order, reminder scheduling or driver route rules change. Tests and development
deployment required. Independent review and Neil handset acceptance are pending.

Validation: 1844 tests passed with placeholder service credentials, development
feature settings, and external network blocked. New coverage includes arbitrary
app-selected recipients, direct login-message prefixes, exact logged/deduplicated
bodies, carrier failures, delivery callback overrides and unchanged production
selection. No additional recipient or link restrictions were implemented.

# 20261002 Complete development publication

Neil explicitly requested committing every pending development change and pushing to dev, never main. Commit b6ac765 captures all 112 pending files, including booking and pricing, customer pages, order layout and photos, pickup observation, migration records and tests. The current merge retains the six newer origin/dev commits through b2b0b68, including verified delivery completion and the data refresh record. Overlaps preserve delivery completion checks, manual delivery attestation, both sets of notes and current portal behavior.

Validation: fresh merged npm test passed 1838 tests with external network blocked; zero failures. Credential pattern scan found no matches in the 112 pending files. This publication does not apply migrations or perform customer, courier, payment or messaging actions. Existing migration filenames and checksums are retained. Earlier uncommitted notes are historical; this entry records their publication scope. Independent review and remaining Neil acceptance remain pending. Main is unchanged.

# Current change: photos on the POS order page

Neil requests viewing the bags at intake or laundromat drop off and at customer delivery directly on the order detail screen. Show verified proof from each linked Shipday leg in separately labelled thumbnail groups with full size links. Use existing employee order and customer permissions, exact stored job and reference identity and both addresses, and the existing bounded private image proxy. Missing and unavailable photos need truthful states. Do not confuse a signature or a customer pickup image with delivery proof. Preserve statuses, intake, payment, messaging and dispatch. Development only; tests, browser verification and required Obsidian notes to follow.

Validation: 1810 tests passed with external network blocked. Both photos loaded at 1284 pixels in the browser and full size viewing was verified. Required Obsidian notes updated. Uncommitted development only; independent review, real phone check and Neil acceptance pending.

# Current change: correct stale awaiting intake label

Neil requested correction of the pickup label after intake. Use the existing at_partner_at receipt timestamp in order list and detail labels. Show Received by laundromat after confirmed receipt; keep awaiting intake only before receipt and avoid claiming it when no order context is supplied. Preserve order, payment and dispatch behavior. Regression reproduced before fixing. Browser verified the corrected label. Development only, independent review pending.

# Current change: observe verified Shipday pickup progress

Neil reported Shipday showing Picked Up while POS remained Dispatch needs review for order 9028. Poll linked real booking pickup plans in REVIEW, REQUESTED and ASSIGNED through a read-only observer even when new automatic dispatch is paused. Require matching job ID, reference, addresses and schedule, matching in-house driver or corroborated third-party progress. Record provider status separately. Never create, assign, cancel, transition laundry receipt, charge, or send messages from this observer. Show verified collection in the dashboard pickup-in-progress group and disable reassignment after collection. Preserve all existing business guards.

Development migration 0144 applied. The server observer verified existing job 54235368 and cleared its stale review warning. Browser confirmed Picked up and Pickup in progress for 9028. Full suite passed 1803 tests; all nine focused observer tests passed after adding the paused-dispatch regression and correcting the group eyebrow. Independent review and Neil acceptance remain pending. Development only, uncommitted; main unchanged.

# Current change: permit editing an undispatched scheduling hold

Neil reported the false existing courier job warning on order 9028. The development database rejected every REVIEW plan, including the exact historical UTC boundary rejection that occurred before any remote write. Migration 0143 permits editing only that booking pickup hold with no Shipday ID, assignment attempt, trip snapshot or external reference. Actual remote IDs and courier records remain blocked, and uncertain states get an accurate review warning. Preserve all other access, concurrency, pricing and dispatch checks.

Validation: reproduced the failure against the existing database function. All 12 transactional SQL regression variants pass with fixture edits rolled back. Applied only migration 0143 to development and recorded its checksum. All 1795 npm tests pass. Browser order editor opens. No order data or selected pickup time was persistently changed, and no courier request was submitted. Independent review and Neil acceptance remain pending.

# Current change: order screen layout and spacing

Neil requested implementation on 2026-10-02. Improve the order detail page hierarchy, unify order details and saved quote card styling, group pickup and laundry facts, and align dispatch labels and controls. Retain payment and pricing presentation and all existing authorization, pricing, payment, dispatch and reminder rules. Scope to order screen markup and CSS. Verify desktop, narrow viewport, keyboard controls and the existing test suite. Development only; independent review and Neil click testing remain pending. Validation: 1795 tests passed; 12 focused tests passed after final polish. Desktop and 390px responsive checks found no horizontal overflow. Internal note dialog verified without submission. Real phone testing remains pending. Obsidian development notes updated.

## Current change: evening pickup across midnight UTC

Neil explicitly assigns Codex implementation and requests removing the exclusive Claude Code editing role from AGENTS.md. Fix valid evening pickup and arrival times crossing a UTC date boundary without shifting either instant. Preserve the existing Shipday delivery date and separate UTC times, matching its dashboard conversion. Cover creation and editing. Allow explicit manual retry of the exact legacy boundary hold only when no Shipday ID, assignment attempt or trip snapshot exists; retain order, card, hours, identity and duplicate checks. No automatic recovery of review states or real driver request during verification. Regression tests and npm test required. Development only; independent review and Neil acceptance remain pending.

Validation: 1795 tests passed with external network blocked. Browser verified order 9028 retry controls; its original time is now past. No real driver request. Uncommitted on codex/order-detail-actions; independent review and Neil acceptance pending. Obsidian development notes updated.

## 20261002 Approved pickup preparation and fixed quote timing

Development booking offers Earliest available and Schedule for later. Earliest resolves once to a quarter hour at least 15 minutes ahead, configurable with SHIPDAY_PICKUP_LEAD_MINUTES from 15 to 120. The scheduled picker uses quarter hour increments. Preparation time means bag readiness, not guaranteed driver arrival. Show the selected Shipday offer pickup estimate separately. Keep the resolved UTC time through pricing, review and dispatch. Continuing checkout validates the fixed time rather than applying the initial buffer again. Fewer than five minutes remaining requires a refreshed pickup and price review. This supersedes the historical ten minute past time grace for new quotes. Existing historical order handling is retained.

Use fresh supported Shipday offers and the lowest valid price that fits readiness and laundromat hours. A provider pickup timing rejection blocks quoting or assignment rather than silently selecting a more expensive surviving offer. API failure blocks price confirmation. Scheduled times never silently move. Midnight and ambiguous or nonexistent Eastern daylight saving times are tested. Quoting does not request a driver; card and payment guards remain.

Local browser verification reached scheduled price review with the same bag ready time and courier estimate. Earliest was refused when shop hours did not fit. A transient quote failure blocked progress; a subsequent fresh request recovered. No booking, payment, driver assignment or message was submitted. Uncommitted development work only; independent Grok review and Neil acceptance remain pending.

## 20261002 Shipday is the only customer delivery price source

Neil explicitly requires fresh address based Shipday API quotes for public pricing, booking pricing, plan comparisons and POS repricing. Choose the lowest valid supported third party offer separately for pickup and return, subject to pickup and arrival eligibility. Never use configured in house labour, fuel, mileage, static bands or simulated prices as a substitute. A missing, expired or failed API quote withholds pricing and blocks booking. Recheck both directions at booking; changed fees require a new customer price review. Reject unused historical in house quotes. Keep existing accepted orders and payments unchanged until an explicit correction, and keep pricing source separate from driver assignment. Quoting must never dispatch a driver. This supersedes the in house pricing decision and the earlier higher courier fee policy. Development only; main is unchanged.

## 20261002 Development data refresh

Neil requested clearing development laundromat, customer and order data, followed by a selective import of production customer and order history. He explicitly included saved card references and existing payment links.

Completed in the development database only. Imported 78 customers, 35 orders, 1161 customer messages, 45 payment links and 29 payment history rows. Twenty customers have saved card references. No raw card numbers were copied. Customer contact details and wash preferences were retained. Original order numbers, dates, weights and recorded amounts were retained. Three open production orders became CANCELED in development with the original status recorded in notes. Customer pricing categories were mapped to the development schema. Automatic conversations and follow ups were paused for all imported customers, and delivery notifications were suppressed for imported orders. Recurring schedules, laundromat assignments and active dispatch records were not imported. Existing payment references and links still refer to production Stripe objects.

Production was accessed through a read only transaction. No production writes, Stripe actions or message sends were performed. Each selected imported field and all record counts were checked before committing the development transaction. The development order sequence was preserved. Recovery copies remain local and are excluded from Git. Admin access and development settings were preserved.

This commit records the completed data operation only. No application code or customer records are included. Fresh tests on the development branch: 1718 passed, zero failed, using placeholder service credentials. Independent review and Neil click testing remain pending. Publication is to dev only, never main.

## 20261002 Order flow defects fixed and retested

Neil assigned automatic implementation and development publication. Commits 85f9cc9, f114823 and 23b95be address the scoped quote and message, intake, verified completion, original return metadata, billable weight and terminal presentation defects. Fresh isolated npm test: 1718 passed, zero failed. Four agent review findings fixed with failing regressions first. Migration 0142 activated only in development. Actual original QA return reconciled to COMPLETED without changing order, payment, messages, proof or trip ID; replay harmless. Playwright actual POS and memory only full lifecycle retest passed. See docs/testing/2026-10-02-order-flow-fix-retest.md. Preserve historical old message text and saved prices. Main unchanged. Grok review, physical and hosted variants and controlled production pilot remain unclaimed.

## 20261002 Order flow fixes assigned for automatic execution

Neil explicitly assigns implementation of the dated QA defects, followed by development push and browser retest without additional approval gates. Spec: docs/superpowers/specs/2026-10-02-order-flow-fixes-design.md. Plan: docs/superpowers/plans/2026-10-02-order-flow-fixes.md. Preserve historical prices and payment timing. New development bookings require accepted quotes; customer updates must describe conditional turnaround and simulated sends honestly. Restore verified portal intake visibility and exact proof based automatic final completion with replay protection. No third party driver requests or real texts. Main untouched. Implementation is not independent Grok review or pilot approval.

## 20261002 Finished booked order walkthrough and open defects

Neil requested completion of the booked-order test, updated notes and development push. QA #9025 reached DELIVERED/PAID with verified original Shipday return and test proof photo, one simulated delivered text/photo and explicit POS sync. Repeated sync did not change payments, messages, trip IDs/versions or completion event. Final isolated npm test: 1738 passed; 95 focused lifecycle assertions passed. See docs/testing/2026-10-02-order-flow.md and TESTING.md. The address fix 2cb7d08 is pushed; other shared source work remains excluded from this documentation change. Flow required intake service workaround and address repair, so this is completed with failures/recovery, not clean sign-off. Pricing and wording, return REVIEW metadata, sync labels, simulation badge and billable weight defects remain open. Broader role/physical/concurrency/hosted/pilot variants and independent review remain pending. No main merge, third-party dispatch or live messages.

## 20261002 Approved Shipday address verification repair

Neil approved the bounded design and requested commit and push to development, without merging main. New returns preserve the saved state rather than inventing NJ. Existing non-simulated in-house numeric LYNDRY development RETURN references accept only the exact historical NJ addition when the saved state is blank. Shared formatting and matching serve portal return verification and customer delivery observation. Explicit states, other address fields, linked identity, unique remote result and driver checks remain strict. Pickup verification stays strict. No payment, reminder, routing, customer-copy or duplicate-dispatch changes.

Implementation: src/core/delivery-address.js, partner-delivery-gate.js, partner-return.js and delivery-sms.js; test/delivery-address-verification.test.js. Three reproductions failed before implementation; seven regression cases and 43 focused tests passed. Fresh full npm test on the development working tree with external network blocked: 1738 passed, zero failed. Other uncommitted work was preserved and excluded from this scoped commit.

The original QA return passed read-only verification with the same linked trip and LYNDRY driver. The normal worker recorded a simulated out-for-delivery message. Browser pickup confirmation succeeded, the shop board recorded the handoff, and POS showed OUT_FOR_DELIVERY with the shop audit event. Shop completion is handoff to the driver, not final customer delivery. No replacement trip, reassignment, real SMS or payment action. Final delivery and photo verification, independent review and Neil acceptance remain pending. Development only; main is unchanged.

## 20261002 Testing organization and local baseline

Neil requested organized independent end-to-end testing, then one laundromat test-environment pilot, then production. TESTING.md is the single tracker, with actual state/role/issue matrices, failure and recovery cases, evidence requirements and launch gates. This documentation work changes no application behavior and does not replace the implementation specs below.

Fresh isolated npm test on the dirty codex/order-detail-actions checkout at 8517473: 1708 passed, zero failed. Two attempted non-loopback connections were refused by a temporary test-process guard; attribution remains open. This is local assertion coverage, not provider integration or launch approval. First integrated test is return-weight issue resolution with failed/uncertain return dispatch and safe recovery. Exact writable test environment, Stripe test scope, Shipday driver/account and messaging interception need confirmation. No server start, provider request, customer write, production change, branch switch, commit or push. Independent review, integrated runs, Neil click tests and physical pilot remain pending.

Final verification found concurrent source/test work in this shared checkout. It was preserved. The recorded 1708-pass run does not validate the latest working tree; a new baseline is needed after the candidate stabilizes. External testing remains paused pending exact test-site and provider/message scope approval requested by the parent session.

## 20261002 Propagate canceled development orders to Shipday

Neil explicitly requests cancellation of the linked Shipday job for order 9021 and a permanent cancellation connection. Verify exact ID and reference, remove only unstarted in house deliveries, verify absence, retain identifiers and audit history. Failed or ambiguous and third party cases need visible review, never silent success. Canceled order records supply durable reconciliation work; recover interrupted claims and throttle retries. Preserve existing payment release and notification choices. Do not create a replacement trip.

## 20261002 Clear obsolete blocked checkout after replacement booking

Neil requests removal of the stale account banner after placing the replacement order. Close the previously observed blocked intent only after a successful confirmed booking. Preserve failed bookings, newer concurrent intents and customer ownership. Do not change payment, dispatch or message behavior. Repair the confirmed stale intent for order 9021 without booking another order or sending a message.

## 20261002 Paired order identifiers and silent manual completion

Show pickup and return Shipday IDs beside the existing unique LYNDRY order number. Admin manual completion requires reason and receipt attestation but no photo. Preserve authorization, payment eligibility, audit and replay protection. Suppress subsequent automated delivery text and photo observations for manually completed orders. Verified Shipday sync continues requiring proof. No actual order completion during verification.

Verified locally: 28 focused tests pass. Full suite has 1682 passes and the same two existing partner profile wording failures. Migration 0140 activated only on development. Database completion without photo, notification suppression, preserved existing photo and payment, and harmless replay verified in a rolled back transaction. Browser verifies paired identifiers and the photo free dialog. No order completed, no message sent. Obsidian updated. Not committed or pushed. Independent review and Neil click testing pending.

## 20261002 Shipday IDs and compact toolbar

Show stored Shipday pickup and return IDs separately in order details. Missing associations say Not linked yet. Remove visible explanatory lines under disabled Update order and Cancel order; preserve their eligibility and tooltip explanations. Presentation only, no order or Shipday mutations. Update Obsidian and verify rendering.

## 20261001 Order recovery actions

Neil explicitly authorizes building the suggested top actions, prioritizing Shipday reconciliation and manual delivery recovery. Add status sync, reasoned proof based admin completion, internal note and delivery management beside existing actions. Completion requires OUT_FOR_DELIVERY and settled or waived payment. Verify exact return identity and endpoints through the existing observer, current assignment and evidence freshness. Atomic audited transition, harmless replay. No charges, courier mutations or duplicate customer notifications. Development only. Existing edit and cancellation guards stay in force. Other lifecycle overrides require specific validated transitions rather than arbitrary status changes.

## 20261001 Order details and header actions

Neil requests destination as order detail rows, saved quote beside order details, and update, cancel and delivery actions at the top. Scope is presentation and reuse of existing guarded forms. Preserve permission checks, lifecycle eligibility, delivery photo requirements, payment, dispatch and messaging behavior. Unavailable actions show a reason. No actual order is changed during verification. Development only. Independent review and Neil acceptance pending.

## 20261001 Customer pricing base restored for new quotes

Neil explicitly confirmed that the customer pricing base must drive customer quotes and destination comparisons. This supersedes the actual wholesale pricing basis for new development quotes. Keep three distinct rates with identical labels on edit and profile: Laundromat walk-in rate, Our laundromat cost per lb, and Customer pricing base per lb. Walk-in is reference only. Our laundromat cost remains the supplier payment and actual profit basis. Customer pricing base replaces only the washing input to the inclusive customer formula. Keep delivery, processing, tier targets, the 18 lb minimum and 50 lb maximum. If the base is blank, explicitly disclose the existing fallback to our laundromat cost. The target is a pricing margin on the selected base; actual contribution may differ.

Version the new pricing basis in the policy and saved quote. Existing accepted snapshots retain their old calculation even if a historical snapshot contains a customer base field. Freeze both rates for new orders. Update application and atomic database billing consistently, preserve payment and dispatch behavior, and test quoting, minimums, ranking, measured-weight billing, real cost reporting and legacy snapshots. Activate only development. Update Obsidian. Independent review and Neil acceptance remain pending.

Verified on 20261001: migration 0138 activated CUSTOMER_BASE_V1 only in development. Application and database billing matched in 7,788 cases, including all tiers, weights, minimum boundaries, settlement modes and legacy quotes. All 32 focused tests pass. Full suite reports 1,666 passes and the same two preexisting unrelated partner profile wording failures. Browser inspection confirmed the three separate values and explanations in edit and profile, and refreshed public quotes. Existing partner rate values were not changed. Obsidian updated. No commit, push or production release. Grok review and Neil acceptance remain pending.

## 20261001 Home hero reference update

Neil explicitly requested a home hero update using his attached visual reference. Retain the existing green bubble background and customer typography. Use a four line service heading, two prominent actions with Book a pickup first, and a larger receipt style example card with a lavender offset panel and a five stage icon timeline. Show the example below the actions on phones. Keep conditional next day language. The receipt is an illustrative 30 lb subscription example from the current development model, not an address quote or a universal rate. Delivery and processing are included, never advertised as free. No changes to pricing, booking, payment, dispatch, routing or the rest of the homepage. This supersedes the previous three line heading and giant single CTA visual decision for this hero only. Development only; update Obsidian and verify responsive layout and action destinations.

Implementation verified on 20261001: four line hero, two prominent actions and responsive receipt are available on localhost. All 33 focused tests pass. Full suite reports 1,660 passes and the same two unrelated partner profile wording failures. Both action destinations were clicked without submitting a booking. Desktop, user width, tablet and phone layouts were inspected, including measured containment at 320 pixels. Fresh Impeccable visual review returned ship with no material findings at its visual and source scope. Obsidian Development Updates, Marketing and Funnel, Decisions and Log were updated. No commit, push or production release. Grok review, physical phone testing and Neil acceptance remain pending.

## 20261001 Eighteen pound minimum and thirty pound starting quote

Neil explicitly replaced the fixed $28 minimum with an 18 lb minimum for new development quotes. Calculate each destination and tier minimum from its existing inclusive cost formula at 18 lb, save that dollar amount in the quote, and charge that minimum for smaller bags. Keep the displayed minimum order rate equal to that total divided by 18 below the allowance. Above 18 lb, calculate from actual weight. Keep the 50 lb maximum, existing category targets, cost inputs and payment flow. Existing accepted snapshots keep their saved minima and bills.

Default new estimates to 30 lb while preserving an explicitly selected weight. Show subscription and one time rates at both ends of the slider: up to 18 lb and at 50 lb. Apply the minimum to public quote, booking, saved review and final billing through the shared snapshot calculation. Admin pricing settings edit minimum weight instead of a universal dollar floor for this policy. The page keeps the customer brand, one heading, compact weight controls, aligned tier cards and visible full totals. This supersedes the $28 instruction below. Development only. Update Obsidian, regression tests, database parity checks and desktop and mobile browser verification.

Implementation verified on 20261001: migration 0137 is active only in development. Minimum prices are frozen at 18 lb for new quotes; earlier accepted snapshots retain their minima. Public comparison and confirmed destination minima are separately tested. New estimates start at 30 lb, endpoint labels show both tiers, and weight controls and minimum boundaries work. Twenty one focused regressions pass; npm test reports 1,659 pass and two preexisting unrelated partner profile wording failures. JavaScript and database totals matched across 1,944 cases. Physical phone checks, Grok code review and Neil booking click testing remain pending. Obsidian Development Updates, Pricing and Promotions, Decisions and Log updated. No commit, push or production release.

Fresh Impeccable finish review returned ship for the quote page refinement, with no material visual fixes. This is separate from Grok code review and production readiness. Existing design tokens remain authoritative. Lower mobile review used a full page capture with a known right edge crop, supported by a valid upper viewport capture and measured balanced gutters. A physical phone check remains pending. Wholesale booking labels use only their own tier; the public comparison remains subscription and one time.

## 20261001 Minimum order rate display

Neil explicitly requested that the per pound headline remain fixed below the weight covered by the monetary minimum. Keep the configured $28 minimum. Derive the included weight independently for each tier from the existing rounded pricing calculation, conservatively to hundredths of a pound and capped at 50 lb. Below that weight, show minimum divided by included weight as a Minimum order rate, alongside the full minimum total and included allowance. Above it, show the calculated total divided by selected weight. Do not call the capped figure the actual average for a smaller bag.

Apply the same presentation to public quotes, booking plan selection and quote review. Preliminary comparisons use their eligible destination price schedule; accepted quote review uses the saved destination and cost terms. If the minimum does not cover even one pound, show the actual estimate without inventing an allowance. Preserve billing totals, cost targets, payments, routing and accepted snapshots. This supersedes the earlier instruction to display actual average per pound below the minimum. Development only. Update Obsidian and verify minimum boundaries and slider interaction.

## 20261001 Weight based inclusive pricing in development

Neil explicitly requested implementation of the weight based workbook model. This supersedes the customer base rate and separate fee model for NEW development quotes only. Existing accepted snapshots retain their calculation. Use actual laundromat wholesale cost, both quoted courier legs, payment processing and configurable other costs. Targets are subscription 10%, one time 20% and wholesale 5%. The inclusive monetary minimum is $28 and the maximum order weight is 50 lb. Round totals upward and verify the target against rounded processing costs. Account for the existing hold plus balance settlement when estimating processing; do not change the card flow.

Customers choose estimated weight from 1 to 50 lb. Show subscription first, an inclusive estimated total and the effective average per pound, with delivery and processing included. Recalculate from measured weight using frozen costs and policy, not the estimate's displayed average rate. The minimum can produce a higher margin for small bags. Do not advertise $2 as a universal ceiling. Compare eligible destinations at the chosen weight. No partner costs or internal targets in public calculator data. Discounts cannot undercut the new model's minimum or modeled target; explicit waivers retain their existing behavior.

Update quoting, booking, consent, confirmation, saved order displays, actual weight billing and database weighing together. Retain order access, payment, dispatch and no card safeguards. Verify integer and fractional weights, all tiers, minima, estimated versus actual weight, rounding, legacy snapshots and destination selection. Development only. No production activation or merge. Independent review and Neil click testing remain pending.

Implementation and validation on 20261001: Development policy WEIGHT_BASED_MARGIN_V1 is active through migration 0136. The quote and booking use inclusive tier estimates, and measured weight billing uses frozen cost terms. Fixed or minimum holds reserve two fixed processing fees; minimums and rounding can exceed the target. Application and database totals matched across 1,944 cases. Nine new pricing regression tests pass. Full suite: 1,648 pass and two preexisting laundromat profile wording failures. Desktop, mobile, keyboard, minimum, maximum and invalid weight browser checks passed. No payment or dispatch was submitted. Public pricing explanations and order summaries were aligned. Obsidian Development Updates, Pricing and Promotions, Decisions, Index and Log were updated.

Only the new development migration was applied. Historical migration ledger inconsistencies were not replayed or repaired in this change. No implementation commit, push or production release. Independent review and Neil's final click test remain pending.

## 20261001 Resolve weight holds and request return dispatch

Neil explicitly authorized connecting issue resolution to laundromat hold release and automatic return dispatch. For an identified weight issue, administrator resolution releases the recorded hold, marks completed laundry ready, closes the issue and attempts the existing guarded return request. Already resolved issues offer recovery. Failed release or readiness prevents closure. Payment, assignment and duplicate dispatch checks remain enforced. Uncertain remote writes still require review rather than another driver request.

All 1640 tests pass, including five resolution regression tests. Development order 9020 is RELEASED and READY. Its existing return trip was verified against the saved reference, driver and both endpoints and is reported delivered by Shipday. A stale local dispatch review from the earlier failed verification was reconciled without a remote write or marking the customer order delivered. Local development only. Not committed, pushed or shipped. Independent review and Neil click testing remain pending.

Source: Neil's request and repository, test and development database verification on 20261001.

## 20261001 Laundromat escalation contact correction

Neil corrected the weight hold call button to use the business contact number and the label Call this number, without a personal name. Updated the development configuration and shared board and order detail button, including Spanish wording. This supersedes the earlier personal contact instruction. No hold or release behavior changes. Local development only, not committed or pushed.

Source: Neil's browser annotation on 20261001.

## 20261001 Visible laundromat weight holds

Added red mismatch notifications to the laundry board and order detail, displaying incoming and outgoing weights only after a return hold. Replaced normal return actions with a direct Call Neil button and instructions to double check bags and scale readings and retain the laundry until LYNDRY resolves the hold. English and Spanish are supported. The private escalation number is configured for authenticated portal alerts and is not added to public pages. This is Neil's explicit exception for private portal escalation. Existing tolerance and release rules remain unchanged.

All 1635 tests pass. Browser inspection confirmed the held order and direct telephone destination. No call was placed. Local development only, not committed or pushed. Independent review and physical phone click testing remain pending. Source: Neil's screenshots and request on 20261001.

## 20261001 Order costs and contribution

Added recorded pickup, billable and laundromat weights to POS order details. Business costs now appear beside customer charges with estimated contribution dollars and percentage underneath. Calculations use saved wholesale terms, settled partner weight when available, courier records with quote fallback, and payment ledger based processing estimates including per transaction fixed fees. Missing costs remain unavailable. Unrecorded overhead and refunds are explicitly excluded; the result is not represented as final net profit. Money visibility permissions remain enforced. Billing and routing behavior are unchanged.

Validated with regression tests and order screen inspection. Local development only, not committed or pushed. Independent review remains pending. Source: Neil's request and implementation verification on 20261001.

## 20261001 Order cost and contribution summary

Spec: Add visible recorded and billable weights to the POS order detail. Show business costs beside the customer charge breakdown and contribution dollars and percentage below. Use saved quote terms, settled partner weight when available, recorded courier fees when available, and the existing payment ledger. Label calculated supplier and processing estimates. Missing values must not become zero or fabricated net profit. Preserve money permissions, billing, routing and historical quotes. Add regression coverage. Local development only; independent review pending.

## 20261001 Cohesive booking plan cards

Neil requested a further booking design refinement using Emil design engineering, Apple design and mobile native guidance. Replaced the oversized enclosing card with separate subscription and one time cards matching public quote styling. Unified plan and price typography with the site body font, aligned fee rows, and added compact frequency controls with visible selected states and mobile touch targets. Subscription remains first. Pricing and booking behavior are unchanged.

All 1629 tests pass. Desktop and phone sized browser review confirmed selectable plans and frequencies, itemized fees and no horizontal overflow. Physical phone testing and independent review remain pending. Local development only, not committed or pushed.

## 20261001 Booking plan screen polish

Reviewed the booking plan screen with the impeccable skill. Kept subscription first and preserved the existing customer visual identity. Added clearer plan headings, readable itemized pricing, aligned numeric amounts, a divider between plans and larger vertically spaced frequency controls. Removed nested price panel backgrounds and the cramped frequency row. Frequency choices use a named fieldset and remain available without JavaScript. Selected plan values, fees, minimum, card holds and booking behavior are unchanged.

All 1629 tests pass. Mechanical design scan returned no findings. Desktop and mobile browser review confirmed subscription first, readable fee rows, separated choices and no horizontal overflow. No booking or payment was submitted. Local development only, not committed or pushed. Independent review remains pending. Source: Neil's request, skill review and development verification on 20261001.

## 20261001 Subscription first in booking

Moved the subscription option, price breakdown and frequency choices before one time pickup in booking. Preserved the customer's existing selection and all pricing and booking behavior. Source: Neil's browser annotation on 20261001. Local development only, not committed or pushed.

## 20261001 Booking pricing matches public quote

Neil requested the same itemized pricing presentation across public quotes and booking. Booking selection and price review now show wash and fold per pound, delivery, operational fee and service fee using the shared quote allocation. The inclusive minimum appears in smaller text beneath the breakdown. Removed example weight totals and estimated total ranges. Labels say pricing while preserving the notice that pickup date and time can change availability and pricing. Actual weighing determines the final bill. Card hold disclosure and consent remain intact.

All 1629 tests passed for the booking presentation change, including updated rendering assertions. Browser verification of the booking steps encountered a browser timeout and remains pending. Local development only, not committed or pushed. No payment or order was submitted. Source: Neil's annotations and instructions in this conversation on 20261001.

## 20261001 Conditional next day website wording

Neil requested that customer website language stop promising next day returns. Shared wording now says: Most wash and fold orders return next day when available. Updated the homepage, booking copy, shared footer, FAQ, how it works, landing pages, service area pages and search descriptions. Operational turnaround values and scheduling rules are unchanged.

All 1629 tests pass. Local development only, not yet committed or pushed. Independent review and final click testing remain pending. Source: Neil's request and development verification in this conversation on 20261001.

## 20261001 Revised transportation fee calculation

Neil explicitly approved transportation divided by one minus category margin, rounded to the nearest cent. This supersedes the previous transportation formula that included percentage and fixed processing costs. Laundry rate calculation is unchanged. Operational allocation is the saved policy percentage, currently 25%, of the adjusted fee total. Service allocation is $1.99 and delivery is the remainder. The allocations are not added again. Low totals cap allocations to prevent negative delivery.

New quote snapshots carry TRANSPORT_MARGIN_V2. Existing accepted snapshots retain their original prices and old fee allocation. The inclusive $15 minimum, final weight billing and category selection remain. Actual processing costs still appear in cost reporting, so the fee target is before transportation processing costs and does not guarantee net profit.

For $13.98 transportation, subscription fees are $15.53 with delivery $9.66, operational $3.88 and service $1.99. One time fees are $17.48 with delivery $11.12, operational $4.37 and service $1.99. Wholesale fees are $14.72 at a 5% target. All 1629 tests pass including billing settlement, rounding, legacy snapshots and low fee cases. Browser confirmed both public quote examples. Development implementation only, not yet committed or pushed. Independent review and final click testing remain pending.

Source: Neil's exact formulas in this conversation on 20261001 and development verification.

## 20260930 Remove public quote total estimates

Removed the estimated total range from both public quote cards at Neil's request. Retained per pound rates, itemized fees and the smaller minimum total. Updated supporting copy to remove references to estimated totals. Pricing and billing unchanged. Development only. Source: browser annotation in this conversation.

## 20260930 Itemized public quote fees

Neil requested separate Delivery, Operational fee and Service fee rows on both public quote cards, replacing the combined line. This is a display allocation of the existing quoted fee, not extra charges. Operational allocation uses the saved transportation cost and policy percentage, currently 25%. Service allocation is $2, with delivery receiving the remainder. Allocations are capped at the existing combined fee for unusually low fee totals so no negative delivery amount or additional charge is introduced. Old quote versions retain their original operational fee.

Moved Minimum total below Estimated total in smaller text. Current subscription example shows delivery $10.90, operational $3.50 and service $2.00, summing to the unchanged $16.40. One time shows $13.03, $3.50 and $2.00, summing to the unchanged $18.53. Quote calculations, routing, billing and the $15 total floor are unchanged. Other booking screens still use the combined fee label.

All 1628 tests pass. Browser verified the three fee rows and the smaller minimum beneath the estimate. Development only. Source: Neil's browser annotation and development verification in this conversation.

## 20260930 Independent laundromat customer pricing base

Neil approved a third laundromat rate in admin. Wholesale remains the rate the laundromat charges LYNDRY and continues to drive partner payables and actual washing cost reporting. Retail remains the walk in reference. Customer pricing base is separately editable and drives new customer quotes before the existing category margin and processing calculation.

Quote comparison and the quoted destination use the resulting complete customer total, including combined delivery fees. Existing saved order prices retain their snapshots. New snapshots retain both the customer base and the true wholesale cost. This supersedes the prior assumption that wholesale cost must also be the customer pricing base.

The new field starts at each existing laundromat's wholesale rate, preserving current prices until an admin edits it. Blank falls back to wholesale. Invalid, zero, negative or more than two decimal place entries are rejected. Older forms that omit the field do not erase a saved base. A management company does not retain a laundromat pricing base.

Example: wholesale $0.70 and customer base $1.00 produces one time $1.30 per pound, subscription $1.15 and wholesale category $1.09 at current category targets and processing assumptions. The invoice cost remains $0.70 per pound. The $1.00 figure is an example, not a rate applied to every shop. Delivery fees and the $15 minimum are unchanged.

Development migration applied. All 1627 tests pass, covering independent saves, invalid values, fallback, legacy snapshots, true cost reports and selection using customer prices. Admin browser reached sign in, so signed in visual verification and Neil click testing remain pending. No production release or implementation commit. Source: Neil's request and the development code, tests and database checks in this conversation.

## 20260930 Quote label refinement

Shortened both customer quote cards to Delivery + Fees and Minimum total as requested. Copy only; pricing and billing unchanged. Development only.

## 20260930 Approved cost based pricing with $15 minimum

Neil explicitly approved implementation after the earlier pricing reversal. This supersedes the instruction to leave pricing unchanged for new development quotes only. Existing accepted order snapshots keep their original prices.

New category targets are 20% for one time, 10% for subscription and 5% for wholesale. These are contribution targets after modeled direct costs, not net profit after all business overhead. Divide wholesale washing cost per pound by one minus the category margin minus the processing percentage, rounding upward to cents. Separately divide combined pickup and return cost plus the fixed processing cost by that same denominator, rounding upward to cents. Present the second amount as one Delivery + fees line. Processing is built into the price and is not surcharged afterward.

The customer total is the greater of $15 or the rounded laundry amount plus combined fees. The $15 floor includes those fees and is not added again. The previous $30 minimum, separate $2 service fee and penny adjustment proposal are not implemented. The 33 lb reference remains for comparing laundromats and planning capacity; it no longer determines the rate or spreads transportation into laundry pricing. Promotions on new paid orders cannot reduce the bill below $15. Older saved promotion terms and explicit authorized waivers remain unchanged. Costs that change after booking are not passed through to an accepted order.

Updated quotes, booking review, confirmations, order summaries, administration explanations and settlement calculations. The existing saved fee field stores the entire combined fee for this policy version, so database weighing and saved quote billing use the same arithmetic. Old policy versions retain their old calculations and fee label. New policy activated only in the development database. No production release.

Validation: all 1621 tests pass. New tests cover all three categories, inclusive minimum, fractional weights, card holds, legacy snapshots and both van and laundromat billing totals. Browser verified the updated quote. No real payment was made and no pickup was booked. Independent review and Neil click testing remain pending. No implementation commit yet.

Source: Neil's direct approval and the development code, tests, browser and database checks in this conversation. Example costs of $0.70 per pound and $13.98 transportation yield subscription $0.81 per pound plus $16.40 fees, one time $0.91 plus $18.53 and wholesale $0.77 plus $15.51.

## 20260930 Pricing implementation reverted

Neil requested reversal of the pricing implementation started in this conversation. Restored the previous pricing calculations, quote display, booking confirmation and billing code. Removed the unapplied migration. The proposed $30 minimum, separate $2 service fee and rate adjustment for profitability are not active. Existing dynamic pricing remains in place.

Confirmed the development database never activated the new policy or migration. All 1613 tests pass after restoration. Unrelated website changes were preserved. No production release. Source: Neil's direct instruction and development code and database checks in this conversation.

# Customer motion feedback

Neil approved the four animation opportunities on 20260930. Add subtle address success feedback, mobile menu entrance, FAQ answer fade and confirmed submission icons. Keep prices, form layout, payment and booking behavior unchanged. Keyboard interactions stay immediate, including across navigation. Reduced motion uses a short opacity cue only. Development only; independent review and Neil click testing remain pending. Validation: all 1613 tests pass. Browser confirmed FAQ fade at 140ms, mobile menu at 160ms, keyboard mode and no horizontal overflow at 390px. Transactional success and address completion were inspected in source without submitting a booking or address lookup. Reduced motion has an 80ms opacity only override; device preference testing remains pending.

## 20260930 Pricing decision: keep the current method

Neil explicitly cancelled the proposed pricing overhaul and instructed us to keep the current pricing structure and calculations unchanged. He does not accept the proposed replacement. This supersedes the pricing proposals, comparison tables and pending implementation plan from this discussion. They are not approved work.

Preserve the existing dynamic per pound rate, dynamic operational fee, dynamic inclusive minimum, category rules, quote presentation and billing behavior. Do not introduce the proposed included weight allowance, affine replacement, transportation buffer, new fee allocation or payment changes. Reopening this work requires a new explicit instruction from Neil. This records a product decision, not a claim that every order meets a guaranteed margin.

Documentation only. No pricing code, settings, database records, customer quotes or billing were changed for this decision. No production release.

Source: Neil's direct instruction in this conversation on 20260930.

# Booking page refinement

Refined the customer booking page while preserving booking behavior and the existing brand. Compact heading, aligned progress indicator, readable sentence case labels, consistent spacing, touch sized fields and clear disabled buttons. Desktop and 390px mobile inspected; no horizontal overflow. All 1613 tests pass. No booking was submitted. Development only; independent review and physical phone testing pending.

# Address focus outline correction

Match pickup address focus to the unchanged apartment input: same outline color, width, offset and focus shadow. Remove the extra Google inset ring and retain keyboard selection visibility in suggestions. Browser comparison confirmed. Development only; independent review pending.

# Shared customer address entry

Customer address entry now uses the same Google pickup address search and optional apartment, suite or unit in pricing, empty quote entry, booking and account settings. Parsed components keep the existing customer address schema. Server validation runs before address persistence and stores verified coordinates. Guest validation does not write an empty account. Clearing an optional unit remains cleared through wizard answers. Production stays feature gated off. All 1613 tests pass. Live pricing suggestions and selection verified. Independent review, authenticated browser checks and physical phone testing remain pending. No production deployment.

# Development Google address entry

Neil authorized Google attribution and implementation. Pricing gets the official accessible Places widget, town and ZIP filling, and server Address Validation checks before any quote, including direct query requests. Use verified coordinates for dynamic quotes. Reject incomplete, replaced, unresolved or non NJ addresses; provider outages withhold quotes. Per IP limit bounds validation calls. Separate browser and server keys; production forced off. Google Cloud project lyndry-development is linked to billing; all three APIs are enabled. Separate restricted keys are stored only in the ignored local .env and development is enabled on port 3002. Live selection, town/ZIP parsing, valid quotes and invalid address rejection passed. Neil requested one Google search box with hidden parsed address fields and an optional apartment/unit field; pricing is disabled until a complete NJ address is selected and invalidated on edits. Monthly billing alerts at $5/$9/$10 are configured (not a spending cap). Cloud validation quotas were shown as not adjustable; the application retains its 10 checks per IP per minute limit. Server key is API restricted, not IP restricted because no stable development egress IP is configured. Independent review pending.

# Persistent laundromat sessions

Neil requested no laundromat inactivity logout, with login elsewhere ending the previous session. Use signed persistent shop cookies with browser storage renewed for 400 days. Continue checking live user token, active user and shop on every request. Legacy unexpired cookies migrate on use; expired ones require login. Staff POS and admin shop preview sessions are unchanged. Browser clearing or retention limits still require login.

# Development AI online booking

Neil requested development AI stop taking orders and send online booking links. Existing tool exclusion and execution guards remain. Add a development prompt rule overriding legacy booking instructions and use the configured development base URL plus /account/book in the guarded fallback. Production wording and existing order help remain unchanged. Regression tests cover all three prohibited actions and production fallback. No messages sent.

# Contact page card removal

Neil requested removal of the annotated Business details card. Removed that card and its unused two column layout. Partner invitation and footer remain. Verify rendered contact page.

# Customer motion refinement

Neil requested better existing customer website animation using Animate. Marketing reveals use 12px movement and 250ms strong ease out. Forms show immediately. Parallax is restricted to decorative artwork, capped at 24px and disabled for touch, narrow screens, keyboard and reduced motion. Runtime preference changes reset movement. No business behavior changes. Independent review and phone feel check pending.

# Customer interaction polish

Neil requested the Emil design engineering skill on the customer website. Scope: shared customer layout only, retaining the established brand and business behavior. Refine pointer and keyboard feedback, focus visibility, touch controls and reduced motion. No payment, dispatch, messaging or order rules change. Validate with npm test and browser checks; independent review and physical phone checks remain pending. Update Obsidian.

## Current: laundromat mobile-native polish — 2026-09-30

Neil requested mobile-native improvements across laundromat shop pages. Add opt-in portal viewport/safe-area support, dynamic shell height, touch control feedback, 16px inputs on touch devices and keyboard hints. Keep pinch zoom, selectable order/address text, native scrolling and all intake/outtake/confirmation rules. No new app framework or business action. Browser checks plus npm test; physical-phone verification and independent review pending.

Validation: 1,595 tests pass. Browser verified portal opt-in classes, viewport metadata, 16px sign-in input and no page overflow at 390px; opened the existing admin portal without altering an order. Real-phone testing of keyboard, notch, landscape and installed-app behavior remains pending.

## Current: POS interaction polish — 2026-09-30

Neil explicitly requested applying emil-design-eng across pos.localhost screens. Refine shared staff POS controls: subtle pointer press feedback, instant keyboard interactions, hover only on capable devices, reduced-motion support, clearer disabled/focus states, consistent touch targets and field spacing. Preserve the existing visual identity and all business actions, permissions and forms. Public website and laundromat portal are outside this pass. Stacked on codex/report-saved-quote-total. Independent review and Neil click-test pending.

Validation: all 1,595 tests pass. Browser verified pointer feedback (120ms), instant keyboard interactions (0ms), visible keyboard focus and desktop/390px form layout without page overflow. No saved settings or operational actions changed during testing. Reduced-motion and touch media rules were inspected; a physical-device check remains part of Neil’s click-test.

## Current: report saved quote total — 2026-09-30

Approved alongside the POS review. Include the saved operational fee and inclusive minimum in report expected charges, preserve legacy calculations, missing weights and higher/lower weight rules. Read-only report change: never change charges, dispatch or payment state. Stacked on codex/pos-workflow-clarity. Independent review and Neil click-test pending.

Validation: all 1,595 tests pass, including saved fee, inclusive minimum, fractional rounding, legacy orders and missing weights. Browser confirms #9019 expected $44.60 equals its recorded $44.60. No charge, message or driver was requested.

## Current: approved POS workflow clarity — 2026-09-30

Implement the approved page-by-page review: operational exceptions first; compact responsive lists; searchable customers/messages; customer/conversation hierarchy; accessible hours and promotion forms; reversible hours-copy UI; broadcast draft recovery; clearer settings, navigation, reports, and empty states. Preserve permissions, consent, payment/dispatch state machines, manual shop pickup confirmation, and no-card/no-pickup rules. The report calculation fix is a separate follow-up branch. Desktop and phone have equal priority. Independent review and Neil click-test remain pending.

Validation: 1,591 tests passed before the report follow-up. Desktop and 390px phone checks covered board, dispatch detail, profile, conversation, hours-copy and broadcast preview. Nine inherited accent-border detector findings retained as existing status/quotation styling. No business-state form was submitted.

## Current: customer booking clarity (2026-09-30)

Neil approved implementing the customer website critique. Preserve the bold brand; make price checking primary, clarify illustrative pickup content, simplify navigation and mobile forms, add named booking progress and existing-address context. Keep suppliers private. No payment, pricing, dispatch, reminder, SMS, or booking-state changes. Use existing service facts only. Independent review and Neil click-test pending.

## 2026-09-29: customer delivery photo messages (implementation assigned by Neil)

After a newly observed, verified return delivery, send the customer's matching drop-off photo as a picture message from the existing LYNDRY number, in the same customer conversation. Keep delivered text prompt; send the photo separately as soon as available, checking for late proof for up to 24 hours. Never send pickup/laundromat photos, maps, tracking links, vendor names or other customers' proof. Validate exact linked return identity, endpoints, driver and completed state again before sending. Prepare a metadata-free size-limited JPEG in private storage and record the attachment in the employee message thread. Durable claims prevent duplicate photo sends across local/hosted workers; uncertain carrier outcomes require review instead of retry. Preserve STOP, card eligibility, current sender and simulated development messaging. Existing completed trips are not backfilled and manual laundromat handoff is independent of customer photo messaging. No production activation, payment, reminder or route changes. Tests must cover wrong leg/order, delayed/missing photos, duplicate/restarted workers, opt-out and uncertain sends. Independent review and Neil click-test pending.

Validation: npm test passed all 1,584 tests, including the actual customer-conversation attachment renderer. Migration 0133 applied only to development. Transaction checks verified one photo claim and eligibility only after delivered text; changes rolled back. Generated-image storage/signing/download was verified in the private bucket and the temporary image was removed. Customer delivery SMS remains fake in development (no API key); no live customer text or photo was sent. Manual collection 0132 checks also passed with all order changes rolled back; #9019 remains awaiting Neil's manual confirmation. Browser verified the red Confirm Pickup button. Independent review and Neil click-test pending.

## 2026-09-29: manual pickup confirmation (implementation assigned by Neil)

Keep collection manual. Replace View collection on outgoing rows with a direct Confirm Pickup form. Awaiting verified collection is green and disabled; verified collected/delivered return is red and enabled with an explicit confirmation-needed label. The existing refresh updates both color and eligibility; failed refresh disables submission. Confirmation rechecks the exact linked return, endpoints, assigned driver and collection state, preserves weight/payment/shop/CSRF guards, records the actor, and moves the order to completed shop history without claiming customer delivery. A matching in-house trip left in REVIEW by an uncertain request (or already COMPLETED) can be confirmed only with fresh verified collection; never request or reassign a driver to clear that flag. No automatic collection, production activation, payment, reminder or route changes. Regression tests required; independent review and Neil click-test pending.

## 2026-09-29: washing completion and simplified laundromat board

Neil requests three active board sections: Incoming deliveries, Washing, and Outgoing deliveries. Verified intake enters Washing directly, with no separate Start washing action. Persist Mark wash complete with timestamp and actor, requiring verified intake and shop scope; repeat submissions are harmless. This action does not dispatch a driver, settle payment, change billed weight or mark the order READY.

Only after wash completion, reveal the fresh full-order return-weight form. The Outtake button stays visibly disabled until a valid weight is entered (greater than zero, no more than 50 lb, at most two decimals), and disables again if cleared or invalid. The server independently requires wash completion and applies the configurable inclusive +/-1 lb check. Preserve sticky discrepancy holds and the existing driver-request behavior after successful Outtake. Keep Intake, Washing, Outtake in order progress; completed wash awaiting weighing remains in Washing with a Wash complete badge. Preserve already-ready orders without resetting their workflow.

Remove the Leave by date/time text while retaining the colored countdown. Show the signed-in laundromat's own escaped name and saved address in the sidebar footer; no customer or other-shop data. The three-section flow supersedes the intermediate four-section proposal.

Validation: all 1,568 tests pass. Browser verified the three sections, sidebar identity, no deadline date line, wash-complete-only action, and Outtake enabling for valid weight then disabling when cleared. Database transaction checks verified scope, replay, missing-completion rejection, required weight, inclusive boundaries and sticky holds, with test changes rolled back. Migrations 0129-0131 applied only to development; 0131 removes the intermediate start-washing requirement. No real driver request, message, payment or retained order mutation was performed. Independent review and Neil click-test pending.

## 2026-09-29: blind return weighing and laundromat board (implementation assigned by Neil)

Hide intake weight from the shop's wash board, detail page and response data. Show the Match the handover reference card only on the incoming intake screen, never on wash or return screens. Show only verified return weight after a passing reweigh or an explicitly reviewed release. An optional, escaped shop reference (up to 64 characters) is saved at intake and follows the order through the portal/history; it has no pricing, dispatch, identity or payment effect and never replaces the LYNDRY number. This supersedes the earlier removal of all internal ticket entry, adding only an optional label.

Build a configurable absolute weight tolerance in pounds. Neil chose an inclusive 1 lb difference in either direction on 29 September 2026; it is active in development and editable under Admin > Return weight checks. Once configured, require a fresh full-order weighing before readiness/return dispatch, compare on the server, preserve the original billed intake weight, and hold mismatches with an issue and audit record. Holds are sticky across retries and setting changes; only an active LYNDRY admin can release with a review reason. Portal, POS, background dispatch and collection must respect the hold. No customer payment is recalculated from return weight.

Provisional countdown rule pending Neil's preference: snapshot the laundromat's closing time on the next Eastern calendar day after receipt. Never treat this as an exact 24-hour promise. Show deadline unavailable when tomorrow has no opening hours. Green above 10 hours, yellow above 2 through 10 hours, red at/below 2 hours and overdue; text labels accompany color. Completed orders stop counting down. Development only; production unchanged. Independent review and Neil click-test pending.

Validation: all 1,561 tests pass. Browser verified hidden wash weight, live countdown, intake-only handover card and the administrator settings page. Development migrations 0126, 0127 and 0128 are applied only to psrphpgbiifvnlrgvbdg. Transaction checks verified sticky mismatches, blocked direct readiness, administrator release, and duplicate SMS claims, with test changes rolled back. The weight tolerance was unconfigured during initial validation. Neil subsequently selected 1 lb in either direction; it was saved through the admin portal and the empty return-weight field was verified in the laundromat portal. Development SMS remains simulated. No driver was requested or payment made during verification. Independent review and Neil click-test remain pending.

## 2026-09-29: LYNDRY delivery texts (implementation assigned by Neil)

Use the existing LYNDRY SMS service for delivery updates: retain booking confirmations, add driver on the way/approaching, laundry collected, out for delivery and delivered. Only verified matching live trips generate updates. Customer-side ETA comes from internal tracking, never laundromat arrival ETA for a customer pickup. No tracking URLs, vendor names, partner identity, addresses or driver instructions in these messages. Suppress stale, duplicate and regressing observations across localhost and hosted workers. Record ambiguous sends for review without automatic retries. Preserve STOP, card requirements, billing, dispatch and simulated development SMS. Start with the exact development database; production activation is separate. First observation of a completed trip establishes a baseline without historical messages.

Neil corrected the phone masking proposal: retain the customer phone at their endpoint for driver contact and the business number at the laundromat endpoint. Shipday account tracking/receipt/feedback SMS and email stay off while internal tracking remains available. Do not rewrite active jobs. Independent review and Neil click-test pending.

Photo audit: third-party delivery PHOTO is requested. Mandatory pickup photos and enforcement at both stops in the in-house app remain unverified. Written instructions are not enforcement.

## 2026-09-29: vendor-neutral customer and laundromat websites

Neil explicitly requires that no third-party vendor names appear to non-employees. Replace public quote, booking, payment, informational and privacy-page vendor references with plain service descriptions; preserve truthful availability and data-sharing disclosures. Remove vendor names from English and Spanish laundromat status/photo messages and from provider-supplied driver labels. Keep actual driver contact available. Suppress vendor-bearing booking errors while retaining diagnostic logs. Employee POS integration controls and integration identifiers remain intact. No payment, routing, dispatch, consent or SMS behavior changes. Regression-test public pages, quotes and both portal languages. Independent review and Neil click-test pending.

Scope limitation: externally hosted card-entry pages and third-party photographic content are not controlled by LYNDRY copy; this change does not replace payment hosting or edit driver photographs.

## 2026-09-28: arrival estimates shared by booking and assignment

Neil approved replacing the fixed in-house hour with estimated travel plus a configurable loading buffer, default ten minutes. Use the travel segment of Shipday estimates, excluding courier wait, and label it as an estimate. Scheduled quotes verify courier arrivals and buffered in-house arrival against opening hours, cutoff, turnaround and next-day collection; final booking rechecks saved arrival estimates. Explicit in-house assignment refreshes travel estimates or accepts an administrator's Eastern arrival override when needed; validate arrival after pickup and the same shop rules, audit the override, and never rewrite an existing remote job via this control. Third-party assignment continues to use its actual offered arrival and saved budget. Preserve all payment, identity, duplicate and worker gates. No real driver request during verification. Independent review and Neil click-test pending.

Validation: all 1,533 tests pass. Read-only scheduled Shipday preview for September 30 at noon succeeded, with courier arrival at 12:19 and buffered in-house arrival at 12:34 Eastern. No order or driver created. A scheduled quote needs at least one qualifying courier arrival; both vendors remain required for round-trip pricing. The buffer is configurable under Pricing and card holds and is saved with new pricing policies.

## 2026-09-28: hosted development manual pickup assignment

Neil reports order #9018 blocked by the environment on pos-dev.lyndry.com. Permit explicit manual pickup actions for the exact development database independently of Node mode. Keep automatic enrollment, direct automatic runs, timers and ticks gated to local development mode. Preserve payment, schedule, hours, duplicate and replacement checks, production/unknown database exclusion, and secure hosted cookies. Verify with mocked providers; never assign #9018 during testing. Independent review and Neil click-test pending.

## 2026-09-28: customer wholesale switch

Neil requests a wholesale toggle beside the customer heading. Development admin service.manage users can switch customers.pricing_category between WHOLESALE and ONE_TIME; stale forms must not overwrite a newer setting. New quotes use wholesale economics for either booking plan; both plan estimates also display wholesale terms. Switching off restores plan-based pricing for new quotes. Do not change saved orders, subscriptions, holds, dispatch, or customer consent. Existing pricing_category column is reused; no migration required. Independent review and Neil click-test pending.

Validation: npm test passed all 1,527 tests, including wholesale precedence for both plans, restoring standard subscription pricing, switch state, stale-form rejection and production exclusion. No actual customer classification changed during verification. Local development only; not deployed.

## 2026-09-28: manual dispatch overrides the automatic pause

Neil explicitly requires a manual order assignment to override the automatic scheduler's live/paused setting. Manual enrollment and every pre-write validation bypass only that setting, scoped to the administrator's request; do not resume the scheduler or change environment activation, payment, schedule, hours, identity or duplicate-request checks. Continue polling accepted jobs while automatic dispatch is paused, but do not create/retry planned jobs automatically. No real driver request as part of testing.

## 2026-09-28: edit individual pickup details

Neil assigned development implementation: explain the dispatch refusal, edit address/date/time/pickup location/service/wash choices from the order page, and remove all six stage-rail cells. Development dispatch is currently paused; report that specific refusal without resuming it. Order edits must preserve the customer's home and other orders, use an order-scoped address, recheck coverage/hours and quote, keep wholesale classification and fixed Standard detergent, and commit details/pricing/audit atomically. Service selection changes this pickup's pricing only, not recurring scheduling. Reject stale forms, past times, collected orders and existing/processing courier jobs; never silently alter an active driver's instructions. Migration 0124 adds only the guarded edit function, applied to development. Rolled-back database tests verified successful atomic edit, stale snapshot rejection and active-dispatch rejection; no order edits or driver actions retained. Independent review and Neil click-test pending.

## 2026-09-28: Shipday pickup assignment controls

Follow-up: always show the Shipday selector on the individual order, including when no dispatch plan exists. An explicit Assign may prepare that one eligible quoted order without broad automatic enrollment; retain current schedule/payment checks and report their exact refusal. Remove Manage pickup entirely in development. Place Cancel pickup next to the customer heading, opening the existing reason/notification choices in a dialog. Do not cancel or dispatch #9017 during verification; its pickup time is past.

Follow-up verification: 1,503 tests passed; the dialog-only adjustment also passed the 21 order-console tests. Browser verification on #9017 confirms Automatic third-party assignment and the actual Shipday LYNDRY option, an enabled Assign button, no Manage pickup section, and the header cancellation dialog opening/closing without submitting. No assignment or cancellation was performed. Google address autocomplete was discussed separately and is not implemented in this change.

Neil explicitly assigned implementation in development. Keep only cancellation in Manage pickup; move driver selection to Customer pickup. Load in-house choices from Shipday, never POS team users, with third-party courier as the other choice. Preserve card, authorization, hours, schedule and saved courier budget checks. Verify the exact remote order and current status, require explicit replacement consent, confirm release before requesting a replacement, and pause uncertain writes without duplicate retries. Assignment requests are not confirmed drivers until Shipday readback confirms them. Poll in-house assignments through order details; treat authoritative failed/canceled order states ahead of stale on-demand details. Disable the old development team/transport POST actions. Keep production and return dispatch unchanged, including existing environment activation gates. Tests use mocked vendors; do not request real drivers as verification. Independent review and Neil click-test pending.

Validation: npm test passes all 1,501 tests, including mocked driver replacement, cancellation uncertainty, duplicate requests, failed-pickup readback, authorization/origin checks and cancellation-only management rendering. No vendor mutations were used for testing. Local port 3000 was not listening at browser verification, so Neil's click-test remains pending. Changes are in the development checkout on codex/shipday-pickup-assignment; not yet deployed.

## 2026-09-28: hosted development POS parity

Neil requested that Keen Hope's pos-dev.lyndry.com show the same POS as pos.localhost:3000. Use the exact known development database identity for POS navigation, pickup dispatch display, portal access/layout and development checkout eligibility, independent of NODE_ENV. Preserve production-mode HTTPS cookies and other runtime security behavior. Hosted portal administrator links use the configured POS host rather than localhost. Keep separate real courier mutation/worker gates unchanged so a presentation deployment does not activate another dispatch worker. No database migration or manual courier actions. Test both Node modes, production/unknown database exclusion and portal links; independent review and Neil click-test pending.

## 2026-09-28: enable Keen Hope POS domain

Neil configured pos-dev.lyndry.com on Keen Hope and requested implementation, commit and push to dev. Recognize that hostname as the POS automatically for the known development database, regardless of NODE_ENV. Allow an explicit POS_HOST hostname override; retain pos.lyndry.com as the production default and pos.localhost for local work. Keep customer links on APP_BASE_URL, shared staff authorization, host-only cookies and existing child paths. Test host separation, login and actions. Independent review and Neil click-test pending.

## 2026-09-28: retire localhost ops URLs

Neil requested removal of localhost:3000/ops and every child URL. Return HTTP 410 for all methods under /ops on the localhost website before staff handlers execute. Keep pos.localhost pages, authentication, actions and internal API aliases working through the shared handlers. This supersedes local legacy URL compatibility only; Railway and live host behavior are outside this change. No database, payment, messaging or dispatch changes. Regression tests required; independent review and Neil click-test pending.

## 2026-09-28: automatic scheduled Shipday pickup booking

Neil explicitly requested implementation after reviewing #9016: after booking and payment checks, create the real scheduled Shipday pickup and initiate Uber/DoorDash assignment without waiting for pickup time. Preserve the selected Eastern pickup time, photo-only proof, saved price and courier budget. Create once, retain the remote ID, distinguish awaiting driver from confirmed assignment, retry only known-safe failures, and pause uncertain mutations for review. Preserve existing card/authorization rules; never advance payment timing or activate production. Scope activation to new development bookings plus explicit recovery of #9016 if its pickup is still valid; do not backfill historical/simulated trips. This supersedes the previous simulation-only pickup restriction, not the return workflow. Show dispatch status/problems in POS. Laundromat incoming rows/counts require current verified driver assignment and must show scheduled arrival date/time separately from live ETA. Tests and development verification required; independent review and Neil click-test pending.

Development verification: migration 0123 validated in a rolled-back transaction, then applied alone. New-booking activation enabled; only existing #9016 was recovered. Shipday job 54009697 scheduled for 4:00pm Eastern, target arrival 4:17pm, DoorDash request accepted at 19:28:47 UTC for a reported $6.68, within the $6.99 budget. No driver was confirmed at verification. POS showed Awaiting driver and the laundromat incoming count stayed zero. The per-order estimate endpoint returned immediate pickups; scheduled assignment now uses a fresh availability quote with the requested pickup time. No production changes. Review and Neil click-test remain pending.

## 2026-09-28: remove maximum-charge display

Neil requested removal of the Maximum at 50 lb row from booking review. Remove its calculated amount and references in confirmation/login copy. Retain the per-pound rate, operational fee, estimated total, minimum charge and existing 50 lb weight limit. This changes presentation only. Review and Neil click-test pending.

## 2026-09-28: operating hours follow the serving laundromat

Neil requires each scheduled development order to fit an eligible laundromat's operating hours on pickup day and its ability to release finished laundry the next calendar day. Reject a requested time at/after closing, before opening, during a break, or past the shop cutoff. A shop closed tomorrow cannot fulfill a next-day order; another eligible shop may qualify. Recheck the selected shop and current hours before final booking, and require a fresh quote if it no longer qualifies. Missing or invalid hours do not establish availability. Remove the legacy van's fixed time bounds and end-of-day rollover from development booking controls; exact submitted times must still pass server checks. Checkout currently asks for pickup time, not a customer-selected return time. This does not add a guaranteed travel duration or a return-time selector. Historical orders and van scheduling remain unchanged. Independent review and Neil click-test pending.

Validation: 1,465 tests pass, including actual partner-hour evaluation for 6pm/7pm, split shifts, next-day closure, malformed hours and a shop closing after quote approval. Signup regression exercises the real account HTTP handler for 07410, New York, no eligible shop and provider failure. Read-only development verification of the full Fair Lawn address returned a Shipday-backed quote. No customer or order was created for verification. Review and Neil click-test remain pending.

## 2026-09-28: prevent false NJ address rejection

Neil assigned a fix for signup rejecting Fair Lawn ZIP 07410 after the public quote accepted the full address. Development address submissions must verify the submitted street, unit, town and ZIP through the existing Shipday quote path, without using stale saved coordinates or the legacy ZIP-only courier check. Distinguish genuine lack of service from failed lookup/provider checks. Preserve validation, saved customer details on refusal, and later schedule/payment/booking guards. Include complete laundromat addresses in the shared service-area query so later courier checks receive real endpoints. Add regression coverage for 07410, out-of-state ZIPs, refusal and temporary failure. Independent review and Neil click-test pending.

## 2026-09-28: Shipday-verified public quotes

Neil requires the public quote to confirm through Shipday that both Uber and DoorDash currently offer both legs between the customer and an eligible laundromat before showing a price. Missing either courier or either direction excludes that shop; provider failures withhold the price. Use the higher confirmed fee per leg so the displayed economics support either approved courier. These are read-only availability calls: no order, driver request, charge or future promise. Recheck at booking. Remove the public “Refine your estimate” date/time card. This supersedes simulated courier costs for new development quotes; preserve saved quotes and production behavior.

Validation: all 1,462 tests pass. A read-only Shipday check for 16-50 Chandler Dr, Fair Lawn and the active Fancy K Laundry location returned Uber and DoorDash offers in both directions ($6.74 Uber and $7.50 DoorDash per leg). The rendered quote used the conservative $7.50 leg cost, stated that both services were checked, and omitted the refinement card. No Shipday order or driver request was created.

## 2026-09-28: Laundromat completed-order history

Neil requested a high-level record of work after return pickup is confirmed. Add Completed orders below the three active queues, showing only order number, measured weight and collection date/time (Eastern), newest first, ten per page with older/newer navigation. Scope records to the signed-in shop through its confirmed collection record. Completion means laundromat handoff; never mark the customer delivery complete. Keep customer details, charges, vendor IDs, editing and intake actions out of history. Refresh history with the existing board update. No order mutation, migration or courier request is needed.

## 2026-09-28: Return delivery time target

Neil flagged the four-hour requested-delivery offset on the in-house return. Replace it with a 30-minute target after the requested pickup instant. This is a scheduling target, not a travel-time estimate or confirmation of pickup. Preserve Shipday live ETA and custody checks. Correct the existing development #9015 return in place only if Shipday confirms the same pre-start in-house assignment; do not create, reassign or cancel a trip.

Validation: all 1,456 npm tests pass, including an exact 30-minute requested pickup-to-delivery interval. Shipday return #54002936 changed from NOT_ACCEPTED to STARTED during verification; the pre-start guard refused the existing-order edit, so its original schedule and driver remain unchanged. New return requests use the corrected target. Local development correction on codex/return-delivery-target; not yet committed or pushed.

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

## 2026-09-28: staff roles and customer texting controls

Neil requested removal of the backend Driver role from the development Team UI because Shipday owns in-house assignments. Remove driver selection, route/home-base columns, driving/wage/rota controls and admin route copy. Reject new Driver role submissions; preserve existing accounts and historical transport data without reallocating routes on staff edits. Separately, fix the customer opt-out control: replace its script-dependent prompt with a visible required request-note field and explicit Turn off text messages action, clarify validation, preserve the existing one-way consent rule and send no text. These are local changes; review and Neil click-tests pending.

## 2026-09-28: pricing and card hold settings

Neil requested visible percentage controls and fixed/minimum/maximum authorization holds in development. Add Admin > Pricing and card holds, backed by the existing versioned pricing-policy table. Percentages remain contribution after direct costs, not net profit. Save the selected hold policy in each new quote; minimum uses its inclusive minimum, maximum uses its saved rate and fee at the existing 50 lb ceiling. Existing quotes and holds retain their settings; no retroactive authorization. Disclose the hold before booking and use it in the shared authorization path for quoted development orders. Keep production, capture timing, retry identity and card eligibility unchanged. No live charges or settings changes during verification. Review and Neil click-tests pending.

## 2026-09-28: reconcile Shipday before pickup edits

Validation: 1,521 tests pass. Migration 0125 installed only in development after rolled-back checks for atomic missing-job detachment and stale-lease rejection. A separate rolled-back test verified existing-job ID and assignment retention. Mocked vendor tests cover in-place editing/readback, missing references, outages, conflicting identities, and unsafe active jobs. Browser verified pricing/hold controls, Team cleanup and visible opt-out note/action. No payment, SMS, Shipday write or order test mutation was retained; settings were not changed. Local code remains uncommitted and has not been deployed to Railway. Independent review and Neil click-tests remain pending.

Neil reports deleting #9017's Shipday job while LYNDRY still blocks edits. A read-only lookup confirmed the stored job 54025642 has no result for LYNDRY-DEV-9017-PICKUP. During Save, claim the dispatch plan, look up its exact reference, distinguish successful absence from outages, and atomically detach a missing job with the order edit. Preserve the old ID in history; do not auto-recreate a deleted job. Explicit Assign can start again. Existing pre-start in-house/unassigned jobs use the edit API and readback with the same ID, preserving assignment. Third-party or started deliveries remain blocked with a specific reason; do not assume editing Shipday forwards changes to Uber/DoorDash. Uncertain updates enter review. Migration 0125 wraps the existing order/payment/quote/concurrency guards. No live courier writes during verification.

## 2026-09-28: in-house assignment must not depend on third-party availability

Neil hit a generic pre-request failure assigning LYNDRY to #9017. Read-only verification confirmed current payment checks pass, LYNDRY is active/on-shift, and no remote reference exists. The earlier failure did not reproduce, but the in-house path incorrectly depended on Uber/DoorDash availability. Skip that quote for in-house selection while retaining scheduled arrival, laundromat hours, card, identity and duplicate guards. Identify the failed check and safe HTTP status in pre-write errors; manual errors say Try Assign again instead of falsely promising automatic retries. No real driver request made during diagnosis or tests.

## 2026-09-28: lead the public quote with subscription pricing

Neil requested the dynamic address quote headline use the subscription per-pound rate, clearly labeled Subscription, and the subscription card precede the one-time card. Presentation only; both saved calculations, fees, minimums and booking choices stay unchanged.

Customer interaction validation: npm test passed all 1,595 tests. Browser verified customer scope, 120ms pointer transitions, 0ms keyboard transitions, desktop homepage and 390px pricing form without horizontal overflow. Visible address fields are 16px with approximately 54px height; submit control approximately 46px. Physical phone and independent review remain pending. No business forms submitted.

Validation: all 1,595 tests passed after final changes. Browser confirmed 250ms reveal token, stationary hero text, visible scrolled content, 0/50/100ms stagger and immediate keyboard reveal. Real phone feel check and independent review pending.

Validation: npm test passed all 1,599 tests, including four new redirect regressions. No real AI conversation or SMS send performed. Independent review and development conversation click test remain pending.

Validation: all 1,603 tests passed, including persistent age, tampering, legacy expiry and rejection after login elsewhere. No real sessions or login codes changed during testing. Independent review and two device click test remain pending.

Validation: all 1,610 tests passed. New tests cover valid components, approximate and unconfirmed addresses, missing keys, provider failure and client key separation. Live Google calls and real widget interaction remain unverified because no project or credentials exist. Google Cloud setup is at identity verification. Feature defaults off; independent review pending.

## 20261001 Weight input focus

Spec: remove the inner box around the quote weight number. Preserve a visible focus indicator on the complete weight control. No pricing or payment changes.

Implemented with scoped CSS. Browser verified no inner outline or shadow, visible outer focus, and recalculation at 30 and 31 lb. Other development changes remain outside this commit. Independent review and Neil acceptance remain pending.

Validation for order header actions: 31 focused tests pass; full suite 1669 pass and two preexisting partner portal wording failures. Desktop and mobile browser checks passed. Obsidian updated. No order mutations, commit, push or production release. Independent review pending.

Delivery recovery validation: 27 focused passes; full suite 1679 pass with two existing partner portal wording failures. Migration 0139 applied only in development. Atomic completion and replay tested with rollback. Browser verified dialogs and safe refusal on 9019 address mismatch. Obsidian updated. No actual completion, charge, message, commit or production release. Independent review pending.

20261002 validation: linked pickup and return IDs verified on order 9019; requested toolbar lines absent. Seventeen focused tests pass; full suite 1681 pass and two existing partner portal wording failures. Obsidian updated. No order mutations or production release.


20261002 verification: order 9021 linked Shipday pickup removed and absence verified. Account stale intent completed and banner absence verified in browser. Full suite 1696 passes, two existing partner profile wording failures. No commit or push. Full bidirectional lifecycle reconciliation remains outstanding; 30 minute schedule anchor awaits Neil clarification.


## 20261002 Customer and POS audit remediation

Neil explicitly assigned Codex implementation and approved the eleven audit plans, overriding Claude-only implementation ownership for this work. Implemented settings renderer recovery, stored-coordinate booking quotes and actionable duplicates, complete address-unit validation, validated atomic partner hours, truthful softener labels, policy-aware public/service copy, completion hint correction, explicit manual driver selection and eligibility hints, and development POS saved-quote review with no-card and quote-category protection. Production rates, historical accepted snapshots and existing payment/reminder/route guards remain intact.

Migration 0141_atomic_partner_hours.sql was applied only to verified development database psrphpgbiifvnlrgvbdg. It is not activated in production. A fresh final npm test run passed 1738 tests with zero failures. New regressions were observed failing before their fixes. Final Codex review findings were resolved; this is not Grok-reviewed or Neil-click-accepted.

Browser checks covered settings, one-time and subscription price review, public copy, structured unit quote, POS reviewed creation followed by silent cancellation of own QA order 9026, no-card refusal, invalid partner hours and explicit disabled driver selection. Automatic assignment was verified paused. No third-party driver was requested. Other work's QA orders and concurrent source changes were preserved. External-network-prohibited lifecycle regression suites passed, including pickup/return retries, cancellation, access checks, weight/payment holds and no-card route/reminder exclusion. Physical provider journey remains unverified.

Two temporary browser price-verification failures succeeded on retry and remain an observation, not an availability bypass. Unstructured legacy quote query was not verified successful. Work remains scoped and uncommitted in the existing dirty development checkout; do not stage unrelated work. Independent Grok review, Neil click acceptance, branch separation and physical pilot are pending. No push, merge or production release.

Evidence: implementation-results.md and implementation-ledger.md under C:/Users/neil/.codex/visualizations/2026/10/02/01a0fce4-0123-7012-af85-ea9c3e14cbf1; approved plans under bug-fix-plans. Full final test output: TEMP/lyndry-fixes-final-tests.log.


## 20261002 Active development booking corrections

Neil assigned implementation directly, including customer workflow, availability selection, minute-level pickup timing, full house numbers, consistent pricing method cards, cheaper alternatives, two offered frequencies, independent account updates, and POS customer table order. Implementation is local and uncommitted in the existing LYNDRY-dev linked worktree on codex/order-detail-actions. No main commit, push, merge, external dispatch, customer text or payment operation was performed.

See the dated decision above in DECISIONS.md and docs/superpowers/plans/2026-10-02-available-laundromat.md. New LYNDRY delivery quotes use configured in-house costs and do not require a third-party quote. Public estimates rank by overall cost; scheduled booking chooses the closest available shop; the explicit cheaper alternative chooses an eligible cheaper shop/time. Existing quote approval and card gates remain.

Regression tests cover closest and cheaper selection, actual Friday/Saturday hours, no external courier dependency, same-minute and final-confirmation boundaries, selected subscription first date and anchor, address number preservation and stale coordinate removal, editable address carryover, one public booking action, schedule before plans, and independent account updates. Reviewer findings about subscription dates, stale coordinates, runtime/admin source gates and pickup edit SQL were resolved. Migration 0142 alone was applied to the verified development database and its checksum/function read back. Other pending migrations and historical checksum drift were left untouched.

Browser verified equal desktop cards in the 960px layout, no monthly choice, no horizontal overflow at 390px or 320px, all three account Update actions with no orders/card, and Details/Wash Preferences before Recurring Pickups. A real phone check, complete card/order click test, independent Grok review and publication remain Neil's final acceptance steps. No work is marked Reviewed or shipped.


### 2026-10-02 latest booking corrections

Subscription frequency is inside the subscription card immediately above Choose subscription. Both pricing method buttons submit their own method and proceed to review. Choosing a cheaper alternative displays the new pickup date and time in a banner on the next page. Wholesale customers retain their applicable rates under both method headings.

Scheduled development checkout accepts a pickup up to ten elapsed calendar minutes earlier than the current minute, so completing checkout does not lose a recently selected time. Eleven elapsed minutes is rejected. Future times remain eligible subject to laundromat hours, capacity and next day return. Arrival checks shift forward by elapsed checkout time while retaining travel and loading allowance. Saved quote expiry and approval remain required.

Verification: npm test passed all 1770 tests with external network blocked. Browser verification confirmed the banner, equal width side by side cards and frequency placement. Changes remain local and uncommitted; main is unchanged. Neil's complete card and order flow, real phone check and Grok review remain outstanding.


Final follow up: all 1772 tests pass after regression coverage for grace period dispatch and single counted arrival delay. In house dispatch shares the checkout grace limit and uses the saved travel and loading duration. Independent narrow agent review found no remaining material issue; this does not replace Grok review or Neil acceptance.


## 20261002 Shipday pricing verification

Implemented locally on codex/order-detail-actions in the shared development checkout. New development public quotes, booking plan prices, alternatives and POS repricing use fresh Shipday address quotes and the lowest valid supported offer in each direction. Booking rechecks current API fees and address, rejects unused in house snapshots and requires review when fees change. Pricing source is separate from driver assignment so no automatic third party request is introduced. Existing accepted order 9027 was not repriced or charged.

Validation: npm test passed 1776 tests with zero failures. Regression coverage includes asymmetric trip prices, missing and failed quotes, unsupported and invalid offers, cheapest eligible arrival, changed address, booking fee changes and driver assignment isolation. The live address API returned 674 cents each way for the original order address and shop; the updated 30 lb estimate was 5718 cents versus the saved 6396 cents. Public quote HTTP check returned 200 with pricing and booking action. Shipday dashboard screenshot showed 649 cents earlier; the existing job estimate endpoint returned HTTP 400, so exact dashboard/API parity remains unresolved. No driver request or customer charge was made for verification. Main unchanged. No commit or push. Independent Grok review and Neil click testing remain pending.

Pickup timing final verification 20261002: npm test passed 1784 tests, zero failures. Supplemental agent review findings were fixed with regression coverage; this is not independent Grok sign off.


## 20261002 Pickup screen correction

Neil clarified the screen must offer Pick up now with Earliest available pickup, or Schedule with date and time in 30 minute increments. Replaced the unclear controls with visible selection indicators and a half hour time dropdown. Removed preparation buffer copy. This supersedes the previous quarter hour customer picker. The change is limited to presentation and schedule selection; existing API pricing checks remain. Development only, not shipped.


## 20261002 Hourly scheduled pickup choices

Neil changed the scheduled pickup dropdown to hourly choices. This supersedes the 30 minute picker. Only the dropdown choices changed. All four focused booking screen tests pass. Local development only.


## 20261002 Consistent quote and booking selection

Neil requires the same pricing methodology when quote and booking have the same inputs and eligible opportunities. Investigation found public address quotes compared every eligible shop by customer total while booking retained only the closest shop. Booking now compares all eligible shops using the same lowest total calculation. This supersedes closest shop selection for new booking prices. Explicitly chosen alternative shops remain constrained to that choice. Scheduled hours, capacity, courier timing, fresh API fees and confirmation checks remain required, so different available offers can still produce different prices.

Regression reproduced the more expensive booking selection before the fix and now verifies matching shop, totals and minimums across all pricing categories for matching eligible options. Full npm test passed 1784 tests with zero failures. Local development only; no deployment or existing order repricing.


## 20261002 Quote schedule comparison correction

Live API tracing reproduced both reported totals after shop selection was aligned. The unscheduled address quote used a 674 cent pickup. For the tested scheduled pickup, Uber estimated arrival about two minutes before readiness and was excluded; DoorDash cost 750 cents. Return cost remained 674 cents. This produced subscription totals 50.62 and 51.49 and one time totals 57.18 and 58.17. The previous shop selection correction alone did not resolve this difference.

Public weight pricing now accepts a pickup date and hourly Eastern time using the existing scheduled quote path. The address estimate is identified as unscheduled. The weight field remains the single submitted weight control. Direct localhost checks verified 57.18 without a schedule and 58.17 with the tested booking schedule. Full suite passed 1784 tests before the final form association correction; direct page checks verified that correction. No booking or driver dispatch. Local development only.


## 20261002 Remove unrequested public scheduling form

Neil requested removal of the public quote scheduling form. It has been removed, including the weight form association. Booking keeps its existing pickup choices. Scheduled quote links now distinguish unavailable pickup time from address coverage failure. The previous route mapped every no eligible shop error to outside service area even when the selected schedule was the constraint.

Verified the reported address returns public prices without a scheduling form. The reported Sunday evening URL now says Pickup time unavailable and does not claim the address is unserved. Full npm test passed 1785 tests. Development only. No order, dispatch or payment changes. This supersedes the prior public schedule form addition.
