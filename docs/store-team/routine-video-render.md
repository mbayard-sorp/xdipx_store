# Routine: Video Render (2x weekly)

Entry agent: `video-producer` (`.claude/agents/video-producer.md`). Monday and Thursday at 13:00
UTC while the program runs at two episodes a week. RENDERS ONE APPROVED EPISODE AND WRITES
NOTHING: it claims the next owner-approved episode from the ledger, assembles the payload from
the stored script, asserts the words match what the owner approved, and enqueues one generation
job. The durable `video_jobs` pipeline does the rendering; the owner reviews frames and the
finished cut in `/admin/video-studio`.

Money model: reasoning bills to the Max subscription; the enqueued job is METERED REAL MONEY on
the RunPod worker (fal is images only), logged to `api_token_log` under `video-*`, gated by
`video_team_daily_cents` and the per-video ceiling `video_team_max_cost_cents`. This routine
spends only on episodes the owner approved; the enqueue API enforces that server-side.

## Step 0: Start

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"video","runType":"video-render"}'
# -> {"id": $RUN_ID}
```

## Step 1: Gate

```bash
curl -s "$BASE_URL/api/team/gate?team=video&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN"
```

`ok:false` -> skipped event, finish honestly, exit. Never work around a closed gate.

**Enablement gate:** the episode API must be live and `video_program_enabled` must be `'true'`
(it ships off). Either missing -> skip honestly with the reason. Never enqueue from a script that
did not come from an approved ledger row.

## Step 2: Claim

`POST /api/team/video-episode {"op":"episode-claim","runId":$RUN_ID}` -> the oldest `approved`
episode whose planned slot is today or past. None -> the approved evergreen reserve. Still none
-> **Step 2a**.

### Step 2a: Empty queue

Post a `skipped` event with reason `empty_episode_queue`; file an owner blocker
(`dedupeKey:'video:empty-episode-queue'`, pointing at `/admin/video-studio`); finish
`status:'skipped'`; exit. **Never invent a script. Never re-render an aired episode. Never render
two in one run to catch up** (doubling spend and desynchronizing episode numbers from air dates
breaks the numbered callbacks).

## Step 3: Assemble and assert

Build the enqueue payload verbatim from the approved row's stored script: scenes with their
framePrompts, motionPrompts, durations and continuity, sceneSlug on scene 0 (standing-set frame
reuse), the talking tier and spoken line, captions, hook, cta, shareLine, seriesSlug and
episodeNumber. **Assert the spoken text is byte-identical to the approved row.** A mismatch is a
refusal, not a fix: file a blocker naming both strings and exit. The server runs the same
comparison and 409s; hitting that 409 means this step was skipped, which is itself a finding.

## Step 4: Enqueue

`POST /api/team/video-job {"op":"enqueue","episodeId":...,"runId":$RUN_ID,...}`. A `gated`
response or a per-video-ceiling refusal is a valid outcome: report it, never downgrade quality to
squeeze under, never split an episode across jobs (there is no cross-job concat; two jobs are two
videos). One episode per run, maximum.

The pipeline takes it from here: `/cron/video-job-poller` advances every 2 minutes; the one
own-frame product beat parks for the owner while `video_frame_review` is on (reused standing-set
frames skip the gate entirely); the finished cut waits in `/admin/video-studio`, where approval
fans out to Social Studio drafts at the episode's planned slot. X never receives a video row; the
owner posts to X by hand if he chooses.

## Step 5: Confirm the machine went quiet

Read the owner blocker list and run its probes (`POST /api/team/blocker {"op":"verify"}`), then
assert no open row on `dedupeKey:'runpod:stray-pod'`. Record the verdict in the retro, and record
"could not ask" as its own answer, never as an all-clear. (Job-level idle confirmation is
pipeline-side once the endpoint-idle probe ships; this step is the routine-level backstop.)

## Step 6: Retro + finish

Post `phase:'retro'` events: episode number and title, job id, estimated cost, cumulative week
cost, whether a frame is parked awaiting the owner, the RunPod verdict, and any owner-reported
metrics on prior episodes (never fabricate engagement).

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'$RUN_ID',"finished":true,"status":"succeeded","summary":"..."}'
```

## Enablement runbook (owner)

1. Everything in the writers-room runbook first (bundle merged, episode API live, cap at 3,
   room trigger reissued), plus at least one approved episode in the ledger.
2. The RunPod talking tier must be live for spoken-on-camera episodes (bake-off winner shipped);
   until then the room writes voiceover-carried b-roll episodes and this routine renders those.
3. Flip `video_program_enabled` on the Video tab of `/admin/homepage-team`.
4. Create the trigger: cron `0 13 * * 1,4` (Mon and Thu 13:00 UTC), no connectors (repo +
   xdipx.com egress only), with the git source attached per the manifest's trigger rules, prompt
   per the common skeleton pointing at THIS playbook, entry agent `video-producer`.
