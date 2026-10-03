## 20261002 Public address prices remain the booking price basis

Neil explicitly confirmed the public quote is correct and approved fixing the
higher booking quote. For development, use fresh address-only Shipday pickup
and return estimates for customer pricing on both surfaces. Separately check
scheduled pickup and arrival eligibility. The timing-compatible courier fee
must not replace the address pricing input. This supersedes the earlier rule
selecting the lowest timing-compatible offer as the customer price. Preserve
availability checks, saved order prices, category margin targets and dispatch
rules. Neil's request to explain margin versus markup is not a request to
change the pricing formula.

## 20261002 Customer pickup messages and concise development confirmation

Neil requested a short development booking confirmation with pickup and wash
instructions, bag location, any bag and conditional next day return. Omit the
repeated price, card and hold explanation from that confirmation only. Payment
rules and distinct phone/text greetings remain unchanged.

When the verified assigned driver starts a pickup, notify that order's customer
with their saved bag location and current pickup ETA. Ask for the bag between
now and the estimated arrival; if ETA is unavailable, say now without inventing
a deadline. Retry failed provider reads before SMS is attempted, always
rechecking current status and ETA. Never retry an uncertain SMS delivery or
send an on-way notice after collection. This repairs the observed HTTP 429
failure that wrongly stopped an unsent message. Development only.

## 20261002 Approved pickup preparation and fixed quote timing

Development booking offers Earliest available and Schedule for later. Earliest resolves once to a quarter hour at least 15 minutes ahead, configurable with SHIPDAY_PICKUP_LEAD_MINUTES from 15 to 120. The scheduled picker uses quarter hour increments. Preparation time means bag readiness, not guaranteed driver arrival. Show the selected Shipday offer pickup estimate separately. Keep the resolved UTC time through pricing, review and dispatch. Continuing checkout validates the fixed time rather than applying the initial buffer again. Fewer than five minutes remaining requires a refreshed pickup and price review. This supersedes the historical ten minute past time grace for new quotes. Existing historical order handling is retained.

Use fresh supported Shipday offers and the lowest valid price that fits readiness and laundromat hours. A provider pickup timing rejection blocks quoting or assignment rather than silently selecting a more expensive surviving offer. API failure blocks price confirmation. Scheduled times never silently move. Midnight and ambiguous or nonexistent Eastern daylight saving times are tested. Quoting does not request a driver; card and payment guards remain.

Local browser verification reached scheduled price review with the same bag ready time and courier estimate. Earliest was refused when shop hours did not fit. A transient quote failure blocked progress; a subsequent fresh request recovered. No booking, payment, driver assignment or message was submitted. Uncommitted development work only; independent Grok review and Neil acceptance remain pending.

## 20261002 Shipday is the only customer delivery price source

Neil explicitly requires fresh address based Shipday API quotes for public pricing, booking pricing, plan comparisons and POS repricing. Choose the lowest valid supported third party offer separately for pickup and return, subject to pickup and arrival eligibility. Never use configured in house labour, fuel, mileage, static bands or simulated prices as a substitute. A missing, expired or failed API quote withholds pricing and blocks booking. Recheck both directions at booking; changed fees require a new customer price review. Reject unused historical in house quotes. Keep existing accepted orders and payments unchanged until an explicit correction, and keep pricing source separate from driver assignment. Quoting must never dispatch a driver. This supersedes the in house pricing decision and the earlier higher courier fee policy. Development only; main is unchanged.

## 20261002 Approved Shipday address verification repair

Neil approved the bounded design and requested commit and push to development, without merging main. New returns preserve the saved state rather than inventing NJ. Existing non-simulated in-house numeric LYNDRY development RETURN references accept only the exact historical NJ addition when the saved state is blank. Shared formatting and matching serve portal return verification and customer delivery observation. Explicit states, other address fields, linked identity, unique remote result and driver checks remain strict. Pickup verification stays strict. No payment, reminder, routing, customer-copy or duplicate-dispatch changes.

Implementation: src/core/delivery-address.js, partner-delivery-gate.js, partner-return.js and delivery-sms.js; test/delivery-address-verification.test.js. Three reproductions failed before implementation; seven regression cases and 43 focused tests passed. Fresh full npm test on the development working tree with external network blocked: 1738 passed, zero failed. Other uncommitted work was preserved and excluded from this scoped commit.

The original QA return passed read-only verification with the same linked trip and LYNDRY driver. The normal worker recorded a simulated out-for-delivery message. Browser pickup confirmation succeeded, the shop board recorded the handoff, and POS showed OUT_FOR_DELIVERY with the shop audit event. Shop completion is handoff to the driver, not final customer delivery. No replacement trip, reassignment, real SMS or payment action. Final delivery and photo verification, independent review and Neil acceptance remain pending. Development only; main is unchanged.

## 20261002 Cancellation propagation

Neil explicitly requires cancellation of existing LYNDRY orders to reach their linked Shipday jobs. For canceled development orders, remove exact unstarted in-house jobs and verify absence; keep local IDs and history. Started trips, identity conflicts and third-party jobs require visible review. Never create a replacement job during cancellation. Preserve existing payment release and customer notification choices.

## 20261002 Silent admin delivery correction

Neil explicitly removes the photo requirement for manual admin completion and requires no customer text. This supersedes the manual photo requirement in the 20261001 recovery decision. Keep reason, receipt attestation, administrator authorization and settled payment. Preserve existing photos. Automated Shipday reconciliation still requires verified proof. Manual completion suppresses later automated delivery notifications; staff can message separately from the customer account.

## 20261001 Customer pricing base restored for new quotes

Neil explicitly confirmed that the customer pricing base must drive customer quotes and destination comparisons. This supersedes the actual wholesale pricing basis for new development quotes. Keep three distinct rates with identical labels on edit and profile: Laundromat walk-in rate, Our laundromat cost per lb, and Customer pricing base per lb. Walk-in is reference only. Our laundromat cost remains the supplier payment and actual profit basis. Customer pricing base replaces only the washing input to the inclusive customer formula. Keep delivery, processing, tier targets, the 18 lb minimum and 50 lb maximum. If the base is blank, explicitly disclose the existing fallback to our laundromat cost. The target is a pricing margin on the selected base; actual contribution may differ.

Version the new pricing basis in the policy and saved quote. Existing accepted snapshots retain their old calculation even if a historical snapshot contains a customer base field. Freeze both rates for new orders. Update application and atomic database billing consistently, preserve payment and dispatch behavior, and test quoting, minimums, ranking, measured-weight billing, real cost reporting and legacy snapshots. Activate only development. Update Obsidian. Independent review and Neil acceptance remain pending.

## 20261001 Home hero follows the new receipt reference

Neil requested the attached four line hero and two action layout, replacing his earlier three line heading and giant price button decision. Keep the brand typography, green bubbles and offset lavender receipt. Book a pickup is primary and Check my price is a prominent secondary action. The example is visible on phones after the actions, with readable order progress rather than unlabelled dots.

The reference artwork is visual direction, not an instruction to restore old prices or guaranteed turnaround. The card explicitly labels an illustrative 30 lb subscription total of $40.86, with a rounded average of about $1.36 per lb, using the current development formula. A regression checks the illustration against frozen example costs. It is not a price promise for every address. Pickup, return and processing say Included; next day return remains conditional. No order identifiers, customer data or new offers are invented. Development only.

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

## 20261001 Conditional next day website wording

Neil requested that customer website language stop promising next day returns. Shared wording now says: Most wash and fold orders return next day when available. Updated the homepage, booking copy, shared footer, FAQ, how it works, landing pages, service area pages and search descriptions. Operational turnaround values and scheduling rules are unchanged.

All 1629 tests pass. Local development only, not yet committed or pushed. Independent review and final click testing remain pending. Source: Neil's request and development verification in this conversation on 20261001.

## 20261001 Revised transportation fee calculation

Neil explicitly approved transportation divided by one minus category margin, rounded to the nearest cent. This supersedes the previous transportation formula that included percentage and fixed processing costs. Laundry rate calculation is unchanged. Operational allocation is the saved policy percentage, currently 25%, of the adjusted fee total. Service allocation is $1.99 and delivery is the remainder. The allocations are not added again. Low totals cap allocations to prevent negative delivery.

