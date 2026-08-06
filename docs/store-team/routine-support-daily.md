# Routine: Daily Support Review (support-analyst)

The playbook for the scheduled support conversation-quality routine. Entry agent: `support-analyst`.
Once a day it samples recent customer conversations across the three live channels — voice, SMS, and
web chat — scores each against the Emma voice charter (conversational addendum) and factual accuracy,
checks tool-failure and refusal patterns, and files findings as suggestion rows **with an executor
kind** (never narrative-only). **Advisory only:** it reviews and files; it never edits a prompt, a
template, or a route, and it never answers a customer.

Runs on the **Max subscription**: own reasoning, the site is for data reads and spend logging only.
Never call the site's Anthropic-keyed endpoints.

The support team infrastructure — the `support` team gate/budget and the `support_team_enabled` kill
switch — lands with PR #457. Until it does, this routine no-ops honestly at the gate: the cloud
trigger is an owner action created at enablement, and the routine stays dormant until
`support_team_enabled` flips on.

Auth on every `/api/team/*` call: header `x-team-secret: $TEAM_TOKEN` (falls back to
`$HOMEPAGE_TEAM_TOKEN`, then `$CRON_SECRET`). `BASE_URL` = deployed origin.

## Step 0: Gate + start

```bash
RUN_ID=$(curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"support","runType":"support"}' | jq -r .id)
curl -s "$BASE_URL/api/team/gate?team=support&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN"
```

If `ok:false` (including `support_team_enabled` off): post
`{"op":"update","id":$RUN_ID,"update":{"status":"skipped","finished":true,"summary":"gate refused: <reason>"}}`
and **stop**. Skip honestly; never work around the gate.

## Step 1: Load doctrine (data only)

1. `docs/emma-voice.md` core + **conversational addendum** (mandatory, before scoring any turn).
   Either missing → STOP and report.
2. `docs/store-team/mission-brief.md` (binding doctrine).

## Step 2: Sample the last 24h across all three channels

Read a bounded N per channel from the DB the way the other data routines do (`DATABASE_URL`, psql /
neon-http over HTTPS, since 5432 is firewalled). You are spot-checking quality, not auditing every
message.

- **Voice:** `call_log` plus the call transcripts.
- **SMS:** `sms_turns`.
- **Web chat:** `emma_chat_turns`.

Record how many conversations you sampled per channel in a `step` event; a thin or empty day is a
valid, reported outcome.

## Step 3: Score each conversation

Three axes, with the per-channel tallies posted as a `step` event:

1. **Voice** against the charter + conversational addendum — register (the warmer support Emma),
   banned constructions (em-dashes, countdowns, "Buy now"), CTA whitelist, AI-guide honesty (no
   lived experience).
2. **Factual accuracy** — product facts, materials/safety, price/MAP discipline, and no fabricated
   proof or "customers say" claims.
3. **Tool/route health** — tool-call failures, empty-body replies to a customer (a customer-facing
   handler must never reply with silence), refusals Emma should have handled, broken data lookups.

## Step 4: File findings (executor-kinded, never narrative-only)

Each finding names an **executor kind** and a concrete DONE WHEN, deduped by a stable `dedupeKey`:

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"support","targetTeam":"<team-or-omit>","category":"<slug>","kind":"instructions","priority":3,"dedupeKey":"<stable-slug>","suggestion":"<finding + DONE WHEN>","cxRisk":"low"}'
```

- **Prompt/template wording** → the fix owner. Genuine doc/agent-def edits go to `agent-editor`
  (`kind:'instructions'`). The conversational prompts/templates themselves live under
  `app/lib/ai-agent/prompt.ts` and `app/lib/sms-v2/templates/**`, which are **code**, so those fixes
  are `kind:'code'` for R-DEV.
- **Tool/route/data bugs** → `kind:'code'` for R-DEV.
- A narrative-only row (no executor) is banned: it can never reach a terminal state on the bus.

## Step 5: Retro + spend + finish

1. One `decision` event (`phase:'retro'`) summarizing the day's conversation quality and the top
   pattern worth watching. A lesson becomes a standing suggestion only on its second occurrence,
   max 2 rows per run (intake doctrine in `improvement-loop.md`).
2. Log tokens under `feature:'support-review'`
   (`POST /api/homepage-team/spend {"kind":"tokens","source":"agent-sdk","feature":"support-review"}`).
3. Finish the run:

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'$RUN_ID',"update":{"finished":true,"status":"succeeded","summary":"<sampled counts + findings filed + top pattern>"}}'
```

## Appendix: Enablement

The routine ships inert. To turn it on, in order:

1. **Land the support-team infrastructure (PR #457):** the `support` team gate/budget and the
   `support_team_enabled` kill switch.
2. **Flip the kill switch:** `support_team_enabled` → on.
3. **Create the cloud trigger** (routine 21 in `docs/store-team/routine-schedule.md`): the owner
   creates it at enablement, `30 16 * * *` (16:30 UTC daily), team `support`, feature label
   `support-review`.
4. **One supervised manual run:** fire the routine by hand, watch the run row and events, confirm the
   sample reads across all three channels and findings land with executor kinds.

Until steps 1-2 are done, every fire no-ops honestly at the gate.
