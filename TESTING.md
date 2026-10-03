# LYNDRY testing tracker and launch readiness

## Latest result: 2026-10-02 booked-order walkthrough

QA #9025 reached DELIVERED/PAID through verified Shipday proof and explicit POS sync. Delivered text and test photo were simulated and visible; repeat sync preserved payment, messages, original trips and completion count. The walkthrough completed with failures and recovery, not a clean golden-path PASS. Address mismatch was fixed and pushed in 2cb7d08. Missing quote/old-price SMS, unconditional turnaround, payment wording, stale return REVIEW and sync warnings, simulation labels and billable-weight display remain open.

See [full execution report](docs/testing/2026-10-02-order-flow.md) for addressed work, failure causes, results and remaining live variants. Final isolated npm test: 1738 passed, zero failed; focused lifecycle assertions: 95 passed, zero failed. The integrated run used 2cb7d08 plus preserved uncommitted development work. No third-party dispatch or live SMS. Main unchanged; independent review, pilot and production approval remain pending. Earlier BLOCKED environment/case rows below are planning history; this run authorizes and records only the synthetic #9025 local scope, not every listed variant.

Updated 2026-10-02. This is the single testing tracker for independent testing, one laundromat pilot, and production go/no-go. It replaces the older SMS simulator checklist. Online booking is the intake under test; SMS remains for updates, support and compliance.

## Start here

1. The recorded local baseline completed: **1,708 tests passed, zero failed**, on dirty branch `codex/order-detail-actions` at `8517473`. Run LOCAL-20261002-01 proves the assertions executed then, including mocks and source checks. Other work changed application/tests during this task; **the latest working tree needs a new baseline after stabilization**. It does not prove an actual order journey.
2. Resolve ENV-01 before starting the app, submitting a booking or using a provider. Development data and a test Stripe key do not make Shipday writes harmless.
3. First interaction test: **ISS-02**, return-weight hold -> admin resolution -> failed/uncertain return dispatch -> safe recovery. First complete golden path: GP-01 with synthetic data and all external dependencies intercepted; then GP-02 with exact approved provider scope.
4. Defer cosmetic changes unless they prevent a required action or make its result misleading. Application fixes require separate specs for Claude Code.

**Current gate:** isolated integration BLOCKED; laundromat pilot BLOCKED; production NO-GO. Unit tests alone cannot clear these gates.

## Authority, checkout and evidence

Expected business behavior comes from the current Issue/current [HANDOFF.md](HANDOFF.md) section and [DECISIONS.md](DECISIONS.md). [CLAUDE.md](CLAUDE.md) gives conventions; [AGENTS.md](AGENTS.md) assigns implementation to Claude Code, independent review to Grok, and acceptance/merge to Neil. Code observations below are not approved policy. Record ambiguous behavior as decision needed; stop the affected case, not unrelated safe work. Flag code/DECISIONS conflicts rather than choosing a rule.

The [historical cleanup audit](docs/cleanup/2026-09-26-audit.md) and vault dispatch reconciliation review supply leads, not current reproductions. Earlier handoff/vault runs reported two partner-profile wording failures; this fresh run has zero failures. Do not copy earlier results onto this checkout or claim that a particular fix resolved them. GitHub main alone is shipped truth; remote main, deployed build and migration parity were not verified here.

Existing dirty application/test/migration work was preserved. No branch switch, reset, commit, push, merge, migration, deployment, customer write, provider request or partner communication was performed. Repository `.agents/skills` was absent; installed verification and Playwright skills were inspected. No dependencies or remote scripts installed. Vault CLAUDE.md, Index and latest Log were read. No checkout-specific Claude memory directory was found.

Final hash comparison found concurrent source changes in public/pages/faq.html, public/pages/home.html, src/core/intake.js, src/core/partners.js, src/routes/admin.js, src/web/pickup-dispatch.js and test/intake.test.js, plus newly present files/tests/migration. These were not edited by this testing task. The starting fingerprint was not a frozen checkout; do not treat LOCAL-20261002-01 as validation of the latest files. Preserve the other work and retest the stable candidate. One suite was executed in this task; no second run was started.

## Environment gate: confirm before each integrated run

| ID | Required record / exact unresolved question | Status | Owner / next step |
|---|---|---|---|
| ENV-01 | Which exact URL/process, build and database may the test write to? Are only synthetic records allowed, and are all background workers scoped or disabled? Current config reports development DB, fake SMS, test payments **and a Shipday key present**. App startup registers schedulers, real development pickup booking, detail sync, cancellation and notification polling. The app was not started. | BLOCKED | Neil confirms scope; Claude Code supplies isolated harness/config evidence. |
| ENV-02 | Are Stripe test customer creation, setup, authorization, capture, release and refund permitted? Which synthetic account and maximum amount? Do keys, webhook secret, saved cards and records belong to the same test account? | BLOCKED | Neil approves exact test operations; tester records modes without keys. |
| ENV-03 | Which Shipday account and exact driver ID/name are allowed? May scoped jobs be created, assigned, edited and removed? What auto-assignment and fees apply? “Linjury” is user supplied, not verified in local docs/code. Simulator label “LYNDRY test driver” is synthetic and does not establish the real configured label. | BLOCKED | Neil authorizes read-only driver lookup first; verify name, ID, active/on-shift state. No third-party courier request. |
| ENV-04 | Are all SMS/MMS, sign-in codes, admin alerts, issue pages and partner messages intercepted? Which later real-phone test, recipients and budget are allowed? Fake sends cannot prove carrier delivery. | BLOCKED | Neil approves any real messages separately; tester proves interception first. |
| ENV-05 | Which one laundromat, operator accounts, physical test bag, driver, dates, stop conditions and cleanup are approved for the pilot? | BLOCKED | Neil selects scope after isolated integration passes. |

