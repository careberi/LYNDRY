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

The tools:

```
check_slot(pickup_date, pickup_time)
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

- **`check_slot()` RUNS BEFORE ANYTHING IS PROMISED, and it is not advice.** A
  customer was told "that's tomorrow's 8 to 10 window" four days before the van
  started running, because the model worked the date out itself. The prompt had
  been taught the opening date; a block further down headed "worked out for you,
  do not recalculate it" still described today's windows, and the model believed
  that one — correctly, since it claimed to be authoritative.

  So a day and a time now go through `booking.checkSlot()`, **the same function
  `bookPickup()` runs before it writes**: the closed sign, the opening date, the
  service area, the wash preferences, whether that day is already booked, and
  which window the time falls in. It writes nothing. There is no second copy of
  "is that possible" to drift, which is the rule the two front doors already
  follow everywhere else.

- **A LOOKUP ANSWERS US, NOT THE CUSTOMER.** `check_slot` returns facts rather
  than a sentence, so it must be followed by a second pass that writes the
  reply — `LOOKUP_ACTIONS` in `src/routes/sms.js`. Without that the customer
  receives a JSON object, because every action's return value is otherwise sent
  straight to the phone. If that second pass comes back empty, the facts carry
  their own sentence for every refusal that has one.

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

**A LOAD THAT DOES NOT RECONCILE CANNOT GO OUT, AND THE DRIVER CANNOT RELEASE
IT.** Six bags and 113.5 lb came back off a laundromat against 60.0 lb
collected, every named sticker present and ticked. The order page said plainly
that laundry does not get heavier in a dryer; the run sent the driver on to the
delivery anyway, because the check was advisory and nothing was gated on it.

`outForDelivery()` now runs `checkHandover()` and refuses. The driver's screen
**replaces** the laundromat card with a red one — the two weights, and the
office's number — with no control on it at all: not a disabled button, which
invites somebody to find the way round it, but nothing. All three doors refuse
together, the run, the order page and the JSON API, because a screen that hides
a control while the route behind it still fires is not a guard.

**Only an admin can release it**, through `orders.override` on the order page,
with a reason, recorded in `order_events` with their name on it and kept in
`orders.return_override_*`. **It releases, it does not correct**: no weight,
price or charge is touched, the numbers stay wrong and on the record, and the
issue stays OPEN — letting the van move is not the same as finding out where 53
lb came from.

**The named stickers do not replace this check, and the old comment saying they
did was wrong.** They are better than a total at saying WHICH bag is missing.
They say nothing about what is inside them: all six of those bags were ours, and
the extra 53 lb was not.

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
POST /ops/customers/:id/ask  text them for one thing we still need
GET  /ops/messages           every conversation, one row per phone number
GET  /ops/messages/:phone    one thread, oldest first, with delivery receipts
POST /ops/messages/:phone/ai who answers this number: the AI, or a person
POST /ops/messages/new       text a number that has never texted us
GET  /ops/issues             everything still waiting on a person
GET  /ops/scheduled          every text queued to send on its own
                             (reached from the Admin dashboard, not the menu)
POST /ops/scheduled/follow-ups/:phone   chase this number, or do not
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
GET  /ops/weights            how far two scales may disagree
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

**EVERY PICKUP IS REMINDED THE EVENING BEFORE.** Neil's ask: somebody books
on Saturday for Tuesday, and by Monday night the confirmation is four messages
up a thread they have not looked at - so the van arrives at a door with no bag
on it. `src/core/reminders.js` sends one text the night before saying when we
are coming and where to leave the bag.

**It is the evening before, not exactly 24 hours.** Neil said both, meaning the
same thing. A true per-order 24-hour timer needs a job queue, which CLAUDE.md
rules out, or a cron firing every few minutes, which is a lot of machinery for a
van that visits a door once a day. The evening before is also when somebody can
act on it - nobody puts a bag out at 6am because they were reminded at 6am.

**`orders.reminder_sent_at` is the one thing here that is stored rather than
derived, and it has to be.** "Did we already tell them" is a fact about
something we DID; the nearest derivation is searching `messages` for a sentence
that looks like a reminder, which breaks the first time the wording changes. It
is what makes the pass safe to run twice, which matters because Railway retries.

**Stamped AFTER the send, never before.** A stamp that went first would mark an
order reminded when the carrier was down, and nobody would ever be told.
Sent-but-unstamped is the safer failure: it costs one duplicate, and only if the
pass dies between the two lines.

**A STANDING ORDER IS NOT REMINDED TWICE.** It already gets a day-before text
with the SKIP line, sent as it is booked, so `recurring.bookDue()` stamps
`reminder_sent_at` at that moment. Without that, the reminder half of the same
nightly pass would find the order unreminded an hour later and send a second,
near-identical text the same evening.

**A pickup booked in the last three hours is skipped.** They booked it this
evening and the confirmation is the message directly above; a second text an
hour later reads as a system talking to itself. Same reasoning as `AT_PARTNER`
and `READY` saying nothing.

**Both spot fields are read, newest first** - `dropoff_spot || special_instructions`,
exactly as `run.spotOf()` does. `special_instructions` is where the AI saves the
pickup spot and where every older customer's is; `dropoff_spot` is only set when
somebody wants the clean laundry left somewhere different. **Anything asking
"do we know where the bag goes" must check both** - checking `dropoff_spot`
alone says no for almost every customer who has told us.

**THE AI CHASES AN UNANSWERED QUESTION ONCE, A DAY LATER.** Neil's ask: the AI
asks for an address or a day, the customer never answers, and nothing in the
system noticed - so a half-set-up customer sat there for ever.
`src/core/followups.js` sweeps for it.

| Rule | |
|---|---|
| The last message is the AI's own reply, 24 hours old | anything else means we are not waiting on them |
| **One chase per silence** | a chase is written as `kind = 'FOLLOW_UP'`, so the last message is then a follow-up and the first rule can never fire again |
| There was a conversation | at least one message from them and two from us. "Thanks" / "no problem" is not something to chase |
| Nothing booked | the point is getting somebody over the line; a customer with a pickup coming does not need texting |

**A FOLLOW-UP TO A FOLLOW-UP IS IMPOSSIBLE, NOT DISCOURAGED**, and that is the
whole shape of the design. Rather than counting chases in a column, the chase
changes what the last message IS. Only the customer speaking puts an AI reply
back at the end of the thread.

**`messages.kind` is what makes any of it work** - `AI`, `FOLLOW_UP`, `PERSON`,
`SYSTEM`, and null for everything written before it existed. Only `AI` earns a
chase, so a booking confirmation, a status text, a STOP reply, an apology after
an outage and a nudge button are all silent. Null being "we do not know" is the
safe direction: an unlabelled history can never trigger a chase at somebody who
had a conversation last week.

**THIS ONE MESSAGE IS WRITTEN BY THE AI**, which is the exception to the rule in
`src/core/nudges.js`. Those ask for one of five known-missing things and can be
written out in advance; a chase has to refer to a conversation that could have
been about anything, and the fixed-sentence version is "just following up!",
which is worse than nothing. `brain.followUpMessage()` gets the thread and **no
tools at all**, so it can only produce words - it cannot book, cancel, charge or
look anything up. If it comes back empty or longer than two segments, nothing is
sent.

**CHASES CAN BE SWITCHED OFF FOR ONE CONVERSATION.** Neil's case, from a real
thread: the customer said "Not yet. Will LYK. Thanks!", the AI said "Sounds
good, no rush at all", and a chase was queued for the next afternoon. They had
already said they would come back. `ai_pauses.follow_ups_off`, set from the
thread or from `/ops/scheduled`, both posting to the same route.

**It is NOT the AI pause, and they are independent.** A pause stops the AI
saying anything at all on that number; this stops only the unprompted chase, so
the AI still answers the moment they text in. Turning one on does not touch the
other, and that is tested both ways.

**`ai_pauses.paused` had to stop defaulting to true**, which is migration 0070
and was a real bug caught on screen. The table was designed when a row meant
one thing - this number is paused - so merely inserting a row paused the AI.
The moment the table gained a second job, turning chases off for a number with
no existing row silently switched the AI off for that customer entirely. A row
now means "there are settings for this number", and every writer sets `paused`
deliberately.

**`/ops/scheduled` is "Customer follow-up", reached from a card on the Admin
dashboard rather than from the menu** - the same treatment Issues and the weight
and money report get, and for the same reason: a menu is where you go looking
for a screen, and none of the three is something you go looking for daily. The
routes still exist and still carry their own permissions; hiding a page whose
route still fires is a menu rule, never a guard. It lists everything
that will text a customer on its own - the chases and the pickup reminders, in
the order they happen, with a way into each conversation. The heading, the page
title and the card all say the same words, which is the rule the rest of the
nav follows. Neil's ask: until it existed, the only way to know a text
was coming was to open the conversation it belonged to. Both lists come from
`allPending()` functions that read the same rows and call the same `assess()`
the sweeps do, so the screen and the send cannot disagree.

**A pickup reminder has no switch on that page, on purpose.** It goes because a
van is coming to somebody's door and they need the bag out; the way to stop it
is to move or cancel the pickup, which is a decision about the order rather
than about a text. A chase has one, because "I'll let you know" is a decision
about the conversation.

**The thread says when a chase is coming**, in a dashed box where the next
message would go. Neil's ask, and the reason is that nothing should text a
customer at a time nobody could have predicted. The screen and the sweep both
call `assess()`, so the time shown and the time sent cannot disagree - and
`dueAt()` pushes the time out of quiet hours, because a screen promising a text
at half seven that would never be sent then is worse than no screen.

**It is skipped for an opted-out number, a thread a person has taken over, and
one where the AI is on hold.** A chase on top of a hold is the machine talking
over the person who owes them a real answer.

## Leads off the Facebook adverts

**Meta's instant form writes every lead into a Google Sheet, and the app reads
that sheet every few minutes and texts anybody new.** `src/core/leads.js`.
Neil's ask: a number that appears and is not already a customer gets a message
immediately.

**The sheet is read as published CSV, with no credentials at all.** Meta already
writes to it, so there is no app review, no access token and nothing to renew -
and nothing here to leak. `LEADS_SHEET_ID` is the id out of the sheet's own URL;
blank switches the whole thing off. **A sheet that has stopped being shared
returns a sign-in page with a 200 on it**, so the status code proves nothing:
the sweep checks the consent column is in the header and refuses the file if it
is not.

**THE TICK BOX IS RECORDED AND DOES NOT GATE THE TEXT.** Neil's call, taken
with the alternative in front of him: *"if they provided the number we text
them"*. It was built as a gate first and the argument is kept in
`src/core/leads.js` at length, because the instinct on reading that file is to
put it back.

Both halves of it: three of the first four leads left the box false, Meta's
field is optional so a false covers both somebody who read it and declined and
somebody who never noticed, and an unticked box is not express written consent —
which is what a carrier asks about during 10DLC registration and what a TCPA
complaint turns on. Against that, they typed their number into a laundry
company's form asking about laundry pickup, which is an enquiry by any ordinary
reading, and gating on the box throws away most of what the adverts are buying.

**`consented` is still written on every row.** It is the evidence, and it has to
survive whether or not it decides anything — "which of these people actually
ticked it" is the first question anybody would ask if this is ever challenged.
**A number that has texted STOP is still refused**, and that one is the law
rather than a preference: it must never become configurable here.

**Keyed on Meta's lead id, not the phone number.** The same person filling the
form twice is two leads and both are recorded honestly; keying on the phone
would silently lose one. A lead we decided not to text is written down with its
reason, because "we never saw it" and "we saw it and left it alone" are
different answers.

**The message is written in code, not by the AI.** Same rule as the nudges:
these words go to somebody who has not texted us, so they are words a person has
read, and the segment count is knowable before anything is sent.
`kind = 'SYSTEM'`, so it earns no follow-up chase and is not mistaken for a
colleague working the thread.

**ONLY THE OPENING LINE IS ITS OWN.** Everything after it comes from
`onboarding.whatWeDo()`, which is what the canned website welcome uses too. Neil
wrote the two messages separately and then wrote them identically from the
second paragraph on, because they answer the same question for somebody who has
never spoken to us. Two copies would be two things to edit, and one of them
would be the one nobody remembered. What differs is the first sentence — this
one says where we got the number, the welcome says thanks for sending it — and
the opt-out line at the end.

**It carries "Text STOP to opt out" on every version.** It is the only message
in the system that reaches somebody who has never texted us, so it is the one
that has to say how to stop - and a carrier reviewing the campaign looks for
exactly that sentence on exactly that kind of message.

**The offer sentence only goes out if there is an offer to honour**, and the
count in it is read off `promotions.max_orders` rather than typed into the
sentence - a promise with a number in it must not have two copies of the number.
**Only a genuinely free promotion gets that wording** (`PERCENT_OFF` at 100), so
a different offer falls through to a plain invitation and the AI mentions it
from the blurb when they reply, as it does everywhere else. Telling lead
twenty-one that the first twenty orders are free is the thing this avoids.

**It runs on its own faster timer, and that is the only reason there are two.**
The nightly pass and the follow-up sweep are waiting for the clock, where ten
minutes either way changes nothing; a Facebook lead has just tapped an advert
and is holding their phone. Both timers live in `scheduler.js` so "what runs by
itself" is still one file.

**QUIET HOURS STILL APPLY, and this is the one place "immediately" and the law
disagree.** Somebody who fills the form in at half past eleven at night is
texted at eight the next morning. It defers rather than skipping, like a
follow-up: an introduction is exactly as true in the morning.

**`npm run leads` prints who is on the sheet and what would happen to them, and
writes nothing.** It exists because a lead that is deliberately skipped looks
exactly like one the system missed, and most of the sheet is skipped on purpose.
It must never be tempting to "just test" the real sweep locally - the dev server
shares the production database, so it would mark real leads as texted while the
fake provider swallowed the message, and production would never text them again.
Same trap as the nightly pass, and the same guard: the sweep is off outside
production.

**THE APP RUNS ITS OWN NIGHTLY PASS. There is no cron service and there does
not need to be.** `src/core/scheduler.js` owns one ten-minute tick inside the
running server and runs two things on it: the nightly pass in
`src/core/nightly.js` - book tomorrow's standing orders (texting those
customers as it goes), then remind everybody else whose pickup is tomorrow -
and the follow-up sweep, all day.

**QUIET HOURS ARE A HARD FLOOR ON BOTH, 8am to 9pm New Jersey time**, and are
not configurable because they are the law rather than a preference. Everything
on this tick is unprompted - nobody has just texted us and is waiting - so late
is never a reason to send at midnight.

**The two react differently to being late, and the difference is real.** The
nightly pass **skips** a night it missed, because its message says "tomorrow"
and sending it at 6am the next day would be a lie. A follow-up **defers**: it is
only "a day or so later", so one that came due at 3am goes out at 8am and is
still exactly right.

**It used to be a Railway cron service, and that was the wrong answer.** A cron
is a second service configured by hand in a dashboard - and nobody had actually
set this one up, so standing orders and reminders would both have sent nothing
while looking perfectly healthy. Neil asked why it needed a cron at all. It
does not: the web app is already running every minute of every day, because an
inbound text has to be answered, so it can watch the clock for free.

**A POLL, NOT A TIMER.** The tick asks two questions - is it evening, and is
`app_settings.nightly_ran_on` today. A one-shot timer set at startup would be
lost by any deploy, and a deploy at 5:59pm would silently skip the night. A poll
simply asks again.

**OFF OUTSIDE PRODUCTION, and that guard is load-bearing.** The dev server
shares the production database, so a laptop left running at six in the evening
would do the whole pass, stamp every order as reminded, and send the texts
through the fake provider - meaning nothing reaches a phone and production then
finds nothing left to do. Everybody's reminder would vanish because somebody
had a terminal open. `NIGHTLY_ENABLED=true` overrides it deliberately.

**`npm run cron:recurring` is still the way to run the pass by hand**, and it
calls the same `nightly.runPass()` the timer does rather than reimplementing
it. If a cron service is ever set up as well, the two race to do the same
idempotent work and whichever wins does it - `bookPickup()` refuses a second
pickup for anybody who has one waiting, and `orders.reminder_sent_at` stops a
reminder going twice.

**One instance is assumed**, like the sign-in throttles. Two web processes would
both poll and the "has tonight run" check is a read then a write with no lock
between them. The per-order stamps make that mostly harmless; if this ever runs
on more than one replica, that check needs a lock.

**That one cron is now the whole nightly pass, and it does two things in
order**: book tomorrow's standing orders (texting those customers as it goes),
then remind everybody else whose pickup is tomorrow. The order matters - a
standing order booked in the first half has already been texted, and the second
half must not text it again. The npm script keeps its old name because that is
what Railway's scheduler points at; renaming it would put the name in two places
that could disagree.

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

**ONE BAG TAG PER BAG, CARRYING NUMBERED PEELABLE STICKERS.** Every row shares
the code — `7MQ5Y2` for the tag itself and `7MQ5Y2-1` upwards for the stickers.
The id is what a person says out loud and is the same on all of them;
`bag_labels.sticker_seq` is what makes them individually addressable, so a
sticker tapped twice is not mistaken for a second bag.

**HOW MANY IS `bags.STICKERS_PER_TAG`, AND IT IS THREE.** It was four. Neil
changed it, and the number is a constant rather than a `4` typed into six files
precisely because it can change again — the sheet, the roll PDF, the QR page's
sticker grid and the laundromat page all read it.

**The database still allows 1-4 and that is deliberate.** A tag printed under
the old design carries a `-4`, and one of them is on a delivered order.
Tightening the CHECK would mean either a failed migration or renumbering a
historical row, and a record edited to fit today's rules is not a record. The
column is a sanity bound; the constant is the business rule.

**The stickers are the whole answer to the return leg.** One bag we
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

**THE LAUNDROMAT'S WEIGHT IS MANDATORY, and it is half of what bills.** It was
a voluntary cross-check that the pricing code never read. Neil changed both:
every bag they were handed has to have a weight on it, and the customer is
billed on the higher of the two scales. `tags.unweighedBags()` is the guard —
"this order is done" is refused while any bag is unweighed, and the page says
which. (The scale photo that used to be required alongside it is gone — see
above.)

**A bag cannot show its wash instructions until it has been weighed**, which is
what makes the rule bite in practice rather than at the end. The guard on
finishing is the backstop for anything that gets past that.

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

**A LAUNDROMAT HAS TO BE OPEN WHEN THE WORK IS READY, not only when the bag is
dropped off.** The chooser asked whether they were open at drop-off and never
whether the driver could get back in. Fancy K is shut on Wednesdays, so a
Tuesday pickup routed there sat on their floor until Thursday against a next-day
promise — and it was chosen anyway, because on cost it won. `canCollectOn()`
asks whether any of that weekday's windows is still running after the work is
ready; a weekday with no rows is closed, the same rule the rest of the file
follows. The day asked about is the drop-off plus their turnaround, and an
unknown turnaround is treated as next day rather than as instant.

**The choice is cheapest ALL IN, not nearest** — wash plus driving, where a mile
is gas, wear and the driver's wage, and the wage is about 71% of it. That is why
a $1.00/lb laundromat three miles further loses to a $1.25/lb one down the road.
Distance alone only decides it when a partner has no agreed rate, and a partner
with no rate is sorted last rather than treated as free.

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
| **Dashboard** | What is happening right now: Your round, Orders, Routing, Load the van, Issues |
| **People** | Everyone you deal with: Customers, Conversations, Team, Partners |
| **Business** | What you set up and what it earns: Taking orders?, Promotions, Text blast, Bag tags, Unit economics, Route planner |
| **Resources** | How it all works, What happens to a bag, What we send a laundromat |

**THE ADMIN DASHBOARD IS A GRID OF EQUAL CARDS, and nothing else.** Neil's
call. The weight thresholds were a full-width form dropped into the middle of
it, which made the page five small cards with one enormous form between them;
they have their own screen at `/ops/weights` now and a card like everything
else. The grid sets `grid-auto-rows:1fr` so every row is as tall as the tallest
card rather than each row sizing itself - without it the second row was visibly
shorter than the first.

**Pre-launch lives under Business**: Taking orders?, Promotions, Text blast,
all behind `service.manage` (Admin only). Closing the business, giving money
away and texting everybody at once are three things a driver or a salesperson
should never be able to do.

**The switch is not a feature flag.** `app_settings.taking_orders` changes what
the AI says AND what `bookPickup()` will do, and the second half is the one
that matters: the prompt asks, the code refuses. Same split as the service
area, because a model asked nicely not to book will eventually book. It shuts
the text thread, the website form and the standing-order job together.

**THERE IS NO BYPASS NUMBER ANY MORE. Neil's call, and it cost an afternoon to
reach.** `ALWAYS_BOOK_NUMBERS` used to fall back to `SUPPORT_PHONE`, so his own
phone was silently exempt from the closed sign, the opening date and the county.

He set the first pickup date to 8 September, texted "pick up today at 2pm" from
that phone to check it, and was told "I'd love to grab that for you today". The
reply was correct. It was also indistinguishable from the bug he was hunting,
and he had already been shown one genuine version of that bug the same morning.

**A bypass that announces itself nowhere looks exactly like a broken rule.** The
fallback is gone, so the list is empty unless somebody sets
`ALWAYS_BOOK_NUMBERS` deliberately, and the startup warning is inverted: it now
fires when an exemption EXISTS, because that is the surprising state.

**If one is ever set again, `checkSlot()` returns `waived`** — the rules that
were skipped, in words — so the exemption can say so instead of being invisible.
Nothing uses it while the list is empty; it is there because the day the list
comes back, the silence comes back with it.

The cost of having none: Neil cannot book while the service is shut, or outside
Bergen. Turning orders on is now the way to test.

**`app_settings.opens_on` IS THE FIRST DAY A VAN COMES, AND IT IS NOT THE CLOSED
SIGN.** Closed means nobody can book at all. This means anybody can book and the
earliest pickup is on or after that date — which is what a launch actually
needs, because the pipeline fills while the round is still being set up.
Seventeen people had signed up and were waiting.

It is checked in the same four places for the same reason, plus the two web
doors: `bookPickup()` refuses `before_opening`, the prompt in `brain.js` states
the date and tells the model it is not the same as being shut, `actions.js` has
its own reply for it, and the canned welcome in `onboarding.js` says when the
first pickups are instead of inviting somebody to book one that will be refused.
`/account`'s date picker starts at it, and `/ops/settings` sets it.

**A date that has passed counts as no date.** Nobody has to remember to clear
it, which matters because the person who set it is the person who would forget.
Neil's own number is exempt, exactly as it is from the closed sign and the
county.

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

**A PROMOTION IS AN OBJECT ATTACHED TO A PERSON, NOT A CODE**, and it always
was. A redesign proposal assumed otherwise and recommended building it; the
answer is that `customer_promotions` already records who holds what, whether
they spent it and on which order. **There is nothing for a customer to type and
no link to click** - the AI knows who is texting, so the discount comes off by
itself. Don't add a code field or a `?promo=` booking link: that is a worse
version of what exists, and CLAUDE.md already records that sending customers to
a web form was removed.

**`promotions.audience` says who gets one**, and it replaced the `auto_grant`
boolean, which could only ever say "every new number". `NEW_NUMBERS` (automatic
on first text, still at most one, now enforced on the audience),
`NEVER_ORDERED` and `EVERYONE` (handed out in one go from a button),
`SPECIFIC` (given to one person from their own page). `auto_grant` survives
unread, like `customers.recurring_*`.

**WHICH ORDERS IT IS GOOD FOR: `FIRST_ORDER`, `NEXT_ORDERS` (a number you type)
or `EVERY_ORDER`.** `customer_promotions.uses` counts what has been spent and
`redeemed_at` now means **used up**, stamped only when the count reaches the
grant's own limit. **This fixed a real bug**: `redeem()` closed every grant on
first use, so `EVERY_ORDER` behaved exactly like `FIRST_ORDER` and nobody had
noticed, because no promotion had ever been redeemed twice. The limit is
**copied onto the grant**, like the expiry and for the same reason - editing
"next five" down to two must not take three orders off somebody already
promised five.

**A PROMOTION WITH NO BLURB IS SILENT.** Neil's case: he texts somebody himself
("you were one of the first to reach out, so I can do 30% instead of 20") and
puts the offer on their account. The AI announcing it again would be the same
news twice from two voices. `blurb` is nullable, the model is handed the first
held promotion **that has one**, and the discount comes off regardless. It does
not weaken the rule - being told nothing is a stronger guarantee than a sentence
it is allowed to repeat.

**`/ops/promotions/:id` is the list behind the number.** "23 given out" is a
count; this says which 23, where each got to (holding it, used it, ran out) and
which order spent it. Each grant's state is **derived** in `holders()` so it
cannot disagree with what `discountFor()` would do.

**Issuing to an audience is a BUTTON, not a standing rule.** A rule that keeps
issuing in the background texts customers while nobody is watching, and the
interesting rules - "has not ordered in 30 days" - match nobody until there is
order history to match against. `promotions.issueToAudience()` is where that
grows when there is.

**EXPIRY IS PER GRANT, NOT PER PROMOTION.** "Seven days from when you got it" is
a different date for every holder. `promotions.expires_days` is the rule;
`customer_promotions.expires_at` is the promise made to one person, stamped at
the moment it is granted and **never recomputed** - so shortening the rule later
cannot shorten a promise already made. `heldBy()` drops expired grants, so an
expired promotion silently stops discounting rather than needing a sweep.

**`min_order_cents` is not the order minimum.** `config.pricing.minimumCents` is
the floor on what any order costs; this is "valid on orders over $30" and is
checked against the price BEFORE the discount comes off - otherwise a promotion
could take an order under its own minimum and disqualify itself.

**The AI is TOLD the expiry date, it does not work it out.** Same rule as the
pickup windows and the opening date. It may say it when it matters and may
never guess one for a promotion that has none.

**The discount comes off AFTER the minimum.** Taking 20% off an 8 lb load's $16
and then flooring at $25 would charge the full minimum and hand the customer
nothing while the order claimed a promotion had been used. And the price text
names what came off - a total lower than the arithmetic the customer can do
themselves reads as a mistake unless the reason is in the same message.

**A PROMOTION CAN RUN OUT, AND THE CAP COUNTS ORDERS, NOT PEOPLE.**
`promotions.max_orders`, set on the promotions page. Neil's offer is "the first
20 orders are free", and his rule for it: **give it to everyone, but only the
first 20 people who actually book and order with us get it**. So handing it out
is free and unlimited - `grant()` is not capped and `issueToAudience()` has
nothing to check - and what runs out is the ORDER.

**THE SLOT IS CLAIMED AT BOOKING, NOT AT THE WEIGH-IN, and that is the whole
design.** Everything else about a promotion is decided when the order is priced,
hours later at a laundromat. Deciding the cap there too would mean the
twenty-first customer is told their pickup is booked and free, and finds out
otherwise when the price text arrives. `bookPickup()` calls
`promotions.claimSlot()` - the one door both front doors go through - so the
answer exists at the only moment the customer is actually asking.

**A claim is not a redemption.** `customer_promotions.claimed_order_id` is a
reservation taken when a pickup is booked; `redeemed_at` and `uses` are the
money coming off at the weigh-in, which can be two days later. `discountFor()`
refuses a capped promotion on any order that is not the one holding its claim,
so the promise made at booking is the one kept at pricing.

**A CANCELLED ORDER GIVES ITS SLOT BACK.** `orders.transition()` calls
`releaseSlot()` on `CANCELED` - there, rather than at each caller, because it is
the only function allowed to move a status and a release one door forgot is a
slot nobody can ever get back. Best effort: a cancellation must never fail
because the promotion ledger did.

**The confirmation REPLACES the price sentence when the order is free**, rather
than adding to it. "Nothing to pay" followed by "we'll take $2.00 a pound off
your Visa" is worse than saying neither, and the message is already close to its
three-segment ceiling. `bookPickup()` returns `freeOrder`; the Stripe webhook
asks `promotions.claimedFreeOrder()` instead, because it confirms an order that
was booked before the card existed. **Only a promotion that takes everything off
may be called free** - a capped 30% offer claims a slot the same way and must
not be announced as "nothing to pay".

**The count and the update have no lock between them**, so one instance is
assumed exactly as it is for the sign-in throttles and the nightly poll. Losing
that race costs one extra free order.

**`grant()` returns the grant somebody already had** rather than null, so "did
this leave them holding one" is answerable from the return value. That is what
decides whether the Facebook lead message may promise anything.

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

**Issues sits under Dashboard**, not with the people it happens to be about. An open
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

**THE AI CAN BE SWITCHED OFF ON ONE CONVERSATION, and only a person switches
it back on.** Neil's call. Something goes wrong in a thread, an admin wants to
handle the customer themselves, and the AI has to get out of the way
completely - not soften its answers, say nothing at all - until they are done.
`ai_pauses`, one row per phone number, read by `aiPause.isPaused()` at the top
of `answerWithBrain()`.

**It is deliberately NOT the hold in `issues.js`, and confusing the two would
undo it.** A hold is the AI admitting it is stuck: it goes quiet, texts every
admin, and lifts ITSELF as soon as a person has replied and the customer has
answered. That release is exactly wrong for somebody working a customer by
hand - they would send a message, get an answer, and the AI would walk into the
middle of their conversation. So the pause is a switch with a person at both
ends and nothing the customer does moves it.

| | |
|---|---|
| the hold | the AI ran out of road and is waiting to be rescued |
| the pause | somebody has this one, hands off |

**Handing it back lifts an open hold too.** The two mute the AI independently,
so without that an admin would press the button, watch the AI stay silent, and
reasonably conclude it was broken. It lives in `aiPause.resume()` rather than
in the route, so a second caller cannot forget it.

**`isPaused()` fails closed.** If the switch cannot be read the AI says
nothing: talking over a person handling a complaint is worse than a message
going unanswered for a minute, and a failure there means the database is down,
in which case the reply was never getting written anyway.

**Keyed on the phone number, like `dismissed_leads`,** because the screen it
lives on is a list of numbers and some of them never signed up. Keying on a
customer would lose the pause the moment a number that was never a customer
became one.

**The switch lives at the FOOT of the thread, on the same row as Send it.**
Neil's call, and it replaced a card above the conversation. Deciding to handle
somebody yourself and then writing to them is one action, so the control and
the state of it belong next to the button that sends. The badge says "AI is on
/ off **for this chat**" in as many words, because the one thing nobody must
wonder is whether they have just turned the AI off for the whole business.

**The Send it button sits outside the form it submits**, tied to it with
`form="send-message"`, because forms cannot be nested and the AI control is its
own form on the same row. Plain HTML, no script - the same rule the rest of ops
follows.

**A muted thread is badged on the conversations list and counted in a banner at
the top of it.** The whole risk of a switch that stays where you put it is
forgetting you put it there, and a paused thread is a customer nobody is
answering at all.

**COMING BACK ON IS PICKING UP SOMEBODY ELSE'S CONVERSATION, and the AI has
to be told whose words are whose.** It was already handed the last ten messages
before every reply - that part was never missing. What was missing is that
everything outbound read to it as something IT had said, including the four
messages a person had just typed by hand. So it would re-promise what a
colleague promised, or contradict it, or carry on as though the thread had gone
fine.

`messages.sent_by` is the person who typed a message, and null for everything
nobody typed - the AI's own replies, status texts, booking confirmations. The
thread handed to the AI labels those lines **A colleague** rather than **Us**,
and a thread containing any of them carries a block telling it to carry on from
where they left off, never repeat or contradict what they said, never say "my
colleague" (to the customer this is one conversation with us), and to call
`handoff_to_human` rather than guess at a promise it cannot see.

**The trigger is a colleague's message in the window, not the switch.** An admin
who replies by hand without ever touching the toggle creates exactly the same
problem, so the rule keys off the thing that causes it.

**The text blast deliberately does NOT stamp `sent_by`.** A blast is written by
a person and is not somebody handling a conversation; marking it would tell the
AI that every customer who got a promotion text is being dealt with by hand.

**Switching the AI back on sends nothing by itself.** It picks the thread up on
the customer's next message. An unprompted text the instant somebody flips a
switch is a message nobody asked for, and every segment is money and carrier
reputation.

**Sending a message does not switch the AI off.** A button that quietly does a
second thing is one nobody trusts. What it does instead is say so on the way
back - writing to somebody while the AI is still answering them is how two of
us reply to the same message.

**WHAT IS STILL MISSING, AND ONE BUTTON PER THING.** Neil's ask: an admin
should be able to press a button at each step of getting an order started -
their details, how they want it washed, where the bag goes, a card, when they
want collecting - and have a text go out asking for exactly that. It is in
`src/core/nudges.js`, rendered by `src/web/nudge-panel.js` on the customer page
and in the side column of an order, from one function.

**IT IS NOT A SECOND STATUS ON THE ORDER, and that is the part worth keeping.**
He described these as stages an order moves through. They are not: the order
state machine is about where the BAG is, only `orders.js` may move it, and every
one of these happens before a bag exists. A stored "intake stage" would be a
second copy of facts the database already holds - a name, an address,
preferences, a card - free to disagree with them the first time anybody did
something by hand. So a gap is **derived every time**, from the same predicates
`checkSlot()` refuses on, and listed in the order it refuses them. Same rule as
BOOKED on the board and the partner load.

**THE MESSAGES ARE WRITTEN IN CODE, NOT BY THE AI.** Neil's call, taken with
the alternative in front of him. They are fixed sentences, so the screen shows
the exact words and the segment count **before** the button is pressed - a
button that texts a customer something nobody has read is not one anybody
should press - and because texting somebody who has not just texted us is the
one thing the AI has never done.

**The AI still does the part that matters.** The nudge lands in `messages` like
any other outbound, and the AI is handed the last ten before it replies - so it
sees the question that was asked and handles whatever comes back, including
"actually make it Friday", in the thread as usual.

**A nudge is NOT stamped `sent_by`.** A person pressed the button but nobody
typed the sentence, and stamping it would put the AI into the handover
behaviour as though a colleague were working the thread by hand.

**Only the card message is not written there.** `billing.setupLinkMessage()`
already owns that wording and mints the `/pay/<token>` in it, so the button
sends the same sentence the AI and the website already send. The panel cannot
call it to build the preview - that would create a Stripe session on every page
load - so it shows the wording with the link stubbed and says so.

**`send()` re-derives the gap rather than trusting the button.** A page left
open since the morning would otherwise ask somebody for a card they saved an
hour ago.

**With the shop shut, nobody is asked when they want collecting.**
`bookPickup()` would refuse whatever they answered, and inviting a customer to
book something that is then refused is the mistake the closed sign has already
caused once. The pickup nudge also states the opening date when there is one.

**There is deliberately no "confirm the order" button**, though Neil named one.
There is exactly one confirmation - the recap, a yes, then it books - and a
second one from the ops side is the thing he twice asked never to have.

**A CONVERSATION CAN BE STARTED FROM OUR END.** Neil's ask: somebody he met at
a laundromat, or a building manager, could not be texted at all until they
texted first, because every other send needs a thread to send into.
`POST /ops/messages/new` takes a number and a message.

**It does NOT create a customer.** The message is logged against the number with
a null `customer_id`, exactly like an inbound from a stranger, and the screen
groups by number so the thread appears anyway. If they reply, the normal path
creates the row with its consent record - which is the honest one, because THEY
started talking. Creating a customer here would manufacture a consent record for
somebody who has agreed to nothing.

**Opted-out numbers are refused and the box is throttled**, because it is the
one door that can reach a number nobody has ever looked at.

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

**BUT ONE VISIT IS NOT ONE ADDRESS, and the laundromat is where the two come
apart.** A `pickup_partner` stop does not exist until the laundromat says the
work is finished, which is hours after the drop-off — the driver left long ago.
Matching on the address alone handed him the collect card with no navigation and
no "I'm here": the run went from "that's the route" straight to standing at a
counter in Paterson. **The test is whether the work was ready WHILE HE WAS
THERE** — `ready_at` against the previous stop's `at_partner_at`. Collecting an
order finished this morning on the same visit he drops another off is real and
still needs no navigation; anything that became ready after he left is a second
trip.

**The run needs today's finished stops as well as the outstanding ones.** The
routing board is built from live queries, so a stop disappears the moment it is
done — right for "what is left", useless for "where am I". `doneToday()` is what
makes the progress bar move and what lets the page know the last visit was at
this address.

**The maps button is a plain `https://maps.google.com/?q=` link**, not a `geo:`
or `maps://` scheme. Those open a native app directly and do nothing at all on a
phone without that app, and a dead button on a doorstep is worse than one extra
tap.

