# Agent Fleet Evaluation, 2026-07-29

Full evaluation of the xdipx automation system: 45 agent definitions, 19 manifest routines (16 live triggers),
23 Vercel crons, the improvement loop, and the linkage between all of them. Method: 8 parallel domain audits
against live production data (Neon, GitHub, the cloud scheduler, Shopify, repo docs), followed by adversarial
verification of every P0/P1 finding. 21 findings confirmed, 4 refuted, 30 lower-severity. All evidence cited
is from prod as of 2026-07-29 afternoon PT.

Note on timing: `release_engine_enabled` was flipped back ON by the owner mid-audit (2026-07-29 ~15:40 PT).
Findings below reflect that.

---

## Correction, 2026-07-29 (post-publication)

Two findings below inherited a false premise, caught during fix-planning review.

**There was no "March 26-31 launch."** The six `daily_profit_summary` rows behind 311 orders and
$13,236.89 carry `featured_sku` `SEED-001..006` and were written by `db/seed.ts`. They were 100% of
the lifetime totals on the admin dashboard. No launch, no traffic source, no buyer cohort — so the
"name the March traffic source" owner action is withdrawn, and suggestions #63 (win-back), #105
(referral hook), and #106 (anniversary emails) are void rather than pending. The rows are deleted by
`scripts/backfill-profit-summary.ts` (PR #393). The `review_aggregates` "28 reviews" figure is
seeded the same way; the real `reviews` table holds one row. This is also why the report's own
recommendation to reason from `daily_profit_summary` history needs a caveat: rows before 2026-07-30
came from the broken summariser and are not a baseline.

**`release_engine_enabled` was re-enabled by the owner mid-audit** (2026-07-29 ~15:40 PT), so
findings describing the engine as off are history, not current state. The verified-ticket dead end
they describe was real, and is fixed in PR #391.

## Verdict

**The plumbing is real and mostly works. The business does not run itself yet, for two reasons that are not
plumbing:** the profit metric the whole fleet optimizes against is blind to real orders, and acquisition has
no owner. Everything else is wiring debt, and almost all of it is agent-fixable.

Direct answers to the five questions asked:

1. **Are the cloud routines in sync?** Substantially yes. All 16 live triggers fire on schedule and match the
   manifest crons. The failures are at the edges: two lanes were half-enabled on 07-28 (valves ON, triggers
   never created), the silent-stop watchdog is hardcoded to routines 1-14 so it cannot see the newer lanes,
   and the manifest is stale in five places.
2. **Where is linkage weak?** The core spine is healthy (strategy brief -> all teams, seoContentBrief ->
   content-writer, dual content gates, program-manager, merch-calendar, cost-review all close their loops).
   The rot is at the graph's edges: the entire research tier is dead (no producers), the design-critic gate is
   blind in cloud runs, kind=process suggestions have no consumer, and the social lane starved on owner review.
3. **Do you need additional agents?** Mostly no. The top problems are wiring, not headcount. Two small
   additions are justified (order-ops watcher, support-email stopgap); one charter change matters more than
   any new agent (someone must own acquisition).
4. **Is the improvement loop working?** Partially, and provably. The instructions lane demonstrably closes:
   9 suggestions became PRs #283-287 and #332-336, all merged, rows flipped to applied, agent behavior changed.
   But drain (max 5/week) is below inflow (15-20/week) so the backlog diverges, the non-PR kinds (52 process,
   9 strategy, 4 program, 2 promo approved) have never closed once, and nothing measures whether an applied
   suggestion helped.
5. **Does it run itself, escalating only when stuck?** Not yet. Owner load was ~5-6 hrs/week, dominated by
   hand-merging 74 PRs after the release engine tripped its breaker on a spurious probe failure. With the
   engine back on and the fixes below, the realistic floor is under 1 hr/week without weakening any money or
   safety gate.

---

## Scoreboard

| Area | State |
|---|---|
| Cloud scheduler (16 triggers) | HEALTHY, all firing on schedule, crons match manifest |
| Homepage team (Routine A/B) | HEALTHY, 18 succeeded/14d; design gate blind (below) |
| Content team + dual gates | HEALTHY, 18 posts/14d, gates demonstrably block |
| Strategy loop (brief, retro, sub-steps) | HEALTHY, brief #3 published 07-27, consumed by all teams |
| Apply pass (agent-editor) | WORKING but under-capacity (5/wk vs 15-20/wk inflow) |
| Release engine + ticket bus | BUILT AND REAL, one live cycle, breaker-tripped 07-28, re-enabled 07-29 |
| R-DEV / R-QA (night train) | WORKING, young (live since 07-28), 3 PRs, 2 verified |
| Vercel cron plane (23 crons) | 15 verified firing, 2 designed-off, 4 unverifiable, 2 broken |
| Improvement loop, instructions lane | CLOSES, evidence: 9 applied rows with merged PRs |
| Improvement loop, all other kinds | NEVER CLOSES, 67 approved rows, zero completions ever |
| Research tier (trend/social-trend/business) | DEAD, no triggers exist |
| Social pipeline | SELF-THROTTLED to zero for 10 runs (18 drafts unreviewed since 07-14) |
| Ads / email teams | PARKED on a blocker resolved 07-26 (stale park) |
| Profit measurement | BLIND, real paid order recorded as $0 |
| Acquisition | NO OWNER, every channel off or dead-ended |

---

## P0: fix before anything else

### 1. Profit measurement is blind to real orders
The fleet optimizes a metric that reads $0. Shopify order #1002 (2026-07-23, $29.18, PAID, FULFILLED) appears
in `daily_profit_summary` as `total_orders=0, total_revenue=0`; every July row is zeros and the lifetime
totals are March seed data. `app/lib/profit.server.ts` is still written for the retired daily-deal model:
it queries Shopify with `status=paid` (invalid value for the REST `status` param, so paid orders are
excluded), computes COGS from the day's deal `wholesaleCost` for every line item regardless of product, and
the 00:05 UTC cron window compounds the mismatch. `store-strategist.md:35` names this table as the fleet's
primary outcome source, so every weekly retro since launch has been reasoning from a false $0.
**Fix (agent-taskable, kind=code ticket):** rewrite `writeProfitSummary` for the storefront model
(`financial_status=paid&status=any`, per-SKU `wholesale_cost` metafield COGS, fix the date window, drop the
daily-deal coupling as primary), and add a reconciliation line to the owner digest: Shopify paid-order count
vs summary count, alert on mismatch. This is prerequisite to every other $2k/month decision.

### 2. Acquisition has no owner
Only 2 orders ever, both placed by you. GSC: 49/4768 indexed, crawl ~50/wk. Ads and email teams are valved
off (their stated blocker, unvalidated checkout, was resolved 07-26). All 18 social posts ever drafted are
still drafts. `store-strategist.md:29` explicitly discounts GA4 below 300 sessions/wk, so the one agent
reading analytics is designed to look away at current traffic. No agent charter says "get more visitors."
Every merchandising agent is optimizing an empty room.
**Fix (mostly owner decisions, ~1 sitting):** ~~answer the strategy brief's March 26-31 traffic-source question~~
(RETRACTED: dev seed data, see the correction at the top; the win-back and ads-reframe suggestions built on it are void), flip `ads_team_enabled` and `email_team_enabled`
(both are propose/plan-only, $0 spend exposure, launching stays manual), review the 18 social drafts once,
then have agent-editor add an acquisition section with channel-level weekly targets to the strategy brief so
channel inaction is reported as a blocker instead of skipped.

---

## P1: the loop leaks

### 3. Verified tickets can never close when the owner merges by hand
Transition rules (`app/lib/team.server.ts:795-801`): only actor `system` (the release engine) can move
`verified -> applied`. Tickets #43 and #70 shipped to prod 07-29 (owner-merged PRs #367/#366, QA-verified
same day) and are stranded at `verified` forever; zero code tickets have ever reached `applied`.
**Fix (code ticket):** engine cycle detects a verified ticket whose linked PR is already merged and
transitions it to `applied` with evidence "merged out-of-band by owner". Works retroactively for #43/#70 now
that the engine is back on.

