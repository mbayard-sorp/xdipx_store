# Concept Wire — The Next Step

> Routine B (Design Cycle) ambition-mandate deliverable, run #183, 2026-08-05.
> Mission brief §9: carry at least one genuinely new exploration/self-discovery
> experience concept to a wire each cycle. **This is a design artifact only.**
> Nothing here ships without IA review, additive-only Sanity schema, and an
> `emma-empathy-reviewer` pass on every customer-facing string. All copy below
> is **illustrative** and has not cleared the voice gate. The doctrine
> (`docs/design-doctrine.md`) wins over this wire on every visual call; the
> voice charter (`docs/emma-voice.md`) wins over everything. Format precedent:
> `concepts/sensation-map.md`, `concepts/either-or.md`, `concepts/how-you-arrive.md`.

## 1. The idea in one line, and the job it serves

Ask the visitor **what they already know** — one toy they own, one thing they
have tried, or "I'm brand new" — and reveal the single **honest next step just
past it**: one real product that is the natural rung up from where they are,
with a plain, shame-free line for why it is the next thing and not a random
upgrade. A bullet-owner is shown a wand and told, in Emma's words, what the
wand does that the bullet never will. A couple who have played with a shared
vibe is shown the next shared frontier. "Brand new" is shown the surest,
gentlest on-ramp. Every reveal is a direct `/products/{handle}` link.

**Journey job (mission brief §7): DEEPEN first, TEMPT close.** The three
finders we already have (Compass, Sensation Map, Either / Or, How You Arrive)
all answer the same question in different shapes: *what fits you right now?*
They are matchers. **The Next Step answers a question none of them asks: what
comes after the thing that already fits you?** It is built for the visitor who
is not lost (they know something) but is quietly curious about the frontier and
does not know it is safe to look. It moves them one honest step, names the step
plainly so the reach feels normal rather than daring, and resolves that reach to
a real, clickable product. Exploration that ends at a shelf, never a dead end
(§9).

## 2. Why it is new (not a repeat of what we have)

Four self-discovery surfaces already exist or are proposed. This must not be a
fifth matcher. The axis is different on purpose:

| | Compass (`/discover`) | Sensation Map (Nº 07 concept) | Either / Or (concept) | How You Arrive (concept) | **The Next Step (proposed)** |
|---|---|---|---|---|---|
| Question | "Which category suits me?" | "What sensation vocabulary is mine?" | "Which of these two pulls me?" | "How do I like it to build?" | **"What comes *after* what already fits me?"** |
| Entered from | Facets you already know | The catalog's sensation axes | Gut, pairwise | The self, embodied | **Where you already stand today** |
| Shape | Linear quiz → results page | Live two-dial instrument | Binary tap-game | Two draggable dials | **A single step: know → adjacent reveal** |
| What it teaches | A shape to look for | A word for a sensation | A named leaning | A tempo/touch preference | **That the next rung exists, and is normal** |
| Serves | The seeker | The curious | The cautious browser | The self-aware | **The curious-but-plateaued, and the reach in §5** |

The other four all take a visitor who does *not* yet know what fits and hand
them a fit. The Next Step takes a visitor who *already* has a fit and shows them
the frontier past it. It is the only surface that deliberately delivers the
**"reach"** job the mission brief's curiosity-spread rule asks for on every page
(§5: "a reach, something that stretches a browser's imagination") as an
*experience* rather than a slot we merely try to fill with a stretchy product.
Growth, not matching.

## 3. The interaction

One idea per viewport (Apple discipline, doctrine §7 bench). Three states, no
route change, no page reload.

**State A — the question.** A short prompt in Emma's mid-page register (not the
hero's v5 dial 9; this is a guide moment, not a sell beat) and a small set of
**starting-point chips**, not a search box:

- A row of the most-owned starter categories as chips: *A bullet* · *A wand* ·
  *A shared toy* · *Lube and nothing else yet* · *Brand new to all of this*.