**A STOP WITH SEVERAL BAGS IS A LIST YOU TAP INTO, and there are three of
them** — the doorstep pickup, collecting off a laundromat, and the doorstep
delivery. All three have the same shape, because it is the same problem: a
button per bag, tapping one opens that bag on its own screen, finishing it drops
you back on the list, and a button at the foot ends the stop.

It replaced a single line of tasks where bag 2 did not exist on screen until bag
1 was finished. That is fine for a driver working straight through and wrong for
one who puts a bag down, deals with another and comes back — and it gave him no
way to see how many were left without counting taps.

**On the pickup leg a bag is addressed by its POSITION, not by a row id.**
Nothing exists in `bag_labels` until a tag is bound, so bag #2 of three has no id
to link to until it has a sticker on it — and being able to open bag #2 before
touching it is the whole point of the list. `bags.bind()` therefore takes an
optional position: **without one it fills the next free slot**, which is right
for the order page, and **with one it uses the slot the driver tapped**. Taking
the next free slot regardless would file the tag he just stuck on bag #3 as bag
#1, drop him back on a bag #3 that still says "put a tag on it", and he would
tag the same bag twice.

**The bag pages own no steps.** Their controls post to the same routes the order
page posts to, through the same `taskControl()`; `?from=` is the only difference
and it decides where he lands. `src/core/run.js` works out what is next and
nothing else. A second implementation of "weigh a bag" is how the two drift.