### 4. Apply-pass capacity is structurally below inflow
Max 5 PRs per weekly run vs 15-20 actionable suggestions/week. Backlog: 18 (07-21) -> 38 (07-27) -> 39 today,
median age 7 days. The owner merged all 5 of run 103's PRs within 100 minutes, so merge review is not the
constraint. ~5-6 of the queued rows can never drain at any cap (config rows agent-editor classifies
"not-mine", one refused row still sitting `approved` since 07-12).
**Fix:** raise the per-run cap or add a second weekly apply slot (Thursday), and make agent-editor re-kind or
dismiss rows it refuses instead of leaving them approved-forever. One playbook edit + trigger prompt reissue.

### 5. Non-PR suggestion kinds are a black hole
67 approved rows (52 process, 9 strategy, 4 program, 2 promo), zero completions ever. improvement-loop.md
routes process to "owner acts directly", but auto-approve now skips your triage click, and the daily digest
surfaces only the single oldest approved row, so ~50 rows are shadowed. Includes live merchandising defects:
inventory-sentinel's OOS-carousel findings #52-54, filed 07-20, unexecuted 9 days (the daily merchandise
playbook only FILES suggestions, it has no step that READS inbound approved rows).
**Fix (three parts, agent-taskable):** (a) add a "read your inbound approved suggestions" step to each daily
routine; (b) weekly reclassification pass that re-kinds playbook-shaped process rows to instructions
(drainable) or code (ticketable) and supersedes duplicates; (c) digest shows the full owner-decision queue
with age flags, not one row. Then triage the existing 52 once; most are stale run-observations.

