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

## Notebook — Daily post hero (`docs/notebook-team/image-brief.md` §0, ~1200×900)

**Routed by publishing category** (§0 hero router, owner-codified 2026-07-28): `guides` /
`comparisons` / `care` / `wellness-basics` → §0-P product scaffold; `real-talk` /
`podcast-notes` (and any post with zero embeds) → §0-H human scaffold.

### §0-P product scaffold

(always with `--ref-image` = the post's embedded product's real Shopify photo, fal Kontext,
`imageSize: 'landscape_4_3'`):

> Bright warm editorial magazine photograph on a pure white paper background, soft directional
> daylight falling from one side, calm and unembarrassed mood, tasteful and non-explicit.
> The {product} standing large and bold in the frame, placed upright on a clean white paper
> surface, keep the product packaging and label exactly as shown in the reference image, unaltered
> and legible, do not invent or distort any label text. {one small category-accent prop — e.g. a
> blurred sage-green plant leaf sprig for `care`, nothing for `guides`/`wellness-basics`, a second
> product for `comparisons`}, one crisp warm shadow, generous open negative space around the
> product, editorial magazine still life photography, shot on medium format, shallow depth of
> field, warm inviting color grade. No towels, no cloth, no washcloth, no folded fabric, no
> candles, no mugs, no cups, no notebooks, no fruit, no other objects, not clinical, not a
> lightbox, not dark, not moody, no garbled or illegible label text.

### §0-H human scaffold

(no ref-image unless Emma appears — then `--ref-image` = the canonical Emma photo, Sanity
`singleton.editor`; fal, `imageSize: 'landscape_4_3'`, 2 candidates):

