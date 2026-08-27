# Concept Wire — Either / Or

> Routine B (Design Cycle) ambition-mandate deliverable, run #76, 2026-07-22.
> Mission brief §9: "every design cycle should carry at least one genuinely new
> exploration/self-discovery experience concept from the backlog to a wire or
> prototype." This is that wire. Shipping stays disciplined: this is a design
> proposal, **not built code**. The build lands a future cycle behind the
> reviewed-PR path. All copy below is **ILLUSTRATIVE ONLY** and must clear
> `emma-empathy-reviewer` against `docs/emma-voice.md` before any build. Design
> follows `docs/design-doctrine.md` (the doctrine wins over this wire on every
> visual call). Format precedent: `concepts/sensation-map.md`.

## 1. The idea in one line, and the job it serves

A lightweight, playful **binary "this-or-that" run**: the visitor taps through
three or four sensory card-pairs (slow-burn vs right-now, just-you vs the-two-of-you,
feather-light vs deep-pressure), and at the end Emma reads their leanings back to
them and reveals a **small set of real products that fit** — each a direct
`/products/{handle}` link. No sliders to reason about, no quiz to finish, just
"lean toward whichever one pulls you," four times.

**Journey job (mission brief §7): primarily TEMPT, with a DEEPEN undertone.** It
is an on-ramp built specifically for the *browser* — curious but cautious, the
person who will not commit to the Compass quiz and will not sit and reason with
the Sensation Map's two dials. A binary choice costs almost nothing to make, so
the cautious visitor keeps tapping, and each tap quietly teaches them a **word for
a leaning they already had** ("oh, I do want slow"). It advances self-discovery
because the payoff is a felt, named preference *plus* a clickable product that
meets it — exploration that resolves to product, never a dead end (§9).

## 2. Where it sits, and how it differs from Compass and the Sensation Map

Three self-discovery surfaces would now exist. They are deliberately different
shapes for different visitors, not three quizzes:

| | Compass (`/discover`) | Sensation Map (Nº 07) | **Either / Or (proposed)** |
|---|---|---|---|
| Shape | Linear multi-step quiz → results **page** | Live two-dial **instrument**, in place | Sequential **binary game**, in place |
| Interaction | Answer, then submit | Adjust a dial, watch results update | Tap one of two, advance, reveal at the end |
| Feel | "Fill out the finder" | "Play the instrument, study the read-out" | "Trust your gut, four times, get a surprise" |
| Cognitive load | High (many dimensions + budget) | Medium (two dials, both visible, analytical) | **Lowest** (one either/or at a time) |
| Payoff timing | After you finish | Continuous, every adjustment | A small **reveal moment** after the last tap |
| Primary visitor | The genuinely-lost (the single closer) | Seeker-as-fast-filter + browser | **Browser-first** on-ramp |
| Teaches | Which category suits you | A vocabulary of sensation (rumbly/buzzy) | A vocabulary of **leanings** (pace, company, touch) |

The novelty is **momentum and low stakes**: the Sensation Map is a calm
instrument you *consider*; Either / Or is a kinetic little game you *play through*
to a reveal. The Map asks you to hold two variables in your head at once; Either /
Or never shows you more than one choice at a time. That is the whole point for a
cautious first-timer.

**Placement — two IA options (see §8 for the fence status):**

- **Option A (recommended, lower IA cost): the Nº 07 slot hosts either
  instrument.** Either / Or and the Sensation Map are two renderers for the same
  "discovery instrument" position in the locked shell; the team picks one per week
  via an additive Sanity toggle. This *adds nothing to the IA taxonomy* (the slot
  already exists), serves the weekly-freshness mandate (§3) for free, and keeps
  the page from stacking three finders. Ground stays a single tint beat between
  Emma's edit (paper-2) and Couples (paper-3).
