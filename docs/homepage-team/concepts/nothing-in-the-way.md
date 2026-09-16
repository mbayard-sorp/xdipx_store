# Concept Wire — Nothing in the Way

> Routine B (Design Cycle) ambition-mandate deliverable, run 905, 2026-09-16.
> Mission brief §9: carry at least one genuinely new exploration/self-discovery
> experience concept to a wire each cycle. **This is a design artifact only.**
> Nothing here ships without IA review, additive-only Sanity schema, and an
> `emma-empathy-reviewer` pass on every customer-facing string. All copy below
> is **illustrative** and has not cleared the voice gate. The doctrine
> (`docs/design-doctrine.md`) wins over this wire on every visual call; the
> voice charter (`docs/emma-voice.md`) wins over everything. Format precedent:
> `concepts/sensation-map.md`, `concepts/either-or.md`, `concepts/how-you-arrive.md`,
> `concepts/the-next-step.md`, `concepts/first-tap.md`, `concepts/curiosity-echo.md`.

## 1. The idea in one line, and the job it serves

**One tap on the thing that would stop you.** A homepage band asks a question no
competitor asks and no xdipx surface asks either: not what you want, but what is
in the way. Six chips in the visitor's own words ("Someone will hear it.",
"There is nowhere to keep it.", "It is my first one.", "The cleanup.", "It will
die halfway through.", "I want to take it with me."). Tap one, and the shelf
below rebuilds to products that clear it, carrying **one plain mechanics
sentence** that answers that specific worry rather than a badge that reassures in
general. An optional second tap adds one thing that is a *yes* (Sensual,
Playful, Bold, Curious) and narrows the shelf again. Every result is a direct
`/products/{handle}` link.

**Journey job (mission brief §7): ORIENT the blocked visitor, then TEMPT.** The
six concepts already banked are all appetite instruments. The Compass filters,
the Sensation Map and How You Arrive read preference off dials, Either / Or
accumulates binary leanings, The Next Step walks a ladder from what you own,
Curiosity Echo reflects what you reached for, First Tap catches an arrival
intent. **Every one of them assumes the visitor is free to want something.** A
large share of people in this category are not stuck on what they want, they are
stuck on a practical obstacle they are slightly embarrassed to say out loud, and
they leave without ever expressing it. Nothing in the Way is the first surface
that lets the obstacle be the input.

It passes the §9 bar in a specific way: the visitor learns that their private,
slightly humiliating blocker is a **named, common, solved category** with over a
thousand products behind it. That recognition is the self-discovery, and it
arrives attached to three real products rather than to a reassurance banner.

## 2. Why it is new, measured against the field and against our own six

**The field (live captures, 2026-09-16 run 905 teardown delta).** Honey Play
Box, Dame and TooTimid run eleven separate worry-reassurance surfaces between
them and **every one is inert**: icon-plus-label trust badges, a doctor board, a
static discretion paragraph. Not one is clickable into product; not one changes
what the page shows. TooTimid owns the only first-person door voice in the
capture set ("I want to last longer") and spends all four of its tiles on
appetite, never on constraint. Full evidence and refusal log:
`docs/homepage-team/competitor-teardown-2026-07-live.md`, delta 2026-09-16.

**Our own six.** The differentiator is the *input*, not the interaction shape:

| Concept | Input it takes | Assumes |
|---|---|---|
| Compass (`/discover`) | mood x audience x matters chips | you know your vocabulary |
| Sensation Map | type dial x mood dial | you want a sensation |
| How You Arrive | tempo x touch sliders | you want a tempo |
| Either / Or | binary desire pairs | you can pick between two wants |
| The Next Step | what you already own | you already bought one |
| Curiosity Echo | what you already tapped | you already browsed |
| **Nothing in the Way** | **what is stopping you** | **only that you are hesitating** |

