# Tracker — Voice Register v5 Trial (desire-forward, intensity 9)

Program: 30-day trial of the v5 desire-forward voice register (explicit-indulgent, intensity 9, temptation closers) across all content
Source plan: docs/emma-voice.md (v5 charter, approved 2026-07-20)
Started: 2026-07-20   Target end: 2026-08-19
Overall: GREEN

Context: Mike approved the register on 2026-07-20 and wants a check-in after 30 days to decide keep / adjust / revert. The check-in reminder is milestone `v5-checkin`; program-manager must flag it to the owner in the weekly brief the week of 2026-08-17 and file a suggestion if the check-in has not happened by then.

| id | milestone | phase | owner | target week | status | RAG | evidence probe | last verified | notes |
|---|---|---|---|---|---|---|---|---|---|
| v5-charter | v5 charter merged and deployed (register live for all agents) | rollout | owner | 2026-07-20 | done | GREEN | PR containing this tracker + the v5 `docs/emma-voice.md` is merged to main AND prod was promoted after merge | 2026-07-27 | agents pick up the charter at runtime via `emma-voice.server.ts`; deploy requires manual Vercel promote. 2026-07-27: live prod rendering v5 charter content (events 347/476/477). |
| v5-adoption | New content shipping in the v5 register (not old v4 copy) | rollout | content-writer + homepage team + emma-product-enricher | 2026-07-27 | done | GREEN | ≥3 pieces of post-merge content (blog post, homepage copy, or enrichment) exhibit the v5 register: acts named, temptation closers, no hedges | 2026-07-27 | spot-check, not exhaustive. 2026-07-27: 5+ post-merge dial-9 pieces shipped live (runs 07-21 through 07-27), 0 BLOCK. |
| v5-checkin | **Owner 30-day check-in: keep / adjust / revert the register** | review | owner | 2026-08-17 | not-started | GREEN | a dated decision entry from the owner exists in this tracker's status log on or after 2026-08-17 | — | REMIND MIKE the week of 2026-08-17. Evidence to bring: GA4 engagement + conversion vs. prior 30d, email open/click and spam-rate trend, any customer complaints via support, any ad-platform or processor flags |
| v5-guardrails | No register violations shipped (nothing at a 10, no ads above 3-4) | ongoing | emma-empathy-reviewer + voice gate | 2026-08-17 | not-started | GREEN | zero voice-gate BLOCK verdicts shipped live; no paid-ad creative above the education register | — | violations found mid-trial roll back the offending copy, not the trial |

## RAG rules

Standard tracker rules (see README.md). `v5-checkin` goes AMBER the week of 2026-08-17 if no owner decision is logged, RED the week after.

## Status log

- 2026-08-03 (program-manager, run 162). Overall GREEN, on schedule. No row changes. v5-charter and v5-adoption remain done; v5-checkin and v5-guardrails target 2026-08-17 (not yet due). Guardrails holding: this week's content voice gate had 0 BLOCK (run 157 PASS 13/13; run 155 held at REVISE, not shipped). **The trial ends 2026-08-19 and the 30-day owner check-in is due the week of 2026-08-17 — this is the last audit before the reminder window.** Next audit (2026-08-10) and especially the 08-17 audit MUST escalate the check-in to the owner with the evidence named in the v5-checkin row: GA4 engagement/conversion vs prior 30d, email open/click/spam-rate trend, support complaints, and any processor/ad-platform flags.
- 2026-07-27 (program-manager, run 100). Overall GREEN, on schedule. v5-charter and v5-adoption both flip to done with real evidence: live prod is rendering dial-9 content across runs 07-21 through 07-27, and the voice gate is shipping clean (0 BLOCK across all sampled runs). v5-checkin and v5-guardrails remain not-yet-due (target 2026-08-17); no action needed yet. Owner reminder is queued for the week of 2026-08-17.
- 2026-07-20 — Tracker created alongside the v5 charter. Trial window 2026-07-20 → 2026-08-19. Awaiting charter merge + prod promote (v5-charter).
