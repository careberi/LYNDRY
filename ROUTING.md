# ROUTING.md — the design for a state-aware routing engine

This is a design, not a description. **Nothing in the "Proposed" sections is
built.** What is already true is marked as such, so that nothing here gets
rebuilt by accident.

Written from Neil's architecture note of 13 August 2026.

---

## 1. Where this actually stands today

Worth stating plainly before designing anything, because it decides the order
the work should be done in.

| | Today |
|---|---|
| Customers | 0 |
| Orders | 0 |
| Drivers | 0 (one admin, who can toggle himself onto the round) |
| Partners | 2, one of which is a test record |
| Stripe | Code written, never run against live keys |

**The value of an optimiser scales with density.** With one van, two partners
and a handful of orders a day, "nearest partner that is open, has room and is
cheapest all in" lands within a few percent of optimal, and the few percent is
worth less than the cost of getting a routing engine wrong. The $16-saved-
tomorrow example in the architecture note is real — at maybe thirty stops a day
across four partners. It is not real at six stops across two.

CLAUDE.md's "explicitly not being built" list has said "multi-building routing
or route optimisation" since day one, and that instinct was right.

**So: the objects below are worth defining now** — a good schema costs nothing
extra to write today and is expensive to retrofit — **and the optimiser on top
of them is worth building when there is something to optimise.** Section 9 says
which pieces earn their place immediately.

---

## 2. One correction, and it matters

The architecture note is right and the current code is wrong about this.

`dispatch.assumedPounds()` returns `minimumCents / perPoundCents` = **12.5 lb**,
and a comment calls it "the honest floor … anything we collect bills as at least
12.5 lb, so that is what it is worth assuming it weighs."

That conflates two different numbers:

- **12.5 lb is a BILLING break-even.** Below it the customer pays $25 anyway.
- **Physical weight is what a van carries and a laundromat processes.**

Somebody can hand over 7 lb and owe $25. Using the billing figure as a capacity
and cost input systematically over-states small loads.

The right model is an **estimate that improves**:

```
estimated_weight_lb  =  mean of that customer's last N weighed orders
                        else 12.5 lb as the cold-start default
actual_weight_lb     =  set at the scale, replaces the estimate everywhere
```

Cheap to build, improves capacity planning, cost comparison and partner choice
at once. **This one is worth doing now** — see section 9.

---

## 3. What is already true

Do not rebuild these.

**The clip is already separate from the bag's identity.** `bag_labels.code` is a
permanent Crockford base32 identity minted at print time and bound to one order;
`clip_number` is a temporary van locator, freed at the laundromat by stamping
`unclipped_at`. Exactly the architectural split the note asks for.

**The route is already solved from where the van is.** `dispatch.currentPosition()`
derives it from the last stop actually finished. `base` is what the route is
measured from; `home` is where the day ends.

**Partner choice already prices driving, not just the wash.** Total cost is
`pounds × wholesale_rate + (miles out + miles back) × cost_per_mile`, with the
cost of a mile built from fuel at the configured mpg, wear and the driver's wage.
A cheap laundromat 50 miles away loses by $124.

**Bags already have per-bag weights and per-bag scale photos**, and the order
weight is their sum.

**"Never re-sequence a run that is already physical"** is already the rule — bags
in the van keep their stop numbers. That is section 9 of the note (locked vs
flexible) in its simplest form.

**Every status change is already append-only** in `order_events`.

---

## 4. Proposed: the objects

### 4.1 The big change — `Bag` becomes a first-class thing

Today a bag is a `bag_labels` row: a sticker bound to an order, with a weight
and a clip. State lives on the **order**.

The note is right that state belongs on the **bag**, because two bags of one
order can legitimately be in different places — one at a laundromat, one still
in the van.

