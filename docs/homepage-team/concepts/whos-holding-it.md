# Concept Wire — Who's Holding It

> Routine B (Design Cycle) ambition-mandate deliverable, run 1034, 2026-09-23.
> Mission brief §9: carry at least one genuinely new exploration/self-discovery
> experience concept to a wire each cycle. **This is a design artifact only.**
> Nothing here ships without IA review, additive-only Sanity schema, and an
> `emma-empathy-reviewer` pass on every customer-facing string. **All copy below
> is ILLUSTRATIVE ONLY and has not cleared the voice gate.** The doctrine
> (`docs/design-doctrine.md`) wins over this wire on every visual call; the
> voice charter (`docs/emma-voice.md`) wins over everything. Format precedent:
> `concepts/nothing-in-the-way.md` (run 905), plus `concepts/sensation-map.md`,
> `concepts/either-or.md`, `concepts/how-you-arrive.md`, `concepts/the-next-step.md`,
> `concepts/first-tap.md`, `concepts/curiosity-echo.md`.

## 1. The idea in one line, and the job it serves

**Who is in the room, and who is holding it.** One band asks the visitor for two
things no xdipx surface has ever asked for: the **company** they are in tonight
(just me / the two of us / apart / a date first) and the **stance** they want to
take inside it (I'm in charge / hand it over / up to no good / take care of me).
The first tap is required, the second is optional. Each state rebuilds a shelf of
three real products underneath, and carries **one plain line naming what changes
about the product when the room changes**. Every result is a direct
`/products/{handle}` link.

**Journey job (mission brief §7): TEMPT first, DEEPEN underneath.** The
self-discovery is not a badge and not a taste profile. It is the moment a visitor
notices that *control is a product decision*: that "I want to be the one working
it" and "I want to hand it over" lead to genuinely different shelves, and that
"they are not in this bed tonight" is an engineered category rather than a
consolation prize. Most people have never said either sentence to a shopping
page. Saying it once, and getting three real products back, is the whole concept.

It clears the §9 bar the way the brief phrases it: the visitor learns something
about **themselves** (a stance they wanted but had not named) while moving toward
a **real product** (three PDP links per state, twenty states, zero dead ends).

## 2. Why it is new: the input, measured against our own seven

The differentiator on this bench has always been the **input**, not the
interaction shape. Here is the full banked set with the input each one takes,
which is the check the run brief asks for explicitly:

| Concept (run) | Input it takes | What it assumes about the visitor |
|---|---|---|
| Compass (`/discover`, shipped) | mood x audience x matters chips | they know the vocabulary |
| Sensation Map (36) | type dial x mood dial | they want a *sensation* |
| Either / Or (76) | a gut lean between two desires, four times | they can choose between two wants |
| How You Arrive (117) | tempo slider x touch slider | they want a *tempo* |
| The Next Step (183) | what they already own | they already bought one |
| First Tap (282) | arrival intent off a bio link | they just came from a video |
| Curiosity Echo (397) | which lanes they already tapped | they already browsed |
| Nothing in the Way (905) | the obstacle stopping them | only that they are hesitating |
| **Who's Holding It (this, 1034)** | **the company they are in, and the stance they want inside it** | **only that someone is, or is not, with them** |

Every one of the eight prior inputs is a property of **the visitor alone**:
their appetite, their tempo, their history, their worry, their arrival. **None of
them takes the other person as an input, and none of them takes power as an
input.** That is the gap this fills, and it is the largest single fact about a
sex-toy purchase that our homepage currently never asks about.

Two honest adjacencies, stated rather than hidden:

- **Either / Or** includes "just-you vs the-two-of-you" as *one of four*
  disposable binary pairs, subordinated to an aggregate reveal at the end. Here
  company is the whole first axis, it is stateful rather than consumed, and it
  carries configurations a binary cannot express (apart tonight, a date first).
- **The Compass** exposes `audience` as a buried chip group among three. No
  homepage surface exposes it at all, and no surface anywhere exposes the
  `In-Charge` / `Surrendered` pair, which is the only power axis in the live
  vocabulary.

**It is also the first concept whose second axis is the control pair.** Nothing
in the Way was the first to build on `matters`; this is the first to build on the
unused end of `mood`. The charter licenses exactly this register in exactly this
context: "Bondage and control toys: control given or taken, anticipation, trust;
kink-coded language is at home there and only there" (`docs/emma-voice.md`, craft
rules). §11 records the register risk that comes with it.

