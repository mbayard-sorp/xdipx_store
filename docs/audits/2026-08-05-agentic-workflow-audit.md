# Agentic Workflow Audit, 2026-08-05

Full audit of the agent teams, the ticket bus, the release engine, the cloud routines, and production
failure patterns, run by an interactive session on 2026-08-05. Six parallel investigation lanes: team
OS structure, live DB state, GitHub merge attribution, production failures, ticket dwell and owner
burden, and outreach capability. All numbers below were measured, not estimated. Actions taken the
same day are marked ACTED.

## Headline verdict

The machinery is fundamentally sound. Every Vercel cron fired on schedule, the release engine merged
70 PRs in 14 days with zero reverts, the QA gate has never silently passed a bad diff, and ticket
throughput roughly matches intake. The owner burden is real but comes from a small number of
identifiable structural gaps, not from broad flakiness. The two worst problems found are not agent
problems at all: profit measurement has been recording zero orders forever, and the import enrich
pipeline has been silently dead for 75 days with its valve on.

## 1. Why the owner still merges (measured, 21-day window)

247 PRs merged in the window; the engine merged 35 (14.2%), or 22.9% counting only the post-engine
era. Of the 118 post-engine owner merges:

| Cause | PRs | Fix status |
|---|---|---|
| Draft on a lane the engine never undrafts (claude/ etc.) | 38 | ACTED: PR extends undraft to all eligible lanes under guards |
| Draft on agents/ or ticket/ before the undraft feature shipped 07-31 | 25 | Already fixed |
| Green ticket/ PRs the owner batch-merged before QA verified them | 17 | ACTED: QA now runs twice daily, cutting verify latency from ~19h to ~8h max |
| Protected path, owner merge by design | 18 | By design, stays |
| Branch prefix not yet eligible (fix/, pm/, docs/, chore/...) | 20 | fix/ and pm/ eligible since 08-04; other prefixes remain invisible |

Zero owner-merged PRs had red required CI. There are currently zero open PRs. This is a latency and
drafts problem, not a quality problem. The single biggest lever is the undraft extension; the second
is QA cadence; both are addressed today.

## 2. The ticket loop

State at audit time: 153 live tickets. 138 approved (56 code with zero PRs, 50 instructions, 12
process, 11 strategy, 4 config, 2 promo, 2 agent-def, 1 program), 11 blocked, 3 proposed, 1 pr_open.
Backlog net +6/day over 21 days (336 created, 214 terminal). Drain is batch-shaped: 52% of all
closures came from three events (a legacy purge, the 08-02 owner all-hands triage of 54 rows, and the
08-04 engine catch-up).

Structural findings:

1. **Blocked is a graveyard.** 21 tickets have ever been blocked; every exit was owner-driven. 10 of
   the current 11 have an empty reason. Nothing sweeps or re-opens them. ACTED: engine PR adds a
   merged-PR reconcile for blocked rows and auto-stamps missing reasons; the daily digest now lists
   them with an empty-reason flag.
2. **in_review was a dead end.** A crashed QA pass left tickets invisible to the next pass forever.
   ACTED: R-QA prompt and playbook now list in_review first and resume them.
3. **Orphans.** Tickets 120, 423 (approved, PRs merged) and 455 (blocked, PR merged) are stuck
   non-terminal because the out-of-band sweep only covered pr_open/in_review, and lease expiry had
   bounced them back to approved. ACTED: engine PR extends the sweep to approved and blocked.
4. **Lease expiry yanked work in flight.** 20-minute claim leases expired mid-run under a 3-ticket
   load. ACTED: R-DEV now claims with 2-hour leases.
5. **Drain arithmetic.** 56 approved code tickets against a 6-claim/day ceiling was a 9-day queue
   at best. ACTED: R-DEV claim cap raised to 5 per pass (10/day) with QA capacity doubled to match.
   The engine merge cap (12/day) is now the binding constraint; watch it.
6. **Kinds with no executor.** campaign and promo tickets can only exit through the owner (no Klaviyo
   campaign client, no Shopify discount API); process rows are owner-decision by definition. These
   are honest gaps, not bugs. The digest now ages them visibly. Roadmap: a Klaviyo campaign-send
   client and a Shopify discount-code client would each close a dead end.
