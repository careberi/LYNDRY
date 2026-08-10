# DECISIONS.md

A running record of things chosen on Neil's behalf, and things still open.
Newest section at the top of each list. Review whenever you like.

---

## Live infrastructure

- **Site:** [lyndry.com](https://lyndry.com), hosted on Railway, auto-deploying
  from `main`. Domain registered at Namecheap, DNS pointed via CNAME.
- **Database:** Supabase project `lyndry` (`pauaemlehenfrnjvgzmc`).
- **SMS:** Telnyx, number **(201) 554-1877**, webhook `https://lyndry.com/sms`.
  Switched off until `TELNYX_PUBLIC_KEY` is set and 10DLC registration passes.

**Norton antivirus on Neil's laptop intercepts HTTPS** and re-signs every
certificate. It caused two separate failures during setup — Node refusing to
reach Supabase, and Chrome refusing lyndry.com — neither of which was a real
fault. If something works everywhere except Neil's machine, suspect this first.
The `--use-system-ca` flag in the npm scripts is the workaround.

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

### 2. Rotate the Supabase service_role key before launch

The `service_role` key was pasted into a chat transcript on 2026-08-07. It
bypasses every security rule on the database. Nothing is exposed today, but it
should be rotated before real customer data exists: Supabase dashboard →
Settings → API Keys. Then update `.env` and the Railway environment.

### 3. Neil's street address

`scripts/seed.js` uses a placeholder (`1 Placeholder Ave, Jersey City`). Harmless
for testing, but worth replacing so a simulated order looks like a real one.

---

## Product decisions — confirmed by Neil

**Lockers are shelved; apartments are served door-to-door.** The locker
hardware isn't working, so none is being built. Apartments are now explicitly in
scope and are handled exactly like houses: the customer puts their unit on
`address_line2` and the driver comes to the door.

What this changed, and what it deliberately didn't:

- Every locker promise came off the website — the "coming soon" card, the
  how-it-works paragraph, and the building-manager pitch on the contact page,
  which now offers door-to-door collection as the amenity instead.
- The `lockers` and `buildings` tables **stay**. Dropping them would be
  destructive and irreversible, they hold no customer data, and they cost
  nothing sitting empty.
- `open_locker()` **stays**, still taking no arguments. It resolves the
  caller's own order, finds no locker, and says so. Removing it would mean a
  customer texting "open my locker" gets an unpredictable answer instead of a
  clear one.
- **Anything a customer can read must not mention a locker** until one exists.


**Service area: Northern New Jersey, down to Jersey City.** This is a description,
not a boundary. Before the signup form goes live it needs to become a concrete
list of towns or ZIP codes, otherwise the form will accept customers who can't
be served. Phase 5.

**No legal entity until the concept is proven.** Neil's call, and a reasonable
one. Consequences to keep in view:

- Terms and privacy pages will name Neil as a sole proprietor. **A lawyer should
  read them before launch.**
- Carrier registration for business texting (10DLC) generally expects a
  registered company and an EIN. Sole proprietor registration exists but carries
  tighter limits — typically lower message throughput and no shortened links.
  This may constrain how fast LYNDRY can send texts. Worth confirming with
  Telnyx in phase 3 before it becomes a surprise.

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

## Ops decisions

**`/ops/weight` is a new endpoint, not in the original brief.** Weight-based
pricing means an order has no price until it is weighed, so something has to
record that. It computes the charge from the rate stored on the order, so
changing the price later cannot re-price completed work.

**`/ops/processing` was folded into `/ops/collected`.** In the residential flow
they are the same moment — the driver takes the bag and it is in process. Two
endpoints for one transition would just be two ways to do the same thing.

**Delivery photos are private, with a 30-day signed link.** A photo of a
customer's front door is not something to leave publicly readable. The bucket
denies everything by default and each link expires, which matches what the
privacy policy already promises.

**Deliberately not shortening those links.** They are long, and the delivery
text runs to about four SMS segments as a result — roughly 1.6 cents. A link
shortener would fix that and is exactly the wrong trade: carriers treat
shortened links as a spam signal in 10DLC. If the length becomes a problem,
serve the photo from a short path on lyndry.com instead — a branded domain is
what carriers actually want to see.

**The admin key is compared in constant time.** A plain `===` returns faster the
sooner it finds a wrong character, which is enough to guess a secret one
character at a time.

**`scripts/simulate-driver.js` exists because there is no admin UI.** It drives
the same endpoints a driver's phone would. Without it there is no way to test
the operations half of the product.

---

## SMS decisions

**Telnyx, as originally specified.** Twilio was briefly considered because an
account already existed with a Northern NJ number, but Neil had not been able to
get it working and asked for Telnyx. All Telnyx code is confined to
`src/providers/sms/telnyx.js`; nothing else in the codebase knows the name.

**Registration is a carrier requirement, not a provider one.** Switching from
Twilio to Telnyx does not avoid 10DLC brand and campaign registration — the
carriers demand it regardless of who sells you the number. Worth knowing before
the same wall appears twice.

**A fake SMS driver runs automatically when Telnyx credentials are absent.**
It prints outbound messages to the terminal instead of sending them, which is
what makes `npm run sms` useful before registration is approved. It accepts
unsigned webhooks, so `src/providers/sms/index.js` refuses to load it when
`NODE_ENV=production` — running it on a public server would let anyone
impersonate a customer.

**CANCEL is deliberately NOT treated as an opt-out keyword.** It appears on the
standard carrier list, but for a laundry service a customer texting "cancel"
almost always means "cancel my order", not "never text me again". Treating it as
an opt-out would silently break the product for anyone using the word naturally.
STOP — the keyword actually required — is handled, and Telnyx enforces opt-out
keywords at the platform level as a second line of defence. **Worth reviewing if
a carrier ever objects.**

**Keyword matching is strict: the whole message must be the keyword.** "STOP"
opts out; "stop by at 5" is a message about a pickup time and must not
unsubscribe anyone.

**Someone who has opted out gets no reply at all** until they text START.
Verified: a normal message sent while unsubscribed is logged but not answered.

**`npm run test:signature` proves the webhook signature check works.** In normal
development we run without Telnyx credentials, so that code never executes — a
mistake in it would sit unnoticed until launch. The script makes its own key
pair and checks that good signatures pass and tampered, foreign-key, missing,
stale and replayed ones all fail.

---

## Website decisions

**The design is the LYNDRY design system handoff (v2).** Neil supplied a bundle
— an implementation brief, a screen spec, the design file, an iPhone frame
component, and a complete CSS design system — and asked for the whole site to
match it. It is the third look this site has had and it replaces both earlier
ones outright.

| | Was (v1 "Organic") | Now (v2 design system) |
|---|---|---|
| Ground | `#f5ead8` warm cream | `#FFF8EC` warm cream |
| Accent | teal `#17919b` | Suds green `#0EA47A`, plus Sunbeam yellow and Lilac |
| Text and outlines | `#201e1d`, no outlines | ink `#101210`, **everything outlined** |
| Display face | Caprasimo 400 | Outfit 900 |
| Body face | Figtree | Schibsted Grotesk |
| Labels | Figtree 800 uppercase | Space Mono 700 uppercase |
| Shadows | soft, blurred | hard offsets in pure ink, no blur |
| Header | cream, teal wordmark | ink bar, paper wordmark |
| Corners | pills everywhere | 14/22/32px, pills only on badges |

**Tailwind was removed.** The previous two looks were Tailwind-via-CDN with an
inline config. This system is opinionated enough — a 3px ink outline, a hard
offset shadow, and a hover/press transform on every clickable thing — that as
utility classes it becomes forty characters of noise on every element. It is
plain CSS classes now, in `public/css/lyndry.css`, and the site has no CSS
framework and still no build step.

Tailwind's CDN build also carries a warning against production use, so this
removes a dependency rather than adding one.

**The design system's own CSS is vendored unmodified** into `public/css/ds/`.
The handoff calls it production-ready and says to adopt it rather than
reimplement it, which is right — it means a future update to the system is a
file copy, not a re-derivation. Everything LYNDRY-specific sits one level up.

**Icons are embedded, not fetched from a CDN.** The design system loads each
Lucide glyph at runtime from unpkg.com. We inline them in `public/css/icons.css`
instead. A CSS mask that fails to load does not degrade to "no icon" — it
degrades to a solid coloured rectangle, and this site's links get texted to
customers. The rule the handoff actually cares about — that swapping icon sets
is a one-file change — still holds.

**The phone mock is laid out at real iPhone size (402 × 874) and scaled to
0.6** as one piece, as the handoff specifies. Building it small instead would
mean shrinking every font, radius and bubble by hand and getting them wrong.
It is static: the handoff records that animation was added, reviewed and
removed on purpose.

**Grid ratios are classes, not inline styles.** Found the hard way: an inline
`grid-template-columns` beats the responsive media query, so the pricing band
stayed two columns on a phone and pushed 14px of horizontal scroll onto every
page. Ratios now live in `lyndry.css` as modifiers.

**Parallax displacement is clamped to start at zero.** The spec's formula,
taken literally, displaces everything above the fold before the visitor
scrolls at all. The threshold is `max(0, elementTop - viewportHeight)`.
Parallax is also switched off below 900px — on a single-column phone layout
there is nothing for it to do.

### Where this build departs from the handoff, and why

**The hero phone field goes to `/signup`, it does not text immediately.** The
handoff's product decision is "enter a number, we text you first". We cannot do
that: the unticked consent box on the signup page is our legal proof of opt-in,
and texting someone before we have it is the thing carriers deregister you for.
The number typed in the hero is carried across and prefilled, so nobody types it
twice.

**The invented customer testimonial is not on the site.** The handoff's own
notes list "Dani R. — customer since March" under placeholder content that is
not real business data. A made-up customer quote on a live site is not something
to ship. The panel keeps its shape and its Sunbeam fill and says something true
instead.

**Handoff content that is factually wrong for LYNDRY was dropped, not
reproduced:** lockers, dry cleaning, standing orders, rush service, $2.25/lb,
20 lb minimums, free delivery over $40, and the fake number (555) 018-2240. The
handoff flags all of it as placeholder written to make the design reviewable.

**Links on Suds green are ink, not `--suds-700`.** The spec asks for suds-700
links on the green consent block. Measured, that is 2.39:1 against suds-500 —
it fails WCAG AA for body text by a wide margin. Ink on the same green is
5.92:1. The underline stays, so a link still reads as a link. This is the only
place the build knowingly overrides a stated colour in the spec.

**The consent checkbox copy is the handoff's, verbatim, and must stay that
way.** It is what carriers read during registration and it is the evidence if
anyone ever disputes opting in. The server already refuses the form without the
box ticked, which the handoff lists as a production requirement.

**Three of the handoff's seven pages were not built** — Business accounts, FAQ
and About. Business accounts exists to quote a volume rate we have not set;
About needs a photograph we do not have. The FAQ content is folded into the
How it works and Pricing pages instead. Say the word and any of them can be
added.

**Pricing shows one plan, not three.** We sell one service at one price.
Inventing two more tiers to fill a three-card layout would be inventing business
decisions, so the three cards became: the price, what's in it, what isn't.

**The QR code is still generated but no longer placed on the home page.** The
handoff's home page has no QR block. `textUsQrSvg()` in `src/web/site.js` is
unchanged and `{{QR_SVG}}` still resolves, so it can be dropped onto any page.

**The `Wash · Fold · Deliver` marquee is gone.** It was the repeating band from
the previous look, and the new design has no place for it — the rising bubbles
and the fact rail carry that job now. If Neil wants it back it is a small piece
of CSS, but two competing repeating motifs on one page is one too many.

**The published phone number is (201) 554-1877** — the LYNDRY Telnyx number,
bought 2026-08-07. (It replaced an earlier Twilio number that was briefly on the
site.)
**Neil's personal number is not on the website anywhere.** Note that this number
cannot actually receive customer texts until business messaging registration is
approved. Blanking the two constants at the top of `src/web/site.js` hides the
number across every page, and the copy falls back to "sign up and we'll text
you" on its own.

**The QR code is generated in memory at first use**, not fetched from a QR
service and not stored as an image file. Nothing to manage, nothing to go stale,
no third party involved.

**Signup does not overwrite an existing customer.** Anyone can type any phone
number into a public form, so allowing an update there would let a stranger
change a real customer's delivery address. A number that already exists gets a
message directing them to email instead.

**Site-wide values live in one file** (`src/web/site.js`) and pages reference
them as `{{TOKEN}}`. Changing the price, the phone number or the service area is
a one-line edit rather than a hunt through nine HTML files.

**The legal pages are placeholders.** They accurately describe how LYNDRY
operates and are written to survive carrier review, but **a lawyer has not read
them.** The clauses most worth a professional eye are unattended pickup and
delivery, and the limitation of liability — those are the ones that matter when
something disappears from a doorstep.

---

## Technical decisions — made without asking

**`--use-system-ca` added to the npm scripts.** Something on Neil's machine
intercepts TLS connections (antivirus or network filtering), and Node does not
trust the Windows certificate store by default, so every request to Supabase
failed with "unable to verify the first certificate". This flag tells Node to
use the system store. Harmless on Linux, where the system store is the standard
one anyway.

**Row level security is on for all five tables, with no policies.** Every
Supabase project ships a public `anon` key meant to be embedded in web pages.
Without RLS, anyone holding that key could read customer phone numbers and
addresses. Enabling it with no policies denies everything; our server uses the
`service_role` key, which bypasses RLS, so the app is unaffected.

**A customer may only have one order awaiting collection at a time**, enforced by
a database index rather than application code. This is what makes "your open
order" unambiguous, which the security model depends on: `open_locker()` works
out which compartment to open purely from the caller's phone number, so there
must be exactly one answer. Orders already being washed or delivered are
excluded, so a customer can still book again while a previous order is in
progress. Relax this if it ever gets in the way.

**Schema lives in `supabase/migrations/` as numbered SQL files**, not only in the
dashboard. The repo has to be the record of what the database looks like,
otherwise rebuilding it means clicking through a UI from memory.

**Statuses are text columns with CHECK constraints, not Postgres ENUM types.**
Both prevent typos; CHECK constraints make adding a status a one-line change,
where altering an ENUM is awkward. This project is early and the statuses will move.

**Money is stored as whole cents in an integer** (`price_cents`, $39.00 = 3900).
Decimal types lose precision under arithmetic. Integers don't.

**Environment settings moved to `src/config.js`.** Originally in `index.js`, but
`scripts/seed.js` needs them too and doesn't start a web server. Same rule
applies: read once, frozen, nothing else touches `process.env`.

**The seed script is idempotent** — safe to run repeatedly. It reuses existing
rows instead of creating duplicates, so it can't quietly fill the database with
copies of the same test building.

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

## Payment decisions

**Stripe, using Checkout to save a card and off-session charges to bill it.**
Neil's own proposal, and the right one. Payment processing had been deliberately
deferred; he brought it back in scope with a specific architecture, which this
build follows.

The shape: SMS → LYNDRY → Supabase customer → Stripe customer → one Stripe
Checkout page → saved card → every order after that is text only. The phone
number stays the account identifier; there is still no login and no app.

**No card number is stored, logged or received anywhere in this system.** Only
Stripe's reference to a saved card, plus the brand and last four digits for
display. Taking real card numbers would put the business inside PCI DSS, a
compliance programme with audits attached. This design stays outside it.

**The card is required before the first booking, not at signup.** Signup stays
a website form with no payment step; `create_order` is what refuses. That check
is in code rather than in Claude's instructions, for the same reason
`open_locker()` takes no arguments — nothing a customer types should talk its
way past it.

**Charging happens automatically when the bag is weighed.** Chosen over waiting
for a second "YES". By that point two authorisations are already on record: the
consent text on the Stripe page, and the booking confirmation naming the card.
A second confirmation would stall the order overnight with the laundry already
washed, for no legal gain.

**The consent wording has to cover a variable amount.** Wash and fold is priced
by weight, so at the moment the customer agrees, nobody knows the figure. The
sentence in `src/core/billing.js` says the amount is worked out after weighing
and that we text the total every time. Read it before changing it — it is what
makes an off-session charge authorised rather than a surprise.

**A declined card does not hold up a delivery.** We deliver and chase by text.
Holding someone's clothes over a decline is a bad look and legally murky, and
the exposure is one order's revenue. `/ops/waive` is the lever for writing one
off; it records WAIVED rather than marking it paid, so the books distinguish
money that arrived from money that was let go.

**The payment link is `lyndry.com/pay/<token>`, not a Stripe URL.** Carriers
score a texted link partly by its domain. Same reasoning as the delivery-photo
links, and the same reasoning behind not using a link shortener.

**Stripe's idempotency key includes the attempt number.** Stripe caches the
result of a key, including a decline — so a key built only from order and
amount would replay "your card was declined" at a customer who had already
fixed their card.

---

## Deferred — deliberately not built

Customer app or login · admin dashboard · multi-building routing · TypeScript,
React, bundlers, Docker, job queues · more than one deployment target.
