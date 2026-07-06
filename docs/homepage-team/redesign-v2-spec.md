# Homepage Redesign v2 — Art Direction + Section Spec

> Owner verdict on the current storefront: "we look terrible." Diagnosis: the page is
> timid. Acres of white paper, a single grey product plate in the hero, thin outline-only
> tiles, two identical grey-carded rails, and a lot of vertical air that reads as "unfinished"
> rather than "editorial." The palette and voice are already right. What is missing is
> **density, color-blocking, and confidence.** This spec turns the same shell into something
> that looks like a $100K commercial build without adding a single new brand color.
>
> Scope: art direction + section-by-section build spec for `app/components/store/StorefrontHome.tsx`
> (variant `b`). Section ORDER and the locked shell (announcement / hero / trust / email last)
> are unchanged from `homepage-redesign-brief.md`. This is a Routine B design cycle: an engineer
> implements this directly, gated PR, never auto-merged.
>
> Voice: all copy below complies with `docs/emma-voice.md` (v4). No em-dashes, no "Buy now",
> CTA whitelist only, Emma has no lived experience, no homepage-hero top billing for Emma.

---

## 1. Art direction statement

xdipx should feel like a **beautifully art-directed magazine that happens to sell sex toys** —
Aesop's restraint and Glossier's warmth, applied to a category that usually looks like a
discount tube site. We hold onto white paper as the ground, but we stop being afraid of it:
color-blocked bands (coral-soft, plum-soft, ink) now carry weight, product photography fills
frames edge to edge, and oversized Newsreader display type does the talking. The reader should
feel guided by a smart, unembarrassed friend through a shop that is dense with real products
and calm at the same time. Confident, not loud. Warm, not clinical. Editorial, never explicit.

**The five moves that make it read expensive:**

1. **Color-blocked section rhythm.** No more six pale sections in a row. We alternate
   `paper → paper-2 → tinted band (coral-soft / plum-soft) → paper → ink band` so the eye
   gets a beat every scroll. Full-bleed tinted bands are the single biggest upgrade; the
   current page has essentially none until the dark closer.
2. **Oversized serif display + an editorial numeral system.** Hero headline goes bigger and
   tighter. Section headings get a mono kicker AND a large Newsreader line with the one-word
   plum `.em` emphasis. A repeating "Nº 01 / 02 / 03" numeral motif (JetBrains Mono, ink-4)
   sits on the major bands and category tiles to signal "curated edition," a quiet nod to the
   Style Guide Nº 01 identity.
3. **Full-bleed imagery bands, not floating plates.** The hero product sits in a color-tinted
   frame that bleeds to the edge of its column with a soft interior vignette; category tiles
   carry real editorial photography with an ink scrim and white label; the couples and mood
   bands become photographic, not flat.
4. **Dense-but-airy product grid.** Rails stay horizontal-scroll on mobile but the first rail
   promotes to a **static 2-up (mobile) / 4-up (desktop) grid** so there is a wall of product
   above the fold-line of the page, the way Lovehoney and Spectrum open. Cards get tighter
   gutters and a hairline frame so the grid reads as a considered set, not scattered tiles.
5. **Editorial pull-quotes and asides as design objects.** Emma's asides and a single large
   pull-quote (Meet Emma) are set in italic Newsreader at display scale with a coral or sage
   ♥, treated as typographic art, not caption text. This is where the "written by a person"
   feeling comes from, and it costs nothing.

**Token discipline (unchanged, but used generously now):**
paper / paper-2 / paper-3 grounds · `coral` only on primary CTAs and one accent per band ·
`coral-soft` and `plum-soft` as full band fills · `plum` for the `.em` emphasis word and the
Discover band · `ink` for the one dark closer band · `sage` for ♥ and quiet metadata.
Radii 22px everywhere ≥ lg. Newsreader display / DM Sans body / JetBrains Mono kickers.
Caveat stays retired on this page. No gradients, no orange, no cream.

---

## 2. Section-by-section spec

Reveal variants reference `app/components/motion/Reveal.tsx` (`fade | up | scale`, `delay`,
`index` for stagger). The LCP hero image is NEVER wrapped. Every content section falls back to
hardcoded defaults when Sanity is empty (never a blank box).

