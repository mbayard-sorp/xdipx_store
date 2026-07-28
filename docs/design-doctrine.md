# xdipx Design Doctrine (v1.1)

> The single source of truth for how xdipx **looks**, everywhere: homepage, PLP,
> PDP, discovery, admin. Every design agent (`homepage-designer`, `rr7-engineer`,
> the future `design-critic`) and every Routine B cycle loads this file before
> wireframing, building, or scoring visual work. It is the visual twin of
> `docs/emma-voice.md`: that charter owns the words, this one owns the pixels.
>
> **Authority.** Where this doctrine disagrees with an agent-definition summary,
> the mission brief's visual notes, or a stray CLAUDE.md line, **this doctrine
> wins** for visual/layout decisions. Where it disagrees with `docs/emma-voice.md`
> on anything about words, the voice charter wins. Where it disagrees with a hard
> engineering constraint (SSR, zero-CLS, the `.server.ts` boundary), the
> constraint wins. It never overrides Shopify-as-source-of-truth or the
> approval/kill-switch gates.
>
> This is a codification of what is **already shipped and working** in
> `app/app.css`, `app/components/store/StorefrontHome.tsx`, and the Motion
> primitives, plus the locked art direction in
> `docs/homepage-team/redesign-v2-spec.md`. It is not aspiration. Every number
> below traces to a real token or a real rendered section. Update this file (via
> a reviewed PR) when the system changes; keep it in sync with the tokens.

---

## 0. The one-line brief

**A beautifully art-directed magazine that happens to sell sex toys.** Aesop's
restraint and Glossier's warmth, on white paper, in a category that usually looks
like a discount tube site. Confident, not loud. Warm, not clinical. Editorial,
never explicit. The reader should feel guided by a smart, unembarrassed friend
through a shop that is dense with real product and calm at the same time.

The failure modes we design against, named so we can catch them:

- **Timid.** Acres of white, floating grey plates, thin outline tiles, vertical
  air that reads "unfinished" instead of "editorial." (The pre-v2 storefront.)
- **Loud.** Urgency banners, discount walls, gradients, more than one coral
  thing screaming per viewport. (Every competitor.)
- **Clinical.** Medical-white, cold grids, spec-sheet energy. We name materials
  plainly (voice), but the page is warm.

---

## 1. Layout — grid, rhythm, breathing room

### The frame
- **Mobile-first @375px.** Design and verify the phone view first; desktop is the
  enhancement. Every section must read complete at 375px before any `md:` styling.
- **Content max-width: `1320px`** (`max-w-[1320px]`) for full-bleed bands and the
  hero; **`1200px`** for text-forward editorial sections (Notebook); **`820px`**
  for reading columns (FAQ). Do not invent new max-widths; reuse these three.
- **Gutters:** `px-6` (24px) mobile, `md:px-16` (64px) desktop. This is the
  standard band inset. Reading columns use the same.

### Vertical rhythm
- **Section padding: `py-16 md:py-20`** (64px → 80px) is the standard band
  rhythm. The hero band is tighter (`py-10 md:py-16`) because the trust strip
  rides inside it, above the fold. The dark closer is looser (`py-20 md:py-32`)
  because it is a full-stop.
- **One rhythm per page.** Do not scatter arbitrary paddings. If a section needs
  more air, it earns it by being a full-stop (closer, email capture), not by
  drifting off the scale.
- **Heading-to-content gap:** kicker `mb-3`, heading `mb-9` before its grid/rail.
  Keep it consistent so section openings feel like a set, not one-offs.

### Section rhythm is color, not whitespace
This is the single biggest lever and it is **mandatory**: the page must alternate
grounds so the eye gets a beat every scroll. Never ship six pale sections in a
row.

```
paper → paper-2 → tinted band (coral-soft / plum-soft) → paper → ink band
```

The shipped homepage sequence is the reference implementation: hero (`paper`) →
grid (`paper`) → Meet Emma (`paper-2`) → wayfinder (`paper`) → Emma's edit
(`paper-2`) → couples (`paper-3` + tinted photo band) → closer (`ink`) → Notebook
(`paper`) → FAQ (`paper-2`) → email. A new section inherits the alternation; if
two adjacent sections would share a ground, re-block one of them.

---

## 2. Type — the Newsreader / DM Sans / JetBrains Mono system

Three families, each with one job. Do not add a fourth. Caveat (`font-script`)
is **retired on customer pages**; it exists only as a legacy alias.