**THE LAST BAG GOING IN DOES NOT END THE STOP — the driver does.** Every one of
these lists had the same bug and it was found twice: the final tick stamped the
order and cleared his arrival, so the card changed under him and the button at
the foot was never reachable. Neil, both times: he has to press that button to
move on. The ticks say which bags; the button says he is finished there.

**`doneToday()` must not call a doorstep finished because a bag has a weight.**
`orders.weight_lb` is the SUM of the bag weights and is recomputed as each one
goes on the scale, so on a three-bag order it stops being null after the first —
and the same door then appeared twice in one run, once as done and once as the
live stop, with the progress bar counting a door he had not left. `stopDone()`
already carried a note about exactly this; the copy in `doneToday()` was missed.
The test is `van_confirmed_at`, **or a status that is plainly past the door** —
orders collected before that button existed have an empty column, and requiring
it alone made a finished doorstep vanish off the run.

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

**AN OPS SESSION LAPSES AFTER AN HOUR OF DOING NOTHING.** Neil's call: he was
staying signed in on every device he had ever opened the ops screens on, which
is a lot of live sessions for a tool holding customer addresses, phone numbers
and the books.

**It is INACTIVITY, not an hour from signing in, and that is the whole
feature.** `requireAdminPage` re-issues the cookie with a fresh hour on every
authenticated request, so somebody working is never interrupted and somebody who
put their phone down is signed out. An absolute hour would throw a driver out
mid-round for no security gain. It replaced thirty days, which existed so a
driver was not signing in mid-route - the sliding window gives that for free.

