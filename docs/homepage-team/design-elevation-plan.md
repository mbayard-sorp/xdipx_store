# Design Elevation Plan — Best-in-Market Automated Design Output

**Goal.** The homepage team already runs autonomously. This plan makes what it ships *look* like
the best design team in the market shipped it — consistently, without a human art director in the
loop on every run. The strategy is threefold: (1) actually install and codify the taste the agents
are supposed to have, (2) put automated design-quality gates in the pipeline so sub-par work
cannot ship, and (3) close the loop so design quality is measured and compounds week over week.

Owner: store owner. Executing agents: `homepage-designer`, `qa-reviewer`, `media-manager`,
`rr7-engineer`, `homepage-orchestrator`, plus one new agent proposed below (`design-critic`).
All code/config changes here go through reviewed PRs per the standing carve-out rules.

---

## Where we actually are (honest audit)

**What's strong**

- A real, opinionated design system: v3 tokens in `app/app.css` (paper/ink/coral/plum/sage,
  Newsreader + DM Sans + JetBrains Mono), motion tokens, and a single SSR-safe motion primitive
  (`useReveal` / `<Reveal>` / `variants.ts`). Most stores never get this far.
- Hard craft constraints already written into the agents: mobile-first @375px, zero CLS, never
  wrap the LCP hero, SSR-visible final state, coral-sparingly/plum-for-emphasis.
- A two-routine pipeline with human-gated PRs for structural change and a preview URL per cycle.
- A hi-fi visual reference (`hifi-reference.html`, claude.ai/design pass) the team can measure
  against.

**The gaps this plan closes**

1. **The design capability stack is aspirational, not installed.** `homepage-designer` and
   Routine B tell agents to load `taste-skill`, `ui-ux-pro-max`, Emil Kowalski's animation skill,
   and the shadcn/ui MCP — none of these exist in `.claude/skills/` today (only marketing skills
   are installed). The art director is designing from memory, not from the stack we promised it.
2. **No design-quality gate.** `qa-reviewer` verifies typecheck/build/tests/CLS. Nothing scores
   hierarchy, spacing rhythm, type scale discipline, contrast, or whether a section actually looks
   good. A structurally correct but visually mediocre PR sails through.
3. **No visual regression safety net.** Content auto-publishes daily with rollback only on hard
   healthcheck failure (200 / LCP / JSON-LD). A run can degrade the page visually and nothing
   notices.
4. **Image quality has already failed in production** (July 2026: tea cups, ceramic bowls,
   notebooks as tile art; then a near-black moody round). The mission brief now has standing
   rules, but enforcement is "the agent remembers to follow them" — there is no vision-model
   gate on generated art before it ships.
5. **No taste input loop.** The designer has no scheduled exposure to what best-in-market looks
   like right now (competitor teardowns, editorial commerce references), so its taste is frozen
   at whatever the base model knows.
6. **No design accountability metric.** Retros exist, but nothing ties "we redesigned the hero"
   to scroll depth, section engagement, or PDP click-through per module.

---

## Phase 1 — Install the taste (week 1)

*Give the agents the capability stack they were promised, and one canonical design doctrine.*

### 1.1 Install the design capability stack for real

- Install as project skills under `.claude/skills/` (so cloud routines get them on checkout):
  - **Emil Kowalski's animation skill** (`https://emilkowal.ski/skill`) — interaction/animation
    craft on top of our Motion primitives.
  - **`taste-skill`** (style router) and **`ui-ux-pro-max`** (palettes, type pairing, UX
    patterns) — or, if these specific packs aren't obtainable, write our own equivalent (see
    1.2); the point is a loadable artifact, not a name.
  - **`dataviz`** is already available at the harness level for any stat/chart surfaces.
