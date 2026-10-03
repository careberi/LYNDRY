# Order flow defects: implementation design

Neil explicitly assigned automatic implementation and development push on 2026-10-02; further approval gates are waived. The dated QA report is the reproduction evidence.

## Customer messages and booking
New development orders and resumable booking intents must contain an accepted dynamic quote; reject missing quotes before an order, hold or assignment is created. Keep production and historical saved prices unchanged. Quoted confirmations use their saved model, explain settlement after measured shop intake and any actual authorization hold, and condition next day turnaround on availability. Preserve distinct web/text/phone introductions. Pickup movement asks customers to have their bag ready only for card eligible observed trips. Collection states conditional turnaround and promises a later delivery update. Persist simulated send status and display it without claiming carrier delivery; historical fake provider IDs must also display simulation.

## Intake and completion
An exact nonfailed collected pickup may remain visible for intake even when Shipday clears its assigned carrier. Receipt still requires fresh provider evidence and current shop and never happens from the list. Return completion uses a dedicated development only service role transaction after strict same trip/driver/endpoints, fresh delivery proof and settled payment. Preserve manual suppression, opt out behavior and separate message claims. Complete only OUT_FOR_DELIVERY; never invent shop handoff. Reconcile terminal REVIEW to COMPLETED only for the same verified return, including already delivered replay; no provider writes, reassignments, charges or duplicate events. Detail edit sync should show terminal trips as closed without implying a failed lifecycle sync, and distinguish in house from third party. Dynamic measured billing must persist its billable weight; legacy display and values stay unchanged.

## Constraints
Development only; main untouched. No Uber or DoorDash requests; approved in house driver only. Fake SMS and test payments. Preserve uncertain dispatch, uniqueness, 50 lb bounds and weight holds. Do not import unrelated dirty work. Regression tests must fail before fixes and pass afterward. Broader physical pilot and independent Grok review cannot be claimed by the implementer.