## 3. The two axes, in STORAGE form

Tags below are `normalizeTag()` **storage** form (`app/lib/discovery-tags.ts`),
read this run from `GET /api/team/discovery-vocab` (live index size **5,251**).
They are never rendered chip labels: run 520 shipped two dead poles by copying
`displayLabel()` output off `/discover`, and the display string "Slow and
Intimate" is not a tag, the stored string `Slow-And-Intimate` is.

### Axis 1 — the room (required, from `audience`, scores 2)

| Chip, in the visitor's words (ILLUSTRATIVE, not voice-gated) | Tag (storage form) | Index count |
|---|---|---|
| "Just me tonight." | `Solo` | 3970 |
| "The two of us." | `Couples` | 3344 |
| "We're not in the same bed tonight." | `Long-Distance` | 278 |
| "There's a date first." | `Date-Night` | 643 |

### Axis 2 — the stance (optional, from `mood`, scores 3)

| Chip (ILLUSTRATIVE) | Tag (storage form) | Index count |
|---|---|---|
| "I'm in charge." | `In-Charge` | 257 |
| "Hand it over." | `Surrendered` | 327 |
| "Up to no good." | `Naughty` | 431 |
| "Take care of me." | `Tender` | 590 |

### Measured spares, held out of v1

`Playful` (1788) on axis 2 and `Queer-Friendly` (625) on axis 1. Both pass every
combination (§4). `Playful` is held because it is a register, not a stance, and
it would blur the axis's one job; it is the safe rotation stock if a stance pole
ever thins. `Queer-Friendly` is held on the **label-keeps-its-promise** rule
(mission brief §6): the tag describes the product's inclusivity, not who is in
the room, so a room-framed chip would promise something the tag does not carry.
It is available to a merchandiser only under a label that keeps the actual
promise.

## 4. Build-readiness: the COMBINATION matrix (playbook §1 cross-product gate)

Per `routine-design-cycle.md` §1 (run 646, `concepts/either-or.md`): a multi-axis
instrument is **not** buildable because each pole clears the `>=2` floor.
Disjoint tag sets are not independent co-occurrence. Every reachable combination
is measured below, and several unreachable candidates are measured too so the
exclusions are on data rather than on taste.

**Method (credential-free, reproducible, run 2026-09-23).**

1. `GET https://xdipx.com/api/team/discovery-vocab` with header
   `x-team-secret: $HOMEPAGE_TEAM_TOKEN` for live **per-tag** counts. It does
   **not** serve per-combination counts (`computeVocabCounts()` tallies each tag
   independently), which is the correction run 905 made to this playbook line.
2. Combinations come from the public scoring endpoint:

```
GET https://xdipx.com/api/discovery?variant=a&budget=300&audience=<TAG>&mood=<TAG>
```

`SCORE_MOOD = 3`, `SCORE_AUDIENCE = 2` (`app/lib/discovery-emma.ts`), so a
product matching both scores **5**, the maximum achievable, and the full-match
count is the number of returned items at score 5. A room-only state scores **2**.

Two honest limits, neither of which touches the `>=2` gate: items are capped at
`perRail` 12 across 4 rails, so any reading is a **floor** with a ceiling of 48
(`Solo` and `Couples` alone both read exactly 48, i.e. they are pinned at the
ceiling), and `budget=300` is `BUDGET_MAX`. A 0 or 1 reading is reliable because
rails sort score-descending, so any full match surfaces before any partial one.

**Volume: 76 probes this run.** 10 candidate room poles measured alone, 6
candidate stance poles measured alone, and **60 room x stance combinations**.

### Reachable states in v1

First tap required, second optional, no yes-only state, no empty state (§8 seeds
a default room server-side). Reachable set = **4 room-only + 16 room x stance =
20 states. All 20 PASS the `>=2` floor.**

**Room-only states (score 2), all PASS:**

