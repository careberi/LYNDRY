# DECISIONS.md

A running record of things chosen on Neil's behalf, and things still open.
Newest section at the top of each list. Review whenever you like.

---

## Open questions — need Neil

### 1. Pricing model: pay-as-you-go only, or memberships too?

**Blocks:** the `/pricing` page (phase 5). Nothing before that.

Confirmed so far: **$39 per standardised LYNDRY bag, roughly 15–18 lb**, wash,
dry and fold.

Neil notes that earlier discussions (November) covered several payment
structures — payment link per order, card on file charged after a text
confirmation, monthly membership with a discounted rate, prepaid monthly
allowance, and a building/HOA-paid amenity model. Pound-based tiers were sketched
at $49 / $99 / $179 per month. A firm constraint from those discussions: **customers
must not be forced into a subscription just to establish a payment method.**

The standardised bag is a cleaner unit than pounds, so the natural next shape is
pay-as-you-go at $39/bag with memberships priced in **bags per month**.

**Engineering note, so this doesn't feel urgent:** it isn't. Postgres adds a
column to a live table in milliseconds, and `customers.preferences` is already a
flexible JSON field. Introducing a membership later is a cheap migration, not a
rewrite. The only real deadline is that the pricing page has to say something
truthful before it goes live for carrier registration. Decide by phase 5.

Recommendation: launch pay-as-you-go only, sell memberships once there are
enough customers to know what a typical month actually looks like.

### 2. Service area

Residential pickup needs a geographic boundary — towns, or a list of ZIP codes.
Without one, the signup form will collect customers who can't be served. Needed
for phase 5 signup and the homepage.

### 3. Legal entity

None registered yet. Two consequences:

- The terms and privacy pages will carry a placeholder name and jurisdiction.
  **A lawyer should read them before launch.**
- Carrier registration for business texting (10DLC) generally expects a
  registered company and an EIN. Sole proprietor registration exists but is more
  limited. **If forming an LLC is on the list, start it now, in parallel** — it
  may be the long pole, not the code.

---

## Product decisions — confirmed by Neil

**Launching residential, not apartment buildings.** This is a significant change
from the original brief, which assumed a smart locker in every building.

**Lockers stay in the design but dormant.** The `lockers` and `buildings` tables
and the lock provider adapter get built, so nothing needs re-architecting when
the first locker is installed. Shelly integration and `open_locker()` wait for
real hardware (phase 7). Chosen over deleting lockers entirely because the locker
is the eventual differentiator, and over building both paths now because no
customer would use it at launch.

**Consequence Neil should keep in view:** the locker existed so nobody had to be
home. Residential pickup without one brings that problem back. Marketing copy in
phase 5 must not promise what the launch model can't deliver.

**Pickup method is chosen per order** — bag left outside at an agreed time, or
handed to the driver in person. A default is captured at signup so SMS rarely has
to ask.

**Cancellation:** free and unconditional until the driver collects. Not
cancellable after that.

**Turnaround:** 24 hours. Pickup whenever the customer needs — no fixed route days.

---

## Technical decisions — made without asking

**Order states adapted for residential.** The locker path
(`REQUESTED → ASSIGNED → DEPOSITED → …`) is preserved but unused. Residential
orders go `REQUESTED → IN_PROCESS` when the driver collects, then
`→ OUT_FOR_DELIVERY → DELIVERED`. `CANCELED` is reachable only before the laundry
is in our hands, which matches the cancellation rule above.

**`customers` gains address fields** (street, city, state, ZIP), and `building_id`
and `unit` become optional. Residential customers have no building. Phase 2.

**`create_order` gains a `pickup_method` argument** — a direct consequence of
"customer chooses per order". It defaults from the customer's saved preference,
so a returning customer still gets zero follow-up questions.

**CommonJS (`require`), not ESM (`import`).** The most heavily documented Express
setup, which matters when the person maintaining this is searching an error message.

**Express 5, dotenv. Nothing else installed yet.** Libraries get added in the
phase that needs them, not up front.

**`node --watch` instead of nodemon.** Node has file-watching built in now, so
that's one fewer dependency.

**`PORT` added to the environment variables.** Not in the original list, but
Railway assigns the port at runtime and the app has to read it. Defaults to 3000
locally.

**`trust proxy` enabled.** Railway sits behind a proxy. Without this the app
records the proxy's IP rather than the visitor's — and `sms_consent_ip` is legal
proof of opt-in, so it has to be the real one.

**Model resolution is a boot-time config read for now.** Genuine validation
against the Anthropic API arrives in phase 4 with the SDK. What matters is
already true: it happens once at startup, never per message.

**Missing environment variables warn rather than crash.** A fresh checkout boots
and tells you what's missing, instead of failing with a stack trace.

**Graceful shutdown on SIGTERM.** Requests in flight finish before the process
exits during a redeploy.

**`.claude/settings.local.json` is gitignored.** It's machine-specific tooling
config, not project code.

---

## Deferred — deliberately not built

Payment processing · customer app or login · admin dashboard · multi-building
routing · TypeScript, React, bundlers, Docker, job queues · more than one
deployment target.