- Chips are plain nouns (the charter's "sex toy is a normal noun" rule). No chip
  is phrased as a confession or a lack.

**State B — the step.** Tapping a chip reveals **one** product card (not a
grid), framed as the next rung:

- The card is a standard `StorefrontProductCard` (reuse, no new card system) with
  a one-line Emma frame above it in the plain-warm-to-evocative band (5-7, not
  9), naming *what this does that the thing you have does not*. Illustrative
  only: for *A bullet* → a wand, "A bullet finds one spot. A wand takes the
  whole area and does not let go." (final copy clears the voice gate.)
- Exactly one PDP link. A secondary "Show me another step →" swaps to a second
  adjacent product for the same starting point (an adjacency list of 2-3 per
  chip, ordered, never a random reshuffle), so the visitor can decline the first
  reach without leaving.

**State C — the soft close.** Under the card, the single Compass closer for the
visitor who wants to keep going: "Want the whole map instead? Find your fit →"
(`/discover`). This is the **one** Compass link the module is allowed (mission
brief §1's at-most-twice budget; this module spends one, and only if the page's
other Compass slot is free — IA rules the total).

Motion: the reveal uses the repo-native `Reveal` primitive (`fade`/`up`),
transform/opacity only, SSR renders the first chip's step as the visible
default state so there is no hidden SSR markup and no CLS. Reduced-motion
renders the final state. This is not the LCP hero and is never placed above it.

## 4. Data — reuses what exists, invents nothing

The concept invents no taxonomy and needs no new product data:

- **Starting-point chips** map to categories/product-type dials the catalog
  already carries (`productTypeDial`: `vibrator`, `wand`, `lube`, etc.).
- **The adjacency list** (which product is "the next step" from each starting
  point) is an **editorial ordering the team curates**, the same kind of
  judgment the team already exercises picking rails and pins. It is a small
  ordered list of real `/products/{handle}` per chip, not an algorithm and not
  a fabricated "people who bought X" signal (which we do not have and the brief
  forbids inventing, §11a.5).
- **The Emma frame line** per step is one charter-voice sentence, drafted by
  `emma-copywriter`, gated by `emma-empathy-reviewer`, grounded in what the
  product verifiably does (mechanism → experience, enrichment addendum), never a
  lived-experience claim.

If built, the adjacency lists live in an **additive** Sanity block (new doc
type, new file, per CLAUDE.md "Sanity schema — additive only"), read by the
loader with a fallback to an empty/hidden module. No existing schema is touched.

## 5. Voice notes (illustrative copy only)

- Register: Emma mid-page **plain-warm to evocative (5-7)**, not the hero's 9.
  This is a guide/deepen moment; heating it to the sell register would center the
  reach over the reader. The PDP the step links to still runs the full 9 on its
  own page.
- No challenge/dare framing anywhere ("see if you can handle a wand" is banned by
  the charter). The frame is abundance and permission: "when you're ready, this
  is where it goes next," never "step up."
- No countdowns, no urgency, no "Buy now." CTAs from the whitelist only ("Show
  me", "Find your fit →").
- Emma never claims to have used the starting-point toy or the next one. She
  speaks to what the reader will feel and what the spec/reviews describe, never
  what she has felt (charter, Emma section).
- Fresh language every step; rotate any frame line that starts to repeat across
  chips.

## 6. Why it is worth banking now, and why it is not built this cycle

Banked, not built, on purpose (mission brief §9, routine-design-cycle §1
traffic-gate note): with GA4 far below the 300-sessions/week threshold, no new
homepage machinery is measurable yet, and a new interactive module plus its
Sanity block is exactly the "new-machinery build" the routine says to defer while
sessions < 300/week. The value delivered *this* cycle is the design capital: a
genuinely new self-discovery axis (progression, not matching) specified far
enough that a future cycle can wire it fast once traffic returns or the build is
re-scoped as cheap-and-certain.

**Build gate before any code (all required):** IA review of where it sits and
whether it spends a Compass link (`homepage-ia`); additive Sanity block spec
(`sanity-content-builder`); the adjacency lists curated and every PDP link
verified live; every frame line through `emma-empathy-reviewer`; `design-critic`
on screenshots at 375/768/1440. It touches no route of its own (it is an in-place
homepage band), so it does not go to `tech-architect` for a URL decision unless a
standalone `/next-step` surface is ever proposed, which this wire does not.

## 7. Rejected / deferred alternatives this cycle (logged so ambition compounds)

- **A returning-visitor progression tracker** (remembers what you looked at last
  time and advances the step): rejected for now. It needs identity/state we do
  not have on an anonymous storefront and edges toward behavioral data the brief
  forbids fabricating; the anonymous chip-based version above delivers the same
  "next rung" feeling with zero tracking.
- **A full "curiosity ladder" with locked rungs that reveal as you go**: deferred
  as over-built for a first pass. The single-step reveal above is the minimum
  that proves the axis; a multi-rung ladder can grow from it if the step earns
  its place.
- **Auto-generating the adjacency from the scorer**: rejected. The scorer weights
  profitability at 35% (charter, Emma no-incentive note), so an auto "next step"
  would read as an upsell, not a guide. The step must be an honest editorial
  judgment the team can defend, exactly like a rail pick.