| Tag | items |
|---|---|
| `Solo` | 48 (at ceiling) |
| `Couples` | 48 (at ceiling) |
| `Long-Distance` | 17 |
| `Date-Night` | 39 |

**Room x stance states (score 5), all 16 PASS:**

| room \ stance | `In-Charge` | `Surrendered` | `Naughty` | `Tender` | verdict |
|---|---|---|---|---|---|
| `Solo` | 16 | 16 | 19 | 27 | PASS |
| `Couples` | 28 | 26 | 32 | 28 | PASS |
| `Long-Distance` | 12 | **3** | 14 | **3** | PASS (thin) |
| `Date-Night` | 6 | 12 | 6 | 4 | PASS |

The binding minimum is **3**, at `Long-Distance` x `Surrendered` and
`Long-Distance` x `Tender`. The band renders **three** cards, so those two cells
are exactly at the render count with no spare. `Long-Distance` (278 products) is
the pole to re-measure before any build; if either cell drops below 3, the fix is
to swap `Playful` (14 on that row) in for the failing stance **on that row**, or
to retire the second tap for that room. The band never gets an empty state and
never gets a short shelf.

### Measured, PASS, held as spares (score 5)

| row/col | `In-Charge` | `Surrendered` | `Naughty` | `Tender` | verdict |
|---|---|---|---|---|---|
| `Queer-Friendly` (room spare) | 26 | 15 | 24 | 18 | PASS (spare, label-promise hold) |
| `Playful` (stance spare) vs Solo/Couples/LD/Date-Night | 30 / 43 / 14 / 24 | | | | PASS (spare) |

### Measured, FAIL, excluded from v1

| Excluded pole | `In-Charge` | `Surrendered` | `Naughty` | `Tender` | why excluded |
|---|---|---|---|---|---|
| `First-Time` (room) | **0** | **0** | **0** | **1** | fails 4 of 4 |
| `Self-Gift` (room) | **0** | **0** | **0** | **0** | fails 4 of 4 |
| `Bachelorette` (room) | **0** | **0** | **1** | **0** | fails 4 of 4 |
| `Anniversary` (room) | **0** | **0** | **0** | **0** | fails 4 of 4 |
| `Non-Binary` (room) | **1** | **0** | **0** | 4 | fails 3 of 4 |
| `Slow-And-Intimate` (stance) | 15 (Solo) | 15 (Couples) | 4 (LD) | **0** (Date-Night) | one dead cell kills the pole |

**`First-Time` is this cycle's run-905 moment, and it is worth naming.** It
carries **173** products and returns **20** items on its own, clearing the pole
floor by an order of magnitude. Put it next to a stance and it returns
0 / 0 / 0 / 1. "It's my first time, and I want to be the one holding it" is
arguably the single most valuable sentence a first-time visitor could say to us,
and our vocabulary cannot currently carry it. Excluded on measurement, logged
here so a future cycle re-opens it only after `audience` enrichment is backfilled
against the control pair, never on intuition. `Self-Gift` (338 products, 22 alone,
**0** on all four stances) is the same failure a second time.

**`Slow-And-Intimate` is the cross-product gate doing its job on the stance
axis.** It reads 16 alone and 15 with both of the fat rooms, then returns **0**
on `Date-Night`. A designer sizing this axis on pole counts would have shipped a
band where one of four rooms times one of four stances is a blank shelf.

**Vocabulary landmines recorded so nobody re-derives them:** `Intimate` (mood)
is **1** product, and 29 of the 42 `matters` tags carry a single product each.
On `audience`, `Birthday` (6) and `Housewarming` (5) are effectively dead, and
`Gift-Idea` (146) is a near-duplicate of `Gift` (289) with no editorial
distinction. Only `Solo`, `Couples`, `Date-Night`, `Queer-Friendly`,
`Long-Distance`, `Self-Gift`, `Gift` and `First-Time` are above 150.

## 5. Wireframe — 375px first

