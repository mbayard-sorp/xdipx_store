# Routine — Weekly Strategy (store-strategist)

The exact playbook for the scheduled "Weekly Strategy" cloud routine. Entry agent:
`store-strategist`, with `inventory-sentinel`, `promo-manager`, `loyalty-referral-manager`,
`product-manager` (review-only here — the daily product routine owns queue execution), and
`program-manager` as sub-steps under the same run. **Advisory only** — this routine publishes a brief and files
suggestions; it changes nothing itself. Recommended schedule: Monday morning.

Runs on the **Max subscription**: own reasoning, site only for data + spend logging. Never call the
site's Anthropic-keyed endpoints.

## Preconditions

- Callback secret as `TEAM_TOKEN` (falls back to `HOMEPAGE_TEAM_TOKEN` / `CRON_SECRET`); sent as
  `x-team-secret` on every call. `BASE_URL` = deployed origin.
- Hard `maxTurns` ~14. Read `docs/store-team/mission-brief.md` after the gate; it is binding.

## Step 0 — Start the run

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"strategy","runType":"strategy"}'
# → { "id": 42 }   → $RUN_ID
```

## Step 1 — Gate (abort if not ok)

```bash
curl -s "$BASE_URL/api/team/gate?team=strategy&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN"
```

If `ok:false`: post `{"op":"update","id":$RUN_ID,"update":{"status":"skipped","finished":true,"summary":"gate refused: <reason>"}}` and **stop**.

## Step 2 — Read (data only)

- Previous brief: `GET /api/team/brief`.
- Search performance: the latest `gsc_snapshots` row (written Monday 06:00 UTC by
  `/cron/gsc-snapshot`; last-28-day totals, top queries, top pages, sitemap status). Report
  click/impression trends and overlap with covered content clusters in the brief; file a
  suggestion on regressions or sitemap errors. A missing or stale (> 8 days) snapshot is itself
  reportable: either the cron broke or the GSC service-account env vars are not set yet.
- Homepage SERP snippet: pull the `https://xdipx.com/` entry out of that snapshot's `top_pages`
  (impressions, clicks, CTR, position) and read the current **published** `singleton.homeSeo`
  (`*[_id == "singleton.homeSeo"][0]{seoTitle, seoDescription, _updatedAt}`, published perspective).
  Report both in the brief, side by side. You never write Sanity: `homepage-orchestrator` is the sole
  writer of that document. When a rotation is warranted, authorise it with a line reading exactly:

  ```
  HOMESEO: ROTATE week=<this brief's own weekStart, YYYY-MM-DD>
  ```

  The `week=` binding is not optional. Briefs stay `status='active'` until superseded and the daily
  merchandise routine reads them every day, so an unbound directive would re-authorise the same
  rotation every day for a week. The consumer's matching rules are in
  `docs/homepage-team/routine-daily-merchandise.md` Step 5c; keep the token identical in both files.

  **Evidence floor.** Do not direct a CTR-driven rotation until the homepage clears a rolling 28-day
  floor of several hundred clicks. The 2026-07-27 snapshot showed 48 impressions and 5 clicks
  sitewide, 28 and 3 of them on the homepage, whose queries are almost entirely brand-name
  misspellings ("dipx", "xdip", "dip x"). At that volume CTR is noise, and Google caches SERP titles
  for days to weeks, so a rotation measured a week later compares the old title against a new
  baseline. Same discipline as the GA4 300-sessions rule, stricter floor because clicks are the whole
  signal. Below the floor the only valid triggers are: the snippet is empty, it violates the voice
  charter, it is factually wrong, or the owner asked.
- Citation spot-check (zero infra): web-search 3 rotating queries from the approved keyword bank
  and note in the brief whether xdipx.com is cited or linked in the answers/results.
- Cross-team activity: `POST /api/team/event {"op":"list","sinceDays":7}`.
- Improvement bus state: `POST /api/team/suggestion {"op":"list"}`.
- Outcomes: `daily_profit_summary` (orders/revenue/margin/AOV/ad_spend), GA4 via the
  `google-analytics` MCP (≥300 sessions/week to weight it), `social_posts` (drafts vs posted),
  `ad_campaigns` statuses, calendar `GET /api/team/calendar`.
- Review funnel: invite/review counts from `review_invites` + `review_aggregates` (the data behind
  `getReviewStats` in `app/lib/reviews.server.ts`). Report invites-sent and reviews-landed in the
  brief; **if orders shipped this week but invites-sent is 0 for 7 straight days, file a
  suggestion** (the invite webhook or the review-reminders cron has silently broken).

