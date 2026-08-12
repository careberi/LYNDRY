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

A speech bubble, because the whole service is a text thread. `logo(variant)`
in `layout.js` builds it; the CSS is at the top of `lyndry.css`. Variants:
`nav` (header), `footer`, `compact` (below ~18px, drops the kicker), `offset`
(the hard ink shadow, for marketing placements). `avatar()` is the "L" in a
Suds bubble, used in the phone mock and as the favicon.

**The tail is one shape whose top overlaps the bubble's bottom border by
exactly the border width**, so the outline opens where the tail joins and no
hairline shows through. It was tried as a rotated square and as a big ink
triangle stacked behind — both left visible artifacts. Don't rebuild it.

**Both wrappers carry `line-height: 0; font-size: 0`.** Without that a stray
line box drops the tail a few pixels and the bubble's border shows as a line
above it.

**The wordmark is Grandstander 900**, loaded by a `<link>` in `layout.js`
rather than added to `css/ds/tokens/fonts.css` — that folder is the design
system vendored unmodified, and an edit there is lost the next time it's
replaced.

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
- Missing a required field? Ask for **that one field only**, then act.
- A returning customer texting "laundry tomorrow" gets an order with zero
  follow-up questions.
- Never ask about detergent, temperature, folding or softener over SMS. Those
  live in `preferences`, collected once on the website.
- Uncertain, or the customer is upset? `handoff_to_human` rather than guessing.
- Replies sound like a competent human at a small business. Short. No emoji.
  Never "I'm an AI".

## Ops endpoints

Everything under `/ops` needs the `x-admin-key` header, compared in constant
time. No login system, no accounts — it's Neil and a driver.

```
POST /ops/collected          the bag is in the van        -> IN_PROCESS
POST /ops/weight             pounds in, price out         (sets price_cents, CHARGES)
POST /ops/out-for-delivery                                -> OUT_FOR_DELIVERY
POST /ops/delivered          multipart photo upload       -> DELIVERED
POST /ops/charge             retry a declined card        (manual lever)
POST /ops/waive              decide not to charge         -> WAIVED
GET  /ops/today              the driver's run sheet, plus what's owed
```

**Every status change texts the customer**, through `src/core/notify.js`, which
sends and logs in one step. Nothing may send a text without recording it.

**Only `src/core/orders.js` may change an order's status.** The endpoints ask it
to and turn its refusal into a 409, so a driver double-tapping cannot deliver
an order twice or charge for it twice.

**`price_cents` is set only by `/ops/weight`**, from `price_per_lb_cents` stored
on that order — never today's rate. Changing the price must not re-price work
already quoted.

**Delivery photos go in a private Supabase Storage bucket**, and the customer
gets a signed link that expires after 30 days. A photo of somebody's front door
must not be publicly readable forever. **Do not put these behind a link
shortener** — carriers treat shortened links as a spam signal in 10DLC.

`npm run driver` is the terminal equivalent, and still the fastest way to test
an order through its whole day.

## The ops screens

Browser screens for Neil, at `/ops`. Built in `src/routes/admin.js`, which
renders HTML only — `src/routes/ops.js` stays the JSON API. Both share one
sign-in check in `src/core/admin-auth.js`, so they cannot drift apart.

```
GET  /ops                    orders board: active, upcoming, past
GET  /ops/orders/:id         one order, plus the message thread
GET  /ops/customers          everyone, with order counts and lifetime billed
GET  /ops/customers/:id      profile, preferences, consent record, history
GET  /ops/messages           every conversation, one row per phone number
GET  /ops/messages/:phone    one thread, oldest first, with delivery receipts
GET  /ops/partners           enquiries from /partners, newest first
POST /ops/partners/:id/status   NEW / CONTACTED / CLOSED
GET  /ops/team               who can sign in; add and disable people
GET  /ops/login              phone number     } the only two pages
GET  /ops/login/code         six-digit code   } reachable signed out
```

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

**New people default to `DRIVER`**, the least privileged role, and an
unrecognised role posted to the form falls back to it too. Promoting is
deliberate.

**Nobody can change their own role or switch themselves off.** Both would let
an admin lock themselves — and possibly everyone — out of team management.

**The `x-admin-key` machine credential bypasses roles entirely.** It is our own
scripts, it has no person attached, and it gets everything.

**The code is never stored.** `ops_login_codes` holds an HMAC of it keyed with
`ADMIN_API_KEY`. Six digits is small enough to brute-force offline, which is
exactly why the plaintext never lands in a row and why five wrong guesses kill
a code regardless of its expiry. Codes are single-use and last 10 minutes.

**The sign-in page must never reveal whether a number is registered.** An
unknown number gets the identical "check your phone" response. Otherwise
`/ops/login` becomes a way to find out who works here.

**The session cookie is not a credential.** It is `userId.expiry`, signed with
`ADMIN_API_KEY`. A leaked cookie expires on its own and never held a secret.
**Rotating `ADMIN_API_KEY` signs everybody out instantly** — that is the
emergency lever if a phone goes missing.

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

**Charging happens automatically at `/ops/weight`,** because that is the first
moment an amount exists. Two authorisations are already on record by then: the
consent given on the Stripe page, and the booking confirmation naming the card.
There is no third "reply YES to pay" step, on purpose.

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
```

`ASSIGNED` and `DEPOSITED` are the locker path and are unused at launch.
Residential orders go `REQUESTED -> IN_PROCESS` when the driver collects.

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
- **Price:** $2.50 per pound, weighed after pickup
- **Turnaround:** 24 hours
- **Scheduling:** pickup whenever the customer needs — no fixed route days
- **Model:** door-to-door pickup, for **houses and apartments alike**. An
  apartment customer puts their unit on `address_line2` and the driver comes to
  the door — nothing else differs
- **Lockers are shelved.** The hardware isn't working, so no locker is being
  built. The `lockers` and `buildings` tables stay (dropping them would be
  destructive and they cost nothing), `open_locker()` stays and refuses
  politely, and nothing on the website promises a locker
- **Service area:** Northern New Jersey, down to Jersey City
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
answer and must not be turned into one. The window we promise is arithmetic
around it — 30 minutes before, 60 after — and those two numbers live in one
constant in `src/core/booking.js`. Widening the window is a one-line change and
never needs a backfill, which is exactly why the asked-for time is stored rather
than the quoted window. The window is clamped to the same calendar day so a
late-evening pickup can't quote a time on Tuesday for a Monday booking.

This is **not** a menu of slots. There are still no fixed route days and no list
to choose from; the customer says when suits them, or says nothing.

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
