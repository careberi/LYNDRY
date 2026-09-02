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

### A. Seven two-hour pickup slots

Replace the five uneven windows (6-9, 9-12, 12-2, 2-5, 5-9) with seven even
ones: **6-8, 8-10, 10-12, 12-2, 2-4, 4-6, 6-8**.

Knock-on to check: the next-day promise is derived from the LAST window, so the
delivery deadline moves from 9pm to 8pm. Every existing order keeps the window
it was promised - they are stored on the order, not recomputed.

### B. A slot closes the moment it starts

At 8:01 you cannot book the 8-10 slot; the earliest is 10-12.

**This reverses a deliberate rule.** Today a window stays bookable until an hour
before its END, and the comment says why: "today at 4:30", texted at 3:32,
belongs in the 3-6 window, and the first version threw it to tomorrow, which put
a real order on the wrong day. Neil's new rule is stricter and is his call - but
it means somebody texting at 8:05 for "this morning" gets 10am, not 8am.

### C. Route the laundromat choice across today AND tomorrow

When an order comes in, choose its laundromat from the whole picture: what is
being picked up and dropped off today, and what is booked for tomorrow - not
just distance from that one door.

Partly built: `dispatch.planPartnerFor()` already chooses at booking, but it
weighs one order in isolation.

### D. Weight corrections have nowhere to live

Removing the loose weight box from a running order means a fat-fingered weight
can no longer be fixed from that page. Needs an explicit "correct something"
rather than being loose in the flow.

---

## Waiting on Neil

- **Fancy K has no Wednesday hours row**, so the router skips it every
  Wednesday. Add the row if they are actually open.
- **Order #1930 and +1 443-745-2665** are live in the database as a real
  customer and order. Leave as a test, or clear?
- **Test the camera scan on the iPhone.** Built and verified as far as a
  decoder can be checked from here; the actual camera cannot be.
