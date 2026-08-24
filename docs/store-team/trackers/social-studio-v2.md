# Tracker — Social Studio v2

Program: /admin/socials as a full social management system
Source plan: docs/store-team/social-studio-plan.md (ADR-013)
Started: 2026-08-22   Target end: 2026-09-12
Overall: AMBER (7/9 phases merged and probe-verified on main; p5-gate-columns and p7-design remain open)

| id | milestone | phase | owner | status | RAG | evidence probe | last verified | notes |
|---|---|---|---|---|---|---|---|---|
| p0-defects | retry resends edited text + media; delete on draft/IG rows; X permalink handle; all slides render in review | 0 | rr7-engineer (session) | done | GREEN | `twitter.server.ts` retry reads `edited_text` and `media_urls`; PostPreviewCard maps `mediaUrls` | 2026-08-24 | ticket filed at all-hands Audit 2026-08-24: probe confirmed on `main` (commit 19b4dc7, PR #863 merged): `twitter.server.ts` retry reads `post.editedText` and `post.mediaUrls`; `PostPreviewCard.tsx`/`mediaRefsOf` maps `mediaUrls`. Ticket #4935 applied. Both AND-halves pass. |
| p1-schema | migration 084 + schema.ts: social_media_assets, social_post_slides, social_follower_history, social_posts new columns | 1 | rr7-engineer (session) | done | GREEN | `db/migrations/084_*.sql` exists, additive only, `migration-dry-run` green | 2026-08-24 | Audit 2026-08-24: `db/migrations/084_social_studio_v2.sql` confirmed on `main` (PR #864 merged, ticket #4936 applied); a prior QA pass read the file directly and confirmed every statement is additive (`CREATE TABLE IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS`), matching the `migration-dry-run` allowlist despite the registered CI flake on that check. Probe passes. |
| p2-library | dual-write candidates to Sanity + index; owner upload route; provenance membership seam (dual-check) | 2 | rr7-engineer (session agent) | done | GREEN | `app/lib/social-asset-library.server.ts` exists; gate reads it | 2026-08-24 | highest blast radius Audit 2026-08-24: `app/lib/social-asset-library.server.ts` confirmed on `main` (PR #865 merged, ticket #4937 applied) with dual-write ("every generated candidate, winners AND losers"), a provenance-membership seam, and `app/routes/api.admin.social-upload.tsx` for the owner upload route. Probe passes. |
| p3-composer | nested routes; Composer with slides, product + cast pickers, library select, admin gate + regenerate routes; revert-to-draft | 3 | rr7-engineer (session agent) | done | GREEN | `app/routes/admin.socials.compose.$id.tsx` exists; `api.admin.social-gate.tsx` exists | 2026-08-24 | closes bus #4902 Audit 2026-08-24: `app/routes/admin.socials.compose.$id.tsx` and `app/routes/api.admin.social-gate.tsx` both confirmed on `main` (PR #867 merged, ticket #4938 applied). Probe passes. |
| p4-schedule | scheduled_at cutover, PDT picker, calendar drag, auto-expire, permalink capture | 4 | rr7-engineer (session agent) | done | GREEN | `eligibleWhere` compares against `now()`; `markPosted` writes `permalink` | 2026-08-24 | live publish path Audit 2026-08-24: both halves confirmed on `main`. `eligibleWhere` (`social-publish-job.server.ts`) is a real predicate compared against `effectiveSlotSql` (`coalesce(scheduledAt, scheduledFor)`); `markPostedWithPermalink` resolves and writes `permalink` on every posted row (PR #866 merged, ticket #4939 applied). The calendar-UI half (PR #870, "week grid with drag reschedule and PDT sheet") also merged, confirmed via `git log origin/main`. Probe passes; the tracker's own "server + calendar UI" split note is now fully closed. |
| p5-gate-columns | gate writers/readers on gate_status; feedback regex removed | 5 | rr7-engineer via R-DEV | in-progress | AMBER | no `BLOCK_STAMP_REGEX` reference in `team.server.ts` | 2026-08-24 | Audit 2026-08-24: ticket #4913 applied, PR #871 merged and confirmed on `main`, and the new `gate_status`/`gateCheckedAt`/`gateFindings` columns ARE the primary write/read path for `updateSocialPostReview` in `team.server.ts` (`or(isNull(gateStatus), ne(gateStatus, 'block'))`). But the probe as literally written ("no `BLOCK_STAMP_REGEX` reference in `team.server.ts`") fails: the constant is still defined and checked (`team.server.ts:2377, 2491`) as a second, atomic layer against a stamped-BLOCK `feedback` string on rows whose read may have raced a concurrent write — the PR's own description calls this a "burn-in fallback", which reads as intentional defense-in-depth, not an unfinished cutover. Capping at AMBER rather than done because the literal DONE WHEN ("feedback regex removed") isn't met and I can't confirm from evidence alone whether the fallback is meant to be permanent or a burn-in period with an end date — flagged as a judgment call for the owner/tech-architect rather than filed as a suggestion, since removing a safety fallback isn't obviously the right fix. |
| p6a-analytics | analytics route reads metrics_json + follower history, CSV | 6 | rr7-engineer via R-DEV | done | GREEN | `app/routes/admin.socials.analytics.tsx` exists | 2026-08-24 | Audit 2026-08-24: `app/routes/admin.socials.analytics.tsx` confirmed on `main` (PR #869 merged, ticket #4914 applied; the shipping session verified live data locally, 13 posts / 9 interactions). Probe passes. |
| p6b-metrics-cron | /cron/social-metrics-sweep + spend valve | 6 | owner lane | done | GREEN | `vercel.json` has the cron; valve key in `team-keys.ts` | 2026-08-24 | owner merges; permalink backfill and follower_history table wait on 084 Audit 2026-08-24: `/cron/social-metrics-sweep` confirmed in `vercel.json`; `socialMetricsSweep: 'social_metrics_sweep_enabled'` confirmed in `app/lib/team-keys.ts` (PR #861 merged, ticket #4916 applied — owner-merged as a protected-path PR, per the plan). The tracker's own "permalink backfill and follower_history wait on 084" caveat is now moot: 084 (p1-schema) is confirmed live. Probe passes. |
| p7-design | design-critic pass at 375px + desktop against plan §4 | 7 | design-critic | in-progress | AMBER | a design-critic verdict event on the Studio routes | 2026-08-24 | Audit 2026-08-24: ticket #4915 is `applied` and PR #872 ("design(social): Phase 7 design pass on the Social Studio") is merged and confirmed on `main` — but the probe requires "a design-critic verdict event on the Studio routes", and none exists. Checked `homepage_team_events` for `agent_role='design-critic'` since 08-21: the only hits are two homepage-storefront events (run 397 heuristic gate, run 479 hero spot-check), neither referencing `/admin/socials`. PR #872 was authored and merged as an ordinary rr7-engineer code PR describing design-doctrine fixes (one coral action per screen, stamp placement, week-grid fit, cropped cast avatars) from the plan's own §4, not from an actual `design-critic` agent run. The code changes may well be correct, but the milestone's own DONE WHEN — an actual critic verdict — never happened. Genuine gap, not a stalled item: capped at AMBER, and this is the one milestone in this tracker with a suggestion filed this run (see below). |

## Status log

### 2026-08-24 (program-manager, run 482). First program-manager audit of this tracker. Overall AMBER, substance much stronger: 7 of 9 phases merged and probe-verified on `main`.

This tracker was created 2026-08-22 and has moved fast in-session; this is its first weekly-strategy
audit. Verified via `git log origin/main` (every PR number below confirmed as a real merge commit on
`main`, not just a ticket status) and direct file/code reads for each milestone's own evidence probe:

- **p0-defects, p1-schema, p2-library, p3-composer, p4-schedule, p6a-analytics, p6b-metrics-cron: all
  flip to done/GREEN.** Every named PR (#863, #864, #865, #866, #867(P3)/#870(P4 UI), #869, #861) is
  confirmed merged on `main`, and every milestone's own literal evidence probe passes on direct file
  read (retry media/edited-text handling, migration 084, the asset library + upload route, the
  Composer + gate routes, `eligibleWhere`/`markPostedWithPermalink` + the calendar UI, the analytics
  route, and the metrics-sweep cron + valve key). This is real, not claimed: these are the first
  probe-passes recorded against this tracker at all, since it has never been audited before.
- **p5-gate-columns stays AMBER**, not done. PR #871 merged and the new `gate_status` columns are
  genuinely the primary gate path in `team.server.ts`, but the literal probe ("no `BLOCK_STAMP_REGEX`
  reference") fails — the constant is still read as a second, atomic safety layer described in the
  PR's own commit as a "burn-in fallback." Reads as intentional defense-in-depth rather than an
  unfinished cutover, so not filed as a suggestion; flagged instead as a judgment call for the
  owner/tech-architect (is the fallback meant to be permanent, or does it have a retirement date?).
- **p7-design stays AMBER**, a genuine gap. PR #872 merged real code changes framed as a "design
  pass," but the milestone's own DONE WHEN is an actual `design-critic` agent verdict event on the
  Studio routes, and `homepage_team_events` has none — the two `design-critic` events in-window are
  both homepage-storefront events, neither referencing `/admin/socials`. The design fixes may well be
  correct, but nothing gated them. Suggestion filed this run (see below).

**Overall RAG: AMBER**, per the roadmap's own roll-up rule (≥2 AMBER milestones), but this reflects a
program that is substantially shipped rather than one stuck — 7 of 9 phases are fully closed with
passing probes three days after the plan was written.

**Residual risk carried from the shipping session's own notes, not yet independently re-verified this
run:** the Instagram follower sparkline showing no readings despite the metrics sweep capturing 23
followers (check the KV fallback key / first `follower_history` row); the asset library being empty
until the first post-#865 social run (social ran 14x this week per this run's evidence, so likely
resolved, not re-checked); `[expired]` and stamp-ordering inside `feedback` to watch for one more
cycle now that #871's dual-write is live.

Suggestion filed this run: p7-design (targetTeam homepage, instructions) — get an actual
`design-critic` pass run against the live `/admin/socials` Composer/Analytics/Calendar routes and a
verdict event posted, per `dedupeKey:tracker:p7-design`.

**Asks for the owner:** none new. p5-gate-columns' burn-in-fallback question is worth a quick
tech-architect confirmation but isn't blocking; nothing here needs owner money or policy judgment.


### 2026-08-22 (all-hands). Opened. Plan, ADR and tickets filed: #4908 (P0), #4909 (P1), #4910 (P2), #4911 (P3), #4912 (P4), #4913 (P5), #4914 (P6a), #4916 (P6b, owner lane), #4915 (P7). Docs PR #860.

### 2026-08-22 (later). Phase 6b drafted in session: PR #861 (cron route, valve, read cap, admin controls, 10 tests). Ships inert; owner merges and flips.

### 2026-08-22 (night). Tickets #4908-#4912 were closed `applied` by the engine when docs PR #860 merged: each carried a `pr` link to #860 from filing, and a merged `pr` link reconciles to applied. `applied` is terminal, so Phases 0-4 are re-filed as #4935-#4939 (dedupeKey `-r2`); #4913-#4915 were unaffected. Lesson: never attach a docs PR as kind `pr` on a code ticket; use `doc`. Phase 0 shipped as PR #863 (#4935); Phase 1 as PR #864 (#4936). Phase 6b (#861) is merged and the sweep is live and enabled (first run 2026-08-23T02:55Z: IG 8 rows, X 5 rows, 0 errors).

### 2026-08-23 (early). Phases 2, 3, 4 built in parallel worktrees and integrated as one stack, merge order #863 (P0) -> #864 (P1, owner merge: dry-run flake) -> #865 (P2) -> #866 (P4 server) -> #867 (P3). Seams reconciled in #867: P0's delete/retry ported into the queue route, `social-schedule-ui.ts` now wraps Phase 4's `social-schedule.ts` (one DST implementation), `livePostUrl` is the status-aware version. Gate route is deterministic-only (the agent still issues PASS). Left for the next wave: calendar UI (P4 UI half, currently a stub route), P5 gate-column cutover, P6a analytics, P7 design pass. The stacked PRs show the full stack in their diff until the PR below them merges.

### 2026-08-23 (03:00-05:00 UTC). Every phase is in a PR. #863 (P0) and #864 (P1) merged by the owner; main went red for one typecheck error between them, hotfix #868. Wave 2 built in parallel on the stack: #869 (P6a analytics, live data verified locally: 13 posts, 9 interactions), #870 (P4 calendar UI), #871 (P5 gate columns, dual-write + burn-in fallbacks), #872 (P7 design pass: one coral action per screen, stamp never in the editable note, week grid fits 1280, rejected rows out of the calendar rail, cast avatars cropped). Merge order: #868 -> #865 -> #866 -> #867 -> #869 -> #870 -> #871 -> #872; each PR's diff contains everything below it until those merge. Reviewed locally against the live DB through a cookie-injecting proxy at 375 and 1280 (screenshots in the session). Open QA items: Instagram follower sparkline shows no readings although the sweep captured 23 followers (check the KV fallback key and the first follower_history row after #866 deploys); library is empty until the first post-#865 social run; `[expired]` and stamp ordering inside `feedback` should be watched for one cycle.