It is also the first concept whose primary axis is the `matters` dimension. The
Compass exposes `matters` as a buried chip group; the other five concepts do not
touch it at all. The vocabulary is already there and already large, and the
homepage exposes exactly none of it (the one `matters` deep link that exists,
`?preset=hands-free` in `app/lib/discovery-presets.ts`, points at an appetite).

## 3. The two axes, in STORAGE form

Tags below are `normalizeTag()` **storage** form, taken from
`GET /api/team/discovery-vocab` this run (index size **5,120**), never from
rendered chip labels. Run 520 shipped two dead poles by copying `displayLabel()`
output off `/discover`; the display string "Easy to Clean" is not a tag, the
stored string `Easy To Clean` is.

### Axis 1 — the one no (required, from `matters`)

| Worry, in the visitor's words (ILLUSTRATIVE, not voice-gated) | Answering tag (storage form) | Index count |
|---|---|---|
| "Someone will hear it." | `Whisper-Quiet` | 100 |
| "There is nowhere to keep it." | `Discreet` | 1011 |
| "It is my first one." | `Beginner-Friendly` | 1609 |
| "The cleanup." | `Easy To Clean` | 2148 |
| "It will die halfway through." | `Rechargeable` | 1070 |
| "I want to take it with me." | `Travel-Ready` | 641 |

Note the semantics, because it is the one thing a builder could get wrong: the
index has no NOT operator (`scoreProduct` in `app/lib/discovery-emma.ts` is
additive intersection only). A worry is therefore always expressed as the
**positive tag that answers it**. The label must keep that promise honestly:
the chip may say "someone will hear it" and the filter says `Whisper-Quiet`,
which is a claim the tag can support. A chip that said "guaranteed silent" would
not be.

### Axis 2 — the one yes (optional, from `mood`)

| Display | Tag (storage form) | Index count |
|---|---|---|
| Sensual | `Sensual` | 1978 |
| Playful | `Playful` | 1710 |
| Bold | `Bold` | 1687 |
| Curious | `Curious` | 1178 |

### Verified spares, held out of v1

`Latex-Free` (2492), `Waterproof` (766), `Plus-Size Friendly` (177),
`Hands-Free` (900). All measured and all passing (§4), held back so the chip row
stays calm at 375px and so the merchandiser has verified rotation stock. Note
`Hands-Free` is an appetite rather than a worry and belongs on a different axis
if it is ever used here.

## 4. Build-readiness: the COMBINATION matrix (playbook §1 cross-product gate)

Per `routine-design-cycle.md` §1 (run 646, `concepts/either-or.md`): a
multi-axis instrument is **not** buildable because each pole clears the `>=2`
floor. Disjoint tag sets are not independent co-occurrence. Every reachable
combination is measured below.

**Method (credential-free, reproducible).** `GET /api/team/discovery-vocab`
(header `x-team-secret: $HOMEPAGE_TEAM_TOKEN`) for per-tag counts. Co-occurrence
is not exposed by that endpoint, so full-match counts come from the public
scoring endpoint exactly as run 646 did it:

```
GET https://xdipx.com/api/discovery?variant=a&budget=300&matters=<TAG>&mood=<TAG>
```

`SCORE_MOOD = 3`, `SCORE_MATTERS = 2`, so a product matching both scores **5**,
the maximum achievable. The full-match count is the number of returned items at
score 5. Two honest limits on the numbers: items are capped at `perRail` 12
across 4 rails (so a reading is a **floor**, ceiling 48) and `budget=300` is
`BUDGET_MAX`. Both limits are irrelevant to the gate, which only asks `>= 2`,
and a 0 or 1 reading is reliable because rails sort score-descending, so any
full match would surface before any partial one.

### Reachable states

The first tap is required and the second is optional, so the reachable set is
**6 worry-only states + 24 worry x yes states = 30**. There is no yes-only state
(the band always starts from a worry) and no empty state (§5 seeds a default
pole server-side). All 30 are measured.

**Worry-only states (score 2), all PASS:**