> Bright warm editorial magazine photograph, soft directional window daylight, high-key, calm
> private sunlit room, tasteful and non-explicit. {One or two adults in their 30s, clearly
> adult}, {expressive direction matched to the headline's feeling — e.g. "sitting on the edge of
> an unmade bed, face turned toward the window, tired and tender" / "mid-laugh, gesturing across
> a kitchen counter"}, faces visible, natural correct anatomy, five fingers per hand, natural
> skin tones, fully clothed in soft casual clothing. {Optional: the {product} resting small on a
> nightstand or shelf at the edge of the frame.} Coral-soft and plum-soft warmth in the light,
> white and warm-neutral surfaces, generous negative space in the {zone} for a title overlay.
> No children, no teenagers, no youthful ambiguity, no nudity, no bare torso, no sexual contact,
> no uncanny faces, no warped features, no extra fingers, no mugs, no cups, no candles, no
> folded blankets, no towels, no text, no words, no logos, not moody, not dark, no candlelight,
> no orange, no amber, no gradient wall, not clinical.

Vision gate for §0-H: hard reject on youthful ambiguity (reject on ambiguity, not intent),
uncanny faces, moody or dark grading, sexualized bodies, or no identifiable human presence.

### Archetype E scaffold — surreal brand art / visual wit (doctrine §4-E, owner license 2026-07-28)

For owned surfaces only: homepage editorial tiles, §0-P surreal-option blog heroes (never on †
health-adjacent topics), PDP mood slides, OG/share images, campaign moments. Witty never crude;
no literal explicit anatomy; ground lock and high-key daylight bind — the craft is what makes it
art instead of a shitpost. Invent fresh concepts every time; never reuse a joke.

> Bright high-key editorial art photograph, soft directional daylight, {coral-soft / plum-soft /
> paper} ground, surreal but meticulously crafted, shot like a luxury still-life campaign,
> playful and confident, tasteful and non-explicit. {The concept — one clear visual idea, e.g.
> "a saguaro cactus whose arms are smooth matte-coral silicone, one arm budding a tiny pink
> flower, potted in a plain terracotta pot" / "a sleek dolphin arcing out of rippling plum silk,
> its blowhole a soft air-pulsation aperture" / "a glossy eggplant sitting in a shallow puddle
> of clear water, one slow ripple" / "a rabbit vibrator nested in the throat of a large orchid
> whose petal folds echo it" / "five assorted pastel toys arranged stem-up in a glass vase like
> a tulip bouquet" / "a white wand standing as a tiny lighthouse on a rock, sweeping warm light
> across a sea of grey silk"}. One idea per frame, generous negative space, crisp warm shadow,
> hyper-real material rendering. No text, no words, no logos, no human bodies, no explicit
> anatomy, no crude framing, not dark, not moody, no clinical lightbox, no orange, no gradient
> wall.

Concept seeds beyond the owner's examples (rotate, never repeat a shipped one): a bullet vibe as
the lipstick in an open compact; a plug as the queen on a chessboard mid-game; an ice-cream cone
whose swirl is soft matte silicone with a cherry; a Newton's cradle where one sphere is a kegel
ball; a cocktail glass "garnished" with a bullet where the olive pick goes; a topiary garden
where one hedge is trimmed into a wand silhouette; a vinyl record player whose tonearm is a slim
external vibe; a snow globe containing a tiny bedside scene.

**Keepers:**

**Rejects:** anything a viewer would read as crude rather than clever, literal anatomy, dim or
moody grading, concept salad (two jokes in one frame).

**Keepers:** JO H2O Original Water-Based Lubricant (`jo-h2o-original-water-based-lubricant-4-oz`),
sage-leaf + water-droplet care accent, warm dappled daylight on cream/white paper →
`image-e75e55758b2fc4594fd24ec197a561744163c299-1184x880-jpg` (post: `how-do-you-care-for-silicone-toys`).

We-Vibe Tango X Cherry bullet vibrator (`we-vibe-tango-x-rechargeable-silicone-intense-bullet-vibrator-cherry`),
no accent prop (guides/Real Talk tone, no category chip needed), standing upright and large in frame on
warm daylight paper with one crisp side shadow, no props at all → shape and color matched the real
product photo cleanly via Kontext (tapered head, two side buttons, matte cherry-red finish) →
`image-4f031e89641e484c6f45a3d579c54bed3455fbd0-1184x880-jpg` (post:
`why-first-toy-shopping-feels-overwhelming`). **Superseded as precedent (2026-07-28):** under the
§0 hero router, `real-talk` posts now take the §0-H human scaffold, not a product hero. Keep this
entry only as evidence that Kontext matches bullet-scale products cleanly; do not cite it as
support for product-forward heroes on Real Talk posts.

Sliquid Naturals H2O Intimate Lubricant 8.5oz (`naturals-h2o-intimate-lubricant-8-5-oz`), guides
category (no accent prop), shot close and tight so the bottle fills most of the frame height with
only a thin headroom margin, warm golden-hour daylight with a dramatic long shadow →
`image-8b80029eac5ac4c6fbde630158e6248941ffe739-1184x880-jpg` (post:
`what-lube-to-use-with-sex-toys`). Prompt addition that fixed a too-small-in-frame first pass:
"shot close and tight so the bottle fills most of the frame height with only a thin margin of
headroom above the cap ... quiet negative space beside the product (not above it)".

Sliquid Shine Organic Intimate Toy Cleaner (`sliquid-shine-organic-toy-cleaner`), care category,
water-droplet + blurred sage-leaf-sprig accent (no cloth/towel), bottle large and bold on white
paper, one crisp warm shadow →
`image-7529800bbcc4ff64fd93ad5f44e10291f9e7dfba-1184x880-jpg` (post:
`how-often-should-you-clean-your-vibrator`). Note: the reference product for this post's other
embed, `bloom-curve-g`, has a **broken Shopify photo set** (all three product images resolve to
unrelated stock photos — a desk flatlay and two landscape shots, not the vibrator) — flagging for
`product-manager`/data-hygiene; do not pass that handle's images as a `--ref-image` until fixed.
Sliquid Shine was the stronger and correctly-referenced subject anyway (most on-topic for a
cleaning-cadence post). Of the 2-image batch, one candidate legibly reproduced all main label text
(brand mark, "shine", "sliquid", "95% organic", "naturally unscented", "intimate toy cleaner");
the other candidate garbled the fine-print sub-lines into illegible nonsense text and was
rejected — keep asking for 2 candidates per hero call so a garbled-label reject doesn't require a
full regenerate round.

**Rejects:** first pass on the same post added a folded white washcloth as a "care" prop — the
brief's §0 banned list explicitly bans towels/cloth; also read as a clinical product-lightbox
(flat white sweep, drop shadow, no warm daylight) and FLUX Kontext garbled the fine-print label
text into illegible nonsense. Fix: drop cloth/towel props entirely, ask for warm directional
daylight (not lightbox), add an explicit "keep the label exactly as shown, do not invent text"
instruction, and use a category-appropriate small accent prop (leaf for care) instead of fabric.

100 Questions About Sex conversation card game (`100-questions-about-sex`), archetype B
(color-block still), no category chip (Podcast Notes / Real Talk tone), box standing large and
bold on a flat solid white paper ground with a few cards fanned beside it, soft neutral daylight,
one crisp shadow →
`image-9a1f44b3b32fe95371d6741dab6b71a156e82b5d-1184x880-jpg` (post: "What Is a 'Sexual History,'
and How Does Knowing Yours Improve Your Sex Life?"). First pass with "warm golden-hour daylight
falling softly from one side" produced a saturated amber/orange gradient wall behind the box —
rejected for the retired-orange + no-gradient-backdrop rule even though the product itself
rendered cleanly via Kontext. Fix: drop "golden-hour" language entirely, state the backdrop must
be FLAT SOLID WHITE with no colored wash/wall/gradient in all-caps emphasis, keep "soft neutral
daylight" only as the light description (not the wall color), and add "no orange background, no
amber background, no gradient wall, no colored backdrop" to the negative prompt explicitly (the
shared negative list's "no gradient backgrounds" alone was not enough to stop the model reading
"golden-hour" as a colored wall wash).

Womanizer Classic 2 (`womanizer-classic-2-rechargeable-silicone-pleasure-air-clitoral-stimulator`),
comparisons category, archetype B (color-block still) single-product fallback for a two-product
comparison post — the pipeline's Kontext path only accepts one `--ref-image`/`image_url`, so a true
side-by-side with the FemmeFunn Ultra Bullet (the post's other embed) was not feasible without
inventing a fake lookalike second product; per the brief's explicit fallback ("If a two-product
frame is not feasible, feature the Womanizer Classic 2 alone") went single-subject. Flat solid
plum-soft (#F3E8FB) seamless backdrop (the comparisons-category accent, doubling as ground-lock
compliance), product large and centered/left-of-center for a title quiet-zone, bright even studio
light →
`image-c0c5b043c9eec7f11cbdb971aca5f6d0a026568c-1184x880-jpg` (post:
`air-pulse-toy-vs-vibrator-difference`). First pass with "warm high-key daylight falling softly
from one side" + a plain color-slot mention produced a **gradient/two-tone wash** background on
both candidates (magenta-to-pink vertical gradient on one; a graphic diagonal-triangle color-block
pattern on the other) — same reject class as the "100 Questions" gradient-wall failure below, just
in plum/pink instead of orange. Fix (repeats the documented pattern): drop directional "daylight
falling from one side" language entirely, replace with "soft even studio light, no strong
directional beam, no dramatic shadow shapes," and state the backdrop requirement in ALL CAPS as
"ONE FLAT SOLID UNIFORM color FILLING THE ENTIRE BACKDROP... NO GRADIENT, NO COLOR WASH, NO
DIAGONAL SHAPES, NO TRIANGLES, NO TWO-TONE SPLIT, NO DARKER PATCH." Second pass with that fix
produced two clean flat-backdrop candidates; both passed the vision gate (undistorted curved
product shape matching the reference, no hand-anatomy risk since no hand in frame, high contrast
at thumbnail size) — picked the one with more negative space to one side for the headline quiet
zone.

**Rejects (this run, round 1):** "high-key daylight falling softly from one side" as a light
descriptor, even with an explicit backdrop color slot, reliably invites FLUX Kontext to render a
directional gradient or a graphic color-block pattern instead of a flat seamless tint — treat this
as a standing rule for this scaffold, not a one-off: always pair a named ground-lock color with
"soft EVEN studio light" + the explicit flat-solid-backdrop ALL-CAPS clause above, never
"daylight falling from one side" when the ask is a flat tinted ground (reserve directional daylight
language for archetype C in-situ scenes where a gradient/shadow reads as natural, not for B
color-block stills).

**Tooling gotcha (not a prompt reject, a call-site bug):** on the `naturals-h2o` run, calling
`generateImage()` directly (not through `gen-notebook-art.ts`, which has no `hero` surface) with
`imageSize: { width: 1200, height: 900 }` silently produced a 16:9-ish 1392×752 frame — the
Kontext path in `fal.server.ts` only maps the fal `image_size` **string enum**
(`landscape_4_3` → `4:3`) to `resolution_mode`; an explicit `{width,height}` object falls through
to the `16:9` default for the ref-image (Kontext) code path specifically. Always pass
`imageSize: 'landscape_4_3'` (the string) for this surface, exactly as the scaffold above already
says — never a `{width,height}` object when `refImageUrl` is set.

## Known failure classes (append as they are found)

Two reproducible ways a generation gets rejected, both hit on 2026-07-27. Read
these before writing briefs; they are cheaper to avoid than to retry.

**1. Printed brand marks survive Kontext, and they garble.** With `--ref-image`
pointed at a product whose body carries a printed brand mark, FLUX Kontext
reproduces the mark and frequently mangles the letterforms (a Nixie Mystic Wave
came back reading "NIXE" twice in a row). Baked-in lettering fails the owner's
hard no-text rule no matter how clean the rest of the frame is, and no negative
prompt reliably removes it. So: for any slot under the no-text mandate, brief a
subject that carries no printed mark. Glass, silicone, and unbranded moulded
pieces are safe. Lube bottles are structurally incompatible with a hard no-text
rule, because the label is the product; show the act or the surface instead, and
let the markup carry the words.

**2. fal safety returns a black JPEG on liquid-plus-hands phrasing.** The known
stochastic black return (a 2 to 4KB all-black JPEG) was reproducible on 2026-07-27
against specific wording rather than at random: prompts describing a bead or drop
of liquid in an open palm, and prompts describing a bed scene, returned black
three times. Rewriting the same concept as "an open hand and pale silk" and "a
quiet private room" cleared it immediately on the first retry. If a slot returns
black twice, change the phrasing before spending a third call, and prefer naming
the fabric, the light, and the surface over naming the fluid or the bed.

---

*Seeded 2026-07-17 from the doctrine §4 directives and the mission-brief §2 image rules.
Owner: `media-manager` (append keepers/rejects each run); pruned monthly.*
