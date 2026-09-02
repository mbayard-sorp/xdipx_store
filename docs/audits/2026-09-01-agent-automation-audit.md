# Agent automation audit, 2026-09-01

Full audit of the xdipx agent-automation estate: 25 cloud routines, 28 Vercel crons, 17 detectors, the ticket bus, the release engine, the owner-facing channels, and the docs agents load at run start. The question asked: why does the owner still spend his time chasing errors across Claude sessions, email, GitHub and 32 admin pages, and what would make him an escalation point only.

Method. Ten parallel auditors, one per dimension (routine liveness, Vercel crons, the detect-to-close loop, ticket bus, owner surface, PR lane, docs drift, business signal, the social lane as case study, cost and permissions). They produced 104 raw findings, clustered to 48 by root cause. Every P0-P2 cluster was then attacked by three independent verifiers with different lenses (does it reproduce from primary sources; is it already tracked or fixed; does it matter for the owner-as-escalation-point goal). 37 survived, 0 were refuted outright, 11 P3 items passed through unverified. Three designers proposed management models, two judges scored them, one synthesis merged the winner with grafts, and a completeness critic listed what the audit did not cover. Everything below was measured against the production database (read only), the repo at main `ba20d8d4`, GitHub, the trigger API and the Vercel API on 2026-09-01. Nothing was changed, filed, merged or edited during the audit.

Prior audits this builds on: 2026-07-22 automation drift, 2026-07-29 agent fleet evaluation, 2026-08-05 agentic workflow audit, 2026-08-12 all-hands audit. Where a finding was already reported and is still true, it says so.

## 1. Verdict

The fleet is not failing loudly. It is succeeding into dead ends. Every routine fires on time and every scheduler status reads SUCCEEDED, but the system manufactures states that only the owner can exit, and then re-surfaces each of them through a different sender until he reads it. That is the whole mechanism behind "I have to check 6 to 10 automation runs to find where the issue is."

Measured today:

| Dead end | Count | Who can exit it |
|---|---|---|
| Code tickets parked in `blocked` with zero fix attempts | 45 (25 already done or duplicate) | owner only |
| Approved rows in kinds with no executor (process, campaign, promo, program, config) | 253 | owner only |
| Open owner blockers with no self-closing probe | 9 of 10 (4 provably stale) | owner only |
| Approved rows with `target_team` NULL that no routine mailbox can list | 78 | nobody |
| Senders that email or text the owner | 28 call sites in 19 modules, 3 unconditional daily | n/a |
| Protected-path escalation emails, last 14 days | 35, one per PR, plus digest duplicates | owner clicks each |
| Merges that bypassed the release engine, last 14 days | 118 of 244 (48%), mostly sessions merging their own PRs | n/a |
| Emails on a normal day / bad day | 5-7 / 12-16 plus 2-3 SMS | n/a |

Five things are broken right now that no watcher reports:

1. **Main is red on a time-flaky test and only the owner was told.** `storefront-home.server.test.ts:448` expects a rail order that depends on `railSeedBucket()`, a 15-minute wall-clock bucket, so the test flips between pass and fail with the clock. It went red at 18:46 UTC on a docs-only merge, failed 3/3 locally at every commit back to and including the last green SHA, and went green again at 05:21 UTC on another docs-only merge with no test change. Every open PR showed a red `check` for 10 hours, R-QA verified three PRs over it, the engine burned one attempt on each ticket, and the only automated response was an email. Ticket #6933 exists for the test; nothing turns a red main into team work.
2. **The pricing recompute has repriced under half the catalog for three days while every watcher says green.** `/cron/pricing-batch-recompute` is killed at Vercel's 300s cap every morning (7 timeouts in 7 days, all this path, last audit row at 07:05-07:06 daily). It walks the catalog in a fixed order with no cursor, so 08-30 to 09-01 wrote 1,154 to 2,011 rows against ~4,312 SKUs and the same head each day; 2,312 SKUs have not been repriced since 08-29. The digest prints GOOD on any nonzero row count and the pricing-ops sweep filed nothing.
3. **log-monitor has never read a runtime log.** It pulls `/v3/deployments/{uid}/events`, which returns build output only (0 events in the last hour; 358 events inside a 90-second build window). Its haiku calls line up with deploy times, it has filed zero log-derived tickets ever, and it cost $17 last month. The 145 product-created webhook budget overruns, 24 Shopify throttles and 7 timeouts in Vercel's error groups were never seen by any agent.
4. **The new-product weekly cap is dead and flooding the bus.** `server/webhooks.ts:591` counts this week's rows with `LIKE 'new-product:%'`, but PR #896 (08-24) canonicalizes keys to `new-product-<handle>`, so the count is always zero and the cap of 3/week never fires: 116 "Product just went live" process rows in six days, all auto-approved, none consumable.
5. **The 13:30 blocker email is wrong on 4 of 10 rows and cannot correct itself.** Nine of ten open blockers have no verify probe; #18 says Instagram autopublish is OFF while the owner turned it back on at 17:57; the blocker scout that would refresh the list has a playbook, a valve and a cadence but has never run anywhere (no cloud trigger, no desktop task, zero run rows).

