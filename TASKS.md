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

*(nothing - see below)*

---

## Done, continued

### 8. Route and order tracking reflect the new process ✅

The order page was drawing both legs as though every bag wore a tag of its own.
A bag we collected wears its own bag tag, four stickers still on it; a bag the
laundromat packed wears ONE of those and reads `7MQ5Y2-2`. The sequence is
shown when there is one, and an outgoing row names the collected bag it came
out of - which is the thread back, and the thing "is this wash all here" is
actually a question about.

### 9. `/ops/journey` and `/ops/process` ✅

Both reviewed dates bumped to 1 September 2026.

Journey: pickup is now "tag, scale, photo" with the four stickers explained,
the collection step covers the admin override, and the long note about the
identifier problem now describes **the answer that was actually built** rather
than the ticket-sticker idea that was superseded. Its closing worry - that a
clip carries nothing once it comes off - is answered now: the sticker outlives
the clip.

Process: the laundromat gained the step that makes the whole return leg work
(peel a sticker onto each bag they pack), and the QR page is described as
changing with the bag. Also fixed a stale claim: the wash allowlist still
listed **hang-dry** as a field, which contradicts the rule that drying is not a
choice.

### 10. The AI sells instead of waiting ✅

It was answering "hello" with "How can we help?" and a bare introduction to
"who is this". Every reply that is not already about a booking now ends by
offering one, in its own words.

**Three times it does not push**, all deliberate: somebody unhappy or chasing a
problem gets help and nothing else; somebody who already has a pickup booked is
not sold another; and when we are not taking orders there is nothing to offer.

**Note on why it looked worse than it was.** The service is currently set to
closed, and the prompt correctly refuses to sell something that cannot be
bought. Most of the passivity was that, not the tone. The selling shows up when
the service is open - or right now on any number in `ALWAYS_BOOK_NUMBERS`.

---

## Neil's own outstanding actions

- **Set `SUPPORT_PHONE=+14437452665` in Railway.** The always-book exemption
  does nothing until it is there, and the boot log says so on every deploy.
- Print bag tags on Avery 5164 stock.
- Add the Stripe live keys.
- Rotate `ADMIN_API_KEY` - but note that rotating it kills the signature on
  every QR already printed, so rotate **then** print.

---

## 2 September, after the live thread tests

### 11. The setup asked four questions in one breath ✅

Water, detergent, softener and where to leave the bag, all in one message. That
is a form. The wash is one short question now; the spot is its own message and
asks **both ways round**, because one spot serves both legs.

### 12. The closed sign lived in four places ✅

`bookPickup()`, the prompt, `actions.js` and `onboarding.js` each check it, and
only the first two had been taught about the exemption. Neil's number walked the
whole setup, said "good to go", and got "we're not booking pickups just yet"
from a tool result. Anything new reading `settings.takingOrders()` in a customer
path has to call `booking.alwaysAllowed()` beside it.