## Step 3 — Retro on last week's brief

Directive by directive: followed? outcome? keep/adjust/drop? One `decision` event each:

```bash
curl -s -X POST "$BASE_URL/api/team/event" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"record","runId":'$RUN_ID',"eventType":"decision","agentRole":"store-strategist","phase":"retro","summary":"<directive>: <verdict + numbers>"}'
```

## Step 4 — Sub-specialists (sequence, same $RUN_ID)

1. `inventory-sentinel` — catalog stock/price sweep → targeted suggestions + scoreboard event.
2. `promo-manager` — MAP-guarded promo designs for the coming window → kind `promo` suggestions +
   calendar proposals.
2b. **Execute approved promos (valve-gated).** For promo rows the owner has already approved, mint
   the Shopify discount code. Gated by `promo_execute_enabled`, default **off**; with the valve off
   the script exits without touching Shopify. It is fail-closed: a row flagged with a MAP conflict,
   missing an explicit window, or with no resolvable eligible product is refused (loud owner email +
   ticket note), never minted. On a clean mint the owner is emailed the code and window and a note
   link lands on the ticket. Idempotent: rows already carrying a minted note are skipped.

   ```bash
   tsx scripts/execute-approved-promos.ts
   ```
3. `loyalty-referral-manager` — retention/referral moves → kind `program` suggestions.
4. `product-manager` (**review-only in the weekly run**) — do NOT call the import-candidate action
   endpoint here; the daily product routine (`routine-product-daily.md`) owns queue execution.
   Aggregate the week's daily product/import decisions (its `decision` events), judge whether the
   catalog mix matches the brief's theme, surface systemic patterns (a brand over-imported, category
   gaps, a growing needs-review or price-drop backlog), and hand catalog direction into the brief.
5. `program-manager` (run last) — audits `docs/store-team/trackers/*.md` against each
   milestone's evidence probe, recomputes status + RAG per the trackers README, posts a
   `decision` event per RAG change + an audit scoreboard event, reports each milestone's
   **status** only in those events and the Program Status brief section (a RED tracker line is a
   report, never a suggestion row — a status has no executor and can never reach a terminal state
   on the bus), files a suggestion **only when a milestone genuinely needs work done** and then in
   an executable kind (`code` for R-DEV, `instructions` for agent-editor, **never** `process`) with
   `dedupeKey:'tracker:<milestone-tag>'` so a re-file is a no-op, opens a docs-only tracker PR
   (`pm/tracker-<date>`, never merged by the PM, and **not merged by the release engine either**:
   the `pm/` prefix is not engine-eligible and the allowlist does not cover
   `docs/store-team/trackers/`, so the PR waits for the owner. See `program-manager.md` step 6)
   when rows changed, and hands the strategist a
   **Program Status** section (overall RAG + top risks + owner asks per program) to include
   verbatim in the brief. It also verifies **routine coverage**, and the scope is *derived from
   `routine-schedule.md`, never enumerated here*:

   - Read every routine row in `docs/store-team/routine-schedule.md`. For each, decide whether it is
     **expected to run**: a trigger id is recorded, or its gating valve is on.
   - Expected-to-run with no `homepage_team_runs` row in the last 7 days → file a `process`
     suggestion. A stalled drain backs its queue up quietly (the daily product routine is the
     easiest to miss).
   - **Gating valve ON but no trigger id recorded** → also a mandatory `process` suggestion. This is
     the half-enabled state: on 2026-07-28 the trend-scout and social-trend-scout valves were turned
     on and their triggers were never created, so two lanes were live-but-dead and three downstream
     consumers starved with nothing reporting it.
   - Valve off AND no trigger → expected-missing, exempt, say nothing.

   Never hardcode routine numbers in this step or in the trigger prompt. That list has gone stale
   twice (it read "2-14" while the manifest listed 19 routines, so everything added after 2026-07-23
   was outside the watchdog's scope by construction), and a coverage check that cannot see a new
   lane is worse than none, because it reports "zero misses" either way.

Each posts its own events under `$RUN_ID` with its `agentRole`.

## Step 5 — Publish the brief

One markdown doc: the week's focus, per-team directives (homepage, social, ads, email, content +
pricing/merch notes), an explicit stop-doing list, the **Program Status** section handed over by
`program-manager` (included verbatim), metrics behind every call. The content section
sets the week's blog topic slate, category-mix tuning (guides/comparisons/care/wellness-basics),
and campaign tie-ins with the marketing calendar; the daily content playbook
(`docs/store-team/routine-content-daily.md`) tolerates a brief without a content section, so omit
it honestly rather than padding.

