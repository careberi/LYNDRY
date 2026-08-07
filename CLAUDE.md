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

## Explicitly not being built

Don't add these; push back if asked too early.

- Payment processing (flat rate, payment collected manually for now)
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

**`src/web/layout.js` holds the single shared layout** — head, nav, footer —
plus the Tailwind colour palette. Page files in `public/pages/` contain only
their own middle section.

**The visual system is the LYNDRY design handoff** — the "Organic" system,
retinted to the LYNDRY teal. Every value below comes from it. If you need a
value the palette doesn't carry, that's a signal to ask, not to hard-code a hex.

| Role | Class | Value |
|---|---|---|
| Page ground — warm cream | `paper` | `#f5ead8` |
| Card and panel fill | `paperdark` | `#ebddc5` |
| Text | `ink` | `#201e1d` |
| Brand teal | `brand-500` | `#17919b` (full 100–900 ramp) |
| Second voice — sage | `sage-*` | used once, on the quote panel |
| Secondary text | `neutral-700` / `-800` | a warm grey ramp, not slate |

**Teal on cream only clears 3:1.** Fine for large text, icons and chrome; not
for paragraph copy. Accent-coloured body text uses `brand-700` or darker. Never
`text-brand-500` on a paragraph.

**The names are deliberately unchanged from the previous scheme**, so the whole
site re-skins by editing the values in `layout.js` rather than nine HTML files.

**Typography:** headings in `Caprasimo`, body in `Figtree`, both set once in the
layout. **Caprasimo ships at weight 400 only** — never put a bold class on a
heading, or the browser fakes it and the display face looks smeared. The layout
forces weight 400 on `h1`–`h4` to stop that happening by accident. A `<legend>`
or other non-heading that should look like a heading needs `font-display`.

**Everything is round.** Panels 16px (`rounded-lg`/`xl`), cards 28px
(`rounded-2xl`), and every button and input is a full pill (`rounded-full`).
Sharp corners are out.

Section labels ("kickers") are 14px, weight 800, uppercase, `tracking-[0.08em]`,
in `brand-700`. Content max-width is 1180px; section padding is `88px 32px`.

**Motion.** Two things, both defined once in `layout.js`:

- `{{MARQUEE}}` — the repeating `Wash · Fold · Deliver` band, the line printed
  on the bags. The list renders twice because the animation slides the track by
  half its width; with one copy the loop jumps.
- `class="reveal"` on a section fades it up as it scrolls into view.

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
POST /ops/weight             pounds in, price out         (sets price_cents)
POST /ops/out-for-delivery                                -> OUT_FOR_DELIVERY
POST /ops/delivered          multipart photo upload       -> DELIVERED
GET  /ops/today              the driver's run sheet
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