External reads/test actions require parent/Neil approval with exact scope. Past repairs do not authorize using old orders or provider jobs as fixtures. Do not use existing development orders as disposable data.

Run setup must record: data identity, public/POS host routing, build plus dirty hashes, applied migrations/schema parity, pricing-policy version, synthetic account IDs, provider modes, dispatch settings, worker/timer scope and allowed side effects. Verify environment again before cleanup. No secrets or customer contacts in evidence. Do not run seed/reset/migrate/sms/driver/dev as a shortcut. The old SMS simulator posts to a running app and can persist actions and trigger AI, alerts and workers.

## Actual topology and separate state dimensions

Two transport legs form the partner journey:

```text
customer -- TO_PARTNER / PICKUP --> laundromat
customer <-- TO_CUSTOMER / RETURN -- laundromat
```

Each leg has a separate dispatch plan, Shipday ID, external reference, driver and version. Real development commonly uses LYNDRY-DEV-<number>-PICKUP and ...-RETURN. Verify stored identity rather than constructing a mutation target. Active `courier_deliveries` records are another delivery path and must prevent a parallel Shipday booking. A LYNDRY DRIVER login does not establish a Shipday assignment.

| Dimension | Actual behavior | Source |
|---|---|---|
| Generic order | REQUESTED -> IN_PROCESS -> AT_PARTNER -> READY -> OUT_FOR_DELIVERY -> DELIVERED; self-wash can omit partner states. Locker ASSIGNED/DEPOSITED are outside pilot target. Generic status updates compare the old status. Cancellation only before custody. | src/core/orders.js |
| Development shop receipt | Verified combined-intake RPC can move REQUESTED or IN_PROCESS directly to AT_PARTNER. Generic orders.transition is not the only status writer used here. Do not require an intermediate persisted IN_PROCESS solely from the generic diagram. | migration 0131; partner-intake.js |
| Portal | INCOMING/WASH/READY derive from verified intake/completion and ready_at, not solely order status. Wash complete is an intake timestamp, not READY. Shop “Completed orders” means handed to return driver, not delivered to customer. | partner-intake.js; shop-intake-page.js |
| Payment | Card setup, fresh hold, measured price and settled amount are separate. Return request and collection require PAID/WAIVED. Partner Ready RPC does not itself check payment. Intake settlement failure retains receipt/weight and sets needs_review. | billing.js; dispatch.js; partner-return.js; migration 0131 |
| Return weight | PENDING/PASSED/HELD/RELEASED; tolerance may be disabled. Read actual setting; assume no fixed pound difference. Held return stays at shop. | migrations 0127/0128/0131; weight resolver |
| Dispatch | PLANNED/PROCESSING/ASSIGNED/BLOCKED/REVIEW and terminal values including COMPLETED/CANCELED. Ready can coexist with dispatch failure. REVIEW is an uncertain provider outcome requiring reconciliation before a new request. Claims compare versions. | shipday-dispatch.js/runtime; partner-return.js; cancellation runtime |
| Issue | OPEN/RESOLVED, one open issue per customer. Multiple order-weight reasons can share a row. AI pause, payment debt, return hold and dispatch review are independent blockers. Generic issue closure does not clear all of them. | issues.js; ai-pause.js; dispatch.js; weight resolver |
| Customer labels | REQUESTED/ASSIGNED “Booked in”; IN_PROCESS/AT_PARTNER/READY “Being washed”; OUT_FOR_DELIVERY “Out for delivery”; terminal delivered/canceled. Check broad labels against custody and useful next step. | routes/account.js |
| Updates | Shipday polling validates leg/ID/reference/endpoints/current driver and drives milestone/ETA outbox. It is not a general order-status synchronizer. First sight of an already completed trip skips historical texts. Manual admin completion suppresses later automated text/photo observation. | delivery-sms*.js; delivery-photo-worker.js; recovery/migration 0140 |

No Shipday webhook route was identified in inspected registration paths. Duplicate/out-of-order **poll observations** and claims are the actual current Shipday tests. Signature/duplicate callback tests apply to registered payment/SMS/courier endpoints; add a Shipday callback case only if that contract exists.

## Role and scope matrix

Test rendered HTML/data **and direct requests**. Disabled buttons alone do not prove enforcement. Use two synthetic customers, partners and drivers, and separate browser sessions. Record implemented refusal semantics without leaking another person's record.

