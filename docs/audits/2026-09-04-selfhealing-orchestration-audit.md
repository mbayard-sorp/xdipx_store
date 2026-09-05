# Self-healing, cron sanity, handoffs and orchestration: audit, 2026-09-04

Commissioned question, verbatim: *"I still find myself chasing failures all day long when I could be doing other important work. I want each routine to include self-healing and problem solving capabilities. Where are the gaps? Do all of the cron timers make sense? Are tasks efficiently handed off between agent routines? Do we need an agent that orchestrates automation and can make changes to crons to get tasks tighter and more efficient? What questions am I not asking that should be addressed?"*

Method. Six auditors established live ground truth (cron planes, routine plane, ticket bus, the in-flight remediation program, the owner surface, and an inventory of every automatic repair mechanism in the code). Fourteen dimensions then investigated in parallel, each one adversarially verified by a second auditor instructed to refute by default and to downgrade anything already fixed or already tracked. 34 agents, 2,906 tool calls, 8.3M tokens. 169 findings survived: 25 P1, 75 P2, 69 P3. Everything was measured against the production database (read only), the repo at `7e2efefc`, GitHub, the trigger API and the Vercel API on 2026-09-04.

This is a delta audit, not a repeat. The 2026-09-01 audit is three days old and its 12-item plan has been executing since 2026-09-02 as the self-healing program (`docs/store-team/trackers/self-healing-automation.md`), with stages A through G merged across 68 commits. Findings that merely restate 09-01 were dropped unless verified still true today. The most valuable findings below are defects the remediation itself created.

Prior audits: 2026-07-22 automation drift, 2026-07-29 fleet evaluation, 2026-08-05 workflow audit, 2026-08-12 all-hands, 2026-09-01 automation audit.

---

## 1. Verdict

**The estate now detects almost everything and acts on almost nothing.** Between 09-02 and 09-04 the program shipped a 42-route liveness manifest, durable cron records, an unwatched-lane detector, a credential prober and a routine-cadence checker. It wired a filing path for exactly one of them. `readCronLiveness()` has one caller in the entire tree; that caller writes its findings to `console.warn` and to a JSON response body nothing reads. `computeOwnerQueue()` does not read cron health at all. Nothing anywhere queries `cron_runs` for `status='failed'`.

The proof is not theoretical. It is what happened during this audit.

**Both of your notification channels have been dead since you turned the owner queue on.** `/cron/owner-digest` and `/cron/blocker-list` returned HTTP 500 on 4 of 4 recorded runs across 2026-09-03 and 2026-09-04. `daily-digest` was classed `channel: 'queue'` and the sender's guard read `channel !== 'page'`, so the valve whose only purpose is folding other classes *into* the digest folded the digest into itself. Those four rows are the only `failed` rows in the entire 835-row `cron_runs` table. The six-hourly janitor sweep ran through the outage four times and reported neither, because `breached` is computed from age alone and a failing cron still writes a fresh row on time. Fifteen open owner blockers had no delivery path to you. It was found by a person looking, not by the fleet.

