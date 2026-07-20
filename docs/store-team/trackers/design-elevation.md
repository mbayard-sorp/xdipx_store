# Tracker — Design Elevation Program

Program: Design Elevation (best-in-market automated design output)
Source plan: docs/homepage-team/design-elevation-plan.md
Started: 2026-07-13   Target end: 2026-08-10 (phases 1–4), then ongoing cadences
Overall: RED

Week anchors: W1 = 2026-07-13, W2 = 2026-07-20, W3 = 2026-07-27, W4 = 2026-08-03.

| id | milestone | phase | owner | target week | status | RAG | evidence probe | last verified | notes |
|---|---|---|---|---|---|---|---|---|---|
| p1-stack | Design capability stack installed (taste-skill, ui-ux-pro-max, Emil Kowalski animation skill) | 1 | owner + agent-editor | 2026-07-13 | not-started | RED | `.claude/skills/` contains the three skill dirs with a `SKILL.md` each | 2026-07-20 | shadcn/ui MCP wiring counts as part of this milestone. Audit: `.claude/skills/` holds 35 marketing-strategy skill dirs (ab-test-setup, seo-audit, page-cro, …) but none of the three design skills — never installed, 1 week overdue. Suggestion #59 filed. |
| p1-doctrine | `docs/design-doctrine.md` written and binding | 1 | homepage-designer | 2026-07-13 | done | GREEN | file exists AND `.claude/agents/homepage-designer.md` references it | 2026-07-20 | doctrine merged in PR #258; homepage-designer + media-manager binding references confirmed on `main`. Probe passes. |
| p1-gallery | `/admin/design-gallery` component gallery route merged | 1 | rr7-engineer (Routine B PR) | 2026-07-13 | done | GREEN | `app/routes/admin.design-gallery.tsx` exists on main | 2026-07-20 | also the screenshot harness's stable target. Audit: route confirmed on `main` (PR #269, merged 2026-07-19). Probe passes, late but done. |
| p2-critic | `design-critic` agent exists and gates Routine B step 4 | 2 | agent-editor PR | 2026-07-20 | done | GREEN | `.claude/agents/design-critic.md` exists AND `docs/homepage-team/routine-design-cycle.md` step 4 lists it | 2026-07-20 | both halves confirmed on `main`; calibrate against 5 good + 5 bad historical screenshots before it may BLOCK. Probe passes. |
| p2-critic-a | Routine A post-publish design spot-check live | 2 | homepage-orchestrator | 2026-07-20 | done | GREEN | `docs/homepage-team/routine-daily-merchandise.md` includes the spot-check step AND a merchandise run has a `design-critic` event | 2026-07-20 | step 7.5 confirmed; `design-critic` decision events found on merchandise runs 46 (Jul 18), 49 (Jul 19), 53 (Jul 20). Probe passes; still REVISE-only until calibrated per p2-critic. |
| p2-snapshots | Playwright screenshot + visual-regression harness with committed baselines | 2 | rr7-engineer (PR) | 2026-07-20 | not-started | RED | `scripts/design-snapshots.ts` exists AND `tests/visual/` contains baseline images | 2026-07-20 | masks product-image regions on content-only runs. Audit: neither `scripts/design-snapshots.ts` nor `tests/visual/` exist. Target week reached, zero evidence. Long-tail item, not filed as a suggestion this run (see scoreboard). |
| p3-lighthouse | Lighthouse CI budgets on PR previews (LCP ≤2.0s, CLS 0, perf ≥90 mobile) | 2 | rr7-engineer (PR) | 2026-07-27 | done | GREEN | a Lighthouse CI config exists (e.g. `lighthouserc*`) AND a CI workflow runs it on PRs | 2026-07-20 | Audit: `lighthouserc.json` + `.github/workflows/lighthouse.yml` both confirmed on `main`, running on homepage-touching PRs. Probe passes early (target was next week). |
| p3-axe | axe accessibility sweep in the harness (zero serious/critical) | 2 | rr7-engineer (PR) | 2026-07-27 | not-started | AMBER | `@axe-core/playwright` in `package.json` AND referenced from the harness | 2026-07-20 | Audit: no `@axe-core/playwright` in `package.json` (only an unrelated transitive `axe-core` in `studio/package-lock.json` for Sanity Studio). Its prerequisite (p2-snapshots) is itself RED, putting the 2026-07-27 target at real risk. Long-tail item, not filed as a suggestion this run (see scoreboard). |
| p3-img-gate | Vision gate on every generated image before upload; ref-image mandatory | 2 | media-manager | 2026-07-27 | done | GREEN | `.claude/agents/media-manager.md` documents the gate AND `scripts/gen-homepage-image.ts` refuses missing `--ref-image` without `--no-ref` | 2026-07-20 | both confirmed on `main` (`--no-ref` requires a logged `--no-ref-reason`); kills the tea-cup failure class. Probe passes. |
| p3-prompts | Image prompt library seeded and maintained | 2 | media-manager | 2026-07-27 | done | GREEN | `docs/homepage-team/image-prompt-library.md` exists with ≥1 per-surface scaffold | 2026-07-20 | Audit: file confirmed on `main` with 5 per-surface scaffolds. Probe passes. |
| p3-teardown | Weekly competitor/reference teardown sub-step in Routine B | 3 | homepage-designer | 2026-07-27 | in-review | AMBER | `docs/homepage-team/routine-design-cycle.md` includes the teardown step AND a design run has a teardown event | 2026-07-20 | step 0.5 + `competitor-teardown-2026-07.md` decision doc both confirmed on `main`; live-fetch re-run owed by the cloud routine (this session's egress blocked competitor hosts). Audit: no Routine B design run has yet posted an actual teardown event (last design run, id 36, was 2026-07-15, before the step was added; next Wed fire is 2026-07-22) — probe only half-verifiable this run, capped at AMBER. Long-tail item, not filed as a suggestion this run (see scoreboard); recheck after the 2026-07-22 fire. |
| p4-events | Per-section GA4 engagement events + per-module PDP click-through | 4 | rr7-engineer (PR) | 2026-08-03 | in-progress | GREEN | section-visibility events wired in the analytics layer on main | 2026-07-20 | gives the 70% product-link rule an outcome metric. Audit: `home_variant_view`, `home_scroll_depth`, and `cta_click` events confirmed in `analytics.client.ts` (partial progress from this week's design-performance PR); per-module PDP click-through not yet confirmed. Target week not reached, real movement — stays GREEN. |
| p4-changelog | Design changelog appended by both routines | 4 | homepage-orchestrator | 2026-08-03 | not-started | GREEN | `docs/homepage-team/design-changelog.md` exists and has post-launch entries | 2026-07-20 | Audit: file does not exist yet. Target week not reached (2 weeks out). |
| p4-retro | First measured design retro + critic-score dashboard panel | 4 | homepage-orchestrator + rr7-engineer | 2026-08-03 | not-started | GREEN | dashboard shows critic scores AND a retro event references them | — | definition of done: critic avg ≥4.5 four straight weeks |

Ongoing cadences (tracked as health checks once phases close, not milestones): weekly teardowns,
monthly prompt-library pruning, quarterly hi-fi refresh + full-site design audit.

## Status log

### 2026-07-20 — first real audit: 7 milestones flip to done, 2 foundational REDs found, overall flips to RED

Recomputed all 14 milestones against evidence on `main` + `homepage_team_events`/`_runs` rows. Real
progress since the 2026-07-17 log entry: **p1-doctrine, p1-gallery, p2-critic, p2-critic-a,
p3-lighthouse (early), p3-img-gate, p3-prompts** all now probe-pass and flip to `done` — the
design-gates PR (#258/#269 and others) plus the Lighthouse CI workflow genuinely landed. `p2-critic-a`
in particular now has real evidence: `design-critic` decision events on three merchandise runs this
week (46/49/53), confirming Routine A's spot-check is live, not just documented.

But two **Phase-1/2 foundational** milestones are RED, past target, zero evidence:
- **p1-stack** (target 2026-07-13, now 1 week overdue) — none of the three named design skills
  (taste-skill, ui-ux-pro-max, Emil Kowalski animation skill) exist in `.claude/skills/`, which
  holds 35 unrelated marketing-strategy skills instead. Never installed.
- **p2-snapshots** (target 2026-07-20, today) — no Playwright screenshot harness, no
  `tests/visual/` baselines. Blocks p3-axe's own target next week (now AMBER as a result).

**p3-teardown** stays AMBER/in-review: the step and decision doc are real, but no live Routine B
run has posted a teardown event yet (next fire is 2026-07-22) — will recheck then.

Overall flips **GREEN → RED**: p1-stack and p2-snapshots are both on the critical path (Phase 1
and Phase 2 keystones respectively) and both overdue with zero evidence, despite genuine progress
elsewhere. Filed one process suggestion this run (p1-stack, targetTeam agent-editor) — p2-snapshots,
p3-axe, and p3-teardown are real but not filed this run given the suggestion-bus cap; tracked in the
audit scoreboard event.

Separately, but worth flagging in the weekly brief as an owner ask rather than a tracker row: this
week's owner-directed variant-b flip (design-performance PR, #273/#274) ran a pre-flip design-critic
gate that returned **BLOCK** (mobile avg 3.2) with named content-plane fixes still owed by the
merchandising team before the flip is considered done — that thread lives in this tracker's
2026-07-20 entry below, not as a separate milestone.

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

*(Note added 2026-07-20 audit: `main` has since merged #274, "Flip the homepage default to the
variant-b storefront" — worth confirming next audit whether the named content-plane fixes above
landed before or after that flip, and whether the post-flip critic re-run happened.)*

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