### 6. Auto-approve is ON for all five teams while every governance doc says homepage-only
Four valves flipped ON 2026-07-18 00:38-00:39 UTC, no migration, no actor trail (pipeline_settings has no
actor column). improvement-loop.md, operating-system.md, and CLAUDE.md (all re-committed 07-27) still assert
homepage-only. 108 rows now carry `decided_by='auto'`. Live consequence now that the release engine is on:
an agent-filed instructions suggestion from ANY team can reach merged behavior change with no human look,
which the docs claim is true only for homepage.
**Fix (owner decision first):** confirm the 07-17 flips were yours, then either revert the four valves or
update the three docs to the real posture. Agent-taskable: a `settings_audit_log` for pipeline_settings
writes so valve flips are attributable.

---

## P1: half-enabled and silently dead lanes

### 7. Trend-scout and social-trend-scout: valves ON since 07-28, triggers never created
Enablement stopped at step 3 of 5 in both runbooks: no supervised manual run, no cloud trigger, no trig_ id
recorded. Zero trend runs exist. Lanes go silently dead starting Sat 08-01 16:00 UTC and Mon 08-03 17:00 UTC,
and Sunday SEO curation will keep reviewing zero trendTopicBriefs. Consumers starving: seo-curator trend
review, video-producer, LinkedIn lane.
**Also:** migration 068 was never applied in prod (`content_team_daily_cents` still 300, not the 500 the
Saturday design requires; the manifest asserts 500). Apply 068 before creating the Saturday trigger.
**Fix (owner, scheduler-side):** run `npx tsx scripts/apply-migrations.ts --from 068`, then create both
triggers per the playbooks and record trig_ ids in routine-schedule.md, or flip both valves back OFF so state
stops lying. Business Research (routine 17) needs the same trigger-creation decision (no valve gates it).

### 8. The silent-stop watchdog cannot see anything newer than routine 14
Weekly Strategy's coverage check is hardcoded "routines 2-14" in both the playbook and the trigger prompt
(second drift of this prompt). It ran correctly 07-27, but routines 15-19 and social-trend-scout are outside
its scope, which is exactly how the trend-scout gap stays invisible.
**Fix (agent-taskable + one trigger reissue):** scope becomes "every routine in routine-schedule.md whose
trigger exists or whose gating valve is on; valve-on-with-no-run-row is a mandatory finding". Never enumerate
routine numbers in a prompt again.

