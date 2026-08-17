# The Notebook — Image Brief (for `media-manager`)

> Generation brief for every art surface in the Notebook redesign. Follows the house imagery
> doctrine and the standing merchandising image rules: bright, warm, editorial, product-led or
> product-in-context, never clinical, never near-black or moody, never domestic metaphor objects
> (no tea cups, ceramic bowls, mugs, folded blankets or throws, towels, notebooks-as-tile-art, or
> the July 2026 failure classes — see §0). Age gate and content
> policy bind every asset: suggestive of use and sensation is fine, explicit or anatomical is not.
> Reuse-first: check `media-manager`'s existing library and the product's real Shopify photography
> before generating; ref-image-first for anything product-specific. Every generated asset passes
> the vision gate before upload (product/context match, bright not moody, palette-compatible, no
> uncanny artifacts, tasteful).

Companion files: `notebook-art-direction.md` (governs where each asset lands and the category
color map) and `hifi-reference.html` (placeholder blocks show composition and crop intent).

---

## Global art direction (applies to every surface)

- **Palette.** White paper base (`#FFFFFF`). Warm coral family (`#FF5A36`, `#FF7A5A`, `#FFE6DD`),
  plum (`#7A2BB8`, `#F3E8FB`), sage (`#7C8F78`, `~#ECF0EA`), warm neutral paper tones
  (`#FAFAF9`, `#F4F3F1`). No orange (the retired brand color), no cream (`#FAF4EA` and its family
  are gone), no cold greys, no black backgrounds. Highlights read as daylight, not studio strobe.
- **Light.** Bright, soft, directional daylight. Warm side light with gentle falloff. Think
  window light in a sunlit room, not a product lightbox and not a moody bedroom.
- **Mood.** Editorial magazine, warm and unembarrassed. Curious and calm, never coy, never
  clinical, never porn-adjacent. A confident friend's coffee-table magazine.
- **Subject.** Product-led, product-in-a-warm-human-context (hand, bedside, fabric, plant,
  soft light), or an expressive human figure per the §0 hero router. Faces are allowed and
  welcome (owner directive, 2026-07-28: more faces help customers feel seen); the former
  crop-faces-out rule is withdrawn for Notebook surfaces. Never explicit anatomy, never a full
  nude figure, and **never a person who is or could read as a minor** — every depicted person
  is unambiguously adult (see §0 hard rules).
- **Composition.** Generous negative space on the paper base so type and chips can overlay
  cleanly. Leave a quiet zone in the crop where the art-direction doc places a title or chip.
- **Texture.** Subtle grain acceptable for editorial warmth; keep it light. No heavy filters, no
  vignettes that darken corners toward black, no lens flare.
- **Banned, restated.** Domestic metaphor objects as the subject — tableware and kitchenware
  (cups, mugs, bowls), household textiles (folded blankets, throws, towels, pillows), candles,
  flowers-as-subject, notebooks/stationery as literal props, and any other home-goods stand-in for
  the topic. The test is a class test, not a list test: **if the frame would sit comfortably in a
  home-goods catalog, it fails**, whatever the object is. Also banned: near-black or heavily
  shadowed frames, clinical white-coat/medical staging, cold minimalism, gradients in the old
  orange, uncanny hands or warped objects, any readable invented text in the image. Fabric, light,
  and bedside surfaces are welcome as *setting* around a product; they are never the subject.

**Prompt scaffold shared prefix** (prepend to every per-surface prompt):
> Bright warm editorial photograph on a pure white paper background, soft directional daylight,
> magazine art direction, calm and unembarrassed mood, coral / plum / sage / warm-neutral palette,
> generous negative space, tasteful and non-explicit, no text, no tableware, no clinical staging,
> not moody, not dark.

Post-process for the surfaces that carry type overlay: light coral/plum wash gradients are
composed in CSS at build time (see the `.ph--*` blocks in the hi-fi), so generated art should be
clean imagery, not pre-baked with brand-color overlays unless a surface below says otherwise.

---

## 0. Daily post hero — `~1200 × 900` (one per post; the highest-volume surface)

**Role.** The `heroImage` on every Notebook `blogPost`. The daily content routine requests one of
these per post, which makes it the single most-generated surface in the system — and the surface
where every houseware failure to date has shipped (July 2026: tea cups on bedsheets; paired
folded throw blankets). This section is binding for it.

### The hero router (owner-codified 2026-07-28)

