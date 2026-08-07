# LYNDRY

Laundry pickup and delivery. The whole customer experience happens over text
message — there is no app to download.

**Wash, dry and fold. $39 a bag. Picked up when you need it, back within 24 hours.**

## Status

**Phase 1 complete** — the server runs and answers a health check. No database,
no text messaging and no AI yet. Those arrive in phases 2, 3 and 4.

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

## Deploying

Not set up yet — that happens in phase 5, when the website needs to be publicly
reachable for carrier registration. It will be Railway, pointed at this repo's
`main` branch.

## The other files in here

- **`.env.example`** — every setting the app needs and where to get it
- **`CLAUDE.md`** — the conventions this codebase follows, so future work stays consistent
- **`DECISIONS.md`** — anything decided on Neil's behalf, and the reasoning

## A note on secrets

`.env` holds the real passwords and API keys. It is listed in `.gitignore` and
must never be committed. If a key ever does end up on GitHub, treat it as
compromised: rotate it at the provider rather than just deleting the commit.
