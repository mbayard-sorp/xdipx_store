# Image Prompt Library

Per-surface prompt scaffolds for `media-manager` (design-elevation p3-prompts). Good prompts
compound; this file is where they stop evaporating.

**Rules of use**

- Start every generation from the matching scaffold below; substitute the `{...}` slots. Do not
  write prompts from scratch.
- After every run, append prompts that produced keepers to the surface's **Keepers** list (with
  the placed asset URL as the thumbnail reference) and add failed patterns to **Rejects**.
- All scaffolds inherit `docs/design-doctrine.md` §4: real product via `--ref-image` (FLUX
  Kontext) wherever a product is featured or linked; bright/high-key light; v3 palette; nothing
  a premium lingerie campaign could not run.
- **Mandatory negative prompt on every generation:** `no text, no words, no letters, no
  watermark, no logo, no caption, no gradient backgrounds, no plastic or clinical look, no
  housewares still-life, no tableware, no candles, no dim or candlelit scene, no distorted
  hands, no extra fingers`
- Maintenance cadence: pruned monthly (design-elevation ongoing cadence); rejects older than a
  quarter may be dropped once the pattern is folded into the scaffold text.

---

## Hero (block image, 4:5 or wide per block)

Scaffold (always with `--ref-image` = the hero product's Shopify photo):

> The {product} standing large and centered on a {coral | soft plum | saturated color-block}
> seamless studio backdrop, bright high-key lighting, crisp single shadow, premium DTC launch
> campaign photography, editorial and confident, product fills most of the frame, shallow
> depth of field, shot on medium format

Variations that keep it fresh: a hand entering frame to reach for the product; the product on a
plinth with one ♥-shaped physical object nearby (small, never overlaid).

**Keepers:** (append `prompt → placed asset URL` lines here after runs)

**Rejects:** dim boudoir scenes (retired July 2026); product tiny in frame on an empty styled
table (reads housewares).

## Rail card / Emma's edit (1:1)

Scaffold (always with `--ref-image`):

> The {product} bold and centered on a {plum-soft | coral-soft | white paper} seamless
> backdrop, bright studio light, crisp shadow, square crop, product large in frame, premium
> sexual-wellness brand catalog photography, playful and confident

**Keepers:**

**Rejects:** multiple invented lookalike products in one frame; props larger than the product.

## Wayfinder / editorial tile (1:1 or 4:5)

Scaffold — product tiles use `--ref-image`; human-context tiles may use `--no-ref` with reason:

> {Close crop of hands | silk fabric against skin | lingerie detail on a body}, warm natural
> daylight, {coral | plum} color accent in the styling, editorial fashion photography, playful
> tension, tasteful crop (no exposed genitalia, no nipples), premium lingerie campaign energy

**Keepers:**

**Rejects:** tea cups / mugs / bowls / notebooks / fruit / candles as the subject (the July
2026 housewares failure class); empty styled surfaces with no product and no human presence.

## Mood band / photo band (16:9 or wide)

Scaffold (`--no-ref` allowed with reason "abstract mood band, no product target"):

> {Sunlit bedroom corner with rumpled white linen and a hand reaching across | two pairs of
> bare feet tangled at the end of a bed in daylight | silk slip on skin, morning light},
> bright warm daylight, saturated {coral | plum} accent tones, editorial photography,
> intimate but wholesome-charged, generous negative space on the {left | right} for an ink
> scrim and headline set in the markup

**Keepers:**

**Rejects:** candlelit gloom; clinical white-on-white; any scene a homewares brand could run
unchanged.

## Promo image (per promo block aspect)

Scaffold (always with `--ref-image` when the promo targets a product or collection):

> The {product} on a saturated {seasonal/theme color} seamless backdrop with {theme prop, small
> and supporting}, bright pop-art studio light, bold and celebratory, product is the
> unmistakable star, premium campaign photography

**Keepers:**

**Rejects:** theme props replacing the product as subject; baked-in sale text (all copy lives
in the markup).

## Notebook — Daily post hero (`docs/notebook-team/image-brief.md` §0, ~1200×900)

Scaffold (always with `--ref-image` = the post's embedded product's real Shopify photo, fal Kontext,
`imageSize: 'landscape_4_3'`):

> Bright warm editorial magazine photograph on a pure white paper background, warm golden-hour
> daylight falling softly from one side, calm and unembarrassed mood, tasteful and non-explicit.
> The {product} standing large and bold in the frame, placed upright on a clean white paper
> surface, keep the product packaging and label exactly as shown in the reference image, unaltered
> and legible, do not invent or distort any label text. {one small category-accent prop — e.g. a
> blurred sage-green plant leaf sprig for `care`, nothing for `guides`/`wellness-basics`, a second
> product for `comparisons`}, one crisp warm shadow, generous open negative space around the
> product, editorial magazine still life photography, shot on medium format, shallow depth of
> field, warm inviting color grade. No towels, no cloth, no washcloth, no folded fabric, no
> candles, no mugs, no cups, no notebooks, no fruit, no other objects, not clinical, not a
> lightbox, not dark, not moody, no garbled or illegible label text.

**Keepers:** JO H2O Original Water-Based Lubricant (`jo-h2o-original-water-based-lubricant-4-oz`),
sage-leaf + water-droplet care accent, warm dappled daylight on cream/white paper →
`image-e75e55758b2fc4594fd24ec197a561744163c299-1184x880-jpg` (post: `how-do-you-care-for-silicone-toys`).

**Rejects:** first pass on the same post added a folded white washcloth as a "care" prop — the
brief's §0 banned list explicitly bans towels/cloth; also read as a clinical product-lightbox
(flat white sweep, drop shadow, no warm daylight) and FLUX Kontext garbled the fine-print label
text into illegible nonsense. Fix: drop cloth/towel props entirely, ask for warm directional
daylight (not lightbox), add an explicit "keep the label exactly as shown, do not invent text"
instruction, and use a category-appropriate small accent prop (leaf for care) instead of fabric.

---

*Seeded 2026-07-17 from the doctrine §4 directives and the mission-brief §2 image rules.
Owner: `media-manager` (append keepers/rejects each run); pruned monthly.*