The post's **publishing category** decides the hero archetype. The category is assigned by the
weekday slot before the topic is picked, so the router needs no judgment call and cannot be
gamed by a per-post "sensitivity" claim:

| Category | Hero archetype |
|---|---|
| `guides`, `comparisons`, `care`, `wellness-basics` | **Product hero** (§0-P below) — the article is about a product |
| `real-talk`, `podcast-notes` | **Human hero** (§0-H below) — the article is about human things |
| Any category with zero product embeds | **Human hero** (nothing to be product-forward about) |

### §0-P. Product hero (product articles)

Desire-forward staging first, product second: the frame sells the anticipation the product
serves, with the product as the unmistakable subject.

- **Subject.** One of the post's own embedded in-stock products
  (`blogProductEmbed.productHandle`), placed via its **real Shopify product photo passed as the
  reference image** (FLUX Kontext / `--ref-image` path), shown boldly and large in frame.
- **Staging.** Desire-forward per the charter's imagery register (sensory anticipation, texture,
  warm light, the moment before), capped at the charter's visual 6-7. Never product-in-use,
  never bodies in sexual context. Where a post genuinely has no product embed the subject is the
  topic's product family, same treatment. Never an object metaphor.
- **Surreal option (doctrine archetype E, owner license 2026-07-28).** A product-article hero MAY
  go surreal/witty instead of straight staging: blended forms, euphemistic still lifes, visual
  puns built around the post's product category (see the archetype E scaffold in the prompt
  library). Witty never crude; ground lock and warm light still bind; never on † health-adjacent
  topics, which keep sincere staging.
- **Fallback.** The product's real Shopify photo cropped editorially.

### §0-H. Human hero (human-experience articles)

Rewritten to the owner's direction of 2026-08-11 (all-hands, verbatim): *"the image did not
match the context of the post... she is asking a question, so show her in a dramatic way. Put a
product in her hand that is also in the post. They need to make sense or no one is going to be
curious enough to read them and click on the products to buy them... Use the cast, use Emma to
show an emotion that relates to the post."* The previous version of this section directed a
mood; a mood is not enough. The subject of a human hero is the headline's **question**, staged.
These remain hyperbolic, editorial, openly-fictional images, a means of expression, not a
lived-experience claim (owner ruling, 2026-07-28). Emma's *written* no-lived-experience rule
is unchanged; images are expression, words are claims.

- **Subject: a person staging the headline's QUESTION, holding the post's product at
  co-primary scale.** The figure is visibly asking, weighing, or confronting the specific
  question the headline asks, and holds the post's own embedded product
  (`blogProductEmbed.productHandle`) in hand, co-primary with the face: person and product
  share top billing, the product is in the hand, not parked on a nightstand. Headline,
  gesture, and product must make sense together as one post. The swap test binds: if the
  frame could be moved onto any other post and nobody would notice, it fails.
- **Question-to-gesture table.** Match the gesture to the shape of the headline's question;
  drama lives in the face and the hands (see the Daylight Theater register below).

  | Headline question shape | Gesture direction |
  |---|---|
  | "Is this normal?" / "Is it just me?" | Product held up in one hand at eye level, head tilted at it, brow up, mid-question; the free hand palm-up, asking the room. |
  | "Which one?" / this-or-that | Product in one hand weighed against the open other palm like a scale, eyes moving between them, undecided on purpose. |
  | "How do I even start?" | Product held out at arm's length in both hands, leaning back from it, wide-eyed, reading it like instructions in a language she almost knows. |
  | "Will it hurt / is it safe?" | Product held close with both hands, shoulders up, a hopeful wince straight to camera. |
  | "How big / how loud / how much?" | Product held up beside the face for scale, jaw dropped, staring at it sideways (scale exaggeration licensed per the levity license below). |
  | "Why does nobody talk about this?" | Product brandished like the exhibit in an argument, the free hand thrown up, mid-sentence face. |

- **Casting: the approved roster, named by slug.** Casting draws from the live, approved
  `castMember` docs in Sanity, each of which carries a `referencePhoto`: `maya`, `sofia`,
  `jade`, `priya`, `marcus`, `diego`, plus Emma (canonical photo: Sanity `singleton.editor`).
  The brief and the keeper log name the cast member by slug. No member repeats within 5
  consecutive human heroes. Diversity is deliberate: vary age, body type, and skin tone
  across posts so "feel seen" is real, not twelve variations of one 25-year-old.
