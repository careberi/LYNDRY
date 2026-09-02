# Running list

What is being worked on right now, and what is finished. Kept here rather than
in a chat window so it survives between sessions.

Started 1 September 2026. Everything on it comes from Neil's revised bag tag
process plus the five items he added on top.

---

## Done

### 1. The labels page prints the new bag tag ✅

`/ops/labels` and `src/web/labels.js`. What comes out of the printer is a **bag
tag** now, not a sticker: one id, and four numbered peelable stickers under it
carrying that same id. Moved from Avery 5160 address labels to **Avery 5164**
shipping labels, six to a sheet, because five QR codes do not fit on something
the size of a business card. The stickers are printed with dashed lines between
them and cut apart with scissors - nothing off a shelf comes with four peelable
squares inside one label, and each cut piece still peels off its own backing.

Also fixed a real break that arrived with migration 0044: `bag_labels` now holds
a row per sticker a laundromat has used, and this page was counting those as
printed stock. Blank-tag counts were running about five times too high, which is
the number the low-stock warning reads.

### 2. Neil's number can always book ✅

`ALWAYS_BOOK_NUMBERS` in `.env`, falling back to `SUPPORT_PHONE`. It waives
exactly two rules - the closed sign and the Bergen County boundary - because
those are decisions about who we choose to serve. An address, wash preferences,
a card and a real date are still required, because those are what make an order
possible to actually do. The AI is told the same thing, so it cannot refuse in
the thread something the code behind it would allow.

**Needs Neil:** set `SUPPORT_PHONE=+14437452665` in Railway. Nothing works until
that is there.

### 3. Signing in without the code ✅

The cause was a cached sign-in form, not a hole in the code check. The browser
kept a copy of the sign-in page from a time when Neil was signed out, served it
again while his session was in fact still alive, and the moment he submitted it
the next page saw a valid session and waved him through - which looks exactly
like the code step being skipped.

The sign-in pages are `no-store` now, so a page offering to sign you in is only
ever shown to somebody actually signed out. And submitting a number while
already signed in no longer texts a code and writes a credential row that the
next page would silently swallow.

### 4. Help menu is now Resources ✅

These are not answers to a problem you are having - they are the documents you
read before you start and hand to somebody else.

### 5. The laundromat page is under Resources ✅

`/for-laundromats`, the actual page we send an owner rather than a copy of it,
behind `partners.view`. The thing most likely to go stale is the page nobody who
works here ever opens.

### 6. Van clips through the driver's run ✅

The clip numbers were already computed and shown at the drop-off and at the
door - what was missing was the collect stop. The run was offering "scan them
into the van" for bags nobody had weighed back in, which is the wrong order:
weigh, check, then clip. It now sends the driver to each order still waiting to
be weighed, and only offers the van scan once they all are.

`BOARD_FIELDS` carries `return_bag_count` now. Without it the run had no way to
tell a bag still on a laundromat shelf from one already in the van - the same
class of bug as the order page reading an unselected column and rendering
nothing.

### 7. The admin escape hatch on a weight mismatch ✅

`orders.override`, which only an Admin holds. It appears **only after the check
has actually refused** - offering "go anyway" beside a form nobody has
submitted yet invites it to become the normal way through.

It is an override, not a bypass. The check still runs, the reason goes in the
change log with a name on it, an issue is still raised for the morning, and
what the driver is told says plainly that it did **not** match. A refusal that
can be waved away silently is not a check.

---

## Outstanding

*Reviewed 2 Sep 2026, against the running system rather than from memory.*

### Done since this list was last written

**A. Two-hour pickup slots** and **B. a window closes the moment it starts** are
both built. `PICKUP_WINDOWS` is 8-10, 10-12, 12-2, 2-4, 4-6 and
`WINDOW_CLOSES_AT_START` is true - verified: at 08:05 the 8-10 slot is gone and
the earliest offered is 10-12.

FIVE WINDOWS, NOT THE SEVEN ORIGINALLY WRITTEN HERE, and that is deliberate.
Neil asked for slots "fitting the laundromat's hours"; Fancy K opens at 7:30 and
shuts at 7, so a 6-8am pickup could not be dropped off and a 6-8pm one would
arrive after they closed.

### 1. The laundromat page is a sales page, not an instruction set

`/for-laundromats` explains the arrangement to an owner. It has to also teach
the attendant the job: scan the bag tag, enter the weight, get the wash
instructions, and what the four peelable stickers are for - one per bag they
pack, so one bag in becomes however many bags out and each still carries our
id. Wants a picture of a bag tag and a diagram of how it threads into their own
in-house tracking, plus how a finished order is called in for collection, and
how invoicing works.

### 2. Weight corrections have nowhere to live

Neil's call: **an admin can correct a weight, a driver cannot.** The loose
weight box went when the order page became a record, so a fat-fingered weight
is now uncorrectable from any screen. Behind `orders.override` or a permission
of its own, logged to `order_events` with both numbers and a name, exactly as
the old correction box did.

### 3. Route the laundromat choice across today AND tomorrow

When an order comes in, choose its laundromat from the whole picture: what is
being picked up and dropped off today, and what is booked for tomorrow - not
just distance from that one door. `dispatch.planPartnerFor()` already chooses at
booking but weighs one order in isolation.

### 4. Reschedules are not written to the change log

A customer can move their own pickup by text and leave no trace of who changed
it or when. CLAUDE.md says every change to an order is recorded; this one is
not.

### 5. The ops app is slow on a phone

Measured, not guessed: production answers a trivial request in ~130ms, `/ops`
renders in ~410ms and `/ops/run` in ~750ms across 14 sequential database calls.
So a tap costs roughly 0.4-0.9s and every one is a full page load.

Three levers, in order of payoff: there is **no web app manifest**, so the
home-screen bookmark runs inside full Safari rather than standalone; several
more database calls can be batched; and the Railway and Supabase regions should
be checked against each other, because every one of those 14 calls pays that gap
twice.

### 6. Orphaned code from today's changes

`/ops/loadout`'s door-scan and `allBagsScanned` were bypassed by the door-flow
change. `pickupSequence()` and `workCard()` are called by nothing since the
order page became a record - kept on purpose, because Neil said "maybe we'll
come back to it later".

---

## Decided and not being built

**A separate staging site.** Neil's call, asked directly: we carry on making
changes against production. CLAUDE.md's "no more than one deployment target"
stands. The cost is real and worth writing down - real customers and real orders
are the test data, and every fix this week was verified against live rows.

---

## Waiting on Neil

- **Print bag tags.** There are ZERO blank tags left - every one is bound to an
  order. A driver with no tag cannot label a bag.
- **10DLC registration.** Still the only fix for the carrier delays: our side
  answers in 4-9 seconds and Telnyx sat on messages for 72-210.
- **Stripe keys.** Phase 8 is written and untested; no card has ever been
  charged.