```
┌──────────────────────────────── 375px ──────────────────────────────┐
│                                        ground: plum-soft (Nº 07 slot)│
│  Nº 07   WHO'S HOLDING IT                          (mono kicker)     │
│                                                                      │
│  Who's here, and who's holding it?         (Newsreader H2, one .em   │
│                                             plum italic word:        │
│                                             "holding")               │
│  Pick the room you're in. The shelf follows.                         │
│                                             (DM Sans, ink-3, <=60ch) │
│                                                                      │
│  ── the room ── (pill row, 22px radius, scroll-snap-x, no scrollbar) │
│  ( Just me tonight. ) ( The two of us. ) ( We're not in the same …   │
│      ^ SELECTED = the one coral element in this viewport             │
│                                                                      │
│  ♥ "They're in another bed and the next move is yours. These three   │
│     put it in your hand from wherever you're lying."                 │
│                        (Emma aside, italic Newsreader, sage ♥)       │
│                        ^ THE READ — one line per state, from Sanity  │
│                                                                      │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐   fixed-height row        │
│  │ product   │ │ product   │ │ product   │   StorefrontProductCard   │
│  │ card      │ │ card      │ │ card      │   → /products/{handle}    │
│  │ brand     │ │ brand     │ │ brand     │   (mono ink-4 eyebrow)    │
│  └───────────┘ └───────────┘ └───────────┘   horizontal snap at 375  │
│                                                                      │
│  ── and how do you want to be in it? (optional) ──                   │
│  [I'm in charge.] [Hand it over.] [Up to no good.] [Take care of me.]│
│      ^ small chips, 8px radius, sage active state, wrap to 2 rows    │
│                                                                      │
│  (no See-all link — see §9)                                          │
└──────────────────────────────────────────────────────────────────────┘
```

**The two axes deliberately do not share a shape**, the same rule
`nothing-in-the-way.md` applied and for the same reason: two control layers on
one screen must each state their own job in their own vocabulary. Here they do it
in **grammar** (a place vs a posture), **geometry** (22px pill vs 8px chip), and
**color** (coral selected vs sage active). The room row is above the shelf
because it is the required tap; the stance row is below the shelf because it is
the optional refinement, and putting it under the result is what makes the second
tap read as "narrow this" rather than "you are not done yet".

## 6. Desktop (>= md)

`max-w-[1320px]`, `md:px-16`, `py-16 md:py-20`. The room pills wrap onto one row
instead of scrolling. The read sits left at display scale in a `max-w-[46ch]`
measure with the three cards to its right in a 3-up grid; the stance chips sit
directly beneath the read, so both controls and the result are one uninterrupted
block and the eye never travels twice. No new max-width, no new radius, no new
padding scale.

## 7. Art direction (doctrine §§1-4, cited)

- **Ground (§1, "section rhythm is color, not whitespace").** The band takes the
  **Nº 07 slot's existing `plum-soft`** ground, which already sits between Nº 06
  Emma's edit (`paper-2`) and Nº 08 Couples (`paper-3`). Inheriting the slot
  inherits a compliant alternation beat and adds no new ground decision. Plum is
  also the correct family: §3 assigns plum to guided discovery, and this is a
  guided moment.
- **Coral budget (§3, hard rule).** Exactly **one** coral element in the
  viewport: the selected room pill. Stance chips use `sage`, the quiet accent.
  Cards inherit `StorefrontProductCard`. No second coral anywhere in the band.
- **Type (§2).** Mono `.kicker` at `text-[11px] uppercase tracking-[0.18em]
  text-ink-4` plus the `Nº 0X` numeral motif; H2 `text-[1.9rem] md:text-[2.9rem]`,
  leading 1.1, tracking -0.01em, Newsreader, with **exactly one** `.em`
  italic-plum word; body 16px `leading-relaxed` `text-ink-3` at <= 60ch; brand
  eyebrow on cards mono `ink-4` per §6.
- **Radii (§3).** 22px pills, 8px chips, 22px cards. Nothing new.
- **Lines and shadow (§3).** Cards keep a hairline `border-line`. No shadows.
- **Contrast (§3).** Unselected pill `ink-3` on `plum-soft`; selected pill
  `paper` on `coral`; sage chip active state checked against the AA floor before
  build. No white type over any photograph anywhere in the band chrome, so the
  §2 rendered-text-legibility rule has nothing to bite on here.
- **♥ motif (§3).** One sage ♥, on the read. That is the band's only heart, and
  the page-wide ceiling of two across all uses still binds.