Fixed during this audit as [PR #1084](https://github.com/mbayard-sorp/xdipx_store/pull/1084), ticket #7582, CI green. The actuator gap it exposes is not fixed and is the single highest-leverage item in this report.

Measured today, the janitor's alarm has **0/7 precision and 0/2 recall**. All seven breaches it reports are false: three weekly or monthly routes that cannot have heartbeated since the valve flipped, two demand-driven routes given 15-minute floors, one route (`/cron/regenerate-emma-rail`) with zero callers anywhere given a daily floor, and the money-relevant GitHub Actions checkout probe whose `checkout_probe_runs` liveness fallback its own manifest note promises was never implemented. It is green 12/12 and reported dead every sweep. Meanwhile the two crons that were actually failing appear nowhere.

That is the whole mechanism behind "I chase failures all day". The failure list contains failures that are not failing, omits failures that are, and nothing in the estate can tell you which is which.

### The second verdict, which matters more

The framing of the question assumes the machine is a valuable asset that fails too loudly. The data does not support that.

| | |
|---|---|
| Revenue, last 90 days | **$57.29** across 2 orders |
| Revenue, last 30 days | **$28.11**, 1 order, $19.62 profit |
| Against the $2,000/month goal | **0.98%**, flat, not slow |
| Two of the three lifetime orders | are **yours**, counted as revenue with no exclusion anywhere in the code |
| Claude tokens, 30 days | 181.9M, 96% billed to Max and recorded at $0.00 |
| Those tokens at the estate's own rate table | **$2,088** of list-price compute. Your money surface reports $96.91 |
| Share of runs and tokens going to strategy dev/QA/apply | **46% of runs, 39% of tokens.** The machine maintaining the machine |
| Customer-facing files touched by the 68 commits since 09-01 | **0** |
| `ads_team_enabled` | false for **46 days**, 3 campaigns approved and unspent since 2026-07-14 |
| `email_campaign_push_enabled` | does not exist as a row. 2 briefs waiting 17 days, 0 emails in 8+ weeks |
| Owner blockers ever filed about ads, email, traffic, conversion or revenue | **0 of 55** |

The remediation program built an excellent machine for routing the machine's own maintenance to you, and has never once put a demand decision in front of you. Content produced 30 articles for zero organic clicks. Social cost $629 at list and produced 133 Instagram reach and 525 X impressions. Those are not failures of self-healing.

---

## 2. Where are the gaps

### 2.1 The one gap that explains the others: detection without actuation

`/cron/janitor-sweep` computes breaches, unfinished runs, unwatched lanes and credential health every six hours. It files tickets for **exactly one** of those four: `fileCredentialBlockers` at `server/cron.ts:1795`. The other three are `console.warn` loops at `:1806-1824`, into a log stream whose only reader (log-monitor's classifier) Stage G3 deleted.

The wiring is three lines away from working. The same handler already holds the actuator.

Everything below is the same defect at a different altitude:

- **A cron that fires on time and fails every time reads healthy.** `cron-runs.server.ts:297`: `breached = ageMinutes === null || ageMinutes > period + grace`. `lastStatus` is computed on the row and read by one consumer that copies it into a JSON body and does nothing with it.
- **No lane has an output floor.** `cron_expectations` has no floor or completeness column and no code implements one, despite tracker invariant 3 stating that every lane has a floor whose breach files a ticket. So every dead lane reads GREEN: enrichment coverage frozen at 1,642 for **39 consecutive days**; IndexNow pushed 19 URLs in 9 days while the sitemap grew 220 and indexed pages fell 97 to 91; the outreach valve has been on 4 weeks and sent 1 message; the homepage was byte-identical in all four merchandised slots on 42 of 42 healthchecks with its alarm structurally mute.
- **21 of 25 routine playbooks terminate every precondition failure identically** as "post skipped, stop". No ticket, no blocker. Only video-render, blocker-scout and R-SHEP file anything.
- **The actuation layer is itself fail-silent.** `ticket filing failed (ignored)` appears in log-monitor, category-healthcheck, notebook-healthcheck, checkout-probe and `detection-tickets.server.ts:167`. There are 57 explicitly-ignored error paths and 83 empty catches across `app/` and `server/`. A bus hiccup vaporises the detection, and the estate had two such hiccups this week (the `suggestion_links` index PRs).

### 2.2 Your failure list is roughly 70% noise

Of 27 `failed` routine runs in 30 days, **19 were stamped by the idle reaper, not by the routine**, and 10 of those had already posted a `retro` event. The run finished its work and is recorded as a failure with an empty summary. Only 3 runs in 30 days carry a self-reported error.

Combine that with the janitor's 0/7 precision and the picture is exact: most of what you are chasing is not broken.

### 2.3 Nothing re-checks a resolved problem

34 tickets sit `blocked`, every one at `attempt_count` 0, oldest 2026-07-20. Three of them (#4889 P1, #4944 P2, #5061 P1) all say `GET /api/team/conversion-status` is returning HTTP 500. It returns **HTTP 200** today and has since a commit twelve days ago. Nothing re-probes a blocked row against live state, so a self-healed defect is indistinguishable from a live one and stays on your list forever.

Related: `fileBlocker`'s `ON CONFLICT` clause updates timestamps only. `title` is not in the SET list at all, and detail/evidence use `COALESCE(existing, EXCLUDED)`. So a watcher that re-observes a changing condition hourly can never change what you read. Live consequence: **blocker #50, your top-priority open ask, names a GPU pod that stopped six days ago while two different idle pods bill $2.08/hr right now.**

The three-strikes ladder has still never fired. Max `attempt_count` anywhere on the bus is 2. The approved backlog grew from 251 to 281 during the remediation.

### 2.4 Two merged migrations are unapplied, one costing money daily

`093_pricing_audit_trigger_values.sql` is on main and not in `schema_migrations_applied`. Production still has the pre-093 CHECK constraint, so `pricing_audit_log` **rejects roughly 2,240 writes a day**, which is over half the price changes actually shipped to Shopify. The A1 milestone's entire acceptance criterion is measured off that table, so the money path's coverage metric is red for a reason unrelated to the money path, and the corrupted numbers already produced two wrong diagnoses inside 24 hours, including one finding in this very audit.

`092_owner_blockers_dedupe_key_canonicalize.sql` is also unapplied.

Neither has an owner blocker or a ticket. `scripts/apply-additive-migrations.ts:210` emits a `MANUAL:` console line and does nothing else. The non-additive migration lane has **no queue at all**.

**Owner action, 2 minutes:** `DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 092`

---

## 3. Do the cron timers make sense

Mostly yes. This was the weakest hypothesis going in and the evidence does not support a schedule overhaul. The Vercel scheduler delivers reliably (release-engine 139/144 fires in 24h, import-enrich 48/48, checkout-probe 4/4), the KV negative cache on the two 2-minute pollers genuinely works, and the "same-minute herd" theory is refuted: 24 of 818 daily slots carry 11 to 15 crons, but **measured peak concurrency among recorded routes is 4**, because Vercel jitters dispatch and Neon is stateless HTTP with no pool. No contention has been observed.

At 2 orders in 83 days, every "this cadence wastes N invocations" argument also fails its own materiality test. Do not spend time there.

What is genuinely wrong is smaller and specific:

| Problem | Evidence | Fix |
|---|---|---|
| **The declared 300s ceiling is not real.** Two single-process invocations completed at **308.4s and 420.2s**. Every 295s lock TTL in the estate (`POLLER_LOCK_TTL_SECONDS`, `RECOMPUTE_LOCK_TTL_SECONDS`) is derived from a premise production contradicts. Latent today only because no in-flight video job has existed since 08-23. | `cron_runs` durations | Raise TTLs above observed max, or enforce the budget in-process |
| **The daily pricing walk has not covered the catalog on any of the last 7 days.** Best day 5,574 of 7,077 SKUs (79%). On 09-03 the continuation chain dropped a kick and stopped at `done:false` with 4 of 8 kicks unspent. The continuation is an un-awaited self-POST with no scheduled backstop, and `kvDel` runs after `res.json` on a platform that discards post-response work. | `pricing_audit_log`, `cron_runs` | Scheduled backstop, not a self-POST. Alarm ticketed as #7516 |
| **The checkout probe declares `30 7 * * *` and actually fires 12:13 to 19:33 UTC**, so its 120-minute grace is unmeetable and it lands 13 minutes *after* the 12:00 HTTP probe rather than offset from it. | `gh run list`, 8 recent fires | Re-declare the schedule to reality, or move to the Vercel plane |
| **The digest at 13:00 renders blocker probe verdicts that the blocker list produces at 13:30.** Every probe verdict you read is 23.5h old against a `PROBE_STALE_HOURS = 24` threshold: a permanent 30-minute margin. If the blocker cron slips 31 minutes, every row flips to "stale probe" at once. | `owner-queue.server.ts:59,210` | Swap them. Verify at 12:45, render at 13:00 |
| **`/cron/seo-daily` is pinned to discovery index `v7`; the producer writes `v9`.** All 38 `seo_coverage_daily` rows since 07-29 carry identical July counts. | `seo-daily.server.ts:277` | One-line repoint |
| **`purchase-watcher` check 4 scans Vercel *build* logs for a runtime marker**, 192 API calls a day, and can never match. This is 09-01's F13 surviving verbatim inside the one watcher permitted to page you. | `purchase-watcher.server.ts` | Delete the check or repoint it at Sentry |
| **Pacific-time annotations shift an hour on 2026-11-01.** The schedule is entirely UTC; every PT annotation in `server/cron.ts` and `routine-schedule.md` is true only under PDT. Four audience-facing routines silently move. | docs vs `vercel.json` | Annotate both, or drop the PT annotations |

Two smaller ones worth doing because they are free: `/cron/social-publish` and `/cron/instagram-comments-ingest` share `0 * * * *` and an Instagram token; `/cron/indexnow-push` and `/cron/db-backup` share `40 4`. Separate them.

**The real ordering problem is not a time offset.** Four load-bearing dependencies are expressed as hope rather than sequencing, and three are failing right now. Those should stop being schedules and become chained invocations or queue reads.

---

## 4. Are tasks handed off efficiently

Measured from production timestamps joined to GitHub, over 14 days.

**The agents are not slow. The cron shape is the wait.**

| Hop | p50 | p90 |
|---|---|---|
| Filed to applied (code ticket) | **5.27h** | **35.13h** |
| Attributable actual work | **~36 min** | (R-DEV 7 min, CI 5-7 min, R-QA 3.5 min, engine merge+deploy+smoke ~20 min) |
| approved → claimed (the slowest hop) | 2.89h | 17.62h (mean 5.48h) |

**88% of the median and 98% of the p90 is a ticket sitting still, waiting for the next scheduled actor to wake up.**

And the fleet is already at the theoretical floor of its own schedule: modelling every ticket as claimed at the very next R-DEV fire gives a mean of 5.84h against an observed 5.48h. There is no throughput problem to fix. The claim queue is empty (2 approved code rows) and R-DEV drains it every pass.

**The single highest-value scheduling change in this report:** add one R-DEV pass at **02:00 UTC**. Modelled mean approved-to-claimed drops from 5.48h to **3.19h**. It would be picked up by the 03:30 R-QA pass that already exists and currently does almost nothing (6 verifies in 14 days versus 45, 24 and 51 at the 11:00, 16:00 and 21:00 passes).

Three structural defects sit underneath:

1. **Priority buys ordering inside a wave, never an earlier wave.** Nothing in the estate can start code work before the next scheduled R-DEV pass, so MTTR for anything needing a diff has a hard floor of up to 14 hours. P1 #7140 waited 13.28h; P1 #7150 waited 12.70h. Marking a row P1 changes only its position in the next wave.
2. **The release engine's pending-merge gate is an unbounded head-of-line block.** It froze every merge, sweep, label and escalation for **22.25 hours** on 09-02/09-03, and its only alarm routes through the suppressed queue class. Half-fixed.
3. **`main-ci-watch` reported "green" 135 consecutive times through that freeze**, because it reads the head SHA's stored conclusion with no staleness guard.

Outside the code lane, the social/process mailbox holds **152 approved rows, oldest 17.2 days, against a drain rate implying a 227-day burn-down.** That is not a latency problem, it is a queue that will never empty.

---

## 5. Do you need an orchestrator agent that can change crons

**No. And specifically, do not build one whose actuator is cron times.** This was examined by a dedicated dimension and independently verified. Three findings drive it.

**1. The function is real, but it is not a scheduling function.** `routine-schedule.md`'s own status log records seven retiming sessions between 2026-07-13 and 2026-09-02. Every one happened inside an owner-initiated audit or fix session and executed same-day. The one time a cadence collision was filed as a ticket instead (#892, 2026-08-02) it has sat `approved` for **33 days** while its collision class recurred 12 more times. So the work does get done, quickly, when a session does it, and never when the bus owns it.

**2. Retiming is the wrong lever.** The SEO-curation slot has been moved three times (16:00 to 19:00 to 10:00). Ticket #892 states in its own text why the second move failed: *"the 19:00 move did not help because the retry started at 19:02."* 60% of the 35 crons are queue pumps or absence watchdogs whose clock offset is arbitrary. The real contention is a per-team mutex and a per-day allowance that no code can queue against, only skip. An agent tuning cron times would be optimising the layer above the problem.

**3. The write surfaces an orchestrator needs are currently unguarded, and that is a live hazard regardless.** `vercel.json` is **not** a protected path (dropped 2026-08-19), and `cron-expectations.test.ts` asserts only vercel.json → manifest, never the reverse. The auditor ran the test's own filter against a mutated copy: **a PR that deletes `/cron/checkout-probe` and `/cron/pricing-batch-recompute` passes every assertion in the file with zero failures.** `graceMinutes` is asserted only `> 0`, so widening a money floor to infinity is legal.

Install those guards whether or not you ever build the agent.

### What to build instead

The high-value work needs no new agent. **Wire the janitor sweep's existing computations to the actuator that is already in the same function.**

*[Corrected after implementation. This block originally routed every branch through `fileDetectionTicket` and described the result as self-closing. It is not. `fileDetectionTicket` files `kind: 'code'`, `code` has no agent-reachable close edge, and the dedupe index it writes against is partial on everything but `applied` and `dismissed` (`detection-tickets.server.ts:20-25`). An open undated `cron-breach:<route>` row would therefore hold its key forever, and the next real breach of that route would file nothing. The alarm would permanently disarm itself the first time it fired. The correct mechanism already existed and was unused. Shipped as [PR #1085](https://github.com/mbayard-sorp/xdipx_store/pull/1085), ticket #7601.]*

```
for (const b of breaches)      → file kind: 'process' at b.ownerTeam,
                                  priority 1 when b.moneyRelevant,
                                  dedupeKey `cron-breach:<route>`
lastStatus === 'failed'        → the same, after 2 consecutive failures
for (const u of unwatched)     → dedupeKey `unwatched-lane:<team>:<runType>`
countUnfinishedTerminalRuns    → one rollup row

route healthy on a later sweep → close the row on that same sweep, via the
                                  `system → applied` edge already fenced to
                                  DETECTOR_SELF_CLOSE_KINDS
still breached after N sweeps  → escalate once to a `code` row
```

`kind: 'process'` is doing two jobs. It is the honest label for a liveness signal, and it is the only kind the detector that raised the alarm is permitted to clear: `DETECTOR_SELF_CLOSE_KINDS = ['process']` (`team.server.ts:1840`) with the fenced `system → applied` edge at `:1905` and `:1922`. `closeStaleSamenessTickets` (`homepage-healthcheck.server.ts:830-873`) is the working shape to copy, including its ordering: close the cleared conditions first, then file, so a key that should be free is free before anything files against it. Filing `process` rather than `code` is also what keeps these rows off the protected path, the choice `log-monitor.server.ts:74-80` already argues verbatim.

Preconditions, in order, because filing against a 0/7-precision alarm would be worse than silence:

1. Add the `checkout_probe_runs` fallback for the `actions` plane that the manifest note already promises.
2. Delete or repoint the three expectations naming routes `vercel.json` does not schedule, and `/cron/regenerate-emma-rail`, which has no callers.
3. Give the two demand-driven `warm` routes heartbeats or drop their floors.

That takes the sweep from 7 breaches to 3 real ones. **Then** turn on filing. Then add `cronsFailed` to `HealthBlock` so cron health renders on `/admin/ops` even when the push channel is down.

---

## 6. What you are not asking

**"How do I heal faster" is the wrong question. The right one is what to delete.**

Of 18 recorded crons, only 2 have ever failed, and both failed in the same shared seam between a valve and a caller contract. Adding a healer to each routine would add healers where the defects are not. The defects live in the seams between components, not inside them, and a per-routine healer cannot see a seam.

Meanwhile the estate carries 53 agent definitions, 25 cloud routines, 35 crons, 17 detectors, 65 admin pages and 6 trackers, for a store with one real customer order in its lifetime. **There is no page-view instrumentation on `/admin` at all**, so "which of these 65 pages could be deleted" cannot be answered with data today. That is the cheapest deletion list in the estate to produce and nobody owns producing it.

The five questions that should replace the four you asked:

1. **Is the machine's job demand, or is it maintenance?** 46% of runs and 39% of tokens go to strategy dev/QA/apply. Zero of 68 commits since 09-01 touched a customer-facing file. Zero of 55 owner blockers ever filed concerned ads, email, traffic, conversion or revenue. The system is structurally incapable of asking you the only question that matters, because nothing files a blocker for a demand decision.

2. **What is the real denominator?** Total infrastructure cost is unmeasurable from inside the repo. Anthropic tokens and RunPod can be priced; Vercel, Neon, Sanity, Atlas, fal, ElevenLabs, Twilio, Klaviyo and the Max subscription have no row anywhere. True burn is roughly $600 of token consumption plus an unknown SaaS floor against $28.11 of monthly revenue. One hand-entered monthly `costs` row would make the spend-to-revenue ratio the estate's headline number instead of an audit finding.

3. **Are the conversational lanes dead or merely unused?** `emma_chat_messages` last wrote 08-12, `call_log` 08-15, `sms_turns` 08-25. Twilio's own API proves the phone line is correctly configured and has simply received nothing since 08-15, so the 19-day silence is an acquisition fact, not an outage. But `conversation_quality_daily`, the instrument built to tell those apart, has **zero rows all-time** and reports success in 0.0s. One synthetic transaction per channel per day resolves it permanently.

4. **Do the numbers you steer by exclude you?** Two of three lifetime orders are yours and are counted as revenue with no exclusion anywhere in the code. 45 of 148 GA4 sessions come from a single user via `search.google.com` with 368 pageviews, against 9 GSC clicks in the overlapping period, so those 45 cannot be real search traffic and nothing does bot filtering. Real sessions are closer to 103. Also: Shopify reports "reached checkout 27, completed 0" for August while one real order exists, and the one real order does not appear in the completed column. That is either a genuine abandonment cliff or a headless attribution artifact, and it is the highest-value unresolved question in this audit.

5. **What holds, and what only appears to?** Instance fixes hold here; class fixes do not. Three defect classes recurred *inside* the remediation program itself: the unapplied-migration class recurred twice with a measured daily cost, the dedupe-key class recurred at its second call site, and the release engine signed only **42 of 116 merges (36%)** since 08-28, so the QA gate was skipped on two thirds of what shipped, including the remediation. Separately, your digest reports tracker RAG from hand-typed prose while the `evidence probe` column beside it is never executed: milestone `b1-bus` reads `done / GREEN` while its own stated probe returns 34 against a ceiling of 10.

Two security items found in passing, neither previously known:

- **A GitHub PAT sits in plaintext on a running RunPod pod**, readable by any holder of `RUNPOD_API_KEY`.
- **The stray-pod watcher has no ownership filter**, so it books another project's GPU into xdipx's ledger.

---

## 7. What to do, in order

Effort is agent effort unless it says owner.

| # | Do | Closes | Who | Effort |
|---|---|---|---|---|
| 1 | **Merge PR #1084.** Restores both push channels. Already green, ticket #7582 at `pr_open`. | The blackout | engine, after R-QA | done |
| 2 | **Apply migrations 092 and 093.** Stops ~2,240 rejected pricing writes a day and unblocks A1's acceptance metric. `npx tsx scripts/apply-migrations.ts --from 092` | 2.4 | **owner, 2 min** | S |
| 3 | **Clean the breach list, then wire the actuator.** The three preconditions in §5, then file `kind: 'process'` at the route's owning team on breaches, failed-status routes and unwatched lanes, closing each row on the detector edge as soon as the route reads healthy and escalating to a `code` row only after the alarm has stayed open across several sweeps. Add `cronsFailed` to `HealthBlock`. *[Corrected: `fileDetectionTicket` was the wrong actuator and would have disarmed the alarm permanently, see §5. Shipped as PR #1085.]* | 2.1, the verdict | R-DEV | M |
| 4 | **Protect `vercel.json` and tighten `cron-expectations.test.ts`** to assert manifest → vercel.json and a floor on `graceMinutes`. Do this before anything gains schedule-write. | §5.3 | R-DEV | S |
| 5 | **Add an R-DEV pass at 02:00 UTC.** 2.65h off the mean per ticket, into an R-QA pass that is already idle. | §4 | trigger session | S |
| 6 | **Give blocked tickets probes.** Reuse the `owner_blockers` probe vocabulary; the janitor re-runs each blocked row's probe every 6h and auto-dismisses on pass. Clears at least 3 rows immediately. | 2.3 | R-DEV | M |
| 7 | **`fileBlocker` takes newest-wins on `title` and `detail` only**, written `COALESCE(EXCLUDED.x, owner_blockers.x)` rather than bare `EXCLUDED`, so a re-file that omits a field cannot null it. `evidence` must keep its existing reverse COALESCE: only title and detail are machine-measured at all eight call sites, no cron caller passes `evidence` at all, and newest-wins there would let the hourly RunPod pod watcher erase a hand-written CONFIRMED justification, which is the exact thing `titleClaimsConfirmed` (`owner-blockers.server.ts:460-465`) exists to require. `unblocks`, `where_to_go`, `verify_probe` and `verify_arg` are authored once and keep theirs for the same reason. Your #1 blocker stops lying. *[Corrected: this originally said `EXCLUDED` for title, detail and evidence. Shipped as PR #1086.]* | 2.3 | R-DEV | S |
| 8 | **Stop the two idle GPU pods.** $2.08/hr, now. | | **owner, 1 min** | S |
| 9 | **Rotate the GitHub PAT off the RunPod pod** and give the pod watcher an ownership filter. | §6 | owner + R-DEV | S |
| 10 | **Add lane output floors in code, keyed by lane.** Not on `cron_expectations`, and no migration: outreach sends are agent work with no cron behind them, so a cron-keyed floor cannot express them at all. Seed three. IndexNow and outreach get a **staleness** bound ("nothing in N days"), not a rate bound, because the measured p10 over 30 days is **0 on all three lanes** (IndexNow 26 zero-days of 30, outreach 1 message in 8 weeks, social 12 zero-days of 30) and a rate floor seeded at p10 is a check that cannot fail, which is the same defect as a permanently-WARNing line. Social is the only lane regular enough for a rate floor. Drop the homepage floor as unmeasurable: `homepage_payload` is a `(variant, version)` upsert whose `built_at` moves on every warm even when nothing changed, so "slots changed/day" has no data source. *[Corrected: this originally asked for four floors on `cron_expectations`, each seeded at the observed p10. Shipped as PR #1087.]* | 2.1 | R-DEV | M |
| 11 | **Add a probe registry in code, keyed by milestone id**, and render measured-vs-asserted RAG against it, the pattern the `owner_blockers` probe vocabulary already uses. Do **not** execute the tracker's evidence-probe column: `docs/store-team/trackers/*.md` sits inside the agent-editor docs allowlist, which merges docs PRs with no QA verdict (this report's own F25), so running those cells as SQL would let an agent-authored markdown row run arbitrary SQL as the application's database user with no human anywhere in the path. Coverage is partial by design, and a milestone with no registered probe renders as "asserted" rather than measured. *[Corrected: this originally said to make the tracker column itself executable, which is a code-execution surface. Shipped as PR #1088, `app/lib/tracker-probes.server.ts`.]* | §6.5 | R-DEV | S |
| 12 | **One `costs` row, hand-entered monthly**, plus subscription-rated consumption at list beside the metered figure in the money block. | §6.2 | owner + R-DEV | S |
| 13 | **Decide the two demand valves.** `ads_team_enabled` (3 campaigns approved and unspent for 53 days) and `email_campaign_push_enabled` (does not exist; 2 briefs waiting 17 days). Neither has ever been put to you as a blocker. | §1, §6.1 | **owner decision** | |
| 14 | **Resolve the checkout question**: run an `abandonedCheckouts` query for 08-01 to 09-04. If the cliff is real it outranks everything above it. | §6.4 | R-DEV | S |

Items 3, 4, 6, 7 and 10 are the self-healing ask, properly scoped. Items 13 and 14 are the ones that decide whether any of the rest matters.

## 8. What this audit did not cover

Vercel, Neon and Upstash billing (no scope on the token available). The Klaviyo list size, so whether unblocking email buys anything is unknown. Whether an agent can update an existing trigger it did not create, asserted in two docs and contradicted in a third. The full cloud-routine plane could not be enumerated independently: `RemoteTrigger list` returns 20 spent one-shot reminders and ignores its own cursor, so routine-plane claims rest on per-id reads. Whether any of the 65 admin pages are used.

Findings resting on a single number: the 7,077 SKU catalog size, the 36% engine-signature share (a squash heuristic), the $2,088 list-price figure (Max consumption priced at Sonnet list, which is a modelling choice not a cash fact), and the 45-session bot attribution.

## 9. Corrections after implementation

Four of the recommendations in §7 were wrong. Items 3, 7, 10 and 11 have been corrected in place above, each carrying a note that names the PR which overturned it. The findings underneath them all held.

- **Item 3** named an actuator that permanently disarms itself. `fileDetectionTicket` files `code`, which has no agent-reachable close edge, so the first breach of a route would have held that route's dedupe key open forever and the second breach would have filed nothing.
- **Item 7** would have handed an hourly watcher the power to erase a hand-written CONFIRMED justification, because no cron caller passes `evidence` at all.
- **Item 10** put a rate floor at a p10 that measures 0 on every lane it named, on a table that structurally cannot express agent work, and named a fourth floor with no data source behind it.
- **Item 11** proposed executing SQL authored in markdown files that merge without a QA verdict.

None of the four was caught by reading the recommendation. Each was caught by measuring the thing the recommendation assumed, before writing the code: reading the dedupe index's own WHERE clause, listing the `fileBlocker` call sites to see which fields callers actually pass, running the p10 the recommendation asked to seed, and asking which allowlist the tracker files sit in. Three of the four read as correct on the page. The fourth reads as a small chore.

That is worth generalising. This audit was produced by 34 agents, and what that many agents are good at is establishing what is true: 169 findings survived adversarial verification and the four errors here are all downstream of findings that stand. What they are less good at is the last step from a true finding to the right fix, because that step depends on the code the fix would touch rather than on the state the finding measured. Treat the findings in an agent-written audit as findings. Treat the recommendations as hypotheses, and measure before implementing one.