**The slide happens AFTER the `ops_users` check**, so somebody switched off
does not get their session quietly extended on the way to being refused.

**The customer sign-in at `/account` is untouched and still lasts 14 days.** A
customer session holds one person's own orders, not the business, and timing
somebody out of their own account in an hour is friction for nothing.

**A PHONE NUMBER NEVER GETS YOU IN. THE CODE DOES.** Neil's call, and it closed
a real hole: `/ops/login` and `/ops/login/code` used to redirect an
already-signed-in visitor straight through, so typing a number on a device whose
cookie was still alive got you inside without a code ever being entered.
Submitting a number now **clears the session first**, so there is no window
where abandoning the form leaves you inside on the old credential.

**ONE SIGNED-IN DEVICE PER PERSON.** The cookie carries a token as well as the
id and the expiry, and `ops_users.session_token` holds the one that counts.
Signing in mints a new one, so every other device fails on its next request. No
session table to grow or sweep - one row, one live session. Compared in constant
time, and the signature covers the token, so it cannot be swapped for another.

**Being signed out elsewhere SAYS SO.** The redirect carries `?why=elsewhere`
and the sign-in page renders it. Getting thrown out of a screen you were just
using with no explanation is indistinguishable from the thing being broken, and
would be reported as a bug.

**Adding `session_token` signed everybody out exactly once**, which was the
correct migration: a cookie minted before the column existed carries no token,
matches nothing, and its holder signs in again.

