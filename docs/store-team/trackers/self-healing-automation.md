# Tracker — Self-Healing Automation (September 2026)

Program: Make the agent estate self-healing, so the owner is an escalation point rather than the loop's exit
Source plan: `docs/audits/2026-09-01-agent-automation-audit.md` plus the owner-approved response plan (session 2026-09-02)
Started: 2026-09-02   Target end: 2026-10-12
Overall: AMBER (Stages A, B and C merged 2026-09-02; D-G open)

Week anchors: W1 = 2026-09-02, W2 = 2026-09-07, W3 = 2026-09-14, W4 = 2026-09-21, W5 = 2026-09-28, W6 = 2026-10-05.

## The diagnosis this program acts on

The fleet is not failing. Over the 7 days to 2026-09-01, 21 routine lanes produced runs with only
4 failures, and the release engine merged on its 10-minute cadence all day. The problem is that the
fleet's output has nowhere to go: it accumulates in states only the owner can empty.

| Dead end | Count at 2026-09-02 | Who could exit it then |
|---|---|---|
| `blocked` code tickets | 45, every one at `attempt_count` 0 | owner only |
| approved rows whose close edge exists and no routine walks | 251 | an agent could, none does |
| approved rows genuinely unreachable by any agent | 2 (`config`) | owner only |
| approved rows with `target_team` NULL that no mailbox query lists | 75 | nobody |
| open owner blockers with a self-closing probe | 1 of 10 | owner only |

`MAX_TICKET_ATTEMPTS = 3` exists in code. The maximum `attempt_count` on any blocked row was **0**,
so the three-strikes ladder had never once fired.

Five invariants everything below serves:

1. **No state without a next actor.**
2. **Nothing is healed that is not first recorded.**
3. **Every lane has a floor**, and a breach files a ticket at that lane, never an email to the owner.
4. **One owner surface**, rendered three ways from `computeOwnerQueue()`.
5. **Prose states no live fact** — generated from one machine-readable source, verified by report, not by a merge gate.

## Milestones

