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
table (reads housewares). Run 72 (2026-07-21), Intense wand hand-reach hero (Archetype A, `--ref-image`
98577A.jpg): 2 FLUX Kontext attempts, both failed the vision gate — the model consistently bakes
faint embossed lettering into the wand's neck/ring seam (the ref photo's real "CAMTOYZ" neck print
appears to be what Kontext is echoing) even when explicitly told "no lettering, smooth unmarked
neck ring"; ground also drifted to a more saturated coral than the coral-soft pastel tint both
times. Per the two-fail rule, staged the real product photo instead (unplaced — no hero image slot
exists yet, see `rr7-engineer` hero shell PR). **Open problem for next attempt:** this ref image's
neck-seam text-echo is a repeatable FLUX Kontext failure mode; try either (a) an inpaint/mask pass
that starts from a pre-cropped ref image with the neck seam physically cropped out before it ever
reaches Kontext, or (b) a wider composition where the hand fully occludes the neck seam from the
chosen camera angle (not just "high grip" as a text instruction, which did not work in run 72).

**Run 72 follow-up (2026-07-21), LCP hero source-image fix (content-op, no generation):** the
critic flagged that `intense-wand-vibrator`'s Shopify image position 1 (98577A.jpg) was itself two
printed CAMTOYZ retail boxes — that photo is what the storefront hero/product-card/OG-image/JSON-LD
all derive from (first Shopify image = the whole site's lead image), so no prompt fix mattered
until the source photo was fixed. Product-only region occupies a clean x:0–292 band of the
1000×1000 photo (boxes start at x:372, verified via column-scan, no gradient/shadow bleed in the
gap) — cropped that band, padded to a square on white, upscaled to 1200×1200, uploaded as a new
Shopify product image via `productCreateMedia`/`uploadThumbnailToProduct`, then reordered to
position 1 via `productReorderMedia`/`setMediaAsPrimary` (original box photo kept at position 2 for
packaging info). Storefront Storefront-API `images(first:5)` confirmed the new order immediately;
the SSR homepage hero needed a discovery-index rebuild to pick it up (`POST
/cron/warm-discovery-index`, since the hero's `featured[0]` comes from the KV/Neon-cached discovery
index, not a live per-request Storefront query — a plain 60s wait is not enough, the index has its
own longer cache tier). New image: `intense-wand-vibrator-boxfree-hero.jpg` (Shopify Files, product
media position 1). No prompt/generation involved — logged here as the canonical fix for "first
Shopify image has box/packaging" defects on any product, since the same fix path applies broadly.

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

Run 72 (2026-07-21), Wave-1 wayfinder tiles (Archetype B, block `wayfinderMosaic-run8`):
- "Start slow" → Slow Sex massage candle tin (`--ref-image` 98601A.jpg), lid closed and turned on
  its side so the label is fully hidden, pale blush coral-soft ground, small pool of amber massage
  oil as the color-rhyme echo → kept on 2nd attempt (1st attempt: saturated coral ground +
  fully-legible "SLOW SEX" label, both fixed by explicitly demanding a pale pastel ground and the
  lid turned away) → `image-a184526ee589cf0525c20251b7001a4db50d6c40-1392x752-jpg` (tile `wf65a`).
- "The reliable one" → Intense wand vibrator (`--ref-image` 98577A.jpg), pale blush coral-soft
  ground, one smooth blush stone as the color-rhyme echo, explicit "no hand in frame" → kept on
  1st attempt → `image-f0ad3f5f5f443a86ef56b212f99897d9ce9c6217-1392x752-jpg` (tile `wf65b`).
- "Runs warm as you go" → Kian warming vibrator (`--ref-image` 98487A.jpg), pale lilac plum-soft
  ground, lavender sprig echo: **2 attempts both failed** (1st: fabricated legible brand word
  "Cawloor" embossed near the base button; 2nd: chasing "completely smooth, no embossing" made
  Kontext abandon the reference shape entirely — rendered a plain rounded capsule instead of the
  ribbed G-spot vibrator, plus still had faint illegible marks). Per the two-fail rule, fell back
  to the real Shopify photo re-hosted as a Sanity asset (no generation) →
  `image-6cbcfdeecc9867c8be2a70a311cdff3fa5cea838-1000x1000-jpg` (tile `wf65c`). **Open problem:**
  small dark-plastic-button products on this line seem prone to Kontext inventing base/button
  text; try cropping the ref image to exclude the button before passing it to Kontext next time.

  **Run 72 follow-up (2026-07-21):** critic flagged that "real Shopify photo" fallback above was
  actually the full retail-box packshot (98487A.jpg unmodified) re-hosted to Sanity, not a
  box-free crop — broke the ground lock next to two clean color-block tiles. Tried the open
  problem's suggested fix: found gallery image 98487C.jpg is already a clean box-free product-only
  shot on white (no clamshell, no box), patched out its one small "CAM..." base logo with a
  silhouette-bounded solid-color fill (sampled from adjacent product pixels, painted only within
  the product's own row-bounds so it never bled onto the white background), uploaded as a fresh
  Kontext ref image, retried once more (per this run's explicit "one more attempt" allowance) with
  the same plum-soft/lavender-sprig scaffold prompt → **3rd attempt also failed**, and failed
  worse: Kontext fully abandoned the reference shape again, this time inventing an unrelated
  oval-bodied device with a fake camera-lens-like inset and fabricated illegible logo text near the
  base ("elJua"/"GAMJAS"-looking marks) — not a G-spot vibrator at all. **Conclusion: this SKU is a
  confirmed 3-for-3 Kontext failure, stop trying Kontext on 98487-series Kian photos.** Fell back to
  a clean PIL composite per doctrine §4.6: cut the box-free, logo-patched 98487C.jpg product region
  out via a soft-alpha white-background threshold (keeps antialiased silicone edges, no plastic
  cutout look), composited onto a flat `#F3E8FB` plum-soft canvas at the tile's native 1392×752
  with a soft blurred elliptical shadow, positioned inside the component's actual `aspect-[4/3]`
  object-cover center-crop band (verified via a local crop preview before upload so the product
  isn't clipped by the live card). No invented props (skipped the lavender sprig — a hand-drawn
  flourish risked reading amateurish against two photographic/generated neighbor tiles; the flat
  ground + bold real-product silhouette alone matches wf65b's restraint). Passed the vision gate 1st
  composite attempt → `image-c209a372b01a9e33a7bbe2a7b982a374c4a6fbea-1392x752-jpg` (tile `wf65c`).
  **Reusable pattern:** the soft-alpha-threshold cutout + flat-tint-canvas + blurred-ellipse-shadow
  script is the general PIL-composite fallback recipe for any product Kontext can't handle after two
  failed attempts — cheap, deterministic, ground-lock-safe by construction (no chance of the model
  drifting the background color or fabricating text).

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

Run 72 (2026-07-21), `playTogether-starter` couples band replacement (Archetype C, `--no-ref`
"abstract couples mood band, no single product target"): two pairs of bare legs/feet tangled at
the end of a sunlit bed, crisp white linen, warm coral throw blanket, no faces, bright morning
daylight → passed the vision gate 1st attempt (bright, coral-toned, no faces, clean anatomy) →
`image-6e5fd0cd1e7e18f32884ee602937b7ce224837c3-1024x576-jpg`. **Caveat, not a hard-gate fail:**
the render reads more like one person's crossed legs than two distinct people — copy/creative
should treat this as a placeholder-quality "couple" read; worth a sharper prompt next cycle (e.g.
explicitly different skin tones or foot sizes per pair to disambiguate two bodies) before calling
it final. Replaces the prior stale asset (`image-8b86bbfe6a45cc196f657cc4740e8a70606d0da2`, a dark
navy candlelit face-on couple scene with a champagne glass and lit candles — failed doctrine §4 on
multiple counts: dark/moody, banned candle prop, non-anonymous faces).

**Rejects:** candlelit gloom; clinical white-on-white; any scene a homewares brand could run
unchanged.

## Promo image (per promo block aspect) — Archetype B (color-block still)

Scaffold (always with `--ref-image` when the promo targets a product or collection):

> The {product} on a {coral-soft | plum-soft | paper} seamless backdrop with {theme prop, small
> and supporting, its color echoing the theme}, bright pop-art studio light, bold and celebratory, product is the
> unmistakable star, premium campaign photography

**Keepers:**

Run 72 (2026-07-21), wayfinder promo "Discover You" (Archetype C human-context, `--no-ref`
"Compass finder promo, no single product target"): two anonymous open hands cropped at the wrist
against a completely flat solid pastel plum-soft backdrop, no face, generous negative space above
for the scrim/headline → 1st attempt failed (radial glow/gradient behind the hands — banned; ground
read pink not plum); fixed on retry by demanding "completely flat, solid, evenly-lit ... absolutely
no gradient, no glow, no vignette, no light flare" explicitly in the prompt →
`image-792f06fbdd3f484ff18db3eccdf75a948ad8a57f-1024x576-jpg`. **Lesson:** fal/FLUX defaults toward
a soft vignette/glow on plain hand-on-backdrop compositions unless the flat-color instruction is
stated this explicitly and repeated in the negative list.

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

**Keepers:** none placed live yet (pre-staged only per the PDP evidence-surfaces shell PR gate).

**Rejects:** (hand-anatomy failures go here; the vision gate hard-checks hands per doctrine §4)

Run 72 (2026-07-21), Intense wand PDP macro row, pre-staged for `rr7-engineer`'s PDP evidence-surfaces
PR (`--ref-image` 98577A.jpg, product `intense-wand-vibrator`). **All three macro types hit the
same FLUX Kontext neck-seam text-hallucination failure mode as the hero (see Hero rejects above)
and burned their 2-attempt budget each:**
- Texture macro: 2 attempts, both baked fabricated legible words onto the neck ring ("ariause" /
  gibberish) even cropped tight to exclude the neck; fell back to a cropped real-photo texture shot
  → Shopify Files `intense-wand-vibrator-mood-pdp-macro-texture-fallback-real-photo.jpg`.
- In-hand scale: 2 attempts, hand anatomy was clean both times (5 fingers, no fusion, no extras —
  the anatomy instruction worked) but the neck-seam text persisted even when the prompt asked the
  grip to fully cover the ring; fell back to a real-photo product-only crop (no hand) → Shopify
  Files `intense-wand-vibrator-mood-pdp-macro-inhand-fallback-real-photo.jpg`.
- Tip/contour detail: 2 attempts — 1st repeated the neck text; 2nd (tried defocusing the neck via
  shallow-DOF framing) instead detached the rose-gold ring into a floating disconnected object with
  a warped heart-shaped notch cut into the body (uncanny artifact, worse than attempt 1) → fell back
  to a real-photo crop of the head + ring → Shopify Files
  `intense-wand-vibrator-mood-pdp-macro-tip-fallback-real-photo.jpg`.

**Standing problem for this SKU's ref image (98577A.jpg):** its real neck print is a strong,
repeatable Kontext hallucination magnet across every framing tried (tight crop, hand-occlusion,
defocus). Recommend pre-cropping the reference image to physically remove the neck-ring text zone
before it ever reaches Kontext, rather than relying on prompt instructions, before spending another
generation budget on this SKU's macro row.

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
