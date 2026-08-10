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
- An admin dashboard
- More than one deployment target
- TypeScript, React, a bundler, Docker, or a job queue

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

The seven tools:

```
create_order(service, pickup_date, pickup_method, notes)
get_order_status()
reschedule_order(new_date)
cancel_order()
open_locker()
update_profile(field, value)
handoff_to_human(reason)
```

Rules:

- `open_locker()` **takes no arguments — never change this.** The backend works
  out which compartment from the authenticated phone number's open order, and
  refuses if there isn't one. Claude cannot name a locker, a building or a
  customer, so no amount of clever texting gets someone into a locker that
  isn't theirs.
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

`npm run driver` is the ops equivalent of `npm run sms` — there is no admin UI.

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
- Unknown number → reply with a link to the signup page. Do not onboard over text.
- Log every message, both directions.

## Business facts

- **Service:** wash, dry and fold only
- **Price:** $39 per bag, flat
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