**The session cookie is not a credential.** It is `userId.expiry.token`, signed
with `ADMIN_API_KEY`. A leaked cookie expires on its own and never held a secret.
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

**The price is provisional at `/ops/weight` and the card is charged when the
laundromat weighs it.** Two authorisations are on record by then: the consent
given on the Stripe page, and the booking confirmation naming the card. There is
no third "reply YES to pay" step, on purpose.

**`fulfilment.settleWeight()` owns all of it** — which weight bills, what it
costs, whether the card moves, and what the customer is told. One function,
because the four answers have to agree.

**The charge point has moved twice and the reasoning is worth keeping.** It sat
at our own scale first, which was too early: the bag then went to a laundromat
that might read the weight differently, so the money had already moved by the
time a disagreement surfaced. It moved to the doorstep, which was safe but late.
It is now the laundromat's weigh-in — Neil's call — because their figure is
mandatory, so by then nothing about the amount can still change, and waiting
until the doorstep only moved a decline to the worst possible moment: a driver
standing on a step with an armful of clean laundry and no way to fix it.

**The customer is billed on the HIGHER of the two scales.** Inside the tolerance
the two numbers are describing the same laundry and the gap is smaller than the
amount either scale could be out by, so the higher one is taken and the card is
charged there and then. Outside it, nothing is charged and nothing is said —
see the hold below.

