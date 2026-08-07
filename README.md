# LYNDRY

Laundry pickup and delivery for apartment buildings.

Residents drop dirty laundry in a smart locker in their building, a driver collects
it, and it comes back clean to their door. The whole customer experience happens
over SMS — there is no app to download.

The locker exists to decouple the customer's schedule from the driver's route.
Nobody has to be home. Nobody has to wait.

## Status

Phase 1 — project skeleton. Not yet functional.

## Stack

| Piece | What it is |
|---|---|
| Node.js + Express | The one server that runs everything |
| Supabase (Postgres) | The database |
| Telnyx | Sends and receives text messages |
| Anthropic SDK | Turns a customer's text into one structured action |
| Shelly | Smart relay that physically opens a locker |
| Railway | Where the server is hosted |
| Static HTML + Tailwind (CDN) | The website, served by the same server |

One repo, one deploy, no build step.

## Running locally

Not yet available — the server is built in Phase 1.

## Deploying

Not yet available — set up in Phase 5.

## Docs in this repo

- `CLAUDE.md` — conventions and decisions, so future work stays consistent
- `DECISIONS.md` — anything chosen on Neil's behalf, and why
- `.env.example` — every environment variable, with a note on where to get it