Include a **Video Plan** section when the video team is enabled (`video_team_enabled`), and omit it
honestly when it is not. The Video Plan is a spend allocation, not a wish list: video generation is
metered fal.ai spend, unlike your Max-billed reasoning. It contains: (a) the week's volume and tier
split (e.g. "3 videos: 1 premium presenter + 2 standard"), (b) a slate table with one row per video
(product handle, formula from the library in `.claude/agents/video-producer.md`, tier, target
platforms, source tie-in such as the anchor blog post or calendar theme, and the metric that
justifies the pick), and (c) the selection reasoning. Selection rubric, hard gates first: in stock,
published, has real Shopify product photography, MAP status known, concept passes voice and
doctrine. Then weights: hero/theme alignment 30 (the week's headliner is auto-included as the
premium video; video commits to the headliner and does NOT chase homepage rotations), realized
margin x order velocity 25, PDP-video-gap conversion opportunity 15, blog tie-in 15 (name the
source post slug; its answers become the script), new-import freshness 5 (standard tier only,
never premium), promo/calendar window fit 5. Mirror the slate into `metricsJson.videoPlan`, and in
the retro read `video_jobs` outcomes (approval rate, cost per approved video, regen rate; owner
metrics_json once posts go out). Approval rate under ~40% sustained is a stop-doing signal: pause
the slate and fix the formula via an instructions suggestion before spending more.

Include a **Catalog Pipeline** section (and mirror its numbers into `metricsJson`), **profit-first**:
lead with orders/margin attributable to newly-imported SKUs and to price-dropped SKUs (order line
items; GA4 item-list/PDP only when the week has ≥300 sessions, else flag the number heuristic) —
that tie-back is the headline. Throughput is the supporting detail, sourced from the product-manager
and inventory-sentinel events: queue depth (pending/watching); auto-imported A/B + Tier-C and
product-manager approve/reject/watch this week (and any `skippedDueToCap` days); enrichment stuck
(`imported AND enriched_at IS NULL`) and quality-gate parks (`enrich_failed_at`); publish stuck
(`enriched_at set, published_at NULL`) and rough import→live latency; new-arrival products surfaced;
price drops detected / repriced / routed. Per `mission-brief.md`: throughput is an activity metric,
never a win — a high import count with zero new-product orders is a **stop-doing** signal.

**Label the enrich/publish health line measured or UNMEASURED — never carry a stale "dead" verdict.**
The strategy sandbox has no Shopify creds, so an enrich/publish claim inferred from Shopify-less
signals is not a measurement. Read the ground truth from Neon: `import_candidates.enriched_at` /
`published_at` max, plus the enrich-stuck (`imported AND enriched_at IS NULL`) and publish-stuck
(`enriched_at set, published_at NULL`) counts. `DATABASE_URL` is available and the daily product
routine already reads it this way (psql / neon-http over HTTPS, since port 5432 is firewalled); do
the same here. If that read genuinely cannot run this pass, label the Catalog Pipeline health line
**UNMEASURED** (or defer it to the product-daily run, which reads live DB) rather than repeating a
prior "dead"/"chain is broken" verdict. A stale "dead" premise wrongly throttles the product-daily
routine's Step-3 approval volume, and it has in fact been carried for three consecutive briefs while
live DB showed enrich+publish keeping pace daily.

```bash
curl -s -X POST "$BASE_URL/api/team/brief" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"publish","weekStart":"<YYYY-MM-DD>","brief":"<markdown>","metricsJson":{...}}'
```

## Step 6 — Route cross-team suggestions

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"strategy","targetTeam":"<team>","category":"other","kind":"<kind>","suggestion":"<concrete change + evidence>","cxRisk":"low"}'
```

## Step 7 — Spend + finish

Log Max tokens (`POST /api/homepage-team/spend {"kind":"tokens","source":"agent-sdk","feature":"strategy-weekly",...}`), then:

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'$RUN_ID',"update":{"finished":true,"status":"succeeded","summary":"<brief focus + rows CLOSED since last run + top retro verdicts>"}}'
```
