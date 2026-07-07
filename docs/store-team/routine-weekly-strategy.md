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
- Cross-team activity: `POST /api/team/event {"op":"list","sinceDays":7}`.
- Improvement bus state: `POST /api/team/suggestion {"op":"list"}`.
- Outcomes: `daily_profit_summary` (orders/revenue/margin/AOV/ad_spend), GA4 via the
  `google-analytics` MCP (≥300 sessions/week to weight it), `social_posts` (drafts vs posted),
  `ad_campaigns` statuses, calendar `GET /api/team/calendar`.

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

One markdown doc: the week's focus, per-team directives (homepage, social, ads, email + pricing/
merch notes), an explicit stop-doing list, metrics behind every call.

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
