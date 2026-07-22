# Competitor Teardown — July 2026 (design-elevation p3-teardown)

> **SUPERSEDED (2026-07-21).** The live re-run this doc's §0 called for has
> happened: `competitor-teardown-2026-07-live.md` is now the current decision
> doc for Routine B step 0.5, built from real captures. This file stays as the
> historical record of the blind pass; do not refresh or extend it.

> Owner: `homepage-designer` (art director). Routine B design deliverable.
> Binds to `docs/design-doctrine.md` (visual charter) and `docs/emma-voice.md`
> (voice). Where this doc and the doctrine disagree on pixels, the doctrine wins.
> Scope: variant-b storefront (`app/components/store/StorefrontHome.tsx`), the
> locked Nº01 to Nº11 shell. This is direction and a build brief, not code.

---

## 0. Method and a hard honesty note on sourcing

**Live fetch was unavailable this session.** Every WebFetch call in this run
returned `403 Forbidden` from the egress proxy, for all ten target hosts and for
a neutral control URL (Wikipedia) as well. Per `/root/.ccr/README.md`, a 403 from
the proxy is an organization egress-policy denial that must be reported, not
retried or routed around. So this teardown could **not** observe the current live
homepages. Nothing below is "seen directly this session."

Because I could not see the live pages, I have **not** invented current
headlines, current section order, exact hex values, or image alt text. Doing so
would violate the "do not fabricate what you didn't see" instruction. Instead,
every reference note is tagged with its real basis:

- **[Prior]** — the brand's durable, well-documented design language from general
  knowledge up to the Jan 2026 cutoff. Stable brand facts (palette family, type
  posture, imagery register, urgency posture). Reliable at the level of
  *direction*, not at the level of *this week's hero copy*.
- **[Inferred]** — a reasonable extrapolation from that language to a pattern we
  could adopt, clearly a design judgment rather than an observation.

**Action for when fetch access returns:** re-run this teardown live to confirm
current section order, capture real screenshots for the reference board, and
lock exact grades/type specimens. Until then, treat the numeric/hex specifics as
xdipx-token targets (which are ours and verifiable), and the competitor notes as
directional. No competitor's *current* copy is quoted anywhere in this doc.

---

## 1. Reference board

Per site: 2 to 4 specific things to steal (tagged to a doctrine dimension —
imagery, rhythm, type, motion, narrative) and one thing to avoid. Confidence tag
per row. No live observation this session; all rows are [Prior] brand-language or
[Inferred] design judgment.

### The editorial / DTC bench

**Maude (maude.com)** — the closest register to ours.
- **Steal (imagery):** single product floated on a flat, muted color field, shot
  in soft even light with a real cast shadow. No props competing with the object.
  This is exactly the doctrine §4 "product is the star" look, executed with
  restraint. **[Prior]**
- **Steal (rhythm):** section-to-section color blocking in a small earthy
  palette does the pacing work, not whitespace. Maps directly to doctrine §1
  "section rhythm is color, not whitespace." **[Prior]**
- **Steal (narrative):** shame-free plain nouns as the entire tone. Calm,
  unembarrassed, zero innuendo. This is the emotional register the Emma voice
  already wants. **[Prior]**
- **Steal (type):** one clean sans doing near-all the work at generous size, with
  short declarative lines. We differ (we run a serif display), but the *economy*
  of words per headline is the lesson. **[Inferred]**
- **Avoid:** their palette runs cool and can tip toward austere/minimal-to-a-fault.
  We are warmer by mandate (coral + Glossier-warmth). Do not out-minimal Maude
  into timidity, our named failure mode. **[Inferred]**

**Dame (dameproducts.com)** — category-adjacent confidence.
- **Steal (imagery):** brighter, more saturated color-block backdrops than Maude,
  product still the unmistakable subject. This is the "bright, colorful, bold"
  half of doctrine §4 that keeps us from going clinical. **[Prior]**
- **Steal (narrative):** plain product-function talk (what it does, how it
  functions) without crudeness, plus an education layer. Confirms our "suggestive
  about function, never porn-copy" line. **[Prior]**
- **Steal (motion):** playful but restrained micro-interaction, friendly not
  bouncy. Supports our `springEntrance` "settles with body, never bouncy" budget.
  **[Inferred]**
