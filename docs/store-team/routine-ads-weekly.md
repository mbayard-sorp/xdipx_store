# Routine — Ads Proposals (ads-manager)

The playbook for the scheduled weekly ads routine. Entry agent: `ads-manager`. **PROPOSE-ONLY**:
campaigns land in `ad_campaigns` as `status:'proposed'`; the owner approves on the dashboard and
launches by hand in-platform. This routine never creates/edits/activates anything on any ad platform
and never spends a cent. Its Meta MCP tools are read/insights-only by design.

Runs on the **Max subscription**. Recommended cadence: weekly, after the strategy routine.

## Step 0 — Start

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"ads","runType":"ads"}'   # → $RUN_ID
```

## Step 1 — Gate

`GET /api/team/gate?team=ads&excludeRun=$RUN_ID`. If `ok:false` → post skipped, stop.

## Step 2 — Policy first (mandatory)

Read **`docs/ads-policy.md`** in full, every run, before any research. Then
`docs/store-team/mission-brief.md` and the strategy brief. An idea that can't make an honest
compliance case dies here and gets a flagged `decision` event, not a proposal.

## Step 3 — Research (read-only)

Brief directives + organic proof (suggestions from social targeted at ads); read-only Meta insights
if an ad account exists; `ads_library_search` for wellness-space competitor creative; margin data
for break-even ROAS per candidate product; MAP status per promoted price.

## Step 4 — Propose (≤3 per run)

Each proposal: platform (honestly, per policy — never TikTok, never X paid; Google restricted
serving, adult networks, and owned/earned are the viable lanes), objective, audience, creative
direction (Emma charter + policy creative rules), landing URL with UTMs
(`utm_source=<platform>&utm_medium=paid&utm_campaign=<name>`), planned daily/total budget within
`ads_team_daily_cents`, break-even ROAS, and the mandatory `policyCheck`.

```bash
curl -s -X POST "$BASE_URL/api/team/ad-campaign" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"propose","platform":"google","name":"<name>","objective":"<objective>","plannedDailyCents":300,"audienceJson":{...},"creativeJson":{...},"policyCheck":"<policy category + why this complies>","runId":'$RUN_ID'}'
```

The API 400s without a substantive `policyCheck`. One `event` per proposal.

## Step 5 — Retro on live campaigns

For rows with `status:'launched'` (owner-synced spend): actual spend vs attributed revenue →
`decision` events; lessons → suggestions (own team or `targetTeam:'strategy'`).

## Step 6 — Spend + finish

Log tokens (`feature:'ads-planning'`), then the final run update with proposals written, ideas
killed on policy (one-liners), and retro verdicts.
