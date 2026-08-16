# Nº 07 · The Curiosity Shelf — design spec

> Replacement for the Sensation Map band (`app/components/store/SensationMap.tsx`,
> band key `sensationMap`, heading "What are you curious about?").
>
> **Owner direction (Mike, 2026-08-15, verbatim):** *"The 'What are you curious about'
> section - I like the concept of this section, but it's stale and the products need to be
> changed out. This feels like it's broken when I use the interface. It's been the same
> products in the options since it was implemented. Come up with a better way to give
> customers a way to discover new products in a nice simple interface. Consult the
> /all-hands team and use the /ui-ux-pro-max and the /design-taste-skill-pack to craft
> something that demands exploration."*
>
> **Binding authority order for this spec:** `docs/emma-voice.md` (words) →
> `docs/design-doctrine.md` v1.1 (pixels) → engineering constraints (SSR, zero CLS,
> `.server.ts` boundary, additive-only Sanity) → this document → taste-skill preferences.
>
> Status: ready for one Routine B cycle. Author: `homepage-designer`, 2026-08-15.

---

## Taste decision (before anything else)

Router: `.claude/skills/taste-skill/SKILL.md` → **`editorial-premium`**
(`DESIGN_VARIANCE 5 · MOTION_INTENSITY 2 · VISUAL_DENSITY 3`).

Why that style and not another: the doctrine's one-line brief is "a beautifully
art-directed magazine that happens to sell sex toys," and the failing band is failing in
exactly the way editorial-premium is built to fix. Today it reads as a *control panel*
(two labelled dials, "Dial A", "Dial B", a settings-panel split) sitting inside a
magazine. Editorial-premium's rules that we actually apply here:

- *"Do not solve the whole page with cards. Use rails, image plates, split fields, bands"* →
  the instrument becomes a **masthead + shelf**, not a widget with a results pane.
- *"Asymmetry should be deliberate: 4/8 or 5/7 splits are stronger than 6/6"* → the desktop
  header is a 5/7 split (question left, choices right); the old band's `0.85fr / 1.15fr`
  instrument/results split is retired.
- *"Loading states should preserve layout structure"*, *"empty states must explain"*,
  *"error states must preserve user effort"* → we design the failure out instead of
  styling it (see §B).
- *"Motion should stay near-silent... reading rhythm always wins"* → one crossfade beat,
  no spinner theatre.

