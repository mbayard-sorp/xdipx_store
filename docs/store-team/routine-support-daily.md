# Routine: Daily Support Review (support-analyst)

The playbook for the scheduled support conversation-quality routine. Entry agent: `support-analyst`.
Once a day it samples recent customer conversations across the three live channels — voice, SMS, and
web chat — scores each against the Emma voice charter (conversational addendum) and factual accuracy,
checks tool-failure and refusal patterns, and files findings as suggestion rows **with an executor
kind** (never narrative-only). **Advisory only:** it reviews and files; it never edits a prompt, a
template, or a route, and it never answers a customer.

Runs on the **Max subscription**: own reasoning, the site is for data reads and spend logging only.
Never call the site's Anthropic-keyed endpoints.

The support team is **live**. The `support` team gate/budget and the `support_team_enabled` kill
switch landed with PR #457, the switch is ON (`GET /api/team/gate?team=support` returns
`enabled:true`, dailyCents 300, maxRunsPerDay 2), and the cloud trigger
`trig_01J4JPPmzdtgg8UBpHDmbwTu` fires daily at 16:30 UTC (routine 21 in
`docs/store-team/routine-schedule.md`, first fire 2026-08-16). If the switch is ever flipped off,
the routine no-ops honestly at the gate.

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

Read from the DB the way the other data routines do (`DATABASE_URL`, psql / neon-http over HTTPS,
since 5432 is firewalled). SMS and web chat are bounded samples (spot-checking quality); voice is
**exhaustive** (every turn since the previous run, per the owner direction recorded in the
support-analyst agent definition) for as long as daily voice volume stays under 50 turns.

- **Voice:** every turn since the previous run: `sms_turns` where `channel='voice'`, plus
  `call_log` and the call transcripts.
- **SMS:** `sms_turns`.
- **Web chat:** `sms_turns` where `channel='web'` (v2 pipeline, `WEB_PIPELINE_VERSION=v2` in prod).
  The old `emma_chat_turns` table is the retired v1 path, dead since 2026-05-09; reading it reports
  zero web-chat conversations forever, even in weeks with real web-chat traffic (ticket #4873).

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

## IG comment replies (dormant: active only when the comments lane ships)

Owner direction 2026-08-08. This posture activates when the IG comments lane ships (ticket
dedupeKey `ig-comments-support-lane`); nothing in this section runs before that. When live,
`customer-service-emma` drafts the replies and this routine adds IG comment threads to its daily
conversation-quality review. Reply rules:

- Emma support voice: warm, human, short.
- Product questions answered from catalog knowledge, with a soft link to the PDP.
- NEVER claim lived experience.
- No trust-signal boilerplate unless the commenter explicitly asks about privacy or shipping; then
  answer plainly.
- Complaints and order issues move to hello@xdipx.com, with a one-line public acknowledgment.
- Never argue, never engage trolls (mark ignored). Harassment and spam get hidden via the API where
  supported and marked ignored.
- No medical advice; redirect to the Notebook education posts.
- Every reply passes the voice gate before entering the approval queue.

DONE WHEN (for the activating ticket): the posture is live and the first 10 approved replies have
shipped through the queue.

## Appendix: Enablement (historical)

The routine shipped inert and has since been enabled. Status of the original enablement steps:

1. **Support-team infrastructure (PR #457):** DONE. The `support` team gate/budget and the
   `support_team_enabled` kill switch are live.
2. **Kill switch:** DONE. `support_team_enabled` is on.
3. **Cloud trigger:** DONE. `trig_01J4JPPmzdtgg8UBpHDmbwTu`, `30 16 * * *` (16:30 UTC daily),
   team `support`, feature label `support-review`, created 2026-08-15, first fire 2026-08-16.
4. **One supervised manual run:** the only step that may still be open: fire the routine by hand,
   watch the run row and events, confirm the reads land across all three channels and findings carry
   executor kinds. If a supervised run has already happened, this appendix is fully closed.
