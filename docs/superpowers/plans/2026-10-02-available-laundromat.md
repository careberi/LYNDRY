# Development booking and pricing corrections

Scope follows Neil's successive explicit corrections. Implement in the existing dev worktree, preserve unrelated changes, do not ask again for approval, do not commit or publish.

1. Trace the original shop eligibility error. Separate shop hours from delivery provider failures. Replace development checkout third-party availability with configured LYNDRY delivery estimates under Neil's courier instruction.
2. Public price check compares cheapest overall estimates. Carry its full address and apartment to editable booking defaults. One Book a pickup action; no premature plan choice.
3. Booking order: address, missing wash instructions, date/time, eligible shop pricing methods, quote review, existing card flow. Preserve the chosen first subscription date and recurrence anchor. Default time to Eastern now; compare minute boundaries at preview and confirmation; remove the rejected Immediately selector.
4. Preserve hyphenated house numbers in autocomplete and validation. Clear obsolete coordinates on unverified address changes.
5. Use the public pricing card component at the same width and with the same rates, minima, totals and typography. Weekly and fortnightly choices only for new development bookings. Keep both method cards together on desktop and readable on mobile.
6. Search up to fourteen dates for an eligible cheaper alternative. Show both estimated per-pound methods, never increase either method, do not switch automatically, and recheck the chosen date/shop.
7. Make all account Update actions available without any existing pickup. Arrange POS Details and Wash Preferences tables side by side with Recurring Pickups underneath.
8. Match downstream in-house quote source gates, preserve manual driver choice and all payment/identity guards, apply only development migration 0142, and read back the function.
9. Run relevant regressions and npm test with external network prohibited. Inspect actual desktop/mobile/account/POS render. Fresh independent review; document results and limitations in repository and vault.

Implementation steps complete. Final verification and acceptance are recorded in HANDOFF.md and the progress ledger. No real order or card was submitted in browser verification. External Google validation and real driver dispatch were not exercised.


### 2026-10-02 latest booking corrections

Subscription frequency is inside the subscription card immediately above Choose subscription. Both pricing method buttons submit their own method and proceed to review. Choosing a cheaper alternative displays the new pickup date and time in a banner on the next page. Wholesale customers retain their applicable rates under both method headings.

Scheduled development checkout accepts a pickup up to ten elapsed calendar minutes earlier than the current minute, so completing checkout does not lose a recently selected time. Eleven elapsed minutes is rejected. Future times remain eligible subject to laundromat hours, capacity and next day return. Arrival checks shift forward by elapsed checkout time while retaining travel and loading allowance. Saved quote expiry and approval remain required.

Verification: npm test passed all 1770 tests with external network blocked. Browser verification confirmed the banner, equal width side by side cards and frequency placement. Changes remain local and uncommitted; main is unchanged. Neil's complete card and order flow, real phone check and Grok review remain outstanding.
