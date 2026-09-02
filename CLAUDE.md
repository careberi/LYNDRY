# CLAUDE.md — conventions for this codebase

Read this before making changes. It exists so that work done in one session
still makes sense in the next.

## Who this is for

Neil is not a developer. He owns the business and the decisions; the engineering
is delegated. That has consequences for how code gets written here:

- Explain in plain language before doing something, briefly
- Define a term or tool once, in one sentence, the first time it appears
- Anything Neil has to do outside the code (create an account, click something
  in a dashboard, copy a key) gets **numbered instructions, then stop and wait**
- Ask about business decisions; make technical calls yourself and say what you chose
- Push back before building something that's a bad idea, not after
- Boring and well documented beats clever

## Build phases — do not build ahead

Stop at the end of each phase and demonstrate it working.

| Phase | Scope | Done |
|---|---|---|
| 1 | Express skeleton, health check, `.env.example`, `.gitignore`, README, first commit | ✅ |
| 2 | Five tables in Supabase, seed script | ✅ |
| 3 | `/sms` webhook: signature check, dedupe, logging, STOP/START, hardcoded reply, `simulate-sms.js`. **No AI** | ✅ |
| 4 | The brain: Claude tool-calling, seven actions, order state machine | ✅ |
| 5 | Website, signup form, consent capture | ✅ live at lyndry.com |
| 6 | Ops endpoints, photo upload, status texts | ✅ |
| 7 | Shelly lock integration, plus a fake lock driver | ⏸ shelved — see below |
| 8 | Stripe: saved cards, off-session charging, `/pay` link, webhook | 🔨 code written, untested — needs Neil's Stripe keys |

## Explicitly not being built

Don't add these; push back if asked too early.

- A customer app or account login
- Multi-building routing or route optimisation
- More than one deployment target
- TypeScript, React, a bundler, Docker, or a job queue