7. **No kind validation.** A typo'd kind silently landed in the no-executor bucket. ACTED: engine PR
   coerces unknown kinds to process and preserves the original.
8. **Nothing watched the loop itself daily.** Backlog growth, aged statuses, and missed routine fires
   surfaced only through weekly checks or hand audits. ACTED: new ticket-janitor computes SLA
   breaches (pr_open >24h, in_review >12h, approved code >7d, proposed >72h), orphans, backlog
   trajectory, and routine liveness every day inside the 13:00 owner digest, with a single
   consolidated Needs Mike list on top.

## 3. Cloud routines

16 of 20 manifest routines had live triggers; the audit closed the gap to 19 (video producer stays
off with its valve, by design).

ACTED today via the scheduler API:

| Routine | Change | Trigger |
|---|---|---|
| R-QA Daily QA Gate | cron 30 15 to 30 3,15 (two passes); resumes in_review first | trig_019GjVP9hGBU1gmXRBYtYURm |
| R-DEV Daily Dev | claim cap 3 to 5, lease 1200s to 7200s, branch instruction fixed from agents/ticket-N (allowlist landmine) to ticket/N | trig_01MEQYsg5sHPbM4v39FqssAD |
| 16 Weekly Trend Scout | created, enabled, Sat 19:00 UTC, Sanity connector scoped to 13 tools | trig_01Vg5MYT8VvxEBcXp54ZMwSc |
| 17 Weekly Business Research | created, enabled, Thu 16:00 UTC, same Sanity scope | trig_015RUSQTu7wbifVrwHYVmtqi |
| 20 Weekly Social Trend Scout | created DISABLED pending social_team_max_runs >= 3 | trig_012k7r4rTiiUvzTzfarQwTZZ |

Also found: the 08-02 SEO-curation fire died before creating a run row (trigger fired per the
scheduler, no run exists), a silent-loss class the weekly coverage check catches only after 7 days.
The daily janitor now flags a missed cadence next morning. Scheduler API behavior worth knowing:
create respects a non-empty mcp_connections array, create with an empty array attaches the default
personal connector set anyway, and update with an empty array does not clear connections.

Strategy-team Monday now schedules 7 runs against cap 8. Do not add a Monday strategy-team routine
without re-checking the cap and the in-progress lock windows.

## 4. Production failures

The scheduler layer is fully healthy: every cron in vercel.json fired on schedule over the last 7
days. The webhook ack-ordering bug is fixed in code (all handlers do their work before responding,
with explicit time budgets). Real findings, worst first:

1. **P0, profit blindness.** daily_profit_summary shows total_orders=0 on all 51 days ever recorded,
   contradicting the real order of 07-26. Every profit-aware decision by any agent is running on
   zeros. Filed as ticket 1523 (P1).
2. **P0, import enrich dead 75 days.** /cron/import-enrich fires every 30 minutes with
   import_enrich_enabled on, yet enrichment_batches has nothing since 05-22 and batch_jobs is empty.
   Approved imports never reach the storefront. Filed as ticket 1524 (P1).
3. **Shopify throttling, chronic.** Three uncoordinated call sites (discovery honorary products,
   purchase-capi reconcile, warm-discovery-index) rack up daily Throttled errors. Filed as 1525 (P3).
4. **Token-log Neon write failures**, roughly daily since 06-16, swallowed. Filed as 1526 (P4).
5. **Latent engine trap.** The engine self-check verifies the Vercel token exists, not that it works.
   A dead token makes healthy merges look like failed deploys, rolls them back, and two of those in a
   day flip the engine off. ACTED: engine PR adds a live token check routed to config-error email.
6. Resolved noise: the pricing audit-log constraint violation (512 errors) stopped 08-01; the 08-05
   malformed-webhook cluster was deliberate probing, all correctly rejected with 400.

The orders/create webhook pipeline is code-correct but has never processed a real order end to end
post-fix (one pre-fix crash on 07-31 is the only genuine delivery on record). review_invites is empty
because it keys off orders. First real post-fix order proves or breaks this chain; the janitor's
digest section will show it.

## 4b. GitHub PR failure forensics (the constant failures, root-caused)

