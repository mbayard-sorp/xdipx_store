# Tracker — Design Elevation Program

Program: Design Elevation (best-in-market automated design output)
Source plan: docs/homepage-team/design-elevation-plan.md
Started: 2026-07-13   Target end: 2026-08-10 (phases 1–4), then ongoing cadences
Overall: GREEN

Week anchors: W1 = 2026-07-13, W2 = 2026-07-20, W3 = 2026-07-27, W4 = 2026-08-03.

| id | milestone | phase | owner | target week | status | RAG | evidence probe | last verified | notes |
|---|---|---|---|---|---|---|---|---|---|
| p1-stack | Design capability stack installed (taste-skill, ui-ux-pro-max, Emil Kowalski animation skill) | 1 | owner + agent-editor | 2026-07-13 | not-started | GREEN | `.claude/skills/` contains the three skill dirs with a `SKILL.md` each | — | shadcn/ui MCP wiring counts as part of this milestone |
| p1-doctrine | `docs/design-doctrine.md` written and binding | 1 | homepage-designer | 2026-07-13 | not-started | GREEN | file exists AND `.claude/agents/homepage-designer.md` references it | — | visual twin of the Emma voice charter |
| p1-gallery | `/admin/design-gallery` component gallery route merged | 1 | rr7-engineer (Routine B PR) | 2026-07-13 | not-started | GREEN | `app/routes/admin.design-gallery.tsx` exists on main | — | also the screenshot harness's stable target |
| p2-critic | `design-critic` agent exists and gates Routine B step 4 | 2 | agent-editor PR | 2026-07-20 | not-started | GREEN | `.claude/agents/design-critic.md` exists AND `docs/homepage-team/routine-design-cycle.md` step 4 lists it | — | calibrate against 5 good + 5 bad historical screenshots before it may BLOCK |
| p2-critic-a | Routine A post-publish design spot-check live | 2 | homepage-orchestrator | 2026-07-20 | not-started | GREEN | `docs/homepage-team/routine-daily-merchandise.md` includes the spot-check step AND a merchandise run has a `design-critic` event | — | REVISE files a suggestion; BLOCK triggers Sanity rollback |
| p2-snapshots | Playwright screenshot + visual-regression harness with committed baselines | 2 | rr7-engineer (PR) | 2026-07-20 | not-started | GREEN | `scripts/design-snapshots.ts` exists AND `tests/visual/` contains baseline images | — | masks product-image regions on content-only runs |
| p3-lighthouse | Lighthouse CI budgets on PR previews (LCP ≤2.0s, CLS 0, perf ≥90 mobile) | 2 | rr7-engineer (PR) | 2026-07-27 | not-started | GREEN | a Lighthouse CI config exists (e.g. `lighthouserc*`) AND a CI workflow runs it on PRs | — | |
| p3-axe | axe accessibility sweep in the harness (zero serious/critical) | 2 | rr7-engineer (PR) | 2026-07-27 | not-started | GREEN | `@axe-core/playwright` in `package.json` AND referenced from the harness | — | |
| p3-img-gate | Vision gate on every generated image before upload; ref-image mandatory | 2 | media-manager | 2026-07-27 | not-started | GREEN | `.claude/agents/media-manager.md` documents the gate AND `scripts/gen-homepage-image.ts` refuses missing `--ref-image` without `--no-ref` | — | kills the tea-cup failure class |
| p3-prompts | Image prompt library seeded and maintained | 2 | media-manager | 2026-07-27 | not-started | GREEN | `docs/homepage-team/image-prompt-library.md` exists with ≥1 per-surface scaffold | — | |
| p3-teardown | Weekly competitor/reference teardown sub-step in Routine B | 3 | homepage-designer | 2026-07-27 | not-started | GREEN | `docs/homepage-team/routine-design-cycle.md` includes the teardown step AND a design run has a teardown event | — | |
| p4-events | Per-section GA4 engagement events + per-module PDP click-through | 4 | rr7-engineer (PR) | 2026-08-03 | not-started | GREEN | section-visibility events wired in the analytics layer on main | — | gives the 70% product-link rule an outcome metric |
| p4-changelog | Design changelog appended by both routines | 4 | homepage-orchestrator | 2026-08-03 | not-started | GREEN | `docs/homepage-team/design-changelog.md` exists and has post-launch entries | — | |
| p4-retro | First measured design retro + critic-score dashboard panel | 4 | homepage-orchestrator + rr7-engineer | 2026-08-03 | not-started | GREEN | dashboard shows critic scores AND a retro event references them | — | definition of done: critic avg ≥4.5 four straight weeks |

Ongoing cadences (tracked as health checks once phases close, not milestones): weekly teardowns,
monthly prompt-library pruning, quarterly hi-fi refresh + full-site design audit.

## Status log

### 2026-07-11 — seeded (baseline)

Overall GREEN. Tracker created from the merged plan (PR #233); W1 has not started, all
milestones `not-started` by definition. No probes pass yet. First real audit lands with the
next Monday weekly strategy run.