**A SETTLE THAT DOES NOT HAPPEN MUST NOT BE SILENT.** Settling prices the
order, charges the card and texts the customer, and a failure used to leave
nothing but a line in the server log — an order sat unpaid with a change log
that stopped dead at the laundromat's weight, three separate times, and the only
way to find out was to query the database. A settle that returns neither a price
nor a hold now writes a `PRICE` event saying so and raises an issue. **And the
order page offers to run it again**: both scales in, nothing held, nothing
settled gets one button, because there is nothing for a person to decide there —
only something to re-run. A held order gets the two-scales card instead, which
asks for a weight and a reason.

**A decline is told to the customer immediately**, in the same text as the
price, with a link to update the card. It does not hold up the delivery: the
clothes still go back and we chase by text.

**`/ops/delivered` is still a charge point and must stay one.** It is the
backstop for orders that never reach a laundromat — anything we wash ourselves
has no partner weigh-in to trigger the charge. It is a no-op for an order
already paid.

**The card is charged exactly once per order, and booking takes
nothing.** For
a while there was a $25 minimum collected at booking with the balance taken on
delivery — two charges, two idempotency keys, two things to refund, and a
customer watching money leave before anybody had touched their laundry. It is
gone. **The minimum is a floor on `price_cents`, not a payment**: an 8 lb load
costs $25 and is billed in one go with the rest. `deposit_*` and
`refundDeposit()` survive only because two real orders were taken under the old
rules and their money has to stay refundable; nothing writes a new one.

