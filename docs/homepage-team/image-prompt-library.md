# Image Prompt Library

Per-surface prompt scaffolds for `media-manager` (design-elevation p3-prompts). Good prompts
compound; this file is where they stop evaporating.

**Rules of use**

- Start every generation from the matching scaffold below; substitute the `{...}` slots. Do not
  write prompts from scratch.
- After every run, append prompts that produced keepers to the surface's **Keepers** list (with
  the placed asset URL as the thumbnail reference) and add failed patterns to **Rejects**.
- All scaffolds inherit `docs/design-doctrine.md` §4: real product via `--ref-image` wherever a
  product is featured or linked; bright/high-key light; v3 palette; nothing a premium lingerie
  campaign could not run.
- **Provider note (2026-08-15, PR #692):** stills are Atlas-primary via `generateImage()` (Atlas
  `seedream-v4.5`/`seedream-v4.5/edit`, then fal, then Imagen); `docs/media-model-routing.md` is
  the single routing source, do not restate routing here. The fal-specific lore in this file
  (FLUX Kontext label garbling, the black-JPEG safety retry, known-garble products) applies on
  the fal fallback path, not to Atlas-primary generations.
- **`--ref-image` vs `--no-ref` by what the surface links to.** FLUX Kontext faithfully reproduces
  the product **label text** from the Shopify reference photo, which violates the no-text-in-pixels
  rule and, on a surface that links to a whole collection, also misleads by pinning one SKU's label.
  So: a surface that links to a **single product** uses `--ref-image` (the real product is the
  subject) **and** the prompt + negative brief must add explicit blank/unlabeled-surface language
  (see the §0-P note about legible label being the exception only where the real packshot is the
  point). A surface that links to a **collection or `/discover`** defaults to `--no-ref` with
  unlabeled bottles/forms — reserve `--ref-image` for single-product targets. This stops runs
  shipping or re-rolling label-text images on collection/discover surfaces (one wasted generation on
  the Discover promo, run 116).
- **Declare the archetype first.** Every generation names one doctrine §4 archetype before
  prompting — A hand-on-product, B color-block still, C in-situ bright scene, D metaphor
  macro — and uses the scaffold tagged with it below. **Ground lock:** backdrops only from
  coral-soft, plum-soft, and paper tints (doctrine §4; sage is an accent, never a ground); a
  scaffold's color slots resolve within that set.
- **The ground lock is a hue lock, not a surface lock** (doctrine §4.1, owner direction
  2026-08-11). Nothing requires a seamless studio backdrop: plum-soft as raw plaster and paper
  as a bare wall with a light bar across it are both inside the lock and both carry an hour, a
  texture, and a room. "Seamless" is no longer the default surface in any scaffold; a brief
  that wants a seamless sweep must name it. High-key constrains shadow **density**, not shadow
  **shape**: a hard-edged directional shadow on a bright wall is dramatic and fully high-key
  at once.
- **Mandatory negative prompt on every generation:** `no text, no words, no letters, no
  watermark, no logo, no caption, no gradient backgrounds, no plastic or clinical look, no
  housewares still-life, no tableware, no candles, no dim or candlelit scene, no distorted
  hands, no extra fingers`
- Maintenance cadence: pruned monthly (design-elevation ongoing cadence); rejects older than a
  quarter may be dropped once the pattern is folded into the scaffold text.

---

## Hero (block image, 4:5 or wide per block) — Archetype C (in-situ scene) or A (hand-on-product)

