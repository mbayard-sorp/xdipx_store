# Routine — Weekly Video Producer

Entry agent: `video-producer` (`.claude/agents/video-producer.md`). Weekly, after the strategy run
publishes a fresh brief. Review-first: this routine SCRIPTS and ENQUEUES; the durable
`video_jobs` pipeline renders; the owner reviews everything in `/admin/video-studio`.

Money model: reasoning bills to the Max subscription (cost ~0); every enqueued job is metered
fal.ai spend logged to `api_token_log` under `video-*` features, gated by `video_team_daily_cents`
and the hard per-video ceiling `video_team_max_cost_cents`. The scene-frame stage costs cents and
is owner-gated (`video_frame_review`, default on) before the dollar clip spend.

## Step 0 — Start

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"video","runType":"video"}'
# -> {"id": $RUN_ID}
```

## Step 1 — Gate

```bash
curl -s "$BASE_URL/api/team/gate?team=video&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN"
```

`ok:false` -> record a `skipped` event with the reason, finish the run honestly
(`status:'skipped'`), exit. Never work around a closed gate.

## Step 2 — Read context (data only)

1. Agent charter: `.claude/agents/video-producer.md` (binding).
2. Voice: `docs/emma-voice.md` core + marketing addendum. Platform intensity caps: IG/YT 6-7,
   TikTok 5, never 8-9 on rented channels.
3. The brief: `GET /api/team/brief` -> the **Video Plan** section is your slate. No Video Plan in
   an enabled week -> build the slate yourself by the charter rubric and note that in the retro.
4. Calendar: `GET /api/team/calendar` for the active theme/promo window (MAP-safe framing).
5. Config: `POST /api/team/video-job {"op":"config"}` -> valves, model tiers with rates and
   allowed durations, formula whitelist, approved cast members.
6. Training data: `POST /api/team/video-job {"op":"list"}` -> prior jobs with frame-retry
   feedback, regenerate notes, rejections, and owner caption edits on fanned-out drafts. Read the
   feedback verbatim and let it change this week's scripts before drafting anything new.

## Step 3 — Script + voice gate (mandatory, before any spend)

For each slate item build `scriptJson`: `framePrompt` (archetype declared first, ground lock,
product-dominant blocking, no-text clause), `motionPrompt` (camera holds the product; spoken line
in quotes for native-audio tiers), `voiceover` (silent tiers only: narration TTS'd in the active
IVR voice and muxed at the lipsync stage; b-roll framing only since there is no lip sync; ~2 words
per second, fit inside `durationSeconds`), `durationSeconds`, per-platform `captions`, `hook`, `cta`.

Route EVERY script (spoken lines + all captions together) through `emma-empathy-reviewer`:
PASS -> proceed. REVISE -> apply and re-gate once. BLOCK -> drop the item and record why. Also
self-check the video-specific hard rules: no lived-experience claims, no named acts in
audio/on-screen text, no device-on-body depiction, judge wardrobe by the most revealing frame.

## Step 4 — Enqueue

```bash
curl -s -X POST "$BASE_URL/api/team/video-job" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"enqueue","productHandle":"...","formula":"myth-busting","presenter":"emma",
       "modelTier":"kling25-pro","durationSeconds":10,
       "targetPlatforms":["instagram","youtube","tiktok"],
       "scriptJson":{...},"runId":'$RUN_ID'}'
# -> {"jobId":"...","estCostUsd":0.82} | 403 {"error":"gated",...}
```

Volume comes from the Video Plan (launch default: 3/week, 1 premium presenter + 2 standard
b-roll). A `gated` response or a per-video-ceiling refusal is a valid outcome; report it, never
shrink quality to squeeze under, never split a concept across jobs to dodge the ceiling.

The pipeline takes it from here: `/cron/video-job-poller` advances stages every 2 minutes; frames
park for the owner while `video_frame_review` is on; finished videos wait in `/admin/video-studio`
where the owner's approval fans out to Social Studio drafts and optional Shopify graduation.

## Step 5 — Retro + finish

Post `phase:'retro'` events: slate vs enqueued (with reasons for drops), approval-rate trend,
cost per approved video, regen rate, formula comparison from `metrics_json` where the owner has
self-reported numbers. Never fabricate engagement; "N enqueued, M approved, no platform data yet"
is an honest retro. File suggestions for structural findings (acting team `video`).

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'$RUN_ID',"finished":true,"status":"succeeded","summary":"..."}'
```

## Enablement runbook (owner)

1. Apply migration 065 (`npx tsx scripts/apply-migrations.ts --from 065`).
2. Provision `XDIPX_READ_WRITE_TOKEN` (Vercel Blob store, XDIPX env prefix) and confirm `FAL_KEY`.
3. Review the Phase 0 spike output in `/admin/labs` (frame quality + tier ladder) and the casting
   call portraits; approve cast members in Sanity (`approvedForUse`).
4. Flip `video_team_enabled` on the Video tab of `/admin/homepage-team`. Leave
   `video_frame_review` ON and `video_team_autopublish` OFF for the calibration weeks.
5. Create the cloud trigger for this routine (see `docs/store-team/routine-schedule.md` row 15).
