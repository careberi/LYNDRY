# HANDOFF

Issue: Reminders must use `dispatch.collectable()`
Owner of the keyboard: Neil
Status: review

## Goal

`src/core/reminders.js` never looks at whether an order can actually be
collected. It selects the order, the customer's name, phone, status and
preferences, and nothing else. So a pickup with no card on file — which
`dispatch.collectable()` already keeps off the driver's route — still gets the
night-before "have the bag out" text, and still shows **PICKUP REMINDER
SCHEDULED** in the thread. The reminder must ask the same question the route
asks, by calling the same function, so the two cannot drift.

Order #2063 is the live example: badged AWAITING CARD, off the route since
13 September, and still carrying a scheduled reminder on the customer page.

## Must happen

- The reminder sweep skips an order `dispatch.collectable()` says no to.
- The thread badge and the scheduled list skip it too. **Three functions in
  `reminders.js` decide this, not one**, and all three need the gate:
  - `sendDue()` — the nightly sweep, what actually texts
  - `pendingFor(customerId)` — the "PICKUP REMINDER SCHEDULED" box in the thread
  - `allPending()` — the list on `/ops/scheduled`
- **The card fields have to be added to all three select lists.**
  `collectable()` reads `order.payment_status` and the customer's
  `stripe_customer_id` / `default_payment_method_id`. None of the three selects
  carry them today, and an unselected column is undefined, which is
  indistinguishable from an absent card — so without this the gate would skip
  *every* reminder rather than the ones that deserve it. That trap has now bitten
  five times in this codebase; see `BOARD_FIELDS`, `RUN_FIELDS`, the order page's
  `payment_attempts`, and its `ready_at` / `delivered_at`.
- One implementation. Call `dispatch.collectable()`; do not re-derive "has a
  card" here.
- A waived order is still reminded. `collectable()` already answers true for it.
- The screen and the sweep must agree, which is the existing rule for this file:
  both read the same rows and call the same function, so a badge can never
  promise a text that will not be sent.

## Must not happen

- No second copy of the card rule.
- Do not stamp `reminder_sent_at` on a skipped order. It has not been reminded,
  and stamping it would mean nothing ever reminds them if a card arrives in time.
- Do not change the reminder's wording, its timing, the evening-before rule, the
  three-hour just-booked skip, or quiet hours.
- Do not touch routing, payment, or `fulfilment.js`. The route gate already
  exists and is not being re-opened.
- Do not make the reminder a second gate on collection. It reads the rule; it
  does not own it.

## Edge cases

- **A card added after the reminder evening but before the pickup.** They are
  back on the route and correctly get no reminder, because the evening has
  passed. That is the right outcome and not a gap to close — but it means the
  first they hear is the driver arriving, so say whether that is acceptable.
- **Standing orders already carry the stamp.** `recurring.bookDue()` sets
  `reminder_sent_at` at the moment it books, so a non-collectable standing order
  is already skipped by accident. The gate must not double-count that.
- **Stripe switched off entirely** (`needsCardOnFile()` answers false): every
  order is collectable and everybody is reminded. Correct — a sandbox with no key
  must not silently empty the reminder pass, the same way it must not empty the
  round.
- **An order that becomes uncollectable after the reminder went.** The reminder
  was true when sent. The morning route is the authority; nothing here should
  chase it back.
- `pendingFor()` returns the soonest pickup only. If that one is not collectable
  it must not silently fall through to a later one and badge the wrong order.

## Files Claude touched

- `src/core/reminders.js` — requires `dispatch`, adds `collectable()` as a
  one-line pass-through, adds `CARD_FIELDS` / `CUSTOMER_CARD_FIELDS` as one
  shared string, widens all three selects and gates all three functions.
- `test/reminder-collectable.test.js` — new, 12 tests.
- `HANDOFF.md`

Nothing else. `dispatch.js` was read, not edited.

## Grok review

(empty until Grok has seen a diff)

## Neil

Implemented on `fix/reminder-collectable`. `npm test`: 247 pass, 0 fail.

Checked against live rows, read-only — `sendDue()` was deliberately not called
because it texts real people:

| Order | | After the change | Proves the change? |
|---|---|---|---|
| #2063 ashley | no card, off the route | no reminder, no badge | **No.** Her pickup is today, so the reminder evening (13 Sep) had already passed and `pendingFor()` would return null from the pre-existing date check with or without this branch |
| #2062 Trisha | waived | still scheduled, goes tonight | Yes, in the useful direction: waived must keep its reminder |
| #2061 Shamar | card on file | still scheduled | Yes, nothing collectable was lost |

**No live row can currently distinguish the two behaviours.** That would need an
order with no card AND a pickup at least two days out, and there is not one. The
proof is the unit tests, which call `collectable()` with no dates involved and
read the source to pin that all three queries carry the card fields.

**Grok review: deferred by Neil on 14 Sep.**

- Accepted on unit tests + the `pendingFor()` select fix.
- Ashley thread is not proof (reminder evening already passed).
- No live `sendDue()` against customers.

One thing deliberately left alone, per the brief: a customer who adds a card
after the reminder evening but before the pickup gets no reminder and is on the
route. No new text for that in this branch.

Branch state, so nothing is lost:

- `feat/ops-order-console` — the warehouse-terminal order page, committed off
  `main`, 255 tests passing, unreviewed and unpushed.
- `docs/ai-workflow` — AGENTS.md, HANDOFF.md, and the CLAUDE.md correction about
  the QR regex.
- `fix/reminder-collectable` — this branch, cut from `docs/ai-workflow` because
  HANDOFF.md only exists there. Merge the docs branch first or this one carries
  it along.