| Actor | Allowed / conditional | Forbidden / visibility scope |
|---|---|---|
| Customer | Own online booking, card setup, order views, permitted pre-custody changes/cancel; separate legitimate pickups on permitted different dates. | Other customer order/photo, shop/admin action, post-custody cancel, money/state changes via SMS instructions. |
| ATTENDANT | Own active shop; verified intake, wash complete, blind return weighing/Ready, guarded request, manual handoff confirmation; wash choices after intake. | Other shops/photos; customer names/addresses/phones/payment/retail totals; hold release; staff management. Verified driver contact for handoff is separate from customer contact. |
| OWNER | Attendant operations plus own shop staff management. | Promoting another owner, managing another shop, global customer/money access. Revocation/inactive partner enforced next request. |
| POS ADMIN | Issues, money/audit, guarded order overrides/recovery and shop portal access. Driving only when enabled. | Bypassing payment, state, evidence freshness or identity because role is admin. No arbitrary status selector. |
| POS DRIVER | Assigned work/route, orders.act/drive, necessary address/access/bag details. | Customer name/phone/list/conversation, money/audit, issue resolution, recovery, global shop portal. Test assignment scope as well as role. |
| POS SALES | Orders/customer/conversations, message sending, partner enquiries and audit permission in roles.js. | orders.act, money.view, issues.manage, override, portal/team. Audit has a separate grant: test actual fields and escalate ambiguity instead of assuming financial audit visibility is approved. |
| Shipday driver | Exact assigned approved job with matching pickup/dropoff/proof. | Other order/leg, former assignment proof, authority to clear LYNDRY issues/payment. |
| Worker/machine | Configured narrow tasks, durable claims and verified observations. | Side effects from stale versions/claims, blind duplicate request after uncertain outcome. Machine key has broad permissions and is not a substitute for user-role tests. |

## State, UI, enforcement and effect checkpoints

For every ST row save customer view, shop board/detail, admin/driver/sales permitted views, valid control, wrong-role/state/stale direct POST, final data and payment/job/SMS/audit deltas. These describe current implementation and known invariants; policy questions below remain open.

| ID | Preconditions / steps | UI and server expectation | Effects / last valid checkpoint |
|---|---|---|---|
| ST-01 | Quote/book with missing card/consent/address, declined hold or expired quote; replay submission. | Clear incomplete/blocked state and recovery; no false confirmed pickup; wrong customer's intent/session rejected. | No pickup route, driver request or bag-out reminder without card. Accepted snapshot/identity frozen. Checkpoint: intent/accepted booking. |
| ST-02 | REQUESTED with no assignment, then matching assigned pickup, then STARTED only. | Customer Booked in; Incoming only after verified assignment; intake/wash instructions locked for STARTED alone. Admin edit/cancel within guards. | One pickup job; hold, schedule and shop hours checked. Scheduled time distinct from ETA. Checkpoint: plan/version. |
| ST-03 | Matching collected pickup and physically matching bag/reference today/past; stale/wrong/future evidence. Submit invalid then valid full weight. | Intake only with valid current proof and physical confirmation. Cross-shop POST/photo rejected; invalid weight/reference rejected. | Atomic receipt/weight -> AT_PARTNER, one event; settlement after save. Failed settlement retains intake + review. Checkpoint: receipt. |
| ST-04 | AT_PARTNER/WASH; wash-complete twice in two tabs. Try Ready before wash complete. | Wash choices visible; customer Being washed; wash complete opens weighing, not delivery; early Ready refused. | One timestamp/event; no trip or customer text merely for wash completion. Checkpoint: wash completed. |
| ST-05 | Fresh blind return weight within/beyond configured tolerance; invalid values. Forge staff hold release. | Old weight hidden until mismatch; HELD replaces return controls with retain-bags/escalation; staff cannot release. | Passed -> READY; mismatch -> HELD + order-specific customer issue, no dispatch. Return weight does not reprice customer. Checkpoint: passed/released check. |
| ST-06 | READY with settled vs failed payment, active other courier, BLOCKED/REVIEW/ASSIGNED return. | Awaiting driver/attention, customer still Being washed; only safe retries. Server revalidates payment/weight/partner/job. | Ready survives request failure; one return job; uncertainty -> REVIEW. Request is not custody transfer. Checkpoint: return plan/version. |
| ST-07 | Exact return driver collected; shop physically confirms handoff twice; reassignment/endpoints change after GET. | Confirm Pickup disabled until verified, then confirmation-needed. Failed refresh disables. Stale driver/version refused on POST. | One collected stamp -> OUT_FOR_DELIVERY; shop history is handoff, not customer Delivered; no new money/trip. Checkpoint: shop handoff. |
| ST-08 | OUT_FOR_DELIVERY; matching fresh delivered return/photo, repeats; manual admin recovery. | Sync requires linked matching real return and fresh proof; manual requires reason 10+ chars, received attestation, PAID/WAIVED and correct state. Nonadmin recovery denied. | One completion/audit; sync stores proof; manual preserves existing photo and suppresses later automatic texts/photos. No charge or provider mutation. Checkpoint: delivery. |
| ST-09 | DELIVERED/CANCELED; stale forms, restarted workers, old observations. | Closed controls cannot revive work; remote cancellation pending remains explicit. | No new trip/charge/text; keep IDs/history/reconciliation. Checkpoint: terminal + reconciled ledger. |

Each ST result is currently **BLOCKED ENV-01..04; run none; tested commit/environment none; evidence none; retest not started; owner independent tester + Neil**. Code mapping is not PASS. Record separate role/variant results.

## Executable interaction cases

