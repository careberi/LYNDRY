# LYNDRY

Laundry pickup and delivery. The whole customer experience happens over text
message — there is no app to download.

**Wash, dry and fold. $2.00 a pound. Picked up when you need it, back the next day.**

## Status

**Live at [lyndry.com](https://lyndry.com).** The website, signup form and
consent capture all work against the real database. Inbound texts are handled
end to end, but messaging is switched off until carrier registration is approved.

Phases 1, 2, 3 and 5 are done. Phase 4 — the AI that reads customer messages —
is not built yet, so a text currently gets a fixed placeholder reply.

## How it works

A customer texts LYNDRY. Claude reads the message and turns it into exactly one
action — create an order, check status, reschedule, cancel. The code then carries
that action out against the database. A driver collects the bag from the
customer's home, it is washed, and it comes back clean to their door with a photo
as proof of delivery.

Longer term, LYNDRY puts smart lockers in apartment buildings so nobody has to be
home at all. The database and the code are built to accept that, but we are
launching with residential home pickup first. See `DECISIONS.md`.

## Stack

| Piece | What it is |
|---|---|
| Node.js + Express | The one server that runs everything |
| Supabase (Postgres) | The database |
| Telnyx | Sends and receives text messages |
| Anthropic SDK | Turns a customer's text into one structured action |
| Shelly | Smart relay that physically opens a locker (later) |
| Railway | Where the server is hosted |
| Static HTML + Tailwind (CDN) | The website, served by the same server |

One repo, one deploy, no build step. There is nothing to compile.

## Running it on your own computer

You need [Node.js](https://nodejs.org) version 20 or newer. Check what you have
by opening a terminal and running `node --version`.

**1. Install the libraries the project depends on.** You only do this once, and
again whenever a new library gets added.

```bash
npm install
```

**2. Create your settings file.** `.env.example` lists every setting with a note
on where to find it. Copy it to a new file called `.env` and fill in what you
have. Blanks are fine for now.

```bash
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead.

**3. Start the server.**

```bash
npm run dev
```

`npm run dev` restarts automatically every time a file is saved, which is what
you want while working. `npm start` runs it once without restarting, which is
what the server does in production.

**4. Check it's alive.** Open <http://localhost:3000/health> in a browser. You
should see something like:

```json
{ "status": "ok", "service": "lyndry", "version": "0.1.0" }
```

To stop the server, press `Ctrl+C` in the terminal.

## Putting test data in the database

```bash
npm run seed
```

This creates a test building, five lockers, and Neil as a customer. It is safe
to run as many times as you like — it reuses what's already there rather than
making duplicates. Edit the values at the top of
[scripts/seed.js](scripts/seed.js) to change what it creates.

## Testing it without a phone or a driver

Two simulators. The server must be running (`npm run dev`) in another terminal.

**Pretend a customer texted you:**

```bash
npm run sms -- "laundry tomorrow"
```

It builds the exact webhook the SMS provider would send, posts it, and prints
the conversation that resulted. Try `STOP`, `HELP`, `where's my laundry`, or
`cancel it`.

**Pretend you're the driver:**

```bash
npm run driver
```

That prints today's run sheet. Then walk an order through the day, using an id
from the sheet:

```bash
npm run driver -- collected <order-id>
```

Followed by `weight <order-id> 18.5`, then `out <order-id>`, then
`delivered <order-id>`. The customer gets a text at every step.

## The database

The five tables are `buildings`, `customers`, `lockers`, `orders` and `messages`.

The schema is kept in this repo as numbered SQL files under
[supabase/migrations](supabase/migrations/), which is the record of what the
database looks like. If the schema needs to change, add a new numbered file —
don't only change it in the Supabase dashboard, or the repo stops being true.

All five tables have row level security switched on with no policies, which
means Supabase's public key can read nothing at all. Only this server, using the
service_role key, can touch the data.

## Deploying

Hosted on [Railway](https://railway.app), pointed at this repo's `main` branch.
Every push to `main` deploys automatically. There is no build step.

`railway.json` holds the deploy settings. Railway pings `/health` to decide
whether a new version came up successfully; if it doesn't answer, the old one
stays live.

### Environment variables to set in Railway

Railway has its own settings screen — the `.env` file on your laptop is never
uploaded. Set these under the service's **Variables** tab:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_BASE_URL` | the public address, no trailing slash |
| `SUPABASE_URL` | from `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | from `.env` |
| `TELNYX_API_KEY` | from `.env` |
| `TELNYX_PUBLIC_KEY` | from the Telnyx portal |
| `TELNYX_MESSAGING_PROFILE_ID` | from `.env` |
| `LYNDRY_PHONE_NUMBER` | from `.env` |
| `ADMIN_API_KEY` | a long random string |
| `ANTHROPIC_API_KEY` | once phase 4 exists |
| `SUPPORT_PHONE` | Neil's mobile, for handoffs |

`PORT` is set by Railway automatically — don't add it.

**Missing Telnyx credentials do not stop the site.** The server boots, serves
every page, and refuses all inbound texts until both Telnyx keys are present.
That is deliberate: the website has to be live for carrier review before
messaging is approved.

## The other files in here

- **`.env.example`** — every setting the app needs and where to get it
- **`CLAUDE.md`** — the conventions this codebase follows, so future work stays consistent
- **`DECISIONS.md`** — anything decided on Neil's behalf, and the reasoning

## A note on secrets

`.env` holds the real passwords and API keys. It is listed in `.gitignore` and
must never be committed. If a key ever does end up on GitHub, treat it as
compromised: rotate it at the provider rather than just deleting the commit.
