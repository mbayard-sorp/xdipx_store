# Routine — Email Campaign Briefs (email-marketing-manager)

The playbook for the scheduled weekly email routine. Entry agent: `email-marketing-manager`.
**PLAN-ONLY**: campaign briefs are filed as suggestions (kind `campaign`) for the owner to execute
in Klaviyo's UI. The store's Klaviyo integration fires events and manages lists; it cannot create
campaigns, and this routine sends nothing.

Runs on the **Max subscription**. Recommended cadence: weekly, after the strategy routine.

## Step 0 — Start

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"email","runType":"email"}'   # → $RUN_ID
```

## Step 1 — Gate

`GET /api/team/gate?team=email&excludeRun=$RUN_ID`. If `ok:false` → post skipped, stop.

## Step 2 — Load doctrine + context

`docs/emma-voice.md` + email addendum (mandatory); `docs/store-team/mission-brief.md`; the strategy
brief; calendar; profit signals (`daily_profit_summary`, GA4 top product pages); the existing
event-triggered flows (welcome, back-in-stock, abandoned checkout, post-purchase) so campaigns
complement rather than duplicate; what homepage/social feature this week.

## Step 3 — Design (≤2 briefs per week)

Each brief is copy-paste executable: segment (list + filters), send day/time with reasoning,
2 subject + preview variants, full body copy, canonical `/products/{slug}` links with
`utm_source=klaviyo&utm_medium=email&utm_campaign=<name>`, and the success metric (clicks and
attributed orders, not opens). Frequency guard: a subscriber never gets more than 2 marketing sends
per week, flows included where visible. Discounts only reference owner-approved promo codes with the
MAP note.

## Step 4 — Voice gate (mandatory)

All subjects and body copy through `emma-empathy-reviewer` to a clean PASS.

## Step 5 — File the briefs

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"email","category":"other","kind":"campaign","suggestion":"<the full brief>","cxRisk":"low","runId":'$RUN_ID'}'
```

One `event` per brief.

## Step 6 — Retro

For executed briefs: UTM-attributed clicks/orders, profit deltas on featured SKUs → `decision`
events (`phase:'retro'`); real lessons → improvement suggestions. Flops reported plainly with
numbers.

## Step 7 — Spend + finish

Log tokens (`feature:'email-planning'`), then the final run update (briefs filed | segments | send
windows | retro verdicts).