- **Option B (higher ambition, full IA review): a new dedicated on-ramp band
  after Nº 03.** Inserted right after the wall-of-product grid (paper) so a
  browser who bounced off the grid gets a playful on-ramp before Meet Emma
  (paper-2). Ground: `coral-soft` — giving `paper → coral-soft → paper-2`, a warm
  beat in the alternation. This renumbers Nº 04–Nº 11 and is a **new
  section-type**, so it needs the full `homepage-ia` new-section-type spec first.

## 3. Wireframe — 375px first

**Question state (375px):**

```
┌───────────────────── 375px ─────────────────────┐
│  Nº 0X   EITHER / OR                (mono kicker) │
│                                                  │
│  Follow the pull.        (Newsreader H2, plum .em)│
│  Four quick taps. No wrong answers.   (body ink-3)│
│                                                  │
│   ● ○ ○ ○                (progress dots — 1 of 4) │
│                                                  │
│   Tonight, you want it...            (prompt)     │
│  ┌───────────────┐    ┌───────────────┐          │
│  │   (paper)     │    │   (paper)     │          │
│  │               │    │               │          │
│  │  Slow and     │    │  Right now    │          │
│  │  building     │    │               │          │
│  │  ~~~~~~~      │    │   ⚡           │  (glyph,  │
│  │               │    │               │  not text │
│  └───────────────┘    └───────────────┘  in a img)│
│    ↑ two cards side-by-side even at 375px,        │
│      each ~46vw, on a FIXED-HEIGHT stage          │
└──────────────────────────────────────────────────┘
```

**Reveal state (375px) — same fixed-height stage, cross-faded:**

```
┌───────────────────── 375px ─────────────────────┐
│  Nº 0X   EITHER / OR                              │
│   ● ● ● ●                         (all four done) │
│                                                  │
│  ♥ You lean slow, and you lean solo.  (italic     │
│    These three meet you right there.   sage ♥)    │
│                                                  │
│  ┌────────┐  ┌────────┐  ┌────────┐               │
│  │ product│  │ product│  │ product│  → /products/ │
│  │  card  │  │  card  │  │  card  │    {handle}   │
│  └────────┘  └────────┘  └────────┘               │
│                                                  │
│  See the full fit →   (quiet ink→plum → collection)│
│  Start over           (fine-print reset, ink-4)   │
└──────────────────────────────────────────────────┘
```

**Desktop:** one calm centered band inside `max-w-[1320px]`, `px-16`. The two
option cards grow larger and stay side-by-side, progress dots above the prompt.
The reveal swaps the same stage for the Emma read line + a 3-up product row +
the two links. It is *one band*, not a split layout — the game is the focus, the
reveal is the payoff, and nothing reflows because the stage height is fixed
across both states.

## 4. Art direction (per `docs/design-doctrine.md`)

- **Ground (the tinted beat):** Option A → `plum-soft` (inherits the Nº 07 slot's
  guided-discovery ground). Option B → `coral-soft` full-band tint (warm, playful
  on-ramp; a tint fill, not the rationed primary coral). Either way it honors the
  ground lock (§4) and the alternation rule (§1).
- **Type:** mono kicker `EITHER / OR`; Newsreader H2 with **exactly one** plum
  `.em` word ("Follow the *pull*."); DM Sans for prompts, card labels, and body.
  The `Nº 0X` numeral motif rides the band per the edition system.
- **The two option cards sit on neutral `paper`, equal weight.** Neither pole is
  "the coral one" — coloring one card would bias the tap and would spend the coral
  budget on decoration. Cards get a hairline `border-line` and 22px radius, not a
  shadow (doctrine §3/§6).
- **Coral budget (§3 hard rule — one primary-coral element per viewport):** in the
  *question* viewport the single saturated-coral element is the **active progress
  dot**; the tap-feedback hairline that draws on the chosen card is transient. In
  the *reveal* viewport the product cards own their standard treatment and "See
  the full fit →" is a quiet ink→plum text link (mirroring the Sensation Map),
  so no second coral fights for attention.
- **The ♥ motif** appears once, on Emma's read line in the reveal (sage ♥, an Emma
  aside — a sanctioned use per §3). No scattered hearts.