### 9. Monday saturates the strategy run cap exactly, 6 of 6
strategy 12:00 + dev 14:00 + qa 15:30 + apply 20:00 + dev 20:00 + cost 21:00 = 6 runs vs
`strategy_team_max_runs=6`. Zero retry headroom; first real test is Mon 2026-08-03. History shows the failure
mode (cap 1 starved apply/cost for weeks). Manifest still says cap must be 3 and does not document that
R-DEV x2 and R-QA count against team=strategy.
**Fix (owner, spend valve is protected):** raise to 8; agent-editor updates the manifest paragraph. Watch
08-03 for `over_run_cap` skips as the probe.

### 10. Social pipeline: 10 consecutive zero-output runs, 18 drafts unreviewed for 15 days
The self-throttle is by design; the 15-day zero-review streak is not. The channel has never published a
single post. Facebook quota was set 07-22 but produces nothing because drafting is frozen.
**Fix (owner, 15-20 min):** one batch review in /admin/socials. Agent-taskable: draft-queue age in the daily
digest so review debt is visible. Keep autopost off, that gate is correct.

### 11. design-critic is blind in every scheduled run
Every daily-merchandise run 07-23 through 07-29 logs a variant of "no screenshot capability in this cloud
session"; the visual gate passes on structural self-checks only, while the playbook requires a 375px capture
and rubric verdict. The real fix request (suggestion #243, sandbox-capable screenshot path; #115 flags the
overdue Playwright work) sits approved and unbuilt. Until then, treat every scheduled-run design PASS as
unverified.
**Fix (code ticket):** expose the memory-documented Playwright capture recipe as a team API endpoint cloud
runs can call.

---

## P1: infra plane

### 12. Pricing recompute silently missed 2 of the last 3 days
07:00 UTC cron produced zero audit rows on 07-28 and 07-29. The agent sweep rescued 07-28 at 14:44, but its
26-hour look-back rule means each late rescue resets the clock, converting a dead daily cron into
every-other-day pricing with no alert. 07-29 had no pricing pass at all. Handler alerting is console.error
only.
**Fix (code ticket + agent-def edit):** rule becomes "a scheduled (non-catchup) batch row exists today";
tag catch-up runs so rescues can never satisfy the check; add Sentry/email alarm to the cron handler. Also
check Vercel logs to split "not invoked" from "crashed" for 07-28/29.

### 13. Browser-tier checkout probe has never passed, and pages you daily
6/6 runs since 07-24 fail at `probe-crash`, each sending you email AND SMS. The http tier is green and a real
order landed 07-26, so this is a probe-script bug, not a broken purchase path, but the deep revenue alarm has
produced zero real signal since it shipped and the daily false P0 is alarm fatigue. The fix ticket is blocked
by design (probe path is protected), so it is yours.
**Fix (owner or supervised session):** repro `scripts/checkout-probe-browser.mjs` via workflow_dispatch,
capture crash output into the report payload; mute the browser-tier alert behind a "has ever passed" flag
until green.

---

## Do you need more agents?

Mostly no. 45 defined agents cover the surface well; the failures above are wiring, not missing headcount.
Three genuine additions/changes, in priority order:

1. **Acquisition ownership (charter change, not a new agent).** Give store-strategist an acquisition section
   with weekly channel targets, and stop discounting GA4 at low traffic; low traffic IS the finding. Biggest
   single gap to $2k/month.
2. **Order-ops watcher (small new cron or log-monitor extension).** `ga4_purchase_failures` and
   `meta_capi_failures` are write-only, nothing watches fulfillment aging or refund/webhook failures, and the
   review flywheel never starts (`review_invites` is empty despite the 07-26 order; the review-reminders cron
   is a permanent no-op). Scales with sales; cheap to add now.