### Nº 00 — Announcement bar (LOCKED, reuse `announcementBar`)
- Rendered in `_layout.tsx`, out of scope for this file. Keep ink band, mono uppercase,
  message: "Editorially picked. Discreetly shipped." No change.

---

### Nº 01 — Hero (rebuild in place, keep `emmaHeroStorefront` data contract)
- **Purpose:** orient + tempt. One named featured product (the week's headliner), one primary
  revenue CTA to its PDP, one guided on-ramp. Emma is NOT the headliner here.
- **Layout @375px:** single column. Order: mono eyebrow → oversized headline → 2-line body →
  CTA row (coral primary full-width-ish + ghost secondary) → "Where do you want to start?" +
  horizontal mood-pill scroller → THEN the product image in a tinted 4:5 frame that bleeds to
  both column edges. Product image comes after the copy on mobile so the LCP is the first
  paint of text + the image loads eager but below.
- **Layout @1280px:** 2-col grid, `minmax(0,1.05fr) minmax(0,0.95fr)`, text left / image right,
  vertically centered, max-width 1320px, generous 64px side padding. Image is a 4:5 portrait in
  a `coral-soft` frame with a soft inset vignette (`box-shadow: inset 0 -60px 90px rgba(26,20,24,0.07)`)
  and a hairline `border-line`. A small "Nº 01 — This week's pick" mono tag sits top-left of the frame.
- **Background:** `paper`. The product frame is `coral-soft` (this is the warmth injection the
  current grey plate is missing).
- **Data:** `featured[0]` (DiscoveryProduct) for the LCP image + peek link. Text/config from
  `singleton.emmaHeroStorefront` (`eyebrow`, `headline`, `body`, `pullQuote`,
  `primaryCtaLabel/Link`, `featuredProductHandle`) with the field-by-field fallbacks that
  already exist. Mood pills hardcoded (`MOOD_PILLS`), point at live collections + one `/discover?preset=`.
- **Imagery:** the real Shopify product photo of `featured[0]`. No generated art in the hero
  (mission brief §2: real product photography where a specific product is featured). If the
  product has no image, fall back to the sage ♥ tile (existing behavior).
- **Motion:** the text column is wrapped in `Reveal variant="up"` (single, whole-column,
  above-the-fold so it renders visible immediately). **The product image is NOT wrapped**
  (LCP, zero CLS). Mood pills: no per-pill motion.
- **Copy slots (draft, Emma-voice):**
  - eyebrow (mono): `This week's pick` (plain category label, not an Emma byline)
  - headline: `Pleasure, worth getting <em>right</em>.` (charter exemplar; team overrides weekly per hero product)
  - body: `A short, checked selection instead of a wall of options. Start with the one below, or tell us what you're after.`
  - primary CTA: `Take a peek →` → `/products/{featured[0].handle}`
  - secondary CTA: `Show me` → `/collections`
  - guided prompt: `Where do you want to start?`
  - pills: `Just curious · Slow nights · For two · Hands-free · Surprise me`

---

### Nº 02 — Trust strip (LOCKED position, reuse pattern)
- **Purpose:** orient / reassure, above the fold. Keep it welded to the bottom of the hero band.
- **Layout @375px:** 2×2 grid of the four claims (currently they wrap awkwardly into an uneven
  row; a fixed 2×2 grid reads as intentional). @1280px: single row, space-between.
- **Background:** `paper` with a `border-t border-line`.
- **Data:** hardcoded, or `trustBar` block if the team wants control (optional, not required).
- **Imagery:** none. `♥` in `sage` before each item.
- **Motion:** `Reveal variant="fade"` on the row (subtle).
- **Copy:** `Ships in plain packaging · Billed as XDIPX · 30-day returns · Hand-checked, not auto-listed`
  (trust canon, unchanged).

---

### Nº 03 — "Most picked, right now" — PROMOTED PRIMARY GRID (was buried in rails)
> **This is the single biggest structural change.** Today the best-seller rail is the 5th
> section down, in a grey band, as a horizontal scroller you have to discover. Competitors
> (Lovehoney, Spectrum, Too Timid) all open with a **wall of product** immediately after the
> hero. We move the anchor best-seller set up to the third slot and render it as a real grid.
- **Purpose:** tempt. Put a dense set of real, clickable products high on the page. Every card
  → `/products/{handle}` (feeds the 70% PDP-link target).
- **Layout @375px:** mono kicker + Newsreader heading, then a **2-column static grid** of 4
  product cards (not a scroller) so the visitor sees a filled grid without swiping. A
  `See all →` link under the grid → `/collections/best-sellers`.
- **Layout @1280px:** **4-column static grid**, up to 8 cards, tighter 20px gutters, cards
  framed with `border-line`. Heading row has a right-aligned `See all →`.
- **Background:** `paper` (keep it bright and product-forward; the grey comes later).
- **Data:** `rails[0]` best-of / anchor (the existing always-on best-seller anchor), OR the
  team's first `emmaCuratedRail` when published. Reuse `StorefrontProductCard`.
- **Imagery:** real Shopify product photography (card images). No generated art.
- **Motion:** heading `Reveal variant="up"`; cards `Reveal variant="up"` with `index` stagger
  (0..n) so the grid assembles left-to-right. Reduced motion → final state.
- **Copy slots:**
  - eyebrow: `What's working`
  - heading: `Most picked, <em>right now</em>.`
  - link: `See all →` → `/collections/best-sellers`

---

### Nº 04 — Meet Emma (reuse `editorBio` OR keep inline, restyle)
- **Purpose:** deepen / trust (E-E-A-T). Emma introduced mid-page, in her AI-guide voice, as a
  value-add the reader discovers. This is where the "written by a person" pull-quote lives.
- **Layout @375px:** image (4:5, sage ring) → mono kicker → large italic pull-quote headline →
  short body → ghost `Find your fit →` (anchors to the Discover band, no extra /discover link).
- **Layout @1280px:** 2-col, image left (max 460px) / text right. The headline is set as an
  oversized **pull-quote** (Newsreader italic, ~2.9rem) with the plum `.em` on "fits" and a
  large coral opening ♥ as a typographic mark, not a chip.
- **Background:** `paper-2` (first tonal step-down; gives the band a soft edge).
- **Data:** `singleton.emmaPersona` / `editorBio` block for avatar + name; copy hardcoded fallback.
- **Imagery:** Emma portrait (`/emma.png` today). Editorial, warm, no body, no product. Keep
  the 6px `sage/15` ring; add a `Nº 04` mono tag above the kicker.
- **Motion:** `Reveal variant="up"` on the text column; image `Reveal variant="scale"` (gentle).
- **Copy slots:**
  - kicker: `Meet Emma`
  - pull-quote: `I know the catalog cold, every spec and thousands of reviews, so I can point you to what actually <em>fits</em>.`
  - body: `I'm an AI guide, so I don't get embarrassed and I don't have a shelf to push. Tell me a little about what you're after and I'll do the reading for you.`
  - CTA: `Find your fit →` → `#discover`

---

### Nº 05 — Find your way in (rebuild `wayfinderMosaic`, make it photographic)
- **Purpose:** orient. Category on-ramps. Today these are flat grey tiles with a text label —
  the weakest part of the page. They become **photographic tiles with an ink scrim and white
  label**, the way vivid category tiles carry the competitor homepages.
- **Layout @375px:** mono kicker + heading, then 3 stacked tiles (each min-height 200px, image
  fills, `object-cover`, bottom-anchored white label over an ink gradient scrim), then the
  larger `plum-soft` "Discover You" promo tile full-width.
- **Layout @1280px:** 3 tiles in a row (`flex-1 basis-180`), then the Discover You promo as a
  full-width plum-soft band below with the coral CTA right-aligned.
- **Background:** `paper`. Tiles carry photography; promo is `plum-soft`.
- **Data:** `wayfinderMosaic` block (tiles + promo) with the existing `MOSAIC_TILES` fallback.
  Tile links → live collections; the promo slot is the ONE tile allowed to keep `/discover`.
- **Imagery:** 3 tile scenes (see manifest #3–5). Product-linked tiles place the real product via
  Kontext ref; the rest use sensual human context. Each tile gets an `image` in Sanity; when unset, tile falls back to a
  `paper-3` fill with the label (never blank).
- **Motion:** heading `Reveal up`; tiles `Reveal up` with `index` stagger; promo `Reveal scale`.
- **Copy slots:**
  - kicker: `Where to begin`
  - heading: `Find your <em>way</em> in.`
  - tiles: `New here?` → `/collections/first-time` · `For two` → `/collections/couples` · `Best sellers` → `/collections/best-sellers`
  - promo kicker: `Discover You` / heading: `Not sure where you land? <em>Discover</em> You.` /
    body: `Answer a few quiet questions and get a short list that actually fits you.` /
    CTA: `Find your fit →` → `/discover`

---

### Nº 06 — Emma's edit (second rail, KEEP as horizontal scroller, restyle)
- **Purpose:** tempt + deepen. The curated, story-led rail. Kept as a horizontal scroller
  (contrast with the Nº 03 grid gives the page rhythm; two identical grids would be monotone).
- **Layout @375px / @1280px:** mono kicker + heading + a real Emma aside line, then the
  horizontal `StorefrontProductCard` scroller (existing `Rail`). Aside set as an italic
  Newsreader sage line with ♥, below the rail.
- **Background:** `paper-2` (tonal pairing with the band below is fine; this is the calm rail).
- **Data:** `rails[1]` / second `emmaCuratedRail`. Cards → PDP.
- **Imagery:** real Shopify product photography (cards).
- **Motion:** heading `Reveal up`; cards are inside the scroller (no per-card reveal to avoid
  fighting horizontal scroll) — the whole rail block gets one `Reveal fade`.
- **Copy slots (fresh, per charter — retire coined phrases each run):**
  - eyebrow: `Emma's edit`
  - heading: `Chosen for how they <em>feel</em>.`
  - aside: `Picked for pacing and material, not just power. A calm place to start.`

---

### Nº 07 — Couples (rebuild `playTogetherBanner`, make it a photographic band + rail)
- **Purpose:** tempt a specific audience. Today it is a flat `coral-soft` box with a heading and
  one button, no products. We make it a **full-bleed photographic band** with a couples product
  rail beneath it, so it earns product clicks.
- **Layout @375px:** photographic banner (min-height ~360px, ink scrim, white label + coral CTA
  bottom-left), then a horizontal couples rail below.
- **Layout @1280px:** banner full-width within max-width, label left / CTA right over the photo;
  couples rail below, full-bleed horizontal scroll.
- **Background:** `paper-3` band; banner is photographic; rail on `paper-3`.
- **Data:** `playTogetherBanner` block for the banner; a `productCarousel`/`emmaCuratedRail`
  sourced from `/collections/couples` for the rail. If the couples rail is empty, render the
  banner alone (graceful degrade).
- **Imagery:** 1 couples-mood scene (manifest #6): two silhouettes close on an unmade bed, a silk
  robe slipping, low warm light. Charged and intimate; bodies in-bounds, nothing explicit.
- **Motion:** banner `Reveal scale`; rail `Reveal fade`.
- **Copy slots:**
  - kicker: `For two`
  - heading: `Better <em>together</em>.`
  - body: `A few things designed for shared control, the kind couples in the reviews recommend to each other.`
  - CTA: `Show me` → `/collections/couples`

---

### Nº 08 — Tell Emma a mood (dark closer band, reuse `StillDecidingBand` → `promoBanner` dark)
- **Purpose:** close. The ONE ink band on the page. The Compass closer for the still-unsure
  visitor. High contrast is the point; it lands like a full-page ad break.
- **Layout @375px / @1280px:** centered, generous vertical padding (py-20 mobile / py-32 desktop),
  coral mono kicker, large paper headline with a coral-2 italic emphasis word, one coral CTA.
- **Background:** `ink`, text `paper`. This is the deliberate dark beat in the rhythm.
- **Data:** hardcoded fallback (`promoBanner` dark `bgStyle` if the team wants control).
- **Imagery:** none (typographic band). Optional: a faint `plum` radial glow behind the headline
  via a non-layout pseudo-element; keep it subtle, no gradient-as-brand-surface.
- **Motion:** `Reveal up` on the headline block.
- **Copy slots:**
  - kicker: `Still deciding?`
  - headline: `Tell me what you're into, or what you're <em>curious</em> about. Same thing.`
  - CTA: `Find your fit →` → `/discover`

---

### Nº 09 — From the Notebook (reuse `editorialTiles`, add product links)
- **Purpose:** deepen (education / E-E-A-T / SEO) then tempt. 3 reads; each card also links a
  relevant product or collection so the education earns a click.
- **Layout @375px:** mono kicker + heading, then 3 stacked cards (3:2 image, mono kicker+read-time,
  Newsreader title, excerpt, coral CTA). @1280px: 3-up grid.
- **Background:** `paper` (bright, editorial).
- **Data:** `editorialTiles` block; renders nothing when unpublished (acceptable — it is a
  deepen module, not load-bearing, and the page reads complete without it).
- **Imagery:** 3 sensual scenes (manifest #7–9): the linked product in a charged human context
  (Kontext ref from its Shopify photo) or lingerie-on-sheets for non-product reads. Never a
  housewares flat-lay, never a clinical close-up, nothing explicit.
- **Motion:** heading `Reveal up`; cards `Reveal up` with `index` stagger.
- **Copy slots:**
  - kicker: `Emma's reads`
  - heading: `From the <em>notebook</em>.`
  - card CTAs (charter-safe, point at product/collection): `Show me the first-timer edit →`,
    `Show me the slow-nights edit →`, `Show me the for-two edit →`

---

### Nº 10 — FAQ (reuse, keep) + FAQPage JSON-LD
- **Purpose:** deepen / AEO. Crawlable Q&A. Keep `FAQStructuredData`.
- **Layout:** single narrow column (max 820px), `<details>` accordions with the `+` → `×` rotate.
- **Background:** `paper-2`.
- **Data:** hardcoded `FAQS` (4 items) — unchanged content.
- **Imagery:** none.
- **Motion:** heading `Reveal up`. Accordions static (native `<details>`).
- **Copy:** heading `Questions, <em>answered</em>.` — FAQ bodies unchanged (trust canon).

---

### Nº 11 — Email capture (LOCKED last, reuse `EmailSubscribe`)
- **Purpose:** close. Klaviyo capture. No discount, no countdown.
- **Layout:** centered card on a `paper-3` inset, Newsreader heading, single email input + coral button.
- **Background:** `paper`; the card is `paper-3`.
- **Data:** existing `EmailSubscribe` component.
- **Imagery:** none.
- **Motion:** `Reveal scale` on the card.
- **Copy (unchanged):** heading `Good taste, delivered <em>quietly</em>.` /
  subcopy `Emma's picks, on an irregular schedule. Discreet, direct.` / button `I'm in ♥`
  (Note: dropped "once a week" — the cadence is irregular per charter, no schedule promise.)

---

### Section rhythm summary (the band map)

| Nº | Section | Background | Job |
|----|---------|-----------|-----|
| 01 | Hero (coral-soft product frame) | paper | orient + tempt |
| 02 | Trust strip | paper | orient |
| 03 | Most picked (GRID) | paper | tempt |
| 04 | Meet Emma | paper-2 | deepen |
| 05 | Find your way in | paper (photo tiles) + plum-soft promo | orient |
| 06 | Emma's edit (rail) | paper-2 | tempt |
| 07 | Couples (photo band + rail) | paper-3 | tempt |
| 08 | Tell Emma a mood | **ink** | close |
| 09 | From the notebook | paper | deepen |
| 10 | FAQ | paper-2 | deepen |
| 11 | Email capture | paper | close |

The eye now gets: bright → bright → bright → soft → soft/plum-pop → soft → grey → **dark** →
bright → soft → bright. Compared to today's near-flat grey wash, this is the difference.

---

## 3. What to RIP OUT (and why)

1. **The floating grey hero plate.** The `bg-paper-2` bordered box reads as a placeholder. Replace
   with a `coral-soft` framed product portrait with an interior vignette. Warmth + a real photo.
2. **The buried best-seller rail as the first product moment.** Promote it to Nº 03 as a static
   grid. Horizontal-scroll-only above the fold is why the page feels empty on first paint.
3. **Two visually identical grey rails back to back.** Today Nº 5 renders "best sellers" and
   "Emma's edit" as two identical grey scrollers in one `paper-2` band. Split them: Nº 03 is a
   bright grid, Nº 06 is a calm `paper-2` scroller. Give them different jobs and different looks.
4. **Flat, text-only category tiles.** The grey `paper-3` tiles with a bare label look unfinished.
   They must carry photography with an ink scrim (manifest #3–5). This is the competitor table stakes.
5. **The flat coral-soft couples box with no products.** A heading and a button is not a section.
   Rebuild as a photographic band + a real couples rail so it earns clicks.
6. **Excess vertical whitespace.** `py-24` on every mid band is what makes the page feel like a
   slideshow of empty rooms. Tighten mid-section padding to `py-16 md:py-20`, reserve the big
   `py-24/32` only for the ink closer band, and let color-blocking (not air) separate sections.
7. **Any invented testimonials.** The hi-fi reference (`hifi-reference.html`) ships a 3-card
   testimonials section with named quotes (Mara K., Devin R., Priya N.). Those are invented —
   do NOT build them (FTC + charter). The current component already omits them; keep it omitted
   until real orders produce real reviews (then wire the `testimonials` Sanity block, Routine B).
8. **The Ask-Emma widget's coral→orange gradient** (flagged in the brief as a v3 violation).
   Re-spec to flat `coral` background / `plum` accent. Out of this file's render scope but
   part of the same cleanup — hand to `rr7-engineer`.

---

## 4. Imagery manifest

Every image the build needs. Real Shopify product photography is the default wherever a specific
product is featured (hero, all product cards) — those are NOT generated. Generated scenes must show
what we sell (mission brief §2, Mike's 2026-07-05 directive): either the actual product placed via
its real Shopify photo submitted as a FLUX Kontext reference (`--ref-image`), or sensual human
context (lingerie on a body, skin, tension) matched to what the surface links to. Housewares
still-lifes with no product — tea cups, ceramic bowls, notebooks, candles — are banned; that set
shipped in July 2026 and made us look like a tableware shop. Each image must pass the mission brief
§2 self-review. Hard limits: no exposed genitalia, no nipples, no sex acts. Hand this manifest to
`media-manager`.

Shared prompt DNA (prepend to every generated prompt): *"Bold editorial photograph for a premium
sexual-wellness brand, bright daylight or high-key studio light, saturated color-block backdrop
(coral, warm plum tints), playful and confident mood, product large in frame, crisp and vivid,
no text, no logos, premium DTC launch-campaign art direction, shot on medium format."* Never dark,
moody, or candlelit (Mike, 2026-07-05); the mood is fun-and-curious with charge underneath.

| # | Lands in (Sanity field) | Aspect | Subject / prompt |
|---|------------------------|--------|------------------|
| 1 | Hero product image | 4:5 | **Not generated.** Real Shopify photo of `featured[0]`. |
| 2 | Meet Emma portrait (`emmaPersona.avatarUrl` / `/emma.png`) | 4:5 | Existing Emma portrait. Keep. |
| 3 | `wayfinderMosaic.wayfinderTiles[0].image` ("New here?" → a starter product) | 3:4 | Kontext ref = the linked product's Shopify photo. "This product standing bold and centered on a coral seamless backdrop in bright studio light, crisp shadow, playful and vivid." |
| 4 | `wayfinderMosaic.wayfinderTiles[1].image` ("For two" → couples collection) | 3:4 | "Two hands with fingers interlaced against a saturated warm color-block backdrop in bright daylight, one wrist in a lace cuff, playful and intimate, nothing explicit." |
| 5 | `wayfinderMosaic.wayfinderTiles[2].image` (product-linked) | 3:4 | Kontext ref = the linked product's Shopify photo. "This product front and center on folded bright silk against a plum-tint backdrop, high-key studio light, bold and fun." |
| 6 | `playTogetherBanner.image` (Couples band) | 16:9 | Prefer the professional brand couples photo already in Sanity (8b86bbf...). If regenerating: "A couple laughing close together on white bedding in bright morning daylight, silk slip and bare shoulders, playful and intimate, nothing explicit." |
| 7 | `editorialTiles.tiles[0].image` (first-timer read → product PDP) | 3:2 | Kontext ref = the linked product's Shopify photo. "This product held up proudly in a hand against a bright coral backdrop, daylight, curious and fun, crisp and vivid." |
| 8 | `editorialTiles.tiles[1].image` (slow-nights read → product PDP) | 3:2 | Kontext ref = the linked product's Shopify photo. "This product on white marble beside a bright silk robe and eucalyptus in airy daylight, spa-bright, inviting." |
| 9 | `editorialTiles.tiles[2].image` (questions/FAQ) | 3:2 | "Colorful lace lingerie laid out flat on bright white sheets next to a small ribboned gift box, airy daylight, inviting and unintimidating, vivid color pops." |
| 10 | `wayfinderMosaic.promo.image` ("Not sure where you land?" Discover You tile) | ~5:2 wide | **Legibility constraint: this tile has NO scrim — ink/plum text renders directly on the image**, so the image must be high-key and pale with the subject confined to the RIGHT third and clean negative space on the left two-thirds. "A laughing woman peeking over a bright silk sheet on the right third of the frame, pale lavender high-key backdrop, playful curiosity, generous empty space left." |

Reuse-first: before generating, `media-manager` checks existing Sanity assets tagged by mood /
handle. When uploading new assets, tag with the mood + section so future weekly runs find them.

---

## 5. Implementation notes (for `rr7-engineer`)

**Reuse as-is:** `StorefrontProductCard`, `OptimizedImage`, `EmailSubscribe`, `FAQStructuredData`,
`ContentBlockRenderer`, `Reveal` (`app/components/motion/Reveal.tsx`) + `useReveal`. The Sanity
render path in `StorefrontHome.tsx` (Suspense/Await over `contentBlocks`) stays — this is a
restyle of the existing components, not a data-layer change.

**Build new (small, presentational, within `StorefrontHome.tsx` or a sibling file):**
- `ProductGrid` — the Nº 03 static 2-up/4-up grid wrapper around `StorefrontProductCard`
  (mobile grid vs. the existing horizontal `Rail`). Takes a `Rail` and a `See all` href.
- `PhotoTile` — the Nº 05 photographic category tile (image + ink scrim + white label). The
  existing `FindYourWayIn` tiles already support an optional image; extend the scrim/label styling.
- `PhotoBand` — the Nº 07 couples photographic banner (image + scrim + label + CTA). Extends
  the current flat `Couples` band.
- `SectionNumeral` — the "Nº 0X" mono tag motif used on major bands/tiles. Trivial.

**Motion wiring:** wrap section heading blocks and grids in `<Reveal>` per the per-section notes.
Do NOT wrap the hero LCP image. Do NOT add per-card reveals inside horizontal scrollers (Nº 06,
couples rail) — one `Reveal fade` on the whole rail. Reduced-motion renders final state (primitive
handles it). Zero CLS: transform/opacity only, all image frames have fixed aspect ratios.

**Padding pass:** change mid-section vertical padding from `py-16 md:py-24` to `py-16 md:py-20`;
keep `py-20 md:py-32` only on the ink closer (Nº 08). This is the density fix.

**Additive Sanity schema needs (hand to `sanity-content-builder`, additive only):**
- No NEW block types are strictly required — every section maps to an existing block
  (`emmaHeroStorefront`, `wayfinderMosaic`, `emmaCuratedRail`, `productCarousel`,
  `playTogetherBanner`, `promoBanner`, `editorialTiles`, `trustBar`, `editorBio`).
- **One additive field, optional:** add `seeAllLink` + `seeAllLabel` (string) to the block that
  feeds Nº 03 so the "See all →" target is content-controlled. If skipped, hardcode
  `/collections/best-sellers`. Do not modify any existing field.
- Confirm the `first-time` and `couples` Shopify collections exist (tile + band targets).

**Acceptance (per brief):** `qa-reviewer` on preview MCP at 375px — verify CLS ≈ 0, hero image
is the LCP and unwrapped, all tinted bands render, every content section shows its hardcoded
fallback when its Sanity block is absent. `seo-pdp-auditor` + `aeo-geo-auditor` confirm the
FAQ JSON-LD and H1/H2 hierarchy survive. Count clickable modules → confirm ≥70% resolve to
`/products/{handle}` or a collection (Nº 03 grid + Nº 06 rail + Nº 07 rail + category tiles
carry this comfortably; `/discover` appears exactly twice: the Nº 05 promo tile and the Nº 08 closer).

---

## Handoffs

- **`rr7-engineer`** — build the relayout in `StorefrontHome.tsx` per §2/§5 (gated PR, never auto-merged).
- **`sanity-content-builder`** — the single optional additive `seeAllLink/Label` field (§5); confirm collections exist.
- **`media-manager`** — generate/reuse the 7 supporting scenes in the §4 manifest; tag by mood + section.
- **`emma-copywriter`** (gated by `emma-empathy-reviewer`) — finalize the §2 copy slots per weekly theme.
- **`qa-reviewer`** — preview MCP acceptance: CLS, LCP-unwrapped confirm, 375px, fallback coverage.