**A booking is confirmed by having a card on file, not by a cleared payment.**

**The board says BOOKED or AWAITING CARD, never bare REQUESTED.** Neil watched a
customer save a card, get "Order #1973 is booked", and the board still read
REQUESTED - which looks like the booking never finished. `REQUESTED` is two
different situations and it was showing one word for both. **Derived, not a new
status**: the fact lives on the customer and a fourth row in the state machine
would be a second copy of it that could disagree.
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

**THE AI WAITS BEFORE IT ANSWERS, and every new message restarts the wait.**
Neil's call. People text a business the way they text a friend - "hey", then
the question, then the time, three messages in fifteen seconds - and answering
each as it lands gives them three replies of which the first two answer half a
sentence. `src/core/burst.js` holds an inbound reply for
`config.replies.burstSeconds` (**20**, `SMS_REPLY_WAIT_SECONDS`), restarting the
clock on each new message, then hands the AI everything they said joined with
newlines. That is what a person reading the thread would answer.

**The cost falls on somebody who sends ONE message** and waits the full window,
which is why it is 20 and not the 30 also considered. Set it to 0 to switch the
whole thing off; that is what the tests run with.

**There is a cap, `burstMaxSeconds` (90).** Measured from the FIRST message of
the burst, because somebody texting every fifteen seconds would otherwise reset
the clock for ever and never be answered at all - a worse failure than
answering mid-thought.