Each case also applies the relevant ST and role checks above. Isolated integration means a disposable/transactional data fixture with all outbound dependencies intercepted and counted. Such a complete integration harness has not been demonstrated. Mocks are labeled as mocks.

| ID / priority | Preconditions and steps | Expected result | Status / next owner |
|---|---|---|---|
| GP-01 / P1 | Synthetic customer, partner, test hold and single driver. Online quote/book -> pickup evidence -> intake/settle -> wash-complete -> return check -> Ready/request -> manual shop handoff -> delivery proof -> reconcile. Repeat each boundary. | One order/snapshot, one pickup and return, correct custody/settlement/audit and unique eligible updates. All role displays and forbidden POSTs match ST. | BLOCKED ENV-01. Claude Code provides separately assigned isolated harness; independent tester executes. |
| GP-02 / P1 | Repeat GP-01 with exact approved Stripe test operations and named Shipday in-house jobs; SMS intercepted. | Local/provider identities, amounts, timings and proof match. No third-party/live customer effect. | BLOCKED ENV-01..04. Neil approves account/order/driver scope. |
| BOOK-01 / P1 | Double-submit same intent; lose response after success; reload/back; then book another permitted date. | No duplicate same-day order/hold; legitimate separate order allowed; intent linkage correct. | BLOCKED ENV-01/02. Independent tester. |
| BOOK-02 / P1 | Two quote tabs; change address/partner/policy; accept stale quote; old card callback; successful replacement while newer intent exists. | Ownership/revision checks; no stale price/address accepted unnoticed. Close only obsolete observed intent after confirmed success; failure preserves it. | BLOCKED ENV-01/02. Tester; reuse replacement-booking tests. |
| PAY-01 / P0 | Missing card, expired/declined hold or existing custody debt; try route/reminder/dispatch and return controls/direct APIs. | No cardless normal pickup/reminder; current debt/settlement gates; visible next action; no duplicate attempt. WAIVED exception is DEC-03. | BLOCKED ENV-01/02 + DEC-03 waiver variant. Neil/tester. |
| PAY-02 / P0 | Settlement succeeds externally, local save/response times out; retry; duplicate/late payment callback; edit weight/quote during payment. | Reconcile existing intent/ledger before retry; no duplicate charge/false paid; accepted pricing/settled weight audited; uncertainty visible. | BLOCKED ENV-01/02. Claude Code fault fixture; independent tester. |
| PAY-03 / P1 | Invalid/zero/negative/>50/extra-decimal weights; below/at/above 18lb, both tiers, legacy snapshots and later supplier rates. | Invalid values refused; correct frozen snapshot/minimum/category bill; wholesale and customer-base distinct; historical quote not repriced. | BLOCKED integrated ENV-01/02. Existing pure assertions passed LOCAL run. |
| ISS-01 / P1 | At each stage open/resolve generic complaint or AI handoff; separately toggle AI. | Useful role-specific issue/next action; closure does not clear debt, weight, dispatch REVIEW or switch AI on. En-route issue policy remains DEC-01. | BLOCKED ENV-01/04 + affected DEC-01 variants. Neil/tester. |
| ISS-02 / P1 FIRST | Paid washed synthetic order; mismatched return HELD. Staff retries/forges Ready. Admin resolves: first fail readiness; then succeed release/Ready but fail or lose return dispatch outcome. Recover from issue/Ready UI. | Failed release/readiness leaves issue open/no trip. Success order: release -> Ready -> close -> guarded request. Dispatch failure remains visible after closure; safe recovery reuses/creates exactly one verified trip; REVIEW never blind retries. Staff UI updates. | BLOCKED ENV-01..03. Resolver mocks passed; actual UI/SQL/provider chain NOT RUN. Independent tester. |
| ISS-03 / P1 | Shared issue has two order-weight lines plus payment/generic reason; second readiness fails. Resolve partially/again. | All owned linked orders identified; no cross-customer release. Partial work visible/recoverable; one hold cannot clear others. Mixed-reason closure policy is DEC-02. | BLOCKED ENV-01/02 + DEC-02. Neil/tester. |
| ISS-04 / P1 | Two admins resolve stale tabs; new/reopened issue arrives during release; plan/partner changes concurrently. | Old form/evidence cannot clear a new/different hold or stale assignment; current blockers rechecked; one intended readiness/dispatch effect. Record checkpoint/versions. | BLOCKED ENV-01..03. Claude Code concurrency fixture; tester. |
| ISS-05 / P1 | Payment issue; partial payment; close without paying; then settle/update card; new hold during Ready/request. | Actual balance blocks regardless of issue closure; resumption uses current eligibility; notification/retry does not rerun settlement. | BLOCKED ENV-01/02/04. Tester. |
| DSP-01 / P1 | Ready/request twice in two processes; active other courier; provider create succeeds but reply/save lost; restart lease. | Durable claim prevents duplicate job; uncertainty -> REVIEW; exact reference readback reconciles existing job before any new write. | BLOCKED ENV-01/03. Fault fixture + tester. |
| DSP-02 / P1 | Zero/two active on-shift drivers; known driver off shift/unavailable; reassign then old observation. | No arbitrary driver choice; current verified assignment shown/enforced; old driver's proof rejected. Exact Linjury label independently checked. | BLOCKED ENV-03. Neil authorizes lookup; tester. |
| DSP-03 / P1 | Wrong order/leg/ID/reference/endpoints, duplicate remote matches; reassign between GET/POST; evidence older than 30s/future. | Fail closed, no custody/completion/message mutation or customer/provider detail leak. Fresh exact match required. | BLOCKED ENV-01/03 integrated. Gate/recovery mocks passed locally. |
| DSP-04 / P1 | 429/outage/missing/canceled/failed/incomplete provider state against saved ASSIGNED; refresh/poll/recovery. | No false current assignment/ETA/action; API error is not absence; clear attention and bounded cooldown, no repeated mutations. | BLOCKED ENV-01/03. Tester; RISK-01/02. |
| DSP-05 / P1 | Pre-start time/address/partner edit; provider edit succeeds then local reply lost; edit STARTED/third-party; stale second form. | Same job updated/read back; no new job/assign/cancel from edit. Started/uncertain -> review; quote/payment separately guarded. Add order-only address variant RISK-03. | BLOCKED ENV-01..03. Tester. |
| DSP-06 / P1 | Hosted development NODE_ENV=production with development DB. Exercise manual pickup, return request/handoff, observation/recovery. | Actual capability documented; local/hosted parity not inferred. Current real return requester disabled in this mode; resolve host scope before pilot. | BLOCKED ENV-01/03. Neil chooses host; Claude Code proposes scoped fix if needed. |
| CAN-01 / P1 | Cancel REQUESTED linked unstarted in-house job; repeat; removal succeeds but readback/save fails; restart reconciler; old collected observation. | Local cancel distinct from remote verification; exact removal/absence, retained IDs/history, recovery/cooldown; no replacement/reminder/revival; existing release choices preserved. | BLOCKED ENV-01..04. Tester; cancellation mocks passed. |
| CAN-02 / P1 | Cancel races custody; try AT_PARTNER/READY/OUT_FOR_DELIVERY; remote STARTED/third-party while local REQUESTED. | Post-custody generic cancel refused; started/third-party requires explicit review, not silent all-canceled. Physical recovery/refund policy is DEC-01. | BLOCKED ENV-01..03 + DEC-01. Neil/tester. |
| MSG-01 / P1 | Poll ranks 2,1,2,3,3; concurrent workers; first sight terminal; old assignment; both legs. | No backward/historical update; one eligible milestone per leg/key; pickup ETA not shop ETA; observation does not silently advance order lifecycle. | BLOCKED ENV-01/03/04 integrated. Existing worker mocks passed. |
| MSG-02 / P0 | STOP before queued send and between claim/send; AI pause vs status updates; signed/unsigned/duplicate SMS callbacks; START/HELP/CANCEL. | No customer SMS/MMS after STOP; existing compliance rules; CANCEL not opt-out; no forged identity/callback; AI pause and transactional updates tested separately. | BLOCKED ENV-01/04. No real SMS allowed. |
| MSG-03 / P1 | Carrier accepts then timeout; crash SENDING; late/missing 24h proof; manual completion before queue drains. | Uncertain -> REVIEW, not duplicate send; durable claims; exact customer-return private metadata-free proof; manual suppression includes pending work. No business transition/charge/trip rerun for message retry. | BLOCKED ENV-01/03/04. Tester. |
| SEC-01 / P0 | At every stage, wrong customer/shop/order/photo/driver scope; signed-out, revoked staff, inactive partner; bad CSRF/origin/signature. | UI/data scoped; active role/ownership rechecked server/RPC; zero unauthorized money/job/message/business-state changes. Admin subject to guards too. | BLOCKED ENV-01 integrated. Actual sessions/SQL required, not only mocks. |
| UI-01 / P1 | Phone offline mid-submit; reload/back stale form; concurrent roles; board refresh fails with enabled pickup; English/Spanish hold/resume. | Lost response not shown as success; durable checkpoint/retry; stale proof disables action; issue/next step readable; no duplicate effects. | BLOCKED ENV-01. Tester + Neil clicks. |
| REC-01 / P1 | Provider delivered/local OUT_FOR_DELIVERY; repeat sync; wrong proof; manual without reason/attestation/payment; late worker. Also remote delivered while shop confirmation missing. | Exact eligible recovery only, atomic/replay harmless; unauthorized denied; no charge/provider change/customer text from manual. Missing handoff has defined recovery/owner, not unsupported status skip. | BLOCKED ENV-01..04. Tester; recovery mocks passed. |
| FIN-01 / P1 | Delivered/canceled synthetic orders: accepted quote, measured bill, ledger, supplier cost, both jobs/costs, messages/audit; restart workers. | No stranded hold, unpaid completed order, duplicate charge/trip, custody gap or hidden REVIEW. Actual vs estimated costs explicit; payout workflow not inferred (DEC-05). | BLOCKED ENV-01..04 + DEC-05. Tester + Neil reconcile. |