| Role | Family | Token | Used for |
|---|---|---|---|
| Display | Newsreader | `font-display` (`--font-display`) | Headlines, pull-quotes, editorial display, italic emphasis |
| Body | DM Sans | `font-body` (`--font-body`) | Body copy, nav, labels, CTA text |
| Kicker/mono | JetBrains Mono | `font-mono` (`.kicker`) | Section labels, "Nº 0X" numerals, eyebrows |

### The scale (as shipped — reuse these, don't freestyle sizes)
- **Hero H1:** `text-[2.7rem] md:text-[4.4rem]`, leading `1.04`, tracking
  `-0.015em`, Newsreader weight `450`. This is the biggest type on the site.
- **Section H2:** `text-[1.9rem] md:text-[2.9rem]` (rails a touch smaller,
  `1.8rem md:2.7rem`), leading `1.1`, tracking `-0.01em`, Newsreader.
- **Sub-heading / tile label H3:** `text-[1.5rem]`–`text-[1.7rem] md:2.5rem`.
- **Body:** `16px`–`16.5px`, `leading-relaxed`, `text-ink-3`, max `46–60ch` per
  measure. Never run body wider than ~60 characters.
- **Kicker/eyebrow:** `text-[11px] uppercase tracking-[0.18em] text-ink-4`, mono.
- **Numeral motif:** `Nº 0X` in mono, `ink-4`, `tracking-[0.18em]` — the
  "curated edition" signal on major bands and tiles.

### Emphasis discipline (the plum `.em` rule)
- **The one-word italic-plum emphasis (`.em` / `em.brand`) is earned, not
  sprinkled.** Exactly one emphasized word per headline, and it carries the
  meaning ("Pleasure, worth getting *right*." / "Most picked, *right now*.").
  The `EmphasizedHeading` helper italicizes the **last word** by default; when a
  different word carries the point, mark it explicitly.
- Never two `.em` words in one heading. Never `.em` in body copy.
- Italic Newsreader at display scale is also our **pull-quote** treatment (Meet
  Emma). Pull-quotes are typographic art, not caption text.

---

## 3. Color — coral is the accent, plum is emphasis

The palette lives in `app/app.css` `@theme`. Use the **v3 token names**
(`paper`, `ink`, `coral`, `plum`, `sage`); the v2 aliases (`cream`, `sun`,
`butter`, `coral-deep`) are legacy and banned in new work. **No gradients. No
reintroduced orange. No old-cream backgrounds.**

### The coral budget (hard rule)
- **Coral (`#FF5A36`) is the primary-action color and it is rationed:** at most
  **one primary coral element per viewport** — normally the primary CTA. A second
  coral accent per full-bleed band is the ceiling, not the target. If two coral
  things fight for attention in one screen, one of them is wrong.
- `coral-2` is hover/secondary coral. `coral-soft` (`#FFE6DD`) is a **full-band
  tint fill**, not a text color.

### Plum and the rest
- **Plum (`#7A2BB8`) is emphasis, not action:** the `.em` word, the "Discover
  You" guided band, active/pressed CTA (`plum-2`). `plum-soft` (`#F3E8FB`) is a
  full-band tint fill.
- **Sage (`#7C8F78`)** is the quiet accent: the ♥ motif, tags, metadata, Emma
  asides. It never competes with coral.
- **Ink** (`#1A1418` → `ink-4` `#9A8F97`) is the type ramp and the one dark
  closer band. Body is `ink-3`; fine print `ink-4`; never body text lighter than
  `ink-3` on paper.
- **Lines** (`line` / `line-2` / `line-3`) are hairline borders and dividers at
  8% / 16% / 32% ink. Cards get a hairline `border-line`, not a shadow.