| Tag | items |
|---|---|
| `Whisper-Quiet` | 14 |
| `Discreet` | 31 |
| `Beginner-Friendly` | 37 |
| `Easy To Clean` | 36 |
| `Rechargeable` | 29 |
| `Travel-Ready` | 32 |

**Worry x yes states (score 5). All 24 PASS the `>=2` floor:**

| no \ yes | `Sensual` | `Playful` | `Bold` | `Curious` | verdict |
|---|---|---|---|---|---|
| `Whisper-Quiet` | 12 | 12 | **5** | 10 | PASS |
| `Discreet` | 18 | 18 | 26 | 16 | PASS |
| `Beginner-Friendly` | 28 | 26 | 28 | 32 | PASS |
| `Easy To Clean` | 25 | 25 | 26 | 23 | PASS |
| `Rechargeable` | 14 | 17 | 21 | 16 | PASS |
| `Travel-Ready` | 16 | 19 | 27 | 18 | PASS |

Weakest cell is `Whisper-Quiet` x `Bold` at 5, which is 2.5x the floor and still
above the 3 cards the band renders. `Whisper-Quiet` is the thinnest pole in the
set (100 products) and is the one to re-measure before any build; if it ever
drops under 4 on a cell, it is the pole that gets rotated out, not the band that
gets an empty state.

**Measured, PASS, held as spares (score 5):**

| no \ yes | `Sensual` | `Playful` | `Bold` | `Curious` | verdict |
|---|---|---|---|---|---|
| `Latex-Free` | 25 | 28 | 30 | 32 | PASS (spare) |
| `Hands-Free` | 26 | 27 | 28 | 16 | PASS (spare, appetite not worry) |
| `Waterproof` | 14 | 19 | 17 | 15 | PASS (spare) |
| `Plus-Size Friendly` | 12 | 10 | 18 | 4 | PASS (spare) |

**Measured, FAIL, excluded from v1 (score 5):**

| no \ yes | `Sensual` | `Playful` | `Bold` | `Curious` | verdict |
|---|---|---|---|---|---|
| `Body-Safe-Silicone` | **0** | **0** | **1** | **0** | **FAIL — excluded** |

This is the run-646 trap reproduced exactly, on the pole a designer would most
want. "Is this safe to put in my body?" is arguably the most important worry in
the category, and `Body-Safe-Silicone` carries **11** products in a 5,120 index.
It clears the `>=2` floor *as a pole* by a factor of five and then returns zero
or one on every reachable combination. Had this concept been declared buildable
on pole counts, it would have shipped a dead door on the most emotionally loaded
question we have. Excluded, and logged here so a future cycle re-opens it only
after the metafield is backfilled catalogue-wide, never on intuition.

Related vocabulary landmines observed in the same probe and recorded so nobody
re-derives them: `Intimate` (mood) is **1** product, and 24 of the 41 `matters`
tags carry a single product each. The `matters` dimension has a long, dead tail;
only the twelve tags above 100 are safe to build on.

## 5. Wireframe — 375px first

```
┌──────────────────────────────── 375px ──────────────────────────────┐
│                                              ground: plum-soft band  │
│  Nº 0X   NOTHING IN THE WAY                        (mono kicker)     │
│                                                                      │
│  What would stop you?                     (Newsreader H2, .em plum   │
│                                            on "stop")                │
│  Pick the one that is yours. What is left is what clears it.         │
│                                            (DM Sans, ink-3, <=60ch)  │
│                                                                      │
│  ── the one no ── (pill row, 22px radius, scroll-snap-x, no bar) ──  │
│  ( Someone will hear it. ) ( There is nowhere to keep it. ) ( It …   │
│      ^ SELECTED = the one coral element in this viewport             │
│                                                                      │
│  ♥ "Quiet is a category, not a compromise. These three are built     │
│     to stay under the noise of the room you are in."                 │
│                        (Emma aside, italic Newsreader, sage ♥)       │
│                        ^ THE MECHANICS SENTENCE, per selected pole   │
│                                                                      │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐   fixed-height row        │
│  │ product   │ │ product   │ │ product   │   StorefrontProductCard   │
│  │ card      │ │ card      │ │ card      │   → /products/{handle}    │
│  │ brand     │ │ brand     │ │ brand     │   (mono ink-4 eyebrow)    │
│  └───────────┘ └───────────┘ └───────────┘   horizontal snap at 375  │
│                                                                      │
│  ── and one thing that is a yes? (optional) ──                       │
│  [Sensual] [Playful] [Bold] [Curious]                                │
│      ^ small chips, 8px radius, sage active state                    │
│                                                                      │
│  (no See-all link — see §9)                                          │
└──────────────────────────────────────────────────────────────────────┘
```