- **Emma in frame (owner ruling 2026-08-11, verbatim):** *"It's fine to show emma with
  products in hand. She's not claiming to be using them, she's just showing them."* Emma is
  licensed in frame holding the post's product and showing the emotion the post is about.
  Only depicting her USING it, or implying she has tried it, stays banned. There is no
  Emma-only-in-guide-mode restriction.
- **Two-reference compositing.** Every human hero composites two references: the cast
  member's `referencePhoto` as the figure reference plus a de-cartoned plate of the post's
  embedded product (its real Shopify photo, packaging removed), per the two-reference
  scaffold in `docs/homepage-team/image-prompt-library.md`. The product's shape, color, and
  finish stay faithful to the plate.
- **Register: Daylight Theater.** Expression plays theatrically big while the light stays
  bright and warm. The binding test: **if the frame got more dramatic because the light got
  darker, it failed; if because the face got louder, it passed.** Drama lives in the face and
  the hands, never in the light; the warm-light lock is unchanged. Sad, tired, pensive,
  longing, overjoyed, shocked: all licensed, inside the warm-light lock. No near-black, no
  boudoir gloom.
- **The levity license (owner ruling 2026-08-11, verbatim):** *"Sexuality is a serious thing
  and it demands levity, so if we can't laugh a little at an oversized dildo and a woman with
  a shocked face, we are boring."* Comic register is licensed, not merely tolerated: humor,
  visual wit, and playing an expression bigger than life are a first-class option for xdipx
  imagery, not a concession, and the archetype E surreal/witty license extends to human
  figures, not only object still lifes. Earnestness is not the safe default; boring is its
  own failure. **Deliberate scale exaggeration is licensed** when it stages the post's
  question: the owner reviewed two test composites for a beginner-sizing post and preferred
  the one rendering a 5.5-inch product at roughly 12 inches, calling it "great"; the
  oversized prop plus a shocked face IS the hook, because it stages the reader's fear instead
  of describing it. The bound: hyperbole yes, misrepresentation no. Shape, color, finish, and
  product identity stay faithful to the reference image; scale and expression may be played
  for effect. Never on † health-adjacent topics, where a wrong size or a joke reads as a
  safety claim rather than as wit. Unchanged, and none of it loosened: the warm-light lock
  and high-key mandate, the charter visual cap of 6-7, never crude, never porn-adjacent, no
  explicit anatomy, no nudity, no bodies in sexual contact, no product-in-use, the
  adults-only hard rules, and the uncanny-face reject. Witty never crude; the craft is what
  makes it art instead of a shitpost.
- **No-product fallback logs its reason.** Leaving the product out of a human hero is a
  documented exception, never a silent default. It is allowed only when the brief states why
  (the post has zero embeds, or a held product would read as a safety claim on a
  health-adjacent topic), and that reason is written into the keeper log entry in the prompt
  library. A missing product with no documented reason is a vision-gate reject.
- **Hard rules (binding, every human hero):**
  - **Adults only, written for how generation actually fails:** every prompt states adult age
    markers explicitly (e.g. "adults in their 30s"), and the vision gate hard-rejects any face
    or body with youthful ambiguity. Nobody prompts for children; models drift young. The
    reject fires on ambiguity, not on intent. **No images of children, ever.**
  - **Uncanny-face hard reject.** Faces are where generation visibly fails: wrong teeth,
    dead eyes, warped features, extra fingers near a face. Any uncanny artifact is an
    automatic reject, no salvage crop.
  - Never explicit anatomy, never nudity, never bodies in sexual contact, no readable
    invented text.

### Shared rules (both archetypes)

- **Caller briefs do not override this file**, but under the router the correction runs both
  ways: `media-manager` corrects a product-subject request on a `real-talk` post to §0-H just
  as it corrects a mug-scene request on a `guides` post to §0-P, noting the correction in its
  reply. A caller's scene ideas shape the *setting*; the router decides the *archetype*.
- **The houseware ban is unchanged.** Domestic-metaphor objects are banned as subjects in both
  archetypes (the home-goods-catalog class test above). In a §0-H scene, non-product objects
  must be architecture or surface (bed, nightstand, windowsill, table, wall).
- **Aspect / dimensions.** Landscape ~4:3 (`1200 × 900` class). Inherit all global palette,
  light, and composition rules; keep a quiet zone for the title per the layout.
