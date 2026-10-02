# Order flow fix retest, 2026-10-02

Status: implemented, tested and prepared for development publication. Main remains unchanged. Independent Grok review and pilot acceptance are not claimed.

## Addressed

| Failure | Cause and correction | Evidence |
| --- | --- | --- |
| Old pricing in newly created development booking text | Order and booking intent boundaries allowed missing accepted quotes. Require quotes before creating orders or holds; build new confirmations from frozen snapshots and actual authorization. Preserve historical messages and legacy saved prices. | RED then GREEN message regressions; browser confirmation preview with inclusive estimate, minimum, measured billing and actual hold. |
| Turnaround and payment timing misleading | Confirmation promised next day and door charging. New quoted copy describes settlement after laundromat weighing and next day only when available. Pickup movement adds bag readiness only for eligible card orders; collected update describes conditional turnaround. | Frozen quote, source wording, card gate and observer tests. |
| Collected pickup missing from intake | Board filtered on active assignment even when exact provider evidence verified completed pickup after carrier clearing. Retain verified collected row; intake remains an explicit fresh verified action. | Regression; browser carrierless completed pickup remains visible with enabled Intake. |
| Completion dependent on notifications and original return stuck in REVIEW | Operational completion had no independent reconciler. Added development only read only Shipday observer and atomic completion requiring original in house identity, exact endpoints, fresh proof, paid or waived order and released handoff. | SQL refusal, completion and replay checks; browser simulated completion; actual original #9025 return repaired to COMPLETED. |
| Closed order shown as retryable sync issue | Presentation treated terminal delivery like failed editable synchronization. Closed orders now clearly state details are no longer editable. | Browser actual #9025 and terminal regression. |
| Missing billable weight | Atomic measured billing did not persist billable weight. Persist it for new settlement and derive the trusted measured value for settled quoted historical orders. | SQL preserves actual price and persists weight; actual POS displays 30 lb. |
| Fake messages labeled Sent | Provider ID omitted by queries, list hardcoded Sent, and older fictional sends had no provider ID. Include IDs and share a receipt renderer with grounded simulation evidence. | Actual conversation list and all six history messages show Simulated. |
| Manual recovery could diverge in a clean checkout | Existing active suppression migration was absent from the published base. Include exact existing 0140 dependency and approved silent optional photo manual behavior. | Exact active checksum, manual SQL rollback test and recovery regressions. |

## Review and verification

One fresh context code reviewer found four material gaps: historical simulation selections, third party involvement on a saved in house assignment, legacy proof paths and manual suppression migration dependency. Six added failing cases were observed before fixes. All findings were addressed in one corrective pass. This is agent review, not Grok Reviewed status.

Fresh isolated npm test: 1,718 pass, zero fail, zero skipped. External test networking was blocked. This count differs from the earlier 1,738 integrated run because unrelated dirty checkout work was intentionally excluded. Two baseline stale portal assertions were updated to already existing UI wording. No portal wording implementation change was made for those tests.

Development SQL validation used rolled back transactions: measured billing preserved the frozen total; wrong remote, driver, version, stale evidence, missing proof, changed endpoints, unpaid state, missing handoff and held weight refused. Valid delivery completed the original plan; replay produced one event. Manual completion without photo preserved existing proof and suppressed future messages. Migration 0142 was subsequently applied only to the guarded development project; active 0140 matched its existing migration checksum. Schema cache refreshed.

Actual #9025 reconciliation used fresh read only original Shipday proof. Already DELIVERED and PAID stayed unchanged; original return became COMPLETED. Order, price, payment state, proof path, message count, event count and original remote ID remained unchanged. A second reconciliation changed nothing. No provider mutation, courier request, charge or text was issued by this retest.

Playwright retest used the actual candidate POS on port 3003 against development, with workers paused and Shipday writes disabled. Confirmed actual settled billable weight, Closed sync text, disabled terminal edits, actual conversation simulation labels and original trip IDs. Historic old price text is retained as historical evidence; it is not retroactively rewritten.

For repeatable new lifecycle cases, a memory only harness on port 3004 used actual shop routes, templates, intake service, provider verification and completion service with fake storage and provider. Tested completed pickup with cleared carrier, explicit 30 lb intake, wash completion, 33 lb outtake hold, release, original in house return, verified picked up handoff, shop completed history, delivered proof and replay. Browser ended DELIVERED PAID with one completion event and one proof save. Harness initially omitted settings identity and return endpoint names; corrected fixture data and repeated all cases. Those fixture mistakes were not product defects. Admin release storage and atomic SQL have separate regression coverage; the harness control itself is simulation, not a real dispatch.

## Remaining limits

No new physical driver handover or real customer SMS/MMS was tested. First time hosted public checkout, physical phones, broader staff roles, adverse provider timing, actual multiworker concurrency and production delivery pilot remain unverified. STOP and notification independence have automated coverage; real carrier receipt, photo delivery and customer opt out need the controlled pilot. Existing simulated order #9025 completed through the driver's real app earlier; this retest did not request another trip. Independent Grok review and Neil acceptance are separate release gates.

Do not classify development publication as a main release. Original dirty development checkout remains preserved; the candidate worktree is retained for inspection with background workers paused.

## Commits

85f9cc9: quoted booking messages, quote guards and simulation recording.
f114823: historical simulation list and thread labels.
23b95be: intake visibility, independent verified completion, atomic migration, billable weight, terminal presentation and manual dependency.

## Execution rulings

User assigned inline implementation and explicitly waived approval pauses; publish only development, never main. Use isolated native worktree to preserve unrelated dirty work. Use Windows equivalents for shell only skill scripts. Update two stale assertions to already existing UI. Operational evidence is independent of messaging suppression and rank; manual silent completion is preserved. Carry only the exact related manual migration dependency. Use memory fixtures instead of real new dispatch for repeatable browser lifecycle retest. Apply only targeted tested development migration, not the general pending migration set. Refresh the schema cache after migration. Preserve historical accepted prices and message bodies.