- **Imagery — prefer NONE, so a build is not gated on fal.ai.** v1 ships as
  **type + tint + a single line glyph per card** (e.g. a soft wave rule for "slow,"
  a spark for "right now") drawn in markup/SVG, no generated pixels, no baked text.
  The real product photography arrives only in the reveal via `StorefrontProductCard`
  (real Shopify photos). **If** a future build wants card art, it declares
  **archetype D (editorial metaphor macro)** within the ground lock — silk/water
  for "slow" against a brighter macro for "right now" — never tableware, never
  text in pixels (§4). This is a deliberate deferral of the image dependency.

## 5. Motion (repo-native primitives only, zero CLS)

Reuses the exact patterns already shipped in the Sensation Map, so nothing is
hand-rolled and no IntersectionObserver is written:

- **Band on scroll:** one `<Reveal variant="up">` on the kicker/heading group
  (`app/components/motion/Reveal.tsx`). The stage renders **question 1 visible on
  the server** (SSR final state), so there is no empty-then-fill flash.
- **Advancing a question (interaction-driven, not scroll-driven):** the incoming
  pair cross-fades + travels `--reveal-distance` (16px) up while the outgoing pair
  opacity-fades out, over `--duration-base` on `--ease-entrance` — **transform and
  opacity only**, done with token-based CSS transition classes exactly like the
  Sensation Map's result cross-fade (`transition-opacity duration-[var(--duration-base)]`).
  The stage container is a **fixed height** across question and reveal states, so
  swapping content never reflows the page (zero CLS).
- **Tap feedback:** the chosen card does a 0.97→1 scale settle (the `scale`
  variant's feel) — transform only, one beat, never bouncy (`springEntrance`
  settles with body per §5).
- **The reveal:** product row cross-fades in (opacity, `--duration-base`) into the
  fixed-height slot. The single per-page `heartbeat` on Emma's ♥ fires **only if**
  the page has not already spent its one beat (Meet Emma usually owns it). Default:
  **no beat here** (§5: one heartbeat per page, maximum).
- **Reduced motion / no-JS:** transitions collapse to instant state changes;
  reduced motion renders every state as its final form. Critically, **the SSR
  default state is not a blank game** — the stage server-renders question 1 *and*
  the reveal slot pre-renders a default "most-picked" product set (real PDP links)
  from the loader, exactly as the Sensation Map SSRs its `defaultMatch`. So even
  with JS disabled the module is product-linked and complete.

## 6. Interaction / state model

- **Choices held client-side** in a small `useState` array (one entry per answered
  question). No `useEffect` data fetching anywhere.
- **Each pole maps to a `{dimension, value}` in the LIVE discovery vocab** — the
  same discipline as `emmaPreset` (mission brief §6) and the Sensation Map. Draft
  axes, each drawn from a distinct vocab dimension so they don't collide:
  - **Q1 · Pace** ← `mood[]` (e.g. gentle/slow vs intense/quick)
  - **Q2 · Company** ← `audience[]` (solo vs couples)
  - **Q3 · Touch** ← a second `mood[]` axis *or* `matters[]`, whichever splits
    cleanly (see dead-tag note)
  - **Q4 · Territory (optional)** ← `matters[]` (Beginner-friendly vs not)
- **Dead-tag risk (must-verify, do not invent):** every pole's tag must exist in
  the live vocab from `scripts/dump-discovery-vocab.ts`; a pole pointing at a tag
  no product carries matches zero products, exactly like a dead preset pill. At
  build time, verify each dimension actually offers a clean two-pole split. Where a
  dimension has no honest binary (e.g. mood is a spread, not a duality), that
  question is **reframed to poles that do exist or dropped** — v1 may ship as 3
  questions, not 4, before it ships a fake binary.
