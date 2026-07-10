# Routine — Weekly Strategy (store-strategist)

The exact playbook for the scheduled "Weekly Strategy" cloud routine. Entry agent:
`store-strategist`, with `inventory-sentinel`, `promo-manager`, and `loyalty-referral-manager` as
sub-steps under the same run. **Advisory only** — this routine publishes a brief and files
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
3. `loyalty-referral-manager` — retention/referral moves → kind `program` suggestions.

Each posts its own events under `$RUN_ID` with its `agentRole`.

## Step 5 — Publish the brief

One markdown doc: the week's focus, per-team directives (homepage, social, ads, email, content +
pricing/merch notes), an explicit stop-doing list, metrics behind every call. The content section
sets the week's blog topic slate, category-mix tuning (guides/comparisons/care/wellness-basics),
and campaign tie-ins with the marketing calendar; the daily content playbook
(`docs/store-team/routine-content-daily.md`) tolerates a brief without a content section, so omit
it honestly rather than padding.

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
  -d '{"op":"update","id":'$RUN_ID',"update":{"finished":true,"status":"succeeded","summary":"<brief focus + N suggestions + top retro verdicts>"}}'
```