```
bag
  id                  uuid pk
  order_id            uuid -> orders
  code                text unique          -- permanent identity, on the sticker
  position            smallint             -- bag 2 of 3, for the customer
  state               text                 -- see 4.2
  estimated_weight_lb numeric(6,2)         -- before the scale
  weight_lb           numeric(6,2)         -- after it
  weight_photo_path   text
  weighed_at          timestamptz
  partner_id          uuid -> partners     -- INTENDED until dropped, then locked
  partner_locked      boolean default false
  clip_number         smallint             -- temporary van locator, nullable
  clipped_at          timestamptz
  unclipped_at        timestamptz
  due_back_at         timestamptz          -- the promise, per bag
```

`bag_labels` already carries most of this. The migration is mostly renaming and
adding `state`, `estimated_weight_lb`, `partner_id`, `partner_locked`.

### 4.2 Bag states

```
BOOKED            the order exists, nobody has been yet
IN_VAN_DIRTY      collected, weighed, clipped
AT_PARTNER        handed over, being processed
READY             the laundromat has finished it
IN_VAN_CLEAN      scanned back into the van
DELIVERED         back at the door
```

Text column with a CHECK, never an enum — same rule as every other status here.

**This does not replace the order's status; it derives it.** An order is
`IN_PROCESS` while any bag is, `READY` when all bags are. One place still decides
what the customer is told.

### 4.3 `Stop` and `StopAction`

The note's central insight: a stop is a place with **several actions**, not a
destination with one purpose.

```
stop
  id            uuid pk
  route_id      uuid -> route
  sequence      integer
  kind          text          -- CUSTOMER | PARTNER | BASE
  customer_id   uuid          -- one of these two
  partner_id    uuid
  status        text          -- COMPLETED | LOCKED | FLEXIBLE | TENTATIVE
  eta           timestamptz
  arrived_at    timestamptz
  completed_at  timestamptz

stop_action
  id            uuid pk
  stop_id       uuid -> stop
  bag_id        uuid -> bag
  kind          text          -- COLLECT | DROP | RETRIEVE | DELIVER
                              -- CLIP_ON | CLIP_OFF | WEIGH
  done_at       timestamptz
```

That is what makes "drop bags 4, 6 and 10, collect bag 82, and leave bag 9 in the
van" expressible. Today the run infers actions from order status, which cannot
express leaving one bag aboard deliberately.

### 4.4 `Route`

```
route
  id            uuid pk
  driver_id     uuid -> ops_users
  date          date
  status        text          -- PLANNED | ACTIVE | CLOSED
  planned_at    timestamptz
  horizon_end   timestamptz   -- how far ahead this plan looks
```

**A route is the current best plan, not a commitment.** Completed stops are
immutable history; flexible and tentative stops are recomputed after every stop
completion.

### 4.5 Additions to what exists

**`ops_users`** (the driver) gains **only these four**:

```
  shift_start_at    time
  shift_end_at      time
  wage_cents_hour   integer      -- per person, not one global number
  overtime_after_min integer
```

Two items from the architecture note's driver list are deliberately **not**
here, at Neil's instruction:

- **No GPS or live location.** The van's position is derived from the last stop
  actually completed, which the system already knows. Following a driver around
  all day would mean holding a continuous record of where an employee is, and
  the derived answer is good enough to route from.
- **No new home/base field.** It already exists — `base_address_line1` and the
  rest on `ops_users`, geocoded, with the service base as the fallback.

**`vehicle`** — new, one row per van:

```
  id               uuid pk
  driver_id        uuid -> ops_users   -- who is in it today
  max_weight_lb    integer
  max_bags         integer
  clip_count       smallint            -- replaces config.routing.vanClips
```

Capacity is a **hard constraint**, not a cost. Today nothing stops the optimiser
loading 500 lb into a 400 lb van because it does not know the van exists.

**`partners`** gains what the note correctly identifies as missing:

```
  turnaround_minutes      integer   -- $0.90/lb at 30 hours is a different
                                    -- business from $1.15/lb at 10
  dropoff_cutoff          time      -- after this, it is tomorrow's wash
  processing_capacity_lb  integer   -- distinct from daily_capacity_lb:
                                    -- what they can still take TODAY
```