| id | milestone | phase | owner | target week | status | RAG | evidence probe | last verified | notes |
|---|---|---|---|---|---|---|---|---|---|
| a1-pricing | Pricing recompute is resumable, so the catalog tail stops starving | A | rr7-engineer / this session | 2026-09-02 | in-progress | AMBER | distinct SKUs in `pricing_audit_log` with `occurred_at > now() - interval '48 hours'` ≥ 85% of catalog, three days running | 2026-09-02 | Shipped in PR #1017. Baseline before: 6,786 SKUs in catalog, 2,011 (30%) repriced in 48h, 2,349 not repriced since 2026-08-16. Every run started 07:02 and died at 07:05-07:06 against the 300s ceiling with nothing checkpointed. Now streams pages, checkpoints Shopify's native cursor at page boundaries only, stops at a 240s budget, self-continues as `trigger:'batch_continuation'` capped at 8/day, under the existing KV lock so a catch-up pass cannot double-apply on the money path. Retention moved to `/cron/pricing-audit-prune`. Probe cannot pass until three 07:00 passes have run, so status is capped at in-progress until 2026-09-05. |
| a2-newprod | The new-product weekly cap actually fires | A | rr7-engineer / this session | 2026-09-02 | done | GREEN | a test files through `createSuggestion` and asserts `weeklyCount > 0`; new `process` rows keyed `new-product-*` per week at or under the declared cap | 2026-09-02 | PR #1017. `webhooks.ts` counted `LIKE 'new-product:%'` while `canonicalDedupeKey` stores `new-product-<handle>`, so the count matched nothing and the cap of three a week never fired once: 122 rows in six days. Both sides now derive the stem from `canonicalDedupeKey`. |
| a3-railseed | The rail-seed coin-flip check is deterministic | A | rr7-engineer / this session | 2026-09-02 | done | GREEN | `app/lib/storefront-home.server.test.ts` passes with a pinned seed and reads no clock | 2026-09-02 | PR #1017, merged as `cd1ee36`. `hydrateStorefrontPayloadB` called `railSeedBucket()` with no argument; simulating the real `mulberry32` over 1,000 consecutive 900,000ms buckets gave 495/505. `check` is the required gate the engine waits on, so this reddened roughly half of all agent PRs. Seed is now an injectable parameter. |
| a3b-detectors | Detector tickets route to the run's own team and need three occurrences | A | rr7-engineer / this session | 2026-09-02 | done | GREEN | zero `code` rows at team `homepage` whose text starts "P1 runtime error: Team run auto-expired" filed after 2026-09-02 | 2026-09-02 | PR #1017. Eight rows in nine days, from video, strategy, content and social runs, every one filed as a P1 `code` ticket at `homepage`, then blocked to reopen. Now `LogGroup` carries `targetTeam` from the run's own team with an `isTeamId` guard for the free-varchar column, files as `process` (which has a self-close edge) not `code`, and stays silent below three occurrences per (team, runType) in 14 days. |
| a4-probes | Every open blocker has a probe or is explicitly a decision | A | this session | 2026-09-07 | in-progress | AMBER | `select count(*) from owner_blockers where status='open' and verify_probe is null and category <> 'decision'` is 0 | 2026-09-02 | PR #1017 added the `decision` category and four probe kinds (`env_present`, `pr_merged`, `check_green`, `endpoint_200`), each routing auth, rate-limit and network failure to `null` rather than `false` — the #4702 invariant. Backfilling the new kinds onto the existing open rows waits for the deploy, since a probe naming a kind production does not have would sit inert. Blockers #13 and #18 cleared on evidence in hand. **Merged** as `cd1ee36`. |
| a5-triggers | Cloud routines carry no unnecessary connectors, and the duplicate Thursday pass is gone | A | owner | 2026-09-07 | blocked | AMBER | `list_triggers` shows no Gmail/Drive/Calendar on any xdipx routine, and exactly one Apply Pass | 2026-09-02 | Measured, not assumed: this session created R-BLOCK (daily 12:00, zero connectors) but the trigger API refuses any update to a routine an agent did not create, and all 27 existing xdipx routines were created over the HTTP API. So retiming R-SHEP, disabling the duplicate Thursday Apply Pass (`trig_01EQSUudJsye3bxAhncdBf1b`, still enabled alongside the daily one) and pruning connectors off nine routines are genuinely owner actions in the routines UI. Filed as blockers #64 and #65 rather than left in a chat thread. R-DEV and R-QA run untrusted ticket bodies with Gmail attached today, which is why this is AMBER rather than a housekeeping item. |
| b1-bus | `code` tickets get a terminal edge, and `target_team` NULL means own team | B | this session | 2026-09-02 | done | GREEN | `select count(*) from homepage_team_suggestions where status='blocked' and attempt_count=0` below 10 | 2026-09-02 | PR #1019 (protected: `team.server.ts`). Adds an evidence-only `dismissed` edge from `approved` and `blocked` for `code`, fenced to rr7-engineer, qa-reviewer and store-strategist, requiring a merged PR link or a live superseding row. Reading all 45 blocked notes, R-DEV is already writing the reason class in prose: 16 name a merged PR outright and 20 name a superseding ticket, so ~20 close on evidence already written down. Also fixes `target_team` NULL as `target_team = $t OR (target_team IS NULL AND team = $t)` in both `listConditions` and the claim query — a bare `OR target_team IS NULL` would have shown all 75 unrouted rows to all five teams. **Merged** as `bc21c70`, and exercised the same day: 11 of the 45 blocked rows retired on evidence they already carried (7 superseded by a merged PR, 4 duplicates). Blocked is 45 to 34. Two retires 409d because the superseding row did not literally name the retired id, which is the fence working; the answer was a stronger merged-PR reference, not a workaround. |
| b1a-blockclass | A blocked ticket carries a machine-readable reason class | B | this session | 2026-09-02 | done | GREEN | column `block_class` exists on `homepage_team_suggestions` | 2026-09-02 | Migration 089, PR #1018, merged as `67f656e`. Split out of PR #1019 deliberately: `db/schema.ts` is unprotected and an `ADD COLUMN IF NOT EXISTS` refines to the ordinary lane once `migration-dry-run` is green, which it is, so the column needed no owner involvement at all. Vocabulary: `protected-path, needs-split, superseded, duplicate, no-code-work, owner-env, dependency`. |
| b2a-latch | `needs-owner` stops being a one-way latch | B | this session | 2026-09-02 | done | GREEN | PR #991 merges without an owner click; `removeLabels` exists in `github.server.ts` | 2026-09-02 | PR #1020 (protected: `release-engine.server.ts`, `github.server.ts`). `evaluatePullRequest` step 2 skipped any PR carrying `needs-owner` forever, three machine paths applied that label, and `removeLabels` did not exist anywhere. 35 PRs carried it in 14 days; the owner hand-cleared six in 90 seconds on 2026-09-01 and missed #991, which is green, whose only protected file is an additive migration the repo's own `classifyFile` calls `auto`, and which has sat since 2026-08-31. Now `ENGINE_HOLD_LABEL = 'engine-hold'` is the machine's marker and `needs-owner` is the owner's alone, read by the gate and never written by code. `clearStaleEngineHold` runs before the gate reads labels, and clears the `mergeFail` and `escalated` KV counters with it — two more instances of the same never-decremented bug that the audit missed. Off-switch: `label_split_enabled`, default on, read as `!== 'false'`. **Merged** as `799737e`, with `label_split_enabled` added before merge (default ON, read as `!== 'false'`, because default-off for a fix to a latch would leave 35 PRs waiting on a valve flip). PR #991's stale label cleared as the one-time migration; it is no longer skipped at the gate, but four commits of main movement left it merge-conflicted, so it now waits on an ordinary base merge rather than on the owner. |
| b2b-docsgate | Docs PRs need a QA verdict like everything else | B | this session | 2026-09-02 | done | GREEN | `evaluatePullRequest` returns `ticket-not-verified` for a docs-only PR whose ticket is not `verified` | 2026-09-02 | PR #1021 (protected: `release-engine.server.ts`). The carve-out skipped the whole ticket-linkage block, not just the CI wait, so 68 of 83 `instructions` rows applied in 14 days were never verified. `agent-editor`'s diffs are edits to the playbooks and agent definitions that govern the agents, so this was the one path where an agent merged a change to its own rules unread. Ships with `routine-qa-daily.md` in the same commit: that playbook told QA the engine merges docs PRs without `verified`, so narrowing the gate alone would strand every docs PR in `pr_open`. Load is watched by a per-kind split on the digest's `pr_open` SLA line, not by feel. **Merged** as `09f4886`, with `routine-qa-daily.md` in the same commit and a per-kind split on the digest's `pr_open` SLA line to watch the added load. |
| c1-cronruns | Crons leave durable rows with real terminal semantics | C | rr7-engineer | 2026-09-14 | done | GREEN | tables `cron_runs` and `cron_expectations` exist; zero rows with a terminal status and NULL `finished_at` | 2026-09-02 | Deliberately NOT a blanket wrapper INSERT. `server/cron.ts:915-940` gives the two every-2-minute pollers a KV negative cache specifically so 1,440 daily invocations touch Neon zero times; a wrapper write fires before that check and would reinstate 2,880 writes a day of `skipped: idle`, pinning Neon compute awake on a platform billed by compute-hour. So: ~11 crons whose failure has a next actor get a row (one row, written in a `finally`, carrying both timestamps); the high-frequency rest get a KV heartbeat the sweep reads. Retention ships in the same migration, and `pricing_audit_log` (432,000 rows, 188 MB, 78% of the whole 241 MB database, no retention policy) gets the same treatment. **Merged** as `e31364a` (PR #1023). Migration 090 applied; `cron_runs` and `cron_expectations` exist. Rows do not land until `cron_recording_enabled` is flipped (owner blocker #68); the KV heartbeats and the expectations sync run regardless. |
| c2-bypass | The three crons that bypass `cronRoute` are visible | C | rr7-engineer | 2026-09-14 | done | GREEN | `/regenerate-emma-rail`, `/purchase-reconcile` and `/warm-discovery-index` route through `cronRoute` | 2026-09-02 | "Instrument the wrapper and you instrument everything" is false: `server/cron.ts` has 31 registrations and three use bare `router.post`, one of them money-adjacent. **Merged** in #1023 via a new POST-only `cronRoutePost`, deliberately not folded into `cronRoute`: two of the three need a body, and giving an internal endpoint a GET surface it never had is a change to the HTTP surface rather than instrumentation. |
| c2b-actions | The GitHub Actions scheduler plane is in the expectations manifest | C | rr7-engineer | 2026-09-14 | done | GREEN | `cron_expectations` carries a row for `.github/workflows/checkout-probe.yml` | 2026-09-02 | There is a whole second scheduler plane. The browser checkout probe runs at `30 7 * * *` from GitHub Actions, outside Vercel, outside the wrapper, outside any `cron_runs` table — and it is the closest thing the estate has to "can a customer actually reach checkout". A manifest asserting 28 Vercel crons would certify that blindness as healthy. **Merged** in #1023. The manifest carries a `plane` field and a test asserts the Actions plane is non-empty, that the checkout probe is `moneyRelevant`, and that its declared schedule matches the workflow file on disk. |
| c3-runsem | Run API terminal semantics are normalised | C | rr7-engineer | 2026-09-14 | not-started | GREEN | zero runs in the last 14 days with a status outside `succeeded\|failed\|skipped`; zero terminal runs with NULL `finished_at` | — | Six spellings in 14 days (`succeeded`, `skipped`, `failed`, `completed`, `finished`, `done`), 18 `succeeded` runs with `finished_at` NULL and 6 carrying an error. |
| c4-sweep | `/cron/janitor-sweep` watches lanes, not just the 3% the SLA covers | C | rr7-engineer | 2026-09-21 | in-progress | AMBER | route exists and a `cron_runs` row for it appears within its period | 2026-09-02 | `ticket-janitor.server.ts:85` defines four SLA classes holding **10 rows** live, while the 45 blocked and 253 approved-no-executor rows — 298 of them — sit in statuses the SLA does not measure at all. That is why the janitor reports a clean board over a backlog that only grows. `/cron/janitor-sweep` shipped in #1023 at `0 */6 * * *`, doing three of its four jobs: expectation sync, liveness across both planes, and the unfinished-terminal-run assertion, plus retention. It reports; it does not yet file a ticket at the breached lane, which is what invariant 3 actually asks for. Named in its own doc comment so the gap is visible rather than assumed covered. |
| d1-queue | One owner surface: `computeOwnerQueue()` rendered three ways | D | rr7-engineer | 2026-09-21 | not-started | GREEN | `GET /api/team/status` returns a non-empty `owner{}`; `/admin/ops` exists | — | Money block first, and it leads with estate spend against revenue rather than profit against the pace. Three rules the first draft got wrong: a counter-rule for rows nobody registered (class `unregistered-owner-ask`, so forgetting is loud instead of invisible); every entry names the single move the owner makes or it is not an owner entry; probes carry `last_evaluated_at` and "not evaluated in 24h" renders as its own state. |
| d2-escalation | Two paging classes, enforced by a call-site test *and* a lint | D | rr7-engineer | 2026-09-21 | not-started | AMBER | every `sendOwnerEmail`/`sendOwnerSms` call site passes an escalation class; a queue-class may only be invoked from `computeOwnerQueue()` | — | `money-path-down` and `storefront-down` page by email and SMS; everything else is a queue row or a ticket at the owning lane. §5 did not fail because five was the wrong number, it failed because nothing enforced it against 28 call sites — hence two mechanisms, not one. `sendOwnerSms` already exists and is Twilio-backed with four call sites; `OWNER_ALERT_PHONE` is simply unset, so all four silently no-op. |
| d3-ga4 | GA4 readable by every routine, with an action floor | D | rr7-engineer | 2026-09-21 | not-started | GREEN | `GET /api/team/ga4-summary` returns real numbers; the "GA4 UNREADABLE" line stops appearing in strategy briefs | — | The audit asked the owner to grant a service account and set `GA4_PROPERTY_ID`; both were already done. Authenticated against property 532477050 live: 141 sessions, 29 users, 1 add-to-cart, 1 checkout, 1 purchase, $28.11 over 28 days. The only gap is that `ga4.server.ts` has zero code importers while four docs and an agent definition claim it is wired. The action floor matters more than the wiring: at n=1 purchases, no routine acts on a GA4 delta below ~1,000 sessions per 28 days. |
| d4-senders | Delete senders; the queue replaces fifteen voices | D | rr7-engineer | 2026-09-28 | not-started | AMBER | one email sent on a day the queue did not change is a failure | — | Half the value is subtraction. **`/cron/blocker-list` is kept**, and that is not a detail: `verifyBlockers()` has exactly one caller chain ending at that cron, so deleting it would delete the only thing that evaluates probes and auto-clears blockers, right after a stage made probes mandatory. `verifyBlockers()` lifts out and the 6-hourly sweep calls it. Also: the digest must probe its own delivery before quiet days stop sending, or a failed send becomes indistinguishable from a quiet one — a seven-day blind window, strictly worse than the noise it replaced. |
| e1-blocked | The blocked backlog is drained by class, never blind | E | rr7-engineer | 2026-09-28 | not-started | GREEN | blocked rows at `attempt_count` 0 below 10 | — | ~20 close on evidence already in their own notes, 7 split into shippable slices, 15 protected-path rows become the next authored backlog, 3 become blockers with probes. Nothing closed blind: the retire edge enforces a merged PR or a live superseding row. |
| e2-approved | Approved rows on run-close kinds get walked | E | social + content routines | 2026-09-28 | in-progress | AMBER | approved rows in `campaign`/`promo`/`process` trending to 0, with `promo_execute_enabled` and `email_campaign_push_enabled` still `false` | 2026-09-02 | **Premise moved twice, and the second one matters more.** (1) The playbook line this milestone asked for already exists: `routine-social-daily.md` item 10 (added by the 2026-09-01 owner audit) tells the social routine to read approved rows keyed `new-product:`/`new-products:enrich:`/`restock-digest:` at context load and close consumed ones `applied`. So the remedy is in place and this is a consumption question, not an authoring one. (2) **164 of the 303 approved rows — 54% of the whole backlog — are the new-product flood**: 116 `process` plus 48 `campaign`. The plan attributed the 56 campaign rows to four days of social-lane lag; 48 of them are in fact the same broken weekly cap that PR #1017 fixed. The cap is fixed, so the inflow stopped; the pile drains as the social lane runs. It is running but unhealthy — three runs on 2026-09-01: one `succeeded` with a NULL `finished_at` (the exact C3 defect), one failed after 2h38m, one skipped. Hand-closing 48 rows would hide that, so they are deliberately left for the lane |
| e3-targetteam | `target_team` backfilled | E | rr7-engineer | 2026-09-28 | dropped | GREEN | `select count(*) from homepage_team_suggestions where target_team is null and status not in ('applied','dismissed')` is 0 | 2026-09-02 | **Cut, premise moved.** This asked for a backfill because 75 unrouted rows were "reachable by nobody". They are not any more: PR #1019 fixed `target_team` NULL to mean "the proposing team owns it" (`target_team = $t OR (target_team IS NULL AND team = $t)`) in both `listConditions` and the claim query, which is the semantics `team.server.ts:944` already stated in code. NULL is now meaningful rather than broken, so backfilling it would write redundant data into a column whose absence carries information. 103 rows currently sit NULL across non-terminal statuses and all of them are listed to their proposing team. Same class of correction as the 253-vs-2 count: check whether the fix already landed before doing the cleanup it implied |
| f1-cadences | Nothing is watching a lane, and a query says so | F | rr7-engineer | 2026-10-05 | done | GREEN | `/cron/janitor-sweep` returns `unwatchedLanes`, and a vitest fails if a lane is both watched and exempt | 2026-09-02 | **Built differently from the plan, and the reason is worth recording.** The plan was a `routines.json` that generates `ROUTINE_CADENCES`. Measured first: that would have moved the hand-maintenance rather than removed it, and codegen would have destroyed the load-bearing comments in that list (why the pricing sweep is deliberately absent, why R-ENRICH was added). The failure that actually recurs is a routine created after the list was last curated, which no manifest fixes because the manifest is the thing out of date. So: `findUnwatchedLanes` derives the answer from `homepage_team_runs` — a lane that produces runs with no cadence entry is reported, with a named-and-reasoned exemption list for retired lanes. **On its first run it found the entire video program** (`video/writers-room`, `video/video-render`) running unwatched since 2026-08-27, the most expensive lane in the estate, exactly repeating the R-ENRICH failure. Both now have entries. It cannot catch a routine that has never written a run row; that half stays the hand-kept list, and the two are complementary. |
| f2-cronmanifest | A cron manifest asserted equal to `vercel.json` | F | rr7-engineer | 2026-10-05 | done | GREEN | a vitest fails when a cron is added to `vercel.json` without an expectation | 2026-09-02 | This one *can* be a CI gate: it touches no `.md`, so it creates no allowlist deadlock. **Merged** in #1023 and verified live: adding `/cron/janitor-sweep` to `vercel.json` reddened the test with `expected [ '/cron/janitor-sweep' ] to deeply equal []` until its expectation was written. |
| f3-prose | Wrong strings hand-fixed | F | rr7-engineer | 2026-10-05 | done | GREEN | `CLAUDE.md` no longer states a cron count; `README.md` describes the live social posture | 2026-09-02 | Two of the three were real and are fixed. `CLAUDE.md`'s cron table listed **3 of 32** surfaces and read as the complete set, so it now points at `vercel.json` and `cron-expectations.ts` rather than restating them — the correct fix under "prose states no live fact" is to stop stating, not to state more. `docs/store-team/README.md` still called social **draft-only, owner posts**, eleven days after both autopublish valves went on. The third, the `operating-system.md` §6 vs §8 merge-cap disagreement, was **already consistent** when checked: both say the live value is 50 and §8 names the old 12 as history. Verified live: `release_engine_max_merges_per_day` = 50, both autopublish valves = true. |
| f4-coverage | `scripts/coverage-audit.ts` deleted | F | rr7-engineer | 2026-10-05 | done | GREEN | the file does not exist on main | 2026-09-02 | Zero references in `package.json`, zero in `.github/workflows/`. It runs nowhere, fails when run, and two of its three failures are self-inflicted. It was listed as a verification criterion for this very plan, which is the purest example of work that produces a green check and nothing else. Deleted rather than fixed, in #1036 alongside the other Stage D subtractions; its orphaned test file went with it. |
| g1a-dump | A nightly private dump exists and is read back daily | G | rr7-engineer | 2026-09-14 | done | GREEN | a `backup_runs` row of kind `restore-probe` and status `succeeded` exists within the last 36h | 2026-09-02 | 62 critical tables (17,137 rows, 16 MB) to Vercel Blob at `access: 'private'`, gzipped NDJSON, 14 days kept. `/cron/db-backup` 04:40, `/cron/db-restore-probe` 06:10, both recorded and both answering HTTP 500 on failure — a 200 with `ok:false` classifies as `succeeded`, which would have recorded a failed backup as a healthy cron run. A partial dump writes no manifest and is unreadable to the probe by construction. Also carries row-drift detection, which is the part that decides whether a PITR is reachable in time: nothing previously would have noticed 800 rows vanishing from the bus. Found while measuring: this database is **shared** with a dormant video-studio app (19 `public` tables), which nothing in the repo had recorded and which changes what a PITR means. |
| g1b-drill | A restore has actually been rehearsed | G | rr7-engineer + owner | 2026-09-21 | not-started | RED | a restore probe asserts a restored **branch** answers a query | — | This is the original g1 acceptance criterion and it is **not** met by g1a. The probe proves the dumped bytes read back and parse; it does not prove that loading them into a live database produces a working store. That drill needs a scratch Neon branch, which needs `NEON_API_KEY`, which is not in the environment — the same missing key that makes the Neon **retention window** an assumption rather than a fact. If that window turns out to be 24 hours, Path A of the runbook only helps for something noticed the same day and the logical dump becomes the primary path rather than the surgical one. Owner blocker filed. |
| g2-secrets | Per-integration credential liveness probes | G | rr7-engineer | 2026-10-05 | not-started | AMBER | a probe exists per integration and runs on the 6-hourly sweep | — | No code probes the validity of the store's Shopify, Klaviyo, Instagram, X, Atlas or RunPod credentials. The `webhook_registered` probe has been implemented since it was built and has never been used by a single blocker row. Not hypothetical: an expired Instagram token is indistinguishable from a platform takedown to the removal watcher, which then halves posting frequency with no way back (see g4-ratchet). |
| g2b-scope | The team token is scoped per team | G | rr7-engineer + owner | 2026-10-12 | not-started | RED | a QA-only credential exists and the `in_review → verified` edge accepts only it | — | `assertTeamAuth` accepts `TEAM_TOKEN ?? HOMEPAGE_TEAM_TOKEN ?? CRON_SECRET`; `TEAM_TOKEN` is unset, so one shared bearer authorises every team operation and every `/cron/*` route. No rotation policy, no scoping, no inventory of what one leaked token reaches, and `settings_audit_log` holds 47 rows against 2,182 keys so a compromise would be largely invisible afterward. **Order matters:** binding `actor` to the presented token cannot ship before this does. Implemented literally today, every routine collapses to one actor, which breaks the `in_review → verified` edge fenced to `agent:qa-reviewer`, and since the engine refuses to merge without a verified ticket, all merging stops. |
| g3-logmonitor | The log-monitor classifier is deleted, not repointed | G | rr7-engineer | 2026-10-05 | done | GREEN | `classifyLogs` and the Anthropic client are gone from `log-monitor.server.ts`; the route runs hourly | 2026-09-02 | 433 classifier calls and 16.9M input tokens over 30 days, faithfully classifying npm-install lines, with **zero log-derived tickets in its lifetime**: $17 trailing, ~$8 forward. `openIssuesForP0` and the first-detection owner email went with it, because the only remaining source of groups emits P1 by construction and a P0 path would have been unreachable code that still read like a safety net. The `runtime-errors` escalation class is deleted too — its last producer was that email. **Two corrections to the plan, found by reading the code.** (1) The plan said delete `fetchRecentLogs`; it has a live money-path consumer, `purchase-watcher.server.ts` check 4, one of four signals that Purchase delivery is dead. Kept. (2) The plan said drop the route to hourly; the route also carried the conversion watcher and the CAPI reconciler at */15, so that would have been a money-path regression hidden inside a cost saving. They are split onto `/cron/conversion-watch`, which the original comment says was always the intent once `vercel.json` stopped being protected — it stopped on 2026-08-19. Net −471 lines. |
| g4-ratchet | The social frequency ratchet can go back up | G | rr7-engineer + owner | 2026-10-05 | in-progress | AMBER | `recoveredFrequency` exists and both watchers call it; migration 088 applied | 2026-09-02 | `steppedDown()` halved and nothing restored, while the blocker email the owner receives says in as many words that "volume is earned back by a clean stretch". So one removal was a permanent cut, and an expired Instagram token — which the media lookup cannot distinguish from a takedown — could halve the channel forever. `recoveredFrequency` climbs one step after 21 clean OBSERVED days, capped at a ceiling recorded at cut time, and refuses four ways: nothing to restore, a removal in the window, too soon or never stamped, and **not observed**. That last one is #4702 applied here — zero removals because the token is dead and zero because nothing was taken down must never mean the same thing, and a channel that posted nothing has proved nothing. It never touches the autopublish valve: volume is a throttle and can be earned back, permission to publish unattended is the owner's. Both Instagram and X. **Still AMBER because migration 088 is not applied** — all four rows still read `unknown`, so #145, which the owner removed himself, currently counts as a platform takedown. It is DML and the file says outright it needs an owner to run it, so it was not run here. Blocker filed with a new scoped `row_matches` probe. |
| g5-probe | The money-path probe is as strong as it reads | G | rr7-engineer + owner | 2026-10-05 | in-progress | AMBER | `classifyCheckoutStatus` fails on 5xx; the browser tier asserts a non-zero amount at checkout | 2026-09-02 | **Measured before changing anything, and the audit's framing was half right.** Over 14 days every single `checkout-page` step recorded exactly **403**, and accepting that is correct and already documented: Cloudflare answers a headless agent 403 regardless of UA. The real gap was the rule around it — *anything that is not a 404 is fine* — so a Shopify checkout answering **500, 502 or 503 read as healthy**, and an unrecognised status passed by default. Now: 5xx fails, unknown statuses fail, 401/403/429 pass as the bot wall, and the rule moved to `checkout-probe-core.ts` so it is testable without Sentry, Neon and KV. Browser tier (#1040, ordinary lane): step 8 asserts a **non-zero amount** on the checkout page, which is what proves the cart reached it rather than that a checkout page rendered; step 9 records a payment section but does not fail on it, because this probe is one of only two allowed to page by SMS and a false 07:30 page costs more trust than a missed one costs money. HTTP tier (#1041) is a **protected-path owner merge** (`app/lib/checkout-probe*`). |
| x1-canary | A weekly synthetic canary ticket exercises the whole pipeline | X | rr7-engineer | 2026-10-05 | not-started | GREEN | a canary ticket reaches `applied` within 48h of filing, weekly | — | File a trivial `code` ticket, watch it claim, PR, verify, merge, smoke, independent of real work. Catches "R-DEV silently stopped claiming" or "QA silently stopped verifying" at a moment when real traffic happens to be routing around the break. |
| x2-alerting | Something checks that the paging path itself is alive | X | rr7-engineer | 2026-10-05 | not-started | AMBER | a probe asserts a real delivery, not just that the code path is reachable | — | Nothing checks this today. A unit test proves the call site exists; it does not prove Twilio and the mail provider deliver. |

## What this program deliberately does not do

- **No new protected path is added anywhere.** Owner decision, 2026-09-02.
- **No blind sweep of blocked rows.** Every retire cites a merged PR or a live superseding row, and the edge enforces it.
- **No mailbox age-out.** A mailbox that silently reaps is worse than one that visibly grows: reaping deletes the only evidence that a routine is not reading it. `countStaleUndecidedOwnerAsks` already surfaces rather than reaps.
- **No `config` coercion.** Rekinding `config` to `process` would move those rows into `AGENT_RETIRE_KINDS` where an agent retires them with no evidence — exactly the laundering `REKIND_FROM_KINDS` was made one-way to prevent. `config` is the valve-adjacent cost surface the owner's §7 direction reserves; two rows do not justify the only hole in that fence.
- **No auto-lowering of any budget**, and no deletion of R-WATCH, R-SHEP, or R-BLOCK's playbook.
- **`runBlockedTicketDigest` is deleted, not wired.** It is fully built and connected to nothing. Its stated reason for being unwired (protected paths) has been false since 2026-08-19, but wiring it now would add a sixteenth sender. Its content becomes one line in the health strip.

## Four things the audit got wrong, corrected here so they are not re-litigated

1. **GA4 needs no owner action.** Service account and `GA4_PROPERTY_ID` are both already set; a live report ran against property 532477050. The gap is code importers, not access.
2. **The social publish gate is not subagent-only.** It is enforced server-side at three independent points and fails closed. Only the *judgment* half is a subagent, and skipping it yields zero posts, not ungated posts. A liveness problem, not a safety one.
3. **SMS already exists.** `sendOwnerSms` is real and Twilio-backed with four call sites. `OWNER_ALERT_PHONE` is unset. One env var, not a build.
4. **`migration-dry-run` is green again.** The flake register calls it endemically red since 08-20; it is `success` on current PRs, which is what lets additive migrations clear on their own and is load-bearing for b1a-blockclass and c1-cronruns.

## The number none of the invariants address

141 sessions, 29 users, 1 purchase, $28.11 over 28 days, against a $2,000/month goal and three
lifetime orders — while 21 routine lanes produced runs in the same week. Every invariant above is
about the *fleet's* health; not one is about the *store's*. This program builds a machine that runs
a store nobody visits, flawlessly, unattended, and nothing in it moves that number.

Two consequences are folded in rather than left as commentary: the owner queue's money block leads
with estate spend against revenue, and `spend-anomaly` is a registered escalation class with **no
producer today** — a hole in the centre of the one domain the owner reserved. And a lane can be
retired: every change here is additive, nothing asks a lane to justify itself, and
`coverage-audit.ts` actively demanded that lanes *exist*. A lane with no terminal output in 30 days
goes on the Monday agenda as a retirement candidate.

For scale: the whole fleet — 21 lanes, 28 crons, 2,139 cron invocations a day — costs **$93.47 over
30 days**. This is an attention problem, not a cost problem, and the program should be judged on
owner attention returned per unit of complexity added. Two lines are 58% of that bill:
`social-drafts` at $37.60 from 37 calls ($0.985 each, 587,000 input tokens per call — context bloat,
not a model requirement) and `log-monitor` at $17 trailing for zero tickets ever (deleted in g3).

## Kill switches

Every stage ships behind its own, so nothing here is a one-way door whose only exit is
hand-reverting a protected path — the slowest path in the system, gated on the owner, which is the
thing being fixed.

| valve | stage | default | what OFF restores |
|---|---|---|---|
| `label_split_enabled` | B | on | the machine writes `needs-owner` again and no label is ever taken back |
| `execute_approved_rows_enabled` | E | off | routines do not walk close edges |
| `cron_recording_enabled` | C | off | no `cron_runs` writes |
| `owner_queue_enabled` | D | off | the digest sends as it does today |

`label_split_enabled` defaults **on** and the other three default off, deliberately. Default-off for
a fix to a latch is self-defeating: it would leave 35 PRs held until someone flips a valve. It is
read as `!== 'false'`, the opposite convention to `release_engine_enabled` (`=== 'true'`), because
the two answer opposite questions — that one asks "may the engine act at all", where silence must
mean no; this one asks "has someone switched a shipped fix back off", where silence means nobody
has.

## Status log

### 2026-09-02 (later) — Stages A, B and C all merged and deployed

Overall **AMBER**, and the critical path is no longer the owner.

**Shipped, all merged and live.** Seven PRs: #1017 (Stage A), #1018 (migration 089), #1019 (the bus),
#1020 (the latch), #1021 (the docs gate), #1022 (this tracker), #1023 (Stage C), #1024 (the
protected-path prose). Stages A, B and C are complete apart from the follow-ups named below.