- **Avoid:** occasional illustration/mascot cuteness can read childish. Doctrine
  §0 warns against "approachable without being childish." We stay grown-up.
  **[Prior]**

**Aesop (aesop.com)** — restraint and editorial copy-as-design.
- **Steal (type):** long, literary product and section copy set as a designed
  object, given room to breathe. Our Meet Emma pull-quote and Notebook are where
  this lives. **[Prior]**
- **Steal (rhythm):** how much meaning a large field of near-empty ground can
  carry when the type and the single product are perfect. The disciplined version
  of white space (earned, not defaulted). **[Prior]**
- **Steal (narrative):** an "apothecary / edition" seriousness, numbered and
  catalogued, luxury without a single gradient. Direct ancestor of our Nº 0X
  motif. **[Prior]**
- **Avoid:** greige-on-greige monochrome and near-zero color. For our category
  that would read cold and clinical, our third failure mode. Take the restraint,
  keep our coral pulse. **[Inferred]**

**Glossier (glossier.com)** — warmth on a near-white ground.
- **Steal (imagery):** warm human-context photography (skin, faces, hands) shot
  in soft daylight, product held or in use, that still reads clean. The tasteful
  end of the doctrine §4 "sensual human context matched to the link target."
  **[Prior]**
- **Steal (color):** a single soft signature tint used with discipline across the
  page as the brand's warmth. Our coral-soft / plum-soft band fills are the same
  device, and coral is our rationed accent. **[Prior]**
- **Steal (narrative):** approachable first-person brand voice, community-forward,
  "we did the homework for you." Emma's guide posture, minus the community/UGC we
  do not yet have. **[Prior]**
- **Avoid:** heavy reliance on real user-generated content and named testimonials.
  We are pre-launch with no real reviews; inventing them is banned (FTC + charter,
  redesign-spec §3.7). Do not build a social-proof wall yet. **[Prior]**

**Away (awaytravel.com)** — product-in-context as aspiration.
- **Steal (imagery):** product shown in a lived context (destination, motion,
  hands, luggage in a scene) rather than only on seamless. For us the analog is
  the couples/mood band and wayfinder human-context tiles. **[Prior]**
- **Steal (rhythm):** large full-bleed photographic bands alternating with tighter
  product blocks. Confirms our full-bleed-band upgrade over floating plates.
  **[Prior]**
- **Avoid:** travel brands lean on wanderlust vibe over product clarity in the
  hero. Our hero must still resolve to a specific, clickable product (the PDP-link
  target). Do not let a mood photo replace the sellable object. **[Inferred]**

**Arket (arket.com)** — grown-up muted color-blocking.
- **Steal (color):** how a single muted tinted band carries an entire section as a
  color chapter, adult and unshouty. Our coral-soft / plum-soft / ink bands, done
  right. **[Prior]**
- **Steal (type):** serif brand voice over a quiet sans body, an "archive /
  essentials" seriousness. Mirrors our Newsreader + DM Sans pairing. **[Prior]**
- **Steal (imagery):** editorial fashion photography with a consistent, slightly
  desaturated-but-warm grade so every image looks from one shoot. Our generated
  imagery's biggest current weakness is grade inconsistency; this is the fix.
  **[Prior]**
- **Avoid:** fashion-cold neutrality with no accent pulse. We need coral to keep a
  heartbeat. **[Inferred]**

### The direct competitors (take density, reject the noise)

**Lovehoney (lovehoney.com)** — the category's mass-market default.
- **Steal (rhythm):** the wall-of-product open. A dense, immediately clickable
  grid high on the page. This is precisely why redesign-spec Nº 03 promotes the
  best-seller set to a static grid. **[Prior]**
- **Steal (rhythm):** clear category on-ramps as tiles near the top, so a visitor
  self-sorts fast. Our wayfinder mosaic. **[Prior]**
- **Avoid (everything else):** urgency banners, countdowns, "up to X% off" walls,
  competing red/pink CTAs, clutter, and clinical/explicit thumbnails. Doctrine §0
  names this the "Loud" failure mode. We take the density, reject the theater.
  **No countdown or urgency pattern enters our page even though theirs is built on
  it.** **[Prior]**