- **Resolving the reveal:** on the final tap, a `useFetcher` hits a resource route
  (reuse `/api/sensation-map`'s pattern or a sibling `/api/either-or`) that scores
  the discovery index by tag overlap with the accumulated choices — the **same
  server-side scoring machinery** discovery and the Sensation Map already use — and
  returns the top 2–3 products. All matching logic stays in a `.server.ts`.
- **Cold / empty state:** if the discovery index is cold (like the Sensation Map's
  `defaultState === null`), the whole band is **skipped server-side** — it never
  renders empty. If a specific choice-combo matches fewer than 2 live products, it
  **relaxes to the nearest matching state** and says so softly ("Here is the
  closest fit."), never showing an empty reveal — the Sensation Map's `relaxed`
  pattern, reused verbatim.
- **Reset:** a quiet "Start over" returns to question 1 (client state reset, no
  navigation).

## 7. Additive Sanity block sketch (field shape only — do NOT implement)

A **new** block type `eitherOr` in a **new** file `studio/schemas/blocks/eitherOr.js`,
additive only (never touch existing schema), modeled on `wayfinderMosaic.js`. The
storefront reads it with a hardcoded-default fallback like every other team block,
so a half-filled draft never blanks the slot. Shape only:

```
eitherOr (object)
  active        boolean   (initialValue true)
  order         number    (hidden; slot ordering)
  eyebrow       string    ("EITHER / OR")
  heading       string    ("Follow the pull.")
  emphasis      string    (the one plum .em word, e.g. "pull")
  bgStyle       -> bgStyleField (ground: plum-soft | coral-soft | white)
  intro         string    (Emma-voice sub-line, no em-dashes)
  questions     array  (validation: min 3, max 4) of:
    question (object)
      prompt      string   ("Tonight, you want it...")
      optionA (object)
        label     string   ("Slow and building")
        sub       string   (optional micro-line)
        dimension string   (enum: mood | audience | matters)
        tagValue  string   (must be a LIVE vocab tag — verified at publish)
      optionB (object)   (same shape as optionA)
  reveal (object)
    emmaReadTemplate  text  (optional; templated Emma read, rotated to avoid tics)
    ctaLabel          string (whitelist only; "See the full fit →")
    fallbackCollection string (collection handle for the "full fit" link — never /discover)
```

Note for `sanity-content-builder`: `tagValue` carries the same publish-time
verification burden as preset tags (mission §6) — eyeball match counts before
publishing, or the pole is a dead end.

## 8. IA-fence status — what must clear before any build

**Status: PROPOSAL. Not buildable until IA + schema sign-off.** Per
routine-design-cycle §0.5:

- **Option A (recommended):** stays **inside** the locked Nº 01–Nº 11 taxonomy —
  it is an alternate *renderer* for the existing Nº 07 discovery-instrument slot,
  not a new section-type. Still requires: (1) a light `homepage-ia` sign-off that
  the Nº 07 slot may host either instrument, (2) the additive `eitherOr` Sanity
  block (§7), (3) an `rr7-engineer` reviewed PR (never auto-merged) for the
  component + resource route. **No new URL/route. No modified schema.**
- **Option B:** is a **new named section-type** and needs the full `homepage-ia`
  new-section-type spec + placement approval *before* build, plus everything in
  Option A. Higher ambition, higher IA cost.
- **Both options:** tags drawn only from the live vocab
  (`scripts/dump-discovery-vocab.ts`), dead-tag risk noted (§6); all card labels
  and the Emma read line gated by `emma-empathy-reviewer` (dial 9 allowed on this
  owned surface, but no crude, no dares, no em-dashes, no countdowns, CTA
  whitelist only, Emma claims no lived experience).

## 9. How every terminal state hits a PDP (the 70% math)

Mission brief §1 target: ≥70% of clickable modules resolve to a product or
collection, and the module must **add PDP-bound links, not `/discover` links**.

- The binary option cards are **in-place state changes, not navigation** — they
  exit the module nowhere, so they are not counted as links at all.
- Every *exit* from the module is product- or collection-bound:
  - Reveal product cards: **2–3 → `/products/{handle}`**
  - "See the full fit →": **1 → a collection** (never `/discover`)
- Terminal-state link ratio: **~4/4 = 100% product-or-collection. Zero `/discover`
  links added.** The module is unambiguously on the right side of the 70% target,
  including the no-JS SSR default path (which pre-renders a real product set).

## 10. Rejected / considered alternatives (logged so ambition compounds, §9)

- **Product swipe-deck (Tinder-style left/right on product cards).** *Rejected —
  brand-fit + shallow-learning.* Swiping on products reads as hookup-app UX (off
  our editorial-magazine register, doctrine §0) and it filters rather than teaches
  — the visitor learns nothing about their own *leanings*, only which SKUs they
  reject. Higher build too (gesture handling). Binary *sensory* pairs teach a named
  preference; swiping products does not.
- **"Would you rather" scenario dares.** *Rejected — voice charter.* The
  challenge/dare register is banned (charter: "no challenges or dares"), and
  "would you rather" tips toward gimmick/BuzzFeed energy — the same reason the
  Sensation Map doc rejected the personality quiz. Kept as **leanings** ("lean
  toward whichever one pulls you"), never dares.
- **A new `/either-or` route.** *Rejected — hard constraint.* Violates the no-new-URL
  rule and fragments discovery. It belongs inline as an on-ramp, not a destination.
- **Replacing the Sensation Map outright.** *Considered, not recommended.* They
  serve different visitors (analytical dial vs playful sequence). Rather than
  cannibalize, Option A lets the team **rotate** between them in the Nº 07 slot for
  weekly freshness. Governance note for IA: the page should still run **one
  discovery instrument at a time** — shipping Either / Or *and* the Sensation Map
  *and* the Compass closer simultaneously risks the "three finders" clutter the
  mission warns against.
- **Continuous live-tally version (no discrete reveal).** *Rejected — duplicates
  the Sensation Map.* A running read-out that updates on every tap is just the
  Map's instrument with fewer axes. The discrete reveal-at-the-end is exactly what
  makes this a *game* and not a second dial.

---

## Build-effort estimate + specialists a future build needs

**Effort: medium.** Most of the machinery already exists to borrow.

- *Reuses:* the discovery index + tag-overlap scoring (`sensation-map.server`
  pattern), `StorefrontProductCard`, the `Reveal` primitive + motion tokens, the
  `/api/sensation-map` resource-route pattern, the loader-default + `useFetcher`
  data flow, the cold-index skip and `relaxed` fallback.
- *New work:* the stepper state-machine component (question stage + reveal), the
  additive `eitherOr` Sanity block, the per-pole tag mapping + live-vocab
  verification, and (Option B only) the IA new-section-type spec.

**Specialists:**
- `homepage-ia` — slot sign-off (Option A) or new-section-type spec (Option B).
- `sanity-content-builder` — the additive `eitherOr` block (new file, additive
  only).
- `rr7-engineer` — component + resource route + loader addition, reviewed PR
  (never auto-merged).
- `emma-copywriter` + `emma-empathy-reviewer` — all card labels, prompts, and the
  templated Emma read line, dial-9 gated, fresh-language checked (no reused tics).
- `qa-reviewer` — CLS/375px/reduced-motion + the link-ratio count.
- `media-manager` — **not needed for v1** (type + tint + SVG glyph). Only if a
  later cycle adds archetype-D card art.

---

## Build-readiness resolution — 2026-08-26 (Routine B, run 520)

> Advances this concept from PROPOSAL toward BUILDABLE by resolving §6's open build
> risk (the dead-tag / clean-binary axis question) against the **live** discovery
> vocab. Source: self-capture of `xdipx.com/discover` on 2026-08-26 (our own site;
> the rendered facet chips ARE the live vocab the finder filters on). Still a design
> artifact: nothing here ships without the IA sign-off and additive `eitherOr` block
> in §7-§8 and a reviewed `rr7-engineer` PR. This does not modify §1-§10; it settles
> the axis question they left to build time.

**The question §6 left open:** every axis pole must be a *live* vocab tag (dead-tag
risk), and each axis needs an honest *two-pole split* — §6 warned mood "may be a
spread, not a duality" and that v1 might drop to 3 questions before shipping a fake
binary. Resolved below against the live facets.

Live facets captured verbatim (grouped as the finder groups them):

- **mood:** Sensual, Indulgent, Adventurous, Bold, Playful, Curious, Spontaneous,
  Empowered, Comforting, Tender, Naughty, Energetic, Romantic, Surrendered, In
  Charge, Slow and Intimate, Intimate
- **audience:** Solo, Couples, Queer Friendly, Date Night, Gift, Long Distance, Self
  Gift, Gay Couples, Gift Idea, First Time, Bachelorette, Non Binary, Sapphic,
  Anniversary, Just Curious, Birthday, Housewarming
- **matters:** Latex Free, Easy to Clean, Beginner Friendly, Soft Touch,
  Rechargeable, Discreet, Hands Free, Waterproof, Travel Ready, Remote Controlled,
  Plus Size Friendly, Whisper Quiet, Body Safe Silicone, Natural, Warming, Water
  Based, Adjustable Fit, Breathable, Edible, App Controlled, Condom Safe, Durable,
  Plus Size, Powerful, Reliable, Remote, Silicone Based, Strap on Compatible,
  Vibrating

**Resolution — v1 ships 3 clean binaries, Q4 dropped:**

| Q | Axis | Pole A (tag) | Pole B (tag) | Verdict |
|---|---|---|---|---|
| Q1 | Pace ← mood | Slow and Intimate (support: Tender, Comforting, Sensual) | Bold (support: Energetic, Adventurous, Spontaneous) | CLEAN — both poles are live tags; mood carries a slow↔bold duality after all |
| Q2 | Company ← audience | Solo | Couples | CLEAN — both live, unambiguous; the strongest binary |
| Q3 | Control ← mood | Surrendered | In Charge | CLEAN — a genuine give/receive-control duality, both live tags |
| Q4 | Territory ← matters | Beginner Friendly | (no honest opposite tag) | DROP for v1 — matters is a feature spread with no live opposite pole; forcing "Powerful"/"Adjustable Fit" as an anti-beginner pole is the fake binary §6 warned against |

So §6's "v1 may ship as 3 questions" is now the confirmed plan: **Pace, Company,
Control** — three clean two-pole splits, every pole a live tag. Q4 (Territory) is
retired from v1; a future cycle may reintroduce a beginner axis only if a real
opposite tag enters the matters vocab.

Note the two mood axes (Q1 Pace, Q3 Control) draw from *disjoint* tag sets (slow/bold
vs surrendered/in-charge), so they do not collide — §6's "each drawn from a distinct
vocab dimension so they don't collide" holds even with two mood axes, because the tag
sets are disjoint within mood.

**The single residual pre-build gate (needs credentials this cloud routine lacks):**
per-pole product-count ≥2 verification. Pole *existence* is confirmed above, but
Either/Or's own §6 relax-if-<2-matches rule and mission §6's dead-pill rule both
require each *pole* (and each realistic *combination* of poles) to match ≥2 live
products before publish — that needs product counts, which come only from the
credentialed dump. The next interactive/credentialed cycle runs exactly:

```
tsx scripts/dump-discovery-vocab.ts --csv --group mood
tsx scripts/dump-discovery-vocab.ts --csv --group audience
```

Pass/fail: each of the six poles above (Slow and Intimate, Bold, Solo, Couples,
Surrendered, In Charge) must show a product count ≥ 2. If a mood pole is thin, swap
it for its listed support tag (Q1/Q3 carry support tags for exactly this); Q2 has no
support tag, so Solo/Couples both stocking is a hard publish floor. This is the ONLY
thing between this concept and an `rr7-engineer` build ticket.

**Net effect on build-readiness:** Either/Or moves from "proposal, axes unverified"
to "proposal, axes confirmed against live vocab, one credentialed count-check
remaining." It is the most build-ready concept in `concepts/` and the recommended
next-to-build when traffic returns, or as a cheap-and-certain Nº 07 renderer swap the
moment the count-check passes.