Two of the three recurring failure classes turned out to be ONE defect. server/vercel-entry.mjs is
the tracked esbuild bundle of the entire server (rewritten by 59 commits in 21 days). A PR that
committed its own rebuild conflicts with main the moment any other server PR merges first, and
GitHub runs ZERO pull_request workflows on a merge-conflicted PR. That silent CI blackout is exactly
what happened to PR 494 on 08-04 ("Actions declined five triggers": every push was authenticated
fine; the PR was conflicted, so no test-merge ref existed and no suite was ever created). A PR that
did NOT commit its rebuild fails CI's artifact-sync assert instead. Damned either way, and the
conflicted case masquerades as a mysterious Actions outage.

Fixes shipped:
- **PR 518 (ticket 1540, engine lane):** stop tracking the real bundle. scripts/build-vercel.mjs now
  writes server/vercel-entry.mjs only when VERCEL=1 (deploys, via the existing postinstall); local
  and CI builds write to gitignored build/. The tracked file becomes a 24-line self-explaining stub.
  Deploy safety was verified by simulating the VERCEL=1 path (byte-identical bundle) and confirming
  vercel.json only needs the file to exist at match time. Merge order: after 515/516/517; the stub
  wins every conflict.
- **Janitor (in PR 516):** conflicted PRs on engine-eligible prefixes now appear in the daily digest
  ("CI cannot run on this PR at all, rebase it on main"), so the next incident is diagnosed in one
  read instead of re-investigated.
- **Lighthouse (protected PR):** the Jul 31 to Aug 3 red streak was a real LCP regression, fixed by
  the PageSpeed work on 08-03; green since. Two workflow defects remained: the preview-wait step
  passes an input its action does not accept (so it polls a protected preview unauthenticated for
  the full 300s), and red runs file no ticket despite the workflow's own comment saying they should.
  The fix PR repairs the wait and adds a failure-conditional step that files the regression into the
  team bus (requires a new XDIPX_TEAM_TOKEN repo secret; degrades to a log line without it).
- Also confirmed healthy: agent-allowlist has zero false failures, the Vercel preview check does not
  flake, the checkout-probe red streak ended 08-01, and repo Actions settings suppress nothing.

## 5. Outreach (guest posts, brand partnerships, influencers)

Everything up to the send already runs weekly: offsite-scout researches targets, drafts policy-checked
pitches, files them as suggestion rows, and auto-approve moves them to approved. Then they sit;
pitches 144, 145, 147, 148 have been approved and unsent since 07-28 because the owner is the only
send path (hello@xdipx.com by hand) and nothing watches the inbox for replies.

ACTED: an outreach-pipeline PR builds the missing half, shipped valve-OFF:

- prospects and messages tables; the 6 email-reachable prospects from outreach-prospects.md seedable;
- send capability over the existing Zoho SMTP transport with hard guards (outreach_send_enabled
  valve, daily cap 5, 7-day per-prospect dedupe, queued-status prospects only, identification footer);
- an IMAP reply poller that acts ONLY on messages matching stored outreach Message-IDs (hello@ is
  also the support inbox; everything else is left untouched and unread), classifies replies, and on a
  positive reply emails mike@xdipx.com immediately: the loop-in the owner asked for;
- a team-token API endpoint so the offsite routine gains an execution step (max 3 sends per run),
  valve-gated, propose-only behavior unchanged while the valve is off.

Instagram influencers: no DM or contact capability exists anywhere, and the platform posture (drafts
only, editorial register, retroactive account-level enforcement) makes automated DMs a bad idea. The
practical division of labor: the team works every prospect with a findable email through the outreach
pipeline (many creators list one), files DM-ready drafts and a per-creator brief for the rest, and the
owner sends only the DMs. The prospects table carries a contact_channel field for exactly this split.

## 6. Recommendations beyond what shipped today

1. **Executor for campaign and promo kinds.** A Klaviyo campaign client and a Shopify discount-code
   (basic code mint) client are the two smallest builds that would close permanent owner dead ends.
   Both stay behind valves like everything else.
2. **Weekly protected-path window.** Protected merges are the one owner duty that should stay. Batch
   them: the digest already collects needs-owner PRs; treat them as a once-a-week 10-minute session
   instead of interrupt-driven merges.
3. **Ineligible-prefix silence.** Anything outside the eligible branch prefixes is invisible to the
   engine. Either standardize all sessions on eligible prefixes or add a digest line listing open PRs
   on foreign prefixes (janitor extension, small).
