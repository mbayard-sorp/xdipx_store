# Tracker — Design Elevation Program

Program: Design Elevation (best-in-market automated design output)
Source plan: docs/homepage-team/design-elevation-plan.md
Started: 2026-07-13   Target end: 2026-08-10 (phases 1–4), then ongoing cadences
Overall: RED

Week anchors: W1 = 2026-07-13, W2 = 2026-07-20, W3 = 2026-07-27, W4 = 2026-08-03.

| id | milestone | phase | owner | target week | status | RAG | evidence probe | last verified | notes |
|---|---|---|---|---|---|---|---|---|---|
| p1-stack | Design capability stack installed (taste-skill, ui-ux-pro-max, Emil Kowalski animation skill) | 1 | owner + agent-editor | 2026-07-13 | in-progress | AMBER | `.claude/skills/` contains the three skill dirs with a `SKILL.md` each | 2026-08-03 | shadcn/ui MCP wiring counts as part of this milestone. 2026-08-03: `.claude/skills/` now holds `taste-skill/SKILL.md` and `ui-ux-pro-max/SKILL.md` (2 of 3 design skills installed). Still missing: the Emil Kowalski animation skill dir, and the shadcn/ui MCP wiring. Probe still fails (needs all three) so status is in-progress/AMBER — but the foundational keystone has genuinely started moving. Suggestion #59/#112 stand. |
| p1-doctrine | `docs/design-doctrine.md` written and binding | 1 | homepage-designer | 2026-07-13 | done | GREEN | file exists AND `.claude/agents/homepage-designer.md` references it | 2026-07-20 | doctrine merged in PR #258; homepage-designer + media-manager binding references confirmed on `main`. Probe passes. |
| p1-gallery | `/admin/design-gallery` component gallery route merged | 1 | rr7-engineer (Routine B PR) | 2026-07-13 | done | GREEN | `app/routes/admin.design-gallery.tsx` exists on main | 2026-07-20 | also the screenshot harness's stable target. Audit: route confirmed on `main` (PR #269, merged 2026-07-19). Probe passes, late but done. |
| p2-critic | `design-critic` agent exists and gates Routine B step 4 | 2 | agent-editor PR | 2026-07-20 | done | GREEN | `.claude/agents/design-critic.md` exists AND `docs/homepage-team/routine-design-cycle.md` step 4 lists it | 2026-07-20 | both halves confirmed on `main`; calibrate against 5 good + 5 bad historical screenshots before it may BLOCK. Probe passes. |
| p2-critic-a | Routine A post-publish design spot-check live | 2 | homepage-orchestrator | 2026-07-20 | done | GREEN | `docs/homepage-team/routine-daily-merchandise.md` includes the spot-check step AND a merchandise run has a `design-critic` event | 2026-07-20 | step 7.5 confirmed; `design-critic` decision events found on merchandise runs 46 (Jul 18), 49 (Jul 19), 53 (Jul 20). Probe passes; still REVISE-only until calibrated per p2-critic. |
| p2-snapshots | Playwright screenshot + visual-regression harness with committed baselines | 2 | rr7-engineer (PR) | 2026-07-20 | not-started | RED | `scripts/design-snapshots.ts` exists AND `tests/visual/` contains baseline images | 2026-07-20 | masks product-image regions on content-only runs. Audit: neither `scripts/design-snapshots.ts` nor `tests/visual/` exist. Target week reached, zero evidence. Long-tail item, not filed as a suggestion this run (see scoreboard). |
| p3-lighthouse | Lighthouse CI budgets on PR previews (LCP ≤2.0s, CLS 0, perf ≥90 mobile) | 2 | rr7-engineer (PR) | 2026-07-27 | done | GREEN | a Lighthouse CI config exists (e.g. `lighthouserc*`) AND a CI workflow runs it on PRs | 2026-07-20 | Audit: `lighthouserc.json` + `.github/workflows/lighthouse.yml` both confirmed on `main`, running on homepage-touching PRs. Probe passes early (target was next week). |
| p3-axe | axe accessibility sweep in the harness (zero serious/critical) | 2 | rr7-engineer (PR) | 2026-07-27 | not-started | RED | `@axe-core/playwright` in `package.json` AND referenced from the harness | 2026-08-10 | Audit 2026-08-10: still no `@axe-core/playwright` in `package.json` (only an unrelated transitive `axe-core` in `studio/package-lock.json`). Now 2 weeks past target with zero evidence and its prerequisite (p2-snapshots) still RED with no progress for 3 straight audits — past target, no evidence is RED per the RAG rules, not AMBER-at-risk anymore. Already covered by suggestion #115 (blocked, non-terminal, unblocks p2-snapshots → p3-axe), not refiled. |
| p3-img-gate | Vision gate on every generated image before upload; ref-image mandatory | 2 | media-manager | 2026-07-27 | done | GREEN | `.claude/agents/media-manager.md` documents the gate AND `scripts/gen-homepage-image.ts` refuses missing `--ref-image` without `--no-ref` | 2026-07-20 | both confirmed on `main` (`--no-ref` requires a logged `--no-ref-reason`); kills the tea-cup failure class. Probe passes. |
| p3-prompts | Image prompt library seeded and maintained | 2 | media-manager | 2026-07-27 | done | GREEN | `docs/homepage-team/image-prompt-library.md` exists with ≥1 per-surface scaffold | 2026-07-20 | Audit: file confirmed on `main` with 5 per-surface scaffolds. Probe passes. |
| p3-teardown | Weekly competitor/reference teardown sub-step in Routine B | 3 | homepage-designer | 2026-07-27 | done | GREEN | `docs/homepage-team/routine-design-cycle.md` includes the teardown step AND a design run has a teardown event | 2026-07-27 | step 0.5 + `competitor-teardown-2026-07.md` decision doc both confirmed on `main`. Audit 2026-07-27: two Routine B design runs on 2026-07-22 (ids 72, 76) posted actual `phase:teardown` decision events referencing `competitor-teardown-2026-07-live.md`. Both halves of the probe now pass. AMBER→GREEN. |
| p4-events | Per-section GA4 engagement events + per-module PDP click-through | 4 | rr7-engineer (PR) | 2026-08-03 | done | GREEN | section-visibility events wired in the analytics layer on main | 2026-08-10 | gives the 70% product-link rule an outcome metric. Audit 2026-08-10: both probe halves now confirmed. `home_variant_view`, `home_scroll_depth`, `cta_click` (all confirmed 08-03) plus per-module PDP click-through via `trackSelectItem`, wired into `StorefrontHome.tsx` rails (couples + listKey-scoped rails) and `ShelfSection`/`ProductCard`/`FitCard`, each call carrying `listId`/`listName` so GA4 can segment click-through by homepage module. AMBER→GREEN. |
| p4-changelog | Design changelog appended by both routines | 4 | homepage-orchestrator | 2026-08-03 | not-started | RED | `docs/homepage-team/design-changelog.md` exists and has post-launch entries | 2026-08-10 | Audit 2026-08-10: file confirmed still absent, as flagged last audit as the flip condition. AMBER→RED, 1 week past target. Suggestion #2390 filed (instructions, homepage): add a changelog-append step to routine-daily-merchandise.md and routine-design-cycle.md. |
| p4-retro | First measured design retro + critic-score dashboard panel | 4 | homepage-orchestrator + rr7-engineer | 2026-08-03 | in-progress | AMBER | dashboard shows critic scores AND a retro event references them | 2026-08-10 | definition of done: critic avg ≥4.5 four straight weeks. Audit 2026-08-10: real progress — full-rubric Routine B verdicts now show 2 consecutive weeks clearing the ≥4.5 bar (run 125, 2026-07-30, avg 4.58; run 183, 2026-08-05, avg 4.7), up from ~1 data point last audit. Still 2 short of the four-straight-weeks DoD; stays AMBER (a real, improving series with a clear path, not a stalled item). |