New quote snapshots carry TRANSPORT_MARGIN_V2. Existing accepted snapshots retain their original prices and old fee allocation. The inclusive $15 minimum, final weight billing and category selection remain. Actual processing costs still appear in cost reporting, so the fee target is before transportation processing costs and does not guarantee net profit.

For $13.98 transportation, subscription fees are $15.53 with delivery $9.66, operational $3.88 and service $1.99. One time fees are $17.48 with delivery $11.12, operational $4.37 and service $1.99. Wholesale fees are $14.72 at a 5% target. All 1629 tests pass including billing settlement, rounding, legacy snapshots and low fee cases. Browser confirmed both public quote examples. Development implementation only, not yet committed or pushed. Independent review and final click testing remain pending.

Source: Neil's exact formulas in this conversation on 20261001 and development verification.

## 20260930 Independent laundromat customer pricing base

Neil approved a third laundromat rate in admin. Wholesale remains the rate the laundromat charges LYNDRY and continues to drive partner payables and actual washing cost reporting. Retail remains the walk in reference. Customer pricing base is separately editable and drives new customer quotes before the existing category margin and processing calculation.

Quote comparison and the quoted destination use the resulting complete customer total, including combined delivery fees. Existing saved order prices retain their snapshots. New snapshots retain both the customer base and the true wholesale cost. This supersedes the prior assumption that wholesale cost must also be the customer pricing base.

The new field starts at each existing laundromat's wholesale rate, preserving current prices until an admin edits it. Blank falls back to wholesale. Invalid, zero, negative or more than two decimal place entries are rejected. Older forms that omit the field do not erase a saved base. A management company does not retain a laundromat pricing base.

Example: wholesale $0.70 and customer base $1.00 produces one time $1.30 per pound, subscription $1.15 and wholesale category $1.09 at current category targets and processing assumptions. The invoice cost remains $0.70 per pound. The $1.00 figure is an example, not a rate applied to every shop. Delivery fees and the $15 minimum are unchanged.

Development migration applied. All 1627 tests pass, covering independent saves, invalid values, fallback, legacy snapshots, true cost reports and selection using customer prices. Admin browser reached sign in, so signed in visual verification and Neil click testing remain pending. No production release or implementation commit. Source: Neil's request and the development code, tests and database checks in this conversation.

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

## 20260930 Pricing decision: keep the current method

Neil explicitly cancelled the proposed pricing overhaul and instructed us to keep the current pricing structure and calculations unchanged. He does not accept the proposed replacement. This supersedes the pricing proposals, comparison tables and pending implementation plan from this discussion. They are not approved work.

Preserve the existing dynamic per pound rate, dynamic operational fee, dynamic inclusive minimum, category rules, quote presentation and billing behavior. Do not introduce the proposed included weight allowance, affine replacement, transportation buffer, new fee allocation or payment changes. Reopening this work requires a new explicit instruction from Neil. This records a product decision, not a claim that every order meets a guaranteed margin.

Documentation only. No pricing code, settings, database records, customer quotes or billing were changed for this decision. No production release.

Source: Neil's direct instruction in this conversation on 20260930.

# Google address attribution exception, 2026-09-30

Neil explicitly approved Google attribution on address suggestions. Development pricing may use the official Places widget and server Address Validation. This is a narrow exception to vendor-neutral public copy. Real customer production remains disabled for this implementation.

# Persistent laundromat login, 2026-09-30

Neil requested laundromat sessions remain signed in until a new login elsewhere. Supersedes the eight hour inactivity policy for partner authentication only. The server imposes no age timeout on newly issued signed shop sessions; browser cookies renew for 400 days. New login, explicit sign out, inactive users or inactive shops still revoke access. Staff POS and administrator shop previews keep their existing policy. Browser storage clearing or retention limits can still require sign in.

## 2026-09-30 — Approved POS usability review

Neil approved all recommendations in the POS review. Current operational exceptions and next actions lead order pages; saved customer fields and infrequent messaging controls may collapse. This supersedes earlier visual ordering of those controls, not their permissions or consent rules. Keep all existing operational state transitions.

## 2026-09-30 — Customer website clarity

Price checking is the homepage primary action; returning customers retain a direct booking link. Booking progress uses stable named stages, not changing step totals when saved preferences skip a form. Preserve the existing LYNDRY visual identity and all transaction rules.

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

## 2026-09-29: LYNDRY delivery texts (implementation assigned by Neil)
Use the existing LYNDRY SMS service for delivery updates: retain booking confirmations, add driver on the way/approaching, laundry collected, out for delivery and delivered. Only verified matching live trips generate updates. Customer-side ETA comes from internal tracking, never laundromat arrival ETA for a customer pickup. No tracking URLs, vendor names, partner identity, addresses or driver instructions in these messages. Suppress stale, duplicate and regressing observations across localhost and hosted workers. Record ambiguous sends for review without automatic retries. Preserve STOP, card requirements, billing, dispatch and simulated development SMS. Start with the exact development database; production activation is separate. First observation of a completed trip establishes a baseline without historical messages.
Neil corrected the phone masking proposal: retain the customer phone at their endpoint for driver contact and the business number at the laundromat endpoint. Shipday account tracking/receipt/feedback SMS and email stay off while internal tracking remains available. Do not rewrite active jobs. Independent review and Neil click-test pending.
Photo audit: third-party delivery PHOTO is requested. Mandatory pickup photos and enforcement at both stops in the in-house app remain unverified. Written instructions are not enforcement.

## 2026-09-29: vendor-neutral customer and laundromat websites
Neil explicitly requires that no third-party vendor names appear to non-employees. Replace public quote, booking, payment, informational and privacy-page vendor references with plain service descriptions; preserve truthful availability and data-sharing disclosures. Remove vendor names from English and Spanish laundromat status/photo messages and from provider-supplied driver labels. Keep actual driver contact available. Suppress vendor-bearing booking errors while retaining diagnostic logs. Employee POS integration controls and integration identifiers remain intact. No payment, routing, dispatch, consent or SMS behavior changes. Regression-test public pages, quotes and both portal languages. Independent review and Neil click-test pending.
## 2026-09-28: real automatic scheduled pickup dispatch in development
Neil explicitly assigned the automatic Shipday booking correction. New eligible development bookings create a scheduled Shipday pickup immediately after booking/payment checks and request Uber/DoorDash using the selected pickup time and saved courier budget. A request is not a driver assignment. Ambiguous vendor writes require reconciliation, never blind recreation or reassignment. Existing payment authorization timing remains; a deferred/failed hold prevents a paid courier request until eligible. No production activation or automatic historical backfill. This supersedes simulation-only automatic pickup dispatch for enrolled development bookings; return behavior is unchanged. Laundromat incoming visibility requires verified driver assignment; scheduled arrival and live ETA are separate facts.

## 2026-09-28: operating hours follow the serving laundromat
Neil requires each scheduled development order to fit an eligible laundromat's operating hours on pickup day and its ability to release finished laundry the next calendar day. Reject a requested time at/after closing, before opening, during a break, or past the shop cutoff. A shop closed tomorrow cannot fulfill a next-day order; another eligible shop may qualify. Recheck the selected shop and current hours before final booking, and require a fresh quote if it no longer qualifies. Missing or invalid hours do not establish availability. Remove the legacy van's fixed time bounds and end-of-day rollover from development booking controls; exact submitted times must still pass server checks. Checkout currently asks for pickup time, not a customer-selected return time. This does not add a guaranteed travel duration or a return-time selector. Historical orders and van scheduling remain unchanged. Independent review and Neil click-test pending.

## 2026-09-28: verify public quotes with Shipday
Before showing a development public price, require current Shipday availability and a confirmed fee from both Uber and DoorDash for the customer-to-laundromat trip and the laundromat-to-customer return. Missing either courier or either direction makes that laundromat ineligible. A Shipday outage withholds the price rather than claiming the address is outside the service area. Use the higher confirmed courier fee on each leg in the pricing calculation so either approved courier can be used later. The check is read-only: it never creates an order, requests a driver, charges payment or promises future availability. Recheck availability when the customer books. Remove the separate pickup-date/time refinement card from the public quote result. This supersedes simulated courier costs for new development public and checkout quotes; existing saved quotes remain unchanged.