### The ♥ motif
Reserved for exactly three uses: **CTA labels** ("I'll take it ♥"), **Emma
asides**, and the **trust surfaces** (the trust-strip icons and the named
guarantee's sage ♥ mark, §6). Do not scatter hearts as decoration; at most two
♥ instances per viewport across all three uses. One signature "heartbeat"
animation per page, maximum (see §5).

### Contrast floor
**WCAG AA is the floor, not the goal.** Body text ≥ 4.5:1, large display ≥ 3:1.
White label over photography always sits on an ink scrim
(`linear-gradient(to top, rgba(26,20,24,0.72–0.75), transparent 55–60%)`) — never
white type on bare photo. When in doubt, run the contrast check; the future
`design-critic` scores color discipline partly on this.

### Radii
Everything `≥ lg` is **22px** (`--radius-lg` through `--radius-4xl`). Cards,
bands, tiles, pills: 22px. Small chips: `--radius-sm` 8px. Do not introduce new
radii.

---

## 4. Imagery — the product is the star (doctrine, promoted from the mission brief)

These are the mission brief §2 image directives, promoted to binding doctrine so
they outlive any single run. Every merchandising image obeys all of them.

1. **Every merchandising image shows what we sell** — the actual product (its
   real Shopify photo as a `--ref-image` Kontext reference) or a sensual human
   context matched to the link target (lingerie on a body, silk on skin, hands,
   playful tension). Props may support a product; they may never replace it.
2. **Bright, colorful, bold.** Daylight or high-key studio light, tinted
   color-block backdrops from the ground lock below (coral-soft, plum-soft,
   paper), product LARGE in frame. Premium DTC-launch energy.
3. **Banned looks, retired for cause:** tableware (tea cups, mugs, bowls,
   notebooks, candles, fruit, napkins, empty styled tables — the July 2026
   housewares failure); near-black / candlelit / boudoir-gloom (the moody round
   that followed); anything clinical or explicit.
4. **No text in the pixels.** No words, letters, captions, labels, logos,
   watermarks baked in. Copy lives in the markup. Add "no text, no words, no
   letters, no watermark, no logo, no caption" to every negative prompt.
5. **Hard limits (legal / processor / ad-platform):** no exposed genitalia, no
   nipples, no sex acts — nothing a premium lingerie campaign could not run.
   Short of that, push toward playful curiosity with charge underneath.
6. **Self-review before upload.** Reads clearly at 375px; hands/bodies/objects
   undistorted; product or sensual context unmistakably the subject; a
   design-literate friend believes it came from a high-end sexual-wellness brand.
   One fail → regenerate once with a corrected prompt. Two fails → use product
   photography or a compliant reused asset. Never publish an image you would not
   defend to Mike.
7. **Reuse-first, but only compliant assets.** Name and tag uploads with product
   handle + mood so future runs find them. The July 2026 housewares set stays
   retired.

### The four archetypes (live teardown, July 2026 — binding taxonomy)

Every generated merchandising image declares one archetype before prompting.
The archetypes come from the live competitor teardown
(`docs/homepage-team/competitor-teardown-2026-07-live.md`, "AI imagery + video
program"); prompts start from the matching per-surface scaffold in
`docs/homepage-team/image-prompt-library.md`.

- **A — hand-on-product.** Real Shopify photo as `--ref-image`, one undistorted
  hand holding or reaching, silk/linen/skin-adjacent surface. Scale, texture,
  and normalization in one frame — the cheapest expensive signal in the field.
  Uses: featured-product second image, PDP in-hand scale + macro detail, card
  flip frames. Vision-gate hard check: hand anatomy.
- **B — color-block still.** Product LARGE on one flat tinted field, soft
  shadow, exactly one styling echo of the product's own color (a prop or
  manicure that rhymes). Uses: wayfinder tiles, rail cards, ranked-set tiles,
  promos.
- **C — in-situ bright scene.** Product in a believable sunlit private space
  among personal objects, or a human presence (hands, thigh, torso, or full
  figure with face visible — the former never-face-on rule is withdrawn, owner
  directive 2026-07-28: more faces help customers feel seen; never explicit).
  Bright, never boudoir-gloom. Uses: hero, photo/couples band, occasion edits,
  human-context wayfinder tiles, Notebook human heroes (per
  `docs/notebook-team/image-brief.md` §0-H).
- **Depicted-people hard rules (bind every archetype that shows a person):**
  **no images of children, ever** — and because generation drifts young without
  being asked to, the rule is enforced as *unambiguous adulthood*: prompts state
  adult age markers, and the vision gate hard-rejects any face or body with
  youthful ambiguity, on ambiguity rather than intent. Uncanny faces (dead eyes,
  warped features, wrong teeth) are an automatic reject. Vary age, body type,
  and skin tone deliberately across assets. Emma's likeness follows the approved
  Emma-likeness policy; expressive/emotional depictions of Emma and her fictional
  friends are licensed on Notebook human-hero surfaces (they are openly
  hyperbolic fiction, not lived-experience claims).
- **D — editorial metaphor macro.** One tasteful single-concept scene (silk,
  water, soft foil, fruit) standing in for sensation. Uses: PDP mood slides,
  Notebook cover system.

**The ground lock:** backdrops come only from `coral-soft`, `plum-soft`, and
`paper` tints, high-key daylight (sage is an accent color, never a ground: there
is no soft sage tint token, and a full-strength sage field fights the high-key
mandate). This constraint is what makes a
mixed-vendor catalog read as one funded brand; the teardown's core finding is
that **consistency, not budget, is the "million dollars" signal** — normalizing
ground and light behind inconsistent supplier photos is the highest-leverage
move and needs zero reshoots.

---

## 5. Motion — the editorial reveal, and what stays still

Use the **repo-native primitives only.** Do not hand-roll IntersectionObserver
or `whileInView` per component.

- `useReveal()` (`app/lib/use-reveal.ts`) — mount-gated, reduced-motion-aware.
- `<Reveal variant delay index once as>` (`app/components/motion/Reveal.tsx`).
- `variants.ts` — springs, stagger, the one-shot `heartbeat`.

### Reveal variant per archetype (as shipped)
| Section archetype | Variant | Notes |
|---|---|---|
| Hero text column | `up` **disabled** | Above the fold → renders visible immediately (SSR final state) |
| **Hero LCP image** | **none — never wrapped** | Zero CLS. This is the hardest rule in the doctrine. |
| Product grid | `up` with `index` stagger | Per-card, `STAGGER_STEP` 0.06s, clamp 8 |
| Horizontal rail | `fade` on the **whole block** | Never per-card inside a scroller |
| Editorial band / tile | `up` or `scale` | `scale` (0.97→1) for hero-adjacent plates and promo tiles |
| Trust strip | `fade` | Quiet |

### Budgets
- **Stagger:** `STAGGER_STEP` 0.06s between siblings, clamped at index 8 so long
  grids don't lag the last card. Reading rhythm wins over choreography.
- **Durations:** fast 150ms / base 240ms / slow 420ms; eases
  `--ease-entrance` (weighted ease-out) for entrances, `--ease-standard` for
  state, `--ease-exit` for exits. Springs (`springEntrance`) settle with body,
  never bouncy.
- **Travel:** `--reveal-distance` 16px only. No big slides.
- **One heartbeat per page.** The `♥` `heartbeat` fires once, on entrance, never
  loops. One signature beat — usually the Meet Emma or a hero ♥ — and no more.
- **Reduced motion always renders the final state.** Every entrance must look
  correct with animation fully off.
- **`layout` prop only on filter grids** (discovery/PLP), never on content bands.

---

## 6. Components — the shipped vocabulary

Design **within** this set; propose new components through Routine B, don't
freelance one-offs. The homepage shell (`StorefrontHome.tsx`) is the canonical
gallery until `/admin/design-gallery` ships (design-elevation p1-gallery).

- **Hero** (editorial split): text column + coral-soft framed product still with
  inset vignette. LCP image unwrapped. CTA pair: one primary coral, one ghost.
- **Trust strip:** hairline-topped row, sage ♥ + four trust lines, inside the
  first viewport.
- **Product grid** (`ProductGrid`): 2-up mobile / 4-up desktop, hairline-framed
  cards, tight gutters — a "considered set," the wall of product.
- **Rail** (`Rail`): calm horizontal scroller, 220px cards, snap-x, hidden
  scrollbar. Contrast with the grid gives the page rhythm.
- **Editorial band** (`PhotoBand`, wayfinder promo, closer): full-bleed tint or
  photo + ink scrim + white label + one CTA.
- **Numeral motif** (`SectionNumeral`): `Nº 0X` mono tag on major bands/tiles.
- **Emma aside / pull-quote:** italic Newsreader, sage/coral ♥, display scale.
- **CTA:** rounded-full (22px), coral primary / ghost secondary; label from the
  voice whitelist only ("Take a peek →", "Show me", "Find your fit →",
  "I'll take it ♥"). Never "Buy now." Never duplicate the primary's label on the
  secondary.

### Proof & trust components (live teardown, July 2026 — binding)

The trust architecture every credible competitor runs, adapted to what xdipx can
deploy honestly (full rationale: `competitor-teardown-2026-07-live.md`, "Trust
architecture").

- **Never fabricate proof.** No invented review counts, press logos, awards,
  tenure claims, or named testimonials, ever. Proof surfaces render only when
  the underlying data is real; otherwise they stay suppressed — an empty slot
  beats a fake one ((0.0) stars and "1 review" cards actively destroy trust).
- **Reviews render above a threshold only.** Stars + exact count on cards and
  PDPs once a product clears a defensible review count; hard-suppressed below
  it.
- **The guarantee is a proper noun.** One named, time-boxed guarantee with a
  sage ♥ mark, seated in the trust strip AND beside the primary CTA at the buy
  box (trust at the button converts buyers; trust at the top only reassures
  browsers). Name and terms are owner-approved before first publish.
- **Discretion copy names the dreaded moments.** The box on the porch, the
  shipping label, the card statement (canonical phrase: "Your statement reads
  XDIPX.") — mechanics, not badges. Wording gated by `emma-empathy-reviewer`
  against `docs/emma-voice.md`.
- **The footer is a legitimacy document.** Payment marks, returns/privacy/
  shipping/18+/accessibility links, "reach a human at hello@xdipx.com," a quiet
  brands-we-carry row. Wary first-timers (and ad-network reviewers) read the
  footer before trusting the card form.
- **Borrowed credibility on cards.** The manufacturer brand renders as a mono
  ink-4 eyebrow on every product card (`p.brand` is already in the payload).

---

## 7. What best-in-market looks like — the reference bench

Design agents should keep these in the eye. Not to copy — to steal the *specific*
thing each does better than anyone. Refresh this list in the weekly teardown
(design-elevation p3-teardown); the current decision doc is
`docs/homepage-team/competitor-teardown-2026-07-live.md` (site-by-site findings
from real July 2026 captures). One advisory note from it: the field runs a
seven-beat homepage spine (hero → trust strip → wayfinding → finite bestseller
set → guide moment → proof stack → editorial + email + legitimacy footer);
useful for judging section order, but the locked Nº01–Nº11 shell remains the
binding IA — the spine never overrides the routine-design-cycle IA fence.

| Reference | Steal this, specifically |
|---|---|
| **Aesop** | Restraint. How much white can carry meaning when type and product are perfect. Editorial product copy as design. |
| **Glossier** | Warmth on white. Soft pinks used with discipline; approachable without being childish. |
| **Maude** | The calm, shame-free register for exactly our category. Muted palette, generous space, zero innuendo. |
| **Dame** | Category-adjacent confidence: plain product talk, bright product-forward photography, playful not crude. |
| **Apple product pages** | Scroll choreography and the "one idea per viewport" discipline. Motion that serves comprehension. |
| **Glossier / Away** | The dense-but-airy product grid; hairline frames; the "considered set" feeling. |
| **Cartier / Hermès editorial** | The numeral/"edition" motif and serif display authority. Luxury without gradients. |
| **Arket / COS** | Muted, grown-up color-blocking; how a tinted band carries a section. |
| **Stripe / Linear** | Interaction craft and reduced-motion respect (for the discovery/finder surfaces, not the storefront gloss). |
| **Lovehoney / Spectrum (opening grid only)** | The wall-of-product open above the fold. We take the density, we reject their urgency banners and clutter. |
| **Vush** | Grid consistency as the money signal: one render language for every SKU, one signature material detail, proof printed in the hero (stars + count above the H1 — ours waits for real reviews). |
| **Honey Play Box (closing act only)** | The pre-footer proof sequence: reviews → community → awards → press → trust icons → payment marks. End on safety. Ours renders only the slots we can fill honestly. |
| **sextoy.com (card system only)** | Uniform tinted packshot tiles, mono intent kickers ("EASY START"), one dark card per grid row for rhythm, the finite ranked "Top Ten" franchise. |
| **TooTimid (trust scaffolding only)** | The three-part mechanical discretion promise (box / label / statement) and the PDP macro row (texture, in-hand scale, tip detail). We take the mechanics, we reject everything else on that page. |

---

## 8. Acceptance — how this doctrine is used

- **`homepage-designer`** cites the doctrine (chosen moves, token usage, motion
  brief) in every art-direction doc, above any agent-def summary.
- **`rr7-engineer`** builds to these tokens/rhythm/motion; a section that
  invents a new max-width, radius, coral budget, or motion pattern is a defect.
- **`design-critic`** (design-elevation Phase 2) scores its rubric — hierarchy,
  spacing rhythm, type discipline, color discipline, imagery, motion restraint —
  **against this doctrine**; the doctrine is its answer key.
- **`qa-reviewer`** keeps functional acceptance (typecheck/build/tests/CLS); the
  doctrine is the visual half.

### The zero-CLS non-negotiables, restated so nothing buries them
1. **Never wrap the LCP hero image** in a reveal/motion wrapper.
2. Transform/opacity only for entrances; no layout-shifting animation.
3. SSR renders the final/visible state; reduced motion renders the final state.
4. Fixed aspect ratios on all media frames.

---

*v1.1 — 2026-07-21. Adds the four imagery archetypes, the proof & trust
components, and the refreshed reference bench from the live competitor teardown
(`docs/homepage-team/competitor-teardown-2026-07-live.md`).*

*v1 — 2026-07-15. Codifies the shipped v3 token system, the redesign-v2 art
direction, and the Motion primitives as the binding visual charter. Ongoing
maintenance and any agent-definition binding-references land through the
agent-editor PR lane; content of the doctrine itself is a `homepage-designer`
Routine B deliverable.*
