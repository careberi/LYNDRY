# LYNDRY home hero — design record

This records the existing-world home hero refinement against Neil's pinned reference. It is a surface record, not a replacement global design system. Source: `C:/Users/neil/Desktop/LYNDRY-dev/public/pages/home.html` and the hero rules in `public/css/lyndry.css`. No repository files were edited during this documentation pass.

## Preserved tokens

These are the incumbent CSS token-file defaults, not a claim about live theme overrides or sampled screenshot colors.

| Variable | Source value | Hero use |
| --- | --- | --- |
| `--ink-900` | `#101210` | Text, outlines, receipt header, primary action |
| `--ink-700` | `#2E332E` | Supporting receipt text |
| `--ink-200` | `#C4CBC2` | Dashed progress connector |
| `--ink-100` | `#D8DDD6` | Receipt dividers |
| `--paper-050` | `#FFFDF7` | Receipt, secondary action, primary action lettering |
| `--paper-300` | `#EDE2CB` | Example label in the dark receipt header |
| `--suds-500` | `#0EA47A` | Hero ground and collection icon tile |
| `--suds-300` | `#6FDCBB` | Receipt header accent |
| `--lilac-300` | `#E0CCFA` | Offset backing and completed step |
| `--sunbeam-500` | `#FFD23F` | Current progress step and optional offer badge |
| `--font-display` | `"Outfit","Helvetica Neue",Arial,sans-serif` | Heading, actions, receipt title and total |
| `--font-body` | `"Schibsted Grotesk","Helvetica Neue",Arial,sans-serif` | Body text; mobile progress labels |
| `--font-mono` | `"Space Mono",ui-monospace,"SFMono-Regular",Menlo,monospace` | Receipt labels, desktop progress labels, fact rail |
| `--border-2` | `var(--border-w-2) solid var(--border-color)` | Fact-rail rule; underlying defaults are `3px` and `var(--ink-900)` |
| `--ease-pop` | `cubic-bezier(0.2,0.9,0.3,1.25)` | Action hover/press transition |

## Composition and type

- The H1 remains four deliberate lines: “Laundry” / “wash & fold” / “pickup &” / “delivery”. Outfit weight 900, line height `.91`, tracking `-.04em`; its hero-local size is `clamp(44px, 17cqi, 104px)` with a viewport fallback.
- Desktop pairs equally sized text and receipt columns. A hero-local maximum width of `1480px` and fluid gutter preserve the broader page container elsewhere.
- Two prominent actions follow the service description: ink “Book a pickup” first, paper “Check my price” second. Both use Outfit weight 800, outlined rounded shapes and hard offset shadows.
- The cream receipt has a black header, lilac backing offset without rotation, ruled information rows, a large example total and five labeled icon steps. “Collected” is the yellow current step; “Booked” uses lilac.
- Existing decorative bubble markup, animation and reduced-motion handling remain. Screenshots verify composition; bubble motion was not verified by still images.

## Responsive behavior

- At `900px` and below, the hero becomes one column with a `640px` maximum content width. Actions wrap and fill available width; the receipt stays visible after the actions.
- At `480px` and below, action targets retain a `56px` minimum height. Receipt padding, borders, corners and icons reduce; progress labels switch to body type in sentence case for legibility.
- Desktop and narrow mobile screenshots show all four headline lines intact, both actions, the full receipt, its explanatory note and the complete five-step timeline. No visible clipped text or overlapping elements was found in those captures.

## Content constraints

The receipt is explicitly an example: 30 lb, about $1.36 per lb, $40.86 total. Pickup, return and processing are included. Its note qualifies pricing by address, tier and bag weight. Return statements retain “when available”; the service description retains the existing return-expectation token. The visual record does not establish new pricing calculations or change payment, reminder or route behavior.

## Evidence and boundary

Inspected the narrow HTML/CSS source, supporting token declarations, reduced-motion rule, `hero-desktop.png`, and `hero-mobile.png` in this record's directory. This documentation pass did not run the customer flow or tests and does not mark the work Reviewed. The supplied screenshots show a development-site banner.

The working directory also contains unrelated existing changes beyond the hero. Those were neither audited nor modified here. No PRODUCT.md, global DESIGN.md or design sidecar was created; this scoped refinement preserves the incumbent system.