**Spectrum Boutique (spectrumboutique.com)** — the indie-editorial competitor.
- **Steal (narrative):** an editorial, inclusive, education-forward posture that
  proves the category can look curated rather than transactional. Nearest direct
  peer to our ambition. **[Prior]**
- **Steal (imagery):** cleaner, more art-directed product presentation than the
  mass sites, closer to DTC than tube-shop. **[Prior]**
- **Avoid:** indie sites can drift busy/craftsy and lose hierarchy. Keep our one
  rhythm and one accent discipline. **[Inferred]**

**Too Timid (tootimid.com)** — mid-market, deal-driven.
- **Steal (rhythm):** category-tile navigation that gets a broad catalog sorted
  quickly. Confirms the wayfinder's job. **[Prior]**
- **Avoid:** deal-led, promo-heavy, cluttered hierarchy with weak type. The
  opposite of our editorial thesis. Almost entirely a "what not to do" reference.
  **[Prior]**

**In The Groove Toys (inthegroovetoys.com)** — **could not resolve.** DNS lookup
failed (`ENOTFOUND`) on both `www.` and apex forms this session, in addition to
the proxy 403 wall. No basis to characterize it. Re-check the domain when fetch
access returns; if it is dead, drop it from the bench and swap in a live peer.

---

## 2. Imagery-style audit

How the bench art-directs photography, and the concrete additions this implies
for `docs/homepage-team/image-prompt-library.md`. All observations [Prior]; the
prompt additions are the actionable output.

### What the bench does (the pattern behind the pattern)

1. **Campaign vs packshot is a deliberate split, not a mix per frame.** The strong
   brands use *clean packshots* (product on seamless color) for merchandising
   surfaces where the object must be identified and clicked, and reserve *campaign*
   (human context, environment) for the emotional bands. They almost never blend a
   busy lifestyle scene into a merchandising card. **We already encode this** in
   the manifest (product cards = real Shopify packshot; bands/tiles = context). The
   audit finding is: **enforce the split harder.** No half-lifestyle packshots.
2. **One grade across the whole page.** Arket/Aesop/Maude read like a single shoot
   because color temperature, contrast, and shadow softness are constant. Our
   generated set's weakness is drift (a coral-bright frame next to a cooler one
   reads cheap). We need a **named house grade** baked into every prompt.
3. **Human context is warm, daylit, and cropped at the shoulders/hands.** Glossier
   and Away never need explicit content to feel intimate; light and gesture do it.
   This is the doctrine §4 "premium lingerie campaign, nothing it could not run"
   line, made visual.
4. **Product is large and centered on merchandising frames.** Never tiny-on-a-
   styled-table (our retired July 2026 housewares failure). The bench keeps the
   object at 60 to 80 percent of frame.
5. **Shadows are real and single-source.** A crisp single cast shadow reads
   premium; flat cut-out-on-white reads catalog-cheap; multi-shadow reads fake.

### What xdipx's generated imagery should adopt — concrete library additions

Add a **house-grade clause** to the "Shared prompt DNA" so every generation
inherits one look. Proposed text to fold into the library preamble and each
scaffold (hand to `media-manager` to land):

> House grade (append to every prompt): *warm daylight white balance around
> 5200K, soft single-source key from frame-left, one crisp natural cast shadow,
> gentle film-like contrast (lifted-but-not-milky shadows), saturated but not
> neon color-block backdrop in the v3 palette (coral #FF5A36 tints, plum #7A2BB8
> tints, white paper), medium-format clarity, consistent across the set.*

Per-scaffold additions:

- **Hero scaffold:** add "product occupies 60 to 75 percent of frame height,
  single crisp shadow, backdrop is one flat coral-soft or plum-soft field (no
  gradient), nothing else in frame competing for the eye." Reinforces §4 and the
  no-gradient rule.
- **Rail card / Emma's edit scaffold:** add "identical framing discipline across
  the set so a row of cards reads as one shoot: same crop ratio of product to
  background, same shadow direction." This is the single biggest lift for grid
  cohesion.
- **Wayfinder / editorial tile scaffold (human-context tiles):** add "warm
  daylight, shoulders/hands/fabric only, gesture carries the intimacy, no faces
  required, cropped so the scrim area at the bottom third stays low-detail for the
  white label." Ties imagery to the ink-scrim label pattern the tiles use.