3. **Support-email stopgap (wire customer-service-emma).** The agent def exists but nothing polls
   hello@xdipx.com (Zoho IMAP). Known and tracked, low volume today, but it is customer-facing dead air the
   day a customer writes. A daily IMAP poll that drafts replies for your approval is enough for now.

Not needed: more reviewers, more researchers (three research agents already exist and are dead for lack of
triggers, not lack of agents), a separate analytics agent (homepage-cro + strategist already have GA4).

---

## Owner action list (one sitting, ~60-90 min, in order)

1. ~~Answer the March 26-31 traffic-source question~~ — RETRACTED: dev seed data, see the correction above.
2. Flip `ads_team_enabled` + `email_team_enabled` ON, or explicitly re-park with a new documented reason.
3. Review the 18 social drafts in /admin/socials.
4. Decide the 3 approved ad campaigns (ids 1-3) and mint promo codes for approved promos #50/#51 in Shopify.
5. Run `npx tsx scripts/apply-migrations.ts --from 068`, then create the trend-scout + social-trend-scout
   (+ optionally business-research) triggers and record trig_ ids, or flip the two valves back OFF.
6. Raise `strategy_team_max_runs` 6 -> 8 before Mon 08-03.
7. Confirm the 07-18 auto-approve flips were yours; revert or have the docs updated.
8. Dismiss (not re-approve) the 4 stale code tickets R-DEV already investigated; they were flipped back to
   approved on 07-29 22:14 UTC and will churn re-claims.
9. Fix or mute the browser checkout probe (protected path, owner-only).
10. Release engine: already re-enabled during this audit. Watch its next cycles; the breaker fires on 2
    rollbacks in a window, and the spurious-probe root cause (PROBE_PRODUCT_HANDLE) was fixed 07-28.
11. Optional trims: dial `homepage_team_daily_cents` down from 60000 (actual spend < 43c/day); disable the
    weekly ads/email triggers if you choose to keep those teams parked.

## Agent-taskable fixes (file as tickets/suggestions, no owner build time)

- P0 profit rewrite + digest reconciliation line (finding 1).
- verified->applied out-of-band merge detection (finding 3).
- Apply-pass cap raise + refusal re-kinding (finding 4).
- Inbound-suggestions step in daily routines + process-row reclassifier + full-queue digest (finding 5).
- `settings_audit_log` for valve flips (finding 6).
- Watchdog scope rewrite + trigger prompt reissue (finding 8).
- Screenshot endpoint for design-critic (finding 11).
- Pricing-sweep rule tightening + cron alarm (finding 12).
- Manifest cleanup: "14 routines" prose, missing trig_ ids for 18/19, run-cap paragraph, social-trend-scout
  slot collision, import-monitor Mon/Wed/Fri reality vs "daily" docs.
- Marketing-calendar refresh producer (theme runway ends 2026-09-07).
- GitHub-token expiry alarm (the issue-alert channel died silently for ~2 days when the Vercel GITHUB_TOKEN
  expired).

---

## Refuted during verification (for the record)

Four findings claiming the release engine was off and the owner silently the merge bottleneck were refuted
mid-audit because the valve was re-enabled during this session; the 74-merges/7-days history and the
verified-ticket dead-end remain accurate as history and as finding 3. The escalation-email layer was
confirmed wired (owner-alerts.server.ts, Zoho SMTP) rather than unverified.

## Lower-severity backlog (P2/P3, 30 items)

