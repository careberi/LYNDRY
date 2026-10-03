# AGENTS

LYNDRY is Neil's laundry pickup business. Neil is the product owner. He is not
the implementer.

## Source of truth

- GitHub `main` is the only shipped code.
- A GitHub Issue (or the current section in HANDOFF.md) is the spec for the
  change in progress.
- CLAUDE.md is how this codebase is written.
- DECISIONS.md is why a business rule exists. Do not "simplify" a rule in
  DECISIONS.md because it looks odd.

## Who does what

- **ChatGPT:** writes the spec in English. Rules, must-nots, edge cases. No code
  unless Neil explicitly assigns implementation.
- **Implementing agent (Codex, Claude Code, or another agent Neil assigns):**
  edits this repo when Neil assigns implementation. Implements one Issue at a
  time on a branch. Claude Code has no exclusive editing role.
- **Grok:** reviews the diff against the Issue. Looks for logic holes (example:
  reminder or route on an order with no card). Does not implement unless Neil
  asks for a patch spec.
- **Neil:** pastes work between tools, clicks the real customer flow, merges to
  main.

## How a change moves

1. Neil states the requirement.
2. ChatGPT returns a short spec. Neil puts that spec on a GitHub Issue (and may
   paste a copy into HANDOFF.md).
3. The implementing agent reads AGENTS.md, the Issue, and HANDOFF.md, then implements only
   that spec on a branch.
4. Neil pastes the diff or file list to Grok.
5. Grok returns findings: severity, file, failure scenario, what to change. No
   rewrite of unrelated modules.
6. The implementing agent fixes only those findings.
7. Neil click-tests. Then merge.

## Hard rules

- Never commit to main.
- One logical change per branch. Do not mix payment, driver QR, van clips, SMS
  identity, and admin-create-order in one PR.
- Do not modify unrelated files.
- The implementer cannot mark the work Reviewed.
- A bug fix needs a regression test when practical.
- No card on file means the order is not a real pickup: not on the driver route,
  no "have the bag out" reminder.
- Do not change payment, reminder, or route behavior unless the current Issue
  says so.
- Web bookings and text bookings may use different first-message wording; do not
  collapse them.
- If code and DECISIONS.md conflict, stop and flag it. Do not silently pick one.

## Definition of done

- Spec on the Issue still matches what shipped
- Tests added or updated
- `npm test` passes
- Grok review findings for this Issue are resolved or explicitly deferred by Neil
- Neil has clicked the flow

## Development notes

For every meaningful development change, update Neil's Obsidian vault at
`C:\Users\neil\Desktop\Agnets\LYNDRY` before reporting completion.
Read the vault CLAUDE.md, Index.md and latest Log.md first. Update the
Development Updates note, relevant topic notes and Log.md with the date,
what changed and why, branch or commit, validation performed, release status
and remaining actions. Distinguish development from shipped main and
implementation from independent review. Never copy customer contact details,
payment records or secrets. If the vault is unavailable, report the missing
update explicitly rather than claiming it was done.