## 2026-09-28: Laundromat completed-order history
Neil requested a high-level record of work after return pickup is confirmed. Add Completed orders below the three active queues, showing only order number, measured weight and collection date/time (Eastern), newest first, ten per page with older/newer navigation. Scope records to the signed-in shop through its confirmed collection record. Completion means laundromat handoff; never mark the customer delivery complete. Keep customer details, charges, vendor IDs, editing and intake actions out of history. Refresh history with the existing board update. No order mutation, migration or courier request is needed.

## 2026-09-28: Return delivery time target
Neil flagged the four-hour requested-delivery offset on the in-house return. Replace it with a 30-minute target after the requested pickup instant. This is a scheduling target, not a travel-time estimate or confirmation of pickup. Preserve Shipday live ETA and custody checks. Correct the existing development #9015 return in place only if Shipday confirms the same pre-start in-house assignment; do not create, reassign or cancel a trip.

## 2026-09-28: Shipday delivery photos on laundromat intake
Neil requested the driver's delivery photo on the order intake screen and removal of the handover checkbox and its sentence. Show the verified incoming leg's delivery photos beside the weight form, with full-size viewing and an explicit missing/unavailable state. Incoming rows show Delivered / Awaiting intake and a photo link when available. Keep the same incoming photos visible on the order after intake. Photos are served through the authenticated shop/order scope; do not expose vendor payloads, customer pickup photos, return-to-customer photos, addresses or tracking links. Validate remote order ID/reference and destination before exposing any photo. Only the weight form's explicit Accept laundry submission records receipt; a delivered status or photograph never auto-intakes or reveals instructions. Remove the separate handover confirmation requirement, retaining fresh delivery verification, CSRF, weight limits, actor checks and atomic receipt. This supersedes the checkbox requirement in earlier intake decisions. Development only; do not intake #9015 or alter payments/dispatch during verification.


## 2026-09-28: refresh the laundromat board every 30 seconds
The laundromat laundry board must fetch current order status, driver and ETA data every 30 seconds without reloading the page. Replace only the live board region so the search field and any attendant input outside it remain untouched. If refresh fails, label ETA data unavailable and disable intake links until a later successful refresh. Keep the manual Refresh orders control.
## 2026-09-28: dispatch return delivery from a ready order
Neil requested direct dispatch controls on a READY order when no driver is assigned. On the POS order page, show a prominent Return delivery card with separate third-party and active in-house driver choices. The action creates or reuses the durable Shipday TO_CUSTOMER plan and requests the chosen assignment through the existing dispatcher. Recheck order status, settled or waived payment, active in-house availability, existing assignment state, addresses, destination, card/payment eligibility and live-dispatch restrictions at action time. Never replace an assigned or uncertain driver from this shortcut; send those cases to Shipday assignments for review. Showing the card does not book a driver. Development simulation must say that no real driver is requested. No production activation, payment, SMS or automatic dispatch change.

## 2026-09-28: retire separate spending approvals in development
Neil explicitly chose “Retire the approval workflow throughout.” Remove spending-limit screens, proposals and approval holds from booking, intake, dispatch and payment. Checkout still confirms the displayed price; actual weight uses the saved rate, operational fee and inclusive minimum, with the existing 50 lb ceiling. Weight or courier-cost variance does not silently change the rate. An authorized POS destination change immediately saves the recalculated quote and updates the visible price; no separate customer approval is requested. Archive old pending proposals without recording fictional customer consent; preserve historical audit records. Existing pending proposals are archived; effective prices remain in place until an explicit destination change, without inventing weight or a final bill. Preserve authentication, card/hold checks, payment replay protection, settled-payment requirements, verified receipt and live-dispatch restrictions. No payments, messages or driver bookings as part of migration. This supersedes prior spending-limit and revised-price approval rules for this development flow. Main/production unchanged; independent review and user click-test pending.

## 2026-09-28: three-section laundry board and combined intake
Neil explicitly assigned development implementation. Show Incoming deliveries, Ready to wash and Ready to return as separate tables. Incoming rows show anonymous LYNDRY order number, driver/contact, status, destination ETA and Intake. Refresh the open board every 60 seconds without touching intake forms. Prefer documented Shipday driver fields; use its public tracking feed only for sanitized supplemental ETA/contact, never eligibility. Keep tracking/customer payloads and raw IDs out of the portal. Missing, failed or stale data is explicit and never authorizes receipt.
Intake submits full-order weight and physical handover confirmation together, rechecks the matching collected Shipday leg and current shop, then records receipt/weight atomically and reveals wash instructions. Remove the separate acceptance/awaiting-intake stage. Retain weight bounds, actor/shop checks, replay safety, customer privacy, payment and return-dispatch guards. Ready to return marks existing intent, not a driver booking promise. This supersedes the previous two-stage receipt flow. Development only; no main/production changes or live courier mutations. Review and user click-test pending.

## 2026-09-28: verified laundromat receipt; weight-only intake
Neil requires a fresh Shipday collection confirmation for the exact linked pickup and current destination before receipt. Assignment/STARTED alone never qualifies. Future pickup dates, unknown/canceled/failed deliveries, provider outages and mismatched destination stay locked for every role including POS admins. Require attendant confirmation of physical laundry and matching anonymous reference. Persist short-lived server evidence and enforce it again atomically in the intake transaction. Remove internal ticket collection/search/display; keep historical values stored. Weight alone after verified receipt unlocks wash instructions. Correct only demonstrably premature, unweighed #9015 receipt with an audit event. No driver dispatch, charges, messages or production changes. This supersedes the earlier assigned-only acceptance and mandatory ticket rules.

## 2026-09-27: synchronize existing Shipday delivery details
Neil requested that delivery-affecting POS changes update the linked Shipday order, including correcting #9015. Queue changed order destination, pickup time/location and customer/partner contact/address data durably. Update and read back the same remote ID; never create a duplicate, assign a courier, cancel or change provider. Development permits only linked LYNDRY-DEV references. Pre-start in-house/unassigned edits may sync; active third-party trips or started/closed trips require visible dispatch review. Failures remain visible and require reconciliation. Supersedes the earlier no-external-assignment-update limitation for delivery details only. Existing customer price approval remains separate. Main/production unchanged.

## 2026-09-27: order overview and destination pricing
Neil assigned implementation: show pickup/order details, destination and customer pricing prominently; keep customer field actions on the customer profile. Destination changes on unpaid pre-handover development orders create a revised price proposal using the approved quote policy/category and current eligible shop costs. Preserve approved terms until customer approval. Approval must not invent an actual weight or final bill. No automatic change to existing third-party dispatches. No messages sent by this change. Main unchanged; review/click-test pending.

## 2026-09-27: keep portal staff management inside the portal
Neil requested no portal navigation into the LYNDRY backend for any role. Replace the admin Staff redirect with the same shop-scoped staff screen and attendant management used by owners. Remove the Back to laundromat POS link. Logout returns to the shop sign-in, not POS. Keep authorization, CSRF, and shop scope enforced; no role promotion from the portal.

## 2026-09-27: POS administrators can open every laundromat portal
Neil explicitly assigned implementation. Active POS ADMIN accounts, including his 443-745-2665 account, can open each shop from its partner page using their verified POS session. Do not hardcode a phone bypass, create partner-owner records, impersonate an attendant, or broaden sales/driver access. Shop URLs scope each tab and all order actions. Preserve staff-only access to their own shop, existing intake/payment/dispatch rules and audit each admin action as that administrator. This supersedes the earlier instruction to add yourself as a shop owner. Development only; main is unchanged. Review and Neil click-test pending.

## 2026-09-27: retire old development POS navigation
Neil approved hiding the old route, courier and resource screens now that Shipday is the delivery workspace, including in-house deliveries. Remove their navigation and legacy driver-progress display; redirect old screen URLs. This retires presentation only and does not change dispatch, payment, reminder or order-processing rules.

Laundromat courier contact: Neil requires all laundromat pickup and delivery contacts to use +12017712933 (LYNDRY), regardless of the partner record phone. Customer pickup contacts remain unchanged.