*(An admin dashboard was on this list until Neil asked for one — see "The ops
screens" below. Everything else here still stands.)*

## Technical conventions

**CommonJS (`require`), not ESM (`import`).** Chosen because it is the most
documented Express combination on the internet, which matters when the person
maintaining this is googling an error message.

**Environment variables are read once, in `src/config.js`,** into a frozen
`config` object. No other file reads `process.env` directly. This applies
especially to the AI model: resolve it once at startup. Never try one model,
catch an error and fall back to another per message — that was a bug in the
previous version.

**Database schema lives in `supabase/migrations/` as numbered SQL files.**
Never change the schema only in the Supabase dashboard — the repo has to be the
record of what the database looks like. Add a new numbered file and apply it.

**Statuses are text columns with CHECK constraints, not Postgres ENUMs,** so
adding a status later is a one-line change. Money is stored in whole cents as an
integer, never as a decimal.

**Every table has row level security enabled with no policies.** That denies all
access via Supabase's public `anon` key. The server connects with the
`service_role` key, which bypasses RLS. Any new table must do the same.

**Vendors live behind adapters.** Nothing outside `src/providers/sms/` may know
Telnyx exists; nothing outside `src/providers/locks/` may know Shelly exists.
The adapters expose `sendMessage()` / `parseInbound()` and `unlock(lockerId, seconds)`.
The point is being able to switch vendor in an afternoon.

**Comments explain why, not what.** Assume the reader is smart but not a
developer and has not seen this file before.

**Never bulk edit files with PowerShell string replacement.** PowerShell 5.1
reads files as ANSI, so a `Get-Content` / `Set-Content` round trip destroys
every em dash and curly quote in the file. Use the editing tools, or
`[System.IO.File]::ReadAllText` with an explicit UTF-8 encoding.

## The website

**Everything that appears on more than one page lives in `src/web/site.js`** —
price, phone number, service area, legal name. Page files use `{{TOKEN}}`
placeholders and must never hardcode any of it. Changing the price is one line.

**`src/web/layout.js` holds the single shared layout** — head, nav, footer, and
the motion scripts. Page files in `public/pages/` contain only their own middle
section.

**There is no CSS framework.** Tailwind was removed when the site moved to the
design system below. Styling is three stylesheets, linked in this order:

| File | What it is |
|---|---|
| `public/css/ds/` | The LYNDRY design system, **vendored unmodified**. Tokens only. Don't edit — replace wholesale if it's updated. |
| `public/css/icons.css` | Every Lucide glyph the site uses, as CSS masks |
| `public/css/lyndry.css` | Ours. Buttons, cards, inputs, scallop, phone mock, page furniture, responsive rules |

Only `public/css` is served statically. `public/pages` holds templates with
`{{TOKEN}}` holes and must never be reachable directly.

**Stylesheets are served from a fingerprinted path, `/css/<hash>/…`,** built by
`src/web/assets.js` from the contents of every file in `public/css`. Change any
stylesheet and every URL changes, so a deploy is picked up immediately; because
a given URL's content can then never change, it is cached for a year.

**Never link `/css/…` directly from a page** — use `CSS_BASE`. The
unfingerprinted path stays mounted for old bookmarks and is served `no-cache`,
which is exactly the staleness the fingerprint exists to avoid.

The fingerprint is a directory, not a `?query`, because the design system's
`styles.css` pulls in its tokens with relative `@import` — those resolve under
whatever directory the stylesheet came from, so versioning the directory
versions the imports too. A query string would leave the tokens stale.

This is not theoretical: the logo shipped as unstyled markup on every phone
that had visited before, because the HTML was new and a seven-day cached
stylesheet had no `.ly-logo` rules in it.

### The visual system

**One sentence: everything is a line drawing on cream paper, and it casts a
hard shadow.** If an element has no ink outline, it is either type, a divider,
or wrong.

| Role | Token | Value |
|---|---|---|
| Page ground | `--paper-100` | `#FFF8EC` warm cream, never grey |
| Card fill | `--paper-050` | `#FFFDF7` |
| Input fill | `--paper-000` | pure white — **only** for fields, so they read as holes punched in the page |
| Outline and most text | `--ink-900` | `#101210` |
| Suds — primary | `--suds-500` | `#0EA47A` |
| Sunbeam — good news, money | `--sunbeam-500` | `#FFD23F` |
| Lilac — secondary, focus ring | `--lilac-500` | `#C9A7F5` |
| Stain — errors only | `--stain-500` | `#E8412F` |

Rules that are easy to break by accident:

- **One outline colour, `--ink-900`.** Never grey, never a tint of the fill.
- **Shadows are hard offsets in pure ink** — 2/4/6/10/14px, no blur, no
  transparency. `--shadow-float` is the single blurred exception, for overlays.
  A card sitting *on* ink uses a coloured offset instead (`.card-on-ink`),
  because an ink shadow on ink is invisible.
- **Text is ink on every brand colour.** Suds, Sunbeam and Lilac are all light
  enough that white text on them is a bug. The only light-on-dark pairing is
  paper on ink.
- **No gradients anywhere.** The one repeating texture is the 18px lilac dot
  grid (`.dotfield`), used for pricing bands.
- **Three type families, three jobs.** Outfit 900/800 headlines (never below
  20px), Schibsted Grotesk body, Space Mono 700 uppercase 11–13px for labels
  and eyebrows (never above 14px). The recurring stack is mono eyebrow →
  Outfit headline → Schibsted paragraph.
- **Controls come in three heights only** — 36/46/56px, and never below 44px
  for a touch target.
- **The hover/press signature** is on every filled button and interactive card:
  hover lifts `translate(-2px,-2px)` onto a deeper shadow, press pushes
  `translate(3px,3px)` onto a 1px shadow. Ghost buttons are the one exception —
  they just underline. Focus is a lilac halo plus an ink edge, never removed.
- **The scallop is a full stop. One per page.** The home page has it; nothing
  else should.

**Grid ratios must be classes, never inline `grid-template-columns`.** An
inline style beats the media query and the page then refuses to collapse on a
phone. Add a modifier to `lyndry.css` instead — `.grid-2-wide`,
`.grid-2-narrow` and so on.

**Icons go through `{{ICON_*}}` tokens or `icon()` in `layout.js`.** Never
inline SVG path data in a page. Adding a glyph means editing `icons.css` and
the token list, and nothing else.

### The logo

**A laundry bag that is also a speech bubble, with the wordmark inside it.**
Supplied by Neil as artwork, not built in CSS. `logo(variant)` in `layout.js`
renders it; the CSS is at the top of `lyndry.css`. Variants: `nav` (header, 44px),
`footer` (62px), `compact` (38px, the smallest the wordmark stays readable at),
`offset` (132px with a hard ink drop-shadow, for marketing placements).
`avatar()` is a separate mark — the "L" in a Suds bubble, used in the phone mock.

It replaced a bubble assembled out of CSS: a border-radius box, the wordmark set
inside it, and a hand-built tail. All of that is gone, along with a long note
about how fiddly the tail was. **Don't re-derive the mark in CSS** — it draws the
bag, the bubble and the type as one shape, and a hand copy would only be a worse
version of a file we already have.

**`public/css/logo.png` is the artwork cut out of what Neil sent.** The original
was a 1254px PNG on a green ground **with no alpha channel**, so it could not go
on a page as-is — it would have been a green square. What ships is that artwork
flood-filled away from its background, un-greened along the anti-aliased edge,
and quantised to 64 colours: 600px wide and 25 KB against 1 MB.

**Two things about the cut-out that would come back if it is ever redone.** The
outer boundary of the mark is the ink stroke, so every partially transparent
pixel is painted ink rather than having a colour guessed from a mostly-green
one — guessing left a green halo that was invisible on cream and obvious on the
ink footer. And the opaque mask has to be **eroded** before it is used: the
flood fill reaches a few pixels into the anti-aliased band, and forcing those to
full opacity left dark-green speckle along every edge.

**It lives in `public/css` so it is fingerprinted.** Referenced relatively from
`lyndry.css`, it resolves under `/css/<hash>/` and inherits the same immutable
year-long cache as the stylesheets. **`assets.js` therefore hashes every file in
that directory, not just the `.css` ones** — without that, changing the logo
would leave the URL identical and a new mark would never reach anybody who had
visited before, which is exactly the bug the fingerprint exists to prevent.

**The mark is a background image, not an `<img>`**, so its URL comes from the
fingerprinted stylesheet directory. That leaves it with no text of its own, so
the accessible name goes on whatever wraps it: the link's `aria-label` when it
is a link, `role="img"` on the mark itself when it is not.

**Variants set only `--ly-h`.** The width comes from `aspect-ratio`, so a
variant can never squash the mark.

**The favicon is the silhouette, not the logo.** The wordmark is about a fifth
of the mark's height, so at 32px it is an illegible smear and at 16px a grey
band. The favicon is the bag-and-bubble shape with no type in it, drawn inline
in `layout.js` as it always was.

### Motion

Three things, all defined in `layout.js` and `lyndry.css`:

- **Bubbles** — 72 rising soap bubbles in the hero, tinted from five palette
  colours. Every bubble has a *negative* animation delay so the field is
  already full at page load, and rises are slow (16–52s) because a faster pass
  read as fizzing. The markup is generated, not hand-written — the snippet is
  in `DECISIONS.md`.
- **`data-reveal`** on an element fades and lifts it into view.
- **`data-parallax="<speed>"`** drifts an element as you scroll past. Positive
  lags, negative leads.

**An element must never carry both `data-reveal` and `data-parallax`** — they
both write `transform` and will fight.

**Parallax displacement is clamped to start at zero.** The threshold is
`max(0, elementTop - viewportHeight)`. Without the clamp, everything above the
fold is thrown out of position before the visitor has scrolled at all.

**The reveal must stay fail-safe.** The hiding CSS only applies under
`.js-anim`, which JavaScript adds at runtime — so a browser that never runs the
script shows the page normally instead of a blank one. Never move that hiding
into plain CSS.

**Everything is disabled under `prefers-reduced-motion`.** Anyone whose device
asks for less motion gets none. Any new animation must honour it too.

**In development, page HTML is re-read on every request** — edit a file in
`public/pages/`, refresh the browser, done. In production it's cached.

**`/for-laundromats` is the page you SEND, `/partners` is the form strangers
fill in.** The first explains the arrangement to a laundromat owner Neil has
already met - what their part is, what we handle, why it is worth having, and
ten FAQs. `/ops/partners` has a box to text somebody the link, behind
`partners.manage` rather than `partners.view` because sending something to a
real phone is a different act from reading a list.

**The same no-commercial-terms rule applies to it, and harder.** It is a sales
page, so it is exactly where a rate would feel natural and would then be quoted
back at us. Every money question on it ends at "we agree it with you directly",
and the volume FAQ says plainly that we will not promise one. What it may claim
is the *shape* of the deal - we bring the work, do the driving, hold the
customer, handle the billing - because all of that is true today and none of it
is a figure.

**The text is one SMS segment and the name field is capped at 30 characters to
keep it there.** 160 characters is a segment and carriers bill per segment; a
long shop name pasted into the greeting silently doubles the cost of every
send.

**`/partners` takes enquiries from laundromats and property managers.** One
form, one `partner_enquiries` table, a `partner_type` of `LAUNDROMAT` or
`PROPERTY`. The row is saved first and Neil is texted second — the row is the
durable record and the text is a best-effort nudge, so an enquiry survives
texting being down. There is no admin UI; read it with a query:

```sql
select created_at, partner_type, company, contact_name, email, phone, city, size_note, message
from partner_enquiries where status = 'NEW' order by created_at desc;
```

**There are no commercial terms on that page, deliberately** — no revenue
share, no per-pound rate to a laundromat, no fee or discount for a building,
no promise about volume. None of it has been decided. Don't invent it.

**Public forms carry a honeypot field.** A hidden input a person never sees;
anything that fills it gets a 303 to the thank-you page and is dropped without
being saved, so whatever submitted it gets no signal that it was caught.

**Anything a visitor typed that gets shown back to them must go through
`escapeHtml()`.** The signup form redisplays what you typed after a validation
error, and without escaping that is a route to injecting markup into the page.

## File structure

```
src/
  index.js              start the server, wire up routes
  config.js             every environment setting, read once and frozen
  db.js                 the Supabase connection
  routes/     sms.js  ops.js  web.js
  core/       brain.js  actions.js  orders.js  compliance.js  notify.js
  providers/  sms/index.js  sms/telnyx.js
              locks/index.js  locks/shelly.js
supabase/
  migrations/           numbered .sql files, the record of the schema
public/                 html, css, images
scripts/                seed.js  simulate-sms.js
```

## The AI layer

Claude's only job is to translate **one message into one structured action.** It
holds no state, decides no prices, and never touches hardware.

The eight tools:

```
create_order(pickup_date, pickup_time, pickup_method, bag_count, notes)
get_order_status()
reschedule_order(new_date, new_time)
cancel_order()
open_locker()
save_details(name, address_line1, address_line2, city, state, postal_code)
update_profile(field, value)
handoff_to_human(reason)
```

Rules:

- `open_locker()` **takes no arguments — never change this.** The backend works
  out which compartment from the authenticated phone number's open order, and
  refuses if there isn't one. Claude cannot name a locker, a building or a
  customer, so no amount of clever texting gets someone into a locker that
  isn't theirs.
- **Customers text like they are texting a friend, and that is the product.**
  "hey can you grab my laundry tomorrow at 6", lowercase, half a sentence. The
  AI handles all of it without comment. **Never send a menu, a numbered list of
  options, or "reply 1 for…".** If a reply looks like a phone tree it is wrong —
  the entire reason for the AI is that the customer does not have to learn a
  format. This survived a proposal to add scripted step-by-step flows; don't
  reintroduce them.
- **Always second person.** The customer notes handed to Claude are written in
  the third person, and it will echo that voice back if not told not to —
  "They've got a pickup booked" went out to a real phone once. It says "you".
- **A greeting is not a request.** "hello" gets "Hey! How can I help?" — not an
  order recap and not a tool call. Same for "thanks" and "ok". Not every
  message needs an action.
- **One recap before every booking, then a yes, then book.** The recap is a
  statement, not questions: when, the address, where the bag is, how it's
  washed. A correction gets folded in, not interrogated. This is the only
  confirmation step — nothing is ever confirmed twice. (Neil's call, twice:
  "re-confirm everything" for repeat customers, and "the pickup location and
  wash preferences are mandatory".)
- **The wash question is ONE short question, and the spot is its own message.**
  It was four questions in one breath — water, detergent, softener, and where
  to leave the bag — which is a form, the one thing this product exists not to
  be. The wash is the single stated exception to one-question-per-message,
  because temperature and fragrance are one decision to a customer; it never
  grows back into a list of every combination.
- **The spot question asks both ways round** — "where should the driver pick
  the laundry up and drop it back off?" One spot serves both legs, and asking
  only where to *find* the bag leaves somebody expecting to be asked again
  about the delivery.
- Missing a required field? Ask for **that one field only**, then act.
- A returning customer texting "laundry tomorrow" gets an order with zero
  follow-up questions.
- **DRYING IS NOT A CHOICE AND MUST NOT BECOME ONE.** We tumble dry everything.
There is no `hang_dry` field, it is not in `update_profile`'s enum, and it is
not on the laundromat's page. The prompt says in as many words that the AI must
not offer an exception and must not say it will make a note — taking the field
away stops it SAVING one, not PROMISING one, and a promise made in a text thread
is one the people doing the washing never see.

**There are no default wash preferences, anywhere.** A new customer is asked
  once, in the thread, during setup — water temperature, detergent, softener,
  and where the driver finds the bag — and `bookPickup()` refuses a first
  booking until they exist. Never invent a setting and never tell somebody
  what they've been "set up with"; that sentence went to a real customer and
  Neil called it unacceptable. Once saved, never asked again.
- Uncertain, or the customer is upset? `handoff_to_human` rather than guessing.
- Replies sound like a competent human at a small business. Short. No emoji.
  Never "I'm an AI".

## Ops endpoints

Everything under `/ops` needs the `x-admin-key` header, compared in constant
time. No login system, no accounts — it's Neil and a driver.

```
POST /ops/collected          the bag is in the van        -> IN_PROCESS
POST /ops/at-partner         dropped at the laundromat    -> AT_PARTNER
POST /ops/ready              partner has finished it      -> READY
POST /ops/weight             pounds in, price out         (sets price_cents, CHARGES)
POST /ops/out-for-delivery                                -> OUT_FOR_DELIVERY
POST /ops/delivered          multipart photo upload       -> DELIVERED
POST /ops/charge             retry a declined card        (manual lever)
POST /ops/waive              decide not to charge         -> WAIVED
GET  /ops/today              the driver's run sheet, plus what's owed
```

**The steps themselves live in `src/core/fulfilment.js`, and both front doors
call it** — the buttons on the ops screens and this JSON API. They used to be
one implementation with no buttons at all; the moment a second caller appeared,
reimplementing "collected" in the HTML router would have drifted the first time
one of them learned something the other did not. Same rule as `booking.js`.

**A partner never touches the system. The driver records everything.** He taps
"dropped at partner", the laundromat tells him the weight, he taps it in. There
are no partner accounts and no partner logins, on purpose: `/ops/weight` is what
charges the customer's card, so a weight of 400 instead of 40 is a $1,000
charge, and our own driver belongs between that number and someone's card. Also
there is no signed partner yet and no agreed commercial terms, so partner
logins would be building for somebody who does not exist.

**Every status change texts the customer**, through `src/core/notify.js`, which
sends and logs in one step. Nothing may send a text without recording it.

**Every change to an order is written to `order_events`, and the order page
shows it.** What changed, when, who did it and why — status moves, weights and
corrections, prices, charges, labels going on and off, which laundromat had it,
and the laundromat's own weight. **Append only**: nothing updates or deletes a
row, because a log that can be tidied up afterwards is not evidence of anything.

Status moves are logged inside `step()` in `fulfilment.js`, so a step added
later cannot forget. Everything else is written deliberately at the moment it
happens — a generic audit over every column would be mostly "notes changed from
null to null", and a log that is mostly noise is one nobody reads.

**Recording never breaks the thing being recorded.** `orderEvents.record()`
swallows its own errors and logs loudly; a driver at a door must never be
stopped by the audit trail failing.

**Only `src/core/orders.js` may change an order's status.** The endpoints ask it
to and turn its refusal into a 409, so a driver double-tapping cannot deliver
an order twice or charge for it twice.

**`price_cents` is set only by `/ops/weight`**, from `price_per_lb_cents` stored
on that order — never today's rate. Changing the price must not re-price work
already quoted.

**Delivery photos go in a private Supabase Storage bucket**, and what the
customer is texted is `lyndry.com/p/<order-uuid>` — our own domain, which
**re-signs a fresh one-hour storage URL on every visit and redirects**. So the
texted link never stops working, while a storage URL copied out of the address
bar dies within the hour. What keeps it private is that the order id is a random
UUID and nothing on the page reveals another.

Two reasons it is not the storage URL directly: carriers distrust links to
domains that are not yours, which matters for 10DLC registration, and a signed
storage URL is enormous and would break the day its signature expired. **Do not
put these behind a link shortener either** — carriers treat shortened links as a
spam signal.

`npm run driver` is the terminal equivalent, and still the fastest way to test
an order through its whole day.

**The order page is where the work actually happens.** One card at the top, the
legal next steps as 56px full-width buttons, and a weight box. No JavaScript
anywhere: a driver on two bars of signal in a stairwell gets a page that either
worked or did not, rather than a spinner that lies. `?done=` and `?problem=` on
the redirect carry the banner, so refreshing repeats the message and never the
action. A double-tap is refused by the state machine and shown as a sentence.

**A numbered clip goes on each bag while it is in the van, and it is physical
stock.** A sticker code like `7MQ5Y2` identifies a bag perfectly and is useless
shouted across a laundromat counter; "four, six and ten" is what a driver and a
counter assistant can actually say. Neil owns a real bag of clips, so the pool
is finite (`config.routing.vanClips`) and the system hands out the **lowest
free** one rather than inventing clip 51 that nobody owns. Running out is a real
thing on a heavy day and the run says so.

**Clips are scoped to the driver** — each van has its own set, so Dan's clip 4
and somebody else's clip 4 never collide. The owner comes from `orders.driver_id`
rather than being stored twice.

**The clip's life is the van leg, and there are TWO of them.** On at the
customer's door once the bag is weighed, off when it is handed to the
laundromat, which frees the number. Then on again when the finished work is
collected, and off at the customer's door. **Do not confuse it with
`orders.stop_number`** — a stop number says which door on the way back, a clip
number says which bag is in the van. `unclipOrder()` never clears
`clip_number`, only stamps `unclipped_at`, so the order page can still say
which clip a bag travelled under.

**WEIGH, CHECK, THEN CLIP — and the order of those three is the point.**
Neil's sequence. Collecting finished work off a laundromat goes through
`tags.collectFromPartner()`: the driver says how many bags and what they weigh,
the weight is checked against what he collected from the customer, and **only
if it passes do the clips go on**. So a clipped bag is a *verified* bag, and
the clips in the van are the record that the load was weighed and matched
before it moved.

**An admin can push past a failed check, on the record.** `orders.override`,
Admin only — never the driver, because the value of the check is that somebody
other than the person in a hurry agreed. The threshold is a guess and says so,
and a laundromat closing in five minutes does not care.

It is an override, not a bypass: the check still runs, the reason goes in
`order_events` with a name on it, an issue is still raised for the morning, and
what the driver is told says plainly that it did **not** match. The box only
appears *after* a refusal — offering "take it anyway" beside a form nobody has
submitted yet makes it the normal way through.

**A failed check creates nothing** — no bag rows, no clips out of the pool.
A refusal that had already taken four clips would be a refusal the driver has
to undo before he can weigh again.

**THE CLIP IS WHAT MAKES THE RETURN LEG WORK WITHOUT A STICKER.** A clip
attaches to a bag ROW, not to a code — `assignClip()` has never looked at a
code, and `bag_labels.code` is nullable. So the driver says "four bags", each
gets a row and a number, and nothing is stuck to anything. The laundromat is
never asked to label what it packed. Do not reintroduce a scan as the way a
clip gets assigned on this leg; that was the mistake that made the return leg
look impossible.

**An order goes to one laundromat, whole.** Neil's call: splitting a customer's
bags across two would mean their wash finishes at different times, so they
either wait for the slowest bag or get delivered twice. The routing decision is
per order; the clip is per bag.

**A pickup goes: how many bags, then one bag at a time.** The driver is at a
door with his hands full, so the run asks for the count first and then walks
each bag — sticker on it, on the scale, photograph the display — before "in the
van". Asking for stickers before anybody has said how many bags there are is a
question out of order, and asking for one total at the end makes him add up in
his head and loses which bag was the heavy one.

**BAGS IN IS NOT BAGS OUT, and the count is never assumed across the two.**
The laundromat empties what we bring and packs the clean laundry into its own
bags, so two in can be one out or four. `bag_labels.leg` is `PICKUP` or
`DELIVERY`, the counts live in `orders.bag_count` and `orders.return_bag_count`,
and the weights in `orders.weight_lb` and `orders.return_weight_lb`. Anything
asking "are all the bags here" must name a leg.

**What proves nothing was lost is the WEIGHT, not the count.** Neil's framing
and the right one: 25 lb collected and 25 lb returned means it is all there,
whatever carried it.

**`tags.checkHandover()` is deliberately NOT symmetric**, and this is the one
weight comparison in the system that is not. Every other one is two scales on
the same load, where a gap either way just means a scale is off. This is dirty
in against clean out:

| | |
|---|---|
| up to `DRY_LOSS_PCT` lighter | normal, water and grit came out, every order |
| more than that | **a bag has been left behind** |
| over `GAIN_LB` heavier | **somebody else's clothes are in the pile** |

`Math.abs` would treat 2 lb lighter and 2 lb heavier as the same event when they
mean opposite things. **The 8% is a guess and is flagged as one in the code** —
damp towels hold real water and dry shirts hold none, so record the drift and
tighten it once the spread is visible rather than inventing a number that flags
everything or nothing.

**Nothing goes out for delivery, and the customer is told nothing, until the
return leg is recorded.** `outForDelivery()` refuses for any order that went to
a laundromat until `return_bag_count` and `return_weight_lb` exist. A real order
went out, and its customer was texted, while nobody had yet recorded what came
off the shelf — the first moment anybody would have found a missing bag was a
doorstep, after the promise had been sent.

**`bagsInVan()` must not fall back to the pickup stickers once `partner_id` is
set.** That fallback is right for a bag that never left the van and wrong the
moment a laundromat has had it: those stickers are in their bin. It asked a
driver to scan three codes that no longer physically exist.

**`orders.weight_lb` is the SUM of `bag_labels.weight_lb`, recomputed whenever a
bag is weighed.** It is still the authoritative figure — it prices the order and
it is what a laundromat's number is checked against — it is simply added up
rather than typed once. Written through `fulfilment.recordWeight()` so the
price, the audit entry and the text to the customer happen the one way they
already happen.

**`bind()` refuses more stickers than the order has bags.** A fourth sticker on
a three-bag order leaves the run waiting on a bag that does not exist. Only once
the count is known — a count nobody has entered is not a limit of zero.

**THERE IS NO SCALE PHOTO ANY MORE, and that is Neil's call.** A weight used to
be refused without a picture of the display, because that number charges a card
and 400 lb typed instead of 40 is a $1,000 charge. It is a photo step at every
bag on every doorstep, every day, against a dispute that has not happened yet,
and he decided the price was too high.

`recordWeight()` still ACCEPTS a photo and stores it — the JSON API takes
multipart and old orders keep theirs — it simply never demands one. Don't put
the requirement back without asking; what replaced it is that every bag is
weighed separately, the laundromat weighs it again and a gap raises an issue,
and every figure is in `order_events` with a name against it.

**Every bag is scanned before the camera exists, then one photo.** While
anything on the order is unscanned the delivery form is not on the page at all —
not disabled, absent — and a checklist ticks the codes off one at a time. A
driver who photographs the doorstep and then finds he is holding the wrong bag
has already done the step that means "delivered" in his head, and the scan
becomes a formality he is motivated to get past. **However many bags there are,
there is exactly one photo**: it is a picture of the drop-off, not of each bag,
and the scans are what prove which bags they were. `fulfilment.deliver()`
refuses regardless — the JSON API reaches the same code and markup guards
neither.

**An order number identifies an order to a person; the UUID is for the
database.** `orders.order_number` starts at 1001, appears on the board, heads
the order page, rides along on the booking confirmation text, and is what
`/ops/orders/1042` accepts. A UUID always has hyphens and letters, so digits
alone are never ambiguous.

## The ops screens

Browser screens for Neil, at `/ops`. Built in `src/routes/admin.js`, which
renders HTML only — `src/routes/ops.js` stays the JSON API. Both share one
sign-in check in `src/core/admin-auth.js`, so they cannot drift apart.

```
GET  /ops                    orders board: active, upcoming, past
GET  /ops/orders/:id         one order, the buttons, and the message thread
POST /ops/orders/:id/<step>  the buttons: collected, at-partner, ready,
                             weight, out-for-delivery, delivered
GET  /ops/customers          everyone, with order counts and lifetime billed
GET  /ops/customers/:id      profile, preferences, consent record, history
GET  /ops/messages           every conversation, one row per phone number
GET  /ops/messages/:phone    one thread, oldest first, with delivery receipts
GET  /ops/issues             everything still waiting on a person
GET  /ops/economics          what the shape of a run earns      } models, not
GET  /ops/planner            what one load of stops earns       } reports
GET  /ops/process            how the whole thing works
GET  /ops/journey            what happens to a bag, doorstep to doorstep
GET  /ops/loadout            scan bags into the van, build the run
GET  /ops/run                the driver's round: one stop, one thing to do
POST /ops/run/here           "I'm here"
POST /ops/run/dropped        handed the load over at the laundromat
GET  /ops/routing            the live day on a map; ?date= ?from= ?driver= pick it
GET  /ops/labels             print a sheet of bag stickers
GET  /o/<code>               the page behind the QR on a bag (public)
GET  /ops/settings           are we taking orders, and why not
POST /ops/settings/close     stop taking orders, with a reason
POST /ops/settings/open      start again
GET  /ops/promotions         what we are giving away
POST /ops/promotions         create one
POST /ops/promotions/:id/end stop new grants; holders keep it
GET  /ops/broadcast          send one text to everybody
POST /ops/broadcast          actually send it
GET  /ops/partners           the businesses we work with, added by hand
GET  /ops/partners/:id       one partner, and their scale against ours
GET  /ops/partners/enquiries leads from the website form
POST /ops/partners/enquiries/:id/status   NEW / CONTACTED / CLOSED
GET  /ops/team               everyone who can sign in
GET  /ops/team/:id           one person: name, number, role, driving, home base
POST /ops/team/:id           save all of it, in one go
POST /ops/orders/:id/driver  move an order to a different driver
GET  /ops/login              phone number     } the only two pages
GET  /ops/login/code         six-digit code   } reachable signed out
```

**`/ops/economics` and `/ops/planner` are the only two ops pages that read
nothing from the database.** They are calculators used at a desk: you type
made-up numbers in and they answer "would a day like this work". Both are behind
`money.view` — they show the wholesale wash rate, which is not a driver's to
browse — and nothing typed into either changes anything anywhere else.

**`/ops/routing` is the planner's twin, and the difference is the whole point.**
The planner is a day you invent; dispatch is the day that actually exists. Same
map, same pins, same shape of numbers, but every stop on it is a real order.
Keeping both is deliberate: a planner that could only show real orders cannot
answer "what if we had twelve stops in Hoboken" before those twelve orders
exist, and that is the question that decides whether to go there at all.

**On routing the run sheet is server-rendered and only the map is JavaScript.**
The order of the stops, the times, the laundromat and the pounds are in the
HTML and work with scripting off, exactly like every other ops page — that is
the part somebody drives. The map is a picture OF the run sheet rather than the
source of it, so losing it costs you the picture and nothing else. **The
sequence must never move because the map loaded.**

**The planner and routing are the only pages that depend on an outside
service at runtime.** Three of them, none needing an account or a key: Leaflet
for the map, OpenStreetMap for the tiles, and OSRM for real driving
distances between the stops. Leaflet is pinned to an exact version with an
integrity hash, so a CDN that changed the bytes underneath us would be refused
by the browser rather than run.

**The tiles were CARTO's and are now OpenStreetMap's own.** CARTO served them
keyless for a long time and then began stamping API KEY REQUIRED across every
tile, which put a watermark over the whole map. OSM's tiles are genuinely
keyless; their usage policy is comfortable for one person planning a round, and
staying a light user is the basis on which we may use them at all - which is
why there is no `detectRetina` doubling the requests and no `{s}` subdomain
prefix, which OSM asked people to stop using.

OSRM is the one to be careful about: it is a free public demo server with
nothing promised behind it. The page is written so that losing it is a
downgrade rather than a break — distances fall back to straight-line times the
road factor, and the badge under the map says which of the two you are looking
at. **Never let it silently mix the two**, and never quietly drop the badge; a
mileage figure whose provenance is invisible is worse than no figure. If the
demo server becomes unreliable, the replacement is a paid routing key, not a
quiet return to estimates.

**A customer may have SEVERAL PICKUPS BOOKED — one per day, as many days as
they like.** It used to be one, full stop, enforced by a partial unique index
since `0001`. That index existed so `open_locker()` could resolve a compartment
from a phone number alone and there had to be exactly one answer — and lockers
are shelved, so it outlived what it protected. A real customer booked Thursday,
asked for Friday as well, said yes to the recap and was handed to a human.

**One per day is still right**, and is not the same rule. The van visits a door
once a day, so a second open pickup on the same date is a mistake rather than a
request — the same rule standing orders already follow. It also keeps "your
Thursday pickup" unambiguous.

**`findAwaitingCollection()` returns the SOONEST, not the only one.** It was
`.maybeSingle()`, which would now throw rather than choose. Anything that must
not guess between two — rescheduling, cancelling — calls
`findAllAwaitingCollection()` and **asks which**, naming the days. Acting on
whichever came first would cancel the wrong laundry, and there is no undo.

**Anything that asks "have they already got one" must ask about the DAY**, via
`findAwaitingOn()`. Checking for any open pickup was right while there could
only be one; now it would skip a standing order for ever the moment somebody
booked a different day by hand.

**A customer may have several standing orders.** `recurring_schedules`, one row
per arrangement, so Tuesday mornings and Saturday lunchtimes can both exist —
that was impossible while the schedule lived in four columns on the customer
row. Each carries its own `time_of_day`, which is usually what makes the second
one different from the first. `recurring.isScheduled(customer)` reads
`customer.schedules`, so a caller has to load them first rather than each firing
its own query. The old `customers.recurring_*` columns are backfilled and no
longer read; they stay until it is certain nothing touches them.

**Two schedules on the same day is one pickup, not two.** The unique index stops
a duplicate being created, and `bookPickup()` would refuse the second anyway —
silently, which is worse.

**Standing orders need a scheduler or they never happen.** `npm run
cron:recurring` books tomorrow's recurring pickups and texts each customer the
evening before with a way to SKIP. Nothing in the app calls it — it is a Railway
cron service running once a day. Without that, a customer can set up a weekly
pickup, be told it is arranged, and never be collected from.

It calls `recurring.bookDue()` directly rather than posting to
`/ops/cron/recurring`; same repo, same env, same database, so a URL and an admin
key would only be two more things that could be wrong. The endpoint stays for
testing by hand. **Safe to run any number of times** — `bookPickup()` refuses a
second pickup for anyone who already has one waiting, so a retry is a no-op.

**A sticker is in one of three states, and `labelState()` is the only thing
that decides which** — OUTSTANDING (printed, never used), IN USE (on a bag, QR
opens), EXPIRED (order delivered, link dead). `/ops/labels` counts, colours and
filters by it, and warns when blank stock drops below ten, because a driver with
no sticker cannot label a bag and an unlabelled bag cannot be scanned at a door.

**ONE BAG TAG PER BAG, CARRYING FOUR NUMBERED PEELABLE STICKERS.** All five
rows share the code — `7MQ5Y2` for the tag itself and `7MQ5Y2-1` through `-4`
for the stickers. The id is what a person says out loud and is the same on all
of them; `bag_labels.sticker_seq` is what makes them individually addressable,
so a sticker tapped twice is not mistaken for a second bag.

**The four stickers are the whole answer to the return leg.** One bag we
collect becomes however many bags the laundromat packs, and each of those gets
one sticker off the tag it came out of — `bag_labels.parent_id` is the thread
back. So a bag THEY packed carries our id without anybody binding a fresh code
to it at a counter, and without us being told in advance how many bags it will
become.

**This REVERSED the single order tag.** That model was right that the wash
instructions are per order, and wrong that a bag needed no identity of its own.
`orders.tag_code` stays and still resolves, so nothing already printed stopped
working.

**`/ops/labels` counts intake rows only** — `sticker_seq is null`. A row per
sticker a laundromat has used is a bag that came back, not stock out of a
printer, and counting them ran the blank-tag figure five times too high. Any
new query about printed stock has to filter the same way.

**The tag is RANDOM, never `order_number`.** A sequential value in a public URL
lets anybody holding one read the next order's wash instructions by adding one
to it. Same 32^6 space and the same signature as a bag sticker, so one scanner
handles both. `tags.claim()` is idempotent — an order quietly acquiring a second
tag would stop every sticker already on its bags resolving.

**`/o/<code>` resolves an order tag FIRST and a bag sticker second**, so nothing
already stuck to a bag stopped working the day the model changed.

**Bag labels are pre-printed and bound later.** A sticker has to exist at a
customer's door and there is no printer in the van, so blank labels are printed
in batches from `/ops/labels`, live in the van, and the driver enters the code
to bind one to a bag. `bag_labels` is a pointer, not an identity — the
order is the identity. **Delivery RETIRES every label on the order** — it sets `released_at`, which is
what stops `/o/<code>` resolving, so a sticker out of a bin points at nothing.
It does NOT clear `order_id`: the link dies, the record does not, and the order
page still shows which codes were on which bag afterwards. Clearing it was the
first version and a delivered order then read "no labels yet". Any query for
blank stock or labels in use has to check `released_at`, not just `order_id`.

**`/o/<code>` is the only page in the system with no login at all**, and that is
the point: a laundromat points a camera at a sticker. Its whole design is what
is safe to put on a page like that. It shows the code, which bag of how many,
five structured wash fields and a countdown. **Free text never crosses** — not
`special_instructions`, not `dropoff_spot`, however laundry-ish it looks. A real
saved preference on this system reads "Deliver to 16-51 Chandler Dr", and no
regex catches "the Bergen Pediatrics name tags", so the fix is an allowlist
rather than redaction. Add a field to that page only by adding it to
`washLines()` deliberately.

**Partners are added by hand and are not the same thing as enquiries.**
`partners` is the short list of businesses we work with, typed in by Neil;
`partner_enquiries` is the website form and is a pile of strangers. Two types:
`LAUNDROMAT` carries a wholesale rate, a retail rate, hours and a daily
capacity, and `PROPERTY_MANAGER` carries none of them — **switching a record's
type clears the ones that no longer apply**, because a stale wholesale rate on a
landlord gets read as real a year later.

**Opening hours are structured, in `partner_hours`, one row per weekday.** They
were free text until the dispatch board started sending bags to a laundromat and
needed to answer "are they open at three on a Tuesday". **A weekday with no row
is CLOSED** — absence has to mean closed rather than unknown, because a routing
decision resolves to yes or no and "we never filled it in" is not something a
van can act on. Several rows on one weekday is a split shift, so a laundromat
that shuts for lunch can say so, and a time counts as open if it falls in any of
them. The containing test is end-exclusive: arriving at the exact closing minute
is arriving after they closed. `partners.hours` survives as the free-text note
for a person — "call ahead on Sundays" is worth keeping and is not something to
route by.

**`orders.partner_id` records which laundromat had the bag**, set when the
driver drops it off. Without it there is no way to answer "is one partner's
scale consistently heavy", which is the whole reason for asking them to weigh
it. There is no separate discrepancy table — that column joined to `weight_lb`
and `partner_weight_lb` IS the history, and a copy would only be a second thing
to keep in step.

**Routes under `/ops/partners/:id` fall through when the id is not a UUID.**
Express takes the first route that matches, not the most specific, so
`/ops/partners/enquiries` was being read as a partner called "enquiries". Guard
the param rather than relying on the order the routes happen to be written in.

**The laundromat weighs each BAG, and the comparison is total against total.**
`orders.partner_weight_lb` was a single column, so a three-bag order had one
place to put a partner's figure — typing a weight against bag 1 set it for the
whole order and bag 2's page showed the same number back as though it had been
weighed too. It lives on `bag_labels` now; the order column is the **sum**, and
is only written once every bag has been weighed. **A half-weighed order must
never be compared against a full one** — that flags every laundromat as light.

**A bag cannot be weighed before it is handed over.** The form is absent unless
the order is `AT_PARTNER`, and the route refuses it too. That second check is
the only real one: this is the page with no login at all, so a hidden form whose
route still fires is not a guard.

**The partner's weight is a cross-check, and ours is the one that bills.** A
laundromat may enter its own figure on the QR page; **`partner_weight_lb` is
never read by the pricing code**. Ours bills. (The scale photo that used to be
required alongside it is gone — see above.)

**The tolerance is the larger of a fixed amount and a percentage** —
`TOLERANCE_LB` or `TOLERANCE_PCT` of the bag, in `src/core/partners.js`. It has
to be both: a flat 2 lb is far too tight on a 60 lb load where a 3 lb gap is
ordinary, and a flat 5% is far too loose on a 10 lb one. Past the tolerance an
issue is raised. **The per-bag flag is not the real detector** — a partner
running 1.9 lb heavy every single time never trips it, so the partner page also
shows average drift and how many of their bags read heavier than ours. Wiring their number into `price_cents` removes
the control Neil asked for.

**The day has three legs and they are in that order for a physical reason.**
Collect dirty bags off doorsteps, visit the laundromat, deliver clean bags back.
You cannot drop bags you have not picked up, and you cannot deliver laundry you
have not collected from the laundromat. Sequencing the whole day as one
travelling-salesman problem gives a shorter route that cannot be driven, which
is worse than a longer one that can — so each leg is solved on its own and the
legs stay in order.

**Which laundromat a bag goes to is nearest-first, skipping anyone shut or
full.** Neil's call: a partner at capacity is routed around rather than blocked
at, because a driver holding a bag at a loading dock needs somewhere to put it,
not an error message. **Capacity that was never entered is unknown, not zero,
and does not disqualify anybody** — refusing a partner over a blank form field
would quietly take the only laundromat we have out of service. The page shows
every partner that was passed over and why, because an unexplained name is not
a decision anybody can check.

**How much is at each laundromat is a query, never a running total.** A bag is
at a partner when its order says so and its weight is on the order, so
`orders` IS the ledger; a counter in a column would be a second version of the
same fact and the two would disagree the first time anything went wrong.
`AT_PARTNER` and `READY` both count — a finished bag we have not collected is
still on their floor. Bags dropped off before they were weighed are counted
separately rather than as zero pounds.

**`/ops/routing` also answers "can we take this one".** Cheapest insertion of a
pickup into today's run: where it slots, minutes added, cost, and whether it is
under `routing.autoAcceptUnderMinutes`. Three rules it must keep:

- **Never re-sequence a run that is already physical.** Bags are in the van with
  numbers on them, so the van IS the route. A new stop is spliced into the
  remaining sequence and nothing else moves.
- **Pickups only.** A delivery needs a bag that is already on the truck. There is
  no path for a customer to request a delivery slot.
- **Auto-accept never fires on a stop that loses money**, however short the
  detour — a threshold that waves through a loss is worse than no threshold.

It writes nothing. `GET` with the address in the query string on purpose, so it
is safe to refresh and safe to send to somebody.

**Today's run is deliveries in the van PLUS today's uncollected pickups.** The
load-out pass sequences by scanning bags, and a pickup has no bag to scan, so
pickups were in no run at all — a quote against a delivery-only run measures
against half a day's work.

**The wage is per person**, in `ops_users.wage_cents_hour`, set on their profile
and falling back to `config.routing.wagePerHour` when blank. Two drivers are
rarely paid the same, and a margin is only worth reading if it uses what that
particular round actually costs.

**Grossed and Expected are two different questions and must never be added.**
Grossed is what has been **charged at a door today** — a delivered order that
declined is counted separately and is not cash until it is cash. Expected is
**weighed but not yet delivered**: money the scale has already decided on,
sitting in a laundromat or in the van. **An unweighed pickup is in neither** —
its weight is a guess, and a guess does not belong in a figure called cash.

**The margin on the routing board is a CONTRIBUTION MARGIN, not profit**, and
the page says so. Revenue minus the wash, the van, the wage and the card fees.
Insurance, the phone, the software and Neil's own time are not in it.

Two things it used to get wrong, both in the flattering direction. **The wage
was only counted while the van was moving** — it lives inside `perMile()`, so
four minutes at a door and ten at a laundromat were free; on one nine-stop
afternoon that was $14 of a $22 "margin". And **revenue counted only bags
already on a scale** while the driving cost covered the whole route, so a day of
mostly collections looked like all cost and no income. Now every paid minute
counts, and a pickup contributes what it is expected to bill using the same
weight estimate the router uses for capacity.

**The cost model lives in `config.routing`**, env-overridable. A mile is about
$1.17 and roughly 70% of that is the driver's wage, which is why every answer is
in minutes first and miles second. Straight-line distance times a road factor —
the planner uses a real routing service, dispatch deliberately does not, because
a driver waiting on a network call to find out whether to take an order is worse
than a rough answer now.

**Today's route is solved from WHERE THE VAN IS, not where it started.** It
was always measured from the home base, even at three in the afternoon with the
driver standing in Glen Rock — a plan made at six in the morning and
redisplayed. `currentPosition()` is the last stop he actually finished: the
customer's door he collected or delivered at, or the laundromat he dropped at.
`base` is what everything is measured from now; **`home` is still where the day
ends**, so both are kept and the trip back is to `home`.

**There is no phone tracking and there should not be.** His position is derived
from work he has completed, which the system already knows. Following a driver
around all day is a thing we would then be holding.

**A future day is solved from the base**, because it has not started. The page
says which of the two it used — "9.4 miles" means different things measured from
a depot and from wherever the van is parked.

**The load-out pass turns the van into a sequence.** Scan every bag out of the
laundromat, build the run, load in REVERSE — highest stop deepest, stop 1 by the
door. At the door the scan is a confirmation, not a search, and a multi-bag
order will not complete until every bag has been scanned. Stop numbers are
cleared on delivery: they describe one afternoon, not the order.

**The camera is an accelerator, never the mechanism.** Every scan field is a
plain text box in a plain form. `BarcodeDetector` fills it where it exists, and
the button is hidden where it does not — which includes every iPhone. Never use
the HTML `hidden` attribute on a `.btn`: the class sets `display` and beats it,
so the button renders and does nothing.

**`/ops/journey` is the physical walkthrough, and `/ops/process` is the map.**
They cover the same business and are deliberately not the same page: journey is
one bag in the order the steps actually happen, process is organised by
perspective — the customer, the driver, the laundromat, the money, the AI, the
technology. A change to the physical sequence goes in journey; a change to how
the system is built goes in process; a change to who does what goes in both. The
header comment in `src/web/journey.js` says the same thing to whoever opens it
first. Both carry a reviewed date and both read their figures from the running
system.

**`/ops/process` explains the service and must be updated with it.** It is the
page you hand a new driver: what LYNDRY is, what the customer, the driver and
the laundromat each do, how the money works, and what the technology is. It is
the only ops page with no permission beyond being signed in, because it holds
no customer detail and no wholesale figure.

Most of it is **read from the running system** rather than written down twice —
the price, the minimum, the turnaround, the windows, the order states and which
of them text the customer (`STEPS[].texts`), the AI's tools and model, the role
table, and whether Stripe is off, in test or live. Those cannot drift. **The
prose can**, so it carries a reviewed date in `src/web/process.js`. Changing how
the service works means correcting the affected section and bumping that date,
in the same commit. A process document that is wrong is worse than none,
because people act on it.

**The menus group by the question a screen answers, not by what kind of thing
it is.** "Dashboard" was a grab bag — a board, a scanning task, a message list
and a problem queue — and Routing, which is the live day, sat under Tools beside
two what-if calculators.

| Menu | The question |
|---|---|
| **Today** | What is happening right now: Your round, Orders, Routing, Load the van, Issues |
| **People** | Everyone you deal with: Customers, Conversations, Team, Partners |
| **Business** | What you set up and what it earns: Taking orders?, Promotions, Text blast, Bag tags, Unit economics, Route planner |
| **Resources** | How it all works, What happens to a bag, What we send a laundromat |

**Pre-launch lives under Business**: Taking orders?, Promotions, Text blast,
all behind `service.manage` (Admin only). Closing the business, giving money
away and texting everybody at once are three things a driver or a salesperson
should never be able to do.

**The switch is not a feature flag.** `app_settings.taking_orders` changes what
the AI says AND what `bookPickup()` will do, and the second half is the one
that matters: the prompt asks, the code refuses. Same split as the service
area, because a model asked nicely not to book will eventually book. It shuts
the text thread, the website form and the standing-order job together.

**`ALWAYS_BOOK_NUMBERS` is exempt from the switch, and from the county.** Neil
has to be able to put an order through while the service is shut and from an
address outside Bergen — that is how the thing gets tested end to end and how he
takes a favour for somebody he knows. Blank falls back to `SUPPORT_PHONE`.

It waives exactly two rules, and both are decisions about *who we choose to
serve* rather than facts a booking needs: the closed sign and the boundary. An
address, wash preferences, a card and a real date are still required of him.
**The AI is told the same thing**, so it cannot refuse in the thread something
the code behind it would allow — the same sentence-versus-code gap that once
read a passed pickup window straight back to a customer.

**Its absence is completely silent, so it is said out loud twice** — a startup
warning, and a line on `/ops/settings` where the closing actually happens. An
exemption nobody can see is one you discover by trying, on the day it matters.

**THE CLOSED SIGN IS CHECKED IN FOUR PLACES AND ALL FOUR HAVE TO KNOW** —
`booking.bookPickup()`, the AI's prompt in `brain.js`, the tool replies in
`actions.js`, and the canned welcome in `onboarding.js`. Only the first two
were taught first, and Neil's own number then walked the entire setup, said
"good to go", and got "we're not booking pickups just yet" from a tool result.
`actions.js` and `onboarding.js` write those sentences **in code**, which is
exactly why no prompt could ever have stopped it — and exactly why they each
have to be taught separately. Anything new that reads `settings.takingOrders()`
in a customer path has to call `booking.alwaysAllowed()` beside it.

**Turning it OFF takes a reason; turning it ON takes nothing.** Neil's call, and
the reason is cleared on reopening so a stale one cannot surface the next time
somebody pauses without typing one. The AI works the reason into its own
sentence rather than reciting it.

**A closed service shows a banner on every ops page**, like the issues one. The
switch lives on a screen nobody visits daily, and an owner who forgets it is off
reads an empty board as a quiet week rather than a shut shop.

**The AI never invents money, and promotions do not change that.** It is handed
the promotion's `blurb` - a sentence a person wrote - and may repeat it once. It
cannot create one, decide who qualifies, or work out what anything costs. Code
grants, code redeems, code discounts. Same rule as `open_locker()` taking no
arguments.

**A grant is a promise to a person**, so `customer_promotions` is separate from
`promotions`. Ending a promotion stops new grants and never withdraws it from
somebody already told they had it.

**The discount comes off AFTER the minimum.** Taking 20% off an 8 lb load's $16
and then flooring at $25 would charge the full minimum and hand the customer
nothing while the order claimed a promotion had been used. And the price text
names what came off - a total lower than the arithmetic the customer can do
themselves reads as a mistake unless the reason is in the same message.

**Only one promotion is auto-granted at a time**, enforced by a partial unique
index, and creating a second stands the first down rather than failing. Two
would both attach to a new number and the order of application would silently
decide what somebody got.

**A text blast never includes an unsubscribed number.** They are excluded in the
query rather than filtered afterwards, so a number that replied STOP never
reaches the sending loop. Sends are one at a time: a burst reads as spam to a
carrier, and `notify.js` logs each one as it goes, so a failure halfway through
leaves an accurate record of who actually got it.

**The canned welcome knows whether we are open.** It goes out before the AI ever
sees the conversation, so it is the one reply that cannot work out for itself
that we are shut - and inviting somebody to book something that will then be
refused is a worse first impression than saying so. With a promotion attached it
drops the sales pitch entirely: they typed their number into the home page
thirty seconds ago, so the price is the page they are still looking at, and
keeping both put it over one segment.

**Issues sits under Today**, not with the people it happens to be about. An open
issue is something happening now that is stopping an order moving, so it belongs
beside the board it is blocking. It is called **Issues** — "Needs a person" was
a description of the queue rather than a name for it, and the red banner on the
board still uses that phrase because there it is a sentence.

**Partners sit under People.** Neil's call: a partner is a relationship with a
person, not a setting, and it was filed next to two what-if calculators.

**Names say what a screen is, and the page title matches the menu entry** — a
nav that calls something one thing and a heading that calls it another is a nav
you cannot trust. "Load out" was jargon; "Routing" and "Planner" were
indistinguishable until one of them said *route*; "Messages" undersold a screen
whose point is the people who never became customers.

**The ops nav is four `<details>` menus, not a row of tabs** — Today, People,
Business, Help, defined once in `OPS_MENUS` in `src/routes/admin.js`.
Ten flat tabs needed 556px on a 375px phone; four menus need 335px. Built on
`<details>` like the marketing hamburger, so **they open with no JavaScript** —
this is the chrome around a driver's action pages and a nav that needs a script
to open is a nav that can fail to open.

Every entry carries the permission that already guards its route, so the menu
cannot offer a screen its owner would be refused at, and **a group with nothing
left in it disappears** rather than opening onto nothing. Adding a page means
adding it to `OPS_MENUS` as well as adding the route and its `may()` guard.

**Two credentials, for two kinds of caller.** Don't collapse them.

| Caller | Credential |
|---|---|
| A person, in a browser | their mobile number, plus a code we text them |
| A script (`npm run driver`) | `ADMIN_API_KEY` in an `x-admin-key` header |

A script cannot receive a text, which is why the machine key stays.

**People live in `ops_users`, one row each.** A driver who leaves gets
`DISABLED`, which takes effect on their next request — `requireAdminPage`
re-reads the row every time rather than trusting the cookie for 30 days.
Deleting them would lose the record of who did what.

### Roles

**`src/core/roles.js` is the whole answer to "who can see what."** If you find
yourself writing `if (user.role === 'ADMIN')` in a page, stop and add a
permission there instead — role checks scattered through templates are how a
screen ends up showing a driver something it shouldn't.

| | orders | customers | messages | partners | team | money |
|---|---|---|---|---|---|---|
| **Admin** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Driver** | ✓ | — | — | — | — | — |
| **Sales** | ✓ | ✓ | ✓ | ✓ | — | — |

**The conversations screen is grouped by phone number, not by customer,** and
that is the point: a message from someone with no account is still logged
against their number, so this is the only screen that shows people who texted
once and never signed up. Grouping by `customer_id` would hide exactly the rows
worth reading. `messages.view` is separate from `customers.view` because a
thread holds things a person said to what they thought was a person.

Every page takes two middlewares: `guard` proves who you are, `may('...')`
proves you're allowed. **Adding a page means adding both.**

**`money.view` is separate from `orders.view`** so a driver can work the round
without seeing the books. Prices are left out of the markup entirely rather
than hidden with CSS — a value that never reaches the page cannot leak from it.

## The guided run

**`/ops/run` is the only screen a driver needs.** Everything else in `/ops` is
something you read; this is something you act on. It shows **one stop and one
thing to do**: where to go, a button that opens the maps app, an "I'm here"
button, then the single next task, then the next stop.

**One stop, not a list with the current one highlighted.** A list invites
reading ahead, and reading ahead on a doorstep is how the wrong bag reaches the
wrong house. What is behind and ahead is a count, not a list.

**Nothing here is a second way to change an order.** Every control posts to the
same routes the order page posts to, which call `src/core/fulfilment.js`.
`src/core/run.js` works out *what is next* and nothing else — the moment it did
a step itself the two front doors would drift. `?from=run` on the form action is
the only difference, and it decides where you land afterwards.

**Where he is in the run is derived, never stored.** `stopDone()` reads the
order. A driver who uses the order page, the JSON API or a second phone is still
at the same point, because the run is a *reading* of the orders rather than a
thing kept alongside them.

**`orders.arrived_at` is the one exception, and it is a flag, not history.** It
means "the driver is at this order's next stop right now". The same order is
arrived at several times in its life — the door to collect, the laundromat to
drop, the door again to deliver — so one column cannot hold three arrivals.
**Anything that completes a stop clears it**: `AT_PARTNER`, `DELIVERED` and
`CANCELED` in `orders.transition()`, and recording a weight in `fulfilment.js`.
`IN_PROCESS` deliberately does not, because the scale comes after "in the van"
at the same door. If lasting arrival times are ever wanted, that is
`order_events`.

**A collected bag that has not been weighed is still at the door.** Leaving
`IN_PROCESS` orders out of the collect leg made the stop vanish the instant the
driver tapped Collected, taking the weighing with it — he drove off with a bag
nobody had weighed and no screen asking him to. It also cannot go to a
laundromat yet: the weight has to be ours.

**A stop at the same address as the finished one before it starts already
arrived.** Every laundromat visit is two stops at one door — hand the dirty over,
take the finished — and asking him to navigate to where he is standing is
nonsense. It covers two customers in one building too.

**The run needs today's finished stops as well as the outstanding ones.** The
routing board is built from live queries, so a stop disappears the moment it is
done — right for "what is left", useless for "where am I". `doneToday()` is what
makes the progress bar move and what lets the page know the last visit was at
this address.

**The maps button is a plain `https://maps.google.com/?q=` link**, not a `geo:`
or `maps://` scheme. Those open a native app directly and do nothing at all on a
phone without that app, and a dead button on a doorstep is worse than one extra
tap.

**Collecting finished bags back off a laundromat is the load-out pass**, and the
run links to `/ops/loadout` rather than reimplementing it. Two ways to do one job
is how they drift.

## Drivers

**A driver works out of somewhere, and an order belongs to one of them.** The
system ran for a long time on the unstated assumption that there was exactly one
driver: the route started at a single hardcoded point in `src/core/geocode.js`
and an order knew who had collected it only afterwards, as a name in
`order_events`. `src/core/drivers.js` is where that assumption was made explicit
and then removed.

**The home base is an address on the person's row**, geocoded through the same
rate-limited lookup as a customer's and a partner's. **Blank falls back to the
service base** — which is what every route used before this existed, so nothing
breaks on the day a driver is added and their base is not filled in yet. Fair
Lawn is not Maryland, and a route solved from the wrong start point is wrong
from the first mile.

**An order is assigned automatically to whichever active driver's base is
nearest, and is reassignable by hand.** The automatic answer knows about
distance and nothing at all about who is off sick, who is already carrying a
full van, or who is better with a difficult building — so it is a starting
position, not a verdict. `drivers.assign()` never moves an order that already
has a driver, so an automatic pass can never quietly undo a human decision.
`npm run assign` backfills; it is a dry run unless given `--write`.

**`orders.driver_id` is nullable and that is a real state, not a gap to tidy
away.** Nobody has a base set, every driver was disabled, the geocoder was
down. The board shows unassigned orders in their own red banner rather than
hiding them, because **an order nobody owns is exactly the one that does not get
collected**.

**Where a driver is up to is derived, never stored.** `progressOf()` reads the
timestamps already on the orders — `collected_at`, `delivered_at`,
`stop_number`. A progress column would be a second copy of the same fact and
would go stale the first time somebody used the JSON API instead of the buttons.
Same rule as the partner load.

**A driver sees their own round and nobody else's.** Filtered in the query, not
after it, so another driver's stops never reach the process — the same reason
prices are left out of the markup rather than hidden with CSS. **The board, the
order page and every action route each check it**, because a board that hides a
stop while the route behind it still fires is not access control. An *unassigned*
order stays open to everybody on purpose: it is the one most likely to be
missed, and locking it away from whoever is nearest helps nobody.

**Reassigning is behind `customers.view`, not `orders.act`.** A driver can work
an order but cannot hand it to somebody else — that is a scheduling decision,
not a step in the round. Every move is logged as a `DRIVER` event, because "who
was supposed to collect this" is exactly the question asked after one goes
missing.

**A driver is shown the stop, not the customer.** The order page and the board
give them where, when, how to get in, where the bag is, how many and what it
weighed — and nothing else. No name, no phone, no thread, no change log, no
money. **The address is the one personal detail that survives**, because you
cannot drive to a stop without it; it is the first row of the details card and
it is the board's second column in place of the name.

This is enforced by permissions, never by a role check in a template —
`customers.view` hides the customer card and the name in the heading,
`messages.view` hides the thread, `money.view` hides the payment badge, and
`orders.audit` (Admin and Sales) hides the change log. **The name in the page
heading and the payment badge beside it are the two that get missed**: locking
down every card below still leaves an `<h1>` naming who lives there.

**`/ops/process` is scoped the same way.** Each section carries a role list and
both the sections and the contents list are filtered, so a driver is never sent
the money, the AI internals, the vendor list or the permission table — and the
page says whose view it is. What we pay a laundromat is the one wholesale figure
that would otherwise reach it. Adding a section means deciding who it is for.

**`orders.drive` is the one permission a role does not decide on its own.**
Doing a driver's job and *being* a driver are different things: an admin holds
`orders.act` because correcting a fat-fingered weight is admin work, and the
driver pool used to be filtered on exactly that — so orders were assigned to
whoever was sitting at a desk. A **Driver** has `orders.drive` by role. An
**Admin** has it while they have switched themselves on to the round, from the
Team page, because the owner drives some days and not others. **Sales** never
does. The check lives in `can()` in `src/core/roles.js`, which is where role
logic belongs — never in a page.

Everything about rounds keys off it: the home base field, the assignment pool,
the round strip on the board, the driver picker on Routing, and `/ops/run`.

**Taking somebody off the round moves their work.** Their open orders are
reassigned to the nearest remaining driver, or left unassigned and shown in the
red banner if there is nobody left. An order still pointing at somebody who no
longer drives appears on no board and gets collected by nobody, which is the
exact silent gap `driver_id` exists to close.

**New people default to `DRIVER`**, the least privileged role, and an
unrecognised role posted to the form falls back to it too. Promoting is
deliberate.

**A person is edited on their own page, `/ops/team/:id`, in one form with one
save.** It replaced four separate routes — role, status, driving, home base —
each of which was a control wedged into a table row, and none of which could
edit the two things most likely to be wrong: a name and a phone number. A typo
on either meant deleting the person and starting again, which loses the record
of what they did. The list is now a list.

**Nobody can change their own role or switch themselves off.** Both would let
an admin lock themselves — and possibly everyone — out of team management. The
form hides both and the route refuses them anyway, because a hidden control
whose route still fires is not a guard.

**Saving a profile only re-pins the home base when the address actually
changed.** It used to null the pin on every call, which was harmless while it
had its own button: now that it is part of saving a whole person, correcting a
typo in a name would have thrown their location away, spent a geocoder request
putting it back, and left them routing from the service base in between.

**The `x-admin-key` machine credential bypasses roles entirely.** It is our own
scripts, it has no person attached, and it gets everything.

**The code is never stored.** `ops_login_codes` holds an HMAC of it keyed with
`ADMIN_API_KEY`. Six digits is small enough to brute-force offline, which is
exactly why the plaintext never lands in a row and why five wrong guesses kill
a code regardless of its expiry. Codes are single-use and last 10 minutes.

**The sign-in pages are `no-store`, and that is not housekeeping.** A cached
sign-in form is served to somebody whose session is in fact still alive; the
moment they submit it the next page sees a valid session and waves them
through, which looks exactly like the code step being skipped. It was reported
as one. Submitting a number while already signed in also must not text a code
and write a credential row the next page then swallows.

**The sign-in page must never reveal whether a number is registered.** An
unknown number gets the identical "check your phone" response. Otherwise
`/ops/login` becomes a way to find out who works here.

**The session cookie is not a credential.** It is `userId.expiry`, signed with
`ADMIN_API_KEY`. A leaked cookie expires on its own and never held a secret.
**Rotating `ADMIN_API_KEY` signs everybody out instantly** — that is the
emergency lever if a phone goes missing.

**Dummy drivers, vans and a whole day of orders, for trying things out:**

```bash
npm run seed:team -- --write
npm run seed:demo -- --write
```

`seed:team` first — the demo orders are assigned to those drivers.

One driver with one van, based in Fair Lawn — roughly the middle of Bergen
County, so nowhere in the county is far from it. That is the business as it
actually is, and seed data that pretends otherwise makes every screen read
wrong: a round spread over three counties is not a round anybody drives. Adding
a second entry to `TEAM` in the script is all it takes to test multi-driver
assignment again; give them a base elsewhere in the county so nearest-base has
something to distinguish.

**Their numbers are in the 555-0100 range reserved for fiction**, so nothing can
text a real person and nobody can sign in as them — they exist for the boards,
the routing picker and the assignment. `-- --clear` removes them and puts their
orders back in the pool.

`npm run seed:partners -- --write` adds six laundromats across Bergen County,
from Glen Rock down to Carlstadt, with rates, capacities, turnarounds and cutoffs that genuinely
differ, so cheapest, nearest and fastest are rarely the same place. **The names
are invented and every row says so in its notes** — a plausible laundromat name
with a wholesale rate beside it gets read as a signed deal within a week, and
nobody has signed anything.

`npm run seed:week -- --write` is the busy version: 40 customers across 12
towns, ~50 pickups roughly hourly over four days plus deliveries going back out
today. For seeing how routing copes with density rather than six stops. It sets
coordinates directly rather than geocoding — forty lookups through a free
rate-limited public service for test data is not a reasonable thing to do to
somebody else's server.

`seed:demo` builds a day with something at every stage: pickups waiting, a bag
in the van, one at a laundromat, one finished and waiting for the load-out pass,
one out for delivery with clips on, and two delivered — one paid, one not. Plus
a message thread, an open issue and a standing order, so the conversation,
issues and customer screens are not blank either. **States are written directly
rather than through `fulfilment.js`**, deliberately: fulfilment sends texts and
charges cards, and a seed script must do neither.

**The laundromat demo is `npm run demo`, and `npm run demo -- --clear` after.**
It builds one three-bag order sitting at a partner and prints three links, so
an owner can point their own phone at a sticker and see the page they would
actually use. It is the real page from real rows - a mock-up cannot prove "this
is all you ever have to do".

**It lives in production deliberately**, because CLAUDE.md rules out a second
deployment target and a demo server drifts the first time somebody forgets to
deploy it. What makes that safe is the fictional number: **`notify.js` now
refuses to hand any number in the 555-0100 to 555-0199 range to the carrier**,
so nothing seeded can text a real person however far it is driven. That guard
did not exist before and every seed script was relying on luck.

**The three codes are fixed** — `DEM001`, `DEM002`, `DEM003` — so a sticker
printed once keeps working. `--clear` blanks them rather than deleting them.
The script prints **lyndry.com** links even when run locally, because the
person scanning is on their own phone and a localhost QR is the demo failing at
the first step.

**Bootstrap the first person from the terminal** — signing in needs a row, and
adding a row needs somebody signed in:

```bash
npm run ops:user -- add "Their Name" +12015551234
```

**Nobody can switch themselves off.** The Team page hides the button and the
route refuses it anyway; it is the one action that can lock everyone out of a
tool with no other way in.

**When a code can't be texted it is written to the server log** — and only
then. Carrier registration is still pending, so without that the dashboard
would be unreachable; the log is the way back in. It is never written to the
`messages` table: a live credential does not belong in a database row.

**`src/routes/admin.js` must stay mounted before `src/routes/ops.js`** in
`index.js`. The API router blocks everything under `/ops`, so if it ran first
nobody could reach the sign-in page.

**Every ops page is `noindex` and `/ops` is disallowed in robots.txt.** They
carry names, phone numbers and home addresses.

**Anything from the database goes through `escapeHtml()`** before it reaches an
ops page, exactly as on the public forms. A customer's name is untrusted input.

**`?next=` on the sign-in page only accepts paths starting `/ops`.** Without
that check the sign-in page becomes an open redirector, which is a ready-made
phishing link on our own domain.

Throttles, all in-memory: 5 codes per number and 15 per IP per 15 minutes, and
20 verification attempts per IP. They reset on restart and are per-instance —
fine for one small server, and they must move into the database if this ever
runs on two.

## Payments

**No card number is ever stored, logged or received by this system.** Stripe
holds them. What we keep is Stripe's *reference* to a saved card (`pm_...`),
plus the brand and last four digits for display. Accepting a real card number
anywhere in this codebase would put the business inside PCI DSS. Don't.

**Stripe lives behind `src/providers/payments/`,** exactly like Telnyx. Nothing
outside that folder may import the `stripe` package or know what a
PaymentIntent is. `src/core/billing.js` decides *when* money moves; the
provider knows *how*.

**Claude never touches money.** The AI works out that someone wants a pickup.
Code works out whether they have a card, whether to send a link, and when to
charge. This is the same rule as `open_locker()` taking no arguments — no
amount of clever texting should move a charge.

**The price is set at `/ops/weight` and the card is charged at `/ops/delivered`.**
Two authorisations are on record by then: the consent given on the Stripe page,
and the booking confirmation naming the card. There is no third "reply YES to
pay" step, on purpose.

**The gap between the two is deliberate and load-bearing.** The scale is the
first moment an amount exists, but the bag then goes to a laundromat that may
read the weight differently. Charging at the scale — which it briefly did —
meant the money had already moved by the time a disagreement surfaced, leaving
only a refund or an awkward conversation. Charging at the door leaves the whole
turnaround as a window to sort it out, and the customer pays when they have
their laundry back.

**The card is charged exactly once per order, at the door, and booking takes
nothing.** For
a while there was a $25 minimum collected at booking with the balance taken on
delivery — two charges, two idempotency keys, two things to refund, and a
customer watching money leave before anybody had touched their laundry. It is
gone. **The minimum is a floor on `price_cents`, not a payment**: an 8 lb load
costs $25 and is billed in one go with the rest. `deposit_*` and
`refundDeposit()` survive only because two real orders were taken under the old
rules and their money has to stay refundable; nothing writes a new one.

**A booking is confirmed by having a card on file, not by a cleared payment.**
That is what keeps an unbillable order off the driver's run sheet. The order is
still written *before* the card is asked for — a customer sent away to pay
before their booking exists comes back to nothing, which happened to a real one.
Saving the card confirms it automatically from the webhook.

**A declined card never holds up a delivery.** We deliver and chase by text.
Holding someone's clothes over a decline is a bad look and legally murky; the
exposure is one order.

**The idempotency key must include the attempt number.** Stripe caches the
result of a key — including a decline — so a key of just order + amount would
replay "declined" at a customer who has since fixed their card.

**Links we text are always on lyndry.com.** `/pay/<token>` redirects to the
Stripe page. Never text a `checkout.stripe.com` URL directly: carriers score a
texted link partly by its domain, and every link should be on the domain
registered to the brand. Same reason as the delivery-photo links.

**The Stripe webhook must stay mounted before `express.json()`** in
`src/index.js`. Its signature covers the raw bytes, and a body parser destroys
them. That ordering is load-bearing.

**Test mode is decided by the key prefix alone.** `sk_test_` is a sandbox,
`sk_live_` moves real money. There is no separate switch. `/health` reports
which one is live.

## State machines — enforce these in code

**Orders.** An order must not skip states.

```
REQUESTED -> ASSIGNED -> DEPOSITED -> IN_PROCESS -> OUT_FOR_DELIVERY -> DELIVERED
                                          |                ^
                                          v                |
                                     AT_PARTNER -> READY --+
```

`ASSIGNED` and `DEPOSITED` are the locker path and are unused at launch.
Residential orders go `REQUESTED -> IN_PROCESS` when the driver collects.

**The partner leg is optional.** `IN_PROCESS` means the bag is in the van and
ours; `AT_PARTNER` means it is at the laundromat; `READY` means the partner has
finished and it is waiting to be collected again. A bag we wash ourselves goes
straight from `IN_PROCESS` to `OUT_FOR_DELIVERY`, so the machine never forces us
to invent a partner visit that did not happen.

**`AT_PARTNER` and `READY` are the two status changes that do NOT text the
customer,** and that is deliberate. "Your laundry is at our partner laundromat"
says something about how the business is run rather than about their order, and
two more texts per order is real money and a worse complaint profile for
information nobody asked for. They still get collected, weighed-and-priced, out
for delivery, and delivered.

**Weighing is an event, not a state** — the same way unlocking a locker is. It
can happen at any point while we hold the bag, and it is what turns an estimate
into a price.

`CANCELED` is reachable only before the laundry is in our hands — before
`DEPOSITED` on the locker path, before collection on the residential path.

**Lockers.** Unlocking is an *event*, not a state.

```
AVAILABLE -> ASSIGNED -> OCCUPIED -> AVAILABLE
```

Plus `OUT_OF_SERVICE`, set manually.

## SMS rules

- Verify the Telnyx webhook signature. Reject anything unsigned.
- Check `provider_message_id` against the `messages` table and drop duplicates.
  Carriers retry; this is what stops a text being acted on twice.
- Return HTTP 200 **immediately**, then call Claude and reply asynchronously.
- `STOP` / `UNSTOP` / `START` / `HELP` are handled in code, before Claude sees
  them. These are legally required and must never depend on an AI reading them
  correctly.
- Unknown number → onboard them in the thread, via `src/core/onboarding.js`.
  Do **not** send them to a web form; that was the old behaviour and it is gone.
- Log every message, both directions.

**Onboarding happens over text, and the only two things asked for are a name
and a street address.** Not email, not preferences, not a unit number they
didn't mention. `save_details` takes the whole lot in one tool call, because
somebody answering "what's your name and where should we collect from?" replies
with all of it in one message — and asking them to confirm it back field by
field is the phone tree this product exists to avoid. Wash preferences keep
their defaults and are changed by texting.

**There are three ways to consent, and which one it was is recorded** in
`customers.sms_consent_source` alongside the timestamp and IP. An audit asks
*how* consent was obtained, not just whether it was.

| Source | What the evidence is |
|---|---|
| `WEB_HERO` | The phone field on the home page. Ticked box, timestamp, IP |
| `WEB_SIGNUP` | The full signup form. Same box, same evidence |
| `INBOUND_TEXT` | They texted first. Their own message in the `messages` table |

**The consent checkbox wording appears in three places and must stay identical
in all of them** — the home page hero, `/signup`, and the blockquote on
`/sms-terms`. A carrier comparing them expects one sentence. They drifted once
already and the terms page quoted wording no form had ever shown.

**`POST /start` sends a text to a number a stranger typed.** That cannot be
designed away, only contained: the box must be ticked, the number must parse,
an opted-out number is refused outright, and there are throttles per number and
per IP in `src/core/throttle.js`. Every outcome returns the same 303 to
`/start/sent` — telling the visitor "that number has opted out" would turn the
home page into a way of finding out who is a customer.

**Every outbound text is plain ASCII.** SMS has two encodings: the basic GSM
alphabet fits 160 characters in a segment, and *one* character outside it forces
the whole message into UCS-2, where a segment is 70. So a single em dash, curly
quote or emoji can turn one text into three, and carriers bill per segment.
Worse, heavy Unicode and emoji are a spam signal in 10DLC scoring, and a
filtered message never arrives at all.

Write messages with plain hyphens and straight quotes. `src/core/notify.js` is
the single choke point every text passes through: it swaps typographic
characters for their ASCII twins before sending *and* before logging, so the
`messages` table records exactly what was sent, then warns about anything left
that has no plain equivalent. The swap exists because Claude writes the reply to
any question and reaches for en dashes however firmly the prompt asks it not to.

Em dashes in comments and on web pages are fine and are the house style. This
rule is only about text messages.

## Business facts

- **Service:** wash, dry and fold only
- **Price:** $2.00 per pound, weighed after pickup. The one source of
  truth is `pricing.perPoundCents` in `src/config.js`; this line is a
  description of it and drifted from it once already
- **Turnaround:** next day, and the clock means it. A bag is due back by the
  end of the day after collection — the end of the last pickup window, derived
  from `PICKUP_WINDOWS` so changing the windows moves the promise. It used to
  be a flat 24 hours from collection, which gave two customers on the same
  round deadlines eight hours apart and matched nothing either was told
- **Scheduling:** pickup whenever the customer needs — no fixed route days
- **Model:** door-to-door pickup, for **houses and apartments alike**. An
  apartment customer puts their unit on `address_line2` and the driver comes to
  the door — nothing else differs
- **Lockers are shelved.** The hardware isn't working, so no locker is being
  built. The `lockers` and `buildings` tables stay (dropping them would be
  destructive and they cost nothing), `open_locker()` stays and refuses
  politely, and nothing on the website promises a locker
- **Service area:** **Bergen County.** The boundary CLAUDE.md used to say was
  undrawn is now drawn: `booking.inServiceArea()` checks a literal list of the
  67 Bergen ZIP codes in `BERGEN_ZIPS`. It was "New Jersey with an `07xxx` zip",
  which is most of the north of the state and far too wide for one van out of
  Fair Lawn. **A list rather than a clever test, because a county has no
  arithmetic** — it is long, boring, and checkable by a person, which matters
  because being wrong here turns away somebody we could serve.
  **The AI is told in as many words that it may not decide this** — never
  from the name of a town, never a list of towns we cover, never a yes
  before an address has been saved. Asked "do you come to Princeton?" a
  model will invent a yes, so it asks for the address and the code answers
- **Cancellation:** free until the driver collects; not cancellable after
- **Public contact:** neil@lyndry.com · (201) 554-1877 (the LYNDRY Telnyx
  number). **Neil's personal number is never published on the website** — it
  belongs in `.env` only, for `handoff_to_human`
- **Legal entity:** none, deliberately — not forming one until the concept is
  proven. Legal pages are sole-proprietor placeholders and need a lawyer

## Git

Local identity only for this repo (`neil perry` / `neil@careberi.com`). The
global git config is deliberately left empty — do not write to it.

## Booking on the website

`/account` is where a customer books a pickup without texting. Same phone-and-
code sign-in as `/ops`, kept in `src/core/customer-auth.js` — separate from the
staff one on purpose, so one bug can never hand a customer a staff session.

```
GET  /account                  current order, booking form, past pickups
POST /account/book             book a pickup
POST /account/reschedule       move it
POST /account/cancel           cancel it
GET  /account/login            mobile number  } the only two pages
GET  /account/login/code       six-digit code } reachable signed out
```

**A customer may name a time, and gets a window back.** `orders.pickup_time` is
the time they *asked for*, nullable because "tomorrow" with no time is a real
answer and must not be turned into one. What we promise back is the band it
falls in, from `PICKUP_WINDOWS` in `src/core/booking.js` — the single place
windows are defined, and the only thing to edit to change them:

| | |
|---|---|
| 6–9am | early, for somebody leaving for work |
| 9am–12pm | |
| 12–2pm | the short one — the lunch gap, where the run is thin |
| 2–5pm | |
| 5–9pm | the long one — when most people are home, so the most stops |

Roughly three hours each. The width is the point: a van doing a whole county
cannot promise a half-hour, and a window we miss is worse than a wide one we
keep. **Existing orders are never affected** — the window a customer was
promised is stored on the order rather than recomputed, so widening one is a
one-line change and never needs a backfill.

**The bands run back to back, so every boundary belongs to two of them and the
containing test is end-exclusive.** Somebody who says "noon" means the start of
the midday run, not the last minute of the morning one. The one exception is the
very last minute of the day, which has no window after it.

**The AI is handed which windows are still open today; it must never work one
out.** `booking.windowsToday()` computes it and the prompt states it plainly —
what is still bookable, what has gone, and which window an already-passed time
lands in instead. This is not decoration: at 11:43 one morning a customer asked
for 7am today and the recap read it straight back to them, *"today, 13 Aug at
7am"*, four hours after it had gone. **The booking code was right all along** and
would have put them in the midday window; it was the sentence that lied. Asking
the model to do clock arithmetic against a list of windows is asking it to be
wrong occasionally, and occasionally is too often for a promise about when a van
turns up.

**The weekday is given to the AI, never inferred from the date.** The same
recap called Thursday 13 August a Wednesday. Today's and tomorrow's day names
are stated in the prompt and it may only count forward from those.

**Somebody who names no time does not get the first window of the day.**
`DEFAULT_FROM` is 9am: the early window exists for people who ask for it, and
defaulting to it would quietly promise every silent customer a 6am knock.

This is **not** a menu of slots. There are still no fixed route days and no list
to choose from; the customer says when suits them, or says nothing, and the code
picks the band. Never offer them the list.

**Anything about "when" uses New Jersey's clock, via `booking.today()` and
`booking.nowInService()`.** Never `new Date().toISOString()` — that is UTC, and
from 8pm Eastern onward it has already rolled to tomorrow, which used to make
"pickup today" impossible every evening. Nobody caught it because nobody tested
after 8pm.

**`src/core/booking.js` holds the booking rules, and both front doors use it.**
The AI's `create_order` and the web form both call `bookPickup()`; each only
formats the result its own way. If they each had their own copy of the rules
they would drift, and the database would end up in a state neither expects.

**Customer sessions are signed with a key derived from `ADMIN_API_KEY`**, not
the key itself, so a customer cookie can never be replayed as a staff one.

**A customer's sign-in code is never written to the log**, unlike a staff one.
Staff can read the server log as a way back in; a customer cannot, so it would
be a live credential sitting in a log for nobody's benefit.

**Booking on the web still texts the confirmation.** The `messages` table stays
the single record of what a customer was told, however they booked — and the
wording itself comes from `booking.confirmationMessage()` / `rescheduledMessage()`
rather than being written out at each call site, so the two doors cannot produce
two different sentences for the same event. They already had, briefly.

**Nothing here writes an order status directly** — cancelling goes through
`orders.transition()` exactly as the ops endpoints do.

**Sign-in codes can send from a different number.** `LYNDRY_CODE_NUMBER`, if
set, is used as the `from` for sign-in codes only — that is where a short code
or a dedicated second number plugs in. Blank by default, which sends everything
from the main number: one number, one thread the customer can reply to.

**Only sign-in codes may use it.** Order confirmations and the AI's replies must
keep coming from `LYNDRY_PHONE_NUMBER`, because customers reply to those and a
short code is not where that conversation lives.