**STOP, START and HELP are never delayed, and they CANCEL what is waiting.**
They are answered in code before any of this. Without the cancel, an AI reply
lands after somebody has opted out, which is the one thing STOP exists to stop.

**It is held in memory, which loses pending replies on a restart.** Three things
make that a trade rather than a bug: the window is seconds; their message is
already in `messages` before the timer starts, so the thread shows an inbound
with no answer rather than losing anything; and `shutdown()` in `src/index.js`
calls `burst.flushAll()` before exiting, so a deploy answers whoever is waiting
on the way down. The forced-exit timer there was raised to 25s for the same
reason - answering means a call to the AI and a call to the carrier. A database
queue would be the alternative and CLAUDE.md rules out a job queue.

**The pause is checked when the reply RUNS, not when the message arrives**, so
an admin who switches the AI off during the window stops the reply that was
already waiting. That falls out of where the check sits and is worth keeping.
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

**THE FIRST MESSAGE IS FOUR SEGMENTS NOW, AND THAT IS DELIBERATE.** The canned
welcome was held to one segment for a long time, on the grounds that it goes to
everybody and every segment is billed. Neil rewrote it once there was paid
traffic behind the number: it is the only thing a stranger reads before deciding
whether to reply, and "no app to download" answers the question most of them are
actually asking. Shorten it by cutting a whole idea, never by re-compressing it
into the terse version — that has been tried and it reads as a robot.

**The opening date goes INSIDE the invitation** — "just tell us a day that works
from Tuesday 8 Sep" — rather than being left out of it. Both first messages go
out before the AI ever sees the conversation, so they are the ones that cannot
work out for themselves that the van does not run yet, and inviting somebody to
name a day when the earliest we can come is next week sets up a refusal on their
very next text. It disappears on its own once the date passes.

**The free-orders sentence is `promotions.freeOfferLine()` and nothing else may
write one.** It returns null unless the promotion genuinely takes everything
off, so a 30% offer can never be announced as free, and the count comes off
`max_orders` so a promise with a number in it can never carry a number the code
is not enforcing.

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
