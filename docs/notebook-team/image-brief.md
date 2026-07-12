# The Notebook — Image Brief (for `media-manager`)

> Generation brief for every art surface in the Notebook redesign. Follows the house imagery
> doctrine and the standing merchandising image rules: bright, warm, editorial, product-led or
> product-in-context, never clinical, never near-black or moody, never tableware (no tea cups,
> ceramic bowls, notebooks-as-tile-art, or the July 2026 failure classes). Age gate and content
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
- **Subject.** Product-led or product-in-a-warm-human-context (hand, bedside, fabric, plant,
  soft light) matched to the piece. Human presence is suggested through context and cropped hands
  or gesture, never explicit anatomy and never a full nude figure.
- **Composition.** Generous negative space on the paper base so type and chips can overlay
  cleanly. Leave a quiet zone in the crop where the art-direction doc places a title or chip.
- **Texture.** Subtle grain acceptable for editorial warmth; keep it light. No heavy filters, no
  vignettes that darken corners toward black, no lens flare.
- **Banned, restated.** Tableware and kitchenware, notebooks/stationery as literal props, near-
  black or heavily shadowed frames, clinical white-coat/medical staging, cold minimalism, gradients
  in the old orange, uncanny hands or warped objects, any readable invented text in the image.

**Prompt scaffold shared prefix** (prepend to every per-surface prompt):
> Bright warm editorial photograph on a pure white paper background, soft directional daylight,
> magazine art direction, calm and unembarrassed mood, coral / plum / sage / warm-neutral palette,
> generous negative space, tasteful and non-explicit, no text, no tableware, no clinical staging,
> not moody, not dark.

Post-process for the surfaces that carry type overlay: light coral/plum wash gradients are
composed in CSS at build time (see the `.ph--*` blocks in the hi-fi), so generated art should be
clean imagery, not pre-baked with brand-color overlays unless a surface below says otherwise.

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