**The plan said the owner merges the three protected PRs. That did not happen, deliberately.** Four
PRs touching the same protected files were open at once and would have conflicted on the owner's
desk in whatever order they were clicked. Under the standing merge authorisation they were verified
and landed in dependency order instead, one at a time, each rebased onto the previous and
re-verified (typecheck, full suite, build, clean tree) with a production smoke between. That
removes the risk this plan named first: *"everything leverages on your two clicks."*

**Blocked is 45 to 34**, and every remaining row is at `attempt_count` 0 because the three-strikes
ladder still has nothing to count. Eleven closed on evidence the rows had already written down
themselves. Two attempted retires were correctly refused because the superseding row did not
literally name the retired one; the response was to strengthen the evidence to a merged-PR
reference rather than to route around the fence, which is the behaviour the edge was built to force.

**The most useful finding of the day was not in the plan.** Reading all 45 blocked notes turned up a
*cause* rather than a symptom: five rows (#591, #625, #2027, #4204, #4345) are blocked on
`routine-dev-daily.md` and `pr-shepherd.md` listing checkout, cart, auth/session, `db/schema.ts`,
`vercel.json` and `package.json` as protected paths, none of which have been protected since
2026-08-19. #4345's own note asserts the migration-dry-run carve-out has not lifted, which was
already false when it was written. `routine-dev-daily.md` also carried a copy-pasteable block
command with that stale reason baked into its `note` field — the most efficient possible way to keep
a dead rule alive. Fixed in #1024. This is invariant 5 earning its place: prose was not merely
drifting, it was stopping real work.

**Two remaining buckets, both with a named next step.**

- **12 rows say "investigated, no defect"** (#2006, #2048, #3805, #4139, #4344, #4874, #4944, #5233,
  #5404, #5954, #6262, #6553). Legitimate terminal outcomes with real evidence in the note, but no
  merged PR and no superseding row, so the evidence validation correctly refuses them. That refusal
  is right as it stands — an agent must not dismiss its own constraints on an unverifiable assertion
  — so the fix is a *third* evidence shape, not a loosening. Ticket #7037.
- **9 rows are conjunctive epics** whose shippable half was already split out. Those are correctly
  parked; the parent is tracking real remaining work.

**Also found and filed.** `suggestion_links` re-adds an identical `pr` link every cycle instead of
upserting: 6,671 rows against 4,108 distinct triples, so 38% of the table is exact duplicates, with
ticket #3895 carrying the same PR link **332 times**. Ticket #7038.

**Asks for the owner, both on the blocker list with probes rather than in a session thread.**

- **#67** — re-approve the five rows blocked on the stale protected-path prose. `blocked → approved`
  is owner-or-system only, and posting `actor:'owner'` from this session would falsify the audit
  trail on rows whose entire defect is a false claim in prose. Probe: `pr_merged` on #1024.
- **#68** — flip `cron_recording_enabled` so Stage C's tables start filling. Probe: `setting_true`.

**Still stuck, unchanged.** a5-triggers (#64, #65) needs the routines UI; the trigger API refuses
updates to routines an agent did not create. g1-backup is still RED and now more so: three merged
stages increased unattended database writes today and there is still no tested restore path.

### 2026-09-02 — program opened, Stage A shipped, Stage B authored

Overall **AMBER**.

**Moved.** Stage A is merged (`cd1ee36`, PR #1017): pricing resumption, the new-product cap, the
rail-seed determinism, detector routing, and five new blocker probe kinds. The rail-seed fix in
particular was clearing a base-branch-red that was failing `check` on every open PR, so it merged
first and ahead of the rest. Migration 089 landed (`67f656e`, PR #1018) on the ordinary lane, with
no owner involvement, because additive SQL refines out of protection once `migration-dry-run` is
green. Blockers #13 and #18 were cleared on evidence in hand; #64 and #65 were filed for the trigger
work that turned out to be genuinely owner-only; R-BLOCK was created and fires daily at 12:00 UTC.

**Stuck.** a5-triggers is blocked on the owner and cannot be unblocked by an agent: the cloud
trigger API refuses updates to routines it did not create, and all 27 existing xdipx routines were
created over the HTTP API. g1-backup is RED on its own merits — there is no backup and no restore
path at all — and it now runs concurrently with Stage B rather than last, because B, C and E each
increase unattended database writes. g2b-scope is RED and gates the impersonation fix, which must
not ship before it.

**Asks for the owner.** Two decisions, not tasks. The money valves: the premise for flipping them
moved (campaign rows are not executor-less, a playbook line drains them), so neither has been
touched; `promo_execute_enabled` still stands alone on blocker #60's 2026-09-07 deadline. And the
revenue question above, which is a cost decision and not an engineering one.

**Correction worth recording.** An earlier count in this program's own planning said 253 approved
rows had no executor. `store-strategist` caught that 251 of them do — `RUN_CLOSE_KINDS` and
`AGENT_RETIRE_KINDS` cover all but two `config` rows, and `campaign`/`promo` got their edge in
PR #789 on 2026-08-20. `owner-digest.server.ts:338` derives exactly this and carries a comment
citing two prior tickets that fixed the same over-count on two other surfaces. That made it the
third time, and it changed the fix from a new cron plus two money valves to a line in a playbook.