**The two axes deliberately do not share a shape.** Axis 1 is sentence-length
pills at 22px with a coral selected state; axis 2 is one-word chips at 8px with
a sage active state. This is the run-778 teardown rule applied inside a single
band: two control layers on one screen must each state their own job in their
own vocabulary, and here they do it in grammar (a sentence vs a word), in
geometry (pill vs chip), and in color (coral vs sage). A visitor never has to
work out which row does what.

## 6. Desktop (>= md)

`max-w-[1320px]`, `md:px-16`, `py-16 md:py-20`. The worry pills wrap onto two
rows rather than scrolling; the mechanics sentence sits left at display scale in
a `max-w-[46ch]` measure with the three product cards to its right in a 3-up
grid; the optional yes-chips sit directly under the pills, so both controls are
adjacent and the result is one uninterrupted block. No new max-width, no new
radius, no new padding scale.

## 7. Art direction (doctrine §§1-4, cited)

- **Ground (§1, "section rhythm is color, not whitespace"):** full-bleed
  `plum-soft` tint. Plum is the guided-discovery family (§3: the "Discover You"
  band), and this is a guided moment. **IA constraint:** the band must not be
  placed adjacent to another `plum-soft` or `paper-2` band; if the slot IA
  chooses collides, re-block a neighbour rather than drifting this one to a
  fourth ground. It also cannot sit adjacent to the Sensation Map band if that
  ever ships, which is an IA sequencing note, not a color note.
- **Coral budget (§3, hard rule):** exactly **one** coral element in the
  viewport, the selected worry pill. The yes-chips use `sage` (the quiet
  accent). Card CTAs inherit the standard `StorefrontProductCard` treatment. No
  second coral anywhere in the band.
- **Type (§2):** mono `.kicker` at `text-[11px] uppercase tracking-[0.18em]
  text-ink-4` plus the `Nº 0X` numeral motif; H2 at `text-[1.9rem]
  md:text-[2.9rem]`, leading 1.1, tracking -0.01em, Newsreader, with **exactly
  one** `.em` italic-plum word carrying the meaning; body 16px `leading-relaxed`
  `text-ink-3` at <= 60ch; brand eyebrow on cards mono `ink-4` per §6.
- **Radii (§3):** 22px pills, 8px chips, 22px cards. Nothing new.
- **Lines (§3):** cards keep a hairline `border-line`. No shadows.
- **Contrast (§3):** unselected pill is `ink-3` on `plum-soft`; selected pill is
  paper on `coral`. Both checked against the AA floor before build. No white
  type over any photo in this band (there is no photography in the band chrome
  at all).
- **♥ motif (§3):** one sage ♥ on the Emma aside. That is the band's single
  heart; the page-wide ceiling of two across all uses still binds.
- **Imagery (§4):** the band ships **zero generated assets**. The only images are
  the real Shopify product photographs inside the cards. If a future cycle wants
  art here, it is Archetype **B** (color-block still, product large on the
  `plum-soft` ground, one styling echo) and it goes through `media-manager` with
  an interest-floor count per §4.1. Not this cycle: traffic is below the
  300-sessions/week threshold and this cycle banks capital rather than spending
  image budget.

## 8. Motion (doctrine §5, repo-native primitives only)