4. **Engine merge cap.** With dev throughput doubled, 12/day will bind on busy days. The cap
   no longer suppresses escalation after the engine PR, so raising it is a pure throughput decision.
5. **Support autonomy.** customer-service-emma still has no inbox. The outreach IMAP poller is the
   template; a support poller plus the existing agent is the next big owner-time win after outreach.
6. **Order-pipeline proof.** The first post-fix real order should be watched end to end (webhook,
   line items, profit row, review invite). The janitor flags the zero-rows condition until then.
7. **Sentry token for agents.** Only a DSN exists in env; agents cannot query Sentry. An auth token
   would let log-monitor triage real error groups instead of Vercel-side scraping.
8. **Trigger config drift.** The scheduler is outside the repo; the manifest is the only mirror. The
   janitor's liveness check now catches dead lanes within a day, but consider a monthly manifest
   reconciliation pass (list triggers, diff against the manifest table).

## 6b. Everything shipped this session

| PR | Branch | Lane | Contents |
|---|---|---|---|
| 516 (ticket 1532) | fix/ticket-loop-janitor | engine-mergeable | ticket janitor + digest Ticket loop and Needs Mike sections + conflicted-PR surfacing + playbook and schedule docs |
| 517 (ticket 1533) | fix/release-engine-loop-hardening | protected, owner merges | reconcile edges with a map-level fence, kind validation, blocked reason auto-stamp, undraft for all eligible lanes under guards, cap no longer suppresses escalation, live Vercel token self-check |
| 515 (ticket 1531) | fix/outreach-pipeline | protected, owner merges | outreach tables, valve-off guarded Zoho send, IMAP reply poller with loop-in to mike@xdipx.com, team API executor, seed script, runbook |
| 518 (ticket 1540) | fix/vercel-entry-stub | engine-mergeable | untrack the vercel-entry bundle, kills the conflict/CI-blackout class |
| 519 (ticket 1541) | fix/lighthouse-workflow | protected, owner merges | preview-wait auth repair (action bump to v1.3.3, input verified in its source) + red runs file deduped tickets into the bus |

All five PRs were adversarially verified by independent reviewer agents; every finding was fixed
before handoff (cadence false-alarm, dead code, lease contradiction, transition-map widening fenced,
outreach status-bypass hole, no-Message-ID re-classification loop, artifact sync).

Scheduler changes (live now): QA gate twice daily 03:30/15:30 UTC resuming crashed in_review rows
first; R-DEV claims 5 per pass with 3h leases and corrected branch naming; trend-scout and
business-research triggers created and enabled; social-trend-scout created disabled pending the
social run-cap raise.

Tickets filed for the loop to work: 1523 profit blindness (P1), 1524 import-enrich dead (P1), 1525
Shopify throttling (P3), 1526 token-log writes (P4), 1534 Klaviyo campaign-draft executor (P2), 1535
Shopify discount-mint executor (P2), plus the five PR tickets above.

## 7. Owner checklist (everything that needs Mike, in one place)

1. Merge the three protected PRs when they escalate: 517 (engine hardening), 515 (outreach
   pipeline), and the lighthouse workflow fix. Merge 517 and 515 in either order but rebase and
   rebuild whichever goes second (both regenerate vercel-entry.mjs); PR 518 then merges last through
   the engine and ends that chore forever.
2. After the outreach PR merges: apply its migration (scripts/apply-migrations.ts), create a Zoho app
   password with IMAP enabled and set OUTREACH_IMAP_* plus OUTREACH_POSTAL_ADDRESS in Vercel env, run
   scripts/seed-outreach-prospects.ts, then flip outreach_send_enabled when comfortable. Until the
   flip, behavior is exactly today's propose-only.
3. Raise social_team_max_runs to 3 or 4 on /admin, then enable trigger trig_012k7r4rTiiUvzTzfarQwTZZ
   (Weekly Social Trend Scout). Without the cap raise it would skip every Monday.
4. Create the XDIPX_TEAM_TOKEN GitHub Actions repo secret (value: the team callback token) so red
   lighthouse runs can file tickets; without it the step logs and skips.
5. Optional: add a SENTRY_AUTH_TOKEN to env for agent-side error triage.
6. Optional: raise release_engine_max_merges_per_day above 12 once the doubled dev throughput starts
   hitting the cap.