For every case above current metadata is **run none; tested commit/environment none; evidence none; retest not started**, unless explicitly described as existing local assertion coverage. Priority indicates potential consequence, not confirmed defect severity. Integrated/pilot/production variants receive separate run IDs and cannot inherit a mock PASS.

## Issue lifecycle and decision-needed behavior

| Kind | Scope / resolver / resume checkpoint |
|---|---|
| Generic complaint/AI handoff | Informational or AI hold; holding issue pauses AI. Generic closure is not the AI toggle. Admin issue resolution, human message and AI toggle are distinct. No universal job freeze found; DEC-01 defines exceptional operations policy. |
| Payment debt | Outstanding failed in-custody balance blocks by customer, independently of issue status. Closing issue does not pay it. Recheck ledger/card/hold and eligible pickup/return after settlement. |
| Weight mismatch | Shop cannot release. Admin resolves every identified owned order: release held check -> save Ready -> close issue -> guarded return attempt. Resolved issues offer recovery. Release/Ready refusal prevents closure; dispatch failure after closure remains actionable. |
| Dispatch ambiguity | Plan REVIEW is independent of customer issue. Reconcile exact identity/endpoints/driver/current provider outcome before retry. Resolved issue is not permission for second driver. |
| Cancellation pending | CANCELED order supplies durable reconciliation work. Version/lease/cooldown and verified absence/removal protect it; active/third-party/conflicts remain review. Old observations cannot recreate or advance it. |