- **Imagery (§4).** The band ships **zero generated assets**. The only images in
  it are the real Shopify product photographs inside the cards, and those inherit
  the §5 packaging-shot check at pick time. If a future cycle wants art here it
  is Archetype **B** (color-block still on the `plum-soft` ground, one styling
  echo) with an interest-floor property count per §4.1, through `media-manager`.
  Not this cycle: traffic is below 300 sessions/week and `routine-design-cycle.md`
  §1 says bank the capital rather than spend image budget where nobody sees it.

## 8. Motion (doctrine §5, repo-native primitives only)

- **Band entrance:** one `<Reveal variant="up">` on the heading group (kicker +
  H2 + sub), one `<Reveal variant="fade" delay={0.06}>` on the control rows, one
  `<Reveal variant="fade">` on the shelf. Exactly the shipped `CuriosityShelf`
  pattern. Nothing else wrapped, nothing per-card inside a scroller.
- **SSR:** the band renders a **merchandiser-chosen default room already
  selected**, with its read and its three cards, as the server state. No empty
  state, no skeleton, no fill-on-hydrate. Crawlers and no-JS visitors get a real
  shelf of real products.
- **Tap to swap:** the existing `.shelf-restock` CSS animation in `app/app.css`
  (opacity 0.25 → 1 plus a 4px translate, `--duration-base`, `--ease-entrance`,
  40ms per-index delay), gated behind an `interacted` flag so the server's first
  paint never animates. Not a `Reveal` (a reveal on every tap reads as a slot
  machine and fights the §5 "reading rhythm over choreography" budget).
- **Zero CLS:** the shelf is a **fixed three-slot** container with fixed-aspect
  card frames, so no state swap can reflow. Transform/opacity only.
- **No `layout` prop.** This is a content band, not a filter grid (§5).
- **No heartbeat.** The page's one beat is already spent on Meet Emma.
- **Reduced motion:** renders the identical default state, no entrance, instant
  swap (`.shelf-restock` is already `animation: none` under
  `prefers-reduced-motion`).
- **LCP:** the band sits at **Nº 07**, far below the fold, and carries **no LCP
  candidate**. There is no image in the band chrome at all. **The homepage hero
  remains the LCP and remains unwrapped; this concept does not touch it.**

## 9. How it serves the mission

- **Destination discipline (§1).** Every clickable thing in the band except the
  controls is a `/products/{handle}` link. It adds **zero** `/discover` links, so
  the two-link cap is untouched and the 70% product-forward ratio improves.