Tracked in the audit workflow output; highlights: engine retries failed merges every 10 min forever with no
attempt accounting (ticket #125), draft PRs have no actor to mark ready-for-review, 6,586 pending
pricing_changes rows are a stale 05-13 artifact not a live queue, no outcome instrumentation on applied
suggestions (loop step 5 unimplemented), no external uptime check (all monitors run on Vercel itself),
review_invites never created, `video_team_enabled` correctly parked but its blocker list is stale in both
directions (migration 065 IS applied, BLOB token is NOT in prod env).

---

## Post-merge verification, 2026-07-30

The eight PRs implementing this evaluation (#390, #391, #393, #394, #395, #396, #398, #399) were
re-audited against code, production data, the live Shopify Admin API, and the live scheduler. This
section records what held and what did not, so the next reader does not have to re-derive it.

### Confirmed correct — do not re-litigate

- **The Shopify surface in the profit rewrite.** `ordersCount(query:, limit:)` returning `{count}`,
  `metafields(first:, namespace:)` on `Order`, and `variant.inventoryItem.unitCost` were all
  executed live against the store and work. `read_inventory` is granted. The metafield key limit is
  2-64 characters, not 30, and the longest real SKU is 7, so `profit_<sku>` was never at risk.
  `financial_status:paid` excludes refunded and partially-refunded orders, so `status:any` does not
  inflate revenue.
- **`priority >= 3` is the low tail, not inverted.** `SEVERITY_PRIORITY` is `{P0:1 … P3:4}`, the
  queue index is ASC, and the data agrees.
- **The two rewritten triggers lost no configuration.** Empty `mcp_connections` tracks
  `created_via: meta_mcp`, not the rewrite; three untouched siblings from the same cohort are also
  empty. Model, allowed tools, sources, outcomes and notifications are all intact.
- **Every live cron matches this manifest.** Checked trigger by trigger.
- **The out-of-band sweep works.** Tickets #43 and #70 reached `applied`.
- **Deleting the `deal_history` rollup broke nothing.** No live surface read those columns; they
  summed to zero across 4,698 rows.

### Confirmed wrong, and being fixed

| Finding | Fix |
|---|---|
| The emma-aside crawler gate is deployed and still spending: 19 paid calls across 17 products in the 10 minutes after deploy | #401 |
| `?force=1` on the owner digest dismisses production rows | #402 |
| The promised `pricing_audit_log` prune was never written and the drop was never disclosed | #403 |
| The sameness auto-close bypasses the `ALLOWED` transition map | #404 |
| `server/cron.*.ts` handlers are unprotected while `server/cron.ts` is protected | #405 |
| A batch of doc contradictions and phantom references, including a design gate declaring a tool that exists nowhere | #406 |

### Numbers in this document and its PRs that were wrong

- **"~47% of all metered spend (~$40/month)"** for `emma-aside`. Actual: **26.8% and $20.15** over
  the last 30 days. The figure was quoted onward into #395's commit message and two source files.
- **"wrote no rows at all on both 2026-07-28 and 07-29."** 2026-07-28 wrote **4,705 rows** at 14:44
  via a manual rescue; only 07-29 went unpriced. The distinction is the entire reason
  `trigger='batch_catchup'` exists.
- **"rows #55-59 re-filed verbatim as #108-115."** Five of the eight match a prior milestone slug;
  #111, #114 and #115 are new, and the text was updated rather than verbatim. The duplication is
  real; the citation overstates it.
- **3,566 calls across 2,709 distinct products on 2026-07-21** is exact. So is **52 approved
  `process` rows**, **four muted sameness slots**, the **~200-minute** content lock, and run 122
  skipping on `run_in_progress`.

### Still open at the time of writing

- **No Shopify order webhook has ever reached the app.** `order_line_items`, `review_invites`,
  `product_copurchase` and `referrals` all hold zero rows, and both real orders carry no `xdipx`
  metafields. Everything downstream of that wire is correct code that has never executed. This is
  the single most consequential item in this document and it is an owner action in Shopify Admin.
- **`daily_profit_summary` reads $0 lifetime.** The Phase D purge removed the six fake `SEED-%` rows
  on 2026-07-30 but the backfill did not follow, so the table now under-reports instead of
  over-reporting. Run `scripts/backfill-profit-summary.ts --from 2026-04-10` (not the default
  2026-07-23, which silently excludes order #1001 of 2026-04-10).
- **Phase 0's configuration half never ran**: 0 of 5 valve/cap writes, 0 of 4 suggestion-hygiene
  items. `strategy_team_max_runs` is 6 against six scheduled Monday runs.
- **The two half-enabled trend lanes are still half-enabled**, valves on, no triggers.