| ID | Decision needed, not an assumed bug | Owner |
|---|---|---|
| DEC-01 | What should generic issues during en-route/custody block? Who owns physical recovery and when may it resume? Exceptional post-custody cancel/refund/return is not defined by this task. | Neil records ruling in current Issue/HANDOFF and DECISIONS for business rules. |
| DEC-02 | May weight resolution close a shared customer issue when unrelated payment/complaint reasons remain? How should partial release and new/reopened reasons display and resume? | Neil. |
| DEC-03 | AGENTS says no card means no pickup; billing/dispatch contains WAIVED exemptions. Confirm approved waiver exception's launch scope before cardless-waiver tests. Never weaken the normal no-card route/reminder gate. | Neil. |
| DEC-04 | Prior 30-minute pickup target proposal: anchored to creation or scheduled pickup? Vault leaves this open. Return requester currently anchors target to request time. Keep schedule, target and ETA distinct. | Neil. |
| DEC-05 | What financial supplier/courier closeout/payout is required? What should READY with unsuccessful settlement show and who acts? Return remains payment-gated; define visibility/ownership, not a new billing rule. | Neil. |

## Current findings and defect handling

| ID | Evidence / consequence | Status / severity / next owner |
|---|---|---|
| RISK-01 | partner-return-runtime enables real return request/collection only with development Node mode + development DB. Booking runtime allows manual pickup by DB identity, including hosted production Node mode. Portal visibility is not proof of hosted return capability. | Code observation; integration NOT RUN. P1 pilot blocker if hosted chosen. Neil chooses host/capability; Claude Code proposes scoped spec. |
| RISK-02 | Startup has booking/detail-sync/cancellation/SMS/photo workers; no routine general real-return DELIVERED reconciler identified. Admin recovery is manual and requires local OUT_FOR_DELIVERY. Remote messages and local lifecycle can diverge. | Code observation + historical vault audit, not live reproduction. P1 readiness gap. REC-01 + missing shop confirmation; named recovery owner before launch. |
| RISK-03 | Return requester uses current customer address; pickup and notification observer use order-specific preferences.pickup_address through order-address.customerFor. Order-only address edit can yield inconsistent return/observer endpoints. | Code observation, reproduction NOT RUN; potential P1. Claude Code reviews intended address contract; tester adds GP/DSP/MSG variant. |
| RISK-04 | Local suite passed while isolation guard blocked two non-loopback attempts. Destination/caller not captured; handled failures may mask network use. No external connection allowed. | Confirmed isolation evidence, not confirmed app defect. Investigate before unguarded tests; Claude Code traces dependencies/guard stack in next approved run. |
| HISTORY-01 | Earlier two partner-profile wording failures were reported in handoff/vault. Fresh suite has 1708/1708, zero failures. | Fresh local PASS only; no asserted fix or independent review. |

Statuses: **NOT RUN / PASS / FAIL / BLOCKED**. A code observation is not a reproduced defect. Severity: P0 privacy/security, unintended real money/SMS/dispatch or lost custody; P1 broken required flow, wrong bill, duplicate job/charge, unsafe retry or missing recovery; P2 recoverable clarity/error; P3 cosmetics. No unresolved P0/P1 at next gate. Neil alone may explicitly defer acceptable lower-severity defects with owner/workaround.

Failure record: defect/test/Issue IDs, severity, minimal synthetic reproduction, initial versions/issue set, ordered events, expected/actual UI/server/effects, evidence, last checkpoint, owner/next step. Claude Code implements only an assigned fix on a branch, with practical regression test. Grok reviews independently. New build requires new failed-sequence plus adjacent role/stale/retry retests; retain old FAIL. Unit regression alone does not prove integration recovery.

## Run ledger and evidence contract