Development price confirmation simplification: Neil removed the separate editable spending-limit panel. Show one price summary and confirmation button. Confirmation accepts the displayed 50 lb maximum, calculated on the server from the saved quote rather than a submitted amount. Existing controls for changed pricing, overweight orders, and customer ownership remain. The selected plan is named on review.

Development subscription booking clarification: select exactly one weekday on the web booking form, with server validation. When the selected weekday is today but its time has passed, the first development subscription pickup uses the next occurrence. Invalid one-time dates still require correction; approved quotes are revalidated and never silently moved.

Development standard-return correction: evaluate return collection on the day after pickup, after processing is complete. Finishing after closing on drop-off day does not exclude an otherwise available next-day partner. Closed next-day partners and work not ready before next-day closing remain ineligible. This corrects the development checkout day calculation only; existing approved quotes and legacy routing remain unchanged.

Development quote eligibility clarification — 27 September 2026: Neil requires active laundromats to compete on lowest estimated customer total without a phone-number requirement. Scheduled quotes check availability for laundry drop-off and return collection. Address-only estimates remain preliminary until dates are selected. Pricing still requires a usable location and wholesale cost. Contact details must not filter pricing candidates. Existing confirmed quotes remain unchanged.

Development price review clarification: new development orders have a 50 lb limit. Display the maximum at the quoted terms as max(inclusive minimum, 50 × per-pound rate + operational fee). Changed terms still require customer approval; the displayed maximum is conditional on those terms. Reject excess weight before charging. Address-only prices are preliminary; scheduled checkout rechecks eligibility using the current address.

# Development pricing decision — 27 September 2026

Neil approved development implementation of address-first dynamic pricing: contribution targets after washing, pickup/return courier costs and payment processing are 20% one-time, 10% subscription and 5% wholesale. These are not net margins. Allocate 25% of courier cost to one operational fee; recover the remainder through the calculated per-pound rate. The inclusive minimum is the required total at one pound. Compare eligible laundromats at the same reference weight and category, using the lowest estimated customer total. Customer approval locks the displayed pricing terms and spending limit; any required repricing or higher limit pauses the order for new customer approval. Never silently increase the bill. Policy changes apply to new quotes; historical orders retain their saved prices. Development uses labeled courier simulation and Stripe test mode. Main and live behavior are not changed by this development decision.

The historical fixed rates and minimums below describe the prior flow. Current new development quotes supersede them; legacy orders remain unchanged.

# DECISIONS.md

A running record of things chosen on Neil's behalf, and things still open.
Newest section at the top of each list. Review whenever you like.

---

## What LYNDRY charges today

**One-time pickup: $2.00 a pound. Subscription: $1.80 a pound**, with pickups
weekly, every 2 weeks or every month — and "every month" means every four weeks
on the same weekday, because the round is weekday-based. A $25 minimum applies
per pickup on either rate. The card is charged once, after the bags are weighed.

The single source of truth is `pricing.perPoundCents` and
`pricing.subscriptionPerPoundCents` in `src/config.js`; this line describes
them and has drifted from them before.

