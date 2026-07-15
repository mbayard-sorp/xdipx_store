# Concept Wire — The Sensation Map

> Routine B (Design Cycle) ambition-mandate deliverable, run 36, 2026-07-15.
> Mission brief §9: "every design cycle should carry at least one genuinely new
> exploration/self-discovery experience concept from the backlog to a wire or
> prototype." This is that wire. Shipping stays disciplined: this is a design
> proposal, not built code. The build lands a future cycle behind the reviewed-PR
> path. Copy here is placeholder for feel and goes through the Emma voice gate
> before any build. Design follows `docs/design-doctrine.md`.

## The idea in one line

An on-page, tactile instrument where a visitor adjusts two or three **sensation
dials** and Emma maps their choice, in real time, to two or three **real
products** that fit — each a direct PDP link. It teaches a vocabulary for what
someone might like while moving them straight toward a product.

## Why this, and why it is not the Compass

The Compass (`/discover`) already exists: a linear, multi-step quiz that lands on
a filtered results **page**. It works, and it is our single "still not sure?"
closer. The Sensation Map is deliberately a **different kind of experience**, not
a second quiz:

| | The Compass (`/discover`) | The Sensation Map (proposed) |
|---|---|---|
| Shape | Linear quiz → results **page** | Live instrument, **in place** on the homepage |
| Feel | "Answer questions, get a shortlist" | "Play with a dial, watch it respond" |
| Payoff timing | After you finish | Immediately, every adjustment |
| What it teaches | Which category suits you | A **vocabulary** for sensation ("rumbly vs buzzy") |
| Where it lives | Standalone route + the §08 closer band | A homepage band (§ between wayfinder and couples) |

The novelty is the **interaction and the framing** (an instrument you play, that
names sensations you might not have words for), not a new taxonomy. It maps onto
data we already have. It passes the mission's test — *does a visitor learn
something about themselves while moving toward a product?* — because the dials
put language to preference and every state resolves to real, clickable product.

## Data — reuses what exists, invents nothing

Everything maps onto the live discovery index (`DiscoveryProduct`) and existing
enrichment, so v1 needs no new taxonomy:

- **Dial A — Type** ← `productTypeDial` (`air-pulsation | vibrator | wand | lube
  | wear`). The most legible, product-defining axis we already tag.
- **Dial B — Mood/pace** ← `mood[]` tags (the live vocab from
  `scripts/dump-discovery-vocab.ts` — e.g. gentle/intense, slow/quick — **use
  only tags that exist in the live vocab**, exactly like the preset rules in
  mission brief §6; a dial notch outside the live vocab matches zero products).
- **Optional Dial C — For** ← `audience[]` (solo / couples), only if it does not
  crowd the phone view. Default v1 ships two dials; add the third only if 375px
  stays calm.

**Matching (v1):** score index products by tag overlap with the selected dial
state (same machinery discovery already uses), show the top 2–3, each linking to
`/products/{handle}`. Never a dead pill: if a dial combination matches fewer than
2 live products, the instrument snaps to the nearest state that does and says so
softly ("Closest fit →"), never showing an empty result.

**v2 upgrade path (not v1):** the `sensation_dial` metafield (json, per-dimension
1–5 ratings, already defined in the `xdipx` namespace) enables true
sensation-level matching (rumbly vs buzzy, focused vs broad). It is a PDP-level
metafield today, **not in the discovery index**, so real per-dimension matching
requires adding it to the index build first. v1 ships on tags that are already
indexed; the wire flags the v2 data work so it is a deliberate, separate step,
not a surprise.

## Wireframe — 375px first

```
┌──────────────────────────────── 375px ──────────────────────────────┐
│  Nº 0X   FIND YOUR FEEL                                    (mono kicker)│
│                                                                        │
│  What are you *curious* about?          (Newsreader H2, plum .em)      │
│  Two quick dials. I'll narrow it to a few that fit.  (body, ink-3)     │
│                                                                        │
│  ┌── Dial A · Type ─────────────────────────────────────────────┐     │
│  │  ◐ air-pulse   ○ vibrator   ○ wand   ○ lube   ○ wear          │     │
│  │  [ segmented pill row, horizontal-scroll, snap; coral fill on  │    │
│  │    the selected notch — the one coral element in view ]        │    │
│  └───────────────────────────────────────────────────────────────┘    │
│  ┌── Dial B · Feel ─────────────────────────────────────────────┐     │
│  │  gentle ●────────────○──── intense    (a real slider/segments) │     │
│  │  [ 3–4 notches drawn from live mood vocab; sage active state ] │     │
│  └───────────────────────────────────────────────────────────────┘    │
│                                                                        │
│  ♥ Emma:  "Air-pulse, on the gentler side. These three are the         │
│           closest match, quietest first."        (italic, sage ♥)      │
│                                                                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                                 │
│  │ product │  │ product │  │ product │   (StorefrontProductCard ×2–3,  │
│  │  card   │  │  card   │  │  card   │    each → /products/{handle})    │
│  └─────────┘  └─────────┘  └─────────┘                                 │
│                                                                        │
│         See the full fit →  (link-coral → matching collection)         │
└────────────────────────────────────────────────────────────────────────┘
```

