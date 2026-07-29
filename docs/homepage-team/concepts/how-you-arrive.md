# Concept Wire — How You Arrive

> Routine B (Design Cycle) ambition-mandate deliverable, run #117, 2026-07-29.
> Mission brief §9: carry at least one genuinely new exploration/self-discovery
> experience concept to a wire each cycle. **This is a design artifact only.**
> Nothing here ships without IA review, additive-only Sanity schema, and an
> `emma-empathy-reviewer` pass on every customer-facing string. All copy below
> is **illustrative** and has not cleared the voice gate.

## The one-line

A two-slider self-discovery moment that reflects back *how the visitor likes to
arrive at pleasure* — their tempo and their touch — and routes each reading to
two or three real products, each with one Emma line. It teaches the visitor a
vocabulary for their own preference (self-discovery) in the same gesture that
moves them toward a product (the destination, per mission brief §1).

## Why it is new (not a repeat of what we have)

The team already has three discovery surfaces; this must not duplicate them:

- **The Compass (`/discover`)** is a multi-facet filter: mood × audience ×
  matters × budget. It is a *narrowing* tool for someone who already has a
  shape in mind. Powerful, but it asks the visitor to already know their own
  vocabulary.
- **Either / Or** (concept, run #76) is a rapid pairwise this-or-that. It reads
  preference by accumulation of binary taps.
- **The Sensation Map** (concept, run #36) maps the *catalog* across sensation
  dimensions — it is a map of products, entered from the product side.

**How You Arrive** is different on purpose: it is a *single embodied question*
rendered as two expressive, draggable dials, entered from the *self* side. Not
"which product," not "this or that," but "how do you like it to build?" One idea
per viewport (Apple discipline, doctrine §7 bench), done tactilely. The visitor
learns something about themselves in one screen and leaves holding two or three
products that match — exploration that ends at a shelf, not a dead end
(mission brief §9: "exploration that dead-ends is decoration").

## The interaction

Two horizontal sliders, generous, tactile, drag-to-set. Reduced-motion renders
the final reading statically (repo Motion rules; `use-reveal.ts`).

1. **Tempo** — *slow burn ↔ right now.* Directly the charter's own category
   axis ("Pace: slow burn (air pulsation, prostate) vs. right now (bullets)").
2. **Touch** — *feather-light ↔ deep and rumbly.* The intensity/depth axis the
   `sensation_dial` metafield already encodes per product.

As the visitor drags, a short reading updates live in the Emma mid-page voice
(never top-billed; she lives in the intro card, per the charter's Emma
placement rule). Below the reading, two or three product cards refresh to the
archetype the two dials land on.

### The 2×2 reading → product archetype map

The two axes give four corners; the live reading interpolates between them. The
archetype mapping is derived from `product_type_dial` + `sensation_dial`, both
already in Shopify — **no new product data required**, only a new read of it.

| | Feather-light | Deep & rumbly |
|---|---|---|
| **Slow burn** | Air pulsation, soft external | Wand, warm-up rituals, lube-led |
| **Right now** | Bullets, quick external | Deep vibration, realistics |

Illustrative reading copy (pending voice gate, do not ship as-is): a slow-burn /
deep-and-rumbly reading might reflect back something like *"You like the long
build. Pressure that arrives slow and lands heavy, the kind you feel low in your
hips."* Then two matching products, each with a single Emma line about the
payoff, `ctaLink` to `/products/{handle}`.

## How it serves the mission

- **Destination discipline (§1).** Every reading resolves to real product cards
  linking `/products/{handle}`. This surface is a *tempter*, not a `/discover`
  clone — it points at products, not at the finder. It never adds a
  `/discover` link (respects the two-link cap).
- **Both visitors (§7).** The seeker drags once and gets product; the browser
  gets a warm, non-clinical on-ramp that treats curiosity as the whole point
  and never assumes experience level.
- **Voice (§8).** The reading is desire-forward, act-adjacent, reader-centered,
  and reflects sensation without ever claiming Emma has felt it.
- **Weekly rhythm (§3).** The archetype corners can be re-seeded to the week's
  theme, so the same surface reads differently during Wand Week vs. a lube week
  without a code change — content-plane rotation over a stable shell.

## What it needs before it can be built (shipping stays disciplined)

1. **IA review** — this is a *new section type*, so it needs a named spec
   through `homepage-ia` and cannot enter the locked Nº01–Nº11 shell without
   one (routine §0.5 IA fence).
2. **Additive Sanity schema only** — a new `arrivalFinder` block document in a
   new file (block enable/disable, the two axis labels, the four corner
   readings as editable copy, per-corner product-handle lists). Never modify
   existing schema.
3. **Reads existing metafields** — `product_type_dial` and `sensation_dial` are
   already indexed; the mapping is a new read, not new data.
4. **Voice gate** — every reading string and every Emma product line clears
   `emma-empathy-reviewer` before publish.
5. **Design + motion** — `homepage-designer` sets the dial treatment on v3
   tokens; the live update is transform/opacity only and honors reduced motion;
   never wraps an LCP image (this surface carries none above the fold).

## Rejected alternatives this cycle (logged so ambition compounds)

- **Single-axis tempo dial only.** One slider (slow burn ↔ right now) is
  tactile but thin: it collapses to a category picker and teaches the visitor
  little about themselves. The second orthogonal axis (touch) is what turns it
  from a filter into a self-reading. Rejected as under-ambitious.
- **A full multi-question quiz.** A five-step quiz would duplicate the Compass
  and dead-end in a results page. Rejected: the Compass already owns
  multi-facet narrowing, and §9 wants *new* experiences, not a second finder.
- **A personality-label output** ("You're a Slow Burner"). Cute, but it risks
  boxing the visitor and reads as a BuzzFeed quiz, off-register for the calm
  shame-free voice. Rejected in favor of a sensory *reading* that describes the
  feeling, not a badge that types the person.

## Status

Proposal only. Not scheduled. Filed so the next design cycle can adopt it (or a
better idea it provokes) with the IA spec and additive schema already scoped
here. No code, no route, no schema written this cycle.
