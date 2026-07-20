# Tracker — Design Elevation Program

Program: Design Elevation (best-in-market automated design output)
Source plan: docs/homepage-team/design-elevation-plan.md
Started: 2026-07-13   Target end: 2026-08-10 (phases 1–4), then ongoing cadences
Overall: GREEN

Week anchors: W1 = 2026-07-13, W2 = 2026-07-20, W3 = 2026-07-27, W4 = 2026-08-03.

| id | milestone | phase | owner | target week | status | RAG | evidence probe | last verified | notes |
|---|---|---|---|---|---|---|---|---|---|
| p1-stack | Design capability stack installed (taste-skill, ui-ux-pro-max, Emil Kowalski animation skill) | 1 | owner + agent-editor | 2026-07-13 | not-started | GREEN | `.claude/skills/` contains the three skill dirs with a `SKILL.md` each | — | shadcn/ui MCP wiring counts as part of this milestone |
| p1-doctrine | `docs/design-doctrine.md` written and binding | 1 | homepage-designer | 2026-07-13 | in-review | GREEN | file exists AND `.claude/agents/homepage-designer.md` references it | 2026-07-17 | doctrine merged in PR #258; homepage-designer + media-manager binding references in the design-gates PR |
| p1-gallery | `/admin/design-gallery` component gallery route merged | 1 | rr7-engineer (Routine B PR) | 2026-07-13 | not-started | GREEN | `app/routes/admin.design-gallery.tsx` exists on main | — | also the screenshot harness's stable target |
| p2-critic | `design-critic` agent exists and gates Routine B step 4 | 2 | agent-editor PR | 2026-07-20 | in-review | GREEN | `.claude/agents/design-critic.md` exists AND `docs/homepage-team/routine-design-cycle.md` step 4 lists it | 2026-07-17 | both halves in the design-gates PR; calibrate against 5 good + 5 bad historical screenshots before it may BLOCK |
| p2-critic-a | Routine A post-publish design spot-check live | 2 | homepage-orchestrator | 2026-07-20 | in-review | GREEN | `docs/homepage-team/routine-daily-merchandise.md` includes the spot-check step AND a merchandise run has a `design-critic` event | 2026-07-17 | step 7.5 in the design-gates PR; first `design-critic` event still pending a live run. REVISE files a suggestion; BLOCK triggers Sanity rollback (REVISE-only until calibrated) |
| p2-snapshots | Playwright screenshot + visual-regression harness with committed baselines | 2 | rr7-engineer (PR) | 2026-07-20 | not-started | GREEN | `scripts/design-snapshots.ts` exists AND `tests/visual/` contains baseline images | — | masks product-image regions on content-only runs |
| p3-lighthouse | Lighthouse CI budgets on PR previews (LCP ≤2.0s, CLS 0, perf ≥90 mobile) | 2 | rr7-engineer (PR) | 2026-07-27 | not-started | GREEN | a Lighthouse CI config exists (e.g. `lighthouserc*`) AND a CI workflow runs it on PRs | — | |
| p3-axe | axe accessibility sweep in the harness (zero serious/critical) | 2 | rr7-engineer (PR) | 2026-07-27 | not-started | GREEN | `@axe-core/playwright` in `package.json` AND referenced from the harness | — | |
| p3-img-gate | Vision gate on every generated image before upload; ref-image mandatory | 2 | media-manager | 2026-07-27 | in-review | GREEN | `.claude/agents/media-manager.md` documents the gate AND `scripts/gen-homepage-image.ts` refuses missing `--ref-image` without `--no-ref` | 2026-07-17 | both in the design-gates PR (`--no-ref` requires a logged `--no-ref-reason`); kills the tea-cup failure class |
| p3-prompts | Image prompt library seeded and maintained | 2 | media-manager | 2026-07-27 | in-review | GREEN | `docs/homepage-team/image-prompt-library.md` exists with ≥1 per-surface scaffold | 2026-07-17 | seeded with 5 per-surface scaffolds in the design-gates PR |
| p3-teardown | Weekly competitor/reference teardown sub-step in Routine B | 3 | homepage-designer | 2026-07-27 | in-review | GREEN | `docs/homepage-team/routine-design-cycle.md` includes the teardown step AND a design run has a teardown event | 2026-07-20 | step 0.5 + first decision doc (`competitor-teardown-2026-07.md`) in the design-performance PR; live-fetch re-run owed by the cloud routine (this session's egress blocked competitor hosts) |
| p4-events | Per-section GA4 engagement events + per-module PDP click-through | 4 | rr7-engineer (PR) | 2026-08-03 | not-started | GREEN | section-visibility events wired in the analytics layer on main | — | gives the 70% product-link rule an outcome metric |
| p4-changelog | Design changelog appended by both routines | 4 | homepage-orchestrator | 2026-08-03 | not-started | GREEN | `docs/homepage-team/design-changelog.md` exists and has post-launch entries | — | |
| p4-retro | First measured design retro + critic-score dashboard panel | 4 | homepage-orchestrator + rr7-engineer | 2026-08-03 | not-started | GREEN | dashboard shows critic scores AND a retro event references them | — | definition of done: critic avg ≥4.5 four straight weeks |

Ongoing cadences (tracked as health checks once phases close, not milestones): weekly teardowns,
monthly prompt-library pruning, quarterly hi-fi refresh + full-site design audit.

## Status log

### 2026-07-20 — owner push: flip to variant b, budgets lifted, perf pass (design-performance PR)

Mike called the live homepage cheap-looking, boring, and slow, and directed: competitor-informed
design narrative, lifted budgets, fastest-possible load. Plan was team-reviewed (orchestrator, IA,
designer, CRO, tech-architect) before execution. Landing in the `claude/home-page-design-performance`
PR: competitor teardown decision doc + recurring Routine B step 0.5 (p3-teardown → in-review),
budget-lift migration 063 (daily $600, 100 images/day, build $500 advisory, 10 runs/day), Sanity CDN
srcset/AVIF in OptimizedImage, CDN-aware hero preload helper, GA4 flip instrumentation
(home_variant_view, guided-path cta_click, home_scroll_depth) plus a web-vitals reporter
(partial p4-events progress), and a variant-aware healthcheck rewarm. Flip sequence (owner-approved):
fold-first imagery pass → design-critic gate on the real content state (flat photographic band =
BLOCK) → PR merge + deploy → set Sanity `homeConfig.activeVariant='b'` AND `HOME_VARIANT=b` →
7-14 day keep/rollback watch on add-to-cart per session, guided-entry rate, engagement rate.
GA4 baseline capture for the comparison is owed by the next team run with GA4 access
(this session had none). Rollback is manual: revert both the Sanity flag and the env var.

Pre-flip design-critic gate ran against the LIVE variant-b content state (screenshots of
`/?variant=b`, 375px first): verdict **BLOCK**, mobile avg 3.2 (type 4.5, spacing 4, hierarchy 3.5,
color 2, imagery 2). Code fixes landed in this PR: discount/SALE badges coral→ink, Sale nav
coral→plum, announcement bar can no longer render coral, editorial tile double-arrow dedup, hero
tightened at 375px so the product still enters the first viewport. **Content-plane fixes owed by
the merchandising team before the flip (no deploy needed):** (1) hero pick image is the Camtoyz
Kian retail PACKAGING BOX with baked-in text, swap to the bare-product still; (2) couples band
photo is candlelit boudoir-gloom, a retired imagery class, swap to a bright high-key for-two shot;
(3) announcement bar copy carries emojis + exclamations, re-register to calm editorial; (4) prefer
bare-product over box shots across rails where the Shopify record has them. Re-run the critic
after those swaps; flip only on PASS. QA checks passed: all five guided-path collections return
24 products, JSON-LD on variant b is ItemList + FAQPage only.

### 2026-07-17 — media-manager v3 fix + quality gates PR (owner-directed)

Mike flagged that generated imagery still reads amateur; root causes: media-manager was carrying
retired v2 brand rules (coral #FF4B1F, cream backgrounds, "no purple") and none of the gate
milestones had started. One PR now lands: media-manager rebound to the v3 palette + doctrine,
homepage-designer doctrine binding (closes the p1-doctrine probe), the `design-critic` agent wired
into Routine B step 4 and Routine A step 7.5, the `--ref-image` refusal in
`scripts/gen-homepage-image.ts`, and the seeded prompt library. Five milestones move to in-review;
evidence probes pass on merge. Still open in phase 1–2: p1-stack, p1-gallery, p2-snapshots.

### 2026-07-11 — seeded (baseline)

Overall GREEN. Tracker created from the merged plan (PR #233); W1 has not started, all
milestones `not-started` by definition. No probes pass yet. First real audit lands with the
next Monday weekly strategy run.
