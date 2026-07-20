# Tracker — Voice Register v5 Trial (desire-forward, intensity 9)

Program: 30-day trial of the v5 desire-forward voice register (explicit-indulgent, intensity 9, temptation closers) across all content
Source plan: docs/emma-voice.md (v5 charter, approved 2026-07-20)
Started: 2026-07-20   Target end: 2026-08-19
Overall: GREEN

Context: Mike approved the register on 2026-07-20 and wants a check-in after 30 days to decide keep / adjust / revert. The check-in reminder is milestone `v5-checkin`; program-manager must flag it to the owner in the weekly brief the week of 2026-08-17 and file a suggestion if the check-in has not happened by then.

| id | milestone | phase | owner | target week | status | RAG | evidence probe | last verified | notes |
|---|---|---|---|---|---|---|---|---|---|
| v5-charter | v5 charter merged and deployed (register live for all agents) | rollout | owner | 2026-07-20 | in-progress | GREEN | PR containing this tracker + the v5 `docs/emma-voice.md` is merged to main AND prod was promoted after merge | — | agents pick up the charter at runtime via `emma-voice.server.ts`; deploy requires manual Vercel promote |
| v5-adoption | New content shipping in the v5 register (not old v4 copy) | rollout | content-writer + homepage team + emma-product-enricher | 2026-07-27 | not-started | GREEN | ≥3 pieces of post-merge content (blog post, homepage copy, or enrichment) exhibit the v5 register: acts named, temptation closers, no hedges | — | spot-check, not exhaustive |
| v5-checkin | **Owner 30-day check-in: keep / adjust / revert the register** | review | owner | 2026-08-17 | not-started | GREEN | a dated decision entry from the owner exists in this tracker's status log on or after 2026-08-17 | — | REMIND MIKE the week of 2026-08-17. Evidence to bring: GA4 engagement + conversion vs. prior 30d, email open/click and spam-rate trend, any customer complaints via support, any ad-platform or processor flags |
| v5-guardrails | No register violations shipped (nothing at a 10, no ads above 3-4) | ongoing | emma-empathy-reviewer + voice gate | 2026-08-17 | not-started | GREEN | zero voice-gate BLOCK verdicts shipped live; no paid-ad creative above the education register | — | violations found mid-trial roll back the offending copy, not the trial |

## RAG rules

Standard tracker rules (see README.md). `v5-checkin` goes AMBER the week of 2026-08-17 if no owner decision is logged, RED the week after.

## Status log

- 2026-07-20 — Tracker created alongside the v5 charter. Trial window 2026-07-20 → 2026-08-19. Awaiting charter merge + prod promote (v5-charter).
