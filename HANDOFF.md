# HANDOFF

Issue: Rebuild `/ops/orders/:id` as an internal data console (no Issue number yet)
Owner of the keyboard: Neil
Status: review

## Goal

The ops order page used the public site's visual language — big rounded cream
cards, display headings, a stack of state cards — and showed the same chrome
whatever state the order was in, so a delivered and paid order still offered
"Correct a weight" as its hero, a cancelling lecture, and "still needed from
them". Rebuild that one page as a warehouse terminal: one header, one exception
line, then tables. Presentation and information architecture only. No change to
customer-facing text, pricing, weighing rules, or the append-only history store.

## Must happen

- One header, one exception strip, then tables. Hairline borders, gray header
  rows, tabular numbers, mono only for codes and timestamps.
- Toolbar is state-aware. The step offered comes from `run.js`, so the order page
  and the driver's run cannot drift.
- Exception strip is one block carrying our weight, the partner's weight against
  tolerance, the return against billed, whether a charge was held, and how it was
  settled. Absent when there is no exception.
- Bags are one table: door bag, lb, return bag, lb, lineage, status. Footer
  carries counts, billed, returned, and whether they match.
- Charge is a ledger of rows that actually happened. The partner's figure has no
  dollar amount.
- Log defaults to Human. Filters are `?log=` links, not radio buttons.
- Texts are only this order's, with a count and a link for the rest.
- Every button posts to a route that already existed.

## Must not happen

- No JavaScript on this page. A driver reads it on two bars of signal.
- A driver must still see the stop and not the customer: no name in the heading,
  no phone, no card, no money, no change log, no thread.
- No rewriting or deleting rows in `order_events`. Filter and group only.
- No cancel copy on a delivered order. No booking SMS on an order that has run.
- No new mutation routes, no change to what any existing button does.

## Edge cases

- A message has no order id, so "texts for this order" is a window: booking to
  ten minutes after delivery. A text about this order sent an hour later falls
  to the next one.
- There is no `out_for_delivery_at` column. The stage rail reads each stage off
  the order column when it has one and off the STATUS event otherwise.
- `orders` has two foreign keys to `partners`, so the embed must name
  `orders_partner_id_fkey` or PostgREST refuses it as ambiguous.
- A PRICE event with no WEIGHT beside it is the old weigh-in rule pricing off the
  laundromat's scale; its pounds and promotion are in the sentence and nowhere
  else.
- "Correct a weight" is offered only while the laundry is in our hands.
  Correcting a weight on a charged order re-prices money that has already moved.

## Files Claude expects to touch

- `src/routes/admin.js` — the `/ops/orders/:id` route only. Builds `can` from the
  four existing permission calls, widens the messages query to the booking
  onward, adds `ready_at, delivered_at, promotion_id, discount_cents` and the two
  named embeds to the select, calls the console. Old template kept as
  `_legacyBody`, parsed and unused, so reverting is one rename.
- `public/css/ops.css` — new. Fingerprinted under `/css/<hash>/` like every other
  file in that directory.
- `src/web/order-console.js` — new. `humanEvents`, `chargeRows`, `bagRows`,
  `messagesForOrder`, `exceptionFor`, `actionsFor`, `stageRail`.
- `test/order-console.test.js` — new. 20 tests pinned against order #1992.

## Grok review

(empty until Grok has seen a diff)

## Neil

Not yet. Uncommitted on the working tree, nothing pushed. Seen on the dev server
at localhost:3000 and verified against #1992, #2060 and #2063. Still open:

- Five cards still render in the old cream style in the side column (held weight,
  declined card, corrections, cancel, return check) plus the nudge panel. Passed
  through unchanged under anchor ids so every mutation posts where it always did.
- No standalone "send a template" route, so "Text: make it regular" scrolls to a
  Send box rather than posting.
- Nothing else in `/ops` has the terminal look yet.