- **Band entrance:** one `<Reveal variant="up">` on the heading group
  (kicker + H2 + sub). Nothing else wrapped.
- **SSR:** the band renders a **merchandiser-chosen default worry already
  selected**, with its mechanics sentence and its three cards, as the server
  state. There is no empty state, no skeleton, no fill-on-hydrate. Crawlers and
  no-JS visitors get a real shelf of real products.
- **First paint of the cards:** `<Reveal variant="up" index>` with the standard
  `STAGGER_STEP` 0.06s, clamp 8. **Subsequent swaps do not re-stagger** — a
  band that re-choreographs on every tap reads as a slot machine and fights the
  "reading rhythm over choreography" budget.
- **Tap to swap:** opacity cross-fade only at `--duration-base` (240ms),
  `--ease-standard`. The card row is a **fixed-height** container so swapping
  content can never reflow. Transform/opacity only, zero CLS.
- **No `layout` prop.** This is a content band, not a filter grid (§5).
- **No heartbeat.** The page's one beat is already spent on Meet Emma.
- **Reduced motion:** renders the identical default state with no entrance and
  an instant swap.
- **LCP:** this band is **never above the fold** and carries **no LCP
  candidate**. There is no hero image here and nothing in it is or could become
  the LCP element. The homepage hero remains the LCP and remains unwrapped; this
  concept does not touch it.

## 9. How it serves the mission

- **Destination discipline (§1).** Every clickable thing in the band except the
  controls is a `/products/{handle}` link. It adds **zero** `/discover` links,
  so the two-link cap is untouched.
