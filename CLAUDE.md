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
| 4 | The brain: Claude tool-calling, seven actions, order state machine | |
| 5 | Website, signup form, consent capture | ✅ live at lyndry.com |
| 6 | Ops endpoints, photo upload, status texts | |
| 7 | Shelly lock integration, plus a fake lock driver | |

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

**The visual system is telnyx.com's, with LYNDRY's own accent colour.**

- Background `paper` (#fefdf5), a warm cream. Never plain white for a page.
- Text `ink` (#0a0a0a). Secondary text is `text-ink/70`, not a grey scale.
- Headings use `Outfit` (set once in the layout's `<style>`, so pages don't
  repeat a font class). Body text is `Inter`.
- Buttons are pills — `rounded-full`.
- Section labels are small, bold, uppercase, widely letter-spaced.

**Accent colour is `brand-600` (#178a94), taken from the physical locker.** It's
the one colour on an otherwise black-and-cream page. Use it for buttons, icons
and step markers; don't introduce a second accent.

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
  core/       brain.js  actions.js  orders.js  lockers.js  compliance.js
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
- **Model at launch:** residential home pickup. Lockers come later
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