`ui-ux-pro-max` was run (`search.py "ecommerce product discovery editorial curated warm"
--design-system`). **Its palette (#2563EB/#F97316) and font pairing (Rubik/Nunito Sans) are
rejected** — the doctrine's v3 tokens and Newsreader/DM Sans/JetBrains Mono bind. What we
*did* take from it, and it is load-bearing:

| ui-ux-pro-max rule | Applied as |
|---|---|
| §1 `color-contrast` 4.5:1 | The active pill is re-designed: white-on-coral is **3.1:1 and fails AA today**. Fixed in §C. |
| §2 `touch-target-size` / `touch-spacing` | Every pill ≥ 44px tall, 8px gaps, 375px-first. |
| §2 `loading-buttons` / `hover-vs-tap` | No hover-only affordances; no async button state, because there is no async. |
| §7 `fade-crossfade` ("crossfade for content replacement within the same container") | The restock beat. |
| §7 `stagger-sequence` 30–50ms | 40ms per card on restock (documented deviation from the 60ms *scroll* stagger, §G). |
| §8 `empty-states` / `error-recovery` | Retired by construction: no state can be empty at runtime (§E). |
| §9 `deep-linking` | Each lane keeps a real collection URL ("See the full fit →"). |

---

## (a) Concept name + pitch

### **The Curiosity Shelf**

One question, one row of curiosities, and a shelf of six real products underneath that
**restocks in place** every time you touch it. Instead of two abstract dials whose 25
combinations mostly collapse into the same three products, the visitor gets five named
appetites written in Emma's voice ("Hands free", "Something that hums", "Worn, not held").
Tap one and the six products under it are replaced, instantly, with a soft staggered
crossfade — no spinner, no network call, no possibility of a tap that does nothing. Tap
"Show me another six" and the same lane restocks with six more it has been holding back,
which is the invitation to keep going: the shelf always has something you have not seen
yet. The whole slate — labels, Emma's lines, the curated products behind each pill, and
where each pill's "see the full fit" goes — is a Sanity document the merchandising routine
rewrites daily, and even on a day nobody writes anything, the deck rotates on its own. The
concept Mike likes is preserved exactly: pick what you are curious about, see product
immediately. What is removed is the machinery that made it feel like a broken instrument.

---

## (b) Interaction model

### The object model

```
CuriosityShelf
├── eyebrow, heading, emphasis word, Emma's band line   (Sanity, daily-editable)
└── lanes[3..5]                                          (Sanity, daily-editable)
    ├── label            "Hands free"        (the pill)
    ├── key              "hands-free"        (stable id, analytics + default pick)
    ├── emmaLine         one line, swaps in under the pills when selected
    ├── deck[12]         resolved at build: 2 pages of 6, never fewer than 6
    └── seeAllHref       a verified /collections/{handle}
```

**The single most important architectural decision: the band does not fetch.** All lanes
arrive fully resolved in the SSR loader payload (which is itself the precomputed homepage
blob). Selecting a lane is local state over data that is already in memory. There is no
`useFetcher`, no `/api/*` round trip, no rate limit, no error path, and therefore no way
for a tap to flip a pill without changing the products. Every runtime interaction is
guaranteed to be an instant, visible change, because every fallback decision was already
made on the server at blob-build time.

### States

| State | What is true | What the visitor sees |
|---|---|---|
| **SSR default** | `lane = lanes[dayBucket % lanes.length]`, `page = 0` | Fully rendered, final state, no flash. Heading, five pills with one selected, Emma's lane line, six products, "Show me another six", "See the full fit →". |
| **Pick a lane** | local `setState({lane, page: 0})` | Six cards crossfade to the new six (40ms stagger). The selected pill lifts to the paper/coral treatment; the previous one drops back. Emma's line swaps. The see-all href swaps to the new lane's collection. Announced once via `aria-live="polite"`. |
| **Show me another six** | `page = (page + 1) % 2` | Same six-slot shelf, six different products from the same lane, same crossfade. Wrapping back to page 0 announces "Back to the first six under {label}." — honest, no pretence of infinity. |
| **Hover / focus (pointer + keyboard)** | — | Unselected pill: border darkens `line → line-2`, label `ink-3 → ink`. Card: existing `group-hover:scale-[1.04]` image treatment, unchanged. |
| **Press** | — | Pill `active:scale-[0.97]`, `--duration-fast`. Transform only. |
| **Reduced motion** | `prefers-reduced-motion: reduce` | Identical content, swap is instantaneous. No crossfade, no press scale. |
| **Pre-hydration** | JS not yet attached | The default lane's six products and the see-all link are complete and useful. Pills render in their final visual state but are inert for the ~few hundred ms before hydration. The band is Nº 07, far below the fold — it is hydrated long before it is scrolled into view. This is the *only* inert window and it is documented, not hidden. |
| **Degraded: a lane cannot fill six** | build time, server | The lane is **dropped from the payload**. It never reaches the browser, so it can never be a dead pill. |
| **Degraded: fewer than 3 lanes survive** | build time, server | The band renders `null`. The page loses a section and loses nothing else. Same shape as today's "cold index → skip the band". |
| **Degraded: Sanity doc absent / unpublished / invalid** | build time, server | Code-side `DEFAULT_LANES` renders. Unpublishing the doc is a complete rollback, exactly like `storefrontHome`. |
| **Empty state** | — | Does not exist. There is no runtime query that can return nothing. |
| **Error state** | — | Does not exist at runtime. A Sanity read failure is caught in `.server.ts` and returns `null` → defaults. |

### What explicitly does *not* happen

- No URL/query-param state (it would re-run the homepage loader for a browse gesture).
- No re-tap-on-active-pill shortcut. The pills are a `radiogroup`; clicking a checked radio
  is a no-op by contract, and "Show me another six" is the one, visible, labelled
  reshuffle affordance (`gesture-alternative`, ui-ux-pro-max §2).
- No skeletons, shimmer, or artificial delay. Nothing is loading, so nothing pretends to.
- No "relaxed match" concept. It is gone. See §E.

### Image handling on page 2

Only the six visible cards are in the DOM (rendering 60 hidden cards would pull 60
images). On the visitor's **first interaction with the band** (first pill focus or tap), the
component warms the current lane's page-2 image URLs with `new Image()` at idle. Card
frames are fixed-aspect (`aspect-square`, already the card's contract), so a late image is
a placeholder filling in, never a reflow. No CLS either way.

---

## (c) Layout

Band place in the page order is **unchanged**: slot `sensationMap`, Nº 07, between Nº 06
Emma's edit (`paper-2`) and Nº 08 Couples (`paper-3`), on the **`plum-soft`** ground.
Doctrine §1 ground alternation is preserved byte for byte, and — critically — **the band
key stays `sensationMap`** in `BAND_NAMES` / `KNOWN_BANDS`. Renaming the key would silently
drop the band from any already-published `storefrontHome` layout. Only the component and
its data change.

Frame: `max-w-[1320px]`, `px-6 md:px-16`, `py-16 md:py-20`. Radii 22px (`--radius-lg`) on
pills and cards, 8px nowhere in this band. No new max-width, no new radius, no new padding
scale.

### 375px (design-first)

```
┌───────────────────────────────────────────┐  bg-plum-soft
│  Nº 07                                    │  mono 11px ink-4 .18em
│  TONIGHT'S CURIOSITIES                    │  mono 11px plum .18em      mb-3
│                                           │
│  What are you curious about?              │  Newsreader 1.9rem/1.1 ink
│                     ^^^^^^^ plum italic   │  .em = one word only
│                                           │
│  Pick one. I restock the shelf with six   │  DM Sans 16.5px ink-3
│  that fit.                                │  max 46ch                  mb-7
│                                           │
│  ┌──────────────┐ ┌──────────────────────┐│  pill row, WRAPS (no
│  │ ● Hands free │ │ Something that hums  ││  horizontal scroll)
│  └──────────────┘ └──────────────────────┘│  44px tall, gap 8px
│  ┌──────────────┐ ┌───────┐ ┌────────────┐│  ● = 6px coral dot on
│  │ Made for two │ │ Slick │ │ Worn, not  ││      the selected pill
│  └──────────────┘ └───────┘ │  held      ││
│                             └────────────┘│                           mb-5
│  ♥ Set it, lie back, let it work.         │  Newsreader italic 1.05rem
│                                           │  sage · aria-live polite  mb-6
│  ┌─────────────┐ ┌─────────────┐          │
│  │   card 1    │ │   card 2    │          │  2 cols × 3 rows
│  ├─────────────┤ ├─────────────┤          │  gap-3 (12px)
│  │   card 3    │ │   card 4    │          │  aspect-square media
│  ├─────────────┤ ├─────────────┤          │  StorefrontProductCard
│  │   card 5    │ │   card 6    │          │  fluid, unchanged
│  └─────────────┘ └─────────────┘          │                           mb-7
│  ─────────────────────────────────────    │  hairline border-line
│  ┌────────────────────┐                   │
│  │ Show me another six│  See the full fit→│  ghost btn 44px + quiet
│  └────────────────────┘                   │  ink→plum text link
└───────────────────────────────────────────┘
```

Notes that matter at 375px:
- The pill row **wraps**; it does not scroll horizontally. The current `overflow-x-auto`
  row hides notches off-screen behind an invisible scrollbar, which is a direct contributor
  to "it feels broken" — you cannot explore what you cannot see. Five pills at ≤16
  characters wrap to two comfortable lines at 375px.
- The shelf is a **grid, not a scroller**. Six visible products, nothing hidden. Doctrine
  §6: grid = 2-up mobile, "the considered set". The band above it (Nº 06 Emma's edit) is
  the horizontal rail, so the page still alternates grid ↔ rail rhythm.
- Exactly six cards, always, at every breakpoint: the shelf's height is constant, so a
  restock cannot shift the page by a pixel.

### md (768px)

Heading block full width. Pill row full width, one line. Shelf **3 cols × 2 rows**.
Footer row stays `Show me another six` (left) / `See the full fit →` (right).

### lg (1024px+, content 1320px)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Nº 07 · TONIGHT'S CURIOSITIES                                                 │
│                                                                               │
│ ┌── col span 5 ─────────────────┐  ┌── col span 7 ───────────────────────────┐│
│ │ What are you curious          │  │ (Hands free●)(Something that hums)      ││
│ │ about?                        │  │ (Made for two)(Slick)(Worn, not held)   ││
│ │  Newsreader 2.9rem, max 18ch  │  │                                          ││
│ │                               │  │ ♥ Set it, lie back, let it work.        ││
│ │ Pick one. I restock the shelf │  │                                          ││
│ │ with six that fit.            │  │                                          ││
│ └───────────────────────────────┘  └──────────────────────────────────────────┘│
│                                                                               │
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   6 across, ~196px cards,     │
│ │  1  │ │  2  │ │  3  │ │  4  │ │  5  │ │  6  │   gap-4 — the shelf reads as   │
│ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘   one continuous shelf         │
│ ─────────────────────────────────────────────────────────────────────────────  │
│ [ Show me another six ]                                  See the full fit →   │
└──────────────────────────────────────────────────────────────────────────────┘
```

The 5/7 split is the editorial-premium move: the question sits at reading size on the left,
the choices sit at eye level on the right, and the shelf runs the full 1320px underneath —
so the payoff is physically wider than the instrument, which is the opposite of today's
`0.85fr` instrument / `1.15fr` results panel.

---

## (d) Content model — the Sanity seam

**Additive only.** Two new files, zero edits to any existing schema file. The only change to
an existing Studio file is appending two imports and two entries to the `schemaTypes`
array in `studio/schemaTypes/index.js`, which is how every previous additive block landed.

### New object type — `studio/schemas/blocks/curiosityLane.js`

| Field | Type | Rules | Purpose |
|---|---|---|---|
| `label` | string | required, max 16 | The pill. 16 chars keeps two-per-line wrapping at 375px. |
| `key` | string | required, `^[a-z0-9]+(-[a-z0-9]+)*$`, unique in the array | Stable id for the default-lane rotation and analytics. Renaming `label` daily must not churn analytics. |
| `emmaLine` | string | max 90 | The line under the pills when this lane is selected. Voice-gated. |
| `productHandles` | array of string | max 12 | The curated deck, in order. Bare Shopify handles. Empty = pure algorithmic backfill. |
| `backfill` | object | see below | The rule that fills the deck up to 12 and keeps the lane alive on a day nobody curates. |
| `backfill.typeDial` | string (list = `PRODUCT_TYPE_DIALS`) | required unless `productHandles` ≥ 6 | The category floor. This is what makes an absurd result impossible. |
| `backfill.mood` | string | optional | One mood tag from the live vocab; scored, not filtered hard. |
| `backfill.minPrice` / `maxPrice` | number | optional, 0–500 | Lane price window. `maxPrice` overrides the global $150 shelf ceiling when a lane genuinely wants to sell up. |
| `seeAllHandle` | string | required, handle pattern | Bare collection handle for "See the full fit →". Validated against the live collection list at build; falls back to `best-sellers`. |
| `enabled` | boolean | default true | Hide a lane without deleting the curation. |

### New singleton document — `studio/schemas/curiosityShelf.js`, id `singleton.curiosityShelf`

`__experimental_actions: ['update','publish']` (singleton, same as `storefrontHome`).

| Field | Type | Rules | Purpose |
|---|---|---|---|
| `note` | string | max 160 | Internal: what this slate is for. Shows in the Studio preview. |
| `enabled` | boolean | default true | Kill switch back to code defaults without unpublishing. |
| `eyebrow` | string | max 28 | Mono kicker. Default "TONIGHT'S CURIOSITIES". |
| `heading` | string | max 60 | Default "What are you curious about?" |
| `emphasis` | string | max 20, must be a substring of `heading` | The one plum italic word. Doctrine §2: exactly one, never two. Validation enforces the substring so a bad edit cannot produce an un-emphasised heading. |
| `emmaLine` | text, 2 rows | max 140 | The band's sub-line. |
| `lanes` | array of `curiosityLane` | min 3, max 5 | Fewer, clearer choices. 5 is the hard ceiling; 6 wraps to three lines at 375px. |
| `updatedAt` | datetime | readOnly | Provenance for the daily diff. |

### Who writes it, and when

The **Routine A daily merchandiser** (`docs/homepage-team/routine-daily-merchandise.md`),
as a new Step 5 surface, using `npx tsx scripts/sanity-content-cli.ts` — never the Sanity
MCP, per that routine's own rule. One `patch` + one `publish` per day, batched with the
rest of the page's writes:

```bash
npx tsx scripts/sanity-content-cli.ts patch --id singleton.curiosityShelf \
  --set '{"eyebrow":"...","heading":"...","emphasis":"...","emmaLine":"...","lanes":[...],"updatedAt":"..."}' --dry-run
npx tsx scripts/sanity-content-cli.ts patch --id singleton.curiosityShelf --set '{...}'
npx tsx scripts/sanity-content-cli.ts publish --id singleton.curiosityShelf
```

Add a row to that routine's surface table:

| Curiosity shelf | `singleton.curiosityShelf` (`curiosityShelf`): `eyebrow`, `heading`, `emphasis`, `emmaLine`, `lanes[]`. Lane labels and Emma lines are voice-gated copy; `productHandles` are the curated deck. Absent/disabled → code `DEFAULT_LANES`. | storefront `/` Nº 07 |

Routine rules that apply unchanged: "reviewed, no change" must not touch Sanity (log a
`decision` event); the week's theme from `marketing_calendar` should tint at least the
eyebrow and one lane label; the copy passes `emma-empathy-reviewer` before publish.

### Freshness without a human, and without a deploy

Three independent freshness sources, in priority order:

1. **Sanity, daily** — labels, Emma lines, curated handles, heading, eyebrow. The
   merchandising team's lever. This is the one that was completely missing.
2. **Deck rotation, daily, automatic** — the backfill tail of every lane rotates by
   `(dayBucket + laneIndex) % deckLength` at blob-build time, so the visible six change day
   over day even if nobody writes anything. Curated handles are **pinned to the front and
   never rotated** — a merchandiser's pick stays on page 1.
3. **Default lane rotation, daily** — `lanes[dayBucket % lanes.length]` is preselected, so
   the band's own first impression changes too (this is the only rotation that exists
   today, and by itself it was not enough).

All three are realised on the `/cron/warm` blob rebuild (every 15 min), so day-granularity
rotation is safe, exactly as the current `dayBucket` seed is.

---

## (e) Selection and data rules

All of this runs **on the server, at payload build**, in a pure, unit-tested module. Nothing
here runs in the browser.

**Constants**

```
SHELF_SLOTS          = 6     // always exactly six visible
SHELF_DECK           = 12    // 2 pages per lane
SHELF_MAX_LANES      = 5
SHELF_MIN_LANES      = 3
SHELF_PRICE_CEILING  = 150   // dollars, per-lane overridable via backfill.maxPrice
SHELF_PAYLOAD_CAP    = 60    // products total across all lanes (5 × 12)
LOW_BAND             = < 40
HIGH_BAND            = > 80
```

**Per-lane resolution**

1. **Curated first.** Resolve `productHandles` against the discovery index, in order. A
   handle not in the index is dropped and logged (never rendered as a hole).
2. **Backfill pool.** `index.filter(p => (!typeDial || p.productTypeDial === typeDial) &&
   price ∈ [minPrice ?? 0, maxPrice ?? SHELF_PRICE_CEILING])`, ordered by
   `scoreProduct(p, { mood: [backfill.mood] })` desc when a mood is set, then by the
   existing `qualityCompare` (has-image → savings → cheaper → handle).
3. **Filters** (curated items are exempt from the price ceiling only; everything else
   applies to them too):
   - has an image (`imageUrl != null`) — the card is the payoff;
   - in stock (`totalInventory == null || > 0`);
   - not `productType === 'Discontinued'` (reuse the existing exclusion helper).
4. **Family dedupe — one product per family, first wins.** This is the fix for three
   sizes of the same $418.99 jeans:

   ```
   familyKey(p) = brand.toLowerCase() + "|" + p.title.toLowerCase()
     .replace(/\(.*?\)/g, " ")
     .replace(/\b(xx?s|s|m|l|xx?l|small|medium|large|x-?large|petite|plus)\b/g, " ")
     .replace(/\b\d+(\.\d+)?\s?(in|inch|inches|cm|mm|oz|ml)\b/g, " ")
     .replace(/[^a-z0-9]+/g, " ").trim()
   ```

   Curated order is evaluated first, so a merchandiser's explicit pick always beats its
   algorithmic sibling. Where a family collapses, keep the cheapest member that has an
   image. **Required test case: the three Prowler RED jeans sizes collapse to one.**
5. **Category sanity floor.** A backfilled product must match the lane's `typeDial`. There
   is no cross-type relaxation tier and no whole-index fallback — the two mechanisms that
   put jeans under a sensation query. A lane that cannot satisfy its own floor is dropped,
   not loosened.
6. **One widening attempt, server-side only.** If the deck is under `SHELF_SLOTS` after
   filtering, drop the `mood` constraint (never the `typeDial`) and re-run steps 2–4 once.
   Still under 6 → **drop the lane from the payload.**
7. **Price-band mix.** Compose each page of 6 so it contains **at least 2 under $40** and
   **at most 2 over $80**, by greedy interleave across the low/mid/high buckets. If the
   buckets cannot satisfy it, take the closest achievable composition and log — never ship
   fewer than 6, never reorder into a wall of one price. (This is the second half of the
   "absurd" fix: a $120 item is fine next to a $24 one; six $120 items on a $26-AOV
   storefront is not.)
8. **Rotate**, then **page**: `deck = [...curated, ...rotate(backfillTail, dayBucket + laneIndex)]`,
   `page0 = deck[0..5]`, `page1 = deck[6..11]`.

**Band-level**

- Fewer than `SHELF_MIN_LANES` surviving lanes → the band returns `null`.
- More than `SHELF_MAX_LANES` published → take the first 5 enabled.
- Payload budget: hard cap `SHELF_PAYLOAD_CAP = 60` product records. If the serialized
  band exceeds **+40KB raw** on the homepage B blob, trim **lanes before deck** (5 → 4),
  because paging needs multiples of 6. Measure this during the build cycle and record the
  number in the PR.
- `seeAllHref` = `/collections/{lane.seeAllHandle}` when the handle is in the verified
  collection list, else `/collections/best-sellers`. Validated at **build**, so a bad
  handle can never ship a 404 into the band.

**Payload version:** the shape of `HomepagePayloadB` changes, so
`HOMEPAGE_PAYLOAD_B_VERSION` must go `b6` → `b7`. Without the bump, deployed code reads
stale `b6` blobs with the old `sensationMap` shape and the band renders nothing.

---

## (f) Copy direction

All strings below are **direction, not final copy**. `emma-copywriter` writes the shipping
version and `emma-empathy-reviewer` gates it against `docs/emma-voice.md` (v5: desire
register 9 on owned surfaces, act-anchored, no em-dashes, no countdowns, no lived
experience, no "sexy" as a branding adjective, CTA whitelist). The heading keeps Mike's
concept — the question is the thing he likes.

**CTA labels.** `See the full fit →` is retained (already shipped and voice-gated, a quiet
text link rather than a CTA). The one **new** string is the reshuffle button,
**"Show me another six"**, which extends the whitelist stem "Show me". The closer (Nº 09)
and the couples band (Nº 08) already use bare "Show me", so the extension is also what
keeps the three from reading as one duplicated CTA. **Flag this label explicitly for the
voice gate's ruling**; if it is refused, fall back to bare "Show me" and accept the
duplication, or to "Take a peek →".

### Set A — evergreen default (also the code-side `DEFAULT_LANES`)

- Eyebrow: `TONIGHT'S CURIOSITIES`
- Heading: `What are you curious about?` · emphasis: `curious`
- Emma line: `Pick one. I restock the shelf with six that fit.`
- Lanes:

| Pill | Emma line | `typeDial` | `seeAllHandle` |
|---|---|---|---|
| Hands free | `Set it, lie back, let it work.` | vibrator | vibrators |
| Something that hums | `Steady, deep, and easy to aim.` | vibrator (mood: intense) | vibrators |
| Made for two | `Built to be handed over.` | couples | couples |
| Slick | `Everything else works better wet.` | lube | lubricants |
| Worn, not held | `It starts before anything comes off.` | wear | wear |

### Set B — "a gentle place to start" (beginner theme week)

- Eyebrow: `A GENTLE PLACE TO START`
- Heading: `Where would you like to begin?` · emphasis: `begin`
- Emma line: `Six picks behind every door. There is no wrong one.`
- Lanes: `Small and quiet` · `For solo nights` · `Try it together` · `Nothing to insert` ·
  `Under $40`
  - `Small and quiet`: `Discreet enough to leave in the drawer you actually open.`
  - `For solo nights`: `Your pace, your hand, nobody waiting.`
  - `Try it together`: `Easy to hand over, easy to hand back.`
  - `Nothing to insert`: `All of it on the outside, all of it on purpose.`
  - `Under $40`: `Low stakes, real quality. Start here.`
  - `Under $40` uses `backfill.maxPrice: 40` and no `typeDial` — the one lane permitted to
    span types, because price *is* its category.

### Set C — "turn it up" (bolder theme week, register 9)

- Eyebrow: `FOR THE BOLDER NIGHT`
- Heading: `How far are you going tonight?` · emphasis: `going`
- Emma line: `Pick your appetite. The shelf keeps up.`
- Lanes: `Deeper` · `Tied up` · `Two at once` · `Louder` · `All night`
  - `Deeper`: `Length and weight, and a base you can hold onto.`
  - `Tied up`: `Soft on the wrists, serious about the knot.`
  - `Two at once`: `Both places, one toy, no negotiating.`
  - `Louder`: `Motors that do not apologise for the noise they make.`
  - `All night`: `Rechargeable, and rated for longer than you will need.`

**Copy rules the routine must keep.** Lane labels are ≤16 characters and are *appetites*,
not taxonomy — "Something that hums", never "Vibrator". Fresh product-specific language
every day; rotate out any label that has run more than a week. No countdowns, no "tonight
only", no urgency. Emma never claims to have used anything.

---

## (g) Motion spec

Doctrine §5 primitives only. Nothing hand-rolls IntersectionObserver or `whileInView`.

| Element | Treatment | Tokens |
|---|---|---|
| Heading group (numeral + eyebrow + h2 + band line) | `<Reveal variant="up">`, one wrapper for the whole group | `springEntrance`, travel `--reveal-distance` 16px |
| Pill row | `<Reveal variant="fade" delay={0.06}>` on the **whole row** | never per-pill; a staggered pill entrance would read as decoration |
| Shelf (scroll entrance, first time only) | `<Reveal variant="fade">` on the **whole shelf block** | doctrine's rail rule: never per-card inside a set that can re-render |
| Shelf (restock, on state change) | CSS crossfade, per card, keyed on `${laneKey}:${page}` | new `.shelf-restock` utility, below |
| Pill press | `active:scale-[0.97]` | `--duration-fast` 150ms, `--ease-standard` |
| Pill state change | `transition-colors` on border/background/label | `--duration-fast`, `--ease-standard` |
| "Show me another six" glyph | inline SVG rotate mark, `rotate-180` on `:active` | `--duration-fast`; no icon dependency added |
| Card image hover | unchanged (`group-hover:scale-[1.04]`) | `--duration-slow`, `--ease-standard` |
| ♥ heartbeat | **none** | the page's one heartbeat is spent elsewhere (doctrine §3) |

**The one new CSS utility** (add to `app/app.css` alongside the existing motion
utilities — this is a state transition, not a scroll reveal, which is why it is CSS and
not `<Reveal>`):

```css
@keyframes shelf-restock {
  from { opacity: 0.25; transform: translateY(4px); }
  to   { opacity: 1;    transform: none; }
}
.shelf-restock {
  animation: shelf-restock var(--duration-base) var(--ease-entrance) both;
  animation-delay: calc(var(--i, 0) * 40ms);
}
@media (prefers-reduced-motion: reduce) {
  .shelf-restock { animation: none; }
}
```

Each card wrapper sets `style={{ '--i': i }}` and takes `key={`${laneKey}:${page}:${p.id}`}`
so React remounts it and the animation replays. Total tail: 240ms + 5 × 40ms = 440ms.

**Documented deviation:** doctrine §5 sets `STAGGER_STEP` at 60ms. That budget governs
`<Reveal index>` *scroll entrances*. This is an in-place *content replacement* responding
to a tap, where ui-ux-pro-max §7 `stagger-sequence` (30–50ms) and `input-latency` (<100ms
to first feedback) apply; 60ms would push the tail to 540ms and make a tap feel laggy.
40ms is deliberate, is documented here, and should be read as intentional by
`design-critic` rather than scored as a stray value.

**Zero-CLS contract for this band.** Six cards at every breakpoint, fixed grid, fixed
`aspect-square` media frames, opacity + `translateY(4px)` only. Nothing in the restock path
touches layout. **The LCP hero is the Nº 01 headliner product still, in the `hero` band,
and it is not wrapped in any motion wrapper — this spec does not touch it.** No image in
this band is an LCP candidate: Nº 07 sits below Nº 06 and well below the fold at 375px.

---

## (h) Accessibility

**Semantics.** The pill row is a `role="radiogroup"` with `aria-label` set from the band
heading; each pill is `role="radio"` + `aria-checked`. One option is always selected, which
is exactly what a radiogroup means — and it is why re-tapping the active pill does nothing
(the reshuffle lives on its own button).

**Keyboard.** Roving `tabIndex` (`0` on the checked pill, `-1` on the rest). `←`/`↑`
previous, `→`/`↓` next, both selecting on move (standard radiogroup behaviour), `Home`/`End`
to the ends. `Tab` moves out of the group to "Show me another six", then to the first
product card, then to "See the full fit →". Visual order matches DOM order.

**Focus.** `focus-visible:ring-2 ring-ink ring-offset-2 ring-offset-plum-soft` — ink, not
plum, because plum on `plum-soft` is too low-contrast to serve as a focus indicator. Never
`outline: none` without a replacement.

**Announcements.** One `aria-live="polite"` region: Emma's lane line, which also carries a
visually-hidden suffix describing the change ("Six picks." / "Six more."). The product grid
itself is **not** a live region — announcing six product names on every tap is hostile.

**Touch.** Every pill ≥ 44px tall (`py-3` + 15px label) with 8px gaps; the reshuffle button
is 44px; product cards are card-sized targets. `touch-action: manipulation` on the pill row.

**Contrast** (all against the `plum-soft` `#F3E8FB` ground unless noted):

| Element | Colors | Ratio | Verdict |
|---|---|---|---|
| Heading | `ink` on `plum-soft` | ~15:1 | pass |
| Band line | `ink-3` on `plum-soft` | ~5.3:1 | pass |
| Emma lane line | `sage` on `plum-soft` | ~3.3:1 | **large text only** — it renders at 1.05rem italic display; bump to `text-[1.15rem]` or use `ink-3` if the contrast check disagrees at ship time. Flagged for QA. |
| **Selected pill (new)** | `ink` label on `paper` fill, 1.5px `coral` ring, 6px `coral` dot | ~15:1 | pass |
| **Selected pill (today, being retired)** | `white` on `coral` | **3.10:1** | **fails AA for 14px text.** This is a real, shipped defect and this redesign fixes it. |
| Unselected pill | `ink-3` label, `border-line`, transparent fill | ~5.3:1 | pass |
| Reshuffle button | `ink` label, `border-line-2` ghost | ~15:1 | pass |
| See-all link | `ink` → `plum` on hover | ~15:1 / ~7:1 | pass |

**Coral budget (doctrine §3).** Exactly one coral element in the band: the selected pill's
hairline ring plus its dot, which read as a single mark. Coral is *not* used as a text
background anywhere, which is what buys back AA without giving up the accent. Selection is
conveyed by fill + border weight + the dot + `aria-checked`, never by color alone
(ui-ux-pro-max §1 `color-not-only`).

**Reduced motion.** `.shelf-restock` animation off, press scale off, `<Reveal>` already
renders the final state. Content and behaviour are identical.

---

## (i) Build plan — `rr7-engineer`, one Routine B cycle

### New files

| File | What |
|---|---|
| `app/types/curiosity.ts` | `CuriosityLane`, `ResolvedLane`, `CuriosityShelfData`, `SHELF_*` constants. |
| `app/lib/curiosity-shelf.ts` | Pure: `familyKey`, `dedupeByFamily`, `applySanityFloor`, `mixPriceBands`, `resolveLane`, `resolveShelf`, `rotate`. No React, no server imports — mirrors the existing `sensation-map.ts` split so it stays trivially testable. |
| `app/lib/curiosity-shelf.server.ts` | `getCuriosityShelfData(now?)`: reads `getDiscoveryIndex()` + `getCuriosityShelf()` (Sanity), falls back to `DEFAULT_LANES`, returns `CuriosityShelfData | null`. |
| `app/lib/curiosity-shelf.test.ts` | See test list below. |
| `app/components/store/CuriosityShelf.tsx` | The band. Local `useState` only; no `useFetcher`, no `useEffect` data fetch. |
| `studio/schemas/blocks/curiosityLane.js` | Object type per §d. |
| `studio/schemas/curiosityShelf.js` | Singleton document per §d. |

### Changed files

| File | Change |
|---|---|
| `studio/schemaTypes/index.js` | Append two imports + two array entries. Nothing existing edited. |
| `app/lib/sanity.server.ts` | Add `CURIOSITY_SHELF_GROQ` + `getCuriosityShelf(preview)` modelled directly on `getStorefrontHomeLayout` (try/catch → `null`, `cached('sanity:curiosity-shelf', 60, …)`). Plain JSON only — no `Map`/`Set`/`Date` through `cached()`. |
| `app/lib/storefront-home.server.ts` | Replace `getSensationMapData()` with `getCuriosityShelfData()`; payload field `sensationMap` → `curiosityShelf`. |
| `app/lib/homepage-payload.server.ts` | Same field swap; **bump `HOMEPAGE_PAYLOAD_B_VERSION` `'b6'` → `'b7'`**. |
| `app/components/store/StorefrontHome.tsx` | `bands.sensationMap` renders `<CuriosityShelf …/>` when data is non-null, else `null`. **Band key, `BAND_NAMES`, and `DEFAULT_BAND_ORDER` are untouched.** |
| `app/lib/sanity.server.ts` (`KNOWN_BANDS`) | Untouched — `sensationMap` stays a valid band name. |
| `app/app.css` | Add the `.shelf-restock` keyframes + reduced-motion guard in the motion-utilities section. |
| `app/routes/admin.design-gallery.tsx` | Swap `getSensationMapData` → `getCuriosityShelfData` and the rendered component. |
| `docs/homepage-team/routine-daily-merchandise.md` | New Step 5 surface row + the `sanity-content-cli` snippet from §d. |
| `docs/homepage-team/design-changelog.md` | One entry. |

### Deleted files

| File | Why it is safe |
|---|---|
| `app/components/store/SensationMap.tsx` | Only consumer is `StorefrontHome`. |
| `app/lib/sensation-map.ts` + its test | Importers: the server module and the api route, both going. Confirm `TYPE_LABELS` has no other importer before deleting (grep showed none outside this cluster). |
| `app/lib/sensation-map.server.ts` + its test | Importers: `storefront-home.server.ts`, `admin.design-gallery.tsx`, both updated. |
| `app/routes/api.sensation-map.tsx` | **This is the point of the redesign.** No runtime fetch means no rate limit, no 429, no silent fallback. The `'sensation-map'` rate-limit bucket needs no migration. |

### What stays

- **The discovery index and `scoreProduct`** — still the backfill engine. We are not
  inventing a taxonomy; `productTypeDial` and the mood vocab keep doing the work.
- `StorefrontProductCard` (`fluid`), `OptimizedImage`, `Reveal`, `variants.ts` — all reused
  as-is. No new component vocabulary, no new dependency, no icon library.
- The band's slot, numeral (Nº 07), `plum-soft` ground, and the heading concept.
- `qualityCompare`'s ordering intent — port it into `curiosity-shelf.ts` rather than
  importing across a deleted module.

### Tests (`app/lib/curiosity-shelf.test.ts`)

1. Three same-family products (the Prowler RED jeans trio) collapse to one; the cheapest
   with an image survives.
2. A curated handle beats its algorithmic sibling in the same family.
3. A lane whose backfill cannot reach 6 after filtering is dropped from the result.
4. Fewer than 3 surviving lanes → `resolveShelf` returns `null`.
5. Backfilled products never cross the lane's `typeDial`.
6. Default `$150` ceiling excludes a `$418.99` item; a lane setting `maxPrice: 500` admits it.
7. Every shipped page of 6 has ≥2 under `$40` and ≤2 over `$80` when the buckets allow.
8. Deck rotation: `dayBucket` N and N+1 produce different page-0 sets; curated handles hold
   position 0..n in both.
9. Absent/invalid Sanity doc → `DEFAULT_LANES` render.
10. Every lane's `seeAllHref` resolves to a verified collection or `best-sellers`.

### QA acceptance (`qa-reviewer`, preview MCP)

- 375px and 1440px screenshots of the band, default and after two lane taps.
- CLS = 0 across a pill tap and a reshuffle (the restock must not move the page).
- Reduced-motion pass: content identical, no animation.
- Keyboard pass: arrows move and select, focus ring visible on `plum-soft`.
- Tap every pill on a real preview deploy and confirm the six products change every time.
- Record the band's contribution to the payload B blob size in the PR.

### Handoffs

| Work | Agent |
|---|---|
| Band structure stays in the existing IA slot (no new section) | `homepage-ia` — informed, no change requested |
| Components, loaders, payload, CSS utility, deletions | `rr7-engineer` (Routine B → PR; the release engine merges after CI + QA) |
| `curiosityShelf` + `curiosityLane` schema files and Studio registration | `sanity-content-builder` (additive only) |
| Lane labels, Emma lines, heading sets, the "Show me another six" ruling | `emma-copywriter`, gated by `emma-empathy-reviewer` |
| Daily slate writes from day one | Routine A daily merchandiser (`homepage-orchestrator`) |
| Imagery | **none requested.** This band renders real product photography from Shopify. No fal.ai spend, no `media-manager` brief. |
| Visual + perf acceptance | `qa-reviewer` |

---

## (j) The current defects, and how the design retires each one

| # | Defect (verified 2026-08-15) | Retired by |
|---|---|---|
| 1 | **Silent no-op.** On an API error or the 120/60s rate limit, `SensationMap.tsx:97` falls back to `defaultMatch`: the pill flips active but the products do not change. This is the "feels broken" report, exactly. | **Structural.** The band no longer fetches. All lanes ship resolved in the SSR payload; a tap is local state over in-memory data. There is no request to fail, no rate limit to hit, and no fallback branch to take. Every tap changes six products, always. |
| 2 | **"See the full fit" links the requested type, not the resolved type** after a relaxed match, so the link contradicts what is on screen. | **Structural.** Relaxation is gone, so "requested vs resolved" no longer exists. Each lane carries an authored `seeAllHandle`, validated against the live collection list at build. |
| 3 | **Three size variants of the same $418.99 Prowler RED jeans** for "to wear + sensual": no family dedupe, no category sanity floor. | Family-key dedupe (§e.4, with that exact trio as a required test case), the `$150` shelf ceiling with per-lane override (§e.2), the hard `typeDial` floor on all backfill (§e.5), and the price-band mix rule (§e.7). |
| 4 | **The merchandising team has no lever.** The band is derived entirely from the index; nothing about it is Sanity-driven, so it has never visibly changed. | `singleton.curiosityShelf`: heading, eyebrow, emphasis word, band line, and per-lane label / Emma line / curated deck / see-all target — all daily-editable, written by Routine A with `sanity-content-cli`. |
| 5 | **Stale products.** Only the *default type notch* rotated daily; the matched set per state is a deterministic `qualityCompare` order, so any given pill has returned the same three products since launch. | Three layered freshness sources: Sanity curation (daily, human/agent), deck rotation of the backfill tail by `dayBucket + laneIndex` (daily, automatic, no deploy), and default-lane rotation. Plus "Show me another six", which surfaces the second half of the deck on demand. |
| 6 | **Control-panel UX.** Two dials labelled "Dial A" and "Dial B" produce 25 combinations, most of which collapse to the same relaxed result; only three products pay it off, in a horizontal scroller that hides some of them. | One row of five named appetites. One choice, six visible products, no hidden scroll, no taxonomy words, no combinatorial dead space. Fewer, clearer choices, per the brief. |
| 7 | **Only 3 products, in a scroller** — a thin payoff for an interaction that asks the visitor to think. | Six products in a real grid: 2×3 at 375px, 3×2 at md, 6-across at lg. Nothing hidden, no scrollbar, constant height. |
| 8 | **Pills scroll horizontally off-screen at 375px** with a hidden scrollbar, so options are undiscoverable. | The pill row wraps. Every choice is visible at 375px. |
| 9 | **AA contrast failure** on the active pill: `white` on `coral` is 3.10:1 at 14px. | Selected pill re-designed to `paper` fill + `ink` label + `coral` ring and dot (~15:1), which also keeps the coral budget at exactly one element. |
| 10 | **No keyboard model.** `<fieldset>` + `<button aria-pressed>` gives no arrow-key navigation and no "one of N" semantics. | `role="radiogroup"` with roving tabindex, arrow/Home/End handling, `aria-checked`, and an ink focus ring that is actually visible on `plum-soft`. |
| 11 | **A relaxed result apologises in copy** ("Here is the closest fit") — the interface admitting it did not do what was asked. | Nothing is ever relaxed at runtime, so nothing apologises. Emma's line is a straight, act-anchored read of the lane the visitor chose. |

---

## Doctrine citation (per §8 acceptance rules)

**Moves chosen:** §1 band frame `max-w-[1320px]` / `px-6 md:px-16` / `py-16 md:py-20`, ground
alternation preserved (`paper-2` → **`plum-soft`** → `paper-3`); §2 Newsreader H2
`1.9rem md:2.9rem` with exactly one `.em` plum italic word, mono `Nº 07` numeral + eyebrow at
11px/`0.18em`/`ink-4`, body 16.5px `ink-3` at ≤46ch; §3 coral rationed to one element (the
selected pill's ring + dot), plum as the band ground, sage on Emma's aside, one ♥ and no
heartbeat, hairline `border-line` instead of shadows, radius 22px throughout; §5 `<Reveal>`
`up` on the heading group and `fade` on the pill row and shelf block, springs and durations
from tokens, transform/opacity only, reduced motion renders the final state; §6 reuses the
shipped grid + card vocabulary and adds no new component archetype; §8 the LCP hero is
untouched and unwrapped.

**Tokens used:** `plum-soft`, `paper`, `paper-2`, `ink`, `ink-3`, `ink-4`, `line`, `line-2`,
`coral`, `plum`, `sage`, `--radius-lg`, `--duration-fast`, `--duration-base`,
`--duration-slow`, `--ease-entrance`, `--ease-standard`, `--reveal-distance`,
`font-display`, `font-body`, `font-mono`. No new token, no new max-width, no new radius.

**Documented deviations, both deliberate:** the 40ms restock stagger (§g) and the retirement
of `white`-on-`coral` for the selected pill in favour of an AA-compliant treatment (§h).