- **Mood band scaffold:** add "generous low-detail negative space on one side for
  the ink scrim + headline; keep the busy/bright half opposite the copy." Prevents
  the recurring "headline unreadable over a busy photo" failure.
- **New shared negative-prompt addition:** append `no mismatched color
  temperature, no multiple conflicting shadows, no flat cut-out-on-white, no neon
  oversaturation` to the mandatory negative prompt. These are the specific ways our
  set currently drifts off the bench grade.

These are additive edits to the scaffolds' text, not new scaffolds. `media-manager`
owns landing them and appending keepers/rejects per run.

---

## 3. Per-section before to after (the flat-tint fallbacks)

For each variant-b section that currently falls back to a flat tint when Sanity is
empty, a prioritized treatment. P1 = do first (biggest read-uplift per effort),
P2 = next, P3 = polish. These are art-direction and imagery briefs; the build is
`rr7-engineer`, the imagery is `media-manager`, all within the locked shell.

### Nº 01 Hero product frame (currently: `coral-soft` frame, real product photo)
The hero already uses the real product photo, so its "fallback" is the sage ♥
tile when a product has no image. The flat-tint risk here is the **frame reading
as a plate** rather than a composed still.
- **P1:** ensure the `featured[0]` product photo is the house-grade packshot, not
  a raw supplier cut-out. Where the Shopify image is a bare white cut-out, brief
  `media-manager` for a Kontext re-render onto a coral-soft field with the house
  grade (product-photo path only, never a fabricated product). This is the LCP;
  keep it **unwrapped** (confirmed in §4 of this doc and doctrine §5).
- **P2:** keep the inset vignette (`inset 0 -60px 90px rgba(26,20,24,0.07)`) but
  verify it does not muddy a dark product; make the vignette conditional on a
  light-product check if it ever fights the object.
- **P3:** the "Nº 01, this week's pick" mono tag stays; consider a hairline rule
  under it to strengthen the masthead read (see §4 signature move).

### Nº 05 Wayfinder mosaic tiles (fallback: `paper-3` fill + bare label)
This is doctrine-named "the weakest part of the page" when unfilled.
- **P1:** land the three tile images (manifest #3 to #5) so the tiles carry
  photography with the ink scrim + white label instead of the grey fill. Two of
  three are product-linked (Kontext ref from the real product photo); one is warm
  human context (interlaced hands). This alone moves the section from "unfinished"
  to "editorial." **Highest-priority image work on the page.**
- **P2:** enforce equal crop discipline across the three tiles so the row reads as
  one set (per §2 grade note). Same subject scale, same shadow direction, same
  backdrop family (alternate coral / plum / paper so the row still has rhythm).
- **P3:** the `plum-soft` Discover You promo tile keeps its flat tint by design
  (it is a typographic promo, not a photo tile). If a promo image is ever added,
  it must obey manifest #10's no-scrim legibility constraint (pale, subject on the
  right third, clean left two-thirds). Leave it flat-tint until such an asset
  exists; flat plum-soft here is correct, not a failure.

### Nº 05 / Nº 08 Discover promo (fallback: flat `plum-soft`, no image)
- **P1:** keep it flat `plum-soft`. This is the one section where a flat tint is
  the *right* answer (plum = emphasis/guided-finder per doctrine §3, and the tile
  carries ink/plum text with no scrim). Do not brief an image for it by default.
- **P2:** strengthen hierarchy inside the flat tile: the coral CTA is the single
  rationed coral element in that viewport; verify nothing else coral competes.