Two corrections to beliefs carried into this audit: `daily_profit_summary` is not all zeros (PR #393 fixed it; orders #1002 and #1003 are there), and the "$36.70 social spend" line is one self-reported Max-subscription row priced at API list, not real spend.

## 2. Confirmed findings

37 findings survived three-lens verification. Severity is the verifiers' corrected severity. "Tracked" names existing tickets, PRs or docs that already cover part of it; "none" means nothing on the bus, in a PR, or on the blocker list addresses it.

### The loop breaks at the close, not at the detect

| id | sev | finding | fix | tracked |
|---|---|---|---|---|
| F14 | P1 | Blocked is the de facto close for code tickets. `code` rows have no agent-walkable terminal state except a merged PR, so R-DEV parks "done, duplicate, not a bug, needs owner" in `blocked` (45 rows, all attempt_count 0; max attempt_count in the whole table is 1, so the three-strikes escalation has never fired). 9 rows the owner un-blocked by hand were re-blocked by R-DEV. | code/S, protected path (team.server.ts) | #253 applied without the edge; #3544/#3545 approved process rows with no executor; open since the 08-05 audit |
| F28 | P2 | 19 genuinely owner-gated blocked rows never become owner blockers; the weekly blocked digest (#2863) was built and never scheduled. | code/M | #3545 approved, no executor |
| F26 | P2 | Auto-expired runs are filed as P1 code tickets at team homepage and loop claim to block to reopen (6 such rows blocked). #6760 stabilised the dedupe key today but the filing is unchanged. | code/S | #6760 applied, #6936 approved |
| F31 | P2 | Kinds with no executor keep accepting rows (program 3, config 2, promo 3, non-email campaign 52); agent-editor re-lists 29 approved instructions rows every run with no exit. | code/M | 08-12 audit gap 3, still open |
| F16 | P2 | Process intake outruns every drain: +15.9 live rows/day over 14 days; drains are capped at roughly 18/day. | code/S | #4356 applied (digest only) |
| F15 | P2 | New-product weekly cap query never matches the canonical key; 116 rows in 6 days against a cap of 3/week. | code/S | none |
| F17 | P2 | 78 approved rows carry `target_team` NULL; the list op has no "NULL means own team" fallback so team mailboxes never see them (29 restock rows at social). | code/S | PR #1007 fixed future filings only |
| F29 | P3 | Detector filing is unbounded: no per-detector daily cap, dedupe is opt-in (89 of 733 rows in 14d had no key), cross-detector double filing (the conversion-status incident produced four rows). 35% of detector rows end dismissed. | code/M | PR #1007, #1005 partial |
| F32 | P3 | SLA thresholds skip the statuses where the backlog lives (blocked, approved non-code), so the janitor reports one breach against 350 live rows. | code/S | none |

### Nothing proves a routine or cron did anything

| id | sev | finding | fix | tracked |
|---|---|---|---|---|
| F02 | P2 | No durable per-run outcome record. `succeeded` means the session ended: runs 623/624 wrote zero drafts and read succeeded; run 634 drafted and gated a post and read failed (auto-expired). 39 succeeded rows have no finished_at; 13 succeeded rows carry an auto-expired error; 58 of 61 R-QA runs posted zero events. Four status spellings in use. | code/M | none |
| F04 | P2 | ROUTINE_CADENCES (the daily liveness table) is hand-maintained and stale since the 08-16 schedule moves: apply pass checked at a 122h gap against a daily trigger; podcast, SEO and trend-scout keyed to old runTypes (false "SEO curation missed" flag in today's digest); six live routines omitted (pricing sweep, R-WATCH, R-SHEP, blocker-scout, video render, writers room). `scripts/coverage-audit.ts` fails today for the wrong reasons and runs nowhere. | code/M | none |
| F05 | P2 | Blocker scout (R-BLOCK) has never run: no trigger, no desktop task, zero run rows; the weekly coverage check excluded its valve on the false premise that it gates a Vercel cron. | trigger/M | none; PR #626 shipped the playbook only |
| F12 | P1 | Pricing recompute killed at 300s daily; under half the catalog repriced for three days; no alert, digest line, ticket or catch-up run. | code/M | #377/#4213 covered the thrown-error case only |
| F13 | P1 | log-monitor classifies build output, not runtime logs; zero log-derived tickets ever; GitHub issues it opened (#177, #136, both P0, from May/June) have zero comments. | code/M | 08-05 audit item 7 (Sentry token) never ticketed |
| F37 | P3 | Correction: routine-hours per day cannot be measured; 18 succeeded runs have no finished_at and the trend-scout "619 min" is the reaper's clock, not a session. | code/S | none |
| F36 | P3 | Correction: three scout claims about "short or idle" routine fires were wrong; scheduler timing is not a run signal in either direction. | process/S | n/a |

### The owner is the diff tool between eight surfaces

| id | sev | finding | fix | tracked |
|---|---|---|---|---|
| F19 | P1 | No single owner surface. The 13:00 digest is 15 sections from disjoint sources: its Ops watch has warned "enrich stage may be stalled" every day for six weeks against `product_enrichment_cache` (last write 07-21; enrichment now flows through `import_candidates`, 146 published in 7 days); its pricing line is GOOD on any nonzero count; it never reads `owner_blockers`; the 13:30 blocker email never reads tickets or PRs; "Nothing needs you today" prints directly above five blocked rows. | code/M | #3545 approved, no executor |
| F06 | P1 | Owner blocker rows are filed without probes (9 of 10 open), so the owner's own valve flips never clear them; the removal watchers file valve-OFF rows without the `setting_true` probe that already exists. | trigger/M | none |
| F18 | P1 | Protected-path escalation is classified once, permanently, and emailed per PR: 35 needs-owner PRs in 14 days (10 on 08-23 alone), 7 of which were not protected on their own diff (stacked branches classified on inherited commits). #991 (a P1 Instagram fix) was labelled 39s after open, cleared refinement 47s later, and has sat 26h with the label, now conflicting, with no routine owning conflicts. The digest under-reports these (2 of 16). | code/M | 08-05 audit rec 2 (weekly window) never ticketed |
| F21 | P1 | Strategy-brief asks never become blockers: GA4 has read "UNREADABLE (MCP not attached)" in 7 consecutive briefs because the Weekly Strategy trigger carries only Shopify and Sanity; the connector works (141 sessions, 31 users, 1 add-to-cart, 1 purchase in 28 days). Six approved email campaign briefs are plan-only behind an absent `email_campaign_push_enabled` valve with no blocker row. Acquisition is reported weekly and executed by nobody. | trigger/S | tracker p0-1-email AMBER since 07-20 |
| F33 | P3 | R-WATCH and R-SHEP are told to "message the owner" but their only channel is a session transcript, and notifications are off on all 25 triggers. | instructions/S | none |
| F20 | P1 | 48% of merges bypass the release engine (118 of 244 since 08-18): 84 non-protected, 68 with tickets never QA-verified, sessions merging their own PRs 4-10 minutes after opening (#1007/#1008/#1009 today), #993 merged with a failing allowlist check. The sweep stamps them applied silently; the engine and sessions share the owner's GitHub identity so nothing can attribute a merge. | process/M | 08-05 audit §1 misattributed the cause to drafts |
| F27 | P3 | R-SHEP fires 6h behind R-DEV and off-cycle `claude/` PRs wait 5-8h for a QA slot, so sessions babysit with 14 hand-armed one-shot "Re-check PR" triggers in 10 days. | instructions/S | none |

### Docs and prompts agents load at run start state a world that no longer exists

| id | sev | finding | fix | tracked |
|---|---|---|---|---|
| F11 | P1 | Eight hand-maintained copies of live facts (routine-schedule.md twice, ROUTINE_CADENCES, coverage-audit.ts, operating-system.md §2/§5/§6/§8, README.md, CLAUDE.md, agent defs, trigger prompts) with 34 counted contradictions against live state and no generator or CI check. Examples: operating-system §5 says "five escalation triggers, and no others" while 28 call sites email him; §6 says the merge cap is 12 (live 50) and the metrics sweep is "shipped inert" (owner turned it on 08-23); R-WATCH's cron is wrong in two places; the "kept as rollback" video trigger returns 404. | code/L | #4711 fixed one line |
| F10 | P2 | Social posture is stated five contradictory ways: the live morning trigger prompt still says "You are DRAFT-ONLY, autoposting stays off until the owner graduates the stub" while both autopublish valves are on; README.md:48 says the owner posts; store-strategist.md says social is draft-only. Run 378 skipped the publish gate on that reading. | process/M | #6925 approved (agent defs only) |
| F09 | P2 | Nine triggers (R-DEV, R-QA, R-WATCH, R-SHEP, pricing, product manager, offsite, social trend scout, legacy Apply Thu) carry the owner's full personal connector set with empty `permitted_tools`: Gmail on all nine, Drive and Calendar on the product manager. R-DEV and R-QA run untrusted ticket bodies as input. Today the calls stall rather than execute; that is luck, not design. Two undocumented environment ids split the team secret. The legacy Thursday apply trigger is still enabled. | config/S | #1513 pruned four triggers |
| F03 | P2 | Social morning runs produced zero drafts because the voice and publish gates exist only as Task subagents and the entry session had delegated one nesting level down. The team diagnosed it within two hours and filed the right fix (#6916 / PR #1011, server-side gates) the same day, then it sat behind the red main. No server-side check compares social output to `social_freq_*` on a gate-open day. | trigger/M | #6916 in progress |
| F07 | P2 | System crons flip money valves and halve social frequency with no earn-back path (`social_freq_instagram` 4 to 2 twice, never restored); the doc says agents never write `pipeline_settings`; three admin writers bypass `settings_audit_log` (47 audit rows against 2,182 keys). | code/S | #6758 adjacent |
| F08 | P2 | Both Instagram auto-offs counted owner deletions (#23, #145) as Meta takedowns; the attribution backfill migration 088 is unapplied, so one more deletion before 09-13 trips the valve a third time. | config/S | #6758 applied, 088 pending |

### Money, safety and cost

| id | sev | finding | fix | tracked |
|---|---|---|---|---|
| F22 | P2 | No signal proves the store can take money. purchase-watcher never pages on zero by design; the checkout probe's HTTP tier records ok on a 403; the browser tier runs once a day and stops at the checkout page. Nothing reads GA4 in a scheduled run (`ga4.server.ts` has zero importers). The $2,000/month goal is measured nowhere. | code/M | #1523 dismissed, #595 never applied |
| F30 | P2 | Post-deploy safety net gaps: a docs-only PR (#900) was reverted on a checkout-probe smoke failure the probe never recorded; reverted tickets stay `applied` (#619, #2015, #5253); the circuit breaker counts only smoke rollbacks. | code/M | #5404 blocked at attempt 0 |
| F25 | P2 | An agent-filed instructions row reaches merged behaviour change with no human and no QA: auto-approve is on for 8 teams, the docs carve-out merges allowlisted `.md` PRs with the ticket still `approved` (68 of 83 instructions rows applied in 14d were never verified), and the allowlist covers operating-system.md, routine-dev-daily.md and agent-editor.md themselves. | code/S | none |
| F24 | P2 | One shared bearer secret (TEAM_TOKEN falling through to CRON_SECRET) authorises every team op for every team and every `/cron/*` route; `actor` is a caller-supplied body field, so any token holder can claim the QA-only `verified` transition. | code/M, protected | 07-22 audit recommended it; never ticketed |
| F23 | P3 | Spend is invisible where it matters: every Max-subscription source logs $0 (60M of 86M tokens in 14d), so `{team}_daily_cents` budgets bind only on metered API spend and five of seven have never bound; the only two over-budget skips in 30 days were phantom rows; no surface compares spend to orders, profit or sessions. | code/S | PR #825 by design |
| F35 | P3 | Correction: the $36.70 social line is one self-reported row; real social API spend was $2.33 in 15 days; `claude-cli` is not a zero-rated source. | code/S | none |
| F34 | P3 | Only 28% of Instagram drafts post; the owner is a manual gate on 26 rows; the dominant rejection class is image defects the text-only gate cannot see. | code/M | #6763 verified (vision gate, PR #991) |

### Red main has no owner

| id | sev | finding | fix | tracked |
|---|---|---|---|---|
| F01 | P1 | Main red for 10.5 hours on a time-flaky test; main-ci-watch emails only; R-SHEP's scope is open PRs; R-QA verified red PRs; the engine burned attempts on innocent tickets. Earliest unattended fix was R-DEV at 10:00 UTC. | code/M | #6933 approved, #6934 approved |

Skipped (P3, not verified): main push CI runs cancelled with zero jobs in merge bursts (5 commits with no verdict today); the product-created webhook overrunning its 4000ms budget 145 times with no reader; two varchar overflows dropping token-log and fabrication-guard rows; and six corrections to the scout facts.

## 3. Why this keeps happening

Four prior audits found overlapping pieces of this, and several fixes shipped. The pattern that survives every fix is the same:

- **States with no next actor.** The transition map gives agents no terminal edge for code rows, no executor for process/campaign/promo/program/config, no probe on most blocker rows, and no close path for most detectors. Each new detector or filer adds intake into a bucket only the owner can empty.
- **Prose as the source of truth.** Cadences, valves, crons, connector sets, escalation rules and posture are hand-copied into eight places that agents read at run start and nothing reads back. The fix for the last incident is written into a doc; the doc drifts; the next incident is the doc.
- **Watchers that watch each other's edges.** R-WATCH, R-SHEP, the janitor liveness table, program-manager's weekly coverage check, blocker-scout, log-monitor and the digest each see a slice. The gaps between them (a red main with no red PR, a killed cron with nonzero rows, a routine that fires and does nothing, a trigger nobody created) land on the owner because he is the only reader who sees all the slices.
- **No expectation registered anywhere.** Liveness is inferred from side-effect rows; scheduler SUCCEEDED is a session ending; a cron that leaves no record is indistinguishable from one that ran.

## 4. The management model

This is the synthesis of the design panel: the judges' winner ("every signal has an executor, the owner has one queue") with the observability grafts both judges asked for. It builds only on infrastructure that exists.

### Thesis

Enforce coverage at file time instead of adding another watcher: no ticket kind without an executor, no blocker without a probe or an explicit decision category, no detector without a declared close path, no owner email outside a registered escalation class, and a three-strikes ladder whose third strike is a team decision in the weekly strategy run. Once a row can only exist in a state with a next actor, the owner surface collapses to one probe-closed queue plus a money block, and everything else becomes a health line the team reads.

### Lanes

All existing lanes are kept; nothing new runs on an LLM except R-BLOCK, which already has a playbook. Detection lives in code (records, probes, SLA classes). Routines act on tickets. The owner reads one page.

| Lane | Accountable routine | Repair | Deterministic substrate | Lane SLO (a miss files a ticket at the lane, never an email) |
|---|---|---|---|---|
| Ship | R-DEV 10/15/20 UTC | R-QA 4x daily; R-SHEP retimed to 30 min after each R-DEV pass plus 01:45 | release engine, main-ci-watch, smoke and revert | main green; no green pr_open older than 6h; red main ticketed within 10 min |
| Bus hygiene | ticket-janitor (13:00) plus a new 6-hourly `/cron/janitor-sweep` | Weekly Strategy (the three-strikes court) | SLA classes, age-out, blocked auto-return, blocked-to-blocker bridge | net live rows per day at or below 0 over any 7-day window; zero approved rows older than 14d in a kind with no executor |
| Owner list | R-BLOCK, daily 12:00 UTC, no connectors | `/cron/blocker-list` becomes probe-verify only | probe runners | every open row has a probe or category=decision |
| Merchandise and catalogue | Routine A, Product Manager, R-ENRICH, Pricing Sweep | janitor lane floors | import-enrich, chunked pricing recompute, healthchecks | pricing distinct SKUs today at or above floor; enrich published at or above queued |
| Content and social | Content Writer, Social morning/evening | `/cron/social-lane-slo` 23:00 UTC | social-publish, metrics sweep, removal watchers, server-side gates | posts per platform on a gate-open, budget-open day at or above min(freq, 1) |
| Strategy and retro | Weekly Strategy, Cost Review, Apply Pass | | strategy_briefs, api_token_log | an unreadable outcome source is a blocker row with a probe, never a table cell |
| Money (code, not a routine) | one money-block query read by the digest, /admin/ops and /api/team/status | | daily_profit_summary, ga4.server.ts, checkout_probe_runs, api_token_log, ad_campaigns | the only lane allowed to page |

### Escalation ladder

- **L0, event, no ticket.** One auto-expired run, one deleted post, one flaky test, one probe pass. Writes a run row, event or liveness flag.
- **L1, ticket, never an email.** A repeated or actionable signal files one deduped ticket with a close path and a target team that has an executor. Shows on the health strip with its id.
- **L2, three strikes, team-decided.** attempt_count at 3, the same dedupe key observed 3 times in 14 days, or an SLA class breach. Goes on the Weekly Strategy agenda; the strategist must dismiss with evidence, rekind, retire as superseded, or file an owner blocker. Leaving it is not an option; the janitor re-lists it every Monday.
- **L3, owner queue, daily surface, no page.** Only categories cost, valve, protected-merge, brand-legal, one-time-setup, decision. Every row carries a probe or category=decision and clears itself on the flip or merge. Protected PRs enter as blocker rows with a `pr_merged` probe, only after migration-dry-run concludes and QA has verified, batched into one Monday read-and-click window.
- **L4, page (email plus SMS), one per episode, at most 3 per day.** Exactly six rules: checkout probe browser-tier failure; engine circuit break or a red revert PR; a money cron (pricing, checkout probe, profit summary, release engine) killed or missed twice; GA4 sessions zero for 2 days while the probe is green; metered 30-day spend above 5x 30-day profit with sessions under 300/week (carries a cap proposal, no automatic budget write); a log-monitor P0 in the checkout, order-created or fabrication-guard groups. Nothing else may call `sendOwnerEmail` or SMS: the function takes a mandatory `escalationClass` and a unit test fails on any unregistered call site.

### The single owner surface: the Owner Queue

One function, `computeOwnerQueue()`, rendered three ways from the same object: the 13:00 email (the digest rewritten to render only this), `/admin/ops` (the new `/admin` landing page, first nav entry), and `owner{}` plus `health{}` on `/api/team/status` so routines read the same list.

Contents, in order, hard-capped at about 40 lines and 10 queue rows:

- **A. Money block, 6 lines.** Orders, revenue, profit 7d and month-to-date against the $2,000 pace; GA4 sessions and add-to-carts 7d; metered API plus RunPod plus ad spend 30d and the spend-to-profit ratio; checkout probe last browser-tier result (403 shown as degraded); pricing coverage "N of ~M SKUs"; active L4 episodes.
- **B. Needs you, max 10 rows.** Title, category (why it is yours), what unblocks it, link, and "clears itself when <probe>". Sources: open blocker rows with live probe state; protected PRs as engine-filed blocker rows; program/promo/campaign rows awaiting a money decision surfaced as one row per valve; video frames on review; ad campaigns awaiting approval.
- **C. Health strip, misses only.** Red main, breaker, crons killed or missed, routines missed, lane floors breached, log-monitor feed dead, three-strike count, approved-with-no-executor count. A lane with nothing to report is not printed.
- **D. Policy breaches, 24h.** Non-engine merges of non-protected PRs, settings writes with no audit row, owner emails outside a registered class, triggers carrying Gmail/Drive/Calendar, trigger snapshot older than 7 days.
- **E. Shipped last 24h,** one count with a link.

Inclusion rule: a row appears in B only if an `owner_blockers` row exists with a cost-surface category and its probe currently returns false or null. Blocked tickets, process rows, red PRs, expired runs and detector hits never appear individually.

Send rule: the 13:00 email goes out when the queue hash changed, when any row is older than 7 days, and unconditionally every Monday. The subject line is the status: "<n> yours, <m> broken, MTD $x". A health line that reads WARN for 7 consecutive days becomes a ticket at the owning team, not a line.

It replaces: the 13:30 blocker email; ten digest sections; per-PR protected-path emails; log-monitor GitHub issues and first-detection emails outside the three paging groups; the never-wired weekly blocked digest; "message the owner" steps in R-WATCH and R-SHEP; strategy-brief ask cells; and the `/admin` index profit dashboard.

### Self-healing invariants (enforced in code or CI, not prose)

1. No ticket kind without an executor: program and config coerce to process with an [owner] tag; campaign and promo execute from `/cron/execute-approved-rows` with the valve check inside; a valve that is off yields one blocker row per valve, not N homework rows.
2. No blocker without a probe: `POST /api/team/blocker` auto-assigns by category (valve, env, PR, CI check, endpoint, trigger); decision and brand-legal are the only probe-less carve-outs; an off-surface category is coerced into a process ticket at the filer's team and returns 202 with the id.
3. No detector without a close path: required dedupe key (default a hash), a declared close path, a per-detector daily cap with one rollup row, reopen-on-repeat capped at 2.
4. No owner email outside a registered escalation class.
5. Machine-filed escalation is capped: 5 new blocker rows per sweep, one social re-fire per platform per day, blocked auto-return 10 per day.
6. Blocked is a state, not a close: attempt_count-0 rows without an [owner] or [protected] tag return to approved; code rows get an evidence-only agent retire edge (merged PR link or live superseding row); Weekly Strategy audits code retires older than 7 days.
7. Every approved row is readable by someone: `target_team` defaults to `team`; the janitor counts NULLs and files one row when above zero.
8. Mailboxes age out: approved process rows with new-product, restock and homepage-freshness prefixes older than 14 days go applied as "aged out"; new-product signals batch into one daily digest row; the cap query matches the canonical key, with a test that files through `createSuggestion`.
9. A run that does not finish did not succeed: the run API stamps `finished_at` server-side on any terminal status, normalises status to succeeded/failed/skipped, clears error on later success, rejects unknown runTypes at start, and enforces a per-team maximum session length.
10. Crons leave records: `cron_runs` and `cron_expectations` (additive), a `cronRoute` wrapper that writes started/finished/ok/status/result, a started row with no finish after maxDuration plus 2 minutes is "killed", expectations seeded from `vercel.json` with a CI drift test. Scheduler last-run status is never a health signal.
11. Lane output has a floor: `cron_expectations` carries a completeness probe and a floor (pricing SKUs, social posts, enrich published, indexnow pushed), seeded at the observed p10 of the last 30 days and tuned by the cost review.
12. Red main is a ticket: main-ci-watch files `main-red-<check>-<date>`; R-SHEP reads main's head first and rebases dirty PRs; QA never verifies over a red check and does not burn an attempt when main is the cause; `ci.yml` retries a failing vitest file once and labels flaky versus failed.
13. The engine reclassifies every cycle: needs-owner is removed when refinement clears; migration PRs hold as ci-pending until dry-run concludes; classification is against the merge base; one link row per PR; smoke retries once with a docs-only carve-out; the revert path bounces the ticket; log-monitor P0/P1 tickets attach prior-6h merges to a regressions counter that shares the breaker threshold.
14. Merges are visible: the sweep counts non-engine merges of non-protected PRs as a policy breach with PR numbers; sessions are denied `gh pr merge`; a session files the ticket and stops.
15. Docs and prompts state no live posture: trigger prompts say "follow routine-<x>.md at <version tag>, read posture from /api/team/status at Step 0"; `routines.json` generates ROUTINE_CADENCES and the schedule table with a divergence test; generated blocks render into operating-system §2/§5/§6, the README roster and the CLAUDE.md cron table with a CI check.
16. System valve writes are audited and reversible: removal watchers file with a `setting_true` probe, store the pre-cut frequency and restore it on re-enable, and count only platform-attributed removals; every admin writer goes through `setPipelineSettingAudited`. No cron lowers a budget.
17. Spend cannot be faked into a gate: unknown token-log sources are zero-rated or rejected; a single row above a team's whole daily budget is quarantined and ticketed.

### 30-day plan

Twelve items in order. Unprotected work first; protected edits batched into two Monday read-and-click windows. "Owner action" is the whole of what the owner does.

| # | Item | Closes | Kind | Effort | Owner action | Who |
|---|---|---|---|---|---|---|
| 1 | **Bus terminal edges.** Add `code` to the evidence-retire kinds and an evidence-only dismissed edge on in_progress and blocked (merged PR required); reopen cap 2; `target_team` defaults to `team`; program and config coerce to process [owner]; system may close campaign/promo on an executed link. Janitor: return unattempted blocked rows to approved (10/day), bridge [owner]-tagged blocked rows to blockers, SLA classes for approved-no-executor and blocked at 14d. Rewrite routine-dev-daily.md 259-262 to "retire with satisfiedBy=<merged PR>". R-DEV bulk-retires the 25 done or duplicate rows and the 6 auto-expiry rows; tag the 11 protected parks first; backfill the 78 NULL rows. | F14 F28 F32 F17 F26 F31 F19 | code | S | one click (team.server.ts, window 1) | R-DEV protected-authoring lane, R-QA pre-verifies, agent-editor for the playbook line |
| 2 | **Process intake and drain.** Fix the new-product cap query to the canonical key with a filing-through test; batch new-product signals into one daily row like restock; janitor age-out of mailbox rows; playbook mailbox reads become two list calls until item 1 merges; the Apply Pass prompt stops stating a stale cap. | F15 F16 F17 | code | S | none | R-DEV, agent-editor |
| 3 | **Detector discipline and the escalation registry.** Required dedupe key, close path and per-detector daily cap in `fileDetectionTicket`; `sendOwnerEmail` takes a mandatory escalation class with a test over all 17 call sites; log-monitor pages only for checkout, order-created and fabrication-guard groups and stops opening GitHub issues; auto-expired runs write a liveness flag and file one P2 process row at the owning team only on 3 expiries per (team, runType) in 14 days. | F26 F29 F36 F33 F13 | code | S | none | R-DEV |
| 4 | **Red main is a bus event.** main-ci-watch files a P1 code ticket at strategy and emails only if still red after 6h; R-SHEP Step 0 reads main's head first and gains a dirty-PR step; its charter is regenerated from PROTECTED_GLOBS; QA red-base carve-out without an attempt increment (#6934); fix the time-flaky test (#6933) by freezing the rail seed clock. | F01 F27 | code, instructions | S | none | R-DEV, agent-editor |
| 5 | **Trigger reconciliation, one config session.** Prune the nine over-connected triggers to their playbook's real set with explicit permitted_tools; disable the legacy Thursday apply trigger; reissue every prompt as "follow routine-<x>.md at <version>, posture from /api/team/status"; attach google-analytics to Weekly Strategy, Routine A, Cost Review and R-QA; create R-BLOCK (daily 12:00 UTC, strategy gate, no connectors); retime R-SHEP; delete the 14 one-shot re-check triggers; document the two environments; fix README.md:48, store-strategist.md:137, routine-daily-merchandise.md:233 and schedule row 15; add the untrusted-input block to the five playbooks that lack it. | F09 F10 F21 F05 F27 | trigger, config | S | none if an interactive session holds the trigger API, else one 15-minute session | interactive session with RemoteTrigger; agent-editor for the doc fixes |
| 6 | **Probes mandatory, list reconciles itself.** Auto-assign probes by category on the blocker API with new probe kinds (env_present, pr_merged, check_green, endpoint_200, trigger_enabled); per-run cap of 5 new rows; removal watchers file with a probe, store the pre-cut frequency and restore it on re-enable, count only platform removals; three admin writers go through the audited setter; backfill probes on #13, #14, #16, #18, #24 and dismiss #19; apply migration 088 with #23 corrected to owner; the 13:30 cron becomes verify-only; blocker-scout added to the cadence table; every "message the owner" replaced with the blocker API call, with a docs lint on the phrase. | F06 F07 F08 F05 F33 | code | M | one click (apply migration 088) | R-DEV; R-BLOCK from day one of its trigger |
| 7 | **Every kind has an executor.** `/cron/execute-approved-rows` daily 06:00 runs the campaign and promo executors with the valve check inside; valve off files one cost blocker per valve; valve on executes with a first-run cap of 1 each and writes the executed link; bulk-close the pre-rekind campaign rows; `GET /api/team/ga4-summary` exposes ga4.server.ts to every routine; the strategist files a blocker with a probe for any unreadable source and hands three-strike rows to a decision, never to an owner dismissal list. | F31 F21 F19 | code | M | two money decisions, surfaced as probe rows: `promo_execute_enabled` (blocker #60, before 09-07) and `email_campaign_push_enabled` | R-DEV, store-strategist |
| 8 | **The Owner Queue.** `owner-queue.server.ts`; the digest renders only that object with send-on-change, 7-day and Monday rules and subject-line counts; `admin.ops.tsx` as the /admin landing; `/api/team/status` gains owner and health; the 7-day WARN-becomes-ticket rule; the policy-breaches section; Ops watch re-pointed at `import_candidates` and pricing printed as N of M; the money block with GA4 as its first real importer; HTTP-tier 403 recorded degraded; L4 rules 1-5 with per-episode keys; the token log zero-rates unknown sources and quarantines phantom rows; the 13:30 send path deleted. | F19 F22 F23 F35 F18 F20 | code | M | one 5-minute setup: grant the GSC service account Viewer on the GA4 property and set GA4_PROPERTY_ID | R-DEV |
| 9 | **Release-engine hygiene, two protected PRs in one Monday window.** 9a mechanics: reclassify each cycle and drop needs-owner on clear; hold migration PRs until dry-run concludes; classify against the merge base and refuse stacked PRs; one link row per PR; protected PRs file a blocker row instead of an email; ci-red bounces do not increment attempts while main is red; smoke retries once and skips docs-only; the revert path bounces the ticket; log-monitor regressions count toward the breaker; ci.yml vitest retry-once with a flaky label. 9b policy: instructions PRs need QA verified with a docs checklist (drop the carve-out at release-engine.server.ts:747); a protected docs tier for the governance playbooks; deny `gh pr merge` to sessions. | F18 F30 F25 F20 F01 | code | M | two clicks (window 2) plus PR #991 in the same sitting | R-DEV protected lane, R-QA pre-verifies |
| 10 | **Liveness from records.** Additive migration for `cron_runs` and `cron_expectations` (with completeness probe, floor and money-relevant columns); the cronRoute wrapper; killed detection; expectations built from vercel.json with a CI drift test; 30-day purge; 6-hourly `/cron/janitor-sweep` running cron liveness (first miss files a ticket; a killed money cron goes to the health line, twice consecutive pages) and the lane floors; run API terminal semantics and a per-team session cap; `routines.json` generating ROUTINE_CADENCES and the schedule table with a test; `/api/team/status` gains routines and crons. | F02 F37 F04 F11 F12 F03 | code | M | none (fully additive SQL merges on the ordinary lane) | R-DEV |
| 11 | **Social lane SLO, gates, and the crons that lie.** Merge PR #1011 (server-side gates) now that main is green; resolve #991's conflict then the owner clicks it; `/cron/social-lane-slo` 23:00 UTC files one P1 at social and re-fires once per platform per day; Step 0 capability probe in the social playbook; pricing recompute gets a per-day cursor, a clean stop at 240s, 07:10 and 07:20 continuation entries and a coverage finalizer; one catch-up run after chunking ships; log-monitor reads Vercel runtime logs (Sentry issues API as a second source), self-tests its feed, promotes recurring P2s; the vision gate scored against 30 days of owner rejections before the owner review lane is retired. | F03 F08 F34 F12 F13 | code | M | one click (PR #991, counted in window 2); optional SENTRY_AUTH_TOKEN | R-DEV, social runs, R-QA on the gate measurement |
| 12 | **Identity phase A and the ops manifest** (starts week 4). Log a credential id on every team-API write and cron call; a QA-only token for the `verified` transition; a rotation checklist for both environments. Phase B (drop the CRON_SECRET fallback, per-routine tokens) only after the breach line has two weeks of data. Manifest phase 2: valve registry with writer class, a trigger snapshot committed via PR by an interactive session, generated blocks rendered into the docs with a CI check that fails on any hand-stated live value outside a generated block. | F24 F11 F10 F09 F07 | code | L | one click (auth PR) and one decision: book the 30-minute rotation sitting for phase B | R-DEV protected lane, interactive session, agent-editor |

Day-30 expected state: items 1-11 on main, item 12 phase A merged. Two Monday protected windows (week 1: item 1; week 2 or 3: 9a, 9b, PR #991) plus item 12's click in week 4.

### What to stop or delete

1. The 13:30 blocker email send path (route kept as probe-verify).
2. Ten digest sections as email content (they become collapsed panels on /admin/ops).
3. Per-PR protected-path emails on first classification and the per-cycle duplicate link rows.
4. log-monitor GitHub issues and first-detection email/SMS outside the three paging groups.
5. Filing a P1 code ticket at homepage for every auto-expired run; dismiss #5475, #5954, #6262, #6553, #6706, #6707.
6. Accepting program and config as kinds, and blocker rows with no probe or an off-surface category.
7. Parking code tickets at blocked with attempt_count 0 as a way to close them.
8. Wiring the weekly blocked digest (#2863 / #3545); dismiss #3545.
9. Sessions merging their own PRs and arming one-shot re-check triggers (delete the 14); file the ticket, stop.
10. The legacy Apply Thursday trigger.
11. Valve posture and caps stated in trigger prompts, README, agent defs and strategist guardrails.
12. Gmail, Drive, Calendar, SmartSheet, Krisp, Etsy, Meta Ads and Claude_Code_Remote on the nine over-connected triggers.
13. "Message the owner" and "escalate to mike@" as terminal steps in any playbook or agent def.
14. Weekly Strategy handing the owner a dismissal list.
15. Scheduler last-run status or duration as any health signal.
16. The /admin index profit dashboard as the landing page.
17. Sending the daily email when nothing changed (except Mondays).
18. The Instagram owner review lane, only after item 11's measurement passes.
19. The pricing-ops sweep narrating partial runs instead of filing.
20. The docs carve-out merging an agent-authored instructions PR with its ticket still approved.

Explicitly not stopped: R-WATCH and R-SHEP (retimed, not retired), R-BLOCK's playbook and valve (scheduled, not deleted), per-team budget caps (owner-set; the proposed auto-lower was rejected by both judges as a violation of the cost-only rule).

### Owner's steady-state time budget

After items 1-9 land: about 25 minutes a week reading the Owner Queue on the days it sends, a 15-minute Monday read-and-click window (target 3 or fewer protected PRs a week, down from 44 in 14 days), about 15 minutes of cost rows that clear themselves, and 0-2 pages a month. Under one hour a week, zero routine-checking, one page and one email.

One-time during the 30 days, about 75 minutes: window 1 (5 min), migration 088 (2 min), GA4 grant plus property id (5 min), window 2 (15 min), item 12 click (5 min), the two money decisions (10 min), the trigger session if no session holds the API (15 min), optional Sentry token (5 min). Phase B token rotation (30 min) is booked after day 30.

### Risks the synthesis names

The protected clicks carry most of the leverage (if window 1 slips, blocked rows keep needing hand dismissal); blocked auto-return can re-queue a genuinely parked row once (mitigated by tagging the 11 protected parks first and the reopen cap); mailbox age-out may hide a signal no social run read (aged rows keep their key; the daily digest row carries the product list); GA4 numbers are tiny so the sessions-zero page needs 2 consecutive days; the campaign and promo executor sends real emails and mints real codes the moment a valve flips (first-run cap of 1 each); F24 stays half-open through day 30 by choice; lane floors set too high recreate the permanent-WARN class (seeded at p10, tuned by cost review); retiring the IG review lane removes the last human eye on images (only after the vision gate is scored).

## 5. What the critic says the audit did not cover, and the three questions only the owner can answer

Not examined: the support lane (IVR on Fly, SMS, web chat) where nine of twelve runs report an empty window and nothing distinguishes "no customers" from a dead feed; Shopify webhook liveness (the `webhook_registered` probe exists and zero rows use it); Klaviyo integration health; KV quota, Sanity healthcheck output, Sentry error rate, GitHub Actions minutes; backups and restore (no Neon branch or dump policy found); secret expiry for Shopify, Klaviyo, Instagram, X, Atlas, RunPod (an expired IG token would look like a takedown to the removal watcher); main-ci-watch ignoring lighthouse and allowlist reds; the influencify sibling project sharing the trigger quota and personal connectors; GSC crawl budget.

Findings that rest on one number: F12's catalog size (~6,700 variants from one 30-day count), F20's 48% (a squash-signature heuristic), F21's 141 sessions (one 28-day pull), F23's spend-to-profit ratio, F16's +15.9/day (a window contaminated by the F15 flood).

Contradictions the critic found in the plan, which the owner should decide: item 9b adds a protected docs tier and item 1 adds protected edits, both expanding the merge surface the 08-19 doctrine shrank; "immediate email for money-path PRs" is undefined; the F26 fix stops filing on auto-expiry while the F03 fix re-fires social on zero drafts (runs 623/624 would trigger both); L4 adds SMS paging, a channel that does not exist today; denying `gh pr merge` to sessions also breaks the owner's own read-and-click from a Claude session; send-on-change can be silent when the queue is permanently wrong (mitigated only by the 7-day row rule); the trigger snapshot by "whichever interactive session" is a weekly hand step.

Three questions for the owner:

1. Is "checkout browser tier green plus a manual gateway transaction" the definition of the money path, and may L4 page by SMS at all (number, cap)?
2. Which docs are protected: accept the 9b docs tier (more owner clicks, against the cost-only rule) or keep docs unprotected and require QA `verified` only?
3. Flip or dismiss: `promo_execute_enabled` before 09-07, `email_campaign_push_enabled`, and who takes the trigger-config session (owner, or a session holding the trigger API), including the influencify triggers on the same account.

## 6. Ticket-shaped summary for the bus

Nothing was filed. If the plan is accepted, the twelve items above map to twelve `code` tickets (items 1, 9 and 12 carry the protected-path body section), one `trigger` session (item 5), and three owner blockers with probes (promo valve, email push valve, GA4 property id). The five broken-now items in §1 are P1 today regardless of the plan: the time-flaky test (#6933 approved), the pricing recompute cursor, the log-monitor feed, the new-product cap query, and the probe backfill on blockers #13, #14, #16, #18, #24.

## Appendix: evidence pointers

- Trigger inventory as fetched 2026-09-01: 25 manifest triggers all enabled, last runs SUCCEEDED, notifications off; 14 one-shot re-check triggers; the list endpoint pages badly (cursor returns the same page), so unlisted triggers may exist.
- Main CI: last green `c1db3a67` 18:24 UTC; failures `55b7625b` 18:46 and `ba20d8d4` 18:47; six cancelled runs in the merge burst; green again `2c4c9f85` 05:21 UTC 09-02 with no test change. Local: 1 failed / 28 passed at every commit from `c1db3a67` to `ba20d8d4`. Cause: `railSeedBucket(now = Date.now())` with `RAIL_SEED_BUCKET_MS = 900_000` in `app/lib/storefront-home.server.ts:187`.
- Pricing: `pricing_audit_log` trigger=batch per UTC day 08-27 4323, 08-28 3972, 08-29 4023, 08-30 1362, 08-31 1154, 09-01 2011; last row 07:05-07:06 each day; zero `batch_catchup` rows in 30 days.
- Bus: 852 applied, 348 dismissed, 300 approved, 45 blocked, 3 pr_open, 1 proposed, 1 verified; 681 created vs 459 terminal in 14 days.
- Blockers: 10 open (#13, #14, #15, #16, #17, #18, #19, #24, #57, #60), only #60 has a probe.
- Vercel error groups 7d: product-created 4000ms budget 145; fetchHonoraryProducts Throttled 24; 300s timeout 7; product-type-guard 9; two varchar overflows; three PDP Storefront timeouts; one fabrication guard.
