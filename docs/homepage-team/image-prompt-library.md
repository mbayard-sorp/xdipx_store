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
- **Declare the archetype first.** Every generation names one doctrine §4 archetype before
  prompting — A hand-on-product, B color-block still, C in-situ bright scene, D metaphor
  macro — and uses the scaffold tagged with it below. **Ground lock:** backdrops only from
  coral-soft, plum-soft, and paper tints (doctrine §4; sage is an accent, never a ground); a
  scaffold's color slots resolve within that set.
- **Mandatory negative prompt on every generation:** `no text, no words, no letters, no
  watermark, no logo, no caption, no gradient backgrounds, no plastic or clinical look, no
  housewares still-life, no tableware, no candles, no dim or candlelit scene, no distorted
  hands, no extra fingers`
- Maintenance cadence: pruned monthly (design-elevation ongoing cadence); rejects older than a
  quarter may be dropped once the pattern is folded into the scaffold text.

---

## Hero (block image, 4:5 or wide per block) — Archetype C (in-situ scene) or A (hand-on-product)

Scaffold (always with `--ref-image` = the hero product's Shopify photo):

> The {product} standing large and centered on a {coral-soft | plum-soft | paper} seamless
> studio backdrop, bright high-key lighting, crisp single shadow, premium DTC launch
> campaign photography, editorial and confident, product fills most of the frame, shallow
> depth of field, shot on medium format

Variations that keep it fresh: a hand entering frame to reach for the product; the product on a
plinth with one ♥-shaped physical object nearby (small, never overlaid).

**Keepers:** (append `prompt → placed asset URL` lines here after runs)

**Rejects:** dim boudoir scenes (retired July 2026); product tiny in frame on an empty styled
table (reads housewares).

## Rail card / Emma's edit (1:1) — Archetype B (color-block still)

Scaffold (always with `--ref-image`):

> The {product} bold and centered on a {plum-soft | coral-soft | paper} seamless
> backdrop, bright studio light, crisp shadow, square crop, product large in frame, premium
> sexual-wellness brand catalog photography, playful and confident

**Keepers:**

**Rejects:** multiple invented lookalike products in one frame; props larger than the product.

## Wayfinder / editorial tile (1:1 or 4:5) — Archetype B (product tiles) or C (human-context tiles)

Scaffold — product tiles use `--ref-image`; human-context tiles may use `--no-ref` with reason:

> {Close crop of hands | silk fabric against skin | lingerie detail on a body}, warm natural
> daylight, {coral | plum} color accent in the styling, editorial fashion photography, playful
> tension, tasteful crop (no exposed genitalia, no nipples), premium lingerie campaign energy

**Keepers:**

**Rejects:** tea cups / mugs / bowls / notebooks / fruit / candles as the subject (the July
2026 housewares failure class); empty styled surfaces with no product and no human presence.

## Mood band / photo band (16:9 or wide) — Archetype C (in-situ bright scene)

Scaffold (`--no-ref` allowed with reason "abstract mood band, no product target"):

> {Sunlit bedroom corner with rumpled white linen and a hand reaching across | two pairs of
> bare feet tangled at the end of a bed in daylight | silk slip on skin, morning light},
> bright warm daylight, saturated {coral | plum} accent tones, editorial photography,
> intimate but wholesome-charged, generous negative space on the {left | right} for an ink
> scrim and headline set in the markup

**Keepers:**

**Rejects:** candlelit gloom; clinical white-on-white; any scene a homewares brand could run
unchanged.

## Promo image (per promo block aspect) — Archetype B (color-block still)

Scaffold (always with `--ref-image` when the promo targets a product or collection):

> The {product} on a {coral-soft | plum-soft | paper} seamless backdrop with {theme prop, small
> and supporting, its color echoing the theme}, bright pop-art studio light, bold and celebratory, product is the
> unmistakable star, premium campaign photography

**Keepers:**

**Rejects:** theme props replacing the product as subject; baked-in sale text (all copy lives
in the markup).

## PDP macro / in-hand scale (1:1 or 4:5) — Archetype A (hand-on-product)

The TooTimid steal from the live teardown: a texture close-up, an in-hand scale shot, and a tip/
detail frame per product. Scaffold (always with `--ref-image` = the product's Shopify photo):

> {Extreme macro of the {product}'s surface texture filling the frame | one relaxed, undistorted
> hand holding the {product} to show true size | close detail of the {product}'s tip and contour},
> on a {coral-soft | plum-soft | paper} seamless ground, silk or linen surface beneath, bright
> high-key daylight, crisp focus on the product, skin tones natural and warm, premium
> sexual-wellness catalog photography, keep the product's shape, color, and finish exactly as the
> reference image

**Keepers:**

**Rejects:** (hand-anatomy failures go here; the vision gate hard-checks hands per doctrine §4)

## Notebook — Daily post hero — Archetype D (metaphor macro) or B (`docs/notebook-team/image-brief.md` §0, ~1200×900)

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

We-Vibe Tango X Cherry bullet vibrator (`we-vibe-tango-x-rechargeable-silicone-intense-bullet-vibrator-cherry`),
no accent prop (guides/Real Talk tone, no category chip needed), standing upright and large in frame on
warm daylight paper with one crisp side shadow, no props at all → shape and color matched the real
product photo cleanly via Kontext (tapered head, two side buttons, matte cherry-red finish) →
`image-4f031e89641e484c6f45a3d579c54bed3455fbd0-1184x880-jpg` (post:
`why-first-toy-shopping-feels-overwhelming`). Confirms the brief's guidance that a small bullet is a
strong beginner-subject hero even on a Real Talk / overwhelm-themed post — no domestic-metaphor
fallback was needed.

Sliquid Naturals H2O Intimate Lubricant 8.5oz (`naturals-h2o-intimate-lubricant-8-5-oz`), guides
category (no accent prop), shot close and tight so the bottle fills most of the frame height with
only a thin headroom margin, warm golden-hour daylight with a dramatic long shadow →
`image-8b80029eac5ac4c6fbde630158e6248941ffe739-1184x880-jpg` (post:
`what-lube-to-use-with-sex-toys`). Prompt addition that fixed a too-small-in-frame first pass:
"shot close and tight so the bottle fills most of the frame height with only a thin margin of
headroom above the cap ... quiet negative space beside the product (not above it)".

**Rejects:** first pass on the same post added a folded white washcloth as a "care" prop — the
brief's §0 banned list explicitly bans towels/cloth; also read as a clinical product-lightbox
(flat white sweep, drop shadow, no warm daylight) and FLUX Kontext garbled the fine-print label
text into illegible nonsense. Fix: drop cloth/towel props entirely, ask for warm directional
daylight (not lightbox), add an explicit "keep the label exactly as shown, do not invent text"
instruction, and use a category-appropriate small accent prop (leaf for care) instead of fabric.

**Tooling gotcha (not a prompt reject, a call-site bug):** on the `naturals-h2o` run, calling
`generateImage()` directly (not through `gen-notebook-art.ts`, which has no `hero` surface) with
`imageSize: { width: 1200, height: 900 }` silently produced a 16:9-ish 1392×752 frame — the
Kontext path in `fal.server.ts` only maps the fal `image_size` **string enum**
(`landscape_4_3` → `4:3`) to `resolution_mode`; an explicit `{width,height}` object falls through
to the `16:9` default for the ref-image (Kontext) code path specifically. Always pass
`imageSize: 'landscape_4_3'` (the string) for this surface, exactly as the scaffold above already
says — never a `{width,height}` object when `refImageUrl` is set.

---

*Seeded 2026-07-17 from the doctrine §4 directives and the mission-brief §2 image rules.
Owner: `media-manager` (append keepers/rejects each run); pruned monthly.*
