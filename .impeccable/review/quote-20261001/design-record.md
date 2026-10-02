# LYNDRY quote refinement — local design record

Recorded 1 October 2026. Development checkout: `C:/Users/neil/Desktop/LYNDRY-dev`.

## Overview

This records the finished quote refinement against the existing LYNDRY implementation. It does not establish a new brand or replace the incumbent stylesheet authority. No repository files, `DESIGN.md`, token files or design sidecar were created or changed by this documentation pass.

The surface presents one task in order: a heading and inclusion statement, the address, one synchronized weight control, then subscription and one-time comparison cards. Subscription remains first and receives the green primary action.

Directly inspected sources: `CLAUDE.md` (visual-system conventions); `DECISIONS.md:1–7` (current 18 lb minimum decision); `public/css/ds/tokens/{colors,typography,effects,base}.css`; `public/css/lyndry.css:2266–2364`; `src/web/weight-pricing.js`; and `public/js/weight-pricing.js`. Paths in this record are relative to the development checkout. The vendored token directory has no working-tree changes.

## Colors

The quote uses the existing palette and aliases:

| Source token | Existing value | Quote role |
|---|---|---|
| `--surface-page` → `--paper-100` | `#FFF8EC` | Cream page ground |
| `--surface-card` → `--paper-050` | `#FFFDF7` | Card and stepper fill |
| `--ink-900` | `#101210` | Strong text, outlines and hard shadows |
| `--ink-700` | `#2E332E` | Supporting text |
| `--suds-500` | `#0EA47A` | Primary action and slider thumb |
| `--suds-600` | `#087F5E` | Filled slider track |

The range track uses two solid color segments, expressed as a hard-stop CSS gradient in WebKit. This is control progress, not a new decorative treatment.

## Typography

The heading uses existing `--font-display`: Outfit, Helvetica Neue, Arial, sans-serif; weight 800, `clamp(32px,4.5vw,48px)`, line height 1.12. Copy, plan names and monetary figures use existing `--font-body`: Schibsted Grotesk, Helvetica Neue, Arial, sans-serif. Prices and totals use tabular figures to limit movement as weight changes. No font or global type token was introduced.

## Layout

The quote is capped at 960 px. Desktop cards form two equal columns with a 20 px gap. At 640 px and below they stack with an 18 px gap, subscription first, and the quote has 20 px side padding. Below 420 px, endpoint tier names move below their rates. Address text can wrap. The weight slider, direct number field and minus/plus buttons represent the same selection.

## Elevation & Depth

Cards retain ink outlines and a `4px 4px 0 var(--ink-900)` shadow, matching incumbent `--shadow-pop-sm`. The quote introduces no soft card shadow or overlay depth language.

## Shapes

Cards use 2 px ink borders and 16 px corners. The stepper has 12 px corners; quote actions have 10 px corners. These are local component dimensions, not additions to the global token scale.

## Components

- New estimates default to 30 lb while explicit selected weights are retained. Controls accept whole pounds from 1 through 50; the slider and step buttons update both tiers and their booking links together.
- Each tier exposes a full inclusive estimated total, its own minimum total and included allowance. New development minima are calculated at 18 lb. Below that allowance, the displayed minimum-order rate remains minimum total divided by included weight; above it, the display is the selected weight's average rate.
- Both tiers' rates remain visible at the 1–18 lb and 50 lb endpoints. Each card also states its 50 lb rate. Actual figures come from the pricing schedule and saved quote data, not hardcoded presentation prices.
- The shared booking slider labels wholesale rates when only that category is present. The public quote continues to show subscription and one-time only.
- Copy says pickup, return and processing are included. The expandable explanation distinguishes estimated weight from final measured weight and preliminary address pricing from confirmed booking terms.
- Controls have accessible names, visible focus treatment, 44 px or larger button/slider targets, boundary disabling, invalid-entry feedback and a status announcement. Invalid entries prevent the quote action from proceeding.

## Do's and Don'ts

- Preserve the incumbent tokens, subscription-first order and full inclusive totals when extending this surface.
- Keep minimum-order rates distinct from the actual average of a smaller bag. Do not infer billing from the displayed rounded per-pound amount.
- Keep this record local to the quote. No unrelated design audit or broader visual-system change was performed.

Finish evidence supplied by the parent task: the fresh Impeccable reviewer returned a ship disposition for this narrow visual refinement with no material fixes. Desktop and upper-mobile viewport evidence was valid. Lower-mobile evidence was a full-page capture cropped by 15 px; DOM gutters were separately verified. Relevant artifacts are `quote-eighteen-desktop.png`, `quote-eighteen-mobile-viewport.png` and `quote-eighteen-mobile.png` in this record's directory. This documentation pass inspected source and did not open a browser or independently repeat those checks.

That disposition is a design finish review, not Grok code review or a production release. Physical-phone verification, Grok review and Neil's booking click-test remain pending. GitHub main remains the shipped source of truth.

Final verification: npm test completed with 1,659 passing tests and two preexisting unrelated partner profile wording failures. All 21 focused quote and pricing tests pass.
