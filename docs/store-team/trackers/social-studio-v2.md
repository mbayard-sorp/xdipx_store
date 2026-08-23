# Tracker — Social Studio v2

Program: /admin/socials as a full social management system
Source plan: docs/store-team/social-studio-plan.md (ADR-013)
Started: 2026-08-22   Target end: 2026-09-12
Overall: AMBER (not started)

| id | milestone | phase | owner | status | RAG | evidence probe | last verified | notes |
|---|---|---|---|---|---|---|---|---|
| p0-defects | retry resends edited text + media; delete on draft/IG rows; X permalink handle; all slides render in review | 0 | rr7-engineer via R-DEV | approved (ticket #4908) | AMBER | `twitter.server.ts` retry reads `edited_text` and `media_urls`; PostPreviewCard maps `mediaUrls` | 2026-08-22 | ticket filed at all-hands |
| p1-schema | migration 084 + schema.ts: social_media_assets, social_post_slides, social_follower_history, social_posts new columns | 1 | rr7-engineer via R-DEV | approved (ticket #4909) | AMBER | `db/migrations/084_*.sql` exists, additive only, `migration-dry-run` green | 2026-08-22 | |
| p2-library | dual-write candidates to Sanity + index; owner upload route; provenance membership seam (dual-check) | 2 | rr7-engineer via R-DEV | approved (ticket #4910) | AMBER | `app/lib/social-asset-library.server.ts` exists; gate reads it | 2026-08-22 | highest blast radius |
| p3-composer | nested routes; Composer with slides, product + cast pickers, library select, admin gate + regenerate routes; revert-to-draft | 3 | rr7-engineer via R-DEV | approved (ticket #4911) | AMBER | `app/routes/admin.socials.compose.$id.tsx` exists; `api.admin.social-gate.tsx` exists | 2026-08-22 | closes bus #4902 |
| p4-schedule | scheduled_at cutover, PDT picker, calendar drag, auto-expire, permalink capture | 4 | rr7-engineer via R-DEV | approved (ticket #4912) | AMBER | `eligibleWhere` compares against `now()`; `markPosted` writes `permalink` | 2026-08-22 | live publish path |
| p5-gate-columns | gate writers/readers on gate_status; feedback regex removed | 5 | rr7-engineer via R-DEV | approved (ticket #4913) | AMBER | no `BLOCK_STAMP_REGEX` reference in `team.server.ts` | 2026-08-22 | |
| p6a-analytics | analytics route reads metrics_json + follower history, CSV | 6 | rr7-engineer via R-DEV | approved (ticket #4914) | AMBER | `app/routes/admin.socials.analytics.tsx` exists | 2026-08-22 | |
| p6b-metrics-cron | /cron/social-metrics-sweep + spend valve | 6 | owner lane | pr_open (ticket #4916, PR #861) | AMBER | `vercel.json` has the cron; valve key in `team-keys.ts` | 2026-08-22 | owner merges; permalink backfill and follower_history table wait on 084 |
| p7-design | design-critic pass at 375px + desktop against plan §4 | 7 | design-critic | approved (ticket #4915) | AMBER | a design-critic verdict event on the Studio routes | 2026-08-22 | |

## Status log

### 2026-08-22 (all-hands). Opened. Plan, ADR and tickets filed: #4908 (P0), #4909 (P1), #4910 (P2), #4911 (P3), #4912 (P4), #4913 (P5), #4914 (P6a), #4916 (P6b, owner lane), #4915 (P7). Docs PR #860.

### 2026-08-22 (later). Phase 6b drafted in session: PR #861 (cron route, valve, read cap, admin controls, 10 tests). Ships inert; owner merges and flips.
