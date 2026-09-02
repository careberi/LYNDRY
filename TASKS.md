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

*Reviewed 2 Sep 2026, against the running system.*

**Everything on the previous list is done.** Kept here as the record of what was
decided, because several of these were decisions rather than tickets.

| | |
|---|---|
| Two-hour windows, closing at their start | already built; verified at 08:05 |
| The +$2 wash options | now billed, and the text explains the total |
| Weight corrections | admin only, behind `orders.override` |
| The bag tag | 4.75 x 2.38 hang tag, 12 to a sheet |
| The laundromat page | teaches the attendant the job |
| Partner billing terms | per partner, biweekly and 15 days by default |
| Reschedules | written to the change log |
| The ops app on a phone | installs standalone from the home screen |
| Laundromat choice | counts today AND tomorrow |

### What is left, and none of it is blocking

**Orphaned code.** `/ops/loadout`'s door-scan and `allBagsScanned` were bypassed
by the door-flow change. `pickupSequence()` and `workCard()` are called by
nothing since the order page became a record - kept on purpose, because Neil
said "maybe we'll come back to it later".

**The rest of the phone speed.** The manifest fixed how it feels; the server is
still 400-750ms a page across 14 sequential database calls. More of those can be
batched, and the Railway and Supabase regions are worth checking against each
other - every one of those calls pays that gap twice.

**The event log is chatty.** Tapping a sticker logs every state change, so six
taps in a second produced six rows, two of them identical. Harmless, and noise
in a log that is deliberately append-only.

---

## Decided and not being built

**A separate staging site.** Neil's call, asked directly: we carry on making
changes against production. CLAUDE.md's one-deployment-target rule stands. The
cost is real and worth writing down - real customers and real orders are the
test data, and every fix this week was verified against live rows.

**Seven windows rather than five.** The original list said 6-8am through 6-8pm.
Fancy K opens at 7:30 and shuts at 7, so a 6-8am pickup could not be dropped off
and a 6-8pm one would arrive after they closed. Revisit if a laundromat with
longer hours signs.

---

## Waiting on Neil

- **Print bag tags.** There are ZERO blank tags left - every one is bound to an
  order. A driver with no tag cannot label a bag.
- **10DLC registration.** Still the only fix for the carrier delays: our side
  answers in 4-9 seconds and Telnyx sat on messages for 72-210.
- **Stripe keys.** Phase 8 is written and untested; no card has ever been
  charged.