Desktop: dials and result cards sit side by side (dials left ~40%, cards right
~60%) inside `max-w-[1320px]`, `px-16`. The instrument is one band in the shell
rhythm — a `paper-2` or `plum-soft` ground so it reads as a distinct "moment"
between the wayfinder (§05) and couples (§07) bands.

## Art direction (per the doctrine)

- **Ground:** `plum-soft` full-band tint — plum is our "guided discovery" color
  (same family as the "Discover You" wayfinder promo), so the Map reads as
  self-discovery, not a hard-sell rail.
- **Type:** mono kicker "FIND YOUR FEEL"; Newsreader H2 with a single plum `.em`
  word ("*curious*" / "*feel*"); DM Sans body and dial labels.
- **Color budget:** the selected Type notch is the **one coral element** in the
  band (respecting the coral budget). Dial B's active state is `sage`. Result
  CTAs inherit the standard card treatment. No second screaming coral.
- **The result cards are the payoff** — real product photography, doctrine §4
  compliant, never generated tableware.

## Motion (repo-native only, zero CLS)

- **The band on scroll:** one `<Reveal variant="up">` on the heading group; the
  instrument renders its **default selected state on the server** (SSR-visible,
  a real product set already showing) so there is no empty-then-fill flash and no
  CLS. Reduced motion shows the same default state.
- **Dial change → result swap:** cross-fade the result cards with
  `--duration-base` (240ms) opacity only — **no layout shift**, cards occupy a
  fixed-height row so swapping content never reflows the page.
- **One optional heartbeat:** the ♥ on Emma's line may use the single per-page
  `heartbeat` **only if** the homepage has not already spent its one beat
  elsewhere. Default: no beat here.
- **RR7 discipline:** the default result set comes from the **loader** (a small
  addition to `storefront-home.server.ts` or a dedicated resource route);
  dial-driven re-queries go through a **`useFetcher`** to a resource route, never
  `useEffect`-fetch. All matching logic is server-side (`.server.ts`).

## How it serves the mission

- **Earns the click:** every result card and the "See the full fit" link resolve
  to `/products/{handle}` or a collection — it counts on the right side of the
  70%-product-link ratio (§1), and adds zero `/discover` links.
- **Both visitors (§7):** the *seeker* uses it as a fast filter to product; the
  *browser* uses it as a low-stakes, playful on-ramp that treats curiosity as the
  point. It "deepens" and "tempts" in one module.
- **Weekly freshness (§3):** the dials' default state and featured matches rotate
  with the theme, so the band looks different week to week for free.

## Open questions for build cycle (flag, don't hand-wave)

1. **Index the mood vocab for scoring** — confirm the live mood tags cleanly
   split into 3–4 legible "Feel" notches; if they don't, Dial B ships as a small
   set of named moods, not a continuous slider.
2. **Resource route vs loader default** — decide whether dial re-queries hit a
   new `api.sensation-map` resource route or reuse an existing discovery
   endpoint. Prefer reuse.
3. **v2 `sensation_dial` in the index** — separate, sequenced data task before
   true per-dimension matching; do not block v1 on it.
4. **Additive Sanity block** — if merchandising should own the band's copy and
   default dial state, `sanity-content-builder` adds a new `sensationMap` block
   (additive only, new file). Otherwise it ships shell-hardcoded with sensible
   defaults like the other fallbacks.

---

## Rejected / deferred concepts (logged so ambition compounds, §9)

- **"Pleasure archetype" personality quiz** ("what's your pleasure type?").
  *Rejected — brand-fit + dead-end risk.* Horoscope/BuzzFeed energy pulls toward
  gimmick and away from plain, specific talk (voice charter). Archetype results
  route weakly to product and risk a shame-adjacent "you are a type" framing. The
  Sensation Map keeps the self-discovery upside without the personality-test tax.
- **"Mood ring" mood-only finder.** *Rejected — duplicates the Compass.* A
  mood-tag quiz is what `/discover` already is; a second one is decoration, not a
  new experience (§9: "exploration that dead-ends is decoration"). The Sensation
  Map differs by interaction (a live instrument) and by teaching a sensation
  vocabulary, not just re-asking mood.
- **"Build your first kit" bundle builder.** *Deferred — strong, but a
  commerce/cart-flow feature, not primarily self-discovery.* Higher build cost
  (cart mutations, bundle pricing, MAP checks) and it teaches less about the
  visitor. Good future backlog item for a couples/first-time theme week; not this
  cycle's ambition slot.
- **Full "sensation slider" on true `sensation_dial` data as v1.** *Deferred to
  v2 — data not indexed.* The per-dimension 1–5 metafield is PDP-level today;
  shipping it as v1 would silently require an index change. Kept as the explicit
  v2 upgrade path above so the ambition is real but the sequencing is honest.