- **No See-all, deliberately (ticket #4270).** No collection contains the set
  "quiet AND playful". The routine is explicit that a module with no honest
  destination ships **no** See-all rather than falling back to
  `/collections/best-sellers`. v1 ships none. If IA later rules the one
  permitted `/discover?preset=` pill can be spent here, that is IA's call; this
  wire does not assume it.
- **Never fabricate proof (doctrine §6).** The mechanics sentence is sourced
  from real product data (`feature_bullets`, `tagline`, `product_type_dial`) or
  it is not written. **No decibel figure, no percentage, no count, no
  certification may appear in it unless it is evidenced per product.** A
  reassurance we cannot substantiate is the exact failure the doctrine bans.
- **Both visitors (§7).** The seeker taps their blocker and gets three products.
  The browser gets permission to have a reservation, which is the warmest thing
  this page could say to someone hovering over the back button.
- **Voice (§8).** The chips are the reader's words, not Emma's. The mechanics
  sentence is act-adjacent and reader-centred and never claims Emma has felt
  anything. Every string is illustrative here and goes to `emma-copywriter`
  under `emma-empathy-reviewer` before any build. CTA whitelist applies to any
  button label that ends up in the band.
- **Weekly rhythm (§3).** The default selected pole, the pole order, and the
  mechanics sentences are Sanity content, so the band reads differently week to
  week with no code change. Verified spares (§3) give the merchandiser safe
  rotation stock.

## 10. What it needs before it can be built

1. **IA review — this is a NEW SECTION TYPE.** It cannot enter the locked
   Nº 01-Nº 11 shell without a named spec through `homepage-ia`
   (`routine-design-cycle.md` §0.5 fence). IA also owns the slot, the numeral,
   and the ground-alternation check in §7.
2. **Additive Sanity block only** — a new `worryShelf` document in a **new
   file**: enabled, eyebrow, heading, sub, ordered worry poles (`label` plus
   `tag` in storage form), optional yes poles, per-pole mechanics sentence,
   default selected pole, nullable see-all href defaulting to null. Never modify
   existing schema. Owner: `sanity-content-builder`.
3. **No new route, no new URL.** The default shelf comes from the **loader**
   (`storefront-home.server.ts`). A tap re-queries the **existing**
   `/api/discovery` resource route via `useFetcher`, never `useEffect`. Open
   question for the build cycle: `/api/discovery` returns rails, and the band
   wants a flat top-3 across rails. Prefer flattening in the component over
   adding a parameter to a route shared with `/discover` and the panel deck.
4. **Do not re-weight the global scorer.** `SCORE_MOOD` / `SCORE_MATTERS` in
   `discovery-emma.ts` are shared with `/discover`. The band takes items at the
   maximum achievable score, which already means both axes matched.
5. **Re-measure the matrix at build time.** Counts in §4 are a 2026-09-16
   snapshot of a live index that changes with imports and stock. The thin pole
   (`Whisper-Quiet`) is the one to check.
6. **Voice gate** — every chip label and every mechanics sentence clears
   `emma-empathy-reviewer` against `docs/emma-voice.md`.
7. **`design-critic`** scores the built band at 375/768/1440 against the
   doctrine before any PR opens.

## 11. Rejected variants, with reasons, so ambition compounds

- **Body-safety as a worry pole.** Rejected on measurement, not on taste: 0/0/1/0
  across the four yes poles (§4). The most important worry in the category is the
  one our vocabulary cannot currently carry. Re-open only after a catalogue-wide
  backfill.
- **Phrasing the chips as exclusions ("no batteries", "not loud").** Rejected:
  the index has no NOT operator, so "not loud" would still be built as
  `Whisper-Quiet` while the label promised an exclusion the tag cannot make.
  Mission brief §6, the label keeps its promise.
- **A dedicated route per worry (`/quiet`, `/discreet`, `/first-time`).**
  Rejected on the IA fence. A new URL goes to `tech-architect` and the
  canonical/SEO story is unfunded. Logged as a deliberate deferral, not a
  discard: if the site ever wants landing pages for paid traffic, this is where
  that conversation restarts.
- **Adding a "worry" chip group to the Compass instead.** Rejected: `/discover`
  already has a `matters` group, so this would be a rename rather than a new
  experience (§9), and it hides the idea behind a link we are capped at two of.
- **A third axis (worry x yes x Solo/Couples).** Rejected for v1 on cost, not on
  data: it would take the reachable set from 30 states to 90 and every one of
  them needs measuring before build. Two taps is also the right friction for a
  visitor whose defining trait is hesitancy. Revisit only if the two-axis
  version earns its slot.
- **Showing the count ("1,011 that hide easily").** Rejected twice over: a live
  index number frozen into a Sanity string goes stale silently, and a result
  count drags an editorial band toward reading like a search results page.
- **A personality label ("You are a Quiet type").** Standing rejection across
  `how-you-arrive.md` and `sensation-map.md`, kept consistent here. A badge that
  types the person is off-register for a calm, shame-free voice, and it is
  especially wrong on an axis made of insecurities.
- **An "everything is fine, show me all" escape chip.** Rejected: it is a
  catalogue dump wearing a control, and the band already has no dead state
  because the server seeds a default pole.
- **Renting the finder (Honey Play Box runs `quizkitapp`).** Rejected: a
  third-party embed cannot obey SSR-visible / zero-CLS / `loader →
  useLoaderData`, it owns the visitor's answers, and it puts a foreign script in
  the Oxygen seam.
- **A purchased "worry-free" insurance badge (Honey Play Box runs Seel).**
  Rejected: our guarantee is a proper noun we honour ourselves, owner-approved
  on name and terms (doctrine §6, backlog item 5).
- **Building it this cycle.** Deferred, correctly. GA4 is below the
  300-sessions/week weighting threshold, so per `routine-design-cycle.md` §1 the
  ambition mandate is satisfied by the wire plus the measured matrix. The
  expensive half (new section type, additive schema, new component, imagery)
  waits until traffic can see it.

## 12. Status

Proposal only. Not scheduled. Zero code, zero routes, zero schema, zero
generated images written this cycle. The build-readiness gate is **passed on
data**: 30 reachable states measured, 30 PASS, one candidate pole excluded on
measurement. Next step if adopted is a named spec through `homepage-ia`, then an
additive `worryShelf` block, then `rr7-engineer` behind the reviewed-PR path.