- **Vision-gate notes.** §0-P: reject hard if the subject is not an embedded product (or its
  product-family fallback), if the product is small, incidental, or invented rather than
  ref-image-placed, or if the frame passes the home-goods-catalog test. §0-H: reject hard on
  youthful ambiguity, uncanny faces, moody/dark grading, sexualized bodies, or a frame with no
  identifiable human presence; **also reject a frame whose gesture would fit any other post
  equally well** (the swap test), **and a missing product with no documented reason** in the
  brief and keeper log. The gate carries **no real-world-proportion reject**: deliberate scale
  exaggeration under the levity license is compliant, provided shape, color, finish, and
  product identity stay faithful to the reference. Two failures on §0-P: fall back to the
  product's real Shopify photo cropped editorially. Two failures on §0-H: retry with a simpler
  single-figure composition; if that also fails, the post holds as a Sanity draft for the
  owner rather than publishing heroless.

---

## 1. Masthead art — `~2400 × 1000` (index header backdrop / optional)

**Role.** Optional wide backdrop behind or beside "The Notebook" wordmark on the `/notebook`
index. The masthead is primarily typographic (Newsreader wordmark + coral tick on white), so this
asset is a quiet warm field, not a busy scene. It must never compete with the wordmark or reduce
contrast on the type.

- **Aspect / dimensions.** 2400 × 1000 (12:5), also export a 1200 × 500 @1x.
- **Composition.** Very soft, out-of-focus warm still life or abstract paper-and-light texture
  drifting from coral-soft on one side toward plum-soft and sage-soft across the frame, weighted to
  the edges so the center stays near-white for the wordmark. LCP-safe: low visual weight.
- **Prompt scaffold.** `{shared prefix} + soft abstract editorial backdrop, blurred warm still
  life of light and paper textures, coral-soft blushing into plum-soft and sage at the edges,
  center almost white and empty, dreamy shallow depth of field, nothing in sharp focus, calm.`
- **Vision-gate notes.** Reject if the center is busy or dark, if any object reads as tableware,
  or if contrast against near-black type would be marginal.

---

## 2. Category header artworks — `~2000 × 800` (one per category)

Four banner artworks for the `/notebook/category/{slug}` header wash panels. Each must sit
comfortably under the category's wash color and chip (see the color identity map) and read as a
distinct member of one family: same light, same white base, same editorial restraint, differentiated
by subject motif and the category's accent hue drifting through.

| Category | Accent to echo | Motif direction |
|---|---|---|
| `guides` | coral `#FF5A36` / coral-soft | A warm, inviting "getting started" still life: a single approachable product resting in soft coral daylight on white, a cropped open hand nearby suggesting first contact, confident and welcoming. Energy of a front door. |
| `comparisons` | plum `#7A2BB8` / plum-soft | Two products side by side in balanced plum-tinted light on white, a considered "this or that" symmetry, the composition itself a comparison. Thoughtful, decisive. |
| `care` | sage `#7C8F78` / sage-soft | Calm maintenance: a clean product beside a soft cloth and a plant leaf in cool sage-green daylight on white, water droplets suggesting freshly cleaned. Quiet, botanical, tidy. |
| `wellness-basics` | neutral / `ink-3` | Foundational and neutral: a single body-safe material sample (silicone, glass, steel) in plain warm daylight on paper-neutral white, textural and honest, almost a material study. Steady, evergreen, no chroma push. |

- **Aspect / dimensions.** 2000 × 800 (5:2), plus 1000 × 400 @1x. Keep the left third quiet for the
  overlaid category title.
- **Prompt scaffold (per category).** `{shared prefix} + {motif direction from table}, a soft
  {accent} tint through the daylight, left third of the frame calm and near-empty for a title
  overlay.`
- **Vision-gate notes.** Reject if the accent hue tips into orange (guides) or turns cold/blue
  (comparisons plum must stay warm-violet, care sage must stay green-grey), if the product is
  clinical or centered-lightbox, or if the left third is too busy for a title.

---

## 3. Series cover art — `1200 × 1500` portrait (per franchise)

Portrait covers give the named franchises (First Times, How It Works, Field Notes, and the reserved
This or That) a spine on their series landing and card. These are the most "magazine cover"
surfaces: composed, characterful, a clear visual identity per series.

