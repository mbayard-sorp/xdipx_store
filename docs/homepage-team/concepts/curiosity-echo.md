# Concept Wire — Curiosity Echo

> Routine B (Design Cycle) ambition-mandate deliverable, run #397, 2026-08-19.
> Mission brief §9: carry at least one genuinely new exploration/self-discovery
> experience concept to a wire each cycle. **This is a design artifact only.**
> Nothing here ships without IA review, additive-only Sanity schema, and an
> `emma-empathy-reviewer` pass on every customer-facing string. All copy below
> is **illustrative** and has not cleared the voice gate. The doctrine
> (`docs/design-doctrine.md`) wins over this wire on every visual call; the
> voice charter (`docs/emma-voice.md`) wins over everything. Format precedent:
> `concepts/first-tap.md`, `concepts/either-or.md`, `concepts/how-you-arrive.md`,
> `concepts/the-next-step.md`, `concepts/sensation-map.md`.

## 1. The idea in one line, and the job it serves

The Curiosity Shelf (Nº 07) already lets a visitor tap named appetites ("Hands
free," "Something that hums," "Made for two," "Slick," "Worn, not held") and
restocks six real products under each. **Curiosity Echo adds one quiet
reflection beat that appears only after a visitor has tapped three or more
lanes:** a single line above the shelf that reads the *shape* of what they
reached for and says it back to them, warmly and without a verdict. Not "you
are a X." Something closer to "You keep circling the hands-free ones. Want the
two that reviewers say disappear the fastest into a routine?" followed by a
`/products/{handle}` deep-link to a real product that sits at the intersection
of the lanes they touched.

**Journey job (mission brief §7): DEEPEN, then TEMPT.** The shelf as shipped is
pure orient-and-tempt: tap a mood, see six. Echo is the first moment on the
homepage where the *act of browsing itself* becomes the self-discovery — the
visitor learns something about their own curiosity from watching it reflected,
and that recognition is the bridge to a specific product. It converts idle
lane-hopping (today a dead-end once you have seen the six) into a moment that
moves toward a purchase.

## 2. Why it is new (not a repeat of what we have)

- **It reads behavior, not a questionnaire.** The Compass, Either/Or, How You
  Arrive, and First Tap all *ask* the visitor to declare something. Echo asks
  nothing. It watches which lanes the visitor already chose to open and reflects
  the pattern. The self-knowledge is earned from play, not extracted from a
  form — which is exactly the "browsing feels like exploring" bar in §9.
- **It lives on the act that already happened.** No new surface, no new flow, no
  new route. It is a conditional line on a band the visitor is already using,
  revealed by their own third tap. Zero cost to a visitor who taps once and
  moves on; a payoff only for the visitor who is genuinely exploring.
- **The reflection is generous, never a label.** The charter bans mind-reading
  ("you've been wondering") and bans a verdict on the person. Echo names the
  *pattern in the taps* ("three of these were hands-free"), which is an
  observation about what they did, not a claim about who they are. That is the
  line the copy must walk, and the voice gate is where it gets walked.

## 3. The wire (375px, the only breakpoint that matters first)

```
┌─────────────────────────────────────────────┐
│ Nº 07 · TONIGHT'S CURIOSITIES                │
│                                               │
│ What are you *curious* about?                 │
│ ♥ Pick one. I restock the shelf with six.     │
│                                               │
│ [Hands free•] [Something that hums]           │   ← pills (existing)
│ [Made for two] [Slick] [Worn, not held]       │
│                                               │
│ ┌───────── curiosity echo (NEW) ──────────┐   │   ← appears at tap ≥ 3,
│ │ ♥ You keep opening the hands-free ones.  │   │     one line, plum-soft
│ │   Here's the one that vanishes into a    │   │     inset, no image.
│ │   routine the fastest →                   │   │     The → is a real
│ └───────────────────────────────────────────┘   │     /products/{handle}.
│                                               │
│ [card][card][card]                            │   ← the six (existing)
│ [card][card][card]                            │
│                                               │
│ Show me another six        See the full fit → │
└─────────────────────────────────────────────┘
```

The echo band is a single row that occupies reserved (min-height) space so its
appearance is a fade-in of already-laid-out space, **zero CLS** — never a layout
push. Below `lg` it stacks above the grid; at `lg` it can ride the right rail
beside the pills. One coral/plum accent only (the ♥ and the deep-link arrow),
within the coral budget; ground is plum-soft to match the band.

## 4. The mechanic (SSR-safe, no fetch, additive)

The Curiosity Shelf's defining property is that **it does not fetch** — every
lane ships fully resolved in the SSR payload and every interaction is local
state. Echo must not break that.

- **Server pre-computes the echoes.** At payload-build time (alongside
  `resolveShelf`), for each *pair and triple* of lanes, resolve the single best
  product that sits at their intersection (a hands-free + something-that-hums
  product; a made-for-two + slick pairing) from the same in-memory discovery
  index, and attach a short pre-authored, voice-gated line. This is a bounded
  set (5 lanes → 10 pairs, capped; only the top-N by index strength ship). It
  rides the existing homepage-B blob. No runtime request, no rate limit, no
  error path — identical contract to the shelf itself.
- **The client counts taps in local state.** `interacted` already exists;
  add a `Set<laneKey>` of opened lanes. When its size crosses the threshold,
  reveal the echo that matches the visitor's most-opened lane (or the strongest
  intersection among opened lanes). Pure `useState`, no effect-fetch, no
  `/api/*`. Reduced motion renders the echo in its final state with no fade.