- **No See-all, deliberately (ticket #4270).** No collection contains "apart
  tonight AND hand it over". The routine is explicit: a module with no honest
  destination ships **no** See-all rather than falling back to
  `/collections/best-sellers`. v1 ships none.
- **Never fabricate proof (doctrine §6).** The read is written from real product
  data or it is not written. No invented counts, no invented certifications, no
  "most couples pick this", no stock signals.
- **Both visitors (§7).** The seeker taps their room and gets three products in
  one tap. The browser gets the rarer thing: permission to state a preference
  about power without typing it to anyone.
- **Voice (§8).** The chips are the reader's words, not Emma's. The reads are
  act-anchored, reader-centered, contain no mind-reading, no dare, no conditional
  and no em-dash, and never claim Emma has felt anything. Every string here is
  illustrative and goes to `emma-copywriter` under `emma-empathy-reviewer` before
  any build. CTA whitelist applies to any button label in the band.
- **Weekly rhythm (§3).** Default room, pole order, and all twenty reads are
  Sanity content, so the band reads differently week to week with no code change.
  Measured spares (§3) give the merchandiser verified rotation stock.

## 10. What it costs to build, and what it does NOT need

**Cost.**

1. **IA review — a new section TYPE, not a new section.** The recommended
   placement is the **Nº 07 discovery-instrument slot as a second renderer**,
   toggled by an additive Sanity field, exactly the Option-A pattern
   `either-or.md` proposed. The slot already exists, the shell keeps its locked
   Nº 01-Nº 11 taxonomy, and only one instrument ever renders, so the page never
   stacks finders. IA still owns the call and the toggle semantics.
2. **One additive Sanity document, in a new file** (`studio/schemas/roomStanceBand.js`),
   shaped on `curiosityShelf.js`: `note`, `enabled` (kill switch back to code
   defaults), `eyebrow`, `heading`, `emphasis` (validated substring of heading),
   `sub`, ordered `rooms[]` (`label` + `tag` in storage form), ordered
   `stances[]` (`label` + `tag`), `reads[]` (room x stance key → one line),
   `defaultRoom`, nullable `seeAllHref` defaulting to null. Never modify existing
   schema. Owner: `sanity-content-builder`.
3. **One component** (~250 lines, the `CuriosityShelf` shape) plus a resolver in
   `app/lib/storefront-home.server.ts` (~80 lines) that precomputes **all 20
   states** at SSR time from the in-memory discovery index, deduped into a
   product pool with states holding indices. Payload is comparable to the shipped
   shelf (5 lanes x 12 cards today vs ~40 unique products here).
4. **Tests + `design-critic` at 375/768/1440 + the voice gate on 20 reads.**
5. **A 20-product spot audit of the `In-Charge` / `Surrendered` tagging** before
   ship (§11 names why).

**What it does NOT need, which is most of the usual cost.**

- **No fetch.** No `useFetcher`, no `useEffect`, no `/api/discovery` round trip,
  no rate-limit path, no error state, no loading skeleton. Every state is
  resolved server-side, which is the property that makes the shipped Nº 07 band
  feel solid and is the single biggest improvement over `nothing-in-the-way.md`'s
  fetch-on-tap sketch.
- **No new route and no new URL.** Nothing for `tech-architect` to canonicalize.
- **No change to `/api/discovery`,** and **no re-weighting of `SCORE_MOOD` /
  `SCORE_AUDIENCE`**, which are shared with `/discover` and the panel deck.
- **No generated imagery**, so no `generateImage()` spend and no vision gate.
- **No migration, no `db/schema.ts` touch, no protected path.**
- **No new design tokens**: no new max-width, radius, ground, motion pattern, or
  coral allowance.

## 11. Why this might not be worth building (the honest section)

1. **The Nº 07 slot is not empty, and the incumbent is good.** The Curiosity
   Shelf shipped there with its own spec, and it does the one-tap version of this
   job well. Adopting this concept is a **swap, not an addition**, and we have no
   evidence the incumbent underperforms: GA4 is below 300 sessions/week, so no
   homepage change is currently measurable. Replacing working machinery on taste
   alone is exactly the move the traffic gate exists to stop.
2. **Axis 1 barely narrows anything, and that is a real defect.** `Solo` (3970)
   and `Couples` (3344) cover almost the whole 5,251-product index, and both read
   at the 48-item ceiling alone. The room tap is therefore mostly a **framing
   device**: the actual narrowing is done by the optional second tap. A visitor
   who taps once gets a shelf that is barely more specific than the anchor grid.
   Mitigations are all honest-but-weaker (seed the default room with a stance
   pre-applied, or make the stance required), and each one costs the "one easy
   tap" property that makes the band approachable.
3. **Two taps on a hesitant visitor.** The shipped shelf asks for one. Adding a
   second axis is measurable friction against an unmeasurable benefit.
4. **Register risk.** `In-Charge` / `Surrendered` is the most kink-coded content
   the homepage would carry, on a band a first-time visitor meets before any
   product page. The charter licenses control language in control contexts, and
   the band is a control context, but a visitor who came for a first vibrator
   could read the page as further along than they are. The v1 mitigations (stance
   optional, defaults off, warm first-person labels) are design mitigations, not
   proof, and `emma-empathy-reviewer` should be asked to rule on the axis
   *concept* before anyone writes twenty reads.
5. **The tags are editorial, not audited.** `In-Charge` and `Surrendered` were
   written by product enrichment as mood adjectives, not as a verified control
   taxonomy. The label-keeps-its-promise rule (mission brief §6) is load-bearing
   here, and it is currently unverified. If a 20-product spot audit shows the
   tags are decorative, the second axis is dead and the concept is a one-axis
   band with a worse input than the one already shipped.
6. **The best story sits on the thinnest data.** "We're not in the same bed
   tonight" is the line that would make someone stop scrolling, and it rests on
   278 products with two cells at exactly 3.
7. **Bench contention.** Four instruments now compete for one slot (Either / Or,
   Nothing in the Way, this, plus the shipped Curiosity Shelf). The team's real
   next decision is probably **ranking the bench**, not adding to it. This doc
   adds a fourth candidate and should be read as an argument to hold that
   ranking, not as a queue-jump.

## 12. Rejected concepts this cycle, with reasons (mission brief §9)

- **"Where do you want to feel it?" (a body-location axis).** The strongest
  untaken input on paper, rejected on data: the live vocabulary has **no
  anatomical dimension at all** (42 `matters` tags, zero anatomical; 17
  `audience`, zero). The only anatomy-adjacent signal is `product_type_dial`,
  already claimed by the Sensation Map. Re-open only if an anatomy taxonomy is
  backfilled catalogue-wide.
- **"Which part do you want to last longer?" (the waiting / the build / the peak
  / the after).** Genuinely new input and the best unbuilt idea of this cycle.
  Rejected on the label-promise rule: the phases would have to be mapped onto
  mood tags (`Slow-And-Intimate` for the build, `Comforting` for the after) that
  were never written to mean phases, so the chip would promise a phase the tag
  cannot deliver. Buildable the day a phase-of-encounter tag exists; logged so
  the next cycle starts from here rather than re-deriving it.
- **"When does it usually find you?" (time of day).** Same mapping problem, plus
  it edges into the charter's mind-reading ban by asserting a pattern about the
  reader.
- **"Too much / just right / not enough" calibration against real products.**
  Rejected as too close to Either / Or's tap-through shape, and it needs a
  per-product intensity scalar (`sensation_dial`) whose catalogue coverage is
  unverified. A calibration instrument on partial data mis-calibrates silently.
- **"Who is it for?" (a gifting axis: `Gift` / `Self-Gift` / `Gift-Idea`).**
  Measured and rejected: `Self-Gift` returns **0** on all four stance poles
  (§4), and gifting is circumstance, not self-knowledge, so it fails the §9 bar
  even where the data holds.
- **Rendering the room axis as a distance slider ("here" → "another city").**
  Rejected: How You Arrive owns the slider shape on this bench, and company is
  categorical, not continuous. A slider would imply interpolation that does not
  exist.
- **A third axis (room x stance x budget).** Rejected on measurement cost (60+
  reachable states, all needing probes) and on friction. Two taps is already the
  ceiling for this visitor.
- **A personality label ("You're a giver").** Standing rejection across
  `how-you-arrive.md`, `sensation-map.md` and `nothing-in-the-way.md`, kept
  consistent. A badge that types the person is off-register, and it is worst on
  an axis about power.
- **`First-Time` as a room pole.** Rejected on measurement, not on taste:
  0 / 0 / 0 / 1 across the stance axis (§4). The most valuable sentence a new
  visitor could say to us is the one our vocabulary cannot carry.
- **Showing the count ("278 for when you're apart").** Rejected twice over: a
  live index number frozen into a Sanity string goes stale silently, and a result
  count drags an editorial band toward reading like a search results page.
- **Building it this cycle.** Deferred, correctly. GA4 is below the
  300-sessions/week weighting threshold, so per `routine-design-cycle.md` §1 the
  ambition mandate is satisfied by the wire plus the measured matrix. The
  expensive half waits until traffic can see it, and §11 says it should wait for
  a bench ranking too.

## 13. Status

Proposal only. Not scheduled. Zero code, zero routes, zero schema, zero generated
images, zero dollars of image budget written this cycle. The build-readiness gate
is **passed on data**: 76 credential-free probes, 60 combinations measured, 20
reachable v1 states measured and 20 PASS, six candidate poles excluded on
measurement (`First-Time`, `Self-Gift`, `Bachelorette`, `Anniversary`,
`Non-Binary` on the room axis; `Slow-And-Intimate` on the stance axis) and two
held as verified spares. Counts are a 2026-09-23 snapshot of a live index that
moves with imports and stock; `Long-Distance` is the pole to re-measure first.
Next step if adopted is a bench ranking, then a named spec through `homepage-ia`,
then an additive `roomStanceBand` document, then `rr7-engineer` behind the
reviewed-PR path.