- Wire the **shadcn/ui MCP** into the routine's MCP config as a component-pattern reference
  (reference only — we build RR7-native, we don't adopt shadcn wholesale).
- Acceptance: `homepage-designer` can `Skill`-load every item its definition names, verified in
  one Routine B dry run.

### 1.2 Write `docs/design-doctrine.md` — the single design source of truth

A charter for visuals with the same authority `docs/emma-voice.md` has for words. Consolidates
and extends what's scattered across CLAUDE.md, the agent defs, and the mission brief:

- Layout: the 375px grid, spacing scale and vertical rhythm rules, max content widths,
  section-to-section breathing room.
- Type: the Newsreader/DM Sans scale (explicit sizes/leading per breakpoint), when italic-plum
  emphasis is earned, kicker usage.
- Color: coral budget per viewport (e.g. one primary coral element above the fold), plum/sage
  usage rules, tint-vs-solid guidance, contrast minimums (WCAG AA as floor).
- Imagery: the mission-brief image directives promoted to doctrine (product is the star,
  bright/colorful/bold, ref-image-first, banned looks: tableware, near-black moody, clinical).
- Motion: which `Reveal` variant per section archetype, stagger budgets, the "one heartbeat per
  page" rule, what must stay static.
- An explicit **"what best-in-market looks like" reference list**: 8–12 named editorial-commerce
  references (e.g. the caliber of Maude, Dame, Glossier, Aesop, Apple product pages) with one
  line each on *what specifically* to learn from them.
- Acceptance: `homepage-designer`, `rr7-engineer`, and the new `design-critic` all cite the
  doctrine as a binding input; the doctrine wins over agent-def summaries where they disagree.

### 1.3 Component gallery route: `/admin/design-gallery`

A single admin-gated page that renders every store component (hero variants, rails, tiles,
mosaic, trust strip, Emma asides) with sample data, at a glance. This is our Storybook without
adopting Storybook (bad fit for RR7 serverless; a route is zero new infra).

- Serves three jobs: human eyeballing, the screenshot harness's stable target (Phase 2), and the
  designer agent's "what exists" inventory.
- Built by `rr7-engineer` via a Routine B PR. Estimated: 1 cycle.

---

## Phase 2 — Gate the quality (weeks 2–3)

*Make it structurally impossible for sub-par design to ship.*

### 2.1 New agent: `design-critic`

A dedicated, adversarial design reviewer, separate from `qa-reviewer` (which stays functional
QA). It reviews **screenshots, not code**:

- Input: preview-MCP screenshots at 375 / 768 / 1440 of every changed surface, plus the doctrine
  and the hi-fi reference.
- Scores a fixed rubric, 1–5 each: visual hierarchy, spacing rhythm, type discipline, color
  discipline (coral budget respected?), imagery quality, motion restraint, overall "would a
  top-tier design team ship this?".
- Verdict: PASS (≥4 avg, no dimension ≤2) / REVISE (with specific, actionable notes: "the rail
  cards' 12px gap breaks the 16px rhythm established by the hero") / BLOCK.
- Wired into **Routine B step 4** as a mandatory gate alongside tech-architect/qa/voice, and
  into **Routine A** as a cheap post-publish spot-check (score today's published homepage; a
  REVISE files a suggestion, a BLOCK triggers the existing Sanity rollback path).
- Mirrors the `emma-empathy-reviewer` pattern that already works for voice. Definition lives in
  `.claude/agents/design-critic.md` (ships via the agent-editor PR path).

### 2.2 Screenshot + visual-regression harness

> **NOT BUILT, and not scheduled.** Nothing in this subsection exists: there is no
> `scripts/design-snapshots.ts`, no `tests/visual/` directory, and no Playwright dependency in
> `package.json`. The capture pipeline that would have delivered it was cut by the owner on
> 2026-07-30. Read the rest of this subsection as a design sketch for whenever it is revived, not
> as a description of anything running today.


- Playwright script (`scripts/design-snapshots.ts`, Chromium is pre-installed in the agent
  environment) captures the homepage, `/discover`, one PDP, and the design gallery at
  375/768/1440, light payloads, animations disabled via reduced-motion.
- Baselines committed under `tests/visual/__snapshots__/`; diffs via Playwright's
  `toHaveScreenshot` (pixelmatch under the hood). Runs in CI on every homepage-team PR and as a
  post-publish step in Routine A against the live URL.
- A diff above threshold on a *content-only* run = expected (products rotate) → the harness
  masks product imagery regions and diffs the chrome/layout only; layout diff on a content run
  is a red flag → event + suggestion.
- Hosted alternative if we outgrow this: **Argos CI** or **Chromatic** (both have free tiers,
  purpose-built review UI). Start in-repo; graduate only if diff-review volume justifies it.

### 2.3 Performance + accessibility budgets in CI

Best-in-market design *feels* fast and works for everyone:

- **Lighthouse CI** on the Vercel preview of every homepage-team PR: budgets LCP ≤ 2.0s (lab),
  CLS = 0, TBT ≤ 200ms, perf score ≥ 90 mobile. Fails the check, blocks merge.
- **@axe-core/playwright** sweep in the same harness: zero serious/critical violations
  (contrast, alt text, focus order). Feeds `design-critic`'s color-discipline score.
- **Vercel Speed Insights** enabled for field data (real-user CWV), read in retros.

### 2.4 Imagery gate (kills the tea-cup class of failure)

- Extend `media-manager`'s flow: every generated image is reviewed by a vision pass **before
  upload** against a fixed checklist derived from the mission brief — (a) shows a product we
  sell or a sensual human context matched to the link target, (b) bright/colorful/bold, not
  moody/dark, (c) palette-compatible, (d) no uncanny artifacts (hands, text, warped objects),
  (e) tasteful, never clinical or explicit. Fail → regenerate (bounded by `max_images`), twice
  failed → fall back to the product's real Shopify photo.
- Harden the ref-image-first rule: `scripts/gen-homepage-image.ts` refuses a merchandising
  generation with no `--ref-image` unless an explicit `--no-ref` flag is passed with a logged
  reason.
- Build a **prompt library** (`docs/homepage-team/image-prompt-library.md`): per-surface
  (hero / rail card / tile / mood band) prompt scaffolds that have produced keepers, with
  thumbnails, maintained by `media-manager` each run. Good prompts compound; today they
  evaporate.

---

## Phase 3 — Continuous taste input (week 3, then ongoing)

*Best-in-market is a moving target; the team needs scheduled exposure to it.*

- **Weekly teardown sub-step in Routine B:** before wireframing, `homepage-designer` WebFetches
  2–3 references (rotating through the doctrine's reference list + anything new from awards
  sites/competitor launches) and writes a 10-line "what they do better than us / what we do
  better" note. Rejected and adopted ideas both get logged so taste compounds across cycles —
  same mechanism as the existing ambition-mandate concept log.
- **Hi-fi exploration lane:** for big swings, keep using claude.ai/design → the **`DesignSync`**
  tool / **Vercel `import-claude-design-from-url`** flow that produced `hifi-reference.html`.
  The routine treats imports as *visual reference only* (re-implemented natively), exactly as
  the existing claude-design-prompt doc prescribes. Refresh the hi-fi reference once a quarter
  so the north star doesn't go stale.
- **Design review threads on previews:** adopt the **Vercel Toolbar** comment threads
  (MCP tools already connected: `list_toolbar_threads`, `reply_to_toolbar_thread`) so the owner
  can drop pin-pointed visual feedback on any preview deploy and the next Routine B run reads
  and resolves the open threads. This turns the owner's taste into structured training signal
  instead of ad-hoc chat.

---

## Phase 4 — Measure and compound (week 4, then ongoing)

- **Per-section engagement instrumentation:** GA4 events for section visibility (IntersectionObserver
  once, in the analytics layer, not per-component) + per-module PDP click-through. The mission
  brief's 70% product-link ratio finally gets an outcome metric: which modules *earn* their
  clicks.
- **Design changelog (NOT BUILT):** the intent is that every Routine A publish and Routine B merge
  appends one line plus a screenshot reference to `docs/homepage-team/design-changelog.md`. That
  file does not exist and nothing writes it. Retros correlate changelog entries with
  GA4 deltas (still ≥300 sessions/week before weighting, per existing rule).
- **Critic scores as a time series:** `design-critic` verdicts land as `/event` rows; the
  dashboard charts average rubric score per week. The number should go up. If it plateaus below
  4.5, that is the retro agenda.
- **Quarterly design audit:** one scheduled deep pass (design-critic at high effort over every
  route, not just the homepage) producing a ranked fix list that feeds Routine B backlogs.

---

## Tools to integrate — summary and verdicts

| Tool | Purpose | Verdict |
|---|---|---|
| Emil Kowalski animation skill, taste-skill, ui-ux-pro-max | Designer capability stack (already referenced, not installed) | **Adopt now** (Phase 1) |
| shadcn/ui MCP | Component-pattern reference for designer/engineer | **Adopt now** (reference only) |
| Playwright screenshots + `toHaveScreenshot` | Visual regression, critic input | **Adopt now** (Chromium pre-installed, zero spend) |
| Lighthouse CI | Perf/CWV budgets on PR previews | **Adopt now** |
| @axe-core/playwright | Automated a11y sweep | **Adopt now** |
| Vercel Toolbar threads (MCP already connected) | Owner design feedback on previews → structured signal | **Adopt now** |
| Vercel Speed Insights | Field CWV data for retros | **Adopt now** (trivial) |
| claude.ai/design + DesignSync + Vercel design import | Hi-fi exploration lane for big redesigns | **Keep, formalize quarterly** |
| fal.ai Kontext ref-image pipeline | Product-true image generation | **Keep, harden** (mandatory ref-image, vision gate) |
| fal.ai upscaler (e.g. aura-sr) + background removal (birefnet) | Hero-grade art from product photos, clean cutouts for tiles | **Adopt in Phase 2.4** (cents per image) |
| Argos CI / Chromatic / Percy | Hosted visual review UI | **Defer** — in-repo diffing first; graduate on volume |
| Storybook | Component workshop | **Skip** — `/admin/design-gallery` route covers it with zero new infra |
| Figma / Figma MCP | Traditional design handoff | **Skip for now** — no human designer in the loop; the claude.ai/design lane covers hi-fi exploration |
| Satori / @vercel/og | Designed OG share cards per product/post | **Nice-to-have Phase 4** — extends the design system beyond the site itself |

Cost note: everything marked "adopt now" runs on Max-billed agent reasoning, free CI, or
pre-installed tooling. The only new metered spend is the imagery-gate regenerations and optional
upscaling — cents per day, inside the existing `homepage_team_max_images` and daily-cents caps.

---

## Sequenced rollout

| Week | Deliverable | Path |
|---|---|---|
| 1 | Design stack installed; `docs/design-doctrine.md`; gallery route PR | Routine B PR + agent-editor PR |
| 2 | `design-critic` agent + Routine A/B wiring; screenshot harness + baselines | agent-editor PR + reviewed PR |
| 3 | Lighthouse CI + axe budgets; imagery gate + prompt library; teardown sub-step live | reviewed PRs + routine playbook edits |
| 4 | Section-engagement events; design changelog; critic-score dashboard panel; first measured retro | reviewed PR |
| Ongoing | Weekly teardowns, monthly prompt-library pruning, quarterly hi-fi refresh + full-site audit | routines |

## Risks

- **Critic too lenient / too strict.** Calibrate in week 2 against 5 known-good and 5 known-bad
  historical screenshots (the tea-cup run is a labeled negative). Tune the rubric until it
  separates them cleanly before it can BLOCK anything.
- **Visual-diff noise from daily content rotation.** Mitigated by masking product-image regions;
  if noise persists, diff only the gallery route (fixed sample data) in CI and use the critic,
  not pixels, for the live page.
- **Gate stacking slows Routine B.** All new gates run in the existing step-4 review phase in
  parallel with qa/voice; budget one extra turn, inside the current turn cap. If cycles start
  hitting `maxTurns`, drop the critic to sampling on Routine A (it stays mandatory on B).
- **Max quota pressure.** The critic and teardown add ~2 agent invocations/week plus a daily
  spot-check; well inside `homepage_team_max_runs`, but watch `/admin/usage` in week 2.

## Definition of done

1. Every homepage-team PR carries: screenshots at 3 breakpoints, a design-critic PASS, green
   Lighthouse/axe budgets, and a zero-CLS proof.
2. Every published merchandising image passed the vision gate or is a real product photo.
3. The designer demonstrably loads its full capability stack and cites the doctrine + a current
   teardown in each art-direction doc.
4. Critic rubric average ≥ 4.5 sustained for four consecutive weeks, with GA4 section engagement
   flat-or-up — that is "best in market", made measurable.