| Run / test | Date/build/environment | Result and scope | Evidence / retest / owner |
|---|---|---|---|
| LOCAL-20261002-01 / AUTO-01 | 2026-10-02 15:14:16Z–15:14:28Z; codex/order-detail-actions, HEAD 8517473 + dirty starting hashes; Node 24.20.0/npm 11.19.0; local Windows. Config development DB/fake SMS/test payments; Shipday key present. | **PASS recorded run** npm test exit 0; tests/pass 1708, fail/skipped/cancelled/todo 0; 11774.451ms; 170 files then. Pure/source/VM/mocked assertions and some loopback HTTP routes. Latest tree **NOT RUN** after concurrent edits. No app startup or provider integration. | [output](docs/testing/2026-10-02-local-baseline.txt), [metadata](docs/testing/2026-10-02-local-baseline.json), [starting hashes](docs/testing/2026-10-02-checkout-hashes.json), [isolation](docs/testing/2026-10-02-baseline.md). Fresh baseline needed on stabilized candidate. ChatGPT execution, not Grok review/Neil acceptance. |
| LOCAL-20261002-01 / AUTO-02 | Same run; inherited Node preload refuses non-loopback fetch/socket/DNS. | **PASS isolation**; two attempts blocked. Provider behavior **BLOCKED**, untested. | [blocked attempts](docs/testing/2026-10-02-network-blocks.txt); caller attribution pending RISK-04. No real money/message/dispatch/customer write. |
| INTEGRATION-01 reserved | No tested build/environment. | **BLOCKED** ENV-01..04. GP/ST/interaction cases unexecuted. | Evidence none; retest not started. Independent tester after approved scope/harness. |
| PILOT-01 reserved | One approved shop/driver/build/config. None executed. | **BLOCKED** integration and ENV-05. | Evidence none; retest not started. Neil/partner/driver only within approved scope. |
| RELEASE-01 reserved | Exact proposed main/deploy/migration/config unverified. | **BLOCKED / NO-GO** remaining gates. | Evidence none; retest not started. Grok review + Neil acceptance; Neil merges/releases. |

Append per-case results here or in dated evidence attachments linked here: ID/variant, run/date, exact commit plus dirty hash/build, environment, actor, synthetic order/leg IDs, initial order/plan/issue/payment versions, preconditions, sequence, UI + HTTP result, final order/intake/issues, ledger/job/SMS/MMS counts and deltas, audit, status, defect/severity, retest run/result, owner/next action. Screenshots prove display; mocks only simulated contract; provider readback only its reported state. Never mix these evidence classes.

## Existing coverage to reuse

All assertions in these files participated in AUTO-01. This map is not integrated-case completion.

| Area | Existing test files (under test/, .test.js) | Remaining evidence |
|---|---|---|
| Booking/card/safety | booking-intent, replacement-booking, dev-online-booking, address-first, card-at-signup, payment-hold, reminder-collectable, which-database, sms-driver-choice | Real session/SQL constraints, duplicate submit/callbacks, accepted snapshot, no downstream pickup without card. |
| Price/payment | weight-based-pricing, customer-base-weight-pricing, eighteen-pound-minimum, weigh-in-charge, retry-the-hold, payments-off, cash-recovery | Current migration/app parity, complete ledger, successful external settlement + uncertain local save. |
| Shop/roles/issues | partner-intake, partner-delivery-gate, laundromat-return-checks, wash-completion, weight-issue-resolution, partner-portal-admin, admin-scope, shop-persistent-session, refresh-board | Actual freshness/locks/revocation, mixed issues/races and UI -> SQL -> dispatch/resumption. |
| Dispatch/recovery | shipday-booking-dispatch, shipday-booking-runtime, partner-return, shipday-order-sync, shipday-cancellation, order-recovery, order-return-dispatch, hosted-dev-pos | Exact driver, physical handoff, actual provider failure/readback, hosted return parity, terminal reconciliation. |
| Updates/completion | delivery-sms, delivery-sms-notify, delivery-photo, shipday-proof, handoff-silence, silent-handoff, consent, telnyx-retry | Real outbox/role UI chain; queued suppression after STOP/manual completion; separately approved carrier receipts. |

## Pilot and production gates

| Gate / case | Evidence required before advancing | Current status / owner |
|---|---|---|
| Independent isolated integration | Baseline; GP-01; ST/role UI + server guards; P0/P1 interactions; failure/resume at each checkpoint; decisions answered; no material privacy/custody/money/duplicate/recovery defect. | BLOCKED. Claude Code prepares separately assigned harness/fixes; independent tester executes; Grok reviews. |
| PIL-01 one bag/one shop | Approved driver/partner; tested stable build; reference/photo/full weights; staff physically intake/wash/ready/handoff; customer return/proof; no stranded job/hold/task; intended phones/sessions. | BLOCKED ENV-05/prior gate. Neil physical acceptance. |
| PIL-02 controlled issue drill | Agreed safe weight-hold or provider-unavailable drill. Staff retains bags, knows contact/admin action and recognizes verified resume. Do not induce a dangerous physical race or real financial failure. | BLOCKED. Neil approves drill/stop condition. |
| PIL-03 end-of-day reconcile | Each order matches custody, two jobs, bill/settlement/cost, messages/issues/audit. Named owner for uncertainty; cleanup only created fixtures/jobs; partner understands required next actions. | BLOCKED pilot execution. Neil/tester. |
| PRO-01 release candidate | Issue matches diff; Grok findings resolved/explicitly deferred; regressions on exact candidate; Neil click-tests; migration/config/provider parity, including DEV-only gates and real courier activation. | BLOCKED. Neil merges; no main/deploy changes authorized here. |
| PRO-02 limited production acceptance | Separate exact approval for production customer/order/payment/SMS/driver scope, monitoring, stop/rollback owner; limited first window; no historical/all-customer backfill. | BLOCKED; no production actions authorized. Neil. |
| PRO-03 go/no-go | GP/roles/issues/retries and physical pilot PASS on release-equivalent build; no P0/P1; decisions closed; limits/cooldowns/escalation/reconciliation/manual recovery usable; costs/closeout confirmed. | NO-GO until gates pass. Neil records date/build/decision/deferrals. |