**`customers`** gains:

```
  estimated_weight_lb  numeric(6,2)  -- rolling mean of weighed orders
```

---

## 5. Hard constraints vs soft costs

The distinction the note draws is the one that stops an optimiser doing
ridiculous things to save twenty cents.

**Hard — the plan is invalid if violated:**

- van weight and bag count
- partner remaining capacity
- partner opening hours and drop-off cutoff
- a bag cannot leave a partner before it is finished
- a bag cannot be delivered before it is clean
- the driver cannot be in two places at once
- **the next-day promise** (`fulfilment.dueAt`)

**Soft — minimised:**

```
route_cost = labour + vehicle + processing + overtime
           + late_delivery_penalty + late_pickup_penalty
```

- **labour** = `(drive + service) minutes / 60 × wage`. Service time matters and
  is already configured: 4 min a door, 10 min a laundromat.
- **vehicle** = `miles × cost_per_mile` (already built).
- **processing** = `Σ bag_weight × partner_rate` (already built).

**The promise is a hard constraint, not a penalty.** A soft SLA cost lets the
optimiser sell a customer's deadline for $4. It must not be able to.

---

## 6. The rolling horizon

The note's strongest idea, and the one that most needs density to pay off.

Rather than optimising today, optimise **everything known for the next 24–48
hours**, so tomorrow's shape can justify a detour today. This is what makes
"$3.80 more today, $16 less tomorrow" expressible.

Tomorrow's stops are `TENTATIVE`: they inform today's decisions and are never
promised to anybody.

**This is the piece to build last.** It is worth nothing until there are enough
stops for the second day to have a shape.

---

## 7. Flexible partner assignment

Until a bag is physically scanned in at a laundromat, `bag.partner_id` is an
**intention**. A pickup fifteen minutes later near a different partner can move
it. Scanning in sets `partner_locked = true` and it stops moving.

Cheap, and genuinely useful even at low volume.

---

## 8. The loop after every stop

```
Complete Stop
  -> record actions, update bag states
  -> update van position, contents, free clips
  -> replace estimated weights with actual ones
  -> update partner remaining capacity
  -> pull in new orders and newly-ready laundry
  -> re-assign partners for unlocked dirty bags
  -> re-solve FLEXIBLE and TENTATIVE stops only
  -> lock the next stop
  -> tell the driver one thing
```

**Completed is immutable, current state is truth, the future is optimisable.**
The driver never sees any of it — he sees the next stop and its actions, which
is what `/ops/run` already does.

---

## 9. What to build, in order

**Now — cheap, useful at any volume, no optimiser needed:**

1. **Fix the weight estimate.** Rolling mean per customer, 12.5 lb cold start.
   Corrects a real inaccuracy in partner choice today. *(Small.)*
2. **Partner turnaround and drop-off cutoff.** Two fields plus a constraint.
   Without them a cheap slow laundromat can silently break the next-day promise.
   *(Small.)*
3. **Vehicle capacity as a hard constraint.** Nothing currently stops an
   overloaded van. *(Small.)*
4. **Flexible partner assignment until scanned in.** *(Small.)*

**When there is a second driver or ~15 stops a day:**

5. `Bag` as a first-class object with its own state machine.
6. `Stop` / `StopAction`, so a stop can hold several actions and a bag can be
   deliberately left aboard.
7. Locked / flexible / tentative route segments.

**When there are ~30 stops a day across 4+ partners:**

8. The rolling 24–48h horizon.
9. A real solver. At that point this is a pickup-and-delivery problem with time
   windows and capacity, and hand-rolled greedy insertion stops being good
   enough. Use an established solver rather than writing one.

**Not an LLM.** Routing is arithmetic, and an LLM would make it
non-deterministic, unexplainable and slow — the page can currently show its
working, which is how the Ridgewood bug was caught. If greedy insertion is
outgrown, the answer is OR-Tools, not a chat model.
