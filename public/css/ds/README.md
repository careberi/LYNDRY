# Vendored: the LYNDRY design system

These files are copied **unmodified** from the design handoff
(`design_handoff_lyndry/design-system/`). They are the token layer: colours,
type, spacing, borders and shadows, motion, and a few element defaults.

**Do not edit anything in this folder.** If the design system is updated,
replace these files wholesale. Everything LYNDRY-specific — buttons, cards,
inputs, the scallop, page furniture — lives one level up in
`public/css/lyndry.css`, which is ours to change.

`styles.css` is the single entry point; it `@import`s the rest.

## One change from the handoff

`tokens/fonts.css` pulls Outfit, Schibsted Grotesk and Space Mono from Google
Fonts with an `@import`. An `@import` inside a stylesheet blocks rendering until
it resolves, so `src/web/layout.js` also puts a `<link rel="preconnect">` to
Google's font hosts in the page head. The file itself is untouched.