**EVERYTHING BELOW ABOUT $39 A BAG IS HISTORY, NOT PRICE.** The open question
further down — "pay-as-you-go only, or memberships too?" — was answered by the
two rates above, and the $39 standardised-bag model was never built. It is kept
because the reasoning around memberships and the constraint that came out of it
("customers must not be forced into a subscription just to establish a payment
method") are both still live, and that constraint is exactly why the $1.80 rate
is a rate rather than a club. Do not read a price off it.

---

## Live infrastructure

- **Site:** [lyndry.com](https://lyndry.com), hosted on Railway, auto-deploying
  from `main`. Domain registered at Namecheap, DNS pointed via CNAME.
- **Database:** Supabase project `lyndry` (`pauaemlehenfrnjvgzmc`).
- **SMS:** Telnyx, number **(201) 554-1877**, webhook `https://lyndry.com/sms`.
  Switched off until `TELNYX_PUBLIC_KEY` is set and 10DLC registration passes.

**Norton antivirus on Neil's laptop intercepts HTTPS** and re-signs every
certificate. It caused two separate failures during setup — Node refusing to
reach Supabase, and Chrome refusing lyndry.com — neither of which was a real
fault. If something works everywhere except Neil's machine, suspect this first.
The `--use-system-ca` flag in the npm scripts is the workaround.

---

## Open questions — need Neil

### 1. Pricing model: pay-as-you-go only, or memberships too?

**Blocks:** the `/pricing` page (phase 5). Nothing before that.

Confirmed so far: **$39 per standardised LYNDRY bag, roughly 15–18 lb**, wash,
dry and fold.

Neil notes that earlier discussions (November) covered several payment
structures — payment link per order, card on file charged after a text
confirmation, monthly membership with a discounted rate, prepaid monthly
allowance, and a building/HOA-paid amenity model. Pound-based tiers were sketched
at $49 / $99 / $179 per month. A firm constraint from those discussions: **customers
must not be forced into a subscription just to establish a payment method.**

The standardised bag is a cleaner unit than pounds, so the natural next shape is
pay-as-you-go at $39/bag with memberships priced in **bags per month**.

**Engineering note, so this doesn't feel urgent:** it isn't. Postgres adds a
column to a live table in milliseconds, and `customers.preferences` is already a
flexible JSON field. Introducing a membership later is a cheap migration, not a
rewrite. The only real deadline is that the pricing page has to say something
truthful before it goes live for carrier registration. Decide by phase 5.

Recommendation: launch pay-as-you-go only, sell memberships once there are
enough customers to know what a typical month actually looks like.

### 2. Rotate the Supabase service_role key before launch

The `service_role` key was pasted into a chat transcript on 2026-08-07. It
bypasses every security rule on the database. Nothing is exposed today, but it
should be rotated before real customer data exists: Supabase dashboard →
Settings → API Keys. Then update `.env` and the Railway environment.

### 3. Neil's street address

`scripts/seed.js` uses a placeholder (`1 Placeholder Ave, Jersey City`). Harmless
for testing, but worth replacing so a simulated order looks like a real one.

---

## Product decisions — confirmed by Neil

**Lockers are shelved; apartments are served door-to-door.** The locker
hardware isn't working, so none is being built. Apartments are now explicitly in
scope and are handled exactly like houses: the customer puts their unit on
`address_line2` and the driver comes to the door.

What this changed, and what it deliberately didn't:

- Every locker promise came off the website — the "coming soon" card, the
  how-it-works paragraph, and the building-manager pitch on the contact page,
  which now offers door-to-door collection as the amenity instead.
- The `lockers` and `buildings` tables **stay**. Dropping them would be
  destructive and irreversible, they hold no customer data, and they cost
  nothing sitting empty.
- `open_locker()` **stays**, still taking no arguments. It resolves the
  caller's own order, finds no locker, and says so. Removing it would mean a
  customer texting "open my locker" gets an unpredictable answer instead of a
  clear one.
- **Anything a customer can read must not mention a locker** until one exists.


**Service area: Northern New Jersey.** This is a description, not a boundary,
and "down to Jersey City" was dropped from it — one van working out of Fair Lawn
should not be promising the Hudson waterfront in the footer of every page.

It still needs to become a concrete list of towns or ZIP codes; until it does,
`booking.inServiceArea()` is the whole enforcement and is deliberately coarse
(New Jersey, `07xxx`), erring towards accepting. The tightening is a one-line
change in one place when Neil draws the line.

**The AI is explicitly forbidden from deciding it.** Same rule as
`open_locker()` taking no arguments: asked "do you come to Princeton?" a model
will happily invent a yes, so it may not reason from the name of a town, may not
list what we cover, and may not say yes before an address has been saved. It
asks for the address; the code answers.

**No legal entity until the concept is proven.** Neil's call, and a reasonable
one. Consequences to keep in view:

- Terms and privacy pages will name Neil as a sole proprietor. **A lawyer should
  read them before launch.**
- Carrier registration for business texting (10DLC) generally expects a
  registered company and an EIN. Sole proprietor registration exists but carries
  tighter limits — typically lower message throughput and no shortened links.
  This may constrain how fast LYNDRY can send texts. Worth confirming with
  Telnyx in phase 3 before it becomes a surprise.

**Launching residential, not apartment buildings.** This is a significant change
from the original brief, which assumed a smart locker in every building.

**Lockers stay in the design but dormant.** The `lockers` and `buildings` tables
and the lock provider adapter get built, so nothing needs re-architecting when
the first locker is installed. Shelly integration and `open_locker()` wait for
real hardware (phase 7). Chosen over deleting lockers entirely because the locker
is the eventual differentiator, and over building both paths now because no
customer would use it at launch.

**Consequence Neil should keep in view:** the locker existed so nobody had to be
home. Residential pickup without one brings that problem back. Marketing copy in
phase 5 must not promise what the launch model can't deliver.

**Pickup method is chosen per order** — bag left outside at an agreed time, or
handed to the driver in person. A default is captured at signup so SMS rarely has
to ask.

**Cancellation:** free and unconditional until the driver collects. Not
cancellable after that.

**Turnaround:** 24 hours. Pickup whenever the customer needs — no fixed route days.

---

## Ops decisions

**`/ops/weight` is a new endpoint, not in the original brief.** Weight-based
pricing means an order has no price until it is weighed, so something has to
record that. It computes the charge from the rate stored on the order, so
changing the price later cannot re-price completed work.

**`/ops/processing` was folded into `/ops/collected`.** In the residential flow
they are the same moment — the driver takes the bag and it is in process. Two
endpoints for one transition would just be two ways to do the same thing.

**Delivery photos are private, with a 30-day signed link.** A photo of a
customer's front door is not something to leave publicly readable. The bucket
denies everything by default and each link expires, which matches what the
privacy policy already promises.

**Deliberately not shortening those links.** They are long, and the delivery
text runs to about four SMS segments as a result — roughly 1.6 cents. A link
shortener would fix that and is exactly the wrong trade: carriers treat
shortened links as a spam signal in 10DLC. If the length becomes a problem,
serve the photo from a short path on lyndry.com instead — a branded domain is
what carriers actually want to see.

**The admin key is compared in constant time.** A plain `===` returns faster the
sooner it finds a wrong character, which is enough to guess a secret one
character at a time.

**`scripts/simulate-driver.js` exists because there is no admin UI.** It drives
the same endpoints a driver's phone would. Without it there is no way to test
the operations half of the product.

---

## SMS decisions

**Telnyx, as originally specified.** Twilio was briefly considered because an
account already existed with a Northern NJ number, but Neil had not been able to
get it working and asked for Telnyx. All Telnyx code is confined to
`src/providers/sms/telnyx.js`; nothing else in the codebase knows the name.

**Registration is a carrier requirement, not a provider one.** Switching from
Twilio to Telnyx does not avoid 10DLC brand and campaign registration — the
carriers demand it regardless of who sells you the number. Worth knowing before
the same wall appears twice.

**A fake SMS driver runs automatically when Telnyx credentials are absent.**
It prints outbound messages to the terminal instead of sending them, which is
what makes `npm run sms` useful before registration is approved. It accepts
unsigned webhooks, so `src/providers/sms/index.js` refuses to load it when
`NODE_ENV=production` — running it on a public server would let anyone
impersonate a customer.

**CANCEL is deliberately NOT treated as an opt-out keyword.** It appears on the
standard carrier list, but for a laundry service a customer texting "cancel"
almost always means "cancel my order", not "never text me again". Treating it as
an opt-out would silently break the product for anyone using the word naturally.
STOP — the keyword actually required — is handled, and Telnyx enforces opt-out
keywords at the platform level as a second line of defence. **Worth reviewing if
a carrier ever objects.**

**Keyword matching is strict: the whole message must be the keyword.** "STOP"
opts out; "stop by at 5" is a message about a pickup time and must not
unsubscribe anyone.

**Someone who has opted out gets no reply at all** until they text START.
Verified: a normal message sent while unsubscribed is logged but not answered.

**`npm run test:signature` proves the webhook signature check works.** In normal
development we run without Telnyx credentials, so that code never executes — a
mistake in it would sit unnoticed until launch. The script makes its own key
pair and checks that good signatures pass and tampered, foreign-key, missing,
stale and replayed ones all fail.

---

## Website decisions

**The design is the LYNDRY design system handoff (v2).** Neil supplied a bundle
— an implementation brief, a screen spec, the design file, an iPhone frame
component, and a complete CSS design system — and asked for the whole site to
match it. It is the third look this site has had and it replaces both earlier
ones outright.

| | Was (v1 "Organic") | Now (v2 design system) |
|---|---|---|
| Ground | `#f5ead8` warm cream | `#FFF8EC` warm cream |
| Accent | teal `#17919b` | Suds green `#0EA47A`, plus Sunbeam yellow and Lilac |
| Text and outlines | `#201e1d`, no outlines | ink `#101210`, **everything outlined** |
| Display face | Caprasimo 400 | Outfit 900 |
| Body face | Figtree | Schibsted Grotesk |
| Labels | Figtree 800 uppercase | Space Mono 700 uppercase |
| Shadows | soft, blurred | hard offsets in pure ink, no blur |
| Header | cream, teal wordmark | ink bar, paper wordmark |
| Corners | pills everywhere | 14/22/32px, pills only on badges |

**Tailwind was removed.** The previous two looks were Tailwind-via-CDN with an
inline config. This system is opinionated enough — a 3px ink outline, a hard
offset shadow, and a hover/press transform on every clickable thing — that as
utility classes it becomes forty characters of noise on every element. It is
plain CSS classes now, in `public/css/lyndry.css`, and the site has no CSS
framework and still no build step.

Tailwind's CDN build also carries a warning against production use, so this
removes a dependency rather than adding one.

**The design system's own CSS is vendored unmodified** into `public/css/ds/`.
The handoff calls it production-ready and says to adopt it rather than
reimplement it, which is right — it means a future update to the system is a
file copy, not a re-derivation. Everything LYNDRY-specific sits one level up.

**Icons are embedded, not fetched from a CDN.** The design system loads each
Lucide glyph at runtime from unpkg.com. We inline them in `public/css/icons.css`
instead. A CSS mask that fails to load does not degrade to "no icon" — it
degrades to a solid coloured rectangle, and this site's links get texted to
customers. The rule the handoff actually cares about — that swapping icon sets
is a one-file change — still holds.

**The phone mock is laid out at real iPhone size (402 × 874) and scaled to
0.6** as one piece, as the handoff specifies. Building it small instead would
mean shrinking every font, radius and bubble by hand and getting them wrong.
It is static: the handoff records that animation was added, reviewed and
removed on purpose.

**Grid ratios are classes, not inline styles.** Found the hard way: an inline
`grid-template-columns` beats the responsive media query, so the pricing band
stayed two columns on a phone and pushed 14px of horizontal scroll onto every
page. Ratios now live in `lyndry.css` as modifiers.

### There is an admin dashboard now

"An admin dashboard" was on the do-not-build list from the original plan, and
it was held for a long time — the answer to "where do I see my orders" was a
SQL query and a terminal script. Neil asked for screens, correctly. The rule
outlived its usefulness and has been struck from the list.

**Screens at `/ops`, separate from the API.** `src/routes/admin.js` renders
HTML; `src/routes/ops.js` stays the JSON API the driver script talks to. The
sign-in check moved into `src/core/admin-auth.js` so both use exactly the same
one and cannot drift.

**People sign in with their mobile number and a texted code.** It started as
one shared code; Neil asked for per-person sign-in, which is right — a driver
who leaves gets switched off without changing a secret everyone else is using,
and every session belongs to somebody.

`ADMIN_API_KEY` stays, but only as the *machine* credential for the driver
script and anything else calling the JSON API. A script cannot receive a text.
Two callers, two credentials; collapsing them would break one or the other.

**The code is never stored.** `ops_login_codes` holds an HMAC of it keyed with
`ADMIN_API_KEY`. Six digits is small enough to brute-force offline, so the
plaintext must not sit in a row that a database leak would expose. Five wrong
guesses kill a code regardless of its expiry; codes are single-use and last ten
minutes.

**An unknown number gets the same answer as a real one.** Saying "no such user"
would turn the sign-in page into a way to find out who works here.

**Roles, not per-person checkboxes.** Three kinds of people work here and they
want completely different screens; picking one from a list is something Neil
can do without thinking about it. `src/core/roles.js` maps role to permission
once, and pages ask `can(user, 'money.view')` rather than checking the role
directly — role checks scattered through templates are exactly how a screen
ends up showing a driver something it shouldn't.

Admin sees everything. Driver sees the orders and nothing else — no customer
list, no prices, no team. Sales sees customers and partner enquiries, but not
the money and not the team.

**`money.view` is its own permission.** A driver needs the stop in front of
them; they do not need the books. Prices are omitted from the markup entirely
rather than hidden with CSS, because a value that never reaches the page cannot
be read out of it.

**New people default to the least privileged role**, and an unrecognised role
posted to the form falls back to it rather than to whatever was sent.

**Nobody can change their own role or switch themselves off.** Either would let
the only admin lock everyone out of team management. The page hides the
controls and the routes refuse them anyway.

**Disabling takes effect on the next request, not in thirty days.** The guard
re-reads the `ops_users` row every time rather than trusting the cookie. A
cookie that stays valid for a month after someone is switched off is not
really an off switch.

**Nobody can switch themselves off.** It is the one action that could lock
everybody out of a tool with no other way in. The page hides the button and the
route refuses it anyway.

**The cookie is not a credential.** It is `userId.expiry`, signed with
`ADMIN_API_KEY`, so a leaked cookie expires by itself and never held a secret.
Rotating that key signs everybody out instantly — the emergency lever if a
phone goes missing. No session table, no store to keep.

**When a code cannot be texted it goes to the server log, and only then.**
Carrier registration is still pending, so texting does not work in production
yet; without this the dashboard would be unreachable on the day it shipped.
It is never written to the `messages` table — a live credential does not belong
in a database row.

**The first person is added from the terminal** (`npm run ops:user`), because
signing in needs a row and adding a row needs somebody signed in. Everyone
after that is added on the Team page.

**Deliberately not a single-page app.** Plain server-rendered HTML with real
forms and real redirects, reusing the site's own stylesheets. It is a handful
of tables read a few times a day; a build step and a JSON API for it would be
cost with no return, and the do-not-build list still rules out React.

**Views are grouped the way the day works, not the way the database is.**
Active means "we have it, or we're collecting today" — that is
`IN_PROCESS`/`OUT_FOR_DELIVERY` plus anything awaiting collection dated today
or earlier. Upcoming is booked for later. Past is delivered or cancelled. An
overdue pickup therefore appears under Active rather than quietly ageing in a
list of future work.

**The customers list runs two queries, not N+1.** Every order is fetched once
and counted in memory. At this size that is faster than a query per customer
and keeps the page to two round trips.

**Partner enquiries got a screen too**, with NEW / CONTACTED / CLOSED. A list
of enquiries you cannot mark as handled is a list you stop trusting.

### The partners page

Neil asked for a page where laundromats can ask to work with us and property
managers can ask to have LYNDRY offered to their residents.

**One page and one form, not two.** The two audiences want opposite things —
one has capacity to sell, the other has demand to serve — but the fields are
identical and the only question that really differs is what "how big?" means.
A single `partner_type` radio splits them, and the copy above the form
explains each in its own panel.

**Enquiries go to a database table, not an email inbox.** There is no email
sending in this system and adding a provider for one form would be a new
vendor, a new key and a new failure mode. `partner_enquiries` is the durable
record; Neil also gets a text through `notify.js`, because SMS is
infrastructure we already have. The row is written first and the text sent
second, so an enquiry survives texting being down — which it is until carrier
registration clears.

**No commercial terms are on the page.** No revenue share, no per-pound rate
to a laundromat, no fee or discount for a building, no promise about volume.
None of that has been decided, and putting numbers on a public page would be
inventing business decisions. The page's job is to start a conversation. The
copy says rates are "worked out per site" and leaves it there.

**The form has a honeypot.** A public form with no CAPTCHA will be filled by
scrapers. A hidden field that a person never sees catches the obvious ones;
they get a 303 to the thank-you page and nothing is saved, so whatever
submitted it has no signal that it was caught. It is not real bot protection —
if the volume becomes a problem, that is a rate limit or a challenge, not more
honeypots.

**`/contact`'s "Manage a building?" panel now points here** rather than opening
a mail client, so building enquiries land in the table with the rest.

### There is a logo now

A later revision of the handoff added one, and it replaced the plain Outfit
wordmark in the header and footer. It is the wordmark inside a chunky speech
bubble — chosen, per the handoff, because the whole service is a text thread.
Set in **Grandstander 900**, cream fill, ink outline, with a `wash & fold`
kicker in Space Mono.

Ported from the handoff's `logo/lyndry-logo-1d.html` rather than re-derived.
`logo(variant)` in `layout.js` builds it; the CSS sits at the top of
`lyndry.css`.

**The tail took the design several passes and is easy to break.** It is one
shape whose top overlaps the bubble's bottom border by exactly the border
width, so the outline opens at the join and no hairline shows through. The
handoff records that a rotated square and a stacked ink triangle were both
tried and both left artifacts. Both wrappers also carry `line-height: 0;
font-size: 0` — without it a stray line box drops the tail a few pixels and the
border reappears as a line above it.

**Grandstander is loaded by a `<link>` in `layout.js`,** not by editing
`css/ds/tokens/fonts.css`. That folder is the design system vendored
unmodified; an edit there would be lost the next time it is replaced.

**The favicon is the avatar variant, drawn as paths.** A webfont never loads
inside a data-URI favicon, so the "L" is a stroked path rather than text. The
tail is painted first and the box over it, which reproduces the same overlap
the CSS does.

**Caveat worth passing on:** the mark is set in an existing display typeface,
not hand-drawn. It is usable as-is. Matching hand-lettered references properly
means paying a letterer to redraw the word.

### The bubble field

Now 72 bubbles rather than 30, tinted from five palette colours (paper,
sunbeam, lilac, suds-200, sunbeam-100), all semi-transparent so they never
compete with the headline. Rises are 16–52s — deliberately slow, because the
handoff records that a faster pass read as fizzing.

The markup is **generated, not hand-written.** To change the count or the
palette, run this from the repo root and paste the result into the `.bubbles`
layer in `public/pages/home.html`:

```bash
node -e "const T=['rgba(255,253,247,0.55)','rgba(255,210,63,0.62)','rgba(201,167,245,0.62)','rgba(169,235,212,0.70)','rgba(255,246,214,0.58)'];const N=72;const j=i=>{const x=Math.sin(i*12.9898)*43758.5453;return x-Math.floor(x)};for(let i=0;i<N;i++){const l=Math.min(99,Math.max(1,1+(i/(N-1))*98+(j(i)-0.5)*2.6)).toFixed(1);const s=Math.round(9+j(i+100)*19);const d=Math.round(16+j(i+200)*36);console.log('    <span style=\"left:'+l+'%;bottom:-'+(s+20)+'px;width:'+s+'px;height:'+s+'px;background:'+T[i%5]+';animation-duration:'+d+'s;animation-delay:-'+(i*2.4).toFixed(1)+'s\"></span>')}"
```

The jitter is a deterministic `sin` hash rather than `Math.random`, so
regenerating produces the same field and the diff stays readable.

**The hero content row is `flex: 1 0 auto`, not `flex: 1`.** With a plain
`flex: 1` the row may shrink below its own content on a short viewport, and the
vertically centred column then overflows into the fact rail.

**Parallax displacement is clamped to start at zero.** The spec's formula,
taken literally, displaces everything above the fold before the visitor
scrolls at all. The threshold is `max(0, elementTop - viewportHeight)`.
Parallax is also switched off below 900px — on a single-column phone layout
there is nothing for it to do.

### Where this build departs from the handoff, and why

**The hero phone field goes to `/signup`, it does not text immediately.** The
handoff's product decision is "enter a number, we text you first". We cannot do
that: the unticked consent box on the signup page is our legal proof of opt-in,
and texting someone before we have it is the thing carriers deregister you for.
The number typed in the hero is carried across and prefilled, so nobody types it
twice.

**The invented customer testimonial is not on the site.** The handoff's own
notes list "Dani R. — customer since March" under placeholder content that is
not real business data. A made-up customer quote on a live site is not something
to ship. The panel keeps its shape and its Sunbeam fill and says something true
instead.

**Handoff content that is factually wrong for LYNDRY was dropped, not
reproduced:** lockers, dry cleaning, standing orders, rush service, $2.25/lb,
20 lb minimums, free delivery over $40, and the fake number (555) 018-2240. The
handoff flags all of it as placeholder written to make the design reviewable.

**Links on Suds green are ink, not `--suds-700`.** The spec asks for suds-700
links on the green consent block. Measured, that is 2.39:1 against suds-500 —
it fails WCAG AA for body text by a wide margin. Ink on the same green is
5.92:1. The underline stays, so a link still reads as a link. This is the only
place the build knowingly overrides a stated colour in the spec.

**The consent checkbox copy is the handoff's, verbatim, and must stay that
way.** It is what carriers read during registration and it is the evidence if
anyone ever disputes opting in. The server already refuses the form without the
box ticked, which the handoff lists as a production requirement.

**Three of the handoff's seven pages were not built** — Business accounts, FAQ
and About. Business accounts exists to quote a volume rate we have not set;
About needs a photograph we do not have. The FAQ content is folded into the
How it works and Pricing pages instead. Say the word and any of them can be
added.

**Pricing shows one plan, not three.** We sell one service at one price.
Inventing two more tiers to fill a three-card layout would be inventing business
decisions, so the three cards became: the price, what's in it, what isn't.

**The QR code is still generated but no longer placed on the home page.** The
handoff's home page has no QR block. `textUsQrSvg()` in `src/web/site.js` is
unchanged and `{{QR_SVG}}` still resolves, so it can be dropped onto any page.

**The `Wash · Fold · Deliver` marquee is gone.** It was the repeating band from
the previous look, and the new design has no place for it — the rising bubbles
and the fact rail carry that job now. If Neil wants it back it is a small piece
of CSS, but two competing repeating motifs on one page is one too many.

**The published phone number is (201) 554-1877** — the LYNDRY Telnyx number,
bought 2026-08-07. (It replaced an earlier Twilio number that was briefly on the
site.)
**Neil's personal number is not on the website anywhere.** Note that this number
cannot actually receive customer texts until business messaging registration is
approved. Blanking the two constants at the top of `src/web/site.js` hides the
number across every page, and the copy falls back to "sign up and we'll text
you" on its own.

**The QR code is generated in memory at first use**, not fetched from a QR
service and not stored as an image file. Nothing to manage, nothing to go stale,
no third party involved.

**Signup does not overwrite an existing customer.** Anyone can type any phone
number into a public form, so allowing an update there would let a stranger
change a real customer's delivery address. A number that already exists gets a
message directing them to email instead.

**Site-wide values live in one file** (`src/web/site.js`) and pages reference
them as `{{TOKEN}}`. Changing the price, the phone number or the service area is
a one-line edit rather than a hunt through nine HTML files.

**The legal pages are placeholders.** They accurately describe how LYNDRY
operates and are written to survive carrier review, but **a lawyer has not read
them.** The clauses most worth a professional eye are unattended pickup and
delivery, and the limitation of liability — those are the ones that matter when
something disappears from a doorstep.

---

## Technical decisions — made without asking

**`--use-system-ca` added to the npm scripts.** Something on Neil's machine
intercepts TLS connections (antivirus or network filtering), and Node does not
trust the Windows certificate store by default, so every request to Supabase
failed with "unable to verify the first certificate". This flag tells Node to
use the system store. Harmless on Linux, where the system store is the standard
one anyway.

**Row level security is on for all five tables, with no policies.** Every
Supabase project ships a public `anon` key meant to be embedded in web pages.
Without RLS, anyone holding that key could read customer phone numbers and
addresses. Enabling it with no policies denies everything; our server uses the
`service_role` key, which bypasses RLS, so the app is unaffected.

**A customer may only have one order awaiting collection at a time**, enforced by
a database index rather than application code. This is what makes "your open
order" unambiguous, which the security model depends on: `open_locker()` works
out which compartment to open purely from the caller's phone number, so there
must be exactly one answer. Orders already being washed or delivered are
excluded, so a customer can still book again while a previous order is in
progress. Relax this if it ever gets in the way.

**Schema lives in `supabase/migrations/` as numbered SQL files**, not only in the
dashboard. The repo has to be the record of what the database looks like,
otherwise rebuilding it means clicking through a UI from memory.

**Statuses are text columns with CHECK constraints, not Postgres ENUM types.**
Both prevent typos; CHECK constraints make adding a status a one-line change,
where altering an ENUM is awkward. This project is early and the statuses will move.

**Money is stored as whole cents in an integer** (`price_cents`, $39.00 = 3900).
Decimal types lose precision under arithmetic. Integers don't.

**Environment settings moved to `src/config.js`.** Originally in `index.js`, but
`scripts/seed.js` needs them too and doesn't start a web server. Same rule
applies: read once, frozen, nothing else touches `process.env`.

**The seed script is idempotent** — safe to run repeatedly. It reuses existing
rows instead of creating duplicates, so it can't quietly fill the database with
copies of the same test building.

**Order states adapted for residential.** The locker path
(`REQUESTED → ASSIGNED → DEPOSITED → …`) is preserved but unused. Residential
orders go `REQUESTED → IN_PROCESS` when the driver collects, then
`→ OUT_FOR_DELIVERY → DELIVERED`. `CANCELED` is reachable only before the laundry
is in our hands, which matches the cancellation rule above.

**`customers` gains address fields** (street, city, state, ZIP), and `building_id`
and `unit` become optional. Residential customers have no building. Phase 2.

**`create_order` gains a `pickup_method` argument** — a direct consequence of
"customer chooses per order". It defaults from the customer's saved preference,
so a returning customer still gets zero follow-up questions.

**CommonJS (`require`), not ESM (`import`).** The most heavily documented Express
setup, which matters when the person maintaining this is searching an error message.

**Express 5, dotenv. Nothing else installed yet.** Libraries get added in the
phase that needs them, not up front.

**`node --watch` instead of nodemon.** Node has file-watching built in now, so
that's one fewer dependency.

**`PORT` added to the environment variables.** Not in the original list, but
Railway assigns the port at runtime and the app has to read it. Defaults to 3000
locally.

**`trust proxy` enabled.** Railway sits behind a proxy. Without this the app
records the proxy's IP rather than the visitor's — and `sms_consent_ip` is legal
proof of opt-in, so it has to be the real one.

**Model resolution is a boot-time config read for now.** Genuine validation
against the Anthropic API arrives in phase 4 with the SDK. What matters is
already true: it happens once at startup, never per message.

**Missing environment variables warn rather than crash.** A fresh checkout boots
and tells you what's missing, instead of failing with a stack trace.

**Graceful shutdown on SIGTERM.** Requests in flight finish before the process
exits during a redeploy.

**`.claude/settings.local.json` is gitignored.** It's machine-specific tooling
config, not project code.

---

## Payment decisions

**Stripe, using Checkout to save a card and off-session charges to bill it.**
Neil's own proposal, and the right one. Payment processing had been deliberately
deferred; he brought it back in scope with a specific architecture, which this
build follows.

The shape: SMS → LYNDRY → Supabase customer → Stripe customer → one Stripe
Checkout page → saved card → every order after that is text only. The phone
number stays the account identifier; there is still no login and no app.

**No card number is stored, logged or received anywhere in this system.** Only
Stripe's reference to a saved card, plus the brand and last four digits for
display. Taking real card numbers would put the business inside PCI DSS, a
compliance programme with audits attached. This design stays outside it.

**The card is required before the first booking, not at signup.** Signup stays
a website form with no payment step; `create_order` is what refuses. That check
is in code rather than in Claude's instructions, for the same reason
`open_locker()` takes no arguments — nothing a customer types should talk its
way past it.

**Charging happens automatically when the bag is weighed.** Chosen over waiting
for a second "YES". By that point two authorisations are already on record: the
consent text on the Stripe page, and the booking confirmation naming the card.
A second confirmation would stall the order overnight with the laundry already
washed, for no legal gain.

**The consent wording has to cover a variable amount.** Wash and fold is priced
by weight, so at the moment the customer agrees, nobody knows the figure. The
sentence in `src/core/billing.js` says the amount is worked out after weighing
and that we text the total every time. Read it before changing it — it is what
makes an off-session charge authorised rather than a surprise.

**A declined card DOES hold up a delivery, reversed 14 September.** This entry
used to read *"a declined card does not hold up a delivery - we deliver and chase
by text"*, and that was right while the card was charged at delivery: refusing
then would have stranded a driver on a step with an armful of clean laundry.

The charge moved to the door on 12 September. A card that fails at a doorstep now
leaves the bags where they were found, so the only laundry that can reach a
decline-while-we-hold-it is laundry already taken in good faith. Neil, on #2060:
it does not go back to a doorstep until the balance is nothing.

What did NOT change: we still retrieve held bags off the laundromat rather than
leaving them on somebody else's shelf, and the order is paused rather than
cancelled. See `dispatch.paymentHold()`, and CLAUDE.md for the leg-by-leg rule. `/ops/waive` is the lever for writing one
off; it records WAIVED rather than marking it paid, so the books distinguish
money that arrived from money that was let go.

**The payment link is `lyndry.com/pay/<token>`, not a Stripe URL.** Carriers
score a texted link partly by its domain. Same reasoning as the delivery-photo
links, and the same reasoning behind not using a link shortener.

**Stripe's idempotency key includes the attempt number.** Stripe caches the
result of a key, including a decline — so a key built only from order and
amount would replay "your card was declined" at a customer who had already
fixed their card.

---

## Deferred — deliberately not built

Customer app or login · admin dashboard · multi-building routing · TypeScript,
React, bundlers, Docker, job queues · more than one deployment target.


## 27 September 2026 — anonymous laundromat intake

Neil replaced the courier PIN and LYNDRY bag-label/count model for the new development portal. The attendant accepts physical delivery first. Later they save the laundromat's internal tracking number and full-order weight, which unlocks only structured wash instructions. No customer name, phone, email, address, payment details or prices go to the laundromat interface. Courier delivered status is separate from attendant acceptance. An unmatched reference requires LYNDRY resolution, not an automatic guess. The 50 lb order limit and existing payment/spending checks remain. Production rollout and real courier reference visibility remain separate validation steps.

## 2026-09-28: In-house return collection in development
Neil assigned implementation: Ready to return requests a real Shipday return trip from the laundromat to the customer, assigned to the single active/on-shift in-house driver. Existing ready simulated records offer Request return driver. Never book a third-party courier here. Require completed verified intake, readiness, and settled/waived payment. Preserve shop scope and administrator audit identity. Claims, stable references, saved remote IDs and readback prevent duplicate requests; uncertain mutations require review.

Ready rows show order, weight, driver/contact, collection status and pickup-location ETA, refreshed every 30 seconds. Do not substitute customer-arrival ETA. Original incoming delivery photo remains available on collection detail. Confirm picked up requires fresh matching Shipday order, endpoint and assigned-driver evidence of pickup, then atomically stamps collection and moves READY to OUT_FOR_DELIVERY. Replays are harmless. No customer information enters the portal. This supersedes the earlier simulated-return-only limitation for explicit development in-house requests. Production and third-party dispatch remain disabled. Independent review and Neil click-test pending.

## 20261001 Admin delivery recovery

Neil authorized recovery actions at the top of an order. For development orders out for delivery, an admin may reconcile a verified Shipday return with proof or manually record completed delivery with photo, attestation and reason. Require paid or waived payment; transaction locks the order and checks current evidence. Recovery records the current confirmation time and audit reason, does not invent an earlier delivery time, and does not charge or resend messages. Existing edit and cancellation guards remain. This supersedes reliance on the legacy driver task list for admin completion of Shipday orders.


## 20261002 Development customer booking and pricing method flow

Neil explicitly assigned implementation in LYNDRY-dev and asked to proceed without approval. These rulings supersede earlier development quote selection and courier availability requirements for this flow. Production behavior and historical accepted order terms remain intact.

Public address pricing compares the lowest overall estimated total without a pickup schedule. It presents subscription and one-time as pricing methods and has one Book a pickup action. The quoted address and apartment are editable setup defaults, not an accepted quote or an automatically saved profile.

Booking confirms address and pickup details, collects missing wash instructions, asks date and time, then prices the closest eligible laundromat for that schedule. Arrival, washing turnaround, next-day collection, radius and capacity must fit. LYNDRY supplies delivery; third-party courier offers must not block this development flow. Delivery costs and travel estimates use the existing routing configuration, never fabricated zero costs. New in-house quotes cannot automatically enroll third-party dispatch. Existing card, authorization, hold, identity and delivery guards remain required.

Time defaults to the current Eastern minute in the existing date/time controls. There is no Immediately selector. This minute is accepted regardless of seconds; earlier minutes are rejected, including at final quote validation. Scheduling copy is Any time, any day.

The booking comparison uses the public pricing card component, side by side on desktop and stacked on narrow screens. Customers select their pricing method once. Measured weight determines the final bill. New development booking frequency choices are weekly or every two weeks; monthly is removed from this chooser without changing historical schedules.

A cheaper alternative searches the next fourteen calendar dates from the chosen pickup, including later minutes that day. It finds each cheaper shop's earliest eligible minute, compares both pricing methods at the entered weight, and offers the lowest combined estimate with earlier time as the tie break. Neither pricing method may become more expensive. Estimates are per pound and explicitly tied to the shown weight. The customer must choose the alternative; availability and price are rechecked. Changing the pickup schedule clears the alternative shop choice.

Full hyphenated house numbers are preserved by autocomplete. Server address validation refuses a number change rather than silently truncating the number. Changing an address without new verified coordinates clears old coordinates.

Account address, wash and payment Update actions are always visible, including for an account without orders or a card. The existing authenticated card setup route works independently of booking. POS customer Details and Wash Preferences tables share the first row; Recurring Pickups follows beneath.


### 2026-10-02 latest booking corrections

Subscription frequency is inside the subscription card immediately above Choose subscription. Both pricing method buttons submit their own method and proceed to review. Choosing a cheaper alternative displays the new pickup date and time in a banner on the next page. Wholesale customers retain their applicable rates under both method headings.

Scheduled development checkout accepts a pickup up to ten elapsed calendar minutes earlier than the current minute, so completing checkout does not lose a recently selected time. Eleven elapsed minutes is rejected. Future times remain eligible subject to laundromat hours, capacity and next day return. Arrival checks shift forward by elapsed checkout time while retaining travel and loading allowance. Saved quote expiry and approval remain required.

Verification: npm test passed all 1770 tests with external network blocked. Browser verification confirmed the banner, equal width side by side cards and frequency placement. Changes remain local and uncommitted; main is unchanged. Neil's complete card and order flow, real phone check and Grok review remain outstanding.

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
# 2026-10-02: real SMS from hosted development

Neil requested the same Telnyx number and credentials for development testing.
This supersedes the blanket development outbound block only for the explicitly
enabled, known Railway development site. Neil explicitly authorized any recipient
selected by the app, with no extra recipient or link restriction. Every text starts
with DEVELOPMENT. Local processes retain their existing simulated sending.
Development delivery receipts use a per-message webhook; the
live number's incoming replies remain on production. No global webhook switch,
payment-mode change or shared customer database is authorized by this change.
## 20261002 Development booking notifications go to the customer

Neil explicitly requested that order texts go to the customer associated with
the order, after a staff alert created an unrelated dummy-number conversation.
Disable the separate new order staff alert in development. Customer booking
confirmations retain their existing order customer recipient. This supersedes
the historical admin new order notification rule for development only. It does
not add a recipient allowlist or change production notifications.
# 2026-10-03: real return requests from laundromat readiness in development

Neil requested working return dispatch after laundromat outtake. Development
identity, rather than NODE_ENV, enables this on Railway. The existing automatic
dispatch switch selects third-party requests; when paused, the laundromat request
waits visibly for an admin to choose an in-house or third-party driver. Real
requests replace simulated returns only through an explicit order action. Both
portals show the shared request state. Requests are not assignments or physical
collection. Reconcile uncertain results using the same remote reference and do
not create duplicate deliveries. Preserve payment, weight and destination checks
and the saved courier budget. This supersedes the earlier simulation-only return
and in-house-only portal restrictions for development; main is unchanged.