- **Aspect / dimensions.** 1200 × 1500 (4:5 portrait), plus 600 × 750 @1x.
- **Per-series direction.**
  - **First Times** (guides / coral) — an inviting, low-stakes first-object composition in warm
    coral daylight, a cropped hand reaching or holding gently, open and reassuring. Cover mood:
    "you are welcome here."
  - **How It Works** (guides / coral or neutral) — a slightly technical, curious composition:
    a product shown with an implied sense of mechanism (air, motion, light suggesting how it
    functions) in clean bright light, explanatory not clinical. Cover mood: "here is the trick."
  - **Field Notes** (care / sage) — a tidy still life of a product with its care items (cloth,
    water, storage pouch) in calm sage daylight, practical and clean. Cover mood: "keep it well."
  - **This or That** (comparisons / plum, reserved) — a balanced two-object plum-tinted portrait,
    symmetry as identity. Cover mood: "pick the one that fits."
- **Composition.** Portrait crop with the subject in the lower two-thirds, upper third quiet for
  the series name (Newsreader) and `A SERIES · PART N OF M` kicker overlaid in CSS.
- **Prompt scaffold.** `{shared prefix} + portrait editorial magazine cover, {per-series
  direction}, subject in the lower two-thirds, upper third calm for a title, {accent} daylight.`
- **Vision-gate notes.** Reject if it reads as a stock catalog shot rather than a cover, if the
  upper third is crowded, or if the series accent is off-hue.

---

## 4. Editorial spot illustrations — `~1200 × 900` (in-body / card art)

The recurring in-body and card imagery. These are the highest-volume assets (one-plus per daily
post), so they must be cheap, fast, on-family, and reuse-friendly across the topic clusters.

- **Aspect / dimensions.** Card art 4:3 (`1200 × 900`, `600 × 450` @1x); in-body figures 3:2 or
  full-column 16:9 as the layout calls for.
- **Style.** Same warm daylight editorial photography as everything else, but simpler single-
  subject compositions that can be produced quickly and matched to a post's topic and category
  accent. A soft-focus product-in-context on white with one accent hue is the workhorse.
- **Reuse rule.** Build a small cluster library keyed to the content plan's authority clusters
  (air-pulse/suction, wands, lubricants, rabbits, prostate, couples/remote) so repeat topics reuse
  a keeper rather than regenerating. Log keepers to the prompt library.
- **Prompt scaffold.** `{shared prefix} + single-subject editorial still life of {topic product or
  context}, one {category accent} tint in the daylight, simple clean composition, room to breathe.`
- **Vision-gate notes.** The class that failed in production (tea cups, bowls, stationery). Reject
  hard if the subject is not the topic product or a plausible warm-use context for it.

---

## 5. OG share image template — `1200 × 630`

Designed share cards so a Notebook link looks composed in a message, feed, or LLM citation card,
extending the design system off-site (the Satori / `@vercel/og` path).

- **Aspect / dimensions.** 1200 × 630 (1.91:1), the social standard.
- **Template (composed, not a raw photo).** White paper base. Left column: the `.kicker` edition
  mark `THE NOTEBOOK`, the post title in Newsreader 500 (up to ~3 lines, plum `.em` on one word
  allowed), the category chip in its identity color, and `xdipx.com/notebook`. Right column: the
  post's spot illustration or category art, bled to the edge with a soft coral/plum/sage wash
  matched to the category. A 40px coral tick under the title echoes the masthead.
- **Rules.** Title text is real rendered type (Satori), never baked into a generated image (keeps
  it crisp and legible at thumbnail size and avoids invented-text artifacts). The photographic
  region follows all global rules. Category color comes from the identity map; guides→coral,
  comparisons→plum, care→sage, wellness-basics→neutral.
- **Prompt scaffold (photographic region only).** `{shared prefix} + {post spot illustration
  direction}, composed to bleed off the right edge with room for a soft {category accent} wash.`
- **Vision-gate notes.** Verify the safe-area title never overlaps a busy region; verify contrast
  of overlaid type against the wash meets AA.

---

## Delivery checklist

- All assets: sRGB, optimized (WebP/AVIF with JPEG fallback), @1x and @2x where noted.
- Alt text supplied per asset in Emma voice, descriptive and non-explicit (charter).
- Every asset logged to the prompt library with its keeper prompt and cluster key.
- Category and series accents verified against the identity map in `notebook-art-direction.md`.
- Vision gate passed (bright/warm, product-or-context match, palette-compatible, no artifacts,
  tasteful) or the asset falls back to the product's real Shopify photo.
- Masthead/category-header quiet zones confirmed clear for type overlay at 375 and 1440.