Stop pilot on wrong bag/identity/driver/destination, missing custody, uncertain payment/dispatch, inaccessible required action or privacy exposure. Retain bags safely, capture evidence, name one recovery owner and suspend affected new work. Never retry uncertain money/provider mutation blindly. Resume from verified checkpoint with pilot owner's decision.

## Deferred backlog

P3: hero/toolbar spacing, button styling, icon/animation polish and broad copy restyling. Promote only a concrete functional problem: unreachable phone action, false status/success, unreadable issue/next step, inaccessible validation, wrong identity/price/time, misleading shop Completed label, or enabled control that cannot perform intended server action. Keep unrelated polish out of launch-critical Issues.

**Next action:** confirm ENV-01..04 and exact test driver; execute ISS-02 in an isolated fixture, then GP-01. Physical pilot and production remain later gates.


## Continued QA and pricing message defect — 2026-10-02

Address repair commit 2cb7d081c3014509bc932ec8c1416e111cc2e3fb pushed to origin/dev and origin/codex/order-detail-actions. Remote main remained eeb9cd99f3953f5dbe8b9aba10816dc452091c50. Only seven scoped files were committed; concurrent development changes remain uncommitted. Fresh full suite on the local development working tree with network isolation: 1738 passed, zero failed. This is not a claim that all dirty changes were pushed, independently reviewed or deployed.

Observed customer conversation contains the out-for-delivery milestone and a later ETA change. Actual outbox states are SIMULATED, although both conversation entries render Sent. No duplicate out-for-delivery milestone was present. Current and previous observations covered two messages, not an exhaustive concurrency test.

FAIL: New test order 9022 has no dev quote or saved pricing snapshot and carries legacy 200 cents per lb and 4500 cents minimum. Its card-saved confirmation therefore printed the old prices. Order 9024 also lacks a snapshot. Order 9025 has the current accepted snapshot and a read-only confirmation preview correctly printed Estimated total $59.16 for 30 lb, delivery and processing included and $43.59 minimum, without the old pricing fallback. The issue is a new-development booking path reaching legacy confirmation without the accepted quote, not a universal hardcoded SMS price. Preserve historical messages and previously accepted prices.

FAIL: The current-snapshot confirmation preview still includes an unconditional Back with you the next day sentence. The visible legacy confirmation also describes charging at the customer door; current QA payment was settled after shop intake. Payment wording must be tested against the applicable order model without changing charge timing.

FAIL: The local return plan still says REVIEW after fresh remote verification and successful shop handoff. Its linked trip remains unchanged. Pickup details-sync warning still incorrectly says automatic courier although this test used LYNDRY. Return details sync separately reports missing verified map coordinates. These are distinct from the repaired exact-address collection check.

OPEN: POS says Billable weight Not finalized although the order has a 30 lb measured weight and paid total. Investigate which weight field is authoritative before prescribing a fix.

PASS: Browser Sync with Shipday before verified delivery displayed refusal and No status changed; order stayed OUT_FOR_DELIVERY. Initial request was interrupted by a local server restart; the retry above produced the observed result. No final delivery was fabricated. Completed shop order detail now says Order unavailable, so there is no repeated pickup button; shop history retains the handoff. This is UI guard evidence, not a direct stale POST regression test.

Pending: Neil driver app test proof photo and delivery completion for the existing QA return, followed by customer picture rendering, final POS sync, replay and duplicate checks. Staff-role browser acceptance, full new-customer booking, offline-driver recovery and passing-weight variants remain unverified. Pricing, payment wording, turnaround and simulation badge defects are recorded, not fixed by the address commit.


## 20261002 Shipday pricing verification

Implemented locally on codex/order-detail-actions in the shared development checkout. New development public quotes, booking plan prices, alternatives and POS repricing use fresh Shipday address quotes and the lowest valid supported offer in each direction. Booking rechecks current API fees and address, rejects unused in house snapshots and requires review when fees change. Pricing source is separate from driver assignment so no automatic third party request is introduced. Existing accepted order 9027 was not repriced or charged.

Validation: npm test passed 1776 tests with zero failures. Regression coverage includes asymmetric trip prices, missing and failed quotes, unsupported and invalid offers, cheapest eligible arrival, changed address, booking fee changes and driver assignment isolation. The live address API returned 674 cents each way for the original order address and shop; the updated 30 lb estimate was 5718 cents versus the saved 6396 cents. Public quote HTTP check returned 200 with pricing and booking action. Shipday dashboard screenshot showed 649 cents earlier; the existing job estimate endpoint returned HTTP 400, so exact dashboard/API parity remains unresolved. No driver request or customer charge was made for verification. Main unchanged. No commit or push. Independent Grok review and Neil click testing remain pending.