Scaffold (always with `--ref-image` = the hero product's Shopify photo):

> The {product} standing large and centered on a {coral-soft | plum-soft | paper} ground with
> a real surface and a named hour (bare painted wall, raw plaster, paper backdrop with a
> hard-edged window shadow raking across it; the ground lock is a hue lock, not a surface
> lock, doctrine §4.1), bright high-key lighting, crisp single shadow, premium DTC launch
> campaign photography, editorial and confident, product fills most of the frame, shallow
> depth of field, shot on medium format

Variations that keep it fresh: a hand entering frame to reach for the product; the product on a
plinth with one ♥-shaped physical object nearby (small, never overlaid).

**Keepers:** (append `prompt → placed asset URL` lines here after runs)

**Rejects:** dim boudoir scenes (retired July 2026); product tiny in frame on an empty styled
table (reads housewares).

## Rail card / Emma's edit (1:1) — Archetype B (color-block still)

Scaffold (always with `--ref-image`):

> The {product} bold and centered on a {plum-soft | coral-soft | paper} ground carrying an
> hour and a texture (painted wall, plaster, a light band across it; hue lock, not a surface
> lock), bright studio light, crisp shadow, square crop, product large in frame, premium
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

> The {product} on a {coral-soft | plum-soft | paper} ground with a real surface texture and a
> named hour (hue lock, not a surface lock) with {theme prop, small
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
> on a {coral-soft | plum-soft | paper} ground (hue lock, not a surface lock; give it an hour
> when the crop shows the ground), silk or linen surface beneath, bright
> high-key daylight, crisp focus on the product, skin tones natural and warm, premium
> sexual-wellness catalog photography, keep the product's shape, color, and finish exactly as the
> reference image

**Keepers:**

**Rejects:** (hand-anatomy failures go here; the vision gate hard-checks hands per doctrine §4)

## Social still (4:5, Instagram feed/grid): Archetype B or C, under the doctrine §4.1 interest floor

New section (ticket #2756): there was previously NO social still-life scaffold at all, which is
part of why a from-scratch prompt produced the housewares frame. Seeded from the narrative frames
validated against the interest floor on 2026-08-12. Every social still is briefed against
`docs/design-doctrine.md` §4.1 (the interest floor): the brief names, by number, at least four of
the ten properties it is buying, including at least one from the narrative group (P1 evidence of
a person, P2 interrupted state, P3 the unexplained second object, P9 a frame edge that implies a
bigger room), and a reviewer rejects on the count by number. The active campaign's locked visual
scheme (`docs/store-team/instagram-campaigns.md` §3) supplies ground, light signature, rhyme
prop, and cast reference; this scaffold never overrides a locked scheme.

Scaffold (`--ref-image` = the product's Shopify photo when a product is in frame; 4:5 portrait):

> Bright high-key editorial photograph, {named hour} sunlight from a window out of frame throwing
> one hard-edged directional shadow band across a {coral-soft | plum-soft | paper} {textured
> plaster wall | bare painted wall | paper wall with a light bar across it}, open detailed
> shadows, never black. The {product} {mid-interruption, not at rest, e.g. half out of its
> open drawer, charging cable still connected, resting where a hand just set it down}, keep its
> shape, color, and finish exactly as the reference image. One physical trace of a person from
> the worn or carried world ({a robe belt | a slip strap | a hair tie | one earring | a key},
> never kitchen or spa), {one element entering or exiting the crop: a cable running out of
> frame, a curtain edge, a shadow whose caster is off-screen}. Private sunlit room, premium
> sexual-wellness brand photography, tasteful and non-explicit. No tableware, no mugs, no cups,
> no bowls, no candles, no fruit, no napkins, no folded towels, no styled tabletop, no text, no
> words, no logos, not dark, not moody, not clinical, no gradient wall.

Run the §4.1 tests before offering a candidate: the one-second test, the story test, and the
withholding test (if what the frame withholds is a body or an act, kill the frame, do not soften
it). Reject by the §4.1 failure-taxonomy names (catalog-on-a-table, prop salad,
stock-photo-neutral, over-styled showroom). Retry rule: a second attempt drops exactly one
property, never all of them; the packshot is the third resort, never the second.

**Keepers:**

**Rejects:**

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

### §0-H two-reference scaffold: question + product co-primary (owner direction 2026-08-11)

**This scaffold supersedes the single-reference §0-H human scaffold above.** The old scaffold was
written for a single-reference world that ended when multi-reference compositing shipped
(2026-08-11), and its worked expressive slot ("sitting on the edge of an unmade bed, face turned
toward the window, tired and tender") is verbatim the mood-not-question failure the owner named.
Use this scaffold for every §0-H human hero. Binding rules live in
`docs/notebook-team/image-brief.md` §0-H: the subject stages the headline's QUESTION with the
post's embedded product held at co-primary scale; the question-to-gesture table; casting by
`castMember` slug (`maya`, `sofia`, `jade`, `priya`, `marcus`, `diego`, or Emma via
`singleton.editor`), no repeat within 5 consecutive human heroes; the Daylight Theater test (if
the frame got more dramatic because the light got darker it failed; if because the face got
louder it passed); the levity license and its bound; and the no-product fallback, whose reason
MUST be written into this file's keeper log, never left as a silent default.

Two references per generation: **reference 1** = the cast member's `referencePhoto` (the figure);
**reference 2** = a de-cartoned plate of the post's embedded product (its real Shopify photo,
packaging removed). `landscape_4_3`, 2 candidates:

> Bright warm editorial magazine photograph, soft directional window daylight, high-key, calm
> private sunlit room, tasteful and non-explicit. {The cast member from reference 1, described:
> age band, build, hair}, clearly adult, fully clothed in soft casual clothing, **holding the
> {product} from reference 2 in hand, large and co-primary with the face**, keep the product's
> shape, color, and finish exactly as reference 2. {Gesture from the §0-H question-to-gesture
> table, staging the headline's question, e.g. "product held up in one hand at eye level, head
> tilted at it, brow up, free hand palm-up asking the room"}, expression theatrically big:
> {reader emotion}, drama in the face and the hands, never in the light. {Optional, licensed:
> deliberate scale exaggeration of the held product when it stages the question, never on
> health-adjacent topics.} Coral-soft and plum-soft warmth in the light, white and warm-neutral
> surfaces, generous negative space in the {zone} for a title overlay. No children, no
> teenagers, no youthful ambiguity, no nudity, no bare torso, no sexual contact, no
> product-in-use, no uncanny faces, no warped features, no extra fingers, no mugs, no cups, no
> candles, no folded blankets, no towels, no text, no words, no logos, not moody, not dark, no
> candlelight, no orange, no amber, no gradient wall, not clinical.

Vision gate for this scaffold, on top of the §0-H gate above: reject a frame whose gesture would
fit any other post equally well (the swap test), and reject a missing product with no documented
reason in the keeper log. **No real-world-proportion reject**: deliberate scale exaggeration
under the levity license is compliant while shape, color, finish, and product identity stay
faithful to reference 2.

**Keepers:** (append `cast slug + product handle + gesture → placed asset URL` lines here; a
no-product hero MUST log its reason in its entry)

**Rejects:** `cast: none (roster gap, documented exception)` + Wicked Simply Timeless Water-Based
Personal Lubricant & Moisturizer 4oz (`wicked-simply-timeless-jelle`), "How Does Menopause Change
Sex, and What Helps?" (real-talk, † health-adjacent, content run 379). **Casting decision:** all
six approved `castMember` docs (`maya`, `sofia`, `jade`, `priya`, `marcus`, `diego`) present late
20s to early 30s per their `ageRange` field; none can be honestly rendered at menopause age from
their reference photo without contradicting the documented identity, and on a † topic an
age-wrong figure reads as a factual error rather than as wit. Per content-writer direction in
run 379 (2026-08-18; no owner was involved in this call): generated a standalone age-appropriate figure (woman presenting mid-50s, explicit adult age
markers: silver-streaked hair, visible laugh lines and crow's feet) instead of forcing a roster
slug. **This is a logged roster gap** — the six-member roster has zero coverage above early 30s;
a separate suggestion is filed for a 50s-appropriate cast addition. Gesture per the §0-H
question-to-gesture "Is this normal?" row: product held up in one hand at eye level, head tilted
toward it, brow up, free hand palm-up asking the room.

Three rounds, 5 candidates total (content-team daily image cap reached, all against the fal
Kontext dev fallback — `ATLAS_*` is not configured in this environment so the Atlas primary path
in `docs/media-model-routing.md` was unavailable; flagged for a config fix so future label-heavy
§0-H composites get Atlas's stronger reference fidelity instead of falling straight to Kontext).
Every candidate failed at least one hard gate check on close inspection:
- Round 1 (2 candidates): backdrop rendered as a dramatic amber/orange gradient wall with a
  visible sunbeam and hard directional shadow — hard ground-lock and light-register fail (doctrine
  §4 backdrops are coral-soft/plum-soft/paper tints only; no orange, no amber, no gradient wall,
  no golden hour). Candidate 1 also badly garbled the label ("Aqva ETE" nonsense in place of "Aqua
  Jelle").
- Round 2 (2 candidates, corrected prompt): label crisp on the primary brand lockup, correct
  gesture (candidate 2 nailed the free-palm-up-asking pose), correct age presentation — but the
  backdrop rendered as full-saturation coral (`#FF5A36`-strength) standing in as a background
  field rather than the pale `coral-soft` (`#FFE6DD`) tint the ground lock requires, and the fine
  print under "AQUA JELLE" stayed a garbled smudge on both candidates under 2x zoom.
- Round 3 (1 candidate, backdrop-only correction, explicit "pale, low-chroma, NOT saturated"
  language added): backdrop lightened to a salmon-pink roughly 60-70% of the way toward true
  coral-soft but still didn't land in the tint band on pixel sample (~(250,160,150) vs. target
  ~(255,230,221)), the gesture reverted to both hands cradling the bottle (lost the free
  asking-hand), and the fine print stayed garbled.
- A post-process attempt (BiRefNet cutout of round 2 candidate 2, recomposited onto a true
  coral-soft field) was tried and rejected: the cutout carried a visible coral color-spill halo
  baked into the hair/edge pixels from the original saturated backdrop, which reads as an obvious
  mismatched-recomposite artifact on a new lighter ground — worse than shipping the original.
**Conclusion:** no candidate cleared the gate. Held as a Sanity draft rather than publishing a
non-compliant hero; heroImage/heroImageAlt/imagePrompt were not set.

**Retry (content run 385, same post, image cap raised 5→50):** picked up from round 2's prompt per
content-writer direction in run 385 (the owner raised the image cap; the prompt-reuse call was the
routing agent's, not his), changing only the backdrop clause.

> **Scope note (added by content-writer, run 385):** rounds 4-7 below were generated against
> `wicked-simply-timeless-jelle`, which the post no longer embeds. Mid-retry the voice gate
> REVISEd that SKU on a card-vs-copy conflict (its catalog name is "Personal Lubricant &
> Moisturizer", contradicting the section's lubricant-vs-moisturizer thesis) and the embed was
> swapped to `sliquid-naturals-satin-personal-moisturizer`. So the backdrop and label findings
> below stand as reusable craft lessons, but the label-fidelity result is specific to the Wicked
> bottle and none of these candidates is usable as this post's hero. **Backdrop fix that worked, record for reuse:**
stop describing the ground-lock tint as "pale coral" (drifted saturated on rounds 2 and 3 above,
both times) — instead lead with "off-white paper wall" as the base noun and describe the coral as
only "the faintest warm blush mixed in, essentially white, not a colored wall," with an explicit
"NOT a colored wall" clause. This landed the backdrop cleanly within the ground lock (visibly
near-white/paper, no salmon, no saturation) on 3 consecutive rounds (6/6 candidates) once adopted —
treat "off-white with a whisper of X" as the standing phrasing for any pale-tint backdrop ask on
this or any scaffold, and stop asking for "pale {color}" alone. Label fidelity was also solid on
every one of these 6 candidates (WICKED / simply / timeless / AQUA JELLE all legible, matching the
reference) — fal Kontext dev can hold this product's label once the backdrop instruction stops
competing for attention with color-correction language.
- Round 4 (2 candidates, backdrop-only fix applied on top of round 2's exact prompt otherwise):
  backdrop fixed but Kontext dev returned a near-untouched product packshot on white — the human
  figure and gesture were dropped entirely on both candidates. Read as: a very long prompt
  front-loaded with hedging/negative color language ("if in doubt render lighter," a full paragraph
  of NOT-clauses before the human description) pushed this edit-style model toward a
  minimal-transform response instead of the requested scene rebuild. Fix: keep backdrop correction
  short (one sentence, no hex/RGB codes — Kontext dev does not appear to use them usefully and they
  may have contributed to the collapse) and keep the human/gesture description in its original
  early position in the prompt.
- Round 5 (2 candidates, shortened backdrop clause, structure otherwise matching round 2): human,
  age, gesture-adjacent pose, and label all returned correctly and the backdrop landed in-band —
  but framing came in as a tight headshot-plus-product crop on both candidates, cropping the frame
  before the second, free "asking" hand entered shot. Best candidates of this retry on every check
  except the explicit free-hand gesture.
- Round 6 (2 candidates, added explicit "medium shot, waist-up, show both hands" framing
  instruction): framing widened as asked, but the compound asymmetric gesture (one hand up with
  product, other hand separately open palm-up) did not hold — candidate 1 reverted to both hands
  cradling the single bottle with a big open grin (wrong gesture, wrong expression, both banned by
  the brief); candidate 2 duplicated the product into two bottles, one held up in each hand
  (product-identity failure, not just a gesture miss).
- Round 7 (2 candidates, simplified the ask to "right hand holds product near face, left hand
  empty and relaxed at her side in a small half-shrug," explicit "only ONE bottle" and "NOT
  smiling" clauses added): product duplication fixed, backdrop and label held, but the free hand
  dropped out of frame again on both candidates (cropped out this time rather than duplicated), and
  the expression came back as a warm closed-mouth smile despite the explicit "NOT smiling, NOT
  laughing" instruction on both candidates.
**Conclusion (updated):** across rounds 4-7 (4 rounds, 8 candidates, this retry only), fal Kontext
dev reliably solved backdrop, label, age presentation, and human presence, but never once produced
the brief's specific compound ask — one hand raised with the product at eye level AND a separate
free hand open palm-up "asking the room" AND a worried/quizzical (not smiling) expression — all at
the same time. It always sacrifices exactly one of those three: drops the second hand, duplicates
the product instead of differentiating the two hands' poses, or overrides the requested expression
with a pleasant default. This reads as a genuine capability ceiling of this route on compound
asymmetric-gesture instructions, not a prompt-wording problem — the wording was iterated four
distinct ways (long/hedged, short, framing-only, pose-simplified) with the same trade-off recurring
each time. **Recommendation:** this needs either (a) `ATLAS_CLOUD_API_KEY` configured so
`seedream-v4.5/edit` (the documented-primary, stronger-reference-fidelity route per
`docs/media-model-routing.md`) can attempt this composite instead of the fal Kontext fallback this
environment is stuck on, or (b) an editorial call on relaxing the sceneBeat's explicit second-hand
requirement for this product (accept a single-hand hold with a quizzical/inspecting expression as
passing the swap test, since the literal free-hand-asking staging is not reachable on the only
configured route). Held as a Sanity draft again rather than shipping a non-compliant hero;
heroImage/heroImageAlt/imagePrompt were not set this retry either. Spend this retry: 4 generations
@ 5 cents/round (2 images each) = 20 cents (8 images total).

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

**Keepers:** §0-H, "How Loud Are Vibrators, and How Do You Keep Things Quiet?" (real-talk,
content run 269). Feeling: divided attention, listening for a shared wall while trying to be
present. One Black woman in her mid-30s, fuller curvy build, natural afro hair, sitting cross-
legged on the edge of a made bed in bright warm daylight, head turned toward an open bedroom door
as if listening down the hallway, self-conscious/tired expression (not ashamed), fully clothed in
casual pink loungewear, deep warm-coral wall catching dramatic daylight streaks, no product in
frame (left out per the brief's own "if it risks reading as a product hero, leave it out" call —
raw/self-conscious topic, single-figure composition was strong enough alone). Diversity note: the
four most recent real-talk heroes before this ran a South Asian man 40s, a mixed-gender couple
40s, a woman early 40s, and a couple with a baby monitor — this run intentionally varied skin
tone, body type, and styling rather than repeating the light/young pattern the brief flagged.
2 candidates from one round, no regenerate needed: candidate 1 (head turned to the door, listening
posture) picked over candidate 2 (facing camera, ambiguous small object on the nightstand — too
close to the banned-object class to risk) →
`image-76dff57c00109b99d73db3cadd172923370a09c5-1200x896-jpg` (post slug not yet created in
Sanity at generation time; asset handed off to content-writer to set on `blogPost.heroImage`
directly).

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

3-Speed Tantus Original Bullet Vibrator (`3-speed-original-bullet-vibrator`), guides category
(no accent prop), product standing upright large in frame on white paper with warm diagonal
window daylight and a natural soft shadow, no props → keeper (post:
`how-do-couples-use-a-vibrator-together`, content-writer run 120). Ref image used the product's
**second** Shopify photo (plain chrome bullet, no blister-pack packaging in frame), not the first
(packaged) image — the packaging photo carries heavy printed brand copy that Kontext reliably
mangles (see failure class below); when a product's primary image is packaging-heavy, check for a
clean unpackaged shot among its other images before generating.

**Rejects (this run):** first choice of subject was the We-Vibe Sync Go Turquoise Couples
Vibrator (`we-vibe-sync-go-turquoise`) — its only product photo bundles box + product, so the ref
was cropped to isolate just the product before use. Two rounds both failed: round 1 produced a
faint invented cursive/logo squiggle embossed into the smooth teal silicone where the real product
has none (both candidates), plus one candidate with fully garbled invented script text on both the
vibe and its travel case; round 2 (prompt hardened with explicit "no engraved logo, no embossed
insignia, no signature" language) fixed the invented-mark issue on one candidate but the product's
identifying C-shape was lost entirely (rendered as a generic teal egg, not ref-matched), while the
other candidate re-invented legible "We-Vibe / Sync Go" lettering. Read as: Kontext dev struggles
to hold both this product's curved silhouette AND a blank (unlabeled) surface at the same time —
it fills the "expected" logo/text real We-Vibe products carry with an invented mark, or gives up
the shape to make room for one. Switched subject to the Tantus Bullet (simpler geometry, genuinely
unbranded in its second photo) rather than spend a third attempt on the same product — the brief
explicitly allows choosing whichever embedded product gives the strongest frame.

Lovense Lush 4 Bluetooth Egg Vibrator (`lush-4-bluetooth-remote-controlled-egg-vibrator`), guides
category, **no generation attempt made** — short-circuited straight to the real Shopify/Nalpac
photo per the label-heavy rule. This product's only available photo (and the same is true of its
Lovense siblings Ferri and Diamo — checked all three before choosing) bundles the naked device with
a large printed "LOVENSE / Closing the Distance / {product name}" pink retail box and, on Ferri/
Diamo, a busy phone-app screenshot too; there is no clean unpackaged shot in the library the way the
Tantus Bullet had one. Rather than spend a Kontext attempt that would almost certainly bake garbled
box/app-UI text into the scene, isolated the naked device from the existing packshot with a plain
pixel crop (no AI): the box's right edge sits at a consistent x≈622 on the 1000×1000 source, so
`extract({left:625, top:510, width:375, height:440})` cleanly isolates the unboxed device on its
existing white background with zero box or screenshot bleed, then centered on a fresh 1200×900 white
canvas at 1.7x scale (`resize(639,750)`, composite at `left:280, top:75`) for generous negative
space. Zero generation cost, passed the vision gate on inspection (bold hot-pink product large in
frame, reads clearly at 375px, real photography so no uncanny-artifact risk, tiny embossed real
"LOVENSE" wordmark on the tail is illegible at hero scale and is real texture, not invented text) →
`image-2e644edc38e33c5331b0644a7458820b27c47521-1200x900-jpg` (post:
`how-do-app-controlled-vibrators-work`, media-manager run for content-writer run 186). Precedent:
apply this same box-edge-crop technique to any Lovense app-controlled product hero (Ferri, Diamo,
and the wider Lovense line all ship the same box+device±phone packshot template) instead of
spending a Kontext attempt on it.

We-Vibe Chorus Pro Satin Black couples vibrator (`we-vibe-chorus-pro-satin-black`), guides
category, **Kontext generation failed twice, fell back to a real-photo crop-compose** (post:
`best-app-controlled-vibrators-for-couples`, content-team run 252, media-manager). This product's
only Shopify photo is a box+device composite (same template as We-Vibe Sync O/Sync 2 — the whole
line ships this way), so the device+remote group was first isolated from the box with a plain
pixel crop (clean cut at x≈645 on the 1000×1000 source keeps the printed box copy out of frame)
and that crop uploaded to Sanity as a `--ref-image` for Kontext. Round 1 (2 candidates): one
rendered the ring warped/twisted away from the reference geometry plus a stray invented white
icon-mark on the remote; the other baked a hallucinated rabbit-shaped emblem with garbled sub-text
onto the device body — the exact "fills the expected logo/text real We-Vibe products carry with an
invented mark" failure the Sync Go entry below documents. Round 2, prompt hardened further
("PERFECTLY PLAIN UNMARKED SILICONE... no logo, no wordmark, no emblem, no icon, no animal shape,
no engraving... do not distort, twist, fold, or warp the ring shape", second object/remote dropped
from the ask entirely): fixed the invented-mark problem on both candidates but lost the product's
identifying C-shape in both, rendering a generic closed ring/tire shape instead — same tradeoff
pattern as Sync Go round 2. Two failures → stopped generating per doctrine and used the real photo
instead: isolated the device+remote group (clean box-free crop verified at `(645,492)-(995,825)`
on the 1000×1000 source), background-keyed to a tight alpha mask, scaled ~2.3x with
`ImageFilter.UnsharpMask(radius=2, percent=130)` to counter upscale softness, composited onto a
fresh 1200×900 white canvas with a soft synthetic floor shadow (blurred offset mask, ~15% opacity)
and generous margin on all sides. Zero generation cost. Passed the vision gate on inspection
(unmistakably the real product, reads clearly at 375px, no invented marks since it's real
photography, small embossed "we-vibe" wordmark visible on the device is real product texture at
illegible scale, not invented text) →
`image-10e8b855e3463dcbaa0e59dd518042534f6452f6-1200x900-jpg`. **Precedent:** the whole We-Vibe
Sync line (Chorus Pro, Sync O, Sync 2 confirmed, likely Sync/Nova too) ships only the box+device
composite photo and triggers this same invented-logo/lost-shape Kontext failure — apply the
box-free-crop-then-real-photo-compose fallback directly for any of them rather than spending two
more generation attempts re-discovering the same result. Checked the Shopify CDN URL directly
(not just the Sanity cache) to confirm no higher-resolution source exists for this product — both
resolve to the identical 1000×1000, 90538-byte file.

**Tooling gotcha (not a prompt reject, a call-site bug):** on the `naturals-h2o` run, calling
`generateImage()` directly (not through `gen-notebook-art.ts`, which has no `hero` surface) with
`imageSize: { width: 1200, height: 900 }` silently produced a 16:9-ish 1392×752 frame — the
Kontext path in `fal.server.ts` only maps the fal `image_size` **string enum**
(`landscape_4_3` → `4:3`) to `resolution_mode`; an explicit `{width,height}` object falls through
to the `16:9` default for the ref-image (Kontext) code path specifically. Always pass
`imageSize: 'landscape_4_3'` (the string) for this surface, exactly as the scaffold above already
says — never a `{width,height}` object when `refImageUrl` is set.

## Panel square tile (1:1, deck square row): Archetype B (product cutout still)

Deck squares are product cutout stills on the tile's own tint ground (owner decision 2026-07-29:
Archetype B on the 4 squares, richer photo reserved for the large panels). Scaffold (always with
`--ref-image` = the product's Shopify photo; `--doc-id singleton.panelDeck`):

> The {product} as a clean single-product cutout still, bold and centered on a flat solid
> {coral-soft | plum-soft | paper-2 | paper-3} tint ground matching the tile, soft even
> studio light, one crisp shadow, square crop, generous negative space around the product, premium
> sexual-wellness catalog photography, single product only, no text, no words, no letters

The tile's label is typeset by the site, never in the image. One product per tile; the glyph marks
are the empty-state fallback, never a layer on top of a photo.

**Keepers:**

**Rejects:** multiple products in one square; props competing with the product; any tint outside
the ground lock.

## Panel large — art zone (42% column, deck large row): abstract composition from a product

**`--image-size` is mandatory on every deck generation.** The CLI defaults to `landscape_16_9`,
and a 16:9 source dropped into a portrait art zone under `object-cover` loses most of its width, so
a brief composed for a tall slot comes back cropped to nothing with no error anywhere. Pass
`--image-size portrait_4_3` for this surface.

There is no wide image slot on this panel. `PanelLarge.tsx` renders exactly one image, into the art
zone: 42% of the panel's fluid width against a fixed 240px height, so the aspect swings with the
viewport (≈0.89 at 375px, ≈0.55 at 768px, ≈0.77 at 1024px, ≈1.03 at 1320px), all center-cropped.
`portrait_4_3` sits near the middle of that range. Compose vertically and keep everything that
carries the idea inside the central half of the frame width.

**The art zone always bleeds to the card edge. Never an inset plate inside the rectangle**
(owner direction 2026-07-30).

**Brief an abstract composition built out of a real product, not a packshot.** This is the rule that
makes a bleed work on any ground, and it was arrived at the hard way (see Rejects). A packshot brings
a backdrop with it, and a backdrop in a full-bleed zone butts against the card as a visible plane. An
abstract composition — hard-edged colour fields, an extreme macro, a form cropped by the frame edges —
has no backdrop at all, so the boundary reads as a crop.

- **Light ground: ground-match.** Build the composition on the panel's own tint (`blush` →
  coral-soft `#FFE6DD`, `lilac` → plum-soft, `stone` → paper-3, `paper` → paper-2) and the seam
  disappears completely. Same "one ground per tile" trick `PanelSquareRow` documents.
- **Ink ground: let the composition carry its own dark passages.** Ink is the only panel where
  ground-matching is impossible, because the ground lock holds no ink-adjacent tint. Do not solve it
  by darkening the backdrop — that is the near-black look §4.3 retires. Solve it by giving the frame
  internal geometry and a dark subject: on-lock tints become graphic *fields inside* the composition
  rather than a ground behind a subject, and a dark product anchors it.

> Abstract editorial art photograph, bright and high-key, shot like a luxury campaign, confident and
> tasteful, non-explicit. TALL VERTICAL PORTRAIT COMPOSITION THAT FILLS THE ENTIRE FRAME EDGE TO EDGE
> WITH NO EMPTY BACKGROUND ANYWHERE. {A hard-edged geometric collage of overlapping flat colour
> fields, broad blocks and diagonal bands of {coral-soft | plum-soft | paper}, each band running off
> the edges of the frame | An extreme close crop of the {product} so close it reads as pure
> sculptural form, its curves swelling across the whole frame}. {The {product}, ENORMOUS AND CROPPED
> BY THE FRAME EDGES, running the full height of the composition; keep its shape, colour and finish
> exactly as the reference image, every surface completely blank and unprinted}. {Optional: one
> length of sage-green SATIN FABRIC RIBBON, clearly cloth with visible folds and a soft sheen,
> sweeping across the frame as a single curved line and running off both edges}. Flat graphic light,
> crisp edges, no vignette, no gradient, no colour wash, no seamless studio backdrop, no visible
> tabletop, no horizon. Hyper-real material rendering, tack sharp, one idea in the frame.

Negative tail, on top of the mandatory list: `no empty background, no small object in a large empty
frame, no drop shadow on a seamless backdrop`

**Keepers:** Black Tie Affair Mini Wand (`tie-affair-mini-wand`, bare-product ref `99256B.jpg`) as a
matte black form laid on a diagonal across flat lilac and cream collage fields, filling the frame →
`image-373cf25f931b54317a762fdc64e6a4b4009f4b13-880x1184-jpg` (`lg-discover`, ink ground: the
first brief in four that held on an ink card).
Adam & Eve Lilac Licks (`adam-eve-lilac-licks`, bare-product ref `96203B.jpg`) as an abstract close
crop with a sage satin ribbon spiralling through the frame on a ground-matched coral-soft field →
`image-8c0d886282f96208eede8f71845d6ecb57d81fd1-880x1184-jpg` (`lg-new`, blush ground: the seam
dissolves entirely).

**Rejects:** the in-situ private-room scaffold this section used to carry (it briefed a wide photo
into a slot that has no wide photo). Any landscape composition (the crop eats it). **And the whole
packshot-on-a-ground family for the ink panel, retired 2026-07-30 after four rounds mocked at 375px:**
a full-strength lavender ground sat well against ink but left the §4 ground lock; correcting it to
near-white on-lock read as a glaring pale plate glued on the ink card; "fills the frame" crop
language on the same brief was ignored by Kontext, which dropped the ribbon instead; and an extreme
macro with no backdrop killed the seam but landed squarely in the retired near-black moody look. The
generalisable lesson is in the scaffold above: on ink, brief an abstract composition, not a subject
on a ground.

## Panel small — art zone (deck small row, renders at ~64px): abstract product macro

Owner direction 2026-07-30 replaced this surface's "no imagery" rule. The small rows now carry a
**full-bleed art zone** on the same copy-zone/art-zone split as `PanelLarge`, so the label keeps the
flat ground and text never sits on photography. Generate at `--image-size square_hd` (the zone is
roughly 1:1 at 375px, ~1.25 at `md`).

**At ~64px an image is a silhouette and a colour. Nothing else.** One bold simple form, reading
instantly at thumbnail size, no fine detail and no small parts. Pick the reference on silhouette
legibility before anything else: rings, forks, and blocky symmetrical forms survive; slim or busy
objects do not. Ground-match to the row's own surface (`stone` → paper-3, `paper` → paper-2).

Sale keeps its quiet, which is the part of the old rule that was always load-bearing: paper ground,
never coral, and no urgency shapes at all (no clocks, no bursts, no percentage marks). A discount
door with the same visual weight as the category doors trains discount-shopping on a brand
positioned on curation — a third of a 64px row is not that weight, a full tile would be.

> Abstract editorial EXTREME MACRO photograph, SQUARE CROP, bright high-key, calm and restrained.
> THE SUBJECT COMPLETELY FILLS THE FRAME EDGE TO EDGE WITH NO BACKGROUND VISIBLE. Shot so close that
> the {product} reads only as abstract form: {one smooth curved section sweeping through the frame |
> a form splitting into two rounded tips}, reaching off all four edges. Keep the exact colour and
> finish of the reference image. The visible surface is COMPLETELY SMOOTH, BLANK AND UNMARKED. ONE
> SINGLE BOLD SIMPLE FORM ONLY, reading instantly at thumbnail size, no fine detail, no small parts.
> Soft even light raking across the material, one gentle shadow, no vignette, no gradient, no colour
> wash, no seamless studio backdrop, no visible tabletop. Hyper-real material rendering, tack sharp.

Negative tail, on top of the mandatory list: `no molded text, no embossed text, no engraved
characters, no compliance markings, no CE mark, no UKCA mark, no symbols, no icons, no buttons, no
control panel, no busy detail, no empty background`

**Keepers:** Emperor Rechargeable Vibrating Ring (`renegade-emperor-vibrating-ring`, ref
`83082_c65c89a2....jpg`) cropped to one smooth teal arc →
`image-dcf693da8b7c2cb3ea1bb5872fc953839e9b060b-1024x1024-jpg` (`sm-sale`).
Crave Duet Flex (`crave-duet-flex-black`, ref `A00476A.jpg`) cropped to the black fork →
`image-3eaa7b43b54ae557fade5eeef27ce8f0db83f4cd-1024x1024-jpg` (`sm-notebook`).

**Rejects:** the `ink` ground this section used to offer — **ink is not in the §4 ground lock**, and
the doctrine outranks this file. Busy compositions; more than one subject; coral on the Sale row.
**Moulded lettering carried in from the reference photo:** the first Sale round came back with the
ring's `CE`/`UKCA` compliance characters legible in frame, which is text in the pixels (§4.4).
Kontext faithfully reproduces any lettering moulded into a product, so crop past it and negative-
prompt it explicitly. **A literal notebook on the Notebook door:** §4.3 and the mission brief name
notebooks by name in the retired housewares class, so the one door called Notebook is the one door
that must not show one — brief a designed object with a legible silhouette instead.

## categoryMasthead (wide, per category page): archetype per the lock table below

Each category page's masthead is locked to an archetype (doctrine §4). Private space + human
presence per the collection-imagery rule; never housewares. Scaffold (always with `--doc-id
categoryPage-<handle>`; `--ref-image` whenever the masthead features a product):

| Category | Archetype lock | Subject direction |
|---|---|---|
| pleasure | **B** product still | Hero product bold on a tint ground, cutout-still discipline |
| play | **A** intimate scene | Hands on product, playful tension, private-space setting |
| body | **B/D** texture and product | Product plus macro texture (skin, silicone, water) |
| wear | **A/C** fabric and human presence | Lingerie or wear on a body, private room, daylight |
| discover | **D** editorial collage | Metaphor macro or editorial composition, curiosity-forward |

> {Per the category's lock row above: subject direction}, bright high-key daylight, {coral-soft |
> plum-soft | paper} ground where a ground applies, private-space setting with human presence
> where the lock calls for it, editorial premium campaign photography, tasteful and non-explicit,
> generous negative space in the {zone} for the site-set masthead type, no text, no words, no
> letters

**Keepers:**

- play (A): "A pair of hands gently stretching the black satin eye mask blindfold from the
  reference image between them, playful tension, resting over completely plain rumpled white
  bed linen, warm high-key daylight from a window ... every surface completely blank and
  unprinted" → `8d79412e19294fb4623e27be10ca0757989e37ed` (2026-07-29). The "every surface
  completely blank and unprinted" clause is what stopped an invented brand mark from filling
  the negative space.
- body (D): "Macro editorial photograph of two gentle hands resting on a bare shoulder and
  upper back, the skin soft with a warm healthy glow that catches bright high-key daylight,
  soft coral warm tones ... no bottle, no packaging" → `a061fcc2dfc62c38cdba337338378fa72f3d0bfc`
  (2026-07-29). No-ref with reason: lube/oil labels fail the no-text rule, so the masthead
  shows the act.
- wear (A/C): "A woman wearing the black lace lingerie set from the reference image,
  photographed from behind, framed from shoulders to waist ... bright warm white bedroom with
  sheer curtains, quiet confidence" → `971f7753a11149b3362e8b7a869714d3e10cfd33` (2026-07-29).
  The back view is the reliable path to tasteful human presence for wear.

**Rejects:** an archetype off the category's lock row; housewares still-lifes; empty rooms;
invented brand marks materializing in the negative space (2026-07-29, play — demand "every
surface completely blank and unprinted" in the prompt, not just the no-text negative tail);
full-figure posed pin-up on a bed for wear (2026-07-29 — reads stock glamour, off the v3
palette; crop tighter or shoot from behind); "no face visible" torso-crop phrasing (2026-07-29 —
fal returns content_policy_violation on headless-body wording, and the Imagen fallback is dead
with billing disabled; say "photographed from behind" instead).

## dropMasthead (wide, New / Sale pages): Archetype B or C, no urgency shapes

Drop mastheads state a calendar fact visually, never manufacture pressure. **Hard ban on urgency
shapes: no clocks, no countdown motifs, no starbursts, no burst badges, no ticking or timer
imagery of any kind.** Sale takes the quiet treatment (paper-3 ground, restrained). Scaffold
(`--doc-id dropPage-<routeKey>`; `--ref-image` when a real arriving product leads):

> {The newly landed {product} bold on a {coral-soft | plum-soft | paper} ground | a quiet
> restrained still on paper-3 for Sale}, soft even studio light, one crisp shadow, calm and
> confident, premium campaign photography, nothing hurried in the frame, no clocks, no countdown
> motifs, no starbursts, no burst badges, no text, no words, no letters

**Keepers:**

- new (B): "Take only the lilac silicone vibrator out of the retail packaging in the reference
  image and photograph the bare product itself, standing bold and centered on a very pale
  blush-pink near-white seamless studio backdrop, no box, no packaging, no card" →
  `f4e7bcd4d7432dc2a6fef58f964747b23c741adc` (2026-07-29). Kontext reliably lifts a product
  off its packaging card when told in exactly these terms.
- on-sale (B, quiet): "resting on its side on a quiet warm off-white paper seamless backdrop,
  restrained and calm, soft even studio light, one soft shadow, understated ... no discount
  drama" → `a15cf616d2b07ef46159aa00d04cfc8c8db4dcf5` (2026-07-29).

**Rejects:** any urgency shape (see the ban); discount-led visual drama on Sale; coral shouting on
the Sale masthead.

## Shelf cards (category page shelves): no generated art, ever

Shelf product cards on category pages render the product's real Shopify packshot, exactly like
`emmaCuratedRail` cards on the homepage. **Never generate art for a shelf card.** There is no
scaffold because there is no generation; if a shelf product's packshot is broken, flag it for
`product-manager` data hygiene rather than papering over it with generated art.

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

**Known-garble products (default straight to the real-photo fallback, do not
spend a Kontext round):** We-Vibe Sync Go Turquoise Couples Vibrator
(`we-vibe-sync-go-turquoise`, see the §0-P Notebook rejects above); Magic Wand
Mini HV-135 Rechargeable Massager (`magic-wand-mini-hv-135-rechargeable-massager`) —
with `--ref-image` pointed at the real Shopify photo, Kontext reproduced the
product's shape, color, and silhouette correctly but garbled its small "magic
wand MINI" wordmark into illegible invented cursive, and the garble persisted
even with an explicit blank-surface negative prompt. Same failure class as
We-Vibe Sync Go: Kontext cannot hold product shape and a blank product surface
at the same time on branded bodies. Any branded-wordmark product should default
to the real-photo fallback path rather than attempt Kontext.

---

## Instagram carousel — cast + product compositing (License B/C)

Not a homepage surface, but the same multi-reference compositing pattern belongs here so it
isn't re-discovered from scratch. Route: `composeSceneFrame()` in `app/lib/fal-video.server.ts`
(now takes an optional `aspectRatio` param, default `'9:16'` for its original video-frame
use, plus `extraImageUrls` for references beyond presenter/product — pass `'4:5'` for a
feed/carousel still). `image_urls` order does not matter to the model.

**Update (2026-08-15, Atlas migration, PR #692):** the primary route for cast + product
composites is now ONE-STAGE Atlas `bytedance/seedream-v4.5/edit` via `generateImage()` (and the
`composeSceneFrame()` successor once the `atlas-composite-port` ticket lands). The Atlas POC
passed the cast-presenter + insertable-toy reference pairing that nano-banana 422s on, twice,
with exact product geometry and true 4:5 output; see `docs/media-model-routing.md` for the
routing table and evidence. The two-stage plate + composite below remains the fal FALLBACK path
and the video-frame path until that port lands. The nano-banana content-policy fence and the
black-JPEG retry lore apply only on the fal fallback path.

**Model note (2026-08-10):** the run below was on `fal-ai/nano-banana/edit`. That fal path has
since been replaced by the two-stage plate + `fal-ai/flux-2/lora/edit` composite (see the
bake-off notes at the top of `fal-video.server.ts`), which was adopted precisely because
nano-banana's non-configurable safety filter blocked much of the catalog. The fal fallback
route has in turn been superseded as primary by the one-stage Atlas route above. Read the fence
below as a record of why the swaps happened, not as a live constraint on the current route.

**Hard content-policy fence (verified 2026-08-09, 4 independent prompt variations, all failed
identically):** `fal-ai/nano-banana/edit` 422s with `content_policy_violation` on the *pairing*
of a human reference photo (any `castMember`) with an insertable-toy product reference (tested:
b-Vibe Essential Vibing P-Spot Plug, both the retail box and the bare product shot), regardless
of prompt wording — a maximally generic prompt ("a smiling man holding a small teal item") still
failed. The same product image alone (no human reference) composites fine. This reads as an
image-content classifier on the reference pairing, not a text filter, so no prompt rewrite
routes around it. **Do not spend more than one retry on a cast+insertable-toy composite** — stop
at the fence and fall back to a cast-solo frame (no product in shot) or a product-only scene
frame, per the two-failure gate. Flag the concept change to the caller rather than silently
downgrading the brief.

**fal's `aspect_ratio: '4:5'` on nano-banana/edit returns 896x1152 (0.778), not 1080x1350
(0.8)** — same under-ratio drift as the flux_dev black-JPEG note above, and it will get an
Instagram carousel image rejected as taller-than-4:5. `composeSceneFrame()` now sends explicit
pixel dimensions (1080x1350 for `'4:5'`) rather than a ratio string, which removes the drift on
that route. Any other caller that still passes a ratio string should center-crop-then-resize
every candidate to exactly 1080x1350 before the vision gate and before upload; don't trust the
returned dimensions.

**Keepers (2026-08-09, owner-requested "p-spot arc" carousel, product handle
`essential-vibing-p-spot-plug`):**
- Frame 1 (metaphor, archetype D, flux/dev text-to-image, no ref): "Overhead macro editorial
  photograph of a single fresh ripe purple fig sitting whole on a warm neutral linen surface,
  soft natural directional daylight from one side, gentle shadow, shallow depth of field,
  elegant food-editorial still life composition, warm bright color grade, high-key light... one
  piece of fruit only, no other objects, no product, no hands, no people." Passed gate clean,
  reads as a deniable food still life at a glance.
- Frame 2 (cast solo, archetype C, nano-banana/edit, presenter ref only): castMember reference +
  "waist-up... playfully confused, eyebrows raised, both hands raised palms-up..., mouth
  slightly open like mid-laugh-question... plum-soft lavender-pink studio backdrop." Passed
  clean; hands anatomically correct at first attempt.
- Frame 4 (scene, archetype C, nano-banana/edit, two product refs, no presenter): plug product
  photo + lube bottle photo + "open wooden nightstand drawer, darker walnut wood, three-quarter
  high angle looking down, small folded cloth, unlit candle on the nightstand top, warm daylight
  through a window off-frame." Label on the lube bottle reproduced legibly and undistorted; this
  is the one archetype-C scene where a labeled bottle survives compositing, because it's the
  product-only path (no human reference) rather than Kontext single-ref on a label-heavy hero.

**Reject:** Frame 3 (cast + product together) — see the hard fence above.

---

*Seeded 2026-07-17 from the doctrine §4 directives and the mission-brief §2 image rules.
Owner: `media-manager` (append keepers/rejects each run); pruned monthly.*