Ongoing cadences (tracked as health checks once phases close, not milestones): weekly teardowns,
monthly prompt-library pruning, quarterly hi-fi refresh + full-site design audit.

## Status log

### 2026-08-10 (program-manager, run 249). Overall stays RED.

Re-probed all 14 milestones against files on `main` and `homepage_team_events`. Three rows changed:

- **p3-axe: AMBER → RED.** Now 2 weeks past target (2026-07-27) with zero evidence: still no `@axe-core/playwright` in `package.json`. Its prerequisite p2-snapshots has been RED for 3 straight audits with no movement — past target, no evidence is RED, not at-risk AMBER. Already covered by suggestion #115 (blocked, non-terminal), not refiled.
- **p4-events: AMBER → GREEN (done).** Genuine close. The last confirmed gap (per-module PDP click-through) is now wired: `trackSelectItem` fires from `StorefrontHome.tsx` rails and `ShelfSection`/`ProductCard`/`FitCard`, each call carrying `listId`/`listName` so GA4 can segment by homepage module. Combined with `home_variant_view`/`home_scroll_depth`/`cta_click` (confirmed 08-03), both probe halves pass.
- **p4-changelog: AMBER → RED.** 1 week past target (2026-08-03), `docs/homepage-team/design-changelog.md` still does not exist, exactly the flip condition flagged last audit. Suggestion #2390 filed (instructions, homepage): add a changelog-append step to both Routine A and Routine B playbooks.