- **Honesty floor.** The echo deep-links a **real, in-stock** product resolved
  at build (the same `passesBaseFilters` the deck uses) or it does not appear.
  No echo ever ships a line without a live `/products/{handle}` behind it. If no
  intersection product is in stock, the visitor simply never sees an echo — the
  shelf behaves exactly as it does today.

## 5. What has to be true before it can be built (the fence)

- **IA review.** Echo adds no section type and no route, but it changes the
  *meaning density* of Nº 07 (a band that now reflects behavior). `homepage-ia`
  confirms it stays inside the locked Nº01–Nº11 shell and does not become a
  second finder competing with the Compass.
- **Additive Sanity only.** The pre-authored echo lines and the intersection
  overrides are new fields on a **new** additive block (an `echoLines` object on
  a new `curiosityEcho` companion, never a modification of the existing
  `curiosityShelf` schema). Loader reads new-with-fallback; absence = today's
  shelf, unchanged.
- **Voice gate on every line.** Each echo line is desire-forward dial-9 selling
  copy (it sits on the homepage shelf, not the Meet-Emma trust beat), but it
  must clear the no-mind-reading and no-verdict rules explicitly — this is the
  concept's single hardest copy constraint and the most likely REVISE source.
- **design-critic pass** on the revealed state at 375/768/1440, including the
  reserved-space no-CLS proof.

## 6. Why it is banked, not built, this cycle

Mission brief §1 traffic gate: with sessions far below 300/week, no shipped
homepage change is GA4-measurable, so new interaction machinery ships to almost
no one. Echo is genuinely new machinery (behavior-reading + intersection
resolution + an additive schema block), which is precisely the class the
traffic gate says to **bank as a proposal now and build when it can be seen**.
The cheap-and-certain arm of this cycle's ambition mandate is the shipped
Curiosity Shelf See-all fix; Echo is the banked design capital that compounds.

## 7. Rejected alternatives (logged so ambition compounds)

- **A persistent "your curiosities" chip trail** that accumulates every lane
  tapped into a visible history. Rejected: it turns a light browse into a
  tracked profile the visitor can see building, which reads closer to
  surveillance than to a warm friend, and it invites the exact "you are a type"
  labeling the charter bans. Echo's one-line, reveal-once, no-history shape is
  the deliberately lighter version.
- **A post-tap modal** ("Based on your taps…"). Rejected: a modal interrupts the
  play it is trying to reward, and the shelf's whole thesis is in-place restock
  with no interruption. The inline reserved-space line keeps the visitor in the
  flow.
- **Echo on the first tap.** Rejected: one tap is not a pattern, and reflecting
  a single choice back is mind-reading, not observation. The ≥3-tap threshold is
  what makes the reflection honest — it names something the visitor demonstrably
  did.