- **P3:** if the team ever wants a photo here, it is a *new named treatment*
  (image + the strict manifest #10 legibility rule) and goes through the imagery
  brief, not a quick swap.

### Nº 07 Couples band (fallback: flat `coral-soft` box, no products)
Doctrine and redesign-spec both flag this: "a heading and a button is not a
section."
- **P1:** land the couples-mood photograph (manifest #6) so the band becomes a
  full-bleed photographic banner with ink scrim + white label + one coral CTA.
  Prefer the existing professional brand couples asset already in Sanity before
  generating. Warm daylight, bodies in-bounds, nothing explicit.
- **P2:** wire the couples product rail beneath the banner so the section earns
  clicks (PDP-link target), not just a collection jump. Graceful-degrade to the
  banner alone when the rail is empty (already coded).
- **P3:** the coral-soft flat fallback stays as the graceful-degrade floor, but it
  should never be the *published* state. Treat an unfilled couples band as a
  content gap for `media-manager`, not an acceptable resting state.

**Priority order across the page (do in this sequence):** Nº 05 tile photos (P1)
→ Nº 07 couples photo + rail (P1) → Nº 01 hero packshot house-grade (P1) → grade
cohesion pass across all cards (P2) → promo-tile polish (P3).

---

## 4. The signature move — the "Edition" masthead system

**One ownable editorial system, pushing the existing `Nº 0X` motif from a quiet
tag into a real magazine masthead.** This is the thing that makes xdipx look like
a publication, not a store, and no competitor on the bench owns it in our category.

### The idea
Today `Nº 0X` is a lone mono numeral above each section. That is a hint of an
editorial system, not a system. We promote it to a **consistent section masthead
lockup** — the same three-part header on every major band, the way a magazine
runs a standing folio on every spread. The page reads as **"xdipx — Edition Nº
[week], Summer 2026,"** a curated issue that changes on Emma's cadence.

### The lockup (spec, buildable)
A reusable `SectionMasthead` (extends the existing `SectionNumeral`), rendered at
the top of every major band (Nº 03, 04, 05, 06, 07, 09):

```
┌───────────────────────────────────────────────┐
│ Nº 05  ──────────────  WHERE TO BEGIN          │   ← folio row
│                                                │
│ Find your way in.                              │   ← Newsreader H2, one .em word
└───────────────────────────────────────────────┘
```

- **Folio row** (new): a single hairline-rule row, `border-line`, at mono
  `text-[11px] uppercase tracking-[0.18em] text-ink-4`. Left: `Nº 0X`. A hairline
  rule fills the middle (a `flex-1 border-t border-line` spacer). Right: the
  section kicker (today's eyebrow), right-aligned. This is the "masthead feel" —
  the numeral and the kicker become a *ruled folio* instead of two stacked lines.
- **Headline row** (existing): the Newsreader H2 with exactly one plum `.em` word,
  unchanged from current sizing (`text-[1.9rem] md:text-[2.9rem]`).
- **Tokens only:** `border-line` (8% ink hairline), mono kicker, `ink-4`, no new
  color. Radii and type untouched. Zero new brand primitives.
- **Motion:** the folio row rides inside the section's existing heading `Reveal`
  (`up`), no separate animation. The hairline draws in with the block, no
  width-animation (that would be layout-adjacent; keep transform/opacity only).

### The issue framing (the masthead's payoff)
- **Global folio:** the announcement bar (Nº 00, in `_layout.tsx`, out of this
  file's scope but part of the system) gains a quiet right-side `Edition Nº [n]`
  mono tag alongside "Editorially picked. Discreetly shipped." The edition number
  is a content field, not a countdown, and carries **no date, no deadline, no
  urgency** — it is a masthead volume number, the way a magazine says "Issue 47."
  This is the one place the "curated edition on Emma's cadence" idea surfaces as a
  literal number, and it must never imply a clock (charter: no countdowns).
- **Cover-like hero:** the hero frame's existing "Nº 01, this week's pick" tag gets
  a hairline rule beneath it so the hero reads as a **cover** — big serif "cover
  line" (the H1), a standing folio, one featured object. No new layout, just the
  rule + tag already present, tightened into a lockup.

### Why this is ownable and safe
- It is **pure type and hairlines on existing tokens.** No gradient, no new color,
  no new radius, no imagery dependency. It cannot break the coral budget or CLS.
- It is the doctrine §7 "Cartier/Hermès edition motif + serif display authority"
  reference, made systematic and specific to us.
- It reinforces the brand's actual model (Emma curates an irregular edition)
  without a countdown, which is the exact line the charter draws.

### Campaign-style hero vs product-on-tint — recommendation

**Recommendation: keep the product-on-tint hero as the default. Do not switch the
homepage hero to a campaign human-context shot. Add campaign warmth *around* the
hero, not *in* it.**

Reasoning, against doctrine §4 limits and the revenue job:
- The hero's primary job is a **specific, clickable, revenue CTA to one PDP**
  (redesign-spec Nº 01, the 70% PDP-link target). A campaign human-context shot
  dilutes the "which object am I buying" clarity that Away is criticized for
  above. Product-on-tint keeps the sellable object unambiguous and keeps the LCP a
  real, indexable product image.
- Doctrine §4 permits sensual human context "matched to the link target," but the
  hero links to a single product; the cleanest match to a single SKU is that
  SKU's photograph, not a body.
- Campaign human context is **already placed correctly** on the emotional bands
  (Nº 05 human-context tile, Nº 07 couples band, Nº 09 Notebook scenes). That is
  where warmth belongs; the page as a whole is then "editorial magazine with a
  warm campaign pulse," which is the thesis, without risking hero clarity or the
  processor/ad-platform limits in a top-of-page, above-the-fold frame.
- **Compromise if the team wants more hero warmth:** allow the hero *backdrop
  field* to carry a subtle human-context element only as a Kontext-composited
  environment behind the real product (e.g. product on coral-soft with a softly
  out-of-focus hand entering frame to reach for it, the manifest's named hero
  variation), never a body-forward campaign image that displaces the product.
  That stays inside §4 and keeps the LCP a product. Test it as a P3 experiment
  against the plain product-on-tint control; only promote it if it holds hero
  clarity and CLS.

---

## 5. Design narrative (one page, for the whole team)

**xdipx is a beautifully art-directed magazine that happens to sell sex toys.**
Here is that sentence made concrete, so engineering, copy, imagery, and QA are
aligned on one story.

**The feeling.** A reader lands and feels they have opened a well-made independent
magazine, not a store. It is calm, confident, and warm. It never shouts a
discount, never runs a clock, never looks clinical, and never looks like a tube
site. It looks like it was art-directed by someone with taste who is completely
unembarrassed by the subject. The guiding presence is Emma, a smart friend who
did the reading for you, not a salesperson and not a countdown.

**How the page tells the story.** The page is an **edition**. A standing masthead
(the Nº 0X folio system in §4) runs on every section like a magazine's folio, so
the whole scroll reads as one curated issue that Emma refreshes on her own
cadence. White paper is the ground, but we are not afraid of it: color-blocked
bands (coral-soft, plum-soft, one ink chapter) give the eye a beat every scroll,
so density and calm coexist. Oversized Newsreader display type does the talking;
one plum-emphasized word per headline carries the meaning; DM Sans keeps the body
quiet; JetBrains Mono numerals do the edition bookkeeping. Coral is a single
rationed pulse per screen, usually the one CTA. The product is always the star of
every merchandising frame, shot in one warm daylight grade so the whole issue
looks like one shoot.

**The three registers, in balance.** *Restraint* (Aesop/Arket) keeps it adult and
uncluttered. *Warmth* (Glossier/Maude) keeps it human and unashamed. *Density*
(the good half of Lovehoney) keeps it a real shop with a wall of clickable
product high on the page. The failure is any one register unbalanced: all
restraint is timid, all warmth is childish, all density is loud. The doctrine's
three named failure modes (Timid, Loud, Clinical) are the guardrails.

**What the reader does.** They land on a cover (hero: one featured object, one
cover line, one coral CTA to buy it). They immediately see a wall of real product
(Nº 03 grid). They meet Emma as a value they discover mid-page, in a pull-quote
set like editorial art. They self-sort through photographic category tiles. They
get a calm curated rail, a warm couples chapter, one dark full-stop invitation to
be guided, a Notebook that teaches and links, and a quiet email close. Every step
is a clickable path to a product or a collection, and the reader never once feels
sold to or rushed.

**The one-line test for any new element:** *would this look at home in a
well-made independent magazine that respects its reader?* If it needs a badge, a
gradient, a second coral, a countdown, or a stock-photo body to earn attention, it
fails. If it earns attention with type, a real product, one warm image, and space,
it passes.

---

## 6. IA fence (verbatim, binding)

All proposals in this document stay within the locked Nº01 to Nº11 shell. This
teardown proposes **no new section types** and **no new routes**.

- **Locked shell.** Every treatment above restyles an existing section
  (`emmaHeroStorefront`, `wayfinderMosaic`, `emmaCuratedRail`, `productCarousel`,
  `playTogetherBanner`, `promoBanner`, `editorialTiles`, `trustBar`, `editorBio`)
  within the fixed Nº01 to Nº11 order. The section ORDER and the locked shell
  (announcement / hero / trust / email last) are unchanged.
- **New section types need a named spec through IA review + additive Sanity
  schema before build.** If any idea here later grows into a genuinely new section
  archetype (it does not today), it must go to `homepage-ia` as a named spec and to
  `sanity-content-builder` as an additive-only schema change before any build.
  Modify no existing Sanity field; add new document types / blocks / fields in new
  files with loader fallback to old.
- **Competitor patterns implying new URLs or routes go to `tech-architect`.** No
  pattern in this teardown introduces a route. If the team later wants one (for
  example a standalone editions archive), it is a `tech-architect` decision, not a
  design one, and does not enter the homepage build.
- **Preserve the two-link cap on `/discover`.** `/discover` appears exactly twice
  on the page: the Nº 05 mosaic promo tile and the Nº 08/Nº 09 closer band. No
  treatment here adds a third `/discover` link. The Meet Emma CTA anchors to
  `#discover` (in-page), not a new `/discover` link, and stays that way.
- **Respect the retired-route denylist.** No proposal links to or revives any
  retired route (the deferred daily-deal home, the retired "Vault", or any
  legacy path). Category tiles and rails target live collections and canonical
  `/products/{handle}` PDPs only.

---

## 7. Handoffs

- **`media-manager`** — land the §2 house-grade + per-scaffold prompt additions
  into `docs/homepage-team/image-prompt-library.md`; generate/reuse the §3 P1
  images (Nº 05 tiles #3 to #5, Nº 07 couples #6, hero packshot re-render where
  needed), tagged by mood + section; enforce one grade across the set.
- **`rr7-engineer`** — build the §4 `SectionMasthead` folio lockup (extends
  `SectionNumeral`, tokens only, rides the existing heading `Reveal`), across
  Nº 03 to Nº 09; wire the couples product rail (Nº 07) beneath the photo band;
  keep the hero LCP image unwrapped. Gated PR, never auto-merged.
- **`homepage-ia`** — no action required (no new section types proposed);
  informational only, confirm the folio masthead is a restyle within the shell.
- **`sanity-content-builder`** — one optional additive field only if the team
  wants a content-controlled edition number on the announcement folio (§4): add
  `editionLabel` (string) additively; do not modify existing fields. Skip if the
  edition number is derived/hardcoded.
- **`emma-copywriter`** (gated by `emma-empathy-reviewer`) — any real section copy
  stays on the redesign-spec §2 slots; the edition folio label carries no date and
  no urgency.
- **`qa-reviewer`** — preview MCP at 375px: confirm CLS ≈ 0, hero image is the LCP
  and unwrapped, the new folio hairlines animate transform/opacity only, coral
  budget holds (one primary coral per viewport), and every section renders its
  fallback when its Sanity block is absent.

---

## 8. LCP / hero confirmation (required call-out)

**The LCP hero image is the Nº 01 hero product still** (`featured[0]` real Shopify
photo, rendered in the `coral-soft` 4:5 frame in `Hero()`).

**It is unwrapped and must stay unwrapped.** In `StorefrontHome.tsx` the hero text
column is a single `Reveal variant="up" disabled` group (above the fold, renders
visible immediately), and **the product image `<div>` is deliberately outside any
`Reveal`/motion wrapper** with `priority` set on the `OptimizedImage`. No treatment
in this document wraps it. The §4 masthead lockup touches only the mono tag and a
hairline rule around it, never the image element. Zero CLS: fixed 4:5 aspect,
transform/opacity-only entrances everywhere else.

---

*2026-07-20. `homepage-designer` Routine B deliverable. Live competitor fetch was
blocked by egress policy this session (see §0); competitor notes are prior-
knowledge brand-language tagged [Prior]/[Inferred], not live observations. Re-run
live to capture screenshots and confirm current section order when fetch access
returns.*
</content>
</invoke>