**p1-stack** stays AMBER/in-progress, unchanged (still 2 of 3 skills: taste-skill, ui-ux-pro-max; no Emil Kowalski animation skill dir, no shadcn/ui MCP wiring). Worth noting for the record: the owner has explicitly deprioritized closing this gap — suggestion #112 was dismissed 2026-08-02 ("substantially shipped since filing... residue is not worth an owner row at this revenue"). Not refiling; this is now a stable-but-incomplete state by owner choice, not a stalled item needing another suggestion.

**p4-retro** stays AMBER, real progress: full-rubric Routine B critic verdicts now show 2 consecutive weeks ≥4.5 (07-30 avg 4.58, 08-05 avg 4.7), up from ~1 point last audit. 2 more weeks needed to clear the four-straight-weeks DoD.

Overall stays **RED**: p2-snapshots (still RED, no harness ever started, now 3 weeks past target) plus the newly-RED p3-axe and p4-changelog keep the critical path off track, even with a genuine milestone close (p4-events) this run.

Suggestions filed this run: #2390 (p4-changelog, instructions, homepage). p2-snapshots/p3-axe remain covered by #115 (blocked, non-terminal); p1-stack not refiled per the owner dismissal above.

**Asks for the owner:** (1) p2-snapshots (Playwright screenshot/visual-regression harness) has had zero movement in 3 audits and is the single biggest blocker left in this tracker — it also gates p3-axe. (2) p4-changelog is a cheap doc-append fix, now flagged as suggestion #2390. No other owner asks this run.

### 2026-08-03 (program-manager, run 162). Overall stays RED.

Re-probed all 14 milestones against evidence on `main` (W4 = 2026-08-03). Four rows changed, all in the right direction except the deadline slips:

- **p1-stack: RED/not-started → AMBER/in-progress.** Real movement on the single foundational Phase-1 keystone: `.claude/skills/` now contains `taste-skill/SKILL.md` and `ui-ux-pro-max/SKILL.md` (2 of 3 named design skills). Still missing the Emil Kowalski animation skill dir and the shadcn/ui MCP wiring, so the probe (all three) still fails — hence AMBER, not done.
- **p4-events: GREEN → AMBER.** W4 target reached with partial evidence. `home_variant_view`, `home_scroll_depth`, and `cta_click` are wired in `analytics.client.ts`; per-module PDP click-through is not.
- **p4-changelog: GREEN → AMBER.** W4 target reached, `docs/homepage-team/design-changelog.md` still does not exist. Flips RED next Monday if still absent.
- **p4-retro: GREEN → AMBER.** W4 target reached; the DoD (critic avg ≥4.5 for four straight weeks) is unreachable with ~1-2 score data points so far.

Overall stays **RED**: the critical-path Phase-2 keystone **p2-snapshots** is still RED (no `scripts/design-snapshots.ts`, no `tests/visual/`), which also keeps **p3-axe** AMBER (no `@axe-core/playwright`). Suggestions: p2-snapshots (#115) and p1-stack (#112) stand; re-filed idempotently with `dedupeKey:tracker:<tag>`. No new owner asks beyond those.

### 2026-07-27 (program-manager, run 100). Overall stays RED.

Re-probed all 14 milestones. One row changed: **p3-teardown AMBER/in-review → GREEN/done.** Two Routine B design runs on 2026-07-22 (ids 72, 76) posted real `phase:teardown` decision events referencing the live teardown decision doc, so the probe is now fully verified. Separately, the design-critic re-score improved to PASS avg 4.07 (up from REVISE 3.7 last week).

Overall stays **RED**: the two Phase 1-2 keystones are still missing 2+ weeks past target. p1-stack (the three named design skills never installed) and p2-snapshots (no Playwright screenshot/visual-regression harness, and no `@axe-core/playwright`) are both RED; p2-snapshots blocks p3-axe's own 2026-07-27 target, now at real risk (p3-axe → AMBER). p4-retro's PASS≥4.5-for-four-weeks bar has only one data point (4.07) so far.

Suggestions filed this run: #112 (agent-editor: install taste-skill + ui-ux-pro-max + Kowalski animation skill, unblocks p1-stack) and #115 (homepage: build the Playwright screenshot/visual-regression harness, unblocks p2-snapshots → p3-axe). No owner asks beyond these.

### 2026-07-20 (later) — post-flip critic re-score: BLOCK 3.2 → REVISE 3.7; polish PR + content worklist

The variant-b flip (#274) and the wayfinder split-caption-card rebuild (#275) are live on `/`, and
the merchandising run rotated the hero to a real product still. The design-critic re-scored the
live 375px homepage: **REVISE, avg 3.7** (hierarchy 4, spacing 4, type 4.5, color 3, imagery 3),
up from the pre-flip BLOCK 3.2 (color 2→3, imagery 2→3). Critic-score series for the p4-retro
panel: 2026-07-20 pre-flip 3.2 BLOCK → 2026-07-20 post-flip 3.7 REVISE (target PASS ≥ 4.0).

Code fixes toward PASS land in the follow-up polish PR: the missed coral `SALE` badge and the
always-coral price in `ProductCarousel` (the team-rail card) both go ink, so CTAs are the only
coral in any rail viewport.

**Content-plane worklist for the merchandising team (no deploy needed):**
1. **Blocking-class:** two lifestyle photos carry a baked-in `xdipx` wordmark in the pixels
   (doctrine §4.4 hard rule) — the "No wrong answers" beginner-rail tile and the couples band.
   Regenerate/replace without the mark.
2. Announcement bar: drop the 🛍 emojis and tighten the "Guaranteed Authentic Products" line.
3. Push the dim lamp-lit tiles ("Gentle Everyday Start", beginner rail) to high-key daylight
   (§4.2/§4.3); swap clinical packaging flat-lays (SONA box + cables, recurring Nixie box+pouch)
   toward brighter product-large crops.
4. Hero still is now a real product (improvement) but spec-shot grade; art-direct toward the
   saturated color-block "hero energy" of §4.2 with the lifted image budget.

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